/**
 * app/api/stats-totale/order-list/route.ts
 * POST { shop, from, to } — lista detaliată a comenzilor DIN BAZA NOASTRĂ
 * pentru UN magazin + interval, pentru drill-down-ul din Statistici Totale
 * (click pe un rând „magazin — N comenzi" ca să vezi fiecare comandă, cu
 * curierul ei — GLS sau Sameday — și statusul de livrare).
 *
 * Presupune că magazinul a fost deja sincronizat (vezi /api/stats-totale/
 * sync-orders) — altfel lista poate fi incompletă, la fel ca restul paginii.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { getShopConfig } from '@/lib/shops';

const ONLINE_GW = ['shopify_payments', 'stripe', 'paypal'];
const isOnlineGateway = (gw: string) => !!gw && ONLINE_GW.some(g => gw.toLowerCase().includes(g));

export async function POST(request: Request) {
  try {
    const { shop: shopKey, from, to } = await request.json() as { shop?: string; from?: string; to?: string };
    if (!shopKey || !from || !to) return NextResponse.json({ error: 'shop/from/to lipsă' }, { status: 400 });

    let shopCfg;
    try { shopCfg = getShopConfig(shopKey); }
    catch { return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 }); }

    const shop = await db.shop.findFirst({ where: { domain: shopCfg.domain }, select: { id: true } });
    if (!shop) return NextResponse.json({ ok: true, orders: [] });

    const fromD = new Date(`${from}T00:00:00Z`);
    const toD = new Date(`${to}T23:59:59Z`);

    const orders = await db.order.findMany({
      where: {
        shopId: shop.id,
        OR: [
          { shopifyCreatedAt: { gte: fromD, lte: toD } },
          { shopifyCreatedAt: null, createdAt: { gte: fromD, lte: toD } },
        ],
      },
      select: {
        shopifyName: true, createdAt: true, shopifyCreatedAt: true, totalPrice: true, currency: true,
        paymentGateway: true, status: true, financialStatus: true, customerName: true,
        invoices: { select: { id: true, series: true, number: true }, take: 1 },
        shipments: { select: { courier: true, trackingNumber: true, status: true, deliveredAt: true } },
      },
      orderBy: [{ shopifyCreatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });

    const rows = orders.map(o => {
      const finStatus = (o.financialStatus || '').toLowerCase();
      const refunded = finStatus === 'refunded' || finStatus === 'voided';
      const online = isOnlineGateway(o.paymentGateway);
      const delivered = o.shipments.some(s => s.status === 'DELIVERED');
      const returned = o.shipments.some(s => s.status === 'RETURNED');
      const ship = o.shipments[0];
      const invoice = o.invoices[0];
      return {
        name: o.shopifyName,
        date: (o.shopifyCreatedAt || o.createdAt).toISOString(),
        customer: o.customerName,
        total: Number(o.totalPrice),
        currency: o.currency,
        cancelled: o.status === 'CANCELLED',
        refunded,
        online,
        delivered,
        returned,
        courier: ship?.courier || null,
        trackingNumber: ship?.trackingNumber || null,
        shipmentStatus: ship?.status || null,
        allCouriers: o.shipments.map(s => s.courier),
        invoiceNumber: invoice ? `${invoice.series}${invoice.number}` : null,
      };
    });

    return NextResponse.json({ ok: true, orders: rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
