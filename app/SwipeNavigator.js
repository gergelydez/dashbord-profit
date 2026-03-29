'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const PAGES = ['/', '/whatsapp', '/stats', '/import', '/profit'];
const EASE  = 'transform 260ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const SNAP  = 'transform 220ms cubic-bezier(0.34, 1.2, 0.64, 1)';

export default function SwipeNavigator() {
  const router   = useRouter();
  const pathname = usePathname();
  const pageIdx  = PAGES.indexOf(pathname);
  const [dots, setDots] = useState(pageIdx);

  const s = useRef({
    startX: 0, startY: 0, dx: 0,
    axis: null, dragging: false, locked: false,
  });

  useEffect(() => { PAGES.forEach(p => router.prefetch(p)); }, [router]);
  useEffect(() => { setDots(PAGES.indexOf(pathname)); }, [pathname]);

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
      const w   = window.innerWidth;
      const outX = dir === 'left' ? -w : w;
      const inX  = dir === 'left' ?  w : -w;

      set(outX, EASE);
      router.push(PAGES[targetIdx]);

      setTimeout(() => {
        const el = wrap();
        if (!el) { s.current.locked = false; return; }
        el.style.transition = 'none';
        el.style.transform  = `translateX(${inX}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const el2 = wrap();
          if (!el2) { s.current.locked = false; return; }
          el2.style.transition = EASE;
          el2.style.transform  = '';
          el2.addEventListener('transitionend', () => {
            s.current.locked = false;
          }, { once: true });
        }));
      }, 50);
    };

    const snapBack = () => {
      set(0, SNAP);
      const el = wrap();
      if (el) el.addEventListener('transitionend', () => {
        el.style.transition = '';
      }, { once: true });
    };

    // Verifică dacă elementul sau un părinte e scrollabil orizontal
    const isInsideHScroll = (target) => {
      let el = target;
      while (el && el !== document.body) {
        const ox = window.getComputedStyle(el).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2) return true;
        el = el.parentElement;
      }
      return false;
    };

    const onStart = (e) => {
      if (s.current.locked) return;
      s.current.startX   = e.touches[0].clientX;
      s.current.startY   = e.touches[0].clientY;
      s.current.dx       = 0;
      s.current.axis     = null;
      s.current.dragging = false;

      // Dacă touch-ul e într-un scroll orizontal → nu navigăm
      if (isInsideHScroll(e.target)) {
        s.current.axis = 'v';
      }
    };

    const onMove = (e) => {
      if (s.current.locked) return;

      // Dacă axa e deja determinată
      if (s.current.axis === 'v') return;
      if (s.current.axis === 'h') {
        e.preventDefault();
        s.current.dx = e.touches[0].clientX - s.current.startX;
        const travel = Math.max(-window.innerWidth, Math.min(window.innerWidth, s.current.dx));
        requestAnimationFrame(() => set(travel));
        s.current.dragging = true;
        return;
      }

      const dx = e.touches[0].clientX - s.current.startX;
      const dy = e.touches[0].clientY - s.current.startY;
      const dist = Math.hypot(dx, dy);

      // Așteptăm minim 10px înainte să decidem
      if (dist < 10) return;

      const isHorizontal = Math.abs(dx) > Math.abs(dy) * 2; // 2:1 ratio — foarte strict
      if (!isHorizontal) {
        s.current.axis = 'v';
        return;
      }

      // E orizontal — verificăm dacă avem unde să mergem
      const idx = PAGES.indexOf(pathname);
      if (dx < 0 && idx >= PAGES.length - 1) { s.current.axis = 'v'; return; }
      if (dx > 0 && idx <= 0)                { s.current.axis = 'v'; return; }

      s.current.axis = 'h';
      e.preventDefault();
      s.current.dx = dx;
      s.current.dragging = true;
      const travel = Math.max(-window.innerWidth, Math.min(window.innerWidth, dx));
      requestAnimationFrame(() => set(travel));
    };

    const onEnd = () => {
      if (!s.current.dragging || s.current.axis !== 'h' || s.current.locked) return;
      const dx  = s.current.dx;
      const w   = window.innerWidth;
      const idx = PAGES.indexOf(pathname);

      if      (dx < -w * 0.20 && idx < PAGES.length - 1) commit('left',  idx + 1);
      else if (dx >  w * 0.20 && idx > 0)                commit('right', idx - 1);
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

