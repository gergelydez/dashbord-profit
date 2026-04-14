/**
 * lib/services/order-processor.ts — Main orchestration engine
 *
 * This is the brain of the xConnector system. It is called by:
 *  - BullMQ worker (async, preferred for self-hosted)
 *  - Webhook handler directly (sync mode for serverless/Vercel via PROCESS_INLINE=true)
 *  - Admin manual-trigger endpoint
 *
 * Flow per order:
 *  1. Fetch order from DB
 *  2. Skip cancelled orders
 *  3. Ensure invoice (idempotent)
 *  4. Ensure shipment (idempotent)
 *  5. Update order status
 *  6. Log to JobLog
 *
 * Each step is idempotent: re-running after a partial failure is safe.
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ensureInvoice } from './invoice-service';
import { ensureShipment } from './shipment-service';
import type { Order } from '@prisma/client';

export interface ProcessOrderOptions {
  /** Skip invoice generation even if not created yet */
  skipInvoice?:   boolean;
  /** Skip AWB generation */
  skipShipment?:  boolean;
  /** Override courier (default: DEFAULT_COURIER env var) */
  courier?:       string;
  /** Extra courier options forwarded to adapter */
  courierOptions?: Record<string, unknown>;
  /** BullMQ job ID for audit logging */
  jobId?:          string;
}

export interface ProcessOrderResult {
  orderId:        string;
  orderName:      string;
  invoiceId?:     string;
  invoiceNumber?: string;
  shipmentId?:    string;
  trackingNumber?: string;
  fulfilled:      boolean;
  errors:         string[];
}

/**
 * Process a single order end-to-end.
 * Logs start/completion to JobLog table.
 */
