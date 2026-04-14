/**
 * lib/redis.ts — IORedis singleton for BullMQ
 *
 * BullMQ requires IORedis (not the `redis` npm package).
 * We export a connection factory used by queues and workers.
 */

import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

declare global {
  // eslint-disable-next-line no-var
  var __ioredis: IORedis | undefined;
}

function createRedis(): IORedis {
  const client = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    // Don't crash on connection errors — log and let BullMQ retry
    console.error('[Redis] Connection error:', err.message);
  });

  return client;
}

/**
 * Shared IORedis instance (reused across module imports).
 * BullMQ will use this for all queue/worker operations.
 */
export function getRedisConnection(): IORedis {
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__ioredis ??= createRedis();
    return globalThis.__ioredis;
  }
  // In production, always create a fresh connection per module load
  // to avoid sharing state across serverless cold starts
  return createRedis();
}

/**
 * Lightweight ping to check if Redis is reachable.
 */
export async function pingRedis(): Promise<boolean> {
  try {
    const r = getRedisConnection();
    const res = await r.ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}
