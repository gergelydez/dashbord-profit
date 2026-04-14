/**
 * app/api/connector/status/route.ts — Order / job status endpoint
 *
 * GET /api/connector/status?orderId=UUID
 * GET /api/connector/status?shopifyOrderId=12345&shopDomain=store.myshopify.com
 *
 * Returns:
 * {
 *   order:    { id, name, status, invoiceCreated, shipmentCreated, fulfilled },
 *   invoice:  { id, series, number, invoiceUrl, pdfAvailable, collected } | null,
 *   shipment: { id, courier, trackingNumber, trackingUrl, labelUrl, status } | null,
 *   jobs:     [{ jobId, queue, status, attempts, error, completedAt }]
 * }
 *
 * Security: X-Connector-Key header required.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildInvoiceUrl, buildShippingLabelUrl } from '@/lib/security/tokens';
import { getQueueStats } from '@/lib/queue/queues';

function checkApiKey(request: Request): boolean {
  const key      = request.headers.get('x-connector-key') || '';
  const expected = process.env.CONNECTOR_SECRET || '';
  if (!key || !expected || key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const orderId        = searchParams.get('orderId');
  const shopifyOrderId = searchParams.get('shopifyOrderId');
  const shopDomain     = searchParams.get('shopDomain') || process.env.SHOPIFY_DOMAIN || '';

  // ── Resolve order ─────────────────────────────────────────────────────────
  let order;

  if (orderId) {
    order = await db.order.findUnique({ where: { id: orderId } });
  } else if (shopifyOrderId) {
    const shop = shopDomain ? await db.shop.findUnique({ where: { domain: shopDomain } }) : null;
    order = await db.order.findFirst({
      where: {
        shopifyId: shopifyOrderId,
        ...(shop ? { shopId: shop.id } : {}),
      },
    });
  }

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // ── Fetch related records ─────────────────────────────────────────────────
  const [invoices, shipments, jobs] = await Promise.all([
    db.invoice.findMany({
      where:   { orderId: order.id },
      orderBy: { createdAt: 'desc' },
      take:    5,
    }),
    db.shipment.findMany({
      where:   { orderId: order.id },
      orderBy: { createdAt: 'desc' },
      take:    5,
    }),
    db.jobLog.findMany({
      where:   { orderId: order.id },
      orderBy: { createdAt: 'desc' },
      take:    10,
    }),
  ]);

  // ── Build response ────────────────────────────────────────────────────────
  const latestInvoice  = invoices[0]  ?? null;
  const latestShipment = shipments[0] ?? null;

  return NextResponse.json({
    order: {
      id:               order.id,
      name:             order.shopifyName,
      status:           order.status,
      financialStatus:  order.financialStatus,
      isPaid:           order.isPaid,
      invoiceCreated:   order.invoiceCreated,
      shipmentCreated:  order.shipmentCreated,
      fulfilled:        order.fulfilled,
      processingError:  order.processingError,
      createdAt:        order.createdAt,
      updatedAt:        order.updatedAt,
    },

    invoice: latestInvoice ? {
      id:           latestInvoice.id,
      series:       latestInvoice.series,
      number:       latestInvoice.number,
      status:       latestInvoice.status,
      pdfAvailable: !!(latestInvoice.pdfStorageKey || latestInvoice.pdfData),
      invoiceUrl:   buildInvoiceUrl(latestInvoice.id),
      collected:    latestInvoice.collected,
      shopifyUpdated: latestInvoice.shopifyUpdated,
      createdAt:    latestInvoice.createdAt,
    } : null,

    shipment: latestShipment ? {
      id:             latestShipment.id,
      courier:        latestShipment.courier,
      trackingNumber: latestShipment.trackingNumber,
      trackingUrl:    latestShipment.trackingUrl,
      labelUrl:       buildShippingLabelUrl(latestShipment.id),
      labelAvailable: !!(latestShipment.labelStorageKey || latestShipment.labelData),
      status:         latestShipment.status,
      fulfillmentId:  latestShipment.fulfillmentId,
      shopifyUpdated: latestShipment.shopifyUpdated,
      createdAt:      latestShipment.createdAt,
    } : null,

    jobs: jobs.map((j) => ({
      jobId:       j.jobId,
      queue:       j.queue,
      status:      j.status,
      attempts:    j.attempts,
      maxAttempts: j.maxAttempts,
      error:       j.error,
      startedAt:   j.startedAt,
      completedAt: j.completedAt,
    })),

    // Queue stats (non-critical, may be null if Redis is down)
    queueStats: await getQueueStats().catch(() => null),
  });
}
