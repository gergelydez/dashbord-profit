/**
 * app/api/connector/update-address/route.ts
 * POST — updates the shipping address ZIP on a Shopify order.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { getShopConfig, getDefaultShopKey } from '@/lib/shops';

export async function POST(request: Request) {
  const {
    shopifyOrderId,
    zip,
    shop: shopKey = getDefaultShopKey(),
  } = await request.json() as { shopifyOrderId: string; zip: string; shop?: string };

  if (!shopifyOrderId || !zip) {
    return NextResponse.json({ error: 'shopifyOrderId and zip are required' }, { status: 400 });
  }

  let shopCfg;
  try { shopCfg = getShopConfig(shopKey); }
  catch { return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 }); }

  const res = await fetch(
    `https://${shopCfg.domain}/admin/api/2026-07/orders/${shopifyOrderId}.json`,
    {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': shopCfg.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ order: { id: shopifyOrderId, shipping_address: { zip } } }),
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: `Shopify ${res.status}: ${body}` }, { status: res.status });
  }

  return NextResponse.json({ ok: true, zip });
}
