'use client';
/**
 * components/layout/BottomNav.tsx
 * Mobile bottom navigation — visible on all pages on < 1024px screens.
 * Active state via usePathname(). Store badge shows current shop.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useShopStore } from '@/lib/store/shop-store';

const FLAG: Record<string, string> = { RO: '🇷🇴', HU: '🇭🇺' };

const NAV_ITEMS = [
  { href: '/',                   icon: '📦', label: 'Comenzi' },
  { href: '/xconnector',         icon: '⚡', label: 'xConnector' },
  { href: '/gls',                icon: '🏷️', label: 'GLS' },
  { href: '/stats',              icon: '📊', label: 'Stats' },
  { href: '/profit',             icon: '💹', label: 'Profit' },
  { href: '/import',             icon: '🚢', label: 'Import' },
  { href: '/sales-engine-pro',   icon: '💰', label: 'Sales' },
  { href: '/whatsapp',           icon: '📱', label: 'Chat' },
];

export function BottomNav() {
  const pathname   = usePathname();
  const { currentShop, shops } = useShopStore();
  const shopInfo   = shops.find(s => s.key === currentShop);

  return (
    <nav className="bottom-nav" aria-label="Navigare principală">
      {/* Store indicator strip */}
      {shops.length > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          gap: 4, padding: '4px 0 2px',
          fontSize: 10, color: 'var(--c-text3)',
          borderTop: '1px solid var(--c-border2)',
          background: 'var(--c-bg2)',
        }}>
          <span style={{ fontSize: 13 }}>{FLAG[shopInfo?.flag ?? 'RO'] ?? '🌐'}</span>
          <span style={{ fontWeight: 600, color: 'var(--c-orange)' }}>{shopInfo?.label ?? currentShop.toUpperCase()}</span>
          <span style={{ opacity: 0.5 }}>activ</span>
        </div>
      )}

      {/* Nav items */}
      <div className="bottom-nav-items">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`bn-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="bn-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
