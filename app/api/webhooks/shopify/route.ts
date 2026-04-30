/**
 * app/api/webhooks/shopify/route.ts — Shopify webhook receiver
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FACTURARE AUTOMATĂ — REGULA STRICTĂ                            ║
 * ║                                                                  ║
 * ║  Factura se generează AUTOMAT doar pentru:                       ║
 * ║    → orders/create  (comandă nouă plasată de client)             ║
 * ║                                                                  ║
 * ║  NICIODATĂ automat pentru:                                       ║
 * ║    → orders/updated  (sync, editare, note_attributes etc.)      ║
 * ║    → orders/paid     (plată ulterioară)                          ║
 * ║    → orders/fulfilled (expediere)                                ║
 * ║    → orders/cancelled (anulare)                                  ║
 * ║                                                                  ║
 * ║  Factura manuală: buton "Generează factură" din xConnector UI   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Flow:
 *  1. Read raw body (must NOT use req.json() — needed for HMAC)
 *  2. Verify HMAC signature
 *  3. Deduplicate via WebhookEvent.shopifyEventId
 *  4. Upsert Order in DB
 *  5. For orders/create ONLY: auto-generate invoice (async, non-blocking)
 *  6. Return 200 immediately (Shopify requires < 5s)
 */

import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { verifyShopifyWebhook, extractWebhookHeaders } from '@/lib/security/webhook';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  upsertOrderFromWebhook,
  type WebhookOrderPayload,
} from '@/lib/services/order-processor';
import { SHOP_CONFIGS } from '@/lib/shops';

// Citeste autoInvoice din Redis — cheie globala, se aplica la toate shop-urile
async function isAutoInvoiceEnabled(shopDomain: string): Promise<boolean> {
  try {
    // Find shop key from domain
    const shopCfg = SHOP_CONFIGS.find(s => s.domain === shopDomain);
    const shopKey  = shopCfg?.key ?? 'ro';

    // Read from PostgreSQL (WebhookEvent used as KV store — same as settings/route.js)
    const record = await db.webhookEvent.findUnique({
      where: { shopifyEventId: `settings:${shopKey}` },
    });

    if (!record) {
      log.info('No autoInvoice setting in DB', { shopDomain, shopKey });
      return false;
    }

    const payload = record.payload as Record<string, unknown>;
    const enabled = Boolean(payload?.autoInvoice);
    log.info('autoInvoice setting from DB', { shopKey, enabled });
    return enabled;
  } catch (e) {
    log.error('isAutoInvoiceEnabled error', { error: (e as Error).message });
    return false;
  }
}

const log = logger.child({ module: 'webhooks/shopify' });

// Topics we handle (others are acknowledged and immediately ignored)
const HANDLED_TOPICS = new Set([
  'orders/create',
  'orders/paid',
  'orders/fulfilled',
  'orders/updated',
  'orders/cancelled',
]);

// Topics that trigger automatic invoice generation
const AUTO_INVOICE_TOPICS = new Set(['orders/create', 'orders/paid']);

export async function POST(request: Request) {
  // ── 1. Read raw body for HMAC verification ──────────────────────────────
  const rawBodyBuffer = Buffer.from(await request.arrayBuffer());

  // ── 2. Extract & verify headers ─────────────────────────────────────────
  const { topic, shopDomain, eventId, hmac } = extractWebhookHeaders(request);

  if (!verifyShopifyWebhook(rawBodyBuffer, hmac)) {
    log.warn('Webhook HMAC verification failed', { shopDomain, topic, eventId });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 3. Parse payload ─────────────────────────────────────────────────────
  let payload: WebhookOrderPayload;
  try {
    payload = JSON.parse(rawBodyBuffer.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  log.info('Webhook received', { topic, shopDomain, eventId, orderId: payload.id });

  // ── 4. Deduplicate via WebhookEvent ──────────────────────────────────────
  const existingEvent = await db.webhookEvent.findUnique({
    where: { shopifyEventId: eventId },
  });

  if (existingEvent?.processed) {
    log.info('Webhook already processed — skipping', { eventId });
    return NextResponse.json({ ok: true, status: 'duplicate' });
  }

  // ── 5. Resolve or create Shop row ────────────────────────────────────────
  const shopId = await resolveShopId(shopDomain);

  // ── 6. Persist WebhookEvent ──────────────────────────────────────────────
  const webhookEvent = await db.webhookEvent.upsert({
    where:  { shopifyEventId: eventId },
    create: {
      shopifyEventId: eventId,
      topic,
      shopDomain,
      shopId,
      payload: payload as object,
    },
    update: { attempts: { increment: 1 } },
  });

  // ── 7. Skip non-order topics ─────────────────────────────────────────────
  if (!HANDLED_TOPICS.has(topic)) {
    log.info('Topic not handled — acknowledging', { topic });
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data:  { processed: true, processedAt: new Date() },
    });
    return NextResponse.json({ ok: true, status: 'ignored' });
  }

  // ── 8. Upsert order in DB ────────────────────────────────────────────────
  let orderId: string;
  try {
    orderId = await upsertOrderFromWebhook(shopId, shopDomain, payload);

    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data:  { orderId },
    });
  } catch (err) {
    log.error('Failed to upsert order', { error: (err as Error).message });
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data:  { lastError: (err as Error).message },
    });
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  // ── 9. Mark webhook as processed ─────────────────────────────────────────
  await db.webhookEvent.update({
    where: { id: webhookEvent.id },
    data:  { processed: true, processedAt: new Date() },
  }).catch(() => {});

  // ── 10. Auto-invoice for new orders and paid orders ─────────────────────────
  if (AUTO_INVOICE_TOPICS.has(topic)) {
    const autoEnabled = await isAutoInvoiceEnabled(shopDomain);
    log.info('Auto-invoice check', { shopDomain, autoEnabled, orderId });
    if (autoEnabled) {
      const hasInvoice = await db.invoice.findFirst({ where: { orderId } });
      if (!hasInvoice) {
        log.info('Triggering auto-invoice for new order', { orderId });
        generateInvoiceAsync(orderId, shopDomain).catch((err) => {
          log.warn('Auto-invoice failed', { orderId, error: (err as Error).message });
        });
      } else {
        log.info('Order already has invoice — skipping', { orderId });
      }
    }
  }

  // ── 11. Acknowledge to Shopify ───────────────────────────────────────────
  return NextResponse.json({ ok: true, orderId, topic });
}

