'use client';
/**
 * components/layout/Sidebar.tsx
 * Desktop left sidebar — visible only on ≥1024px screens.
 * Contains: brand, store switcher, navigation links.
 */

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SidebarStoreSwitcher } from './StoreSwitcher';

const NAV = [
  { href: '/',                icon: '📦', label: 'Comenzi' },
  { href: '/xconnector',      icon: '⚡', label: 'xConnector' },
  { href: '/fulfillment',     icon: '🚚', label: 'Fulfillment' },
  { href: '/stats',           icon: '📊', label: 'Statistici' },
  { href: '/profit',          icon: '💹', label: 'Profit' },
  { href: '/whatsapp',        icon: '📱', label: 'WhatsApp' },
  { href: '/import',          icon: '🚢', label: 'Import' },
  { href: '/sales-engine-pro',icon: '🤖', label: 'Sales AI' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {/* ── Brand ── */}
      <div style={S.brand}>
        <div style={S.logoMark}>G</div>
        <div>
          <div style={S.brandName}>GLAMX</div>
          <div style={S.brandSub}>Dashboard</div>
        </div>
      </div>

      {/* ── Store Switcher ── */}
      <div style={S.switcherWrap}>
        <SidebarStoreSwitcher />
      </div>

      {/* ── Navigation ── */}
      <nav style={S.nav}>
        <div style={S.navLabel}>Navigare</div>
        {NAV.map(item => {
          const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                ...S.navLink,
                background: active ? 'rgba(249,115,22,0.1)' : 'transparent',
                color:      active ? 'var(--c-orange)' : 'var(--c-text2)',
                borderLeft: active ? '3px solid var(--c-orange)' : '3px solid transparent',
              }}
            >
              <span style={S.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Footer ── */}
      <div style={S.footer}>
        <div style={{ fontSize: 11, color: 'var(--c-text4)' }}>xConnector v2.0</div>
        <div style={{ fontSize: 11, color: 'var(--c-text4)', marginTop: 2 }}>GLAMX SaaS Platform</div>
      </div>
    </aside>
  );
}

const S: Record<string, React.CSSProperties> = {
  brand: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '18px 16px 14px',
    borderBottom: '1px solid var(--c-border2)',
  },
  logoMark: {
    width: 34, height: 34, borderRadius: 8,
    background: 'linear-gradient(135deg, #f97316, #ea580c)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0,
    boxShadow: '0 2px 8px rgba(249,115,22,0.35)',
  },
  brandName: { fontSize: 15, fontWeight: 800, color: 'var(--c-text)', letterSpacing: '-0.3px' },
  brandSub:  { fontSize: 10, color: 'var(--c-text3)', marginTop: 1 },
  switcherWrap: { padding: '12px 12px 8px' },
  nav:    { flex: 1, padding: '8px 8px', overflowY: 'auto' as const },
  navLabel: { fontSize: 10, fontWeight: 700, color: 'var(--c-text4)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, padding: '6px 8px 8px' },
  navLink: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 10px', borderRadius: 8,
    fontSize: 13, fontWeight: 500, textDecoration: 'none',
    transition: 'all 120ms', cursor: 'pointer',
    marginBottom: 2,
  },
  navIcon: { fontSize: 16, width: 20, textAlign: 'center' as const, flexShrink: 0 },
  footer: {
    padding: '12px 16px',
    borderTop: '1px solid var(--c-border2)',
  },
};
