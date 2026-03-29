'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const PAGES = ['/', '/whatsapp', '/stats', '/import', '/profit'];

export default function SwipeNavigator() {
  const router   = useRouter();
  const pathname = usePathname();
  const pageIdx  = PAGES.indexOf(pathname);
  const [dots, setDots] = useState(pageIdx);

  const s = useRef({
    startX: 0, startY: 0, dx: 0,
    axis: null, dragging: false, locked: false,
    prevSnap: null, // snapshot-ul paginii anterioare/următoare
  });

  // ── Când se schimbă pagina, actualizăm dots și resetăm ──
  useEffect(() => {
    setDots(PAGES.indexOf(pathname));
    s.current.locked = false;
    // Cleanup orice snapshot rămas
    const snap = document.getElementById('page-snap');
    if (snap) snap.remove();
  }, [pathname]);

  useEffect(() => {
    const getWrap = () => document.getElementById('page-wrap');

    // Creăm un snapshot vizual al paginii curente (clonă simplă cu pointer-events none)
    const createSnapshot = () => {
      const existing = document.getElementById('page-snap');
      if (existing) existing.remove();

      const wrap = getWrap();
      if (!wrap) return null;

      const snap = document.createElement('div');
      snap.id = 'page-snap';
      // Clonăm conținutul vizual
      snap.innerHTML = wrap.innerHTML;
      Object.assign(snap.style, {
        position:      'fixed',
        inset:         '0',
        bottom:        '62px',
        zIndex:        '50',
        pointerEvents: 'none',
        overflow:      'hidden',
        background:    '#07090e',
        willChange:    'transform',
      });
      // Copiem stilurile relevante
      const wrapRect = wrap.getBoundingClientRect();
      snap.style.top = wrapRect.top + 'px';
      document.body.appendChild(snap);
      return snap;
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
        if (Math.hypot(dx, dy) < 10) return;
        s.current.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        if (s.current.axis === 'h') {
          // Verificăm dacă avem unde să mergem
          const idx = PAGES.indexOf(pathname);
          if (dx < 0 && idx >= PAGES.length - 1) { s.current.axis = 'v'; return; }
          if (dx > 0 && idx <= 0) { s.current.axis = 'v'; return; }
        }
      }
      if (s.current.axis === 'v') return;
      e.preventDefault();

      if (!s.current.dragging) {
        s.current.dragging = true;
        // La primul move horizontal — pregătim wrap-ul
        const wrap = getWrap();
        if (wrap) {
          wrap.style.transition  = 'none';
          wrap.style.willChange  = 'transform';
        }
      }

      s.current.dx = dx;
      const w = window.innerWidth;
      const travel = Math.max(-w, Math.min(w, dx));

      requestAnimationFrame(() => {
        const wrap = getWrap();
        if (wrap) wrap.style.transform = `translateX(${travel}px)`;
      });
    };

    const onEnd = () => {
      if (!s.current.dragging || s.current.axis !== 'h') return;
      if (s.current.locked) return;

      const dx  = s.current.dx;
      const w   = window.innerWidth;
      const idx = PAGES.indexOf(pathname);
      const threshold = w * 0.30; // 30% pentru a naviga
      const wrap = getWrap();
      const ease = 'transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';

      if (dx < -threshold && idx < PAGES.length - 1) {
        // Navighează STÂNGA (pagina următoare)
        s.current.locked = true;
        if (wrap) {
          wrap.style.transition = ease;
          wrap.style.transform  = `translateX(${-w}px)`;
        }
        setTimeout(() => {
          if (wrap) { wrap.style.transition = 'none'; wrap.style.transform = ''; }
          router.push(PAGES[idx + 1]);
          // Pagina nouă intră din dreapta
          requestAnimationFrame(() => {
            const w2 = getWrap();
            if (w2) {
              w2.style.transition = 'none';
              w2.style.transform  = `translateX(${w}px)`;
              requestAnimationFrame(() => {
                w2.style.transition = ease;
                w2.style.transform  = 'translateX(0)';
                w2.addEventListener('transitionend', () => {
                  w2.style.transition = '';
                  w2.style.transform  = '';
                  w2.style.willChange = '';
                  s.current.locked = false;
                }, { once: true });
              });
            } else {
              s.current.locked = false;
            }
          });
        }, 285);

      } else if (dx > threshold && idx > 0) {
        // Navighează DREAPTA (pagina anterioară)
        s.current.locked = true;
        if (wrap) {
          wrap.style.transition = ease;
          wrap.style.transform  = `translateX(${w}px)`;
        }
        setTimeout(() => {
          if (wrap) { wrap.style.transition = 'none'; wrap.style.transform = ''; }
          router.push(PAGES[idx - 1]);
          requestAnimationFrame(() => {
            const w2 = getWrap();
            if (w2) {
              w2.style.transition = 'none';
              w2.style.transform  = `translateX(${-w}px)`;
              requestAnimationFrame(() => {
                w2.style.transition = ease;
                w2.style.transform  = 'translateX(0)';
                w2.addEventListener('transitionend', () => {
                  w2.style.transition = '';
                  w2.style.transform  = '';
                  w2.style.willChange = '';
                  s.current.locked = false;
                }, { once: true });
              });
            } else {
              s.current.locked = false;
            }
          });
        }, 285);

      } else {
        // Snap back
        if (wrap) {
          wrap.style.transition = 'transform 300ms cubic-bezier(0.34, 1.2, 0.64, 1)';
          wrap.style.transform  = 'translateX(0)';
          wrap.addEventListener('transitionend', () => {
            wrap.style.transition = '';
            wrap.style.willChange = '';
          }, { once: true });
        }
      }

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
      position:      'fixed',
      bottom:        'calc(62px + env(safe-area-inset-bottom,0px) + 8px)',
      left: 0, right: 0,
      display:       'flex',
      justifyContent:'center',
      gap:           5,
      zIndex:        600,
      pointerEvents: 'none',
    }}>
      {PAGES.map((_, i) => (
        <div key={i} style={{
          width:      i === dots ? 20 : 5,
          height:     5,
          borderRadius: 3,
          background: i === dots ? '#f97316' : 'rgba(255,255,255,0.18)',
          transition: 'width 350ms cubic-bezier(0.34,1.56,0.64,1), background 300ms',
          boxShadow:  i === dots ? '0 0 8px rgba(249,115,22,0.6)' : 'none',
        }}/>
      ))}
    </div>
  );
}

