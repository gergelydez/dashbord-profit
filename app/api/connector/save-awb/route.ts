/**
 * app/api/connector/save-awb/route.ts
 * Salveaza AWB generat de /api/gls in DB pentru persistenta si download label.
 * POST { shopifyOrderId, shop, courier, trackingNumber, trackingUrl, labelBase64 }
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { storePdf } from '@/lib/storage/s3';
import { buildShippingLabelUrl } from '@/lib/security/tokens';
import { getShopConfig, getDefaultShopKey } from '@/lib/shops';
import { upsertOrderFromWebhook, type WebhookOrderPayload } from '@/lib/services/order-processor';

async function fetchShopifyOrder(shopifyId: string, domain: string, token: string) {
  const res = await fetch(
    `https://${domain}/admin/api/2026-07/orders/${shopifyId}.json`,
    { headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Shopify fetch failed: ${res.status}`);
  const { order } = await res.json();
  return order;
}

export async function POST(request: Request) {
  try {
    const {
      shopifyOrderId,
      shop: shopKey = getDefaultShopKey(),
      courier = 'gls',
      trackingNumber,
      trackingUrl,
      labelBase64,
    } = await request.json() as {
      shopifyOrderId: string;
      shop?: string;
      courier?: string;
      trackingNumber: string;
      trackingUrl?: string;
      labelBase64?: string | null;
    };

    if (!shopifyOrderId || !trackingNumber) {
      return NextResponse.json({ error: 'shopifyOrderId and trackingNumber required' }, { status: 400 });
    }

    let shopCfg;
    try { shopCfg = getShopConfig(shopKey); }
    catch { return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 }); }

    const { domain, accessToken } = shopCfg;

    // Ensure shop in DB
    let shop = await db.shop.findFirst({ where: { domain } });
    if (!shop) {
      shop = await db.shop.create({ data: { domain, accessToken, active: true } });
    }

    // Ensure order in DB
    let order = await db.order.findFirst({ where: { shopId: shop.id, shopifyId: shopifyOrderId } });
    if (!order) {
      const shopifyOrder = await fetchShopifyOrder(shopifyOrderId, domain, accessToken);
      const orderId = await upsertOrderFromWebhook(shop.id, domain, shopifyOrder as WebhookOrderPayload);
      order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    }

    // Idempotency — daca exista deja AWB pentru acest curier, returneaza-l
    const existing = await db.shipment.findFirst({
      where: { orderId: order.id, courier, status: { in: ['CREATED', 'IN_TRANSIT', 'DELIVERED'] } },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        shipmentId: existing.id,
        labelUrl: buildShippingLabelUrl(existing.id),
        alreadyExisted: true,
      });
    }

    // Creeaza Shipment in DB
    const shipment = await db.shipment.create({
      data: {
        orderId:        order.id,
        shopId:         shop.id,
        courier,
        trackingNumber,
        trackingUrl:    trackingUrl || null,
        status:         'CREATED',
        weight:         1,
        parcels:        1,
        codAmount:      !order.isPaid ? Number(order.totalPrice) : null,
      },
    });

    // Salveaza PDF label in DB/S3
    if (labelBase64) {
      try {
        const pdfBuffer = Buffer.from(labelBase64, 'base64');
        const stored = await storePdf(pdfBuffer, 'labels', shipment.id);
        // Daca e stocat in DB (nu S3), salveaza si bytes direct
        const isDb = stored.key.startsWith('db:');
        await db.shipment.update({
          where: { id: shipment.id },
          data: {
            labelStorageKey: stored.key,
            ...(isDb ? { labelData: pdfBuffer } : {}),
          },
        });
      } catch (e) {
        console.error('[save-awb] PDF storage failed (non-fatal):', (e as Error).message);
      }
    }

    // Update order status
    await db.order.update({
      where: { id: order.id },
      data: { shipmentCreated: true, status: 'SHIPMENT_CREATED' },
    });

    const labelUrl = buildShippingLabelUrl(shipment.id);

    return NextResponse.json({
      ok: true,
      shipmentId: shipment.id,
      labelUrl,
    });

  } catch (err) {
    console.error('[save-awb] Error:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
