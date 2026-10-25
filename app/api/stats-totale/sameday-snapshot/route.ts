/**
 * app/api/stats-totale/sameday-snapshot/route.ts
 * Persistă rezultatul (clasificat EMG/retur client) al unei trageri live
 * Sameday status-sync — vezi fetchEmagSameday în
 * app/statistici-totale/page.js. O lună ÎNCHEIATĂ, odată trasă, nu se mai
 * schimbă niciodată, deci n-are rost să mai batem Sameday (status-sync e
 * lent: ferestre de 2h) de fiecare dată când cineva se uită pe ea.
 *
 * POST { monthKey, emagAwbs, clientReturnAwbs, truncated } — upsert, un rând
 * întreg per lună (nu per AWB).
 * GET ?from=&to=            — rândurile cu monthKey în interval.
 * GET ?from=&to=&coverage=1 — doar lunile (YYYY-MM) acoperite.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';

function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 7));
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const { monthKey, emagAwbs, clientReturnAwbs, truncated } = await request.json() as {
      monthKey?: string; emagAwbs?: string[]; clientReturnAwbs?: string[]; truncated?: boolean;
    };
    if (!monthKey) return NextResponse.json({ error: 'monthKey lipsă' }, { status: 400 });

    await db.samedayMonthSnapshot.upsert({
      where: { monthKey },
      create: { monthKey, emagAwbs: emagAwbs || [], clientReturnAwbs: clientReturnAwbs || [], truncated: !!truncated },
      update: { emagAwbs: emagAwbs || [], clientReturnAwbs: clientReturnAwbs || [], truncated: !!truncated },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (!from || !to) return NextResponse.json({ error: 'from/to lipsă' }, { status: 400 });
    const months = monthsInRange(from, to);

    if (searchParams.get('coverage') === '1') {
      const rows = await db.samedayMonthSnapshot.findMany({ where: { monthKey: { in: months } }, select: { monthKey: true } });
      return NextResponse.json({ ok: true, months: rows.map(r => r.monthKey) });
    }

    const rows = await db.samedayMonthSnapshot.findMany({
      where: { monthKey: { in: months } },
      select: { monthKey: true, emagAwbs: true, clientReturnAwbs: true, truncated: true },
    });

    return NextResponse.json({
      ok: true,
      months: rows.map(r => ({
        monthKey: r.monthKey,
        emagAwbs: (r.emagAwbs as string[]) || [],
        clientReturnAwbs: (r.clientReturnAwbs as string[]) || [],
        truncated: r.truncated,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
