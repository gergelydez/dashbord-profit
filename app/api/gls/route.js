import { NextResponse } from 'next/server';

const ENV_USER   = process.env.GLS_USERNAME   || process.env.GLS_APP_ID     || '';
const ENV_PASS   = process.env.GLS_PASSWORD   || process.env.GLS_API_SECRET || process.env.GLS_API_KEY || '';
const ENV_CLIENT = process.env.GLS_CLIENT_NUMBER || '553003585';

const ENV_PICKUP_NAME   = process.env.GLS_PICKUP_NAME   || '';
const ENV_PICKUP_STREET = process.env.GLS_PICKUP_STREET || '';
const ENV_PICKUP_CITY   = process.env.GLS_PICKUP_CITY   || '';
const ENV_PICKUP_ZIP    = process.env.GLS_PICKUP_ZIP    || '';
const ENV_PICKUP_COUNTY = process.env.GLS_PICKUP_COUNTY || '';
const ENV_PICKUP_PHONE  = process.env.GLS_PICKUP_PHONE  || '';

const GLS_BASE = 'https://api.mygls.ro/ParcelService.svc/json';

async function sha512bytes(str) {
  const encoded = new TextEncoder().encode(str);
  const buf = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  return Array.from(new Uint8Array(buf));
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

export async function GET() {
  return NextResponse.json({
    ok: !!(ENV_USER && ENV_PASS),
    configured: !!(ENV_USER && ENV_PASS),
    clientNumber: ENV_CLIENT,
    message: ENV_USER ? 'GLS configurat.' : 'GLS_USERNAME lipseste.',
  }, { headers: CORS });
}

function cleanZip(z) { return (z || '').replace(/\D/g, ''); }

function parseStreet(address) {
  const addr = (address || '').trim();
  const patterns = [
    /^(.+?)\s+nr\.?\s*(\d+[\w\/\-]*)$/i,
    /^(.+?)\s*,\s*(\d+[\w\/\-]*)$/i,
    /^(.+?)\s+(\d+[\w\/\-]*)$/i,
  ];
  for (const p of patterns) {
    const m = addr.match(p);
    if (m && m[1] && m[2]) return { street: m[1].trim(), houseNum: m[2].trim() };
  }
  return { street: addr, houseNum: '1' };
}

let _pickupCache = null;

async function fetchPickupFromGLS(baseReq) {
  if (_pickupCache) return _pickupCache;
  try {
    const d = new Date(); d.setDate(d.getDate() - 30);
    const res = await fetch(`${GLS_BASE}/GetParcelList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ ...baseReq, PickupDateFrom: d.toISOString(), PickupDateTo: new Date().toISOString() }),
      cache: 'no-store',
    });
    const data = JSON.parse(await res.text());
    for (const p of (data?.ParcelList || [])) {
      const pa = p.PickupAddress;
      if (pa && pa.Name && pa.Street && pa.City && pa.ZipCode) {
        _pickupCache = {
          name: pa.Name || '', street: pa.Street || '',
          houseNum: pa.HouseNumber || '1', city: pa.City || '',
          zip: cleanZip(pa.ZipCode || ''), county: pa.CountyName || '',
          phone: (pa.ContactPhone || '').replace(/\D/g,'').slice(-10),
        };
        console.log('[GLS] Pickup from history:', JSON.stringify(_pickupCache));
        return _pickupCache;
      }
    }
  } catch(e) { console.warn('[GLS] fetchPickup failed:', e.message); }
  return null;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const user   = body.username     || ENV_USER   || '';
    const pass   = body.password     || ENV_PASS   || '';
    const client = body.clientNumber || ENV_CLIENT || '553003585';

    if (!user || !pass) return NextResponse.json({ ok: false, error: 'Completeaza username si parola GLS.' }, { headers: CORS });

    const passwordHash = await sha512bytes(pass);
    const baseReq = { Username: user, Password: passwordHash, ClientNumberList: [parseInt(client)], WebshopEngine: 'Custom' };

    if (body.action === 'test_connection' || body.action === 'get_config') {
      const d = new Date(); d.setDate(d.getDate() - 1);
      const res = await fetch(`${GLS_BASE}/GetParcelList`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ ...baseReq, PickupDateFrom: d.toISOString(), PickupDateTo: new Date().toISOString() }), cache: 'no-store',
      });
      const data = JSON.parse(await res.text());
      const authErr = (data?.GetParcelListErrors || []).find(e => [14,15,27].includes(e.ErrorCode));
      if (authErr) return NextResponse.json({ ok: false, error: `Credentiale invalide: ${authErr.ErrorDescription}` }, { headers: CORS });
      return NextResponse.json({ ok: true, configured: true, clientNumber: client, message: `GLS conectat! Client: ${client}` }, { headers: CORS });
    }

    const { recipientName, phone, email, address, city, county, zip, weight, parcels, content, codAmount, codCurrency, orderName, orderId, selectedServices, manualAwb } = body;

    if (manualAwb) return NextResponse.json({ ok: true, awb: manualAwb, mode: 'manual' }, { headers: CORS });

    const zipCleaned = cleanZip(zip);
    if (!zipCleaned || zipCleaned.length !== 6) return NextResponse.json({ ok: false, error: `Cod postal invalid: "${zip}". Trebuie 6 cifre.`, requiresCorrection: true }, { status: 422, headers: CORS });
    if (!city || city.trim().length < 2) return NextResponse.json({ ok: false, error: 'Orasul destinatarului lipseste.', requiresCorrection: true }, { status: 422, headers: CORS });
    if (!recipientName || recipientName.trim().length < 2) return NextResponse.json({ ok: false, error: 'Numele destinatarului lipseste.', requiresCorrection: true }, { status: 422, headers: CORS });

    const { street: dStreet, houseNum: dHouseNum } = parseStreet(address);

    // ── DATE EXPEDITOR ────────────────────────────────────────────────────
    let pickup = null;

    if (ENV_PICKUP_NAME && ENV_PICKUP_STREET && ENV_PICKUP_CITY && ENV_PICKUP_ZIP) {
      const { street: ps, houseNum: ph } = parseStreet(ENV_PICKUP_STREET);
      pickup = { name: ENV_PICKUP_NAME, street: ps, houseNum: ph, city: ENV_PICKUP_CITY, zip: cleanZip(ENV_PICKUP_ZIP), county: ENV_PICKUP_COUNTY, phone: ENV_PICKUP_PHONE.replace(/\D/g,'').slice(-10) };
    } else {
      const api = await fetchPickupFromGLS(baseReq);
      if (api && api.name && api.city && api.zip) {
        const { street: ps, houseNum: ph } = parseStreet(api.street);
        pickup = { ...api, street: ps || api.street, houseNum: ph !== '1' ? ph : api.houseNum };
      }
    }

    if (!pickup || !pickup.name || !pickup.city || !pickup.zip) {
      return NextResponse.json({
        ok: false,
        error: 'Date expeditor lipsa! Adauga in Vercel ENV: GLS_PICKUP_NAME, GLS_PICKUP_STREET, GLS_PICKUP_CITY, GLS_PICKUP_ZIP, GLS_PICKUP_COUNTY, GLS_PICKUP_PHONE',
      }, { status: 422, headers: CORS });
    }

    // ── SERVICII GLS ──────────────────────────────────────────────────────
    const serviceList = [];
    for (const [code, val] of Object.entries(selectedServices || {})) {
      // Skip doar dacă explicit false/null/undefined — NU skip string gol
      if (val === false || val === null || val === undefined) continue;

      const entry = { Code: code };
      switch(code) {
        case 'SM1':
          entry.SM1Parameter = { Value: `${(phone||'').replace(/\D/g,'').slice(-10)}|Colet GLS #ParcelNr#` };
          break;
        case 'SM2':
          entry.SM2Parameter = { Value: (phone||'').replace(/\D/g,'').slice(-10) };
          break;
        case 'FDS':
          // FlexDelivery Email — folosește emailul din val, din comandă, sau generăm unul
          // GLS trimite email clientului cu link să aleagă ora/locul
          const fdsEmail = (typeof val==='string' && val.includes('@')) ? val
            : (email && email.includes('@')) ? email
            : null;
          if (!fdsEmail) {
            // Nu avem email — nu putem adăuga FDS, skip
            console.warn('[GLS] FDS skip — no email available');
            continue;
          }
          entry.FDSParameter = { Value: fdsEmail };
          break;
        case 'FSS':
          // FlexDelivery SMS
          const fssPhone = (typeof val==='string' && val.length>5) ? val.replace(/\D/g,'')
            : (phone||'').replace(/\D/g,'').slice(-10);
          entry.FSSParameter = { Value: fssPhone };
          break;
        case 'AOS':
          entry.AOSParameter = { Value: recipientName };
          break;
        case 'INS':
          entry.INSParameter = { Value: typeof val==='string' && val ? val : String(Math.round(parseFloat(codAmount||0))) };
          break;
        case 'SBS':
          if (typeof val==='string' && val) entry.SBSParameter = { Value: val };
          else continue; // SBS fără shopId e invalid
          break;
        // SAT, T12, DPV, SDS, EXW — fără parametru, doar Code
      }
      serviceList.push(entry);
    }

    console.log('[GLS] ServiceList:', JSON.stringify(serviceList));
    console.log('[GLS] Pickup:', JSON.stringify(pickup));

    const parcelPayload = {
      ClientNumber:    parseInt(client),
      ClientReference: (orderName||'').slice(0,40),
      Count:           parseInt(parcels)||1,
      CODAmount:       parseFloat(codAmount)||0,
      CODReference:    codAmount>0?(orderName||'').slice(0,40):'',
      CODCurrency:     codAmount>0?(codCurrency||'RON'):undefined,
      Content:         (content||orderName||'Colet').slice(0,40),
      PickupDate:      `/Date(${Date.now()})/`,
      PickupAddress: {
        Name:           pickup.name.slice(0,40),
        Street:         pickup.street.slice(0,40),
        HouseNumber:    (pickup.houseNum||'1').slice(0,10),
        CountyName:     (pickup.county||'').slice(0,40),
        City:           pickup.city.slice(0,40),
        ZipCode:        pickup.zip,
        CountryIsoCode: 'RO',
        ContactName:    pickup.name.slice(0,40),
        ContactPhone:   pickup.phone||'',
        ContactEmail:   '',
      },
      DeliveryAddress: {
        Name:           (recipientName||'').slice(0,40),
        Street:         (dStreet||address||'').slice(0,40),
        HouseNumber:    (dHouseNum||'1').slice(0,10),
        CountyName:     (county||'').slice(0,40),
        City:           (city||'').slice(0,40),
        ZipCode:        zipCleaned,
        CountryIsoCode: 'RO',
        ContactName:    (recipientName||'').slice(0,40),
        ContactPhone:   (phone||'').replace(/\D/g,'').slice(-10),
        ContactEmail:   (email||'').slice(0,100),
      },
      ServiceList: serviceList,
    };

    const printRes = await fetch(`${GLS_BASE}/PrintLabels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ ...baseReq, ParcelList: [parcelPayload], TypeOfPrinter: 'A4_2x2', PrintPosition: 1, ShowPrintDialog: false }),
      cache: 'no-store',
    });

    const raw = await printRes.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`Raspuns invalid GLS: ${raw.slice(0,200)}`); }

    const printErrs = data?.PrintLabelsErrorList || [];
    if (printErrs.length > 0) {
      return NextResponse.json({ ok: false, error: printErrs.map(e=>`GLS ${e.ErrorCode}: ${e.ErrorDescription}`).join('; ') }, { status: 422, headers: CORS });
    }

    const info = (data?.PrintLabelsInfoList||[])[0];
    const awb  = info?.ParcelNumber || info?.ParcelId;
    if (!awb) return NextResponse.json({ ok: false, error: 'AWB negasit in raspunsul GLS', _raw: JSON.stringify(data).slice(0,400) }, { status: 500, headers: CORS });

    // Labels vine ca array de base64 PDF-uri
    const labelBase64 = Array.isArray(data?.Labels) ? data.Labels[0] : (data?.Labels || null);

    return NextResponse.json({
      ok: true,
      awb: String(awb),
      parcelId: info?.ParcelId,
      labelBase64,
      trackUrl: `https://gls-group.com/track/${awb}`,
      servicesApplied: serviceList.map(s=>s.Code),
      orderId, orderName,
    }, { headers: CORS });

  } catch(e) {
    console.error('[GLS] Error:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}