// ─── Auto-invoice: cheama direct ensureInvoice (identic cu butonul din UI) ───

async function generateInvoiceAsync(orderId: string, shopDomain: string): Promise<void> {
  const { ensureInvoice } = await import('@/lib/services/invoice-service');
  const { SHOP_CONFIGS } = await import('@/lib/shops');

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error(`Order ${orderId} not found`);

  const shopCfg = SHOP_CONFIGS.find(s => s.domain === shopDomain);
  if (!shopCfg) throw new Error(`Shop config not found for domain ${shopDomain}`);

  // Tipul de plată vine direct din Shopify (paymentGateway salvat la webhook)
  // payment_gateway examples: 'bogus', 'stripe', 'paypal', 'manual', 'cash_on_delivery', 'gift_card'
  const gw = (order.paymentGateway || '').toLowerCase();
  const isCashOnDelivery = gw.includes('cash') || gw.includes('ramburs') ||
                           gw.includes('cod') || gw === 'manual' || !order.isPaid;

  // withCollection: true dacă e plătit online (nu ramburs)
  // paymentType: determinat din gateway-ul Shopify
  const withCollection = order.isPaid && !isCashOnDelivery;
  const paymentType = withCollection ? 'Card' : undefined;

  log.info('Auto-invoice payment type', {
    gateway: order.paymentGateway,
    isPaid: order.isPaid,
    isCashOnDelivery,
    withCollection,
    paymentType,
  });

  log.info('Auto-invoice: same as manual button', { orderId, withCollection, paymentType });

  const result = await ensureInvoice(
    order,
    shopCfg.accessToken,
    shopDomain,
    withCollection,
    true,      // useStock = true
    undefined, // lineItems din DB
    paymentType,
  );

  log.info('Auto-invoice created', {
    orderId,
    invoice: `${result.invoice.series}${result.invoice.number}`,
    collected: result.collected,
  });
}

// ─── Shop resolution ──────────────────────────────────────────────────────────

async function resolveShopId(domain: string): Promise<string> {
  const existing = await db.shop.findUnique({ where: { domain } });
  if (existing) return existing.id;

  const shopCfg = SHOP_CONFIGS.find(s => s.domain === domain);
  if (shopCfg) {
    const shop = await db.shop.create({
      data: { domain, accessToken: shopCfg.accessToken, active: true },
    });
    log.info('Auto-created shop from multi-shop config', { domain, shopId: shop.id });
    return shop.id;
  }

  const envDomain = process.env.SHOPIFY_DOMAIN       || '';
  const envToken  = process.env.SHOPIFY_ACCESS_TOKEN || '';

  if (envDomain === domain && envToken) {
    const shop = await db.shop.create({
      data: { domain, accessToken: envToken, active: true },
    });
    log.info('Auto-created shop from env vars', { domain, shopId: shop.id });
    return shop.id;
  }

  throw new Error(
    `Shop "${domain}" not found in DB or env vars. ` +
    'Add SHOPIFY_DOMAIN_HU + SHOPIFY_ACCESS_TOKEN_HU to environment.',
  );
}

// ─── GET — health check ───────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'shopify-webhooks',
    autoInvoiceTopics: Array.from(AUTO_INVOICE_TOPICS),
    processInlineEnabled: process.env.PROCESS_INLINE === 'true',
  });
}