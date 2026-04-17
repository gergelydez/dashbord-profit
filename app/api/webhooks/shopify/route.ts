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
  processOrder,
  type WebhookOrderPayload,
} from '@/lib/services/order-processor';
import { SHOP_CONFIGS } from '@/lib/shops';
import { promises as fs } from 'fs';
import path from 'path';

const SETTINGS_FILE = path.join(process.cwd(), 'xconnector-settings.json');

async function isAutoInvoiceEnabled(shopDomain: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const settings = JSON.parse(raw);
    // Map domain → shop key
    const shopCfg = SHOP_CONFIGS.find(s => s.domain === shopDomain);
    const key = shopCfg?.key ?? 'ro';
    return Boolean(settings[key]?.autoInvoice);
  } catch {
    // Fallback to env var if settings file doesn't exist yet
    return process.env.PROCESS_INLINE === 'true';
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

// The ONLY topic that triggers automatic invoice generation
const AUTO_INVOICE_TOPIC = 'orders/create';

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

  // ── 10. Auto-invoice ONLY for brand new orders ────────────────────────────
  //
  // STRICT: topic must be 'orders/create' AND auto-invoice must be enabled
  // in xConnector settings (per shop toggle) OR via PROCESS_INLINE env var.
  // orders/updated, orders/paid, etc. → NO auto-invoice, ever.
  //
  if (topic === AUTO_INVOICE_TOPIC && process.env.SMARTBILL_EMAIL) {
    const autoEnabled = await isAutoInvoiceEnabled(shopDomain);
    if (autoEnabled) {
      const hasInvoice = await db.invoice.findFirst({ where: { orderId } });
      if (!hasInvoice) {
        processOrderInline(orderId, shopId, webhookEvent.id).catch((err) => {
          log.warn('Auto-invoice failed for new order', {
            orderId, topic, error: (err as Error).message,
          });
        });
      } else {
        log.info('Order already has invoice — skipping auto-generation', { orderId });
      }
    }
  }

  // ── 11. Acknowledge to Shopify ───────────────────────────────────────────
  return NextResponse.json({ ok: true, orderId, topic });
}

// ─── Inline processing (called only for orders/create) ───────────────────────

async function processOrderInline(
  orderId:        string,
  shopId:         string,
  webhookEventId: string,
): Promise<void> {
  const logInline = log.child({ orderId, shopId });
  try {
    logInline.info('Auto-generating invoice for new order');
    await processOrder(orderId, { skipShipment: true }); // invoice only, AWB = manual
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data:  { processed: true, processedAt: new Date() },
    });
    logInline.info('Auto-invoice complete');
  } catch (err) {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data:  { lastError: (err as Error).message, attempts: { increment: 1 } },
    });
    throw err;
  }
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
    autoInvoiceTopic: AUTO_INVOICE_TOPIC,
    processInlineEnabled: process.env.PROCESS_INLINE === 'true',
  });
}
