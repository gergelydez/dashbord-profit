/**
 * app/api/connector/process/route.ts — Manual order processing trigger
 *
 * POST /api/connector/process
 *
 * Body:
 * {
 *   "orderId":        "our-db-uuid",        // process by DB ID
 *   "shopifyOrderId": "1234567890",         // OR by Shopify order ID
 *   "shopDomain":     "store.myshopify.com",// required with shopifyOrderId
 *   "courier":        "gls",               // optional, default: DEFAULT_COURIER
 *   "courierOptions": {},                  // optional extra options
 *   "skipInvoice":    false,               // skip invoice step
 *   "skipShipment":   false,               // skip AWB step
 *   "async":          true                 // push to queue (default) or wait
 * }
 *
 * Used by:
 *  - Admin UI (manual process button)
 *  - Retry button for failed orders
 *  - Test flows
 *
 * Security: requires internal API key (X-Connector-Key header)
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { processOrder } from '@/lib/services/order-processor';
import { enqueueOrderProcessing } from '@/lib/queue/queues';

const log = logger.child({ module: 'api/connector/process' });

// Simple API key check for internal endpoints
function checkApiKey(request: Request): boolean {
  const key = request.headers.get('x-connector-key') || '';
  const expected = process.env.CONNECTOR_SECRET || '';
  // Constant-time comparison
  if (!key || !expected || key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) {
    diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    orderId:        rawOrderId,
    shopifyOrderId: rawShopifyId,
    shopDomain,
    courier,
    courierOptions  = {},
    skipInvoice     = false,
    skipShipment    = false,
    async:          asyncMode = true,
  } = body as {
    orderId?:        string;
    shopifyOrderId?: string;
    shopDomain?:     string;
    courier?:        string;
    courierOptions?: Record<string, unknown>;
    skipInvoice?:    boolean;
    skipShipment?:   boolean;
    async?:          boolean;
  };

  // ── Resolve orderId ───────────────────────────────────────────────────────
  let orderId = rawOrderId;

  if (!orderId && rawShopifyId) {
    // Look up by Shopify order ID
    const domain = shopDomain || process.env.SHOPIFY_DOMAIN || '';
    const shop   = domain ? await db.shop.findUnique({ where: { domain } }) : null;

    const order = await db.order.findFirst({
      where: {
        shopifyId: String(rawShopifyId),
        ...(shop ? { shopId: shop.id } : {}),
      },
    });

    if (!order) {
      return NextResponse.json(
        { error: `Order with Shopify ID ${rawShopifyId} not found in database` },
        { status: 404 },
      );
    }
    orderId = order.id;
  }

  if (!orderId) {
    return NextResponse.json(
      { error: 'Provide either orderId or shopifyOrderId' },
      { status: 400 },
    );
  }

  // ── Verify order exists ───────────────────────────────────────────────────
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ error: `Order ${orderId} not found` }, { status: 404 });
  }

  log.info('Manual process trigger', {
    orderId,
    orderName:   order.shopifyName,
    asyncMode,
    courier,
    skipInvoice,
    skipShipment,
  });

  const opts = {
    courier:        typeof courier === 'string' ? courier : undefined,
    courierOptions: courierOptions as Record<string, unknown>,
    skipInvoice:    Boolean(skipInvoice),
    skipShipment:   Boolean(skipShipment),
  };

  // ── Async mode: push to queue and return immediately ─────────────────────
  if (asyncMode) {
    const jobId = await enqueueOrderProcessing({
      orderId,
      shopId: order.shopId,
      ...opts,
    });

    return NextResponse.json({
      ok:      true,
      orderId,
      jobId,
      status:  'queued',
      message: `Order ${order.shopifyName} enqueued for processing`,
    });
  }

  // ── Sync mode: wait for completion (admin tools / testing) ────────────────
  try {
    const result = await processOrder(orderId, opts);
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    log.error('Sync processing failed', { orderId, error: (err as Error).message });
    return NextResponse.json(
      { ok: false, error: (err as Error).message, orderId },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'connector/process' });
}
