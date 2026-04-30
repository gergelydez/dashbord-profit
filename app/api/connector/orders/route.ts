/**
 * app/api/connector/orders/route.ts
 * Lists Shopify orders enriched with DB state (invoice + shipment).
 * Uses REST API (not GraphQL) to avoid Shopify's "Customer object" PII restriction.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { buildInvoiceUrl, buildShippingLabelUrl } from '@/lib/security/tokens';
import { getShopConfig, getDefaultShopKey } from '@/lib/shops';

const API_VERSION = '2026-07';

/* ── Shopify REST fetch ── */
async function fetchShopifyOrders(
  domain: string,
  token: string,
  pageInfo: string | null,
  filters: { search?: string; createdMin?: string; financialStatus?: string },
) {
  const params = new URLSearchParams({ limit: '50', status: 'any' });

  if (pageInfo) {
    // Cursor pagination — only page_info is allowed alongside limit
    params.set('page_info', pageInfo);
  } else {
    if (filters.createdMin)   params.set('created_at_min', `${filters.createdMin}T00:00:00Z`);
    if (filters.financialStatus && filters.financialStatus !== 'all')
      params.set('financial_status', filters.financialStatus);
    if (filters.search) {
      // REST supports name search with exact # prefix
      const q = filters.search.startsWith('#') ? filters.search : `#${filters.search}`;
      params.set('name', q);
    }
    params.set('order', 'created_at desc');
  }

  const url = `https://${domain}/admin/api/${API_VERSION}/orders.json?${params}`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Shopify orders ${res.status}: ${await res.text()}`);

  const { orders } = await res.json();

  // Parse Link header for cursor pagination
  const link = res.headers.get('Link') || '';
  const nextMatch = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
  const prevMatch = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="previous"/);

  return {
    orders,
    pageInfo: {
      hasNextPage: !!nextMatch,
      endCursor:   nextMatch ? nextMatch[1] : null,
      hasPrevPage: !!prevMatch,
      prevCursor:  prevMatch ? prevMatch[1] : null,
    },
  };
}

/* ── Enrich with DB state ── */
async function enrichWithDbState(shopifyIds: string[], domain: string) {
  if (!shopifyIds.length) return { invoices: {}, shipments: {}, orders: {} };

  const shop = await db.shop.findFirst({ where: { domain } });
  if (!shop) return { invoices: {}, shipments: {}, orders: {} };

  const [dbOrders, invoices, shipments] = await Promise.all([
    db.order.findMany({
      where: { shopId: shop.id, shopifyId: { in: shopifyIds } },
      select: {
        id: true, shopifyId: true, status: true, processingError: true,
        customerName: true, customerEmail: true, customerPhone: true,
        shippingAddress1: true, shippingAddress2: true,
        shippingCity: true, shippingProvince: true, shippingZip: true,
      },
    }),
    db.invoice.findMany({
      where: { shopId: shop.id, order: { shopifyId: { in: shopifyIds } } },
      include: { order: { select: { shopifyId: true } } },
    }),
    db.shipment.findMany({
      where: { shopId: shop.id, order: { shopifyId: { in: shopifyIds } } },
      include: { order: { select: { shopifyId: true } } },
    }),
  ]);

  const orderMap: Record<string, {
    id: string; status: string; error?: string | null;
    customerName: string; customerEmail: string; customerPhone: string;
    address1: string; address2: string; city: string; province: string; zip: string;
  }> = {};
  for (const o of dbOrders) orderMap[o.shopifyId] = {
    id: o.id, status: o.status, error: o.processingError,
    customerName: o.customerName, customerEmail: o.customerEmail, customerPhone: o.customerPhone,
    address1: o.shippingAddress1, address2: o.shippingAddress2,
    city: o.shippingCity, province: o.shippingProvince, zip: o.shippingZip,
  };

  const invMap: Record<string, { id: string; series: string; number: string; status: string; url: string }> = {};
  for (const inv of invoices) {
    const sid = inv.order.shopifyId;
    if (!invMap[sid]) invMap[sid] = { id: inv.id, series: inv.series, number: inv.number, status: inv.status, url: buildInvoiceUrl(inv.id) };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const shipMap: Record<string, { id: string; courier: string; tracking: string; trackingUrl: string | null; labelUrl: string; status: string }> = {};
  for (const s of shipments) {
    const sid = s.order.shopifyId;
    // Use direct proxy URL (no token needed) — works in browser and iframe
    const labelUrl = `/api/connector/awb-label?id=${s.id}`;
    if (!shipMap[sid]) shipMap[sid] = { id: s.id, courier: s.courier, tracking: s.trackingNumber, trackingUrl: s.trackingUrl, labelUrl, status: s.status };
  }

  return { invoices: invMap, shipments: shipMap, orders: orderMap };
}

/* ── Map REST order → EnrichedOrder ── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOrder(o: any, enriched: Awaited<ReturnType<typeof enrichWithDbState>>) {
  const numId  = String(o.id);
  const addr   = o.shipping_address || o.billing_address || {};
  const dbOrder  = enriched.orders[numId];
  const invoice  = enriched.invoices[numId] ?? null;
  const shipment = enriched.shipments[numId] ?? null;

  const fin = (o.financial_status || '').toLowerCase();
  const ful = (o.fulfillment_status || '').toLowerCase();

  let procStatus = 'pending';
  if (o.cancelled_at)                   procStatus = 'cancelled';
  else if (dbOrder?.status === 'FAILED') procStatus = 'failed';
  else if (invoice && shipment)          procStatus = 'fulfilled';
  else if (invoice || shipment)          procStatus = 'partial';
  else if (dbOrder?.status === 'PROCESSING') procStatus = 'processing';

  const items = (o.line_items || []).map((li: any) => ({
    name:     li.name     || '',
    quantity: li.quantity || 1,
    price:    parseFloat(li.price || '0'),
    sku:      li.sku      || '',
  }));

  // Extract AWB from Shopify fulfillments (for orders created by xConnector original)
  const fulfillments = o.fulfillments || [];
  const shopifyAwb = fulfillments.length > 0
    ? fulfillments[0].tracking_number || fulfillments[0].tracking_numbers?.[0] || null
    : null;
  const shopifyTrackingUrl = fulfillments.length > 0
    ? fulfillments[0].tracking_url || null
    : null;
  const shopifyCourier = fulfillments.length > 0
    ? (fulfillments[0].tracking_company || 'gls').toLowerCase()
    : 'gls';

  return {
    id:        numId,
    gid:       `gid://shopify/Order/${numId}`,
    dbId:      dbOrder?.id ?? null,
    name:      o.name,
    createdAt: o.created_at,
    cancelled: !!(o.cancelled_at),
    customer: {
      name: (
        addr.name
        || `${addr.first_name || ''} ${addr.last_name || ''}`.trim()
        || (o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : '')
        || o.billing_address?.name
        || `${o.billing_address?.first_name || ''} ${o.billing_address?.last_name || ''}`.trim()
        || dbOrder?.customerName
        || ''
      ),
      email: o.email || o.customer?.email || dbOrder?.customerEmail || '',
      phone: o.phone || addr.phone || o.customer?.phone || dbOrder?.customerPhone || '',
    },
    address: {
      address1: addr.address1 || dbOrder?.address1 || '',
      address2: addr.address2 || dbOrder?.address2 || '',
      city:     addr.city     || dbOrder?.city     || '',
      province: addr.province || addr.province_code || dbOrder?.province || '',
      zip:      addr.zip      || dbOrder?.zip      || '',
    },
    lineItems:         items,
    totalPrice:        parseFloat(o.total_price || '0'),
    currency:          o.currency || 'RON',
    financialStatus:   fin,
    fulfillmentStatus: ful || null,
    invoice,
    // Merge DB shipment with Shopify fulfillment (fallback for xConnector original AWBs)
    shipment: shipment || (shopifyAwb ? {
      id: null,
      courier: shopifyCourier,
      tracking: shopifyAwb,
      trackingUrl: shopifyTrackingUrl,
      // AWB din xConnector original — eticheta nu e disponibilă (cont GLS diferit)
      labelUrl: null,
      status: 'CREATED',
    } : null),
    processingStatus: procStatus,
    processingError:  dbOrder?.error ?? null,
    // Flatten Shopify note_attributes to key→value map
    // This includes xconnector-invoice-url, xconnector-invoice-short-url etc.
    noteAttributes: Object.fromEntries(
      (o.note_attributes || []).map((a: { name: string; value: string }) => [a.name, a.value])
    ),
  };
}

/* ── Route handler ── */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search    = searchParams.get('search')  ?? '';
  const finStatus = searchParams.get('fin')     ?? 'all';
  const dateFrom  = searchParams.get('from')    ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const cursor    = searchParams.get('cursor')  ?? null;
  const shopKey   = searchParams.get('shop')    ?? getDefaultShopKey();

  let shopCfg;
  try { shopCfg = getShopConfig(shopKey); }
  catch { return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 }); }

  try {
    const result = await fetchShopifyOrders(
      shopCfg.domain,
      shopCfg.accessToken,
      cursor,
      { search, createdMin: dateFrom, financialStatus: finStatus },
    );

    const ids      = result.orders.map((o: any) => String(o.id));
    const enriched = await enrichWithDbState(ids, shopCfg.domain);
    const orders   = result.orders.map((o: any) => mapOrder(o, enriched));

    return NextResponse.json({ orders, pageInfo: result.pageInfo });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
