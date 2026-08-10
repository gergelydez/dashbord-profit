/**
 * lib/shopify/ccg-token.ts
 * Resolves a usable Shopify Admin API access token per shop.
 *
 * Legacy shops (RO/HU) have a permanent token straight from env — returned as-is,
 * no network call, zero behavior change from before this file existed.
 *
 * Shops created via Shopify's Dev Dashboard (post Jan-2026, e.g. glato) only get a
 * Client ID + Client Secret — no static token. We exchange those for a short-lived
 * (24h) access token via the OAuth Client Credentials Grant and cache it in memory
 * until shortly before it expires, so callers can just `await getAccessToken(shop)`
 * without worrying about refresh timing.
 */
import { SHOP_CONFIGS, type ShopConfig } from '@/lib/shops';

interface CachedToken {
  token:     string;
  expiresAt: number; // epoch ms
}

// Module-level cache — persists for the lifetime of a warm serverless instance.
// A cold start just means one extra token-exchange call; no correctness issue.
const tokenCache = new Map<string, CachedToken>();
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before actual expiry

async function fetchTokenViaClientCredentials(shop: ShopConfig): Promise<CachedToken> {
  const res = await fetch(`https://${shop.domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     shop.clientId!,
      client_secret: shop.clientSecret!,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify token exchange failed for shop "${shop.key}" (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error(`Shopify token exchange for shop "${shop.key}" returned no access_token`);
  }

  return {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 86399) * 1000,
  };
}

/** Returns a valid Admin API access token for the given shop, refreshing it if needed. */
export async function getAccessToken(shop: ShopConfig): Promise<string> {
  // Legacy permanent token (RO/HU today) — nothing to refresh.
  if (shop.accessToken) return shop.accessToken;

  if (!shop.clientId || !shop.clientSecret) {
    throw new Error(`Shop "${shop.key}" has no accessToken and no client_id/client_secret configured.`);
  }

  const cached = tokenCache.get(shop.key);
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cached.token;
  }

  const fresh = await fetchTokenViaClientCredentials(shop);
  tokenCache.set(shop.key, fresh);
  return fresh.token;
}

/**
 * Same as getAccessToken but looks the shop up by Shopify domain — used where only
 * the domain is known (e.g. a Shop row read back from the DB).
 */
export async function getAccessTokenForDomain(domain: string): Promise<string> {
  const shop = SHOP_CONFIGS.find(s => s.domain === domain);
  if (!shop) throw new Error(`No shop configured for domain "${domain}"`);
  return getAccessToken(shop);
}
