/**
 * app/api/connector/invoice/route.ts
 * POST — generate invoice for one order (upserts order in DB first if needed).
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { ensureInvoice } from '@/lib/services/invoice-service';
import { upsertOrderFromWebhook, type WebhookOrderPayload } from '@/lib/services/order-processor';
import { buildInvoiceUrl } from '@/lib/security/tokens';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN       || '';
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ACCESS_TOKEN || '';

async function fetchShopifyOrder(shopifyId: string) {
  const res = await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders/${shopifyId}.json`,
    { headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Shopify order fetch ${res.status}`);
  const { order } = await res.json();
  return order;
}

export async function POST(request: Request) {
  const { shopifyOrderId } = await request.json() as { shopifyOrderId: string };
  if (!shopifyOrderId) return NextResponse.json({ error: 'shopifyOrderId required' }, { status: 400 });

  try {
    // Ensure shop exists
    let shop = await db.shop.findFirst({ where: { domain: SHOPIFY_DOMAIN } });
    if (!shop) {
      shop = await db.shop.create({ data: { domain: SHOPIFY_DOMAIN, accessToken: SHOPIFY_TOKEN } });
    }

    // Ensure order in DB
    let order = await db.order.findFirst({ where: { shopId: shop.id, shopifyId: shopifyOrderId } });
    if (!order) {
      const shopifyOrder = await fetchShopifyOrder(shopifyOrderId);
      const orderId = await upsertOrderFromWebhook(shop.id, SHOPIFY_DOMAIN, shopifyOrder as WebhookOrderPayload);
      order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    }

    // Generate invoice (idempotent)
    const result = await ensureInvoice(order, SHOPIFY_TOKEN, SHOPIFY_DOMAIN);

    return NextResponse.json({
      ok:         true,
      invoiceId:  result.invoice.id,
      series:     result.invoice.series,
      number:     result.invoice.number,
      status:     result.invoice.status,
      downloadUrl: buildInvoiceUrl(result.invoice.id),
      collected:  result.collected,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
