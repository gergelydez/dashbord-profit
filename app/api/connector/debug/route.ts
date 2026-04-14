import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain') || '37022a-94.myshopify.com';

  const shop = await db.shop.findFirst({ where: { domain } });

  if (!shop) {
    return NextResponse.json({
      found: false,
      domain,
      message: 'Shop NOT in DB — no webhooks received/processed yet',
    });
  }

  const orderCount  = await db.order.count({ where: { shopId: shop.id } });
  const withName    = await db.order.count({ where: { shopId: shop.id, customerName: { not: '' } } });
  const recentEvents = await db.webhookEvent.findMany({
    where: { shopDomain: domain },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { topic: true, processed: true, lastError: true, createdAt: true, shopifyEventId: true },
  });
  const sampleOrders = await db.order.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { shopifyId: true, shopifyName: true, customerName: true, customerEmail: true, shippingCity: true },
  });

  return NextResponse.json({
    found: true,
    shop: { id: shop.id, domain: shop.domain },
    orders: { total: orderCount, withName },
    recentWebhooks: recentEvents,
    sampleOrders,
  });
}
