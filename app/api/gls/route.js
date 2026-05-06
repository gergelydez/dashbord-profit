import { NextResponse } from 'next/server';

// ── ENV — credentials ONLY from server, never from client ───────────────────
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
    message: ENV_USER ? 'GLS configurat.' : 'GLS_USERNAME lipseste din ENV.',
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
    for (const p of (data?.PrintDataInfoList || data?.ParcelList || [])) {
      const pa = p.Parcel?.PickupAddress || p.PickupAddress;
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

// ── Helper: extract Labels base64 from GLS response ─────────────────────────
function extractLabels(data) {
  // GLS can return Labels as: string, array of strings, or base64 directly
  if (!data) return null;
  if (typeof data.Labels === 'string' && data.Labels.length > 100) return data.Labels;
  if (Array.isArray(data.Labels) && data.Labels[0]?.length > 100) return data.Labels[0];
  // Also check Pdfdocument (used by GetPrintData)
  if (typeof data.Pdfdocument === 'string' && data.Pdfdocument.length > 100) return data.Pdfdocument;
  return null;
}

// ── Helper: fetch label PDF using ParcelId (correct per API docs) ────────────
async function fetchLabelByParcelId(baseReq, parcelId) {
  if (!parcelId) return null;
  try {
    console.log('[GLS] GetPrintedLabels with ParcelId:', parcelId);
    const res = await fetch(`${GLS_BASE}/GetPrintedLabels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        ...baseReq,
        ParcelIdList:    [parseInt(parcelId)],   // ← CORRECT: ParcelIdList per API docs
        TypeOfPrinter:   'A4_4x1',
        PrintPosition:   1,
        ShowPrintDialog: false,
      }),
      cache: 'no-store',
    });
    const data = JSON.parse(await res.text());
    const errs = data?.GetPrintedLabelsErrorList || [];
    if (errs.length > 0) {
      console.warn('[GLS] GetPrintedLabels errors:', errs.map(e=>e.ErrorDescription).join('; '));
      return null;
    }
    return extractLabels(data);
  } catch(e) {
    console.warn('[GLS] GetPrintedLabels failed:', e.message);
    return null;
  }
}

export async function POST(req) {
  try {
    const body = await req.json();

    // Security: credentials come ONLY from ENV vars — body values ignored
    const user   = ENV_USER   || '';
    const pass   = ENV_PASS   || '';
    const client = ENV_CLIENT || '553003585';

    if (!user || !pass) {
      return NextResponse.json({
        ok: false,
        error: 'GLS neconfigurat. Adauga GLS_USERNAME si GLS_PASSWORD in Vercel ENV.',
      }, { headers: CORS });
    }

    const passwordHash = await sha512bytes(pass);
    const baseReq = {
      Username:         user,
      Password:         passwordHash,
      ClientNumberList: [parseInt(client)],
      WebshopEngine:    'Custom',
    };

    // ── Test connection ──────────────────────────────────────────────────────
    if (body.action === 'test_connection' || body.action === 'get_config') {
      const d = new Date(); d.setDate(d.getDate() - 1);
      const res = await fetch(`${GLS_BASE}/GetParcelList`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          ...baseReq,
          PickupDateFrom: d.toISOString(),
          PickupDateTo:   new Date().toISOString(),
        }),
        cache: 'no-store',
      });
      const data = JSON.parse(await res.text());
      const authErr = (data?.GetParcelListErrors || []).find(e => [14,15,27].includes(e.ErrorCode));
      if (authErr) {
        return NextResponse.json({ ok: false, error: `Credentiale invalide: ${authErr.ErrorDescription}` }, { headers: CORS });
      }
      return NextResponse.json({
        ok: true, configured: true, clientNumber: client,
        message: `GLS conectat! Client: ${client}`,
      }, { headers: CORS });
    }

    // ── Re-download label by ParcelId ────────────────────────────────────────
    if (body.action === 'get_label') {
      const { parcelId, awb } = body;
      if (!parcelId) {
        return NextResponse.json({ ok: false, error: 'ParcelId lipsă.' }, { headers: CORS });
      }
      const labelBase64 = await fetchLabelByParcelId(baseReq, parcelId);
      if (!labelBase64) {
        return NextResponse.json({ ok: false, error: `Eticheta pentru AWB ${awb} nu a putut fi obținută.` }, { headers: CORS });
      }
      return NextResponse.json({ ok: true, labelBase64, awb }, { headers: CORS });
    }

    // ── Re-download label by AWB number (fallback for old AWBs without parcelId) ──
    if (body.action === 'get_label_by_awb') {
      const { awb } = body;
      if (!awb) {
        return NextResponse.json({ ok: false, error: 'AWB number lipsă.' }, { headers: CORS });
      }

      // Step 1: Find ParcelId from GetParcelList using AWB number
      try {
        const d = new Date(); d.setDate(d.getDate() - 90); // search last 90 days
        const listRes = await fetch(`${GLS_BASE}/GetParcelList`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            ...baseReq,
            PickupDateFrom: d.toISOString(),
            PickupDateTo:   new Date().toISOString(),
          }),
          cache: 'no-store',
        });
        const listData = JSON.parse(await listRes.text());
        const parcels = listData?.PrintDataInfoList || listData?.ParcelList || [];

        // Find matching parcel by AWB number
        const match = parcels.find(p => {
          const pNum = String(p.Parcel?.ParcelNumber || p.ParcelNumber || '');
          return pNum === String(awb);
        });

        if (match) {
          const foundParcelId = match.Parcel?.ParcelId || match.ParcelId;
          console.log('[GLS] Found ParcelId for AWB', awb, ':', foundParcelId);
          if (foundParcelId) {
            const labelBase64 = await fetchLabelByParcelId(baseReq, foundParcelId);
            if (labelBase64) {
              return NextResponse.json({ ok: true, labelBase64, awb, parcelId: foundParcelId }, { headers: CORS });
            }
          }
        }

        // Step 2: Try PrintLabels with existing parcel reference (re-print)
        // Build a minimal parcel payload just to get the label printed again
        console.log('[GLS] AWB not found in list, trying direct reprint for', awb);
        return NextResponse.json({
          ok: false,
          error: `AWB ${awb} nu a fost găsit în istoricul GLS (ultimele 90 zile). Regenerează AWB-ul.`,
        }, { headers: CORS });

      } catch(e) {
        console.error('[GLS] get_label_by_awb error:', e.message);
        return NextResponse.json({ ok: false, error: e.message }, { headers: CORS });
      }
    }

    // ── Create AWB (PrintLabels) ─────────────────────────────────────────────
    const {
      recipientName, phone, email, address, city, county, zip,
      weight, parcels, content, codAmount, codCurrency,
      orderName, orderId, selectedServices, observations, manualAwb,
    } = body;

    // Sanitizare
    const safePhone     = (phone||'').replace(/\D/g,'').slice(-10) || '0700000000';
    const safeRecipient = (recipientName||'').trim() || 'Client';
    const safeAddress   = (address||'').trim() || 'Adresa';
    const safeCity      = (city||'').trim() || 'Oras';
    const safeCounty    = (county||'').trim() || '';

    if (manualAwb) {
      return NextResponse.json({ ok: true, awb: manualAwb, mode: 'manual' }, { headers: CORS });
    }

    const zipCleaned = cleanZip(zip);
    if (!zipCleaned || zipCleaned.length !== 6) {
      return NextResponse.json({ ok: false, error: `Cod postal invalid: "${zip}". Trebuie 6 cifre.`, requiresCorrection: true }, { status: 422, headers: CORS });
    }
    if (!safeCity || safeCity.trim().length < 2) {
      return NextResponse.json({ ok: false, error: 'Orasul destinatarului lipseste.', requiresCorrection: true }, { status: 422, headers: CORS });
    }

    const { street: dStreet, houseNum: dHouseNum } = parseStreet(safeAddress);

    // ── Pickup address ───────────────────────────────────────────────────────
    let pickup = null;
    if (ENV_PICKUP_NAME && ENV_PICKUP_STREET && ENV_PICKUP_CITY && ENV_PICKUP_ZIP) {
      const { street: ps, houseNum: ph } = parseStreet(ENV_PICKUP_STREET);
      pickup = {
        name: ENV_PICKUP_NAME, street: ps, houseNum: ph,
        city: ENV_PICKUP_CITY, zip: cleanZip(ENV_PICKUP_ZIP),
        county: ENV_PICKUP_COUNTY,
        phone: ENV_PICKUP_PHONE.replace(/\D/g,'').slice(-10),
      };
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
        error: 'Date expeditor lipsa! Adauga in Vercel ENV: GLS_PICKUP_NAME, GLS_PICKUP_STREET, GLS_PICKUP_CITY, GLS_PICKUP_ZIP',
      }, { status: 422, headers: CORS });
    }

    // ── Services ─────────────────────────────────────────────────────────────
    const serviceList = [];
    for (const [code, val] of Object.entries(selectedServices || {})) {
      if (val === false || val === null || val === undefined) continue;
      const entry = { Code: code };
      switch(code) {
        case 'SM1':
          entry.SM1Parameter = { Value: `${safePhone}|Colet GLS #ParcelNr#` };
          break;
        case 'SM2':
          entry.SM2Parameter = { Value: safePhone };
          break;
        case 'FDS': {
          const fdsEmail = (typeof val==='string' && val.includes('@')) ? val : (email?.includes('@') ? email : null);
          if (!fdsEmail) { console.warn('[GLS] FDS skip — no email'); continue; }
          entry.FDSParameter = { Value: fdsEmail };
          break;
        }
        case 'FSS': {
          const fssPhone = (typeof val==='string' && val.length>5) ? val.replace(/\D/g,'') : safePhone;
          entry.FSSParameter = { Value: fssPhone };
          break;
        }
        case 'AOS':
          entry.AOSParameter = { Value: safeRecipient };
          break;
        case 'INS':
          entry.INSParameter = { Value: typeof val==='string' && val ? val : String(Math.round(parseFloat(codAmount||0))) };
          break;
        case 'SBS':
          if (typeof val==='string' && val) entry.SBSParameter = { Value: val };
          else continue;
          break;
      }
      serviceList.push(entry);
    }

    console.log('[GLS] Services:', JSON.stringify(serviceList));

    const parcelPayload = {
      ClientNumber:    parseInt(client),
      ClientReference: (orderName||'').slice(0, 40),
      Count:           parseInt(parcels) || 1,
      CODAmount:       parseFloat(codAmount) || 0,
      CODReference:    codAmount > 0 ? (orderName||'').slice(0, 40) : '',
      CODCurrency:     codAmount > 0 ? (codCurrency || 'RON') : undefined,
      Content:         (content || orderName || 'Colet').slice(0, 40),
      PickupDate:      `/Date(${Date.now()})/`,
      PickupAddress: {
        Name:           pickup.name.slice(0, 40),
        Street:         pickup.street.slice(0, 40),
        HouseNumber:    (pickup.houseNum || '1').slice(0, 10),
        CountyName:     (pickup.county || '').slice(0, 40),
        City:           pickup.city.slice(0, 40),
        ZipCode:        pickup.zip,
        CountryIsoCode: 'RO',
        ContactName:    pickup.name.slice(0, 40),
        ContactPhone:   pickup.phone || '',
        ContactEmail:   '',
      },
      DeliveryAddress: {
        Name:           safeRecipient.slice(0, 40),
        Street:         (dStreet || safeAddress || '').slice(0, 40),
        HouseNumber:    (dHouseNum || '1').slice(0, 10),
        CountyName:     safeCounty.slice(0, 40),
        City:           safeCity.slice(0, 40),
        ZipCode:        zipCleaned,
        CountryIsoCode: 'RO',
        ContactName:    safeRecipient.slice(0, 40),
        ContactPhone:   safePhone,
        ContactEmail:   (email || '').slice(0, 100),
      },
      ServiceList: serviceList,
    };

    // ── Call PrintLabels ─────────────────────────────────────────────────────
    const printRes = await fetch(`${GLS_BASE}/PrintLabels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        ...baseReq,
        ParcelList:      [parcelPayload],
        TypeOfPrinter:   'A4_4x1',
        PrintPosition:   1,
        ShowPrintDialog: false,
      }),
      cache: 'no-store',
    });

    const raw = await printRes.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`Raspuns invalid GLS: ${raw.slice(0, 200)}`); }

    const printErrs = data?.PrintLabelsErrorList || [];
    if (printErrs.length > 0) {
      return NextResponse.json({
        ok: false,
        error: printErrs.map(e => `GLS ${e.ErrorCode}: ${e.ErrorDescription}`).join('; '),
      }, { status: 422, headers: CORS });
    }

    // ── Extract AWB + ParcelId from response ─────────────────────────────────
    // Per API docs: PrintLabelsInfoList[0].ParcelNumber = AWB number
    //               PrintLabelsInfoList[0].ParcelId     = DB ID needed for GetPrintedLabels
    const info      = (data?.PrintLabelsInfoList || [])[0];
    const awb       = info?.ParcelNumber ? String(info.ParcelNumber) : null;
    const parcelId  = info?.ParcelId     ? parseInt(info.ParcelId)   : null;

    if (!awb && !parcelId) {
      return NextResponse.json({
        ok: false,
        error: 'AWB negasit in raspunsul GLS',
        _raw: JSON.stringify(data).slice(0, 400),
      }, { status: 500, headers: CORS });
    }

    console.log('[GLS] AWB:', awb, '| ParcelId:', parcelId);

    // ── Extract label PDF ────────────────────────────────────────────────────
    // 1. Try from PrintLabels response directly (Labels field)
    let labelBase64 = extractLabels(data);
    console.log('[GLS] Label from PrintLabels:', !!labelBase64, 'length:', labelBase64?.length || 0);

    // 2. If no label in PrintLabels response → use GetPrintedLabels with ParcelId
    //    Per API docs: GetPrintedLabels takes ParcelIdList (not ParcelNumberList!)
    if (!labelBase64 && parcelId) {
      labelBase64 = await fetchLabelByParcelId(baseReq, parcelId);
      console.log('[GLS] Label from GetPrintedLabels:', !!labelBase64);
    }

    const trackUrl = `https://gls-group.eu/RO/ro/urmarire-colet?match=${awb || parcelId}`;
    const myglsUrl = `https://mygls.ro/Parcel/Detail/${awb || parcelId}`;

    return NextResponse.json({
      ok:              true,
      awb:             awb || String(parcelId),
      parcelId,                         // ← SAVED: needed for re-downloading label later
      labelBase64,
      trackUrl,
      myglsUrl,
      servicesApplied: serviceList.map(s => s.Code),
      orderId,
      orderName,
    }, { headers: CORS });

  } catch(e) {
    console.error('[GLS] Error:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}
