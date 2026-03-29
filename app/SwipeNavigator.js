'use client';
import { useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const PAGES = ['/', '/whatsapp', '/stats', '/import', '/profit'];
const LABELS = ['Comenzi', 'WhatsApp', 'Statistici', 'Import', 'Profit'];

export default function SwipeNavigator() {
  const router   = useRouter();
  const pathname = usePathname();
  const state    = useRef({
    startX: 0, startY: 0,
    currentX: 0,
    dragging: false,
    locked: false,       // navigare în curs
    axis: null,          // 'h' | 'v' — detectat după primii 10px
    raf: null,
  });
  const pageIdx = PAGES.indexOf(pathname);

  // ─── helpers ───────────────────────────────────────────────
  const getEl   = () => document.getElementById('page-wrap');
  const setStyle = (el, dx, opacity, transition) => {
    if (!el) return;
    el.style.transition = transition || 'none';
    el.style.transform  = `translateX(${dx}px)`;
    el.style.opacity    = String(opacity);
  };

  const spring = (el, targetDx, targetOp, duration = 320) => {
    return new Promise(res => {
      if (!el) return res();
      const ease = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      el.style.transition = `transform ${duration}ms ${ease}, opacity ${duration}ms ${ease}`;
      el.style.transform  = `translateX(${targetDx}px)`;
      el.style.opacity    = String(targetOp);
      const tid = setTimeout(res, duration);
      el.addEventListener('transitionend', () => { clearTimeout(tid); res(); }, { once: true });
    });
  };

  const snapBack = async () => {
    const el = getEl();
    await spring(el, 0, 1, 280);
    setStyle(el, 0, 1);
    state.current.locked = false;
  };

  const navigate = async (dir, targetPath) => {
    if (state.current.locked) return;
    state.current.locked = true;
    const el = getEl();
    const w  = window.innerWidth;

    // 1. Slide out — continuă în direcția gestului
    await spring(el, dir === 'left' ? -w : w, 0, 260);

    // 2. Navighează (instant, pagina nouă apare din cealaltă parte)
    router.push(targetPath);

    // 3. Slide in — după un tick ca să prindă noul conținut
    await new Promise(r => setTimeout(r, 30));
    setStyle(el, dir === 'left' ? w * 0.4 : -w * 0.4, 0);
    await new Promise(r => requestAnimationFrame(r));
    await spring(el, 0, 1, 300);
    setStyle(el, 0, 1);
    state.current.locked = false;
  };

  // ─── touch handlers ─────────────────────────────────────────
  useEffect(() => {
    const s = state.current;

    const onStart = (e) => {
      if (s.locked) return;
      s.startX   = e.touches[0].clientX;
      s.startY   = e.touches[0].clientY;
      s.currentX = 0;
      s.dragging = false;
      s.axis     = null;
    };

    const onMove = (e) => {
      if (s.locked) return;
      const dx = e.touches[0].clientX - s.startX;
      const dy = e.touches[0].clientY - s.startY;

      // Detectăm axa după primii 8px
      if (!s.axis) {
        if (Math.hypot(dx, dy) < 8) return;
        s.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      if (s.axis === 'v') return; // scroll normal

      e.preventDefault(); // blochează scroll când glisăm horizontal

      const idx = PAGES.indexOf(pathname);
      // Nu permite drag dacă suntem la capete
      if (dx > 0 && idx === 0) return;
      if (dx < 0 && idx === PAGES.length - 1) return;

      s.dragging = true;
      s.currentX = dx;

      // Rubber-band: rezistență la capete (nu avem — dar aplic factor 0.4 dacă e prea mult)
      const resistance = Math.abs(dx) > window.innerWidth * 0.5 ? 0.5 : 1;
      const visualDx   = dx * resistance;
      const opacity    = Math.max(0.4, 1 - Math.abs(visualDx) / (window.innerWidth * 1.2));

      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = requestAnimationFrame(() => {
        setStyle(getEl(), visualDx, opacity);
      });
    };

    const onEnd = async (e) => {
      if (s.locked) return;
      if (s.axis !== 'h' || !s.dragging) return;

      const dx    = s.currentX;
      const vx    = Math.abs(dx);
      const w     = window.innerWidth;
      const idx   = PAGES.indexOf(pathname);
      const quick = vx > w * 0.22; // peste 22% din lățime → navighează

      if (dx < -30 && idx < PAGES.length - 1 && quick) {
        await navigate('left', PAGES[idx + 1]);
      } else if (dx > 30 && idx > 0 && quick) {
        await navigate('right', PAGES[idx - 1]);
      } else {
        await snapBack();
      }
      s.dragging = false;
    };

    const opts = { passive: false };
    const optsP = { passive: true };
    document.addEventListener('touchstart', onStart, optsP);
    document.addEventListener('touchmove',  onMove,  opts);
    document.addEventListener('touchend',   onEnd,   optsP);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove',  onMove);
      document.removeEventListener('touchend',   onEnd);
    };
  }, [pathname, router]);

  // ─── dots indicator ─────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(62px + env(safe-area-inset-bottom, 0px) + 8px)',
      left: 0, right: 0,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 5,
      zIndex: 200,
      pointerEvents: 'none',
    }}>
      {PAGES.map((_, i) => (
        <div key={i} style={{
          width:      i === pageIdx ? 20 : 5,
          height:     5,
          borderRadius: 3,
          background: i === pageIdx
            ? '#f97316'
            : 'rgba(255,255,255,0.18)',
          transition: 'width 350ms cubic-bezier(0.34,1.56,0.64,1), background 300ms',
          boxShadow:  i === pageIdx ? '0 0 8px rgba(249,115,22,0.6)' : 'none',
        }}/>
      ))}
    </div>
  );
}

