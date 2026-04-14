'use client';
/**
 * components/layout/StoreSwitcher.tsx
 * Dropdown store switcher — used in Sidebar (desktop) and TopBar (mobile).
 * When the user switches stores, ALL React Query caches are invalidated so
 * every page refetches with the new storeId automatically.
 */

import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useShopStore, type ShopInfo } from '@/lib/store/shop-store';

const FLAG: Record<string, string> = {
  RO: '🇷🇴',
  HU: '🇭🇺',
};

function flag(f: string) {
  return FLAG[f.toUpperCase()] ?? '🌐';
}

/* ── Sidebar variant (full width) ── */
export function SidebarStoreSwitcher() {
  const { currentShop, shops, setCurrentShop } = useShopStore();
  const qc   = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref  = useRef<HTMLDivElement>(null);

  const current = shops.find(s => s.key === currentShop) ?? shops[0];
  const filtered = shops.filter(s =>
    s.label.toLowerCase().includes(search.toLowerCase()) ||
    s.key.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function switchTo(key: string) {
    setCurrentShop(key);
    setOpen(false);
    setSearch('');
    qc.invalidateQueries(); // invalidate ALL queries → auto-refetch
  }

  if (shops.length === 0) {
    return (
      <div style={{ padding: '6px 12px', fontSize: 12, color: 'var(--c-text3)' }}>
        Niciun magazin configurat
      </div>
    );
  }

  // Single shop — no switcher needed
  if (shops.length === 1) {
    return (
      <div style={styles.pill}>
        <span>{flag(current?.flag ?? '')}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{current?.label}</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button style={{ ...styles.pill, cursor: 'pointer', width: '100%' }} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{flag(current?.flag ?? '')}</span>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' as const }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', lineHeight: 1.2 }}>{current?.label ?? '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 1 }}>Magazin activ</div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--c-text3)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>▾</span>
      </button>

      {open && (
        <div style={styles.dropdown}>
          {shops.length > 3 && (
            <div style={styles.searchWrap}>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Caută magazin…"
                style={styles.searchInput}
              />
            </div>
          )}
          <div style={{ overflowY: 'auto' as const, maxHeight: 220 }}>
            {filtered.map(s => (
              <button
                key={s.key}
                style={{
                  ...styles.dropdownItem,
                  background: s.key === currentShop ? 'rgba(249,115,22,0.1)' : 'transparent',
                  color: s.key === currentShop ? 'var(--c-orange)' : 'var(--c-text)',
                }}
                onClick={() => switchTo(s.key)}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>{flag(s.flag)}</span>
                <div style={{ flex: 1, textAlign: 'left' as const }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                </div>
                {s.key === currentShop && <span style={{ fontSize: 12, color: 'var(--c-orange)' }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── TopBar compact variant (mobile) ── */
export function TopBarStoreSwitcher() {
  const { currentShop, shops, setCurrentShop } = useShopStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const current = shops.find(s => s.key === currentShop) ?? shops[0];

  function switchTo(key: string) {
    setCurrentShop(key);
    setOpen(false);
    qc.invalidateQueries();
  }

  if (!current || shops.length <= 1) {
    return (
      <span style={{ fontSize: 18 }}>{flag(current?.flag ?? 'RO')}</span>
    );
  }

  return (
    <>
      <button style={styles.topbarBtn} onClick={() => setOpen(true)}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{flag(current.flag)}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{current.label}</span>
        <span style={{ fontSize: 10, color: 'var(--c-text3)' }}>▾</span>
      </button>

      {/* Bottom sheet modal */}
      {open && (
        <>
          <div style={styles.overlay} onClick={() => setOpen(false)} />
          <div style={styles.sheet}>
            <div style={styles.sheetHandle} />
            <div style={{ padding: '4px 16px 16px', fontWeight: 700, fontSize: 15 }}>Selectează magazin</div>
            {shops.map(s => (
              <button
                key={s.key}
                style={{
                  ...styles.sheetItem,
                  background: s.key === currentShop ? 'rgba(249,115,22,0.08)' : 'transparent',
                  borderLeft: s.key === currentShop ? '3px solid var(--c-orange)' : '3px solid transparent',
                }}
                onClick={() => switchTo(s.key)}
              >
                <span style={{ fontSize: 24, lineHeight: 1 }}>{flag(s.flag)}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2 }}>Magazin {s.key.toUpperCase()}</div>
                </div>
                {s.key === currentShop && <span style={{ marginLeft: 'auto', color: 'var(--c-orange)', fontSize: 18 }}>✓</span>}
              </button>
            ))}
            <div style={{ height: 'env(safe-area-inset-bottom, 16px)' }} />
          </div>
        </>
      )}
    </>
  );
}

/* ── Styles ── */
const styles: Record<string, React.CSSProperties> = {
  pill: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px',
    background: 'var(--c-bg3)',
    border: '1px solid var(--c-border)',
    borderRadius: 10,
    transition: 'border-color 150ms',
  },
  dropdown: {
    position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
    background: 'var(--c-bg2)',
    border: '1px solid var(--c-border)',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    zIndex: 200,
    overflow: 'hidden',
  },
  searchWrap: { padding: '10px 10px 6px' },
  searchInput: {
    width: '100%', background: 'var(--c-bg3)',
    border: '1px solid var(--c-border)', borderRadius: 8,
    padding: '7px 10px', fontSize: 13, color: 'var(--c-text)', outline: 'none',
    boxSizing: 'border-box' as const,
  },
  dropdownItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', border: 'none', cursor: 'pointer',
    transition: 'background 120ms',
  },
  topbarBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'var(--c-surface)', border: '1px solid var(--c-border)',
    borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300,
  },
  sheet: {
    position: 'fixed', left: 0, right: 0, bottom: 0,
    background: 'var(--c-bg2)', borderRadius: '20px 20px 0 0',
    border: '1px solid var(--c-border)', zIndex: 301,
    paddingBottom: 8,
  },
  sheetHandle: {
    width: 40, height: 4, background: 'var(--c-border2)',
    borderRadius: 2, margin: '12px auto 16px',
  },
  sheetItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 14,
    padding: '14px 20px', border: 'none', cursor: 'pointer',
    transition: 'background 120ms',
  },
};
