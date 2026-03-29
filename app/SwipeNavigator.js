'use client';
import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// Ordinea paginilor — stânga ↔ dreapta
const PAGES = ['/', '/whatsapp', '/stats', '/import', '/profit'];

export default function SwipeNavigator() {
  const router   = useRouter();
  const pathname = usePathname();
  const touchStart = useRef(null);
  const touchStartY = useRef(null);
  const swiping = useRef(false);

  useEffect(() => {
    const onTouchStart = (e) => {
      touchStart.current  = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      swiping.current     = false;
    };

    const onTouchEnd = (e) => {
      if (touchStart.current === null) return;
      const dx = e.changedTouches[0].clientX - touchStart.current;
      const dy = e.changedTouches[0].clientY - touchStartY.current;

      // Ignorăm swipe-urile mai mult verticale (scroll)
      if (Math.abs(dy) > Math.abs(dx)) return;
      // Minim 60px pentru a declanșa navigarea
      if (Math.abs(dx) < 60) return;

      const idx = PAGES.indexOf(pathname);
      if (idx === -1) return;

      if (dx < 0 && idx < PAGES.length - 1) {
        // Swipe stânga → pagina următoare
        triggerSwipe('left', PAGES[idx + 1]);
      } else if (dx > 0 && idx > 0) {
        // Swipe dreapta → pagina anterioară
        triggerSwipe('right', PAGES[idx - 1]);
      }

      touchStart.current = null;
    };

    const triggerSwipe = (dir, targetPage) => {
      if (swiping.current) return;
      swiping.current = true;

      // Animație: slide out
      const main = document.getElementById('page-content');
      if (main) {
        main.style.transition = 'transform 220ms cubic-bezier(.4,0,.2,1), opacity 220ms';
        main.style.transform  = dir === 'left' ? 'translateX(-40px)' : 'translateX(40px)';
        main.style.opacity    = '0';
      }

      setTimeout(() => {
        router.push(targetPage);
        // Animație: slide in după navigare
        setTimeout(() => {
          if (main) {
            main.style.transition = 'none';
            main.style.transform  = dir === 'left' ? 'translateX(40px)' : 'translateX(-40px)';
            main.style.opacity    = '0';
          }
          requestAnimationFrame(() => {
            if (main) {
              main.style.transition = 'transform 220ms cubic-bezier(.4,0,.2,1), opacity 220ms';
              main.style.transform  = 'translateX(0)';
              main.style.opacity    = '1';
            }
            swiping.current = false;
          });
        }, 80);
      }, 180);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [pathname, router]);

  // Indicator vizual de pagină (dots)
  const idx = PAGES.indexOf(pathname);

  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(62px + env(safe-area-inset-bottom, 0px) + 6px)',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: 5,
      zIndex: 100,
      pointerEvents: 'none',
    }}>
      {PAGES.map((_, i) => (
        <div key={i} style={{
          width:  i === idx ? 18 : 5,
          height: 5,
          borderRadius: 3,
          background: i === idx ? '#f97316' : 'rgba(255,255,255,0.2)',
          transition: 'width 300ms cubic-bezier(.4,0,.2,1), background 300ms',
        }}/>
      ))}
    </div>
  );
}

