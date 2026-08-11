import { NextResponse } from 'next/server';
import { validateRoAddress } from '@/lib/address/ro-postal-codes';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

/**
 * POST /api/validate-address
 * Validează o adresă românească — nume/telefon/format de bază, plus corectitudinea
 * codului poștal folosind setul local de date (lib/address/ro-postal-codes.ts),
 * la nivel de județ+localitate+stradă. Nu mai depinde de un geocoder extern
 * (Geoapify/Nominatim erau imprecise pentru coduri poștale românești).
 */
export async function POST(request) {
  try {
    const { name, address, city, county, zip, phone, email, skipEmpty } = await request.json();
    const zipClean = (zip || '').replace(/\s/g, '');
    const issues = [];

    // ── Validări de bază (nume/telefon/format) — nelegate de corectitudinea CP ──
    if (!address || address.trim().length < 3) {
      issues.push({ field: 'address', severity: 'error', msg: 'Adresa stradală lipsește' });
    } else if (!/\d/.test(address)) {
      issues.push({ field: 'address', severity: 'warning', msg: 'Adresa nu conține număr stradal' });
    }

    if (!zipClean) {
      issues.push({ field: 'zip', severity: 'error', msg: 'Cod poștal lipsă' });
    } else if (!/^\d{6}$/.test(zipClean)) {
      issues.push({ field: 'zip', severity: 'error', msg: 'Codul poștal trebuie să aibă 6 cifre' });
    }

    if (!city || city.trim().length < 2) {
      issues.push({ field: 'city', severity: 'error', msg: 'Orașul lipsește' });
    }

    if (!county || county.trim().length < 2) {
      issues.push({ field: 'county', severity: 'warning', msg: 'Județul lipsește' });
    }

    if (!skipEmpty || phone) {
      const d = (phone || '').replace(/\D/g, '');
      if (!d || d.length < 9) issues.push({ field: 'phone', severity: 'error', msg: 'Telefon invalid (minim 9 cifre)' });
    }

    if (!skipEmpty && (!name || name.trim().length < 3)) {
      issues.push({ field: 'name', severity: 'error', msg: 'Numele destinatarului lipsește' });
    }

    if (email && email.trim()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        issues.push({ field: 'email', severity: 'error', msg: 'Adresa de email este invalidă' });
      }
    } else if (!skipEmpty) {
      issues.push({ field: 'email', severity: 'warning', msg: 'Email lipsă' });
    }

    // Fără județ + localitate nu putem verifica local codul poștal
    if (!city || !county) {
      return NextResponse.json({ ok: true, valid: issues.filter(i => i.severity === 'error').length === 0, issues, suggestion: null }, { headers: CORS });
    }

    // ── Verificare cod poștal — sursă locală (județ/localitate/stradă) ──
    const roResult = await validateRoAddress({ judet: county, localitate: city, strada: address, zip: zipClean });

    let suggestion = null;
    if (!roResult.ok && roResult.issues.length) {
      const msg = roResult.issues.join(' ');
      const idx = issues.findIndex(i => i.field === 'zip');
      const issue = { field: 'zip', severity: 'error', msg };
      if (idx >= 0) issues[idx] = issue; else issues.push(issue);

      suggestion = {
        postcode: roResult.suggestion?.zip || null,
        city: roResult.suggestion?.localitate || city,
        county: roResult.suggestion?.judet || county,
        formattedAddress: address,
        zipMismatch: roResult.zipMatchesLocation === false,
        zipMessage: `⚠️ ${msg}`,
        source: 'ro-postal-codes',
      };
    } else if (roResult.zipMatchesLocation === true) {
      suggestion = {
        postcode: zipClean, city, county, formattedAddress: address,
        zipMismatch: false,
        zipMessage: `✓ Cod poștal ${zipClean} confirmat pentru ${city}, județul ${county}`,
        source: 'ro-postal-codes',
      };
    }

    return NextResponse.json({
      ok: true,
      valid: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      suggestion,
    }, { headers: CORS });

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: CORS });
  }
}
