/**
 * lib/shops.ts
 * Multi-shop registry — reads from env vars.
 * RO:    SHOPIFY_DOMAIN / SHOPIFY_ACCESS_TOKEN (backwards-compatible, permanent token)
 * HU:    SHOPIFY_DOMAIN_HU / SHOPIFY_ACCESS_TOKEN_HU (permanent token)
 * GLATO: SHOPIFY_DOMAIN_GLATO + either
 *          - SHOPIFY_ACCESS_TOKEN_GLATO (permanent token), or
 *          - SHOPIFY_CLIENT_ID_GLATO / SHOPIFY_CLIENT_SECRET_GLATO — apps created via
 *            Shopify's Dev Dashboard (post Jan-2026) only issue short-lived (24h) tokens,
 *            so we exchange these for a token on demand via lib/shopify/ccg-token.ts
 *            instead of storing a static accessToken.
 */

export type ShopKey = 'ro' | 'hu' | 'glato';

export interface ShopConfig {
  key:           ShopKey;
  label:         string;
  flag:          string;
  domain:        string;
  accessToken:   string;   // '' when the shop uses clientId/clientSecret instead
  clientId?:     string;
  clientSecret?: string;
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
  {
    key:          'glato',
    label:        'Glato',
    flag:         'GLATO',
    domain:       process.env.SHOPIFY_DOMAIN_GLATO       || '',
    accessToken:  process.env.SHOPIFY_ACCESS_TOKEN_GLATO || '',
    clientId:     process.env.SHOPIFY_CLIENT_ID_GLATO     || '',
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET_GLATO || '',
  },
].filter(s => s.domain && (s.accessToken || (s.clientId && s.clientSecret))) as ShopConfig[];

export function getShopConfig(key: string): ShopConfig {
  const shop = SHOP_CONFIGS.find(s => s.key === key);
  if (!shop) throw new Error(`Shop config not found: ${key}. Check env vars.`);
  return shop;
}

export function getDefaultShopKey(): ShopKey {
  return SHOP_CONFIGS[0]?.key ?? 'ro';
}
