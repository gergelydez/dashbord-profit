/**
 * GET/PUT MonthlyStat — persisted per-month financial rollup (GLS/Sameday
 * collected, ad spend, profit), entered/edited manually for now (same
 * numbers as app/profit/page.js today, but saved server-side instead of
 * localStorage so they don't need re-entering every visit).
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  if (!month) return NextResponse.json({ error: 'month lipsă' }, { status: 400 });
  const stat = await db.monthlyStat.findUnique({ where: { month } });
  return NextResponse.json({ stat });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as {
    month?: string;
    glsIncasat?: number | null;
    sdIncasat?: number | null;
    metaSpend?: number | null;
    tiktokSpend?: number | null;
    googleSpend?: number | null;
    profit?: number | null;
  };
  const { month, glsIncasat, sdIncasat, metaSpend, tiktokSpend, googleSpend, profit } = body;
  if (!month) return NextResponse.json({ error: 'month lipsă' }, { status: 400 });

  const data = { glsIncasat, sdIncasat, metaSpend, tiktokSpend, googleSpend, profit };
  const stat = await db.monthlyStat.upsert({
    where: { month },
    create: { month, ...data },
    update: data,
  });
  return NextResponse.json({ ok: true, stat });
}
