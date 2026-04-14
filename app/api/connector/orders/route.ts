/**
 * app/api/connector/orders/route.ts
 * Lists Shopify orders enriched with our DB processing state (invoice + shipment).
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { buildInvoiceUrl, buildShippingLabelUrl } from '@/lib/security/tokens';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || '';
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN || '';
const API_VERSION    = '2024-01';

/* ── Shopify GraphQL fetch ── */
async function fetchShopifyOrders(
  cursor: string | null,
  filters: { search?: string; createdMin?: string; financialStatus?: string },
) {
  const parts: string[] = ['status:any'];
  if (filters.createdMin) parts.push(`created_at:>=${filters.createdMin}`);
  if (filters.financialStatus && filters.financialStatus !== 'all')
    parts.push(`financial_status:${filters.financialStatus}`);
  if (filters.search) parts.push(`(name:*${filters.search}* OR email:*${filters.search}*)`);

  const query = `{
    orders(first:50 ${cursor ? `after:"${cursor}"` : ''} query:"${parts.join(' ')}" sortKey:CREATED_AT reverse:true) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id name createdAt cancelledAt
        displayFinancialStatus displayFulfillmentStatus
        paymentGatewayNames
        totalPriceSet { shopMoney { amount currencyCode } }
        email phone
        shippingAddress { name address1 address2 city province zip phone }
        billingAddress  { name address1 address2 city province zip phone }
        lineItems(first:10) { edges { node {
          name quantity
          originalUnitPriceSet { shopMoney { amount } }
          variant { sku }
        }}}
        customAttributes { key value }
      }}
    }
  }`;

  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data.orders;
}

/* ── Enrich with DB state ── */
async function enrichWithDbState(shopifyIds: string[]) {
  if (!shopifyIds.length) return { invoices: {}, shipments: {}, orders: {} };

  const shop = await db.shop.findFirst({ where: { domain: SHOPIFY_DOMAIN } });
  if (!shop) return { invoices: {}, shipments: {}, orders: {} };

  const [dbOrders, invoices, shipments] = await Promise.all([
    db.order.findMany({ where: { shopId: shop.id, shopifyId: { in: shopifyIds } }, select: { id: true, shopifyId: true, status: true, processingError: true } }),
    db.invoice.findMany({ where: { shopId: shop.id, order: { shopifyId: { in: shopifyIds } } }, include: { order: { select: { shopifyId: true } } } }),
    db.shipment.findMany({ where: { shopId: shop.id, order: { shopifyId: { in: shopifyIds } } }, include: { order: { select: { shopifyId: true } } } }),
  ]);

  const orderMap: Record<string, { id: string; status: string; error?: string | null }> = {};
  for (const o of dbOrders) orderMap[o.shopifyId] = { id: o.id, status: o.status, error: o.processingError };

  const invMap: Record<string, { id: string; series: string; number: string; status: string; url: string }> = {};
  for (const inv of invoices) {
    const sid = inv.order.shopifyId;
    if (!invMap[sid]) invMap[sid] = { id: inv.id, series: inv.series, number: inv.number, status: inv.status, url: buildInvoiceUrl(inv.id) };
  }

  const shipMap: Record<string, { id: string; courier: string; tracking: string; trackingUrl: string | null; labelUrl: string; status: string }> = {};
  for (const s of shipments) {
    const sid = s.order.shopifyId;
    if (!shipMap[sid]) shipMap[sid] = { id: s.id, courier: s.courier, tracking: s.trackingNumber, trackingUrl: s.trackingUrl, labelUrl: buildShippingLabelUrl(s.id), status: s.status };
  }

  return { invoices: invMap, shipments: shipMap, orders: orderMap };
}

/* ── Map Shopify node → enriched order ── */
function mapNode(node: Record<string, unknown>, enriched: Awaited<ReturnType<typeof enrichWithDbState>>) {
  const gid   = node.id as string;
  const numId = gid.replace(/\D/g, '');
  const addr  = (node.shippingAddress ?? node.billingAddress ?? {}) as Record<string, string>;

  const items = ((node.lineItems as { edges: { node: Record<string, unknown> }[] }).edges ?? []).map((e) => ({
    name:     (e.node.name as string) || '',
    quantity: (e.node.quantity as number) || 1,
    price:    parseFloat(((e.node.originalUnitPriceSet as Record<string, Record<string, string>>)?.shopMoney?.amount) || '0'),
    sku:      ((e.node.variant as Record<string, string> | null)?.sku) || '',
  }));

  const dbOrder  = enriched.orders[numId];
  const invoice  = enriched.invoices[numId] ?? null;
  const shipment = enriched.shipments[numId] ?? null;

  const fin  = ((node.displayFinancialStatus  as string) || '').toLowerCase();
  const ful  = ((node.displayFulfillmentStatus as string) || '').toLowerCase();

  let procStatus = 'pending';
  if (node.cancelledAt)           procStatus = 'cancelled';
  else if (dbOrder?.status === 'FAILED') procStatus = 'failed';
  else if (invoice && shipment)   procStatus = 'fulfilled';
  else if (invoice || shipment)   procStatus = 'partial';
  else if (dbOrder?.status === 'PROCESSING') procStatus = 'processing';

  return {
    id:     numId,
    gid,
    dbId:   dbOrder?.id ?? null,
    name:   node.name as string,
    createdAt: node.createdAt as string,
    cancelled: !!(node.cancelledAt),
    customer: {
      name:  addr.name  || '',
      email: (node.email as string) || '',
      phone: (node.phone as string) || addr.phone || '',
    },
    address: {
      address1: addr.address1 || '',
      address2: addr.address2 || '',
      city:     addr.city     || '',
      province: addr.province || '',
      zip:      addr.zip      || '',
    },
    lineItems: items,
    totalPrice: parseFloat(((node.totalPriceSet as Record<string, Record<string, string>>)?.shopMoney?.amount) || '0'),
    currency:   ((node.totalPriceSet as Record<string, Record<string, string>>)?.shopMoney?.currencyCode) || 'RON',
    financialStatus:   fin,
    fulfillmentStatus: ful || null,
    invoice,
    shipment,
    processingStatus: procStatus,
    processingError: dbOrder?.error ?? null,
  };
}

/* ── Route handler ── */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search    = searchParams.get('search')  ?? '';
  const finStatus = searchParams.get('fin')     ?? 'all';
  const dateFrom  = searchParams.get('from')    ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const cursor    = searchParams.get('cursor')  ?? null;

  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
    return NextResponse.json({ error: 'SHOPIFY_DOMAIN or SHOPIFY_ACCESS_TOKEN not set' }, { status: 500 });
  }

  try {
    const shopifyData = await fetchShopifyOrders(cursor, { search, createdMin: dateFrom, financialStatus: finStatus });
    const nodes = shopifyData.edges.map((e: { node: unknown }) => e.node) as Record<string, unknown>[];
    const ids   = nodes.map((n) => (n.id as string).replace(/\D/g, ''));

    const enriched = await enrichWithDbState(ids);
    const orders   = nodes.map((n) => mapNode(n, enriched));

    return NextResponse.json({
      orders,
      pageInfo: shopifyData.pageInfo,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
