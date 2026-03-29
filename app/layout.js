import './globals.css';
import SwipeNavigator from './SwipeNavigator';

export const metadata = {
  title: 'GLAMX Dashboard',
  description: 'Dashboard comenzi GLAMX - Shopify Live',
  manifest: '/manifest.json',
};

export const viewport = {
  themeColor: '#f97316',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
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
        <div
          id="page-wrap"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            minHeight: '100dvh',
          }}
        >
          {children}
        </div>
        <SwipeNavigator />
        {/* Bottom Navigation — vizibil doar pe mobile prin CSS */}
        <nav className="bottom-nav">
          <div className="bottom-nav-items">
            <a href="/" className="bn-item">
              <span>📦</span>
              <span>Comenzi</span>
            </a>
            <a href="/whatsapp" className="bn-item">
              <span>📱</span>
              <span>WhatsApp</span>
            </a>
            <a href="/stats" className="bn-item">
              <span>📊</span>
              <span>Statistici</span>
            </a>
            <a href="/import" className="bn-item">
              <span>🚢</span>
              <span>Import</span>
            </a>
            <a href="/profit" className="bn-item">
              <span>💹</span>
              <span>Profit</span>
            </a>
          </div>
        </nav>
      </body>
    </html>
  );
}
