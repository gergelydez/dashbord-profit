/**
 * lib/queue/queues.ts — BullMQ queue definitions
 *
 * Three logical queues:
 *  - order-processing   : main orchestration (invoice + shipment + shopify update)
 *  - invoice-generation : standalone invoice-only jobs (admin manual trigger)
 *  - shipment-generation: standalone AWB-only jobs (admin manual trigger)
 *
 * All queues share the same Redis connection and use exponential backoff.
 *
 * Dead-letter: jobs that exceed maxAttempts land in the "failed" set in Redis.
 * A separate /api/admin/reprocess endpoint can replay them.
 */

import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';

// ─── Queue names ──────────────────────────────────────────────────────────────
export const QUEUE_ORDER_PROCESSING   = 'order-processing';
export const QUEUE_INVOICE_GENERATION = 'invoice-generation';
export const QUEUE_SHIPMENT_GENERATION = 'shipment-generation';

// ─── Default job options ──────────────────────────────────────────────────────
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type:  'exponential' as const,
    delay: 5000,   // 5s, 10s, 20s
  },
  removeOnComplete: { count: 500 },  // keep last 500 completed jobs
  removeOnFail:     { count: 1000 }, // keep last 1000 failed jobs (for replay)
};

// ─── Lazy queue instances ─────────────────────────────────────────────────────
// We use lazy init to avoid connecting to Redis at import time
// (important for Next.js server components that may not need queues).

let _orderQueue:    Queue | null = null;
let _invoiceQueue:  Queue | null = null;
let _shipmentQueue: Queue | null = null;

function getQueueConnection() {
  return { connection: getRedisConnection() };
}

export function getOrderQueue(): Queue {
  _orderQueue ??= new Queue(QUEUE_ORDER_PROCESSING, getQueueConnection());
  return _orderQueue;
}

export function getInvoiceQueue(): Queue {
  _invoiceQueue ??= new Queue(QUEUE_INVOICE_GENERATION, getQueueConnection());
  return _invoiceQueue;
}

export function getShipmentQueue(): Queue {
  _shipmentQueue ??= new Queue(QUEUE_SHIPMENT_GENERATION, getQueueConnection());
  return _shipmentQueue;
}

// ─── Job data types ───────────────────────────────────────────────────────────

export interface OrderProcessingJobData {
  orderId:         string;
  shopId:          string;
  courier?:        string;
  courierOptions?: Record<string, unknown>;
  skipInvoice?:    boolean;
  skipShipment?:   boolean;
}

export interface InvoiceJobData {
  orderId: string;
  shopId:  string;
}

export interface ShipmentJobData {
  orderId:         string;
  shopId:          string;
  courier?:        string;
  courierOptions?: Record<string, unknown>;
}

// ─── Enqueue helpers ──────────────────────────────────────────────────────────

/**
 * Push an order-processing job to the main queue.
 * Uses the orderId as the job ID to prevent duplicates (BullMQ dedup).
 */
export async function enqueueOrderProcessing(
  data: OrderProcessingJobData,
): Promise<string> {
  const q    = getOrderQueue();
  const log  = logger.child({ module: 'queue', orderId: data.orderId });

  const job = await q.add(
    'processOrder',
    data,
    {
      ...DEFAULT_JOB_OPTIONS,
      // Deduplicate: if a job for this orderId is already queued/active, skip
      jobId: `order-${data.orderId}`,
    },
  );

  // Log to JobLog table for observability
  try {
    await db.jobLog.create({
      data: {
        jobId:     job.id ?? `order-${data.orderId}`,
        queue:     QUEUE_ORDER_PROCESSING,
        jobName:   'processOrder',
        status:    'PENDING',
        orderId:   data.orderId,
        shopId:    data.shopId,
        inputData: data as object,
        maxAttempts: DEFAULT_JOB_OPTIONS.attempts,
      },
    });
  } catch (err) {
    // Non-critical: job is already queued even if DB log fails
    log.warn('Failed to create JobLog entry', { error: (err as Error).message });
  }

  log.info('Order enqueued', { jobId: job.id });
  return job.id ?? '';
}

/**
 * Push a standalone invoice-generation job.
 */
export async function enqueueInvoiceGeneration(data: InvoiceJobData): Promise<string> {
  const q   = getInvoiceQueue();
  const job = await q.add('generateInvoice', data, {
    ...DEFAULT_JOB_OPTIONS,
    jobId: `invoice-${data.orderId}`,
  });
  return job.id ?? '';
}

/**
 * Push a standalone shipment-generation job.
 */
export async function enqueueShipmentGeneration(data: ShipmentJobData): Promise<string> {
  const q   = getShipmentQueue();
  const job = await q.add('generateShipment', data, {
    ...DEFAULT_JOB_OPTIONS,
    jobId: `shipment-${data.orderId}`,
  });
  return job.id ?? '';
}

// ─── Queue health check ───────────────────────────────────────────────────────

export async function getQueueStats(): Promise<Record<string, unknown>> {
  try {
    const q = getOrderQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getCompletedCount(),
      q.getFailedCount(),
      q.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  } catch {
    return { error: 'Redis unavailable' };
  }
}

// ─── Queue events (for observability) ────────────────────────────────────────

/**
 * Attach completion/failure listeners to all queues.
 * Called once from worker-runner.ts.
 */
export function attachQueueEventListeners(): void {
  const log = logger.child({ module: 'queue-events' });

  for (const queueName of [
    QUEUE_ORDER_PROCESSING,
    QUEUE_INVOICE_GENERATION,
    QUEUE_SHIPMENT_GENERATION,
  ]) {
    const events = new QueueEvents(queueName, getQueueConnection());

    events.on('completed', ({ jobId, returnvalue }) => {
      log.info('Job completed', { queue: queueName, jobId, result: String(returnvalue).slice(0, 100) });
      updateJobLogStatus(jobId, 'COMPLETED').catch(() => {});
    });

    events.on('failed', ({ jobId, failedReason }) => {
      log.error('Job failed', { queue: queueName, jobId, reason: failedReason });
      updateJobLogStatus(jobId, 'FAILED', failedReason).catch(() => {});
    });

    events.on('stalled', ({ jobId }) => {
      log.warn('Job stalled', { queue: queueName, jobId });
    });
  }
}

async function updateJobLogStatus(
  jobId:  string,
  status: 'COMPLETED' | 'FAILED',
  error?: string,
): Promise<void> {
  await db.jobLog.updateMany({
    where: { jobId },
    data:  {
      status,
      ...(error ? { error } : {}),
      ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
    },
  });
}
