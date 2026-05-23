'use client';
/**
 * components/layout/BottomNav.tsx
 * Mobile-first bottom nav — 5 primary tabs + "More" drawer for the rest.
 * Pattern: Instagram / TikTok style. Clean SVG icons, pill active state.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useShopStore } from '@/lib/store/shop-store';

const FLAG: Record<string, string> = { RO: '🇷🇴', HU: '🇭🇺' };

/* ─── SVG Icons ─────────────────────────────────────────────── */
const Ico = {
  comenzi: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  xconn:   <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  gls:     <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  stats:   <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
  meta:    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/><circle cx="18" cy="2" r="2"/><circle cx="6" cy="14" r="2"/><circle cx="12" cy="8" r="2"/></svg>,
  profit:  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>,
  import:  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  sales:   <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
  chat:    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  more:    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>,
  close:   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
};

/* ─── Primary tabs (always visible) ────────────────────────── */
const PRIMARY = [
  { href: '/',                      icon: Ico.comenzi, label: 'Comenzi'    },
  { href: '/stats',                 icon: Ico.stats,   label: 'Stats'      },
  { href: '/profit',                icon: Ico.profit,  label: 'Profit'     },
  { href: '/meta-intelligence',     icon: Ico.meta,    label: 'Meta Intel' },
  { href: '/xconnector',            icon: Ico.xconn,   label: 'xConn'      },
];

/* ─── Secondary tabs (inside "More" drawer) ─────────────────── */
const SECONDARY = [
  { href: '/gls',               icon: Ico.gls,    label: 'GLS',        desc: 'Colete & AWB'         },
  { href: '/import',            icon: Ico.import, label: 'Import',     desc: 'Importă date'         },
  { href: '/sales-engine-pro',  icon: Ico.sales,  label: 'Sales',      desc: 'Motor de vânzări'     },
  { href: '/whatsapp',          icon: Ico.chat,   label: 'Chat',       desc: 'WhatsApp mesaje'      },
];

const ALL_HREFS = [...PRIMARY, ...SECONDARY].map(i => i.href);

export function BottomNav() {
  const pathname = usePathname();
  const { currentShop, shops } = useShopStore();
  const shopInfo = shops.find(s => s.key === currentShop);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on navigation
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Is current page a secondary one?
  const isSecondaryActive = SECONDARY.some(i =>
    pathname === i.href || (i.href !== '/' && pathname.startsWith(i.href))
  );

  return (
    <>
      {/* ── Backdrop ── */}
      {drawerOpen && (
        <div className="bn-backdrop" onClick={() => setDrawerOpen(false)} />
      )}

      {/* ── More drawer ── */}
      <div className={`bn-drawer${drawerOpen ? ' open' : ''}`}>
        <div className="bn-drawer-handle" />
        <div className="bn-drawer-header">
          <span className="bn-drawer-title">Meniu</span>
          <button className="bn-drawer-close" onClick={() => setDrawerOpen(false)}>
            {Ico.close}
          </button>
        </div>
        <div className="bn-drawer-grid">
          {SECONDARY.map(item => {
            const active = pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`bn-drawer-item${active ? ' active' : ''}`}
              >
                <span className="bn-drawer-icon">{item.icon}</span>
                <div className="bn-drawer-text">
                  <span className="bn-drawer-name">{item.label}</span>
                  <span className="bn-drawer-desc">{item.desc}</span>
                </div>
                {active && <span className="bn-drawer-badge">activ</span>}
              </Link>
            );
          })}
        </div>
        {/* Shop strip inside drawer */}
        {shops.length > 1 && (
          <div className="bn-drawer-shop">
            <span>{FLAG[shopInfo?.flag ?? 'RO'] ?? '🌐'}</span>
            <span style={{fontWeight:700, color:'var(--c-orange)'}}>{shopInfo?.label ?? currentShop.toUpperCase()}</span>
            <span style={{color:'var(--c-text4)', fontSize:10}}>activ</span>
          </div>
        )}
      </div>

      {/* ── Main nav bar ── */}
      <nav className="bottom-nav" aria-label="Navigare principală">
        <div className="bottom-nav-items">
          {PRIMARY.map(item => {
            const active = pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`bn-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <span className="bn-icon-wrap">
                  {active && <span className="bn-pill" />}
                  <span className="bn-icon">{item.icon}</span>
                </span>
                <span className="bn-label">{item.label}</span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            className={`bn-item${isSecondaryActive || drawerOpen ? ' active' : ''}`}
            onClick={() => setDrawerOpen(v => !v)}
            aria-label="Mai multe opțiuni"
          >
            <span className="bn-icon-wrap">
              {(isSecondaryActive || drawerOpen) && <span className="bn-pill" />}
              <span className="bn-icon">{Ico.more}</span>
            </span>
            <span className="bn-label">Mai mult</span>
          </button>
        </div>
      </nav>
    </>
  );
}
