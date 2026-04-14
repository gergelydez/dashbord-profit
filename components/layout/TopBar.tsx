'use client';
/**
 * components/layout/TopBar.tsx
 * Mobile-first top bar — hidden on desktop (sidebar handles navigation there).
 * Contains: brand, store switcher (compact), search trigger.
 */

import Link from 'next/link';
import { TopBarStoreSwitcher } from './StoreSwitcher';

export function TopBar() {
  return (
    <header className="topbar-global">
      {/* Brand */}
      <Link href="/" style={S.brand}>
        <div style={S.logoMark}>G</div>
        <span style={S.brandName}>GLAMX</span>
      </Link>

      {/* Store switcher — compact */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <TopBarStoreSwitcher />
      </div>

      {/* Right slot (reserved for future: notifications, user) */}
      <div style={{ width: 40 }} />
    </header>
  );
}

const S: Record<string, React.CSSProperties> = {
  brand: {
    display: 'flex', alignItems: 'center', gap: 8,
    textDecoration: 'none', flexShrink: 0,
  },
  logoMark: {
    width: 28, height: 28, borderRadius: 6,
    background: 'linear-gradient(135deg, #f97316, #ea580c)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 800, color: '#fff',
  },
  brandName: { fontSize: 15, fontWeight: 800, color: 'var(--c-text)', letterSpacing: '-0.3px' },
};
