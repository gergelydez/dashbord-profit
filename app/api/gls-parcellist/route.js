import { NextResponse } from 'next/server';

const ENV_USER   = process.env.GLS_USERNAME || '';
const ENV_PASS   = process.env.GLS_PASSWORD || '';
const ENV_CLIENT = process.env.GLS_CLIENT_NUMBER || '553003585';
const GLS_BASE   = 'https://api.mygls.ro/ParcelService.svc/json';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

async function sha512bytes(str) {
  const encoded = new TextEncoder().encode(str);
  const buf = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  return Array.from(new Uint8Array(buf));
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

export async function POST(req) {
  try {
    const body = await req.json();
    // Security: credentials come ONLY from ENV vars — body values ignored
    const user   = ENV_USER;
    const pass   = ENV_PASS;
    const client = ENV_CLIENT;

    if (!user || !pass) {
      return NextResponse.json({ ok: false, error: 'Credentiale GLS lipsa.' }, { headers: CORS });
    }

    const passwordHash = await sha512bytes(pass);
    const baseReq = {
      Username: user,
      Password: passwordHash,
      ClientNumberList: [parseInt(client)],
    };

    // Date range: last N days (default 30)
    const days = parseInt(body.days || 30);
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);
    const dateTo = new Date();

    const res = await fetch(`${GLS_BASE}/GetParcelList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        ...baseReq,
        PickupDateFrom: dateFrom.toISOString(),
        PickupDateTo:   dateTo.toISOString(),
      }),
      cache: 'no-store',
    });

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('Raspuns invalid GLS'); }

    const errs = data?.GetParcelListErrors || [];
    const authErr = errs.find(e => [14, 15, 27].includes(e.ErrorCode));
    if (authErr) {
      return NextResponse.json({ ok: false, error: `Auth GLS: ${authErr.ErrorDescription}` }, { headers: CORS });
    }

    // GetParcelListResponse.PrintDataInfoList (NU "ParcelList" — nu există în API-ul
    // real, confirmat din documentația oficială MyGLS). Fiecare PrintDataInfo are
    // ParcelNumber/ParcelId/ClientReference direct pe el, dar restul detaliilor
    // (adresă, ramburs, servicii) sunt în obiectul nested "Parcel".
    const parcels = (data?.PrintDataInfoList || []).map(p => ({
      parcelNumber:  p.ParcelNumber,
      parcelId:      p.ParcelId,
      clientRef:     p.ClientReference || p.Parcel?.ClientReference,
      pickupDate:    p.Parcel?.PickupDate,
      deliveryName:  p.Parcel?.DeliveryAddress?.Name,
      deliveryCity:  p.Parcel?.DeliveryAddress?.City,
      deliveryZip:   p.Parcel?.DeliveryAddress?.ZipCode,
      cod:           p.Parcel?.CODAmount || 0,
      codCurrency:   p.Parcel?.CODCurrency,
      count:         p.Parcel?.Count || 1,
      services:      (p.Parcel?.ServiceList || []).map(s => s.Code),
    }));

    return NextResponse.json({
      ok: true,
      count: parcels.length,
      parcels,
    }, { headers: CORS });

  } catch (e) {
    console.error('[GLS ParcelList]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}
