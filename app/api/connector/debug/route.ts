import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
import { SHOP_CONFIGS } from '@/lib/shops';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const shopKey = searchParams.get('shop') || 'hu';

  const shopCfg = SHOP_CONFIGS.find(s => s.key === shopKey);
  const domain  = shopCfg?.domain || searchParams.get('domain') || '';

  const shop = await db.shop.findFirst({ where: { domain } });

  // Check autoInvoice setting from DB
  const settingRecord = await db.webhookEvent.findUnique({
    where: { shopifyEventId: `settings:${shopKey}` },
  }).catch(() => null);
  const autoInvoice = settingRecord
    ? (settingRecord.payload as Record<string,unknown>)?.autoInvoice
    : 'NOT SET';

  // Recent webhooks
  const recentWebhooks = await db.webhookEvent.findMany({
    where: { shopDomain: domain, topic: { not: 'settings' } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { topic: true, processed: true, lastError: true, createdAt: true, shopifyEventId: true, orderId: true },
  });

  // Recent orders with invoice status
  const recentOrders = shop ? await db.order.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { invoices: { select: { series: true, number: true, status: true, createdAt: true } } },
  }) : [];

  // Registered webhooks in Shopify
  let shopifyWebhooks: unknown[] = [];
  if (shopCfg) {
    try {
      const res = await fetch(
        `https://${domain}/admin/api/2026-07/webhooks.json`,
        { headers: { 'X-Shopify-Access-Token': shopCfg.accessToken }, cache: 'no-store' }
      );
      const data = await res.json();
      shopifyWebhooks = (data.webhooks || []).map((w: {topic:string;address:string}) => ({
        topic: w.topic, address: w.address
      }));
    } catch (e) { shopifyWebhooks = [{ error: (e as Error).message }]; }
  }

  return NextResponse.json({
    shop: { key: shopKey, domain, foundInDb: !!shop },
    autoInvoiceSetting: autoInvoice,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    shopifyWebhooksRegistered: shopifyWebhooks,
    recentWebhooksReceived: recentWebhooks,
    recentOrders: recentOrders.map(o => ({
      name: o.shopifyName,
      isPaid: o.isPaid,
      gateway: o.paymentGateway,
      invoices: o.invoices,
      createdAt: o.createdAt,
    })),
  });
}
