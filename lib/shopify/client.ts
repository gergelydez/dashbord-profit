/**
 * lib/shopify/client.ts — Shopify Admin API client
 *
 * Wraps both REST and GraphQL calls.
 * Rate-limit aware: on 429 it waits for Retry-After and retries once.
 */

import { logger } from '@/lib/logger';

const API_VERSION = '2026-07';

export interface ShopifyClientOptions {
  domain: string;       // e.g. "your-store.myshopify.com"
  accessToken: string;  // Shopify Admin API access token
}

// ─── Generic fetch with retry on 429 ─────────────────────────────────────────

async function shopifyFetch(
  url: string,
  options: RequestInit,
  log: ReturnType<typeof logger.child>,
): Promise<Response> {
  let res = await fetch(url, { ...options, cache: 'no-store' });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '2', 10);
    log.warn('Rate limited by Shopify, retrying', { retryAfter });
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    res = await fetch(url, { ...options, cache: 'no-store' });
  }

  return res;
}

// ─── REST helpers ─────────────────────────────────────────────────────────────

export function buildRestUrl(domain: string, path: string): string {
  return `https://${domain}/admin/api/${API_VERSION}/${path}`;
}

export function buildHeaders(accessToken: string): Record<string, string> {
  return {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// ─── Order fetching ───────────────────────────────────────────────────────────

export interface ShopifyLineItem {
  id: number;
  name: string;
  quantity: number;
  price: string;
  sku: string | null;
  variant_id: number | null;
  product_id: number | null;
}

export interface ShopifyAddress {
  name:           string;
  address1:       string;
  address2:       string | null;
  city:           string;
  province:       string;   // Romanian judet
  province_code:  string;
  zip:            string;
  country:        string;
  country_code:   string;
  phone:          string | null;
}

export interface ShopifyOrder {
  id:                     number;
  name:                   string;   // "#1042"
  admin_graphql_api_id:   string;   // "gid://shopify/Order/..."
  email:                  string;
  phone:                  string | null;
  financial_status:       string;
  fulfillment_status:     string | null;
  payment_gateway:        string;
  total_price:            string;
  currency:               string;
  created_at:             string;
  cancelled_at:           string | null;
  note_attributes:        Array<{ name: string; value: string }>;
  tags:                   string;
  shipping_address:       ShopifyAddress | null;
  billing_address:        ShopifyAddress | null;
  line_items:             ShopifyLineItem[];
  fulfillments:           Array<{
    id: number;
    admin_graphql_api_id: string;
    status: string;
    tracking_number: string | null;
    tracking_company: string | null;
  }>;
}

/**
 * Fetch a single Shopify order by its numeric ID.
 */
export async function fetchShopifyOrder(
  opts: ShopifyClientOptions,
  orderId: string | number,
): Promise<ShopifyOrder> {
  const log = logger.child({ module: 'shopify/client', orderId });
  const url = buildRestUrl(opts.domain, `orders/${orderId}.json`);
  const headers = buildHeaders(opts.accessToken);

  const res = await shopifyFetch(url, { method: 'GET', headers }, log);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GET order ${orderId} → ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.order as ShopifyOrder;
}

// ─── Order note_attributes update ────────────────────────────────────────────

/**
 * Merge new note_attributes into a Shopify order, preserving existing ones.
 * Overwrites any key that already exists in the new entries.
 */
export async function updateOrderAttributes(
  opts: ShopifyClientOptions,
  orderId: string | number,
  newAttributes: Array<{ name: string; value: string }>,
  newTags?: string[],
): Promise<void> {
  const log = logger.child({ module: 'shopify/client', orderId });
  const url = buildRestUrl(opts.domain, `orders/${orderId}.json`);
  const headers = buildHeaders(opts.accessToken);

  // Read current state first
  const currentRes = await shopifyFetch(
    `${url}?fields=note_attributes,tags`,
    { method: 'GET', headers },
    log,
  );
  if (!currentRes.ok) {
    log.warn('Could not fetch current order attributes', { status: currentRes.status });
    return;
  }
  const { order } = await currentRes.json();

  // Merge attributes (new ones override old with same name)
  const newKeys = new Set(newAttributes.map((a) => a.name.toLowerCase()));
  const existing: Array<{ name: string; value: string }> = (
    order.note_attributes ?? []
  ).filter((a: { name: string }) => !newKeys.has(a.name.toLowerCase()));
  const merged = [...existing, ...newAttributes];

  // Merge tags
  const body: Record<string, unknown> = { id: orderId, note_attributes: merged };
  if (newTags?.length) {
    const existingTags = (order.tags ?? '')
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean) as string[];
    const allTags = Array.from(new Set([...existingTags, ...newTags]));
    body.tags = allTags.join(', ');
  }

  const res = await shopifyFetch(
    url,
    { method: 'PUT', headers, body: JSON.stringify({ order: body }) },
    log,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify PUT order attributes → ${res.status}: ${text.slice(0, 300)}`);
  }

  log.info('Order attributes updated', { keys: newAttributes.map((a) => a.name) });
}

// ─── GraphQL ─────────────────────────────────────────────────────────────────

export async function shopifyGraphQL<T = unknown>(
  opts: ShopifyClientOptions,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const log = logger.child({ module: 'shopify/graphql' });
  const url = `https://${opts.domain}/admin/api/${API_VERSION}/graphql.json`;

  const res = await shopifyFetch(
    url,
    {
      method: 'POST',
      headers: buildHeaders(opts.accessToken),
      body: JSON.stringify({ query, variables }),
    },
    log,
  );

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };

  if (!res.ok || json.errors?.length) {
    const errMsg = json.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new Error(`Shopify GraphQL error: ${errMsg}`);
  }

  return json.data!;
}
