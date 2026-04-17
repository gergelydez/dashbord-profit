/**
 * app/api/webhooks/shopify/route.ts
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { verifyShopifyWebhook, extractWebhookHeaders } from '@/lib/security/webhook';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  upsertOrderFromWebhook,
  processOrder,
  type WebhookOrderPayload,
} from '@/lib/services/order-processor';
import { SHOP_CONFIGS } from '@/lib/shops';

// Citeste autoInvoice din Redis pentru shop-ul specific (ro sau hu)
async function isAutoInvoiceEnabled(shopDomain: string): Promise<boolean> {
  try {
    const { getRedisConnection } = await import('@/lib/redis');
    const redis = getRedisConnection();
    // Mapeaza domain → shop key (ro/hu)
    const shopCfg = SHOP_CONFIGS.find(s => s.domain === shopDomain);
    const shopKey = shopCfg?.key ?? 'ro';
    const raw = await redis.get(`xconnector:settings:${shopKey}`);
    console.log(`[webhook] autoInvoice check: domain=${shopDomain} key=${shopKey} raw=${raw}`);
    if (!raw) return false;
    return Boolean(JSON.parse(raw).autoInvoice);
  } catch (e) {
    console.error('[webhook] isAutoInvoiceEnabled error:', e);
    return false;
  }
}

const log = logger.child({ module: 'webhooks/shopify' });

const HANDLED_TOPICS = new Set([
  'orders/create',
  'orders/paid',
  'orders/fulfilled',
  'orders/updated',
  'orders/cancelled',
]);

const AUTO_INVOICE_TOPIC = 'orders/create';

export async function POST(request: Request) {
  const rawBodyBuffer = Buffer.from(await request.arrayBuffer());
  const { topic, shopDomain, eventId, hmac } = extractWebhookHeaders(request);

  if (!verifyShopifyWebhook(rawBodyBuffer, hmac)) {
    log.warn('Webhook HMAC verification failed', { shopDomain, topic, eventId });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: WebhookOrderPayload;
  try {
    payload = JSON.parse(rawBodyBuffer.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  log.info('Webhook received', { topic, shopDomain, eventId, orderId: payload.id });

  const existingEvent = await db.webhookEvent.findUnique({ where: { shopifyEventId: eventId } });
  if (existingEvent?.processed) {
    return NextResponse.json({ ok: true, status: 'duplicate' });
  }

  const shopId = await resolveShopId(shopDomain);

  const webhookEvent = await db.webhookEvent.upsert({
    where:  { shopifyEventId: eventId },
    create: { shopifyEventId: eventId, topic, shopDomain, shopId, payload: payload as object },
    update: { attempts: { increment: 1 } },
  });

  if (!HANDLED_TOPICS.has(topic)) {
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data:  { processed: true, processedAt: new Date() },
    });
    return NextResponse.json({ ok: true, status: 'ignored' });
  }

  let orderId: string;
  try {
    orderId = await upsertOrderFromWebhook(shopId, shopDomain, payload);
    await db.webhookEvent.update({ where: { id: webhookEvent.id }, data: { orderId } });
  } catch (err) {
    log.error('Failed to upsert order', { error: (err as Error).message });
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data:  { lastError: (err as Error).message },
    });
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  await db.webhookEvent.update({
    where: { id: webhookEvent.id },
    data:  { processed: true, processedAt: new Date() },
  }).catch(() => {});

  // Auto-invoice — DOAR orders/create, DOAR daca toggle ON pentru shop-ul respectiv
  if (topic === AUTO_INVOICE_TOPIC) {
    const autoEnabled = await isAutoInvoiceEnabled(shopDomain);
    if (autoEnabled) {
      const hasInvoice = await db.invoice.findFirst({ where: { orderId } });
      if (!hasInvoice) {
        log.info('Auto-invoice triggered', { orderId, shopDomain });
        processOrderInline(orderId, shopId, webhookEvent.id).catch((err) => {
          log.warn('Auto-invoice failed', { orderId, error: (err as Error).message });
        });
      }
    }
  }

  return NextResponse.json({ ok: true, orderId, topic });
}

async function processOrderInline(orderId: string, shopId: string, webhookEventId: string): Promise<void> {
  try {
    await processOrder(orderId, { skipShipment: true });
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data:  { processed: true, processedAt: new Date() },
    });
  } catch (err) {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data:  { lastError: (err as Error).message, attempts: { increment: 1 } },
    });
    throw err;
  }
}

async function resolveShopId(domain: string): Promise<string> {
  const existing = await db.shop.findUnique({ where: { domain } });
  if (existing) return existing.id;

  const shopCfg = SHOP_CONFIGS.find(s => s.domain === domain);
  if (shopCfg) {
    const shop = await db.shop.create({
      data: { domain, accessToken: shopCfg.accessToken, active: true },
    });
    return shop.id;
  }

  const envDomain = process.env.SHOPIFY_DOMAIN       || '';
  const envToken  = process.env.SHOPIFY_ACCESS_TOKEN || '';
  if (envDomain === domain && envToken) {
    const shop = await db.shop.create({ data: { domain, accessToken: envToken, active: true } });
    return shop.id;
  }

  throw new Error(`Shop "${domain}" not found. Add SHOPIFY_DOMAIN + SHOPIFY_ACCESS_TOKEN to env.`);
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'shopify-webhooks' });
}
