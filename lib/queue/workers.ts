/**
 * lib/queue/workers.ts — BullMQ worker definitions
 *
 * Each worker runs in the background process started by worker-runner.ts.
 * Workers are NOT imported by Next.js route handlers (they're server-side long-running).
 *
 * Concurrency:
 *  - order-processing:    2 concurrent jobs (I/O bound: Shopify + courier APIs)
 *  - invoice-generation:  3 concurrent jobs
 *  - shipment-generation: 3 concurrent jobs
 *
 * Error handling:
 *  - BullMQ retries with exponential backoff (configured per-job in queues.ts)
 *  - After maxAttempts, job lands in the "failed" set
 *  - Admin can requeue from /api/admin/reprocess
 */

import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { processOrder } from '@/lib/services/order-processor';
import { ensureInvoice } from '@/lib/services/invoice-service';
import { ensureShipment } from '@/lib/services/shipment-service';
import { db } from '@/lib/db';
import {
  QUEUE_ORDER_PROCESSING,
  QUEUE_INVOICE_GENERATION,
  QUEUE_SHIPMENT_GENERATION,
  type OrderProcessingJobData,
  type InvoiceJobData,
  type ShipmentJobData,
} from './queues';

// ─── Shared worker options ────────────────────────────────────────────────────

function workerOpts(concurrency: number) {
  return {
    connection:  getRedisConnection(),
    concurrency,
    // Prevent stalled job detection from firing too aggressively
    lockDuration:    30_000,  // 30s lock per job
    stalledInterval: 60_000,  // check for stalled jobs every 60s
  };
}

// ─── Order Processing Worker ──────────────────────────────────────────────────

export function createOrderProcessingWorker(): Worker {
  const log = logger.child({ module: 'worker', queue: QUEUE_ORDER_PROCESSING });

  const worker = new Worker<OrderProcessingJobData>(
    QUEUE_ORDER_PROCESSING,
    async (job: Job<OrderProcessingJobData>) => {
      log.info('Processing order job', { jobId: job.id, orderId: job.data.orderId });

      // Update attempt count in JobLog
      await db.jobLog.updateMany({
        where: { jobId: job.id! },
        data:  { attempts: job.attemptsMade + 1, status: 'ACTIVE', startedAt: new Date() },
      }).catch(() => {});

      const result = await processOrder(job.data.orderId, {
        courier:        job.data.courier,
        courierOptions: job.data.courierOptions,
        skipInvoice:    job.data.skipInvoice,
        skipShipment:   job.data.skipShipment,
        jobId:          job.id,
      });

      log.info('Order job complete', {
        jobId:          job.id,
        orderName:      result.orderName,
        trackingNumber: result.trackingNumber,
        invoiceNumber:  result.invoiceNumber,
        fulfilled:      result.fulfilled,
      });

      return result;
    },
    workerOpts(2),
  );

  attachWorkerEventHandlers(worker, QUEUE_ORDER_PROCESSING, log);
  return worker;
}

// ─── Invoice Generation Worker ────────────────────────────────────────────────

export function createInvoiceGenerationWorker(): Worker {
  const log = logger.child({ module: 'worker', queue: QUEUE_INVOICE_GENERATION });

  const worker = new Worker<InvoiceJobData>(
    QUEUE_INVOICE_GENERATION,
    async (job: Job<InvoiceJobData>) => {
      log.info('Invoice generation job', { jobId: job.id, orderId: job.data.orderId });

      const order = await db.order.findUniqueOrThrow({ where: { id: job.data.orderId } });
      const shop  = await db.shop.findUniqueOrThrow({ where: { id: job.data.shopId } });

      const result = await ensureInvoice(order, shop.accessToken, shop.domain);

      log.info('Invoice job complete', {
        jobId:    job.id,
        invoiceId: result.invoice.id,
        number:   result.invoice.number,
      });

      return { invoiceId: result.invoice.id, number: result.invoice.number };
    },
    workerOpts(3),
  );

  attachWorkerEventHandlers(worker, QUEUE_INVOICE_GENERATION, log);
  return worker;
}

// ─── Shipment Generation Worker ───────────────────────────────────────────────

export function createShipmentGenerationWorker(): Worker {
  const log = logger.child({ module: 'worker', queue: QUEUE_SHIPMENT_GENERATION });

  const worker = new Worker<ShipmentJobData>(
    QUEUE_SHIPMENT_GENERATION,
    async (job: Job<ShipmentJobData>) => {
      log.info('Shipment generation job', { jobId: job.id, orderId: job.data.orderId });

      const order = await db.order.findUniqueOrThrow({ where: { id: job.data.orderId } });
      const shop  = await db.shop.findUniqueOrThrow({ where: { id: job.data.shopId } });

      const result = await ensureShipment(
        order,
        shop.accessToken,
        shop.domain,
        job.data.courier,
        job.data.courierOptions,
      );

      log.info('Shipment job complete', {
        jobId:      job.id,
        shipmentId: result.shipment.id,
        awb:        result.shipment.trackingNumber,
      });

      return { shipmentId: result.shipment.id, awb: result.shipment.trackingNumber };
    },
    workerOpts(3),
  );

  attachWorkerEventHandlers(worker, QUEUE_SHIPMENT_GENERATION, log);
  return worker;
}

// ─── Event handler helper ─────────────────────────────────────────────────────

function attachWorkerEventHandlers(
  worker: Worker,
  queueName: string,
  log: ReturnType<typeof logger.child>,
): void {
  worker.on('failed', (job, err) => {
    log.error('Job failed (final or interim)', {
      jobId:    job?.id,
      attempts: job?.attemptsMade,
      error:    err.message,
    });
  });

  worker.on('error', (err) => {
    // Worker-level errors (e.g. Redis disconnected)
    log.error(`Worker error in ${queueName}`, { error: err.message });
  });

  worker.on('stalled', (jobId) => {
    log.warn('Job stalled (will be re-queued)', { jobId });
  });
}