export async function processOrder(
  orderId: string,
  opts: ProcessOrderOptions = {},
): Promise<ProcessOrderResult> {
  const log = logger.child({ module: 'order-processor', orderId });
  const errors: string[] = [];
  const result: ProcessOrderResult = {
    orderId,
    orderName: '',
    fulfilled: false,
    errors,
  };

  // ── Create / update job log ────────────────────────────────────────────────
  const jobLog = await db.jobLog.create({
    data: {
      jobId:   opts.jobId ?? `manual-${Date.now()}`,
      queue:   'order-processing',
      jobName: 'processOrder',
      status:  'ACTIVE',
      orderId,
      attempts: 1,
      inputData: { skipInvoice: opts.skipInvoice, skipShipment: opts.skipShipment, courier: opts.courier },
      startedAt: new Date(),
    },
  });

  try {
    // ── Fetch order ──────────────────────────────────────────────────────────
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new Error(`Order ${orderId} not found in database`);
    }

    result.orderName = order.shopifyName;
    log.info('Processing order', { orderName: order.shopifyName, status: order.status });

    // ── Guard: already fully processed ────────────────────────────────────────
    if (order.status === 'FULFILLED') {
      log.info('Order already fulfilled — skipping');
      await finalizeJobLog(jobLog.id, 'COMPLETED', { skipped: true });
      result.fulfilled = true;
      return result;
    }

    // ── Guard: cancelled order ────────────────────────────────────────────────
    if (order.status === 'CANCELLED') {
      log.info('Order is cancelled — skipping');
      await finalizeJobLog(jobLog.id, 'COMPLETED', { skipped: true, reason: 'cancelled' });
      return result;
    }

    // ── Mark as processing ────────────────────────────────────────────────────
    await db.order.update({ where: { id: orderId }, data: { status: 'PROCESSING' } });

    // ── Resolve Shopify credentials ───────────────────────────────────────────
    const { shopifyDomain, shopifyAccessToken } = await resolveShopifyCredentials(order);

    // ── Step 1: Invoice ───────────────────────────────────────────────────────
    if (!opts.skipInvoice && !order.invoiceCreated) {
      try {
        const invoiceResult = await ensureInvoice(order, shopifyAccessToken, shopifyDomain);
        result.invoiceId     = invoiceResult.invoice.id;
        result.invoiceNumber = `${invoiceResult.invoice.series}${invoiceResult.invoice.number}`;
        log.info('Invoice step complete', { invoiceNumber: result.invoiceNumber });
      } catch (err) {
        const msg = `Invoice generation failed: ${(err as Error).message}`;
        log.error(msg);
        errors.push(msg);

        // Partial failure: invoice failed but we can still try the shipment
        await db.order.update({
          where: { id: orderId },
          data:  { status: 'FAILED', processingError: msg },
        });
        // Re-throw so BullMQ retries the whole job
        throw err;
      }
    } else if (order.invoiceCreated) {
      // Fetch existing invoice
      const inv = await db.invoice.findFirst({
        where: { orderId, status: { in: ['CREATED', 'COLLECTED'] } },
      });
      if (inv) {
        result.invoiceId     = inv.id;
        result.invoiceNumber = `${inv.series}${inv.number}`;
      }
    }

    // ── Step 2: Shipment / AWB ────────────────────────────────────────────────
    if (!opts.skipShipment && !order.shipmentCreated) {
      try {
        // Re-fetch order after invoice update (status may have changed)
        const freshOrder = await db.order.findUniqueOrThrow({ where: { id: orderId } });

        const shipResult = await ensureShipment(
          freshOrder,
          shopifyAccessToken,
          shopifyDomain,
          opts.courier,
          opts.courierOptions,
        );
        result.shipmentId     = shipResult.shipment.id;
        result.trackingNumber = shipResult.shipment.trackingNumber;
        result.fulfilled      = shipResult.shopifyUpdated;
        log.info('Shipment step complete', { awb: result.trackingNumber });
      } catch (err) {
        const msg = `AWB generation failed: ${(err as Error).message}`;
        log.error(msg);
        errors.push(msg);

        await db.order.update({
          where: { id: orderId },
          data:  {
            status:         'FAILED',
            processingError: msg,
            // Invoice was created, so preserve that flag
          },
        });
        throw err;
      }
    } else if (order.shipmentCreated) {
      const ship = await db.shipment.findFirst({
        where: { orderId, status: { in: ['CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] } },
      });
      if (ship) {
        result.shipmentId     = ship.id;
        result.trackingNumber = ship.trackingNumber;
        result.fulfilled      = order.fulfilled;
      }
    }

    // ── All steps done ────────────────────────────────────────────────────────
    log.info('Order processing complete', {
      invoiceNumber:  result.invoiceNumber,
      trackingNumber: result.trackingNumber,
      fulfilled:      result.fulfilled,
    });

    await finalizeJobLog(jobLog.id, 'COMPLETED', {
      invoiceId:     result.invoiceId,
      shipmentId:    result.shipmentId,
      trackingNumber: result.trackingNumber,
    });

  } catch (err) {
    const msg = (err as Error).message;
    errors.push(msg);
    log.error('Order processing failed', { error: msg });
    await finalizeJobLog(jobLog.id, 'FAILED', { error: msg });
    throw err; // propagate to BullMQ for retry
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resolveShopifyCredentials(
  order: Order,
): Promise<{ shopifyDomain: string; shopifyAccessToken: string }> {
  // Try env vars first (single-shop mode)
  const envDomain = process.env.SHOPIFY_DOMAIN        || '';
  const envToken  = process.env.SHOPIFY_ACCESS_TOKEN  || '';

  if (envDomain && envToken) {
    return { shopifyDomain: envDomain, shopifyAccessToken: envToken };
  }

  // Multi-shop: look up the shop record
  const shop = await db.shop.findUnique({ where: { id: order.shopId } });
  if (!shop) {
    throw new Error(`Shop ${order.shopId} not found in database`);
  }
  return { shopifyDomain: shop.domain, shopifyAccessToken: shop.accessToken };
}

async function finalizeJobLog(
  id:         string,
  status:     'COMPLETED' | 'FAILED',
  outputData: Record<string, unknown>,
): Promise<void> {
  await db.jobLog.update({
    where: { id },
    data: {
      status,
      outputData,
      completedAt: new Date(),
    },
  });
}

// ─── Webhook → Order upsert ───────────────────────────────────────────────────
// Called from the webhook handler to persist the Shopify order before queuing.

export interface WebhookOrderPayload {
  id:                   number;
  name:                 string;
  admin_graphql_api_id?: string;
  email?:               string;
  phone?:               string;
  financial_status:     string;
  fulfillment_status?:  string | null;
  payment_gateway?:     string;
  total_price:          string;
  currency?:            string;
  created_at?:          string;
  cancelled_at?:        string | null;
  note_attributes?:     Array<{ name: string; value: string }>;
  tags?:                string;
  shipping_address?: {
    name?:     string;
    address1?: string;
    address2?: string;
    city?:     string;
    province?: string;
    zip?:      string;
    country?:  string;
    phone?:    string;
  };
  billing_address?: {
    name?:  string;
    phone?: string;
  };
  line_items?: Array<{
    name?:     string;
    quantity?: number;
    price?:    string;
    sku?:      string;
    variant?: { sku?: string };
  }>;
}

/**
 * Upsert a Shopify order into our DB from a webhook payload.
 * Returns the DB order ID.
 */
export async function upsertOrderFromWebhook(
  shopId:     string,
  shopDomain: string,
  payload:    WebhookOrderPayload,
): Promise<string> {
  const log = logger.child({ module: 'order-processor', shopifyId: payload.id });

  const addr  = payload.shipping_address ?? payload.billing_address ?? {};
  const phone = payload.phone
    ?? payload.shipping_address?.phone
    ?? payload.billing_address?.phone
    ?? '';

  const lineItems = (payload.line_items ?? []).map((i) => ({
    name:  i.name  ?? '',
    sku:   i.variant?.sku ?? i.sku ?? '',
    qty:   i.quantity ?? 1,
    price: parseFloat(i.price ?? '0'),
  }));

  const isPaid = (payload.financial_status ?? '').toLowerCase() === 'paid';
  const isCancelled = !!payload.cancelled_at;

  const data = {
    shopId,
    shopifyId:        String(payload.id),
    shopifyName:      payload.name ?? '',
    shopifyGid:       payload.admin_graphql_api_id ?? null,
    financialStatus:  payload.financial_status ?? '',
    totalPrice:       parseFloat(payload.total_price ?? '0'),
    currency:         payload.currency ?? 'RON',
    isPaid,
    paymentGateway:   payload.payment_gateway ?? '',
    fulfillmentStatus: payload.fulfillment_status ?? null,
    customerName:     (addr as { name?: string }).name ?? '',
    customerEmail:    payload.email ?? '',
    customerPhone:    phone,
    shippingAddress1: (addr as { address1?: string }).address1 ?? '',
    shippingAddress2: (addr as { address2?: string }).address2 ?? '',
    shippingCity:     (addr as { city?: string }).city ?? '',
    shippingProvince: (addr as { province?: string }).province ?? '',
    shippingZip:      ((addr as { zip?: string }).zip ?? '').replace(/\s/g, ''),
    shippingCountry:  (addr as { country?: string }).country ?? 'RO',
    lineItems,
    rawPayload:       payload as object,
    status:           (isCancelled ? 'CANCELLED' : 'PENDING') as 'CANCELLED' | 'PENDING',
    shopifyCreatedAt: payload.created_at ? new Date(payload.created_at) : null,
  };

  const order = await db.order.upsert({
    where:  { shopId_shopifyId: { shopId, shopifyId: String(payload.id) } },
    create: data,
    update: {
      // Only update mutable fields — don't reset processing flags
      financialStatus:  data.financialStatus,
      totalPrice:       data.totalPrice,
      isPaid:           data.isPaid,
      fulfillmentStatus: data.fulfillmentStatus,
      customerName:     data.customerName,
      customerEmail:    data.customerEmail,
      customerPhone:    data.customerPhone,
      shippingAddress1: data.shippingAddress1,
      shippingAddress2: data.shippingAddress2,
      shippingCity:     data.shippingCity,
      shippingProvince: data.shippingProvince,
      shippingZip:      data.shippingZip,
      rawPayload:       data.rawPayload,
      ...(isCancelled ? { status: 'CANCELLED' } : {}),
    },
  });

  log.info('Order upserted', { dbId: order.id, orderName: payload.name });
  return order.id;
}
