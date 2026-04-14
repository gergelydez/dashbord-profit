/**
 * app/api/admin/reprocess/route.ts — Reprocess failed orders / jobs
 *
 * POST /api/admin/reprocess
 *
 * Body options:
 *  { "type": "failed_orders", "limit": 50 }    — requeue all FAILED orders
 *  { "type": "order", "orderId": "UUID" }       — requeue one specific order
 *  { "type": "webhook", "webhookEventId": "UUID" } — replay a specific webhook
 *  { "type": "unprocessed_webhooks", "limit": 100 } — replay stuck webhook events
 *
 * Security: X-Connector-Key header required.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueueOrderProcessing } from '@/lib/queue/queues';
import {
  upsertOrderFromWebhook,
  type WebhookOrderPayload,
} from '@/lib/services/order-processor';

const log = logger.child({ module: 'api/admin/reprocess' });

function checkApiKey(request: Request): boolean {
  const key      = request.headers.get('x-connector-key') || '';
  const expected = process.env.CONNECTOR_SECRET || '';
  if (!key || !expected || key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as {
    type:             string;
    orderId?:         string;
    webhookEventId?:  string;
    limit?:           number;
    courier?:         string;
    courierOptions?:  Record<string, unknown>;
  };

  const { type, limit = 50 } = body;

  switch (type) {
    // ── Requeue all FAILED orders ─────────────────────────────────────────
    case 'failed_orders': {
      const failedOrders = await db.order.findMany({
        where:   { status: 'FAILED' },
        take:    Math.min(limit, 200),
        orderBy: { updatedAt: 'asc' },
      });

      const jobIds: string[] = [];
      for (const order of failedOrders) {
        // Reset status to PENDING so processor doesn't see it as already done
        await db.order.update({
          where: { id: order.id },
          data:  { status: 'PENDING', processingError: null },
        });

        const jobId = await enqueueOrderProcessing({
          orderId: order.id,
          shopId:  order.shopId,
          courier: body.courier,
        });
        jobIds.push(jobId);
      }

      log.info('Requeued failed orders', { count: failedOrders.length });
      return NextResponse.json({
        ok:      true,
        type,
        requeued: failedOrders.length,
        jobIds,
      });
    }

    // ── Requeue one specific order ─────────────────────────────────────────
    case 'order': {
      if (!body.orderId) {
        return NextResponse.json({ error: 'orderId required for type=order' }, { status: 400 });
      }

      const order = await db.order.findUnique({ where: { id: body.orderId } });
      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      }

      // Allow reprocessing from any failed/partial state
      if (['FAILED', 'INVOICE_CREATED', 'SHIPMENT_CREATED', 'PENDING'].includes(order.status)) {
        await db.order.update({
          where: { id: order.id },
          data:  { status: 'PENDING', processingError: null },
        });
      }

      const jobId = await enqueueOrderProcessing({
        orderId:        order.id,
        shopId:         order.shopId,
        courier:        body.courier,
        courierOptions: body.courierOptions,
      });

      log.info('Requeued order', { orderId: order.id, orderName: order.shopifyName });
      return NextResponse.json({ ok: true, type, orderId: order.id, jobId });
    }

    // ── Replay a single webhook event ──────────────────────────────────────
    case 'webhook': {
      if (!body.webhookEventId) {
        return NextResponse.json({ error: 'webhookEventId required' }, { status: 400 });
      }

      const event = await db.webhookEvent.findUnique({
        where: { id: body.webhookEventId },
      });
      if (!event) {
        return NextResponse.json({ error: 'WebhookEvent not found' }, { status: 404 });
      }

      // Replay: upsert order + enqueue
      const shopId = event.shopId!;
      const orderId = await upsertOrderFromWebhook(
        shopId,
        event.shopDomain,
        event.payload as unknown as WebhookOrderPayload,
      );

      await db.webhookEvent.update({
        where: { id: event.id },
        data:  { processed: false, attempts: { increment: 1 } },
      });

      const jobId = await enqueueOrderProcessing({ orderId, shopId });

      return NextResponse.json({ ok: true, type, orderId, jobId });
    }

    // ── Replay unprocessed / stuck webhook events ─────────────────────────
    case 'unprocessed_webhooks': {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000); // older than 5 minutes

      const stuckEvents = await db.webhookEvent.findMany({
        where: {
          processed:  false,
          topic:      { in: ['orders/create', 'orders/paid'] },
          createdAt:  { lt: cutoff },
          attempts:   { lt: 5 },  // don't retry infinitely
        },
        take:    Math.min(limit, 100),
        orderBy: { createdAt: 'asc' },
      });

      const results: Array<{ eventId: string; orderId: string; jobId: string }> = [];

      for (const event of stuckEvents) {
        try {
          const shopId = event.shopId!;
          const orderId = await upsertOrderFromWebhook(
            shopId,
            event.shopDomain,
            event.payload as unknown as WebhookOrderPayload,
          );
          const jobId = await enqueueOrderProcessing({ orderId, shopId });
          await db.webhookEvent.update({
            where: { id: event.id },
            data:  { attempts: { increment: 1 } },
          });
          results.push({ eventId: event.id, orderId, jobId });
        } catch (err) {
          log.error('Failed to replay webhook event', {
            eventId: event.id,
            error: (err as Error).message,
          });
        }
      }

      log.info('Replayed stuck webhook events', { count: results.length });
      return NextResponse.json({ ok: true, type, replayed: results.length, results });
    }

    default:
      return NextResponse.json(
        { error: `Unknown reprocess type: "${type}". Valid: failed_orders, order, webhook, unprocessed_webhooks` },
        { status: 400 },
      );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'admin/reprocess',
    types: ['failed_orders', 'order', 'webhook', 'unprocessed_webhooks'],
  });
}
