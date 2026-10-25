/**
 * app/api/stats-totale/gls-snapshot/route.ts
 * Persistă coletele GLS trase live (vezi fetchLiveGls în
 * app/statistici-totale/page.js) — o dată ce o lună s-a ÎNCHEIAT (nu mai e
 * luna curentă), datele ei nu se mai schimbă niciodată, deci n-are rost să
 * tragem din nou din MyGLS de fiecare dată când cineva se uită pe luna
 * respectivă. Pagina verifică întâi acoperirea (coverage=1) pentru lunile
 * închise din intervalul cerut, sare peste live-pull pentru cele deja
 * acoperite, și persistă (POST) ce tocmai a tras live pentru restul.
 *
 * POST { parcels } — upsert în bază, cheie unică pe numărul coletului.
 * GET ?from=&to=            — coletele cu pickupDate în interval.
 * GET ?from=&to=&coverage=1 — doar lunile (YYYY-MM) cu cel puțin un colet.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';

interface SnapshotParcel {
  parcelNumber: string;
  clientRef?: string | null;
  pickupDate?: string | null; // "YYYY-MM-DD"
  deliveryName?: string | null;
  deliveryCity?: string | null;
  cod?: number | null;
  codCurrency?: string | null;
  shopKey: string;
  delivered?: boolean;
  returned?: boolean;
  hasStatus?: boolean;
}

export async function POST(request: Request) {
  try {
    const { parcels } = await request.json() as { parcels?: SnapshotParcel[] };
    if (!parcels?.length) return NextResponse.json({ error: 'Niciun colet de salvat.' }, { status: 400 });

    let saved = 0, skipped = 0;
    for (const p of parcels) {
      const parcelNumber = String(p.parcelNumber || '').trim();
      if (!parcelNumber || !p.shopKey) { skipped++; continue; }
      const data = {
        clientRef: p.clientRef || null,
        pickupDate: p.pickupDate ? new Date(p.pickupDate) : null,
        deliveryName: p.deliveryName || null,
        deliveryCity: p.deliveryCity || null,
        cod: p.cod != null && !isNaN(p.cod) ? p.cod : null,
        codCurrency: p.codCurrency || null,
        shopKey: p.shopKey,
        delivered: !!p.delivered,
        returned: !!p.returned,
        hasStatus: p.hasStatus !== false,
      };
      await db.glsParcelSnapshot.upsert({
        where: { parcelNumber },
        create: { parcelNumber, ...data },
        update: data,
      });
      saved++;
    }

    return NextResponse.json({ ok: true, saved, skipped });
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

    const where = { pickupDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) } };

    if (searchParams.get('coverage') === '1') {
      const rows = await db.glsParcelSnapshot.findMany({ where, select: { pickupDate: true } });
      const months = new Set<string>();
      for (const r of rows) if (r.pickupDate) months.add(r.pickupDate.toISOString().slice(0, 7));
      return NextResponse.json({ ok: true, months: Array.from(months).sort() });
    }

    const rows = await db.glsParcelSnapshot.findMany({
      where,
      select: {
        parcelNumber: true, clientRef: true, pickupDate: true, deliveryName: true, deliveryCity: true,
        cod: true, codCurrency: true, shopKey: true, delivered: true, returned: true, hasStatus: true,
      },
      take: 10000,
    });

    const out = rows.map(r => ({
      parcelNumber: r.parcelNumber,
      clientRef: r.clientRef,
      pickupDate: r.pickupDate?.toISOString() || null,
      deliveryName: r.deliveryName,
      deliveryCity: r.deliveryCity,
      cod: r.cod != null ? Number(r.cod) : 0,
      codCurrency: r.codCurrency,
      shopKey: r.shopKey,
      delivered: r.delivered,
      returned: r.returned,
      hasStatus: r.hasStatus,
    }));

    return NextResponse.json({ ok: true, parcels: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
