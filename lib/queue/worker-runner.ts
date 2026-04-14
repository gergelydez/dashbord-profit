/**
 * lib/queue/worker-runner.ts — Standalone worker process entry point
 *
 * Run with:   npm run worker
 * Or:         node --loader ts-node/esm lib/queue/worker-runner.ts
 *
 * This process is separate from Next.js (they share Redis + DB but nothing else).
 * In Docker: run as a separate container/service.
 * On Vercel:  not needed (use PROCESS_INLINE=true for serverless processing).
 *
 * The process handles SIGTERM / SIGINT gracefully:
 *  - Stops accepting new jobs
 *  - Waits for in-progress jobs to finish (up to 30s)
 *  - Closes DB + Redis connections
 */

import { logger } from '@/lib/logger';
import {
  createOrderProcessingWorker,
  createInvoiceGenerationWorker,
  createShipmentGenerationWorker,
} from './workers';
import { attachQueueEventListeners } from './queues';
import { db } from '@/lib/db';
import { getRedisConnection } from '@/lib/redis';

const log = logger.child({ module: 'worker-runner' });

async function main(): Promise<void> {
  log.info('Starting xConnector workers', {
    nodeVersion: process.version,
    pid:         process.pid,
  });

  // Attach queue event listeners for global observability
  attachQueueEventListeners();

  // Start all three workers
  const workers = [
    createOrderProcessingWorker(),
    createInvoiceGenerationWorker(),
    createShipmentGenerationWorker(),
  ];

  log.info('All workers started', { count: workers.length });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    log.info(`Received ${signal} — shutting down gracefully`);

    // Close all workers (waits for in-progress jobs, up to 30s each)
    await Promise.allSettled(
      workers.map((w) =>
        w.close().catch((e: Error) => log.error('Worker close error', { error: e.message })),
      ),
    );

    // Close DB + Redis
    await db.$disconnect().catch(() => {});
    await getRedisConnection().quit().catch(() => {});

    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Keep process alive
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', { error: err.message, stack: err.stack });
    // Don't exit — let BullMQ handle the job failure
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', { reason: String(reason) });
  });
}

main().catch((err) => {
  logger.error('Worker startup failed', { error: (err as Error).message });
  process.exit(1);
});
