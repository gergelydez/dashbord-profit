import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { getShopConfig } from '@/lib/shops';

/**
 * GET /api/admin/order-debug?name=%231018&shop=glatohu&secret=<CONNECTOR_SECRET>
 * Diagnostic: arată rândul Order din DB (inclusiv relația Invoice) pentru o
 * comandă, după numele Shopify (#1018) — folosit ca să depistăm de ce o
 * comandă deja facturată mai apare ca "fără factură" pe pagina Comenzi.
 */
function checkSecret(provided: string | null) {
  const expected = process.env.CONNECTOR_SECRET || '';
  const key = provided || '';
  if (!key || !expected || key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!checkSecret(searchParams.get('secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const name = (searchParams.get('name') || '').trim();
  const shopKey = searchParams.get('shop') || '';
  if (!name) return NextResponse.json({ error: 'name lipsă (ex: ?name=%231018)' }, { status: 400 });

  try {
    let shopId: string | undefined;
    if (shopKey) {
      try {
        const cfg = getShopConfig(shopKey);
        const shop = await db.shop.findFirst({ where: { domain: cfg.domain } });
        shopId = shop?.id;
      } catch { /* shop necunoscut — căutăm fără filtru de shop */ }
    }

    const orders = await db.order.findMany({
      where: { shopifyName: name, ...(shopId ? { shopId } : {}) },
      include: { invoices: true, shipments: true },
      take: 5,
    });

    return NextResponse.json({
      ok: true,
      found: orders.length,
      orders: orders.map(o => ({
        id: o.id, shopifyId: o.shopifyId, shopifyName: o.shopifyName,
        financialStatus: o.financialStatus, isPaid: o.isPaid, paymentGateway: o.paymentGateway,
        shippingCountry: o.shippingCountry, createdAt: o.createdAt,
        invoices: o.invoices.map(i => ({ id: i.id, series: i.series, number: i.number, status: i.status, collected: i.collected, createdAt: i.createdAt })),
        shipments: o.shipments.map(s => ({ courier: s.courier, status: s.status, trackingNumber: s.trackingNumber })),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
