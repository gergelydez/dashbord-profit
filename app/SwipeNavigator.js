'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const PAGES = ['/', '/whatsapp', '/stats', '/import', '/profit'];
const EASE  = 'transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const SNAP  = 'transform 280ms cubic-bezier(0.34, 1.2, 0.64, 1)';

export default function SwipeNavigator() {
  const router   = useRouter();
  const pathname = usePathname();
  const pageIdx  = PAGES.indexOf(pathname);
  const [dots, setDots] = useState(pageIdx);

  const s = useRef({
    startX: 0, startY: 0, dx: 0,
    axis: null, dragging: false, locked: false,
  });

  // ── Prefetch toate paginile la mount ──────────────────────
  useEffect(() => {
    PAGES.forEach(p => router.prefetch(p));
  }, [router]);

  // ── Reset după navigare ───────────────────────────────────
  useEffect(() => {
    setDots(PAGES.indexOf(pathname));
  }, [pathname]);

  // ── Touch logic ───────────────────────────────────────────
  useEffect(() => {
    const wrap = () => document.getElementById('page-wrap');

    const set = (dx, tr = 'none') => {
      const el = wrap();
      if (!el) return;
      el.style.transition = tr;
      el.style.transform  = dx === 0 ? '' : `translateX(${dx}px)`;
    };

    const commit = (dir, targetIdx) => {
      if (s.current.locked) return;
      s.current.locked = true;
      const w    = window.innerWidth;
      const outX = dir === 'left' ? -w : w;
      const inX  = dir === 'left' ?  w : -w;

      // 1. Slide out pagina curentă
      set(outX, EASE);

      // 2. Navighează imediat (Next.js are pagina în cache din prefetch)
      //    Facem push fără să așteptăm animația — pagina se pregătește în paralel
      router.push(PAGES[targetIdx]);

      // 3. Slide in pagina nouă — după ce DOM-ul s-a actualizat
      //    Folosim o referință persistentă la wrap, nu o captură veche
      const tid = setTimeout(() => {
        const el = wrap();
        if (!el) { s.current.locked = false; return; }
        // Poziționăm pagina nouă din direcția opusă, fără tranziție
        el.style.transition = 'none';
        el.style.transform  = `translateX(${inX}px)`;
        // Un rAF dublu ca să garantăm că browser-ul a pictat noul conținut
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const el2 = wrap();
          if (!el2) { s.current.locked = false; return; }
          el2.style.transition = EASE;
          el2.style.transform  = '';
          el2.addEventListener('transitionend', () => {
            s.current.locked = false;
          }, { once: true });
        }));
      }, 50); // 50ms — suficient ca router.push să înceapă render-ul
    };

    const snapBack = () => {
      set(0, SNAP);
      const el = wrap();
      if (el) el.addEventListener('transitionend', () => {
        el.style.transition = '';
      }, { once: true });
    };

    const onStart = (e) => {
      if (s.current.locked) return;
      s.current.startX   = e.touches[0].clientX;
      s.current.startY   = e.touches[0].clientY;
      s.current.dx       = 0;
      s.current.axis     = null;
      s.current.dragging = false;
    };

    const onMove = (e) => {
      if (s.current.locked) return;
      const dx = e.touches[0].clientX - s.current.startX;
      const dy = e.touches[0].clientY - s.current.startY;

      if (!s.current.axis) {
        if (Math.hypot(dx, dy) < 8) return;
        s.current.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        if (s.current.axis === 'h') {
          const idx = PAGES.indexOf(pathname);
          if (dx < 0 && idx >= PAGES.length - 1) { s.current.axis = 'v'; return; }
          if (dx > 0 && idx <= 0)                { s.current.axis = 'v'; return; }
        }
      }
      if (s.current.axis === 'v') return;
      e.preventDefault();

      s.current.dragging = true;
      s.current.dx       = dx;

      const travel = Math.max(-window.innerWidth, Math.min(window.innerWidth, dx));
      requestAnimationFrame(() => set(travel));
    };

    const onEnd = () => {
      if (!s.current.dragging || s.current.axis !== 'h' || s.current.locked) return;
      const dx  = s.current.dx;
      const w   = window.innerWidth;
      const idx = PAGES.indexOf(pathname);

      if      (dx < -w * 0.28 && idx < PAGES.length - 1) commit('left',  idx + 1);
      else if (dx >  w * 0.28 && idx > 0)                commit('right', idx - 1);
      else                                                snapBack();

      s.current.dragging = false;
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove',  onMove,  { passive: false });
    document.addEventListener('touchend',   onEnd,   { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove',  onMove);
      document.removeEventListener('touchend',   onEnd);
    };
  }, [pathname, router]);

  // ── Dots ─────────────────────────────────────────────────
  return (
    <div style={{
      position:'fixed', bottom:'calc(62px + env(safe-area-inset-bottom,0px) + 8px)',
      left:0, right:0, display:'flex', justifyContent:'center',
      gap:5, zIndex:600, pointerEvents:'none',
    }}>
      {PAGES.map((_, i) => (
        <div key={i} style={{
          width:      i === dots ? 20 : 5,
          height:     5, borderRadius:3,
          background: i === dots ? '#f97316' : 'rgba(255,255,255,0.18)',
          transition: 'width 350ms cubic-bezier(0.34,1.56,0.64,1), background 300ms',
          boxShadow:  i === dots ? '0 0 8px rgba(249,115,22,0.6)' : 'none',
        }}/>
      ))}
    </div>
  );
}

