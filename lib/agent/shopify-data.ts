/**
 * lib/agent/shopify-data.ts
 * Read helpers used by the AI agent and the daily report — work across ALL shops
 * configured in lib/shops.ts, using the existing tokens (no new Shopify apps).
 *
 *  - gql()          raw Admin GraphQL call for one shop (retry on throttle)
 *  - shopifyql()    ShopifyQL analytics (needs read_reports scope)
 *  - getShopStats() orders, sales, AOV, top products, funnel (sessions → ATC → IC → orders)
 *  - searchProducts(), recentOrders(), lowStock(), getLocations()
 */
import { SHOP_CONFIGS, getShopConfig } from '@/lib/shops';
import { getAccessToken } from '@/lib/shopify/ccg-token';

const API_VERSION = '2026-07';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── GraphQL ─────────────────────────────────────────────────────────────────

export async function gql<T = any>(shopKey: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const shop  = getShopConfig(shopKey);
  const token = await getAccessToken(shop);
  const url   = `https://${shop.domain}/admin/api/${API_VERSION}/graphql.json`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    });

    if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }

    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Shopify ${shop.key} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);

    if (Array.isArray(json.errors) && json.errors.length) {
      const msg = json.errors.map((e: any) => e.message).join('; ');
      if (/throttled/i.test(msg) && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
      throw new Error(`Shopify ${shop.key}: ${msg.slice(0, 400)}`);
    }
    return json.data as T;
  }
  throw new Error(`Shopify ${shop.key}: prea multe cereri (rate limit), încearcă din nou`);
}

export interface QlTable { columns: { name: string; dataType: string }[]; rows: Record<string, any>[] }

export async function shopifyql(shopKey: string, query: string): Promise<QlTable> {
  const data = await gql(shopKey, `query($q: String!) {
    shopifyqlQuery(query: $q) { tableData { columns { name dataType } rows } parseErrors }
  }`, { q: query });
  const r = data?.shopifyqlQuery;
  if (r?.parseErrors?.length) throw new Error(`ShopifyQL: ${r.parseErrors.join('; ')}`);
  return { columns: r?.tableData?.columns ?? [], rows: r?.tableData?.rows ?? [] };
}

// ─── Shop meta (timezone + currency), cached per warm instance ──────────────

export interface ShopMeta { key: string; label: string; flag: string; name: string; domain: string; currency: string; tz: string }
const metaCache = new Map<string, { at: number; meta: ShopMeta }>();

export async function getShopMeta(shopKey: string): Promise<ShopMeta> {
  const hit = metaCache.get(shopKey);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.meta;
  const cfg  = getShopConfig(shopKey);
  const data = await gql(shopKey, `{ shop { name currencyCode ianaTimezone primaryDomain { host } } }`);
  const meta: ShopMeta = {
    key: cfg.key, label: cfg.label, flag: cfg.flag,
    name:     data.shop.name?.trim() || cfg.label,
    domain:   data.shop.primaryDomain?.host || cfg.domain,
    currency: data.shop.currencyCode,
    tz:       data.shop.ianaTimezone || 'Europe/Bucharest',
  };
  metaCache.set(shopKey, { at: Date.now(), meta });
  return meta;
}

export function listShops() {
  return SHOP_CONFIGS.map(s => ({ key: s.key, label: s.label, flag: s.flag, domain: s.domain }));
}

