/**
 * lib/shops.ts
 * Multi-shop registry — reads from env vars.
 * RO: SHOPIFY_DOMAIN / SHOPIFY_ACCESS_TOKEN (backwards-compatible)
 * HU: SHOPIFY_DOMAIN_HU / SHOPIFY_ACCESS_TOKEN_HU
 */

export type ShopKey = 'ro' | 'hu';

export interface ShopConfig {
  key:         ShopKey;
  label:       string;
  flag:        string;
  domain:      string;
  accessToken: string;
}

export const SHOP_CONFIGS: ShopConfig[] = [
  {
    key:         'ro',
    label:       'Romania',
    flag:        'RO',
    domain:      process.env.SHOPIFY_DOMAIN_RO      || process.env.SHOPIFY_DOMAIN       || '',
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN_RO || process.env.SHOPIFY_ACCESS_TOKEN || '',
  },
  {
    key:         'hu',
    label:       'Ungaria',
    flag:        'HU',
    domain:      process.env.SHOPIFY_DOMAIN_HU       || '',
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN_HU || '',
  },
].filter(s => s.domain && s.accessToken) as ShopConfig[];

export function getShopConfig(key: string): ShopConfig {
  const shop = SHOP_CONFIGS.find(s => s.key === key);
  if (!shop) throw new Error(`Shop config not found: ${key}. Check env vars.`);
  return shop;
}

export function getDefaultShopKey(): ShopKey {
  return SHOP_CONFIGS[0]?.key ?? 'ro';
}
