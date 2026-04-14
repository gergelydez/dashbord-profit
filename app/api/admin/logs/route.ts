/**
 * app/api/admin/logs/route.ts — Job audit logs viewer
 *
 * GET /api/admin/logs
 *   ?queue=order-processing     filter by queue
 *   ?status=FAILED              filter by status
 *   ?orderId=UUID               filter by order
 *   ?limit=50                   results per page (max 200)
 *   ?offset=0                   pagination offset
 *
 * GET /api/admin/logs/summary — aggregate stats per queue/status
 *
 * Security: X-Connector-Key header required.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
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
  const queue    = searchParams.get('queue')    ?? undefined;
  const status   = searchParams.get('status')   ?? undefined;
  const orderId  = searchParams.get('orderId')  ?? undefined;
  const summary  = searchParams.get('summary')  === 'true';
  const limit    = Math.min(parseInt(searchParams.get('limit')  ?? '50',  10), 200);
  const offset   = Math.max(parseInt(searchParams.get('offset') ?? '0',   10), 0);

  // ── Summary mode ──────────────────────────────────────────────────────────
  if (summary) {
    const [jobStats, orderStats, queueStats] = await Promise.all([
      // Job stats by status
      db.jobLog.groupBy({
        by: ['queue', 'status'],
        _count: { id: true },
        orderBy: { queue: 'asc' },
      }),

      // Order stats by status
      db.order.groupBy({
        by: ['status'],
        _count: { id: true },
      }),

      // BullMQ queue stats
      getQueueStats().catch(() => null),
    ]);

    return NextResponse.json({ jobStats, orderStats, queueStats });
  }

  // ── List mode ─────────────────────────────────────────────────────────────
  const where = {
    ...(queue   ? { queue }   : {}),
    ...(status  ? { status: status as 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'DELAYED' } : {}),
    ...(orderId ? { orderId } : {}),
  };

  const [logs, total] = await Promise.all([
    db.jobLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    limit,
      skip:    offset,
    }),
    db.jobLog.count({ where }),
  ]);

  return NextResponse.json({
    logs,
    pagination: { total, limit, offset, hasMore: offset + limit < total },
  });
}
