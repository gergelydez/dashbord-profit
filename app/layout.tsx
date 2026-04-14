/**
 * app/layout.tsx — Root layout
 * Wraps all pages with:
 *  - React Query + Zustand providers
 *  - Desktop sidebar (≥1024px)
 *  - Mobile top bar + bottom nav (<1024px)
 */
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';

export const metadata: Metadata = {
  title: 'GLAMX Dashboard',
  description: 'Dashboard comenzi GLAMX - Shopify Live',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#f97316',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#f97316" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="GLAMX" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>
        <Providers>
          <div className="root-layout">
            {/* Desktop sidebar — hidden on mobile via CSS */}
            <Sidebar />

            {/* Main content area */}
            <div className="main-area">
              {/* Mobile top bar — hidden on desktop via CSS */}
              <TopBar />

              {/* Page content */}
              <main id="page-wrap" style={{ minHeight: '100dvh' }}>
                {children}
              </main>
            </div>
          </div>

          {/* Mobile bottom nav — hidden on desktop */}
          <nav className="bottom-nav">
            <div className="bottom-nav-items">
              <a href="/" className="bn-item">
                <span className="bn-icon">📦</span>
                <span>Comenzi</span>
              </a>
              <a href="/xconnector" className="bn-item">
                <span className="bn-icon">⚡</span>
                <span>Connector</span>
              </a>
              <a href="/stats" className="bn-item">
                <span className="bn-icon">📊</span>
                <span>Statistici</span>
              </a>
              <a href="/whatsapp" className="bn-item">
                <span className="bn-icon">📱</span>
                <span>WhatsApp</span>
              </a>
              <a href="/profit" className="bn-item">
                <span className="bn-icon">💹</span>
                <span>Profit</span>
              </a>
              <a href="/sales-engine-pro" className="bn-item">
                <span className="bn-icon">🤖</span>
                <span>Sales AI</span>
              </a>
            </div>
          </nav>
        </Providers>
      </body>
    </html>
  );
}