/** Accepts ["all"], undefined, or shop keys; also matches by label/domain fragment ("glato.ro"). */
export function resolveShopKeys(input?: string[] | string): string[] {
  const all = SHOP_CONFIGS.map(s => s.key);
  const list = (Array.isArray(input) ? input : input ? [input] : []).map(s => String(s).toLowerCase().trim());
  if (!list.length || list.includes('all') || list.includes('toate')) return all;
  const out = new Set<string>();
  for (const q of list) {
    const m = SHOP_CONFIGS.find(s => s.key === q)
      || SHOP_CONFIGS.find(s => s.label.toLowerCase() === q)
      || SHOP_CONFIGS.find(s => s.domain.toLowerCase().includes(q.replace(/^https?:\/\//, '')));
    if (m) out.add(m.key);
  }
  if (!out.size) throw new Error(`Magazin necunoscut: ${list.join(', ')}. Disponibile: ${all.join(', ')}`);
  return Array.from(out);
}

// ─── Dates in the shop's own timezone ────────────────────────────────────────

export function localDate(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
}

function tzOffsetMs(ts: number, tz: string): number {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ts)) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** UTC epoch ms of local midnight of `date` (YYYY-MM-DD) in `tz`. DST-safe. */
export function dayStartUtc(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type Period = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

export function resolveRange(period: Period, tz: string, from?: string, to?: string): { from: string; to: string } {
  const today = localDate(Date.now(), tz);
  switch (period) {
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case '7d':        return { from: addDays(today, -6), to: today };
    case '30d':       return { from: addDays(today, -29), to: today };
    case 'month':     return { from: today.slice(0, 8) + '01', to: today };
    case 'custom':
      if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('Pentru period=custom dă from=YYYY-MM-DD');
      return { from, to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : from };
    default:          return { from: today, to: today };
  }
}

// ─── Orders in a date range ──────────────────────────────────────────────────

interface RawOrder {
  id: string; name: string; createdAt: string; cancelledAt: string | null; test: boolean;
  displayFinancialStatus: string; displayFulfillmentStatus: string; paymentGatewayNames: string[];
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { nodes: { title: string; quantity: number; originalTotalSet: { shopMoney: { amount: string } } }[] };
}

async function fetchOrdersInRange(shopKey: string, startIso: string, endIso: string, maxPages = 10): Promise<RawOrder[]> {
  const out: RawOrder[] = [];
  let after: string | null = null;
  const search = `created_at:>='${startIso}' AND created_at:<'${endIso}'`;
  for (let page = 0; page < maxPages; page++) {
    const data: any = await gql(shopKey, `query($q: String!, $after: String) {
      orders(first: 50, after: $after, query: $q, sortKey: CREATED_AT) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id name createdAt cancelledAt test displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 20) { nodes { title quantity originalTotalSet { shopMoney { amount } } } }
        }
      }
    }`, { q: search, after });
    out.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return out;
}

// ─── Stats for one shop ──────────────────────────────────────────────────────

export interface Funnel { sessions: number; atc: number; ic: number; completed: number; conversionRate: number }
export interface ShopStats {
  shop: string; label: string; flag: string; name: string; domain: string; currency: string;
  range: { from: string; to: string };
  orders: number; cancelled: number; sales: number; aov: number; codOrders: number;
  topProducts: { title: string; qty: number; revenue: number }[];
  funnel: Funnel | null; funnelError?: string;
  error?: string;
}

const num = (v: any) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export async function getFunnel(shopKey: string, from: string, to: string): Promise<Funnel> {
  const t = await shopifyql(shopKey,
    `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, conversion_rate SINCE ${from} UNTIL ${to}`);
  const r = t.rows[0] || {};
  return {
    sessions:       num(r.sessions),
    atc:            num(r.sessions_with_cart_additions),
    ic:             num(r.sessions_that_reached_checkout),
    completed:      num(r.sessions_that_completed_checkout),
    conversionRate: num(r.conversion_rate),
  };
}

export async function getShopStats(shopKey: string, period: Period = 'today', from?: string, to?: string): Promise<ShopStats> {
  const cfg = getShopConfig(shopKey);
  const base = { shop: cfg.key, label: cfg.label, flag: cfg.flag, name: cfg.label, domain: cfg.domain, currency: '' };
  try {
    const meta  = await getShopMeta(shopKey);
    const range = resolveRange(period, meta.tz, from, to);
    const start = new Date(dayStartUtc(range.from, meta.tz)).toISOString();
    const end   = new Date(dayStartUtc(addDays(range.to, 1), meta.tz)).toISOString();

    const [orders, funnelRes] = await Promise.all([
      fetchOrdersInRange(shopKey, start, end),
      getFunnel(shopKey, range.from, range.to).then(f => ({ f }), (e: Error) => ({ e: e.message })),
    ]);

    const live = orders.filter(o => !o.cancelledAt && !o.test);
    const sales = live.reduce((s, o) => s + num(o.totalPriceSet.shopMoney.amount), 0);
    const prod = new Map<string, { title: string; qty: number; revenue: number }>();
    for (const o of live) for (const li of o.lineItems.nodes) {
      const p = prod.get(li.title) || { title: li.title, qty: 0, revenue: 0 };
      p.qty += li.quantity; p.revenue += num(li.originalTotalSet.shopMoney.amount);
      prod.set(li.title, p);
    }

    return {
      ...base, name: meta.name, domain: meta.domain, currency: meta.currency, range,
      orders:    live.length,
      cancelled: orders.filter(o => o.cancelledAt).length,
      sales:     Math.round(sales * 100) / 100,
      aov:       live.length ? Math.round((sales / live.length) * 100) / 100 : 0,
      codOrders: live.filter(o => o.paymentGatewayNames.some(g => /cash|cod|ramburs|utánvét/i.test(g))).length,
      topProducts: Array.from(prod.values()).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 5),
      funnel:      'f' in funnelRes ? funnelRes.f : null,
      funnelError: 'e' in funnelRes ? scopeHint(funnelRes.e) : undefined,
    };
  } catch (e: any) {
    return { ...base, range: { from: from || '', to: to || '' }, orders: 0, cancelled: 0, sales: 0, aov: 0, codOrders: 0,
      topProducts: [], funnel: null, error: scopeHint(e.message) };
  }
}

function scopeHint(msg: string): string {
  if (/read_reports|shopifyqlQuery/i.test(msg) && /access/i.test(msg))
    return 'Lipsește permisiunea read_reports în aplicația Shopify a acestui magazin (necesară pentru sesiuni/ATC/IC).';
  return msg;
}

// ─── Products, orders, stock, locations ──────────────────────────────────────

export async function searchProducts(shopKey: string, query: string, limit = 8) {
  const data = await gql(shopKey, `query($q: String!, $n: Int!) {
    products(first: $n, query: $q) { nodes {
      id title handle status totalInventory onlineStoreUrl
      variants(first: 30) { nodes { id title sku price compareAtPrice inventoryQuantity inventoryItem { id tracked } } }
    } }
  }`, { q: query, n: Math.min(limit, 20) });
  return data.products.nodes.map((p: any) => ({
    id: p.id, title: p.title, handle: p.handle, status: p.status, totalInventory: p.totalInventory, url: p.onlineStoreUrl,
    variants: p.variants.nodes.map((v: any) => ({
      id: v.id, title: v.title, sku: v.sku, price: v.price, compareAtPrice: v.compareAtPrice,
      inventory: v.inventoryQuantity, inventoryItemId: v.inventoryItem?.id, tracked: v.inventoryItem?.tracked,
    })),
  }));
}

export async function recentOrders(shopKey: string, limit = 10, query?: string) {
  const data = await gql(shopKey, `query($n: Int!, $q: String) {
    orders(first: $n, sortKey: CREATED_AT, reverse: true, query: $q) { nodes {
      name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 10) { nodes { title quantity } }
    } }
  }`, { n: Math.min(limit, 50), q: query || null });
  return data.orders.nodes.map((o: any) => ({
    name: o.name, createdAt: o.createdAt, cancelled: !!o.cancelledAt,
    financial: o.displayFinancialStatus, fulfillment: o.displayFulfillmentStatus, payment: o.paymentGatewayNames.join(', '),
    total: `${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}`,
    items: o.lineItems.nodes.map((l: any) => `${l.quantity}× ${l.title}`).join('; '),
  }));
}

export async function lowStock(shopKey: string, threshold = 5) {
  const data = await gql(shopKey, `{
    products(first: 40, query: "status:active", sortKey: INVENTORY_TOTAL) { nodes {
      title variants(first: 20) { nodes { title sku inventoryQuantity inventoryItem { tracked } } }
    } }
  }`);
  const out: { product: string; variant: string; sku: string | null; qty: number }[] = [];
  for (const p of data.products.nodes) for (const v of p.variants.nodes) {
    if (v.inventoryItem?.tracked && (v.inventoryQuantity ?? 0) <= threshold)
      out.push({ product: p.title, variant: v.title, sku: v.sku, qty: v.inventoryQuantity ?? 0 });
  }
  return out.sort((a, b) => a.qty - b.qty).slice(0, 25);
}

export async function getLocations(shopKey: string) {
  const data = await gql(shopKey, `{ locations(first: 10) { nodes { id name isActive } } }`);
  return data.locations.nodes;
}
