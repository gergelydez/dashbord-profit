/**
 * app/api/stats-totale/sameday-import/route.ts
 * Persistă exportul AWB Sameday ("export_AWB...xlsx", descărcat manual din
 * panoul Sameday) — sursa de adevăr pentru Statistici Totale/"SAMEDAY
 * TOTAL": conține dată REALĂ de creare, status REAL în text și referința
 * comenzii (în "Observatii"), spre deosebire de API-ul live Sameday
 * (status-sync), care doar spune ce AWB a avut o mișcare într-o fereastră,
 * fără dată/referință per colet — vezi app/api/sameday-parcellist/route.js.
 *
 * POST { rows } — upsert în bază, cheie unică pe AWB, ca reîncărcarea
 * aceluiași export (sau un export mai nou, suprapus) să nu creeze duplicate.
 * GET ?from=&to= — rândurile cu createdDate în interval, pentru pagina
 * Statistici Totale.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';

interface ImportRow {
  awb?: string;
  marketplace?: string | null;
  createdDate?: string | null;   // "YYYY-MM-DD"
  deliveredAt?: string | null;   // "30 Sep 2026 17:32:46" sau "N/A"
  statusText?: string;
  codAmount?: number | null;
  codCurrency?: string;
  observations?: string | null;
  cost?: number | null;
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseCreatedDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

function parseDeliveredAt(s?: string | null): Date | null {
  if (!s || s.trim().toUpperCase() === 'N/A') return null;
  // "30 Sep 2026 17:32:46"
  const m = s.trim().match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, day, mon, year, hh, mm, ss] = m;
  const monthIdx = EN_MONTHS.findIndex(mn => mn.toLowerCase() === mon.toLowerCase());
  if (monthIdx < 0) return null;
  const d = new Date(Date.UTC(Number(year), monthIdx, Number(day), Number(hh), Number(mm), Number(ss)));
  return isNaN(d.getTime()) ? null : d;
}

/** Observatii: "#4030- GLA 3739- GLAMX DELTA MAX - Silicon..." → "#4030" */
function extractOrderRef(observations?: string | null): string | null {
  if (!observations) return null;
  const m = observations.trim().match(/^#(\d+)/);
  return m ? `#${m[1]}` : null;
}

export async function POST(request: Request) {
  try {
    const { rows } = await request.json() as { rows?: ImportRow[] };
    if (!rows?.length) return NextResponse.json({ error: 'Niciun rând de importat.' }, { status: 400 });

    let imported = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      const awb = (r.awb || '').trim();
      if (!awb) { skipped++; continue; }

      const data = {
        marketplace: r.marketplace || null,
        createdDate: parseCreatedDate(r.createdDate),
        deliveredAt: parseDeliveredAt(r.deliveredAt),
        statusText: r.statusText || '',
        codAmount: r.codAmount != null && !isNaN(r.codAmount) ? r.codAmount : null,
        codCurrency: r.codCurrency || 'RON',
        observations: r.observations || null,
        orderRef: extractOrderRef(r.observations),
        cost: r.cost != null && !isNaN(r.cost) ? r.cost : null,
      };

      const existing = await db.samedayAwbImport.findUnique({ where: { awb }, select: { id: true } });
      await db.samedayAwbImport.upsert({
        where: { awb },
        create: { awb, ...data },
        update: data,
      });
      if (existing) updated++; else imported++;
    }

    return NextResponse.json({ ok: true, imported, updated, skipped, total: rows.length });
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

    const rows = await db.samedayAwbImport.findMany({
      where: { createdDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) } },
      select: {
        awb: true, marketplace: true, createdDate: true, deliveredAt: true, statusText: true,
        codAmount: true, codCurrency: true, orderRef: true,
      },
      orderBy: { createdDate: 'desc' },
      take: 5000,
    });

    const out = rows.map(r => ({
      awb: r.awb,
      marketplace: r.marketplace,
      createdDate: r.createdDate?.toISOString() || null,
      deliveredAt: r.deliveredAt?.toISOString() || null,
      statusText: r.statusText,
      codAmount: r.codAmount != null ? Number(r.codAmount) : null,
      codCurrency: r.codCurrency,
      orderRef: r.orderRef,
    }));

    // Acoperire: lunile cu cel puțin un rând importat — pagina poate arăta
    // clar pentru ce perioade are deja date persistate și pentru ce nu.
    const coverage = await db.samedayAwbImport.groupBy({
      by: ['createdDate'],
      _count: true,
      where: { createdDate: { not: null } },
    });
    const monthsCovered = new Set<string>();
    for (const c of coverage) {
      if (c.createdDate) monthsCovered.add(c.createdDate.toISOString().slice(0, 7));
    }

    return NextResponse.json({ ok: true, rows: out, monthsCovered: Array.from(monthsCovered).sort() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
