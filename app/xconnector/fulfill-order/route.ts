/**
 * app/api/connector/fulfill-order/route.ts
 * POST — Marchează comanda ca Fulfilled în Shopify cu AWB tracking.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { getShopConfig, getDefaultShopKey } from '@/lib/shops';
import { createFulfillment } from '@/lib/shopify/fulfillment';

export async function POST(request: Request) {
  try {
    const {
      shopifyOrderId,
      shop: shopKey = getDefaultShopKey(),
      trackingNumber,
      trackingUrl,
      courier = 'GLS',
      notifyCustomer = false,
    } = await request.json() as {
      shopifyOrderId: string;
      shop?: string;
      trackingNumber: string;
      trackingUrl?: string;
      courier?: string;
      notifyCustomer?: boolean;
    };

    if (!shopifyOrderId || !trackingNumber) {
      return NextResponse.json({ error: 'shopifyOrderId și trackingNumber sunt obligatorii' }, { status: 400 });
    }

    let shopCfg;
    try { shopCfg = getShopConfig(shopKey); }
    catch { return NextResponse.json({ error: `Shop "${shopKey}" nu e configurat` }, { status: 400 }); }

    const { domain, accessToken } = shopCfg;
    const orderGid = `gid://shopify/Order/${shopifyOrderId}`;

    // Creează fulfillment în Shopify cu AWB
    const result = await createFulfillment(
      { domain, accessToken },
      {
        orderGid,
        trackingNumber,
        trackingUrl: trackingUrl || `https://gls-group.eu/RO/ro/urmarire-colet?match=${trackingNumber}`,
        trackingCompany: courier,
        notifyCustomer,
      },
    );

    // Actualizează shipment în DB dacă există
    try {
      const shop = await db.shop.findFirst({ where: { domain } });
      if (shop) {
        const order = await db.order.findFirst({ where: { shopId: shop.id, shopifyId: shopifyOrderId } });
        if (order) {
          const shipment = await db.shipment.findFirst({ where: { orderId: order.id, trackingNumber } });
          if (shipment && result.fulfillmentId) {
            await db.shipment.update({
              where: { id: shipment.id },
              data: { fulfillmentId: result.fulfillmentId, shopifyUpdated: true },
            });
          }
          await db.order.update({
            where: { id: order.id },
            data: { fulfilled: true, status: 'FULFILLED' },
          });
        }
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      fulfillmentId: result.fulfillmentId,
      status: result.status,
    });

  } catch (err) {
    console.error('[fulfill-order] Error:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
