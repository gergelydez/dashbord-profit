'use client';
/**
 * components/layout/TopBar.tsx
 * Mobile global top bar — hidden on desktop (sidebar handles it).
 * Shows: brand + PROMINENT store switcher.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useShopStore } from '@/lib/store/shop-store';

const FLAG: Record<string, string> = { RO: '🇷🇴', HU: '🇭🇺' };

export function TopBar() {
  const { currentShop, shops, setCurrentShop } = useShopStore();
  const qc    = useQueryClient();
  const [open, setOpen] = useState(false);
  const current = shops.find(s => s.key === currentShop);

  function switchTo(key: string) {
    setCurrentShop(key);
    setOpen(false);
    qc.invalidateQueries();
    // CustomEvent fires reliably on the same window/tab (StorageEvent does not)
    window.dispatchEvent(new CustomEvent('glamx:shop', { detail: key }));
  }

  return (
    <>
      <header className="topbar-global">
        {/* Brand */}
        <Link href="/" style={S.brand}>
          <div style={S.logoMark}>G</div>
          <span style={S.brandName}>GLAMX</span>
        </Link>

        {/* Store switcher — prominent pill */}
        {shops.length > 0 ? (
          <button
            style={S.storePill}
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>
              {FLAG[current?.flag?.toUpperCase() ?? ''] ?? '🌐'}
            </span>
            <span style={S.storeLabel}>{current?.label ?? currentShop.toUpperCase()}</span>
            <span style={{ fontSize: 10, color: 'var(--c-text3)', opacity: 0.8 }}>
              {open ? '▲' : '▼'}
            </span>
          </button>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {/* Right spacer */}
        <div style={{ width: 36 }} />
      </header>

      {/* Bottom sheet modal */}
      {open && shops.length > 1 && (
        <>
          <div style={S.overlay} onClick={() => setOpen(false)} />
          <div style={S.sheet}>
            <div style={S.handle} />
            <div style={S.sheetTitle}>Selectează magazin</div>
            {shops.map(s => {
              const isActive = s.key === currentShop;
              return (
                <button
                  key={s.key}
                  style={{
                    ...S.sheetItem,
                    background:  isActive ? 'rgba(249,115,22,0.08)' : 'transparent',
                    borderLeft:  isActive ? '3px solid var(--c-orange)' : '3px solid transparent',
                  }}
                  onClick={() => switchTo(s.key)}
                >
                  <span style={{ fontSize: 32, lineHeight: 1 }}>{FLAG[s.flag.toUpperCase()] ?? '🌐'}</span>
                  <div style={{ flex: 1, textAlign: 'left' as const }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: isActive ? 'var(--c-orange)' : 'var(--c-text)' }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2 }}>
                      Magazin {s.key.toUpperCase()} · glamx.{s.key}
                    </div>
                  </div>
                  {isActive && (
                    <span style={{ fontSize: 22, color: 'var(--c-orange)' }}>✓</span>
                  )}
                </button>
              );
            })}
            <div style={{ height: 'env(safe-area-inset-bottom, 20px)', minHeight: 20 }} />
          </div>
        </>
      )}
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  brand: {
    display: 'flex', alignItems: 'center', gap: 8,
    textDecoration: 'none', flexShrink: 0,
  },
  logoMark: {
    width: 30, height: 30, borderRadius: 7,
    background: 'linear-gradient(135deg, #f97316, #ea580c)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 800, color: '#fff',
    boxShadow: '0 2px 8px rgba(249,115,22,.3)',
  },
  brandName: {
    fontSize: 16, fontWeight: 800, color: 'var(--c-text)', letterSpacing: '-0.3px',
  },
  storePill: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, background: 'var(--c-bg3)',
    border: '1.5px solid var(--c-border)', borderRadius: 12,
    padding: '7px 14px', cursor: 'pointer',
    maxWidth: 200, margin: '0 auto',
    transition: 'border-color 150ms, background 150ms',
  },
  storeLabel: {
    fontSize: 14, fontWeight: 700, color: 'var(--c-text)',
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    zIndex: 300, backdropFilter: 'blur(2px)',
  },
  sheet: {
    position: 'fixed', left: 0, right: 0, bottom: 0,
    background: 'var(--c-bg2)',
    borderRadius: '20px 20px 0 0',
    border: '1px solid var(--c-border)',
    boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
    zIndex: 301,
    paddingBottom: 8,
  },
  handle: {
    width: 44, height: 4, background: 'rgba(255,255,255,0.15)',
    borderRadius: 2, margin: '14px auto 12px',
  },
  sheetTitle: {
    fontSize: 13, fontWeight: 700, color: 'var(--c-text3)',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    padding: '0 20px 12px', borderBottom: '1px solid var(--c-border2)',
    marginBottom: 8,
  },
  sheetItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 16,
    padding: '16px 20px', border: 'none', cursor: 'pointer',
    transition: 'background 120ms',
  },
};
