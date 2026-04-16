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

/**
 * Wizard override fields — when the user edits the AWB form before confirming,
 * these values are passed in and applied on top of the order data in the DB.
 */
interface ShipmentWizardOverrides {
  recipientName?:    string;
  recipientPhone?:   string;
  recipientEmail?:   string;
  recipientAddress?: string;
  recipientCity?:    string;
  recipientCounty?:  string;
  recipientZip?:     string;
  productName?:      string;   // AWB content / description
  weight?:           number;
  parcels?:          number;
  isCOD?:            boolean;
  codAmount?:        number;
  notifyCustomer?:   boolean;
  observations?:     string;
}

export async function POST(request: Request) {
  const {
    shopifyOrderId,
    courier        = process.env.DEFAULT_COURIER || 'gls',
    courierOptions = {},
    shop: shopKey  = getDefaultShopKey(),
    overrides      = {} as ShipmentWizardOverrides,
  } = await request.json() as {
    shopifyOrderId: string;
    courier?: string;
    courierOptions?: Record<string, unknown>;
    shop?: string;
    overrides?: ShipmentWizardOverrides;
  };

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

    // Build merged courierOptions from wizard overrides + caller-supplied options
    const mergedCourierOptions: Record<string, unknown> = {
      ...courierOptions,
      ...(overrides.notifyCustomer !== undefined ? { notifyCustomer: overrides.notifyCustomer } : {}),
      ...(overrides.observations   ? { observations: overrides.observations }   : {}),
      ...(overrides.productName    ? { content: overrides.productName }          : {}),
      ...(overrides.weight         !== undefined ? { weight: overrides.weight }  : {}),
      ...(overrides.parcels        !== undefined ? { parcels: overrides.parcels }: {}),
    };

    // If wizard overrides are present, patch the order in-memory so
    // shipment-service uses the edited values (no DB write — DB stays authoritative)
    const effectiveOrder = overrides.recipientName || overrides.recipientAddress ? {
      ...order,
      customerName:      overrides.recipientName    ?? order.customerName,
      customerPhone:     overrides.recipientPhone   ?? order.customerPhone,
      customerEmail:     overrides.recipientEmail   ?? order.customerEmail,
      shippingAddress1:  overrides.recipientAddress ?? order.shippingAddress1,
      shippingCity:      overrides.recipientCity    ?? order.shippingCity,
      shippingProvince:  overrides.recipientCounty  ?? order.shippingProvince,
      shippingZip:       overrides.recipientZip     ?? order.shippingZip,
      isPaid:            overrides.isCOD === false   ? true  : (overrides.isCOD === true ? false : order.isPaid),
      totalPrice:        overrides.isCOD && overrides.codAmount !== undefined
                           ? overrides.codAmount as unknown as typeof order.totalPrice
                           : order.totalPrice,
    } : order;

    const result = await ensureShipment(effectiveOrder, SHOPIFY_TOKEN, SHOPIFY_DOMAIN, courier, mergedCourierOptions);

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
