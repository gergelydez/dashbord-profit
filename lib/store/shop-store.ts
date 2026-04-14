/**
 * lib/store/shop-store.ts
 * Global Zustand store for multi-shop context.
 * Persists currentShop to localStorage so selections survive page reloads.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ShopInfo {
  key:   string;
  label: string;
  flag:  string;
}

interface ShopStore {
  currentShop: string;
  shops:       ShopInfo[];
  hydrated:    boolean;
  setCurrentShop: (key: string) => void;
  setShops:       (shops: ShopInfo[]) => void;
  setHydrated:    (v: boolean) => void;
}

export const useShopStore = create<ShopStore>()(
  persist(
    (set) => ({
      currentShop:    'ro',
      shops:          [],
      hydrated:       false,
      setCurrentShop: (key)   => set({ currentShop: key }),
      setShops:       (shops) => set({ shops }),
      setHydrated:    (v)     => set({ hydrated: v }),
    }),
    {
      name:        'glamx-shop',
      partialize:  (state) => ({ currentShop: state.currentShop }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);
