/**
 * app/api/stats-totale/known-awbs/route.ts
 * POST { awbs: string[] } — din lista dată, care AWB-uri există deja ca
 * Shipment la noi în bază, INDIFERENT de magazin sau de lună.
 *
 * De ce: pe Statistici Totale, "🚀 SAMEDAY TOTAL" caută coletele Sameday
 * "fără comandă" (prefix de magazin, dar nepotrivite cu nicio comandă)
 * verificând doar comenzile DEJA ÎNCĂRCATE pentru lunile vizibile curent —
 * dar status-sync Sameday raportează orice AWB cu MIȘCARE în fereastra
 * cerută, nu doar cele create atunci (ex. o comandă din septembrie, livrată
 * abia acum, apare în fereastra lunii curente). Fără o verificare pe TOATĂ
 * baza (nu doar lunile vizibile), un AWB mai vechi, deja cunoscut, ieșea
 * greșit ca "fără comandă" — exact cauza unei umflări confirmate (100%
 * coincidență exclusă: 44 afișate vs. 25 reale, diferența fiind exact cele
 * "fără comandă" nepotrivite din lipsa asta de verificare).
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { awbs } = await request.json() as { awbs?: string[] };
    if (!awbs?.length) return NextResponse.json({ ok: true, known: [] });

    const rows = await db.shipment.findMany({
      where: { trackingNumber: { in: awbs } },
      select: { trackingNumber: true },
    });

    return NextResponse.json({ ok: true, known: rows.map(r => r.trackingNumber) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
