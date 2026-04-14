'use client';
/**
 * components/providers.tsx
 * Root providers: React Query + global shop initializer.
 * Placed in root layout so ALL pages share one QueryClient + one shop state.
 */

import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useShopStore } from '@/lib/store/shop-store';

/* Fetches /api/connector/shops once on mount and seeds the Zustand store. */
function ShopLoader() {
  const { setShops, shops } = useShopStore();

  useEffect(() => {
    if (shops.length > 0) return; // already loaded
    fetch('/api/connector/shops')
      .then(r => r.json())
      .then(d => { if (d.shops?.length) setShops(d.shops); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ShopLoader />
      {children}
    </QueryClientProvider>
  );
}
