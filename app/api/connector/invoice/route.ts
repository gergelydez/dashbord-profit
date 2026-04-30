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
import { getShopConfig, getDefaultShopKey } from '@/lib/shops';

async function fetchShopifyOrder(shopifyId: string, domain: string, token: string) {
  const res = await fetch(
    `https://${domain}/admin/api/2026-07/orders/${shopifyId}.json`,
    { headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Shopify order fetch ${res.status}`);
  const { order } = await res.json();
  return order;
}

export async function POST(request: Request) {
  const {
    shopifyOrderId,
    shop: shopKey = getDefaultShopKey(),
    withCollection,
    useStock,
  } = await request.json() as { shopifyOrderId: string; shop?: string; withCollection?: boolean; useStock?: boolean };
  if (!shopifyOrderId) return NextResponse.json({ error: 'shopifyOrderId required' }, { status: 400 });

  let shopCfg;
  try { shopCfg = getShopConfig(shopKey); }
  catch { return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 }); }

  const { domain: SHOPIFY_DOMAIN, accessToken: SHOPIFY_TOKEN } = shopCfg;

  try {
    // Ensure shop exists
    let shop = await db.shop.findFirst({ where: { domain: SHOPIFY_DOMAIN } });
    if (!shop) {
      shop = await db.shop.create({ data: { domain: SHOPIFY_DOMAIN, accessToken: SHOPIFY_TOKEN } });
    }

    // Ensure order in DB
    let order = await db.order.findFirst({ where: { shopId: shop.id, shopifyId: shopifyOrderId } });
    if (!order) {
      const shopifyOrder = await fetchShopifyOrder(shopifyOrderId, SHOPIFY_DOMAIN, SHOPIFY_TOKEN);
      const orderId = await upsertOrderFromWebhook(shop.id, SHOPIFY_DOMAIN, shopifyOrder as WebhookOrderPayload);
      order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    }

    // Generate invoice (idempotent)
    const result = await ensureInvoice(order, SHOPIFY_TOKEN, SHOPIFY_DOMAIN, withCollection, useStock);

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
