/**
 * app/api/connector/dashboard/route.ts
 * GET /api/connector/dashboard?shop=ro&days=30
 * Returns per-store stats: orders, revenue, invoices, AWBs, pending.
 * Uses DB (not Shopify API) for performance — data comes from webhooks.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { getShopConfig, getDefaultShopKey } from '@/lib/shops';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const shopKey = searchParams.get('shop') ?? getDefaultShopKey();
  const days    = parseInt(searchParams.get('days') ?? '30', 10);

  let shopCfg;
  try { shopCfg = getShopConfig(shopKey); }
  catch { return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 }); }

  const shop = await db.shop.findFirst({ where: { domain: shopCfg.domain } });
  if (!shop) {
    return NextResponse.json({
      shopKey, orders: 0, revenue: 0, invoices: 0, awbs: 0,
      pending: 0, failed: 0, cancelled: 0, currency: 'RON',
      revenueByDay: [], statusBreakdown: {},
    });
  }

  const since = new Date(Date.now() - days * 86_400_000);

  const [orders, invoices, shipments] = await Promise.all([
    db.order.findMany({
      where: { shopId: shop.id, shopifyCreatedAt: { gte: since } },
      select: { id: true, totalPrice: true, currency: true, status: true, isPaid: true, shopifyCreatedAt: true, invoiceCreated: true, shipmentCreated: true },
    }),
    db.invoice.count({ where: { shopId: shop.id, createdAt: { gte: since } } }),
    db.shipment.count({ where: { shopId: shop.id, createdAt: { gte: since } } }),
  ]);

  const totalOrders   = orders.length;
  const totalRevenue  = orders.reduce((s, o) => s + Number(o.totalPrice), 0);
  const pendingOrders = orders.filter(o => o.status === 'PENDING').length;
  const failedOrders  = orders.filter(o => o.status === 'FAILED').length;
  const cancelled     = orders.filter(o => o.status === 'CANCELLED').length;
  const currency      = orders[0]?.currency ?? 'RON';

  /* Revenue by day (last N days) */
  const dayMap: Record<string, number> = {};
  for (const o of orders) {
    if (!o.shopifyCreatedAt) continue;
    const day = o.shopifyCreatedAt.toISOString().slice(0, 10);
    dayMap[day] = (dayMap[day] ?? 0) + Number(o.totalPrice);
  }
  const revenueByDay = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100 }));

  /* Status breakdown */
  const statusBreakdown: Record<string, number> = {};
  for (const o of orders) {
    statusBreakdown[o.status] = (statusBreakdown[o.status] ?? 0) + 1;
  }

  return NextResponse.json({
    shopKey,
    period:      { days, since: since.toISOString() },
    orders:      totalOrders,
    revenue:     Math.round(totalRevenue * 100) / 100,
    invoices,
    awbs:        shipments,
    pending:     pendingOrders,
    failed:      failedOrders,
    cancelled,
    currency,
    revenueByDay,
    statusBreakdown,
  });
}
