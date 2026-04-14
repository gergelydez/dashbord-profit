/**
 * app/api/connector/shipment/route.ts
 * POST — generate AWB for one order.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { ensureShipment } from '@/lib/services/shipment-service';
import { upsertOrderFromWebhook, type WebhookOrderPayload } from '@/lib/services/order-processor';
import { buildShippingLabelUrl } from '@/lib/security/tokens';
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
    courier        = process.env.DEFAULT_COURIER || 'gls',
    courierOptions = {},
    shop: shopKey  = getDefaultShopKey(),
  } = await request.json() as { shopifyOrderId: string; courier?: string; courierOptions?: Record<string, unknown>; shop?: string };

  if (!shopifyOrderId) return NextResponse.json({ error: 'shopifyOrderId required' }, { status: 400 });

  let shopCfg;
  try { shopCfg = getShopConfig(shopKey); }
  catch { return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 }); }

  const { domain: SHOPIFY_DOMAIN, accessToken: SHOPIFY_TOKEN } = shopCfg;

  try {
    let shop = await db.shop.findFirst({ where: { domain: SHOPIFY_DOMAIN } });
    if (!shop) {
      shop = await db.shop.create({ data: { domain: SHOPIFY_DOMAIN, accessToken: SHOPIFY_TOKEN } });
    }

    let order = await db.order.findFirst({ where: { shopId: shop.id, shopifyId: shopifyOrderId } });
    if (!order) {
      const shopifyOrder = await fetchShopifyOrder(shopifyOrderId, SHOPIFY_DOMAIN, SHOPIFY_TOKEN);
      const orderId = await upsertOrderFromWebhook(shop.id, SHOPIFY_DOMAIN, shopifyOrder as WebhookOrderPayload);
      order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    }

    const result = await ensureShipment(order, SHOPIFY_TOKEN, SHOPIFY_DOMAIN, courier, courierOptions);

    return NextResponse.json({
      ok:             true,
      shipmentId:     result.shipment.id,
      courier:        result.shipment.courier,
      trackingNumber: result.shipment.trackingNumber,
      trackingUrl:    result.shipment.trackingUrl,
      labelUrl:       buildShippingLabelUrl(result.shipment.id),
      status:         result.shipment.status,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
