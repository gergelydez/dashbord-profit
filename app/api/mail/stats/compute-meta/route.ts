/**
 * POST /api/mail/stats/compute-meta — sums the stored `amount` of every
 * "Facebook" (Meta Ads) document ingested for a month and writes it into
 * MonthlyStat.metaSpend. Unlike GLS's compute route, this doesn't re-parse
 * files — the amount was already extracted and saved at upload time
 * (see /api/mail/manual-upload), so this is just an aggregate query.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { month } = (await request.json()) as { month?: string };
    if (!month) return NextResponse.json({ error: 'month lipsă' }, { status: 400 });

    const agg = await db.ingestedDocument.aggregate({
      where: { month, category: 'Facebook' },
      _sum: { amount: true },
    });
    const total = Math.round(Number(agg._sum.amount || 0) * 100) / 100;

    const stat = await db.monthlyStat.upsert({
      where: { month },
      create: { month, metaSpend: total },
      update: { metaSpend: total },
    });

    return NextResponse.json({ ok: true, total, stat });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
