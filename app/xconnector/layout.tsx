'use client';
/**
 * app/xconnector/layout.tsx
 * xConnector sub-layout — QueryClient is now provided by root layout (Providers).
 * This layout is kept as a thin wrapper for future route-level config.
 */
export default function XConnectorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
