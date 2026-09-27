import { NextResponse } from 'next/server';
import * as ro from '@/lib/address/ro-postal-codes';
import * as hu from '@/lib/address/hu-postal-codes';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

function resolveDataset(country) {
  const c = (country || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (c.includes('ungar') || c.includes('hungar') || c.includes('magyar') || c === 'hu') return hu;
  return ro;
}

/**
 * GET /api/postal-lookup?city=<text>[&county=<text>][&country=<text>]
 * Autocomplete pentru adrese românești sau maghiare, pe lângă validarea din
 * /api/validate-address:
 *  - doar `city` → mod "localities": localități al căror nume începe cu ce s-a scris,
 *    cu județul/megye lor (pentru sugestii live sub câmpul Oraș).
 *  - `city` + `county` (o localitate deja identificată) → mod "zips": toate codurile
 *    poștale ale acelei localități — un singur cod (auto-completat) sau, dacă
 *    localitatea are străzi/părți cu coduri diferite, lista lor ca să aleagă exact.
 *  - `country` (opțional, implicit România) alege setul de date — "Ungaria"/"Hungary"/
 *    "HU" folosește HuPostalCode, orice altceva RoPostalCode.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const city = (searchParams.get('city') || '').trim();
    const county = (searchParams.get('county') || '').trim();
    const country = searchParams.get('country') || '';
    const ds = resolveDataset(country);

    if (!city) return NextResponse.json({ ok: true, mode: 'localities', localities: [] }, { headers: CORS });

    if (!county) {
      const rawLocalities = await ds.searchLocalities(city, undefined, 15);
      // Normalizează la {localitate, judet} indiferent de sursă (RO: judet/localitate, HU: megye/telepules)
      const localities = rawLocalities.map(l => ds === hu ? { localitate: l.telepules, judet: l.megye } : l);
      return NextResponse.json({ ok: true, mode: 'localities', localities }, { headers: CORS });
    }

    const rows = await ds.lookupByLocation(county, city);
    const zips = Array.from(new Set(rows.map(r => r.zip)));
    const streets = rows
      .filter(r => (ds === hu ? r.resz : r.strada))
      .map(r => ({ strada: ds === hu ? r.resz : r.strada, zip: r.zip }));

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
