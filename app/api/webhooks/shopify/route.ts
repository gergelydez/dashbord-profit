/**
 * app/api/webhooks/shopify/route.ts — Shopify webhook receiver
 *
 * Handles: orders/create, orders/paid, orders/fulfilled
 *
 * Flow:
 *  1. Read raw body (must NOT use req.json() here — we need it for HMAC verification)
 *  2. Verify HMAC signature
 *  3. Deduplicate via WebhookEvent.shopifyEventId
 *  4. Upsert Order in DB
 *  5a. ASYNC: Push to BullMQ queue (preferred for self-hosted)
 *  5b. SYNC:  Process inline (fallback for Vercel / PROCESS_INLINE=true)
 *
 * IMPORTANT: Shopify expects a 200 within 5 seconds.
 * Always return 200 quickly and process async.
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
import { enqueueOrderProcessing } from '@/lib/queue/queues';
import { SHOP_CONFIGS } from '@/lib/shops';

const log = logger.child({ module: 'webhooks/shopify' });

// Topics we actually process (others are acknowledged but ignored)
const HANDLED_TOPICS = new Set(['orders/create', 'orders/paid', 'orders/fulfilled']);

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
      payload:        payload as object,
    },
    update: {
      attempts: { increment: 1 },
    },
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

    // Link WebhookEvent → Order
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data:  { orderId },
    });
  } catch (err) {
    log.error('Failed to upsert order', { error: (err as Error).message });
    // Mark event as failed so it can be retried
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data:  { lastError: (err as Error).message },
    });
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  // ── 9. Dispatch processing ───────────────────────────────────────────────
  const processInline = process.env.PROCESS_INLINE === 'true';

  if (processInline) {
    // Serverless mode: process synchronously (best effort within timeout)
    // Shopify gives us ~5s; we do async processing but catch errors
    processOrderInline(orderId, shopId, webhookEvent.id).catch((err) => {
      log.error('Inline processing failed', { orderId, error: (err as Error).message });
    });
  } else {
    // Queue mode: hand off to BullMQ worker
    try {
      await enqueueOrderProcessing({ orderId, shopId });
      log.info('Order enqueued for processing', { orderId });
    } catch (err) {
      // Queue unavailable? Fall back to inline
      log.warn('Queue unavailable, falling back to inline processing', {
        error: (err as Error).message,
      });
      processOrderInline(orderId, shopId, webhookEvent.id).catch(() => {});
    }
  }

  // ── 10. Acknowledge to Shopify immediately ───────────────────────────────
  return NextResponse.json({ ok: true, orderId });
}

// ─── Inline processing (serverless fallback) ─────────────────────────────────

async function processOrderInline(
  orderId:        string,
  shopId:         string,
  webhookEventId: string,
): Promise<void> {
  try {
    await processOrder(orderId);
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

// ─── Shop resolution ──────────────────────────────────────────────────────────

/**
 * Find or create a Shop row for the incoming webhook.
 * In single-shop mode, use env vars for the access token.
 * In multi-shop mode (OAuth), the shop should already exist.
 */
async function resolveShopId(domain: string): Promise<string> {
  const existing = await db.shop.findUnique({ where: { domain } });
  if (existing) return existing.id;

  // Try multi-shop config (SHOPIFY_DOMAIN_RO/HU env vars)
  const shopCfg = SHOP_CONFIGS.find(s => s.domain === domain);
  if (shopCfg) {
    const shop = await db.shop.create({
      data: { domain, accessToken: shopCfg.accessToken, active: true },
    });
    log.info('Auto-created shop from multi-shop config', { domain, shopId: shop.id });
    return shop.id;
  }

  // Fallback: single-shop mode from generic env vars
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
  return NextResponse.json({ ok: true, endpoint: 'shopify-webhooks' });
}
