'use client';
import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const PAGES  = ['/', '/whatsapp', '/stats', '/import', '/profit'];
const LABELS = ['📦 Comenzi', '📱 WhatsApp', '📊 Statistici', '🚢 Import', '💹 Profit'];
const COLORS  = ['#f97316', '#25d366', '#3b82f6', '#a855f7', '#10b981'];

// Creează sau returnează overlay-ul (pagina ghost care se vede în paralel)
function getOverlay() {
  let el = document.getElementById('swipe-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'swipe-overlay';
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '500',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '16px',
      pointerEvents: 'none',
      opacity: '0',
      background: '#07090e',
      transition: 'none',
    });
    document.body.appendChild(el);
  }
  return el;
}

export default function SwipeNavigator() {
  const router  = useRouter();
  const pathname = usePathname();
  const pageIdx  = PAGES.indexOf(pathname);
  const navDir   = useRef(null);

  const s = useRef({
    startX: 0, startY: 0, dx: 0,
    dragging: false, locked: false, axis: null,
    targetIdx: -1,
  });

  // ── Animație de intrare după navigare ──────────────────────
  useEffect(() => {
    const wrap = document.getElementById('page-wrap');
    const dir  = navDir.current;
    if (!wrap || !dir) return;

    // Pagina nouă intră din direcția opusă gestului
    const fromX = dir === 'left' ? '100%' : '-100%';
    wrap.style.transition = 'none';
    wrap.style.transform  = `translateX(${fromX})`;
    wrap.style.opacity    = '1';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrap.style.transition = 'transform 320ms cubic-bezier(0.25,0.46,0.45,0.94)';
        wrap.style.transform  = 'translateX(0)';
        wrap.addEventListener('transitionend', () => {
          wrap.style.transition = '';
          wrap.style.transform  = '';
          s.current.locked = false;
          navDir.current   = null;
        }, { once: true });
      });
    });
  }, [pathname]);

  // ── Touch handlers ──────────────────────────────────────────
  useEffect(() => {
    const wrap    = () => document.getElementById('page-wrap');
    const overlay = getOverlay();

    const showOverlay = (idx, side) => {
      const color = COLORS[idx] || '#f97316';
      const label = LABELS[idx] || '';
      overlay.innerHTML = `
        <div style="font-size:52px;opacity:0.9">${label.split(' ')[0]}</div>
        <div style="font-size:18px;font-weight:700;color:#e2e8f0;font-family:'DM Sans',sans-serif">
          ${label.split(' ').slice(1).join(' ')}
        </div>
        <div style="width:40px;height:3px;border-radius:2px;background:${color};margin-top:4px"></div>
      `;
      overlay.style.background = '#07090e';
      // Overlay pornește din afara ecranului (din direcția în care vine)
      overlay.style.transition = 'none';
      overlay.style.transform  = `translateX(${side === 'left' ? '100%' : '-100%'})`;
      overlay.style.opacity    = '1';
      overlay.style.display    = 'flex';
    };

    const hideOverlay = () => {
      overlay.style.transition = 'none';
      overlay.style.transform  = 'translateX(0)';
      overlay.style.opacity    = '0';
      overlay.style.display    = 'none';
    };

    const doNavigate = (dir, targetIdx) => {
      if (s.current.locked) return;
      s.current.locked = true;
      navDir.current   = dir;

      const el  = wrap();
      const w   = window.innerWidth;
      const outX = dir === 'left' ? -w : w;

      // Animăm simultan: pagina curentă iese + overlay intră
      const ease = 'transform 300ms cubic-bezier(0.25,0.46,0.45,0.94)';
      if (el) {
        el.style.transition = ease;
        el.style.transform  = `translateX(${outX}px)`;
      }
      overlay.style.transition = ease;
      overlay.style.transform  = 'translateX(0)';

      setTimeout(() => {
        hideOverlay();
        if (el) { el.style.transition = 'none'; el.style.transform = ''; }
        router.push(PAGES[targetIdx]);
      }, 310);
    };

    const snapBack = () => {
      const el = wrap();
      const ease = 'transform 300ms cubic-bezier(0.34,1.2,0.64,1), opacity 200ms ease';
      if (el) {
        el.style.transition = ease;
        el.style.transform  = 'translateX(0)';
        el.style.opacity    = '1';
      }
      overlay.style.transition = ease;
      overlay.style.transform  = `translateX(${s.current.targetIdx > pageIdx ? '100%' : '-100%'})`;
      overlay.style.opacity    = '0';

      setTimeout(() => {
        hideOverlay();
        if (el) { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; }
        s.current.locked = false;
      }, 320);
    };

    const onStart = (e) => {
      if (s.current.locked) return;
      s.current.startX    = e.touches[0].clientX;
      s.current.startY    = e.touches[0].clientY;
      s.current.dx        = 0;
      s.current.dragging  = false;
      s.current.axis      = null;
      s.current.targetIdx = -1;
    };

    const onMove = (e) => {
      if (s.current.locked) return;
      const dx = e.touches[0].clientX - s.current.startX;
      const dy = e.touches[0].clientY - s.current.startY;

      // Detectăm axa după 8px
      if (!s.current.axis) {
        if (Math.hypot(dx, dy) < 8) return;
        s.current.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      if (s.current.axis === 'v') return;
      e.preventDefault();

      const idx       = pageIdx;
      const goingLeft = dx < 0;  // swipe stânga = pagina următoare
      const nextIdx   = goingLeft ? idx + 1 : idx - 1;

      if (nextIdx < 0 || nextIdx >= PAGES.length) return;

      s.current.dragging  = true;
      s.current.dx        = dx;
      s.current.targetIdx = nextIdx;

      const w      = window.innerWidth;
      const travel = Math.max(-w, Math.min(w, dx));

      // Prima mișcare: afișăm overlay-ul din direcția corectă
      if (overlay.style.display !== 'flex') {
        showOverlay(nextIdx, goingLeft ? 'left' : 'right');
      }

      // Mișcăm pagina curentă + overlay simultan (ca un carusel)
      requestAnimationFrame(() => {
        const el = wrap();
        if (el) {
          el.style.transition = 'none';
          el.style.transform  = `translateX(${travel}px)`;
          el.style.opacity    = '1';
        }
        overlay.style.transition = 'none';
        // Overlay vine din dreapta dacă swipe stânga, din stânga dacă swipe dreapta
        const overlayX = goingLeft
          ? w + travel   // pornește la w, se mișcă spre 0
          : -w + travel; // pornește la -w, se mișcă spre 0
        overlay.style.transform = `translateX(${overlayX}px)`;
      });
    };

    const onEnd = () => {
      if (s.current.locked || s.current.axis !== 'h' || !s.current.dragging) return;

      const dx        = s.current.dx;
      const w         = window.innerWidth;
      const targetIdx = s.current.targetIdx;

      if (Math.abs(dx) > w * 0.22 && targetIdx >= 0 && targetIdx < PAGES.length) {
        doNavigate(dx < 0 ? 'left' : 'right', targetIdx);
      } else {
        snapBack();
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
  }, [pathname, router, pageIdx]);

  // ── Dots indicator ──────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(62px + env(safe-area-inset-bottom,0px) + 8px)',
      left: 0, right: 0,
      display: 'flex',
      justifyContent: 'center',
      gap: 5,
      zIndex: 600,
      pointerEvents: 'none',
    }}>
      {PAGES.map((_, i) => (
        <div key={i} style={{
          width:      i === pageIdx ? 20 : 5,
          height:     5,
          borderRadius: 3,
          background: i === pageIdx ? '#f97316' : 'rgba(255,255,255,0.18)',
          transition: 'width 350ms cubic-bezier(0.34,1.56,0.64,1), background 300ms',
          boxShadow:  i === pageIdx ? '0 0 8px rgba(249,115,22,0.6)' : 'none',
        }}/>
      ))}
    </div>
  );
}

