/**
 * app/api/connector/sync-orders/route.ts
 * POST — triggers Shopify to re-send order webhooks by doing a minor update
 * on each order. This populates our DB with full customer PII data even on
 * Basic plan stores (webhooks bypass the PII restriction).
 *
 * Usage: POST /api/connector/sync-orders  { "shop": "hu", "limit": 50 }
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { getShopConfig, getDefaultShopKey } from '@/lib/shops';
import { db } from '@/lib/db';

const API_VERSION = '2026-07';

export async function POST(request: Request) {
  const { shop: shopKey = getDefaultShopKey(), limit = 50, from } =
    await request.json() as { shop?: string; limit?: number; from?: string };

  let shopCfg;
  try { shopCfg = getShopConfig(shopKey); }
  catch { return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 }); }

  const { domain, accessToken } = shopCfg;

  try {
    // 1. Fetch orders that are NOT yet in DB (no customer data stored)
    const shop = await db.shop.findFirst({ where: { domain } });
    const existingIds = shop
      ? (await db.order.findMany({ where: { shopId: shop.id }, select: { shopifyId: true } }))
          .map(o => o.shopifyId)
      : [];

    // 2. Get order list from Shopify REST
    const params = new URLSearchParams({ limit: String(Math.min(limit, 250)), status: 'any', order: 'created_at desc' });
    if (from) params.set('created_at_min', `${from}T00:00:00Z`);

    const listRes = await fetch(
      `https://${domain}/admin/api/${API_VERSION}/orders.json?${params}`,
      { headers: { 'X-Shopify-Access-Token': accessToken }, cache: 'no-store' },
    );
    if (!listRes.ok) throw new Error(`Shopify list ${listRes.status}`);
    const { orders } = await listRes.json();

    // 3. Filter orders not yet in DB
    const toSync = (orders as { id: number }[])
      .filter(o => !existingIds.includes(String(o.id)))
      .slice(0, limit);

    if (toSync.length === 0) {
      return NextResponse.json({ ok: true, synced: 0, message: 'All orders already in DB' });
    }

    // 4. For each order, do a minimal update to trigger orders/updated webhook
    // We set note_attributes with a sync marker — this is invisible to customers
    let synced = 0;
    const errors: string[] = [];

    for (const order of toSync) {
      try {
        const updateRes = await fetch(
          `https://${domain}/admin/api/${API_VERSION}/orders/${order.id}.json`,
          {
            method: 'PUT',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              order: {
                id: order.id,
                note_attributes: [{ name: '_synced_at', value: new Date().toISOString() }],
              },
            }),
            cache: 'no-store',
          },
        );
        if (updateRes.ok) {
          synced++;
        } else {
          errors.push(`Order ${order.id}: ${updateRes.status}`);
        }
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        errors.push(`Order ${order.id}: ${(e as Error).message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      synced,
      total: toSync.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Triggered webhooks for ${synced}/${toSync.length} orders. Check back in 30s.`,
    });

  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
