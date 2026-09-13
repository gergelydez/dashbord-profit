import { NextResponse } from 'next/server';
import { searchLocalities, lookupByLocation } from '@/lib/address/ro-postal-codes';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

/**
 * GET /api/postal-lookup?city=<text>[&county=<text>]
 * Autocomplete pentru adrese românești, pe lângă validarea din /api/validate-address:
 *  - doar `city` → mod "localities": localități al căror nume începe cu ce s-a scris,
 *    cu județul lor (pentru sugestii live sub câmpul Oraș).
 *  - `city` + `county` (o localitate deja identificată) → mod "zips": toate codurile
 *    poștale ale acelei localități — un singur cod (auto-completat) sau, dacă
 *    localitatea are străzi cu coduri diferite, lista de străzi ca să aleagă exact.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const city = (searchParams.get('city') || '').trim();
    const county = (searchParams.get('county') || '').trim();

    if (!city) return NextResponse.json({ ok: true, mode: 'localities', localities: [] }, { headers: CORS });

    if (!county) {
      const localities = await searchLocalities(city, undefined, 15);
      return NextResponse.json({ ok: true, mode: 'localities', localities }, { headers: CORS });
    }

    const rows = await lookupByLocation(county, city);
    const zips = Array.from(new Set(rows.map(r => r.zip)));
    const streets = rows.filter(r => r.strada).map(r => ({ strada: r.strada, zip: r.zip }));

    return NextResponse.json({
      ok: true,
      mode: 'zips',
      found: rows.length > 0,
      singleZip: zips.length === 1 ? zips[0] : null,
      zips,
      streets,
    }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}
