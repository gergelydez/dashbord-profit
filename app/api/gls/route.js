import { NextResponse } from 'next/server';

const ENV_USER   = process.env.GLS_USERNAME   || process.env.GLS_APP_ID      || '';
const ENV_PASS   = process.env.GLS_PASSWORD   || process.env.GLS_API_SECRET  || process.env.GLS_API_KEY || '';
const ENV_CLIENT = process.env.GLS_CLIENT_NUMBER || '553003585';

// MyGLS REST API Romania
const GLS_BASE = 'https://api.mygls.ro/ParcelService.svc/json';

async function sha512bytes(str) {
  const encoded = new TextEncoder().encode(str);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  return Array.from(new Uint8Array(hashBuffer));
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
    message: ENV_USER
      ? `GLS configurat (${ENV_USER}). Apasă Test.`
      : 'GLS_USERNAME lipsește din Vercel env vars.',
  }, { headers: CORS });
}

// Normalizare cod poștal — elimină spații și caractere invalid
function cleanZip(zip) {
  return (zip || '').replace(/\s/g, '').replace(/[^0-9]/g, '');
}

// Extrage strada și numărul din adresă
function parseStreet(address) {
  const addr = (address || '').trim();
  // Încearcă patternuri comune: "Str. Exemplu nr. 10" / "Exemplu 10" / "Exemplu, 10"
  const patterns = [
    /^(.+?)\s+nr\.?\s*(\d+[\w\/\-]*)$/i,
    /^(.+?)\s*,\s*(\d+[\w\/\-]*)$/i,
    /^(.+?)\s+(\d+[\w\/\-]*)$/i,
  ];
  for (const p of patterns) {
    const m = addr.match(p);
    if (m && m[1] && m[2]) {
      return { street: m[1].trim(), houseNum: m[2].trim() };
    }
  }
  return { street: addr, houseNum: '1' };
}

export async function POST(req) {
  try {
    const body = await req.json();
    const user   = body.username     || ENV_USER   || '';
    const pass   = body.password     || ENV_PASS   || '';
    const client = body.clientNumber || ENV_CLIENT || '553003585';

    if (!user || !pass) {
      return NextResponse.json({
        ok: false, error: 'Completează username și parola GLS.',
      }, { headers: CORS });
    }

    const passwordHash = await sha512bytes(pass);
    const baseReq = {
      Username: user,
      Password: passwordHash,
      ClientNumberList: [parseInt(client)],
      WebshopEngine: 'Custom',
    };

    // ── TEST CONEXIUNE ─────────────────────────────────────────────────────
    if (body.action === 'test_connection' || body.action === 'get_config') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const res = await fetch(`${GLS_BASE}/GetParcelList`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          ...baseReq,
          PickupDateFrom: yesterday.toISOString(),
          PickupDateTo: new Date().toISOString(),
        }),
        cache: 'no-store',
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {
        throw new Error(`Răspuns invalid GLS (${res.status}): ${text.slice(0, 300)}`);
      }

      const errs = data?.GetParcelListErrors || [];
      const authErr = errs.find(e => [14, 15, 27].includes(e.ErrorCode));
      if (authErr) {
        return NextResponse.json({
          ok: false, configured: false,
          error: `Credențiale invalide (${authErr.ErrorCode}): ${authErr.ErrorDescription}`,
        }, { headers: CORS });
      }

      return NextResponse.json({
        ok: true, configured: true, clientNumber: client,
        message: `GLS conectat! Client: ${client}`,
      }, { headers: CORS });
    }

    // ── GENERARE AWB ───────────────────────────────────────────────────────
    const {
      recipientName, phone, email,
      address, city, county, zip,
      weight, parcels, content,
      codAmount, codCurrency,
      orderName, orderId, selectedServices, manualAwb,
    } = body;

    // AWB manual
    if (manualAwb) {
      return NextResponse.json({ ok: true, awb: manualAwb, mode: 'manual' }, { headers: CORS });
    }

    // Validare câmpuri obligatorii
    const zipCleaned = cleanZip(zip);
    if (!zipCleaned || zipCleaned.length !== 6) {
      return NextResponse.json({
        ok: false,
        error: `Cod poștal invalid: "${zip}". GLS necesită cod poștal de 6 cifre.`,
        requiresCorrection: true,
      }, { status: 422, headers: CORS });
    }

    if (!city || city.trim().length < 2) {
      return NextResponse.json({
        ok: false,
        error: 'Orașul destinatarului lipsește.',
        requiresCorrection: true,
      }, { status: 422, headers: CORS });
    }

    if (!recipientName || recipientName.trim().length < 2) {
      return NextResponse.json({
        ok: false,
        error: 'Numele destinatarului lipsește.',
        requiresCorrection: true,
      }, { status: 422, headers: CORS });
    }

    // Parsează adresa
    const { street, houseNum } = parseStreet(address);

    // Construiește ServiceList
    const serviceList = [];
    for (const [code, val] of Object.entries(selectedServices || {})) {
      if (!val || val === false) continue;
      const svc = { Code: code };
      if (code === 'SM1') svc.SM1Parameter = { Value: `${(phone || '').replace(/\D/g, '').slice(-10)}|Colet GLS #ParcelNr#` };
      else if (code === 'SM2') svc.SM2Parameter = { Value: (phone || '').replace(/\D/g, '') };
      else if (code === 'FDS') svc.FDSParameter = { Value: typeof val === 'string' && val.includes('@') ? val : (email || '') };
      else if (code === 'FSS') svc.FSSParameter = { Value: (phone || '').replace(/\D/g, '') };
      else if (code === 'AOS') svc.AOSParameter = { Value: recipientName || String(val) };
      else if (code === 'INS') svc.INSParameter = { Value: String(val) };
      else if (code === 'CS1') svc.CS1Parameter = { Value: (phone || '').replace(/\D/g, '') };
      else if (code === 'PSD') svc.PSDParameter = { StringValue: String(val) };
      serviceList.push(svc);
    }

    const parcelPayload = {
      ClientNumber:    parseInt(client),
      ClientReference: (orderName || '').slice(0, 40),
      Count:           parseInt(parcels) || 1,
      CODAmount:       parseFloat(codAmount) || 0,
      CODReference:    (codAmount > 0) ? (orderName || '').slice(0, 40) : '',
      CODCurrency:     (codAmount > 0) ? (codCurrency || 'RON') : undefined,
      Content:         (content || orderName || 'Colet').slice(0, 40),
      PickupDate:      `/Date(${Date.now()})/`,
      DeliveryAddress: {
        Name:           (recipientName || '').slice(0, 40),
        Street:         (street || address || '').slice(0, 40),
        HouseNumber:    (houseNum || '1').slice(0, 10),
        // BUGFIX: GLS necesită County pentru RO (altfel dă "Pickup Country" error)
        CountyName:     (county || '').slice(0, 40),
        City:           (city || '').slice(0, 40),
        ZipCode:        zipCleaned, // BUGFIX: ZIP fără spații și exact 6 cifre
        CountryIsoCode: 'RO',
        ContactName:    (recipientName || '').slice(0, 40),
        ContactPhone:   (phone || '').replace(/\D/g, '').slice(-10),
        ContactEmail:   (email || '').slice(0, 100),
      },
      ServiceList: serviceList,
    };

    console.log('[GLS] Payload parcel:', JSON.stringify(parcelPayload, null, 2));

    const printRes = await fetch(`${GLS_BASE}/PrintLabels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        ...baseReq,
        ParcelList: [parcelPayload],
        TypeOfPrinter: 'A4_2x2',
        PrintPosition: 1,
        ShowPrintDialog: false,
      }),
      cache: 'no-store',
    });

    const raw = await printRes.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      throw new Error(`Răspuns invalid GLS: ${raw.slice(0, 200)}`);
    }

    console.log('[GLS] PrintLabels response:', JSON.stringify(data).slice(0, 500));

    const printErrs = data?.PrintLabelsErrorList || [];
    if (printErrs.length > 0) {
      const errMsg = printErrs.map(e => `GLS ${e.ErrorCode}: ${e.ErrorDescription}`).join('; ');
      return NextResponse.json({
        ok: false,
        error: errMsg,
        errorCode: printErrs[0].ErrorCode,
        errorDescription: printErrs[0].ErrorDescription,
      }, { status: 422, headers: CORS });
    }

    const info = (data?.PrintLabelsInfoList || [])[0];
    const awb  = info?.ParcelNumber || info?.ParcelId;
    if (!awb) {
      return NextResponse.json({
        ok: false,
        error: 'AWB negăsit în răspunsul GLS',
        _raw: JSON.stringify(data).slice(0, 400),
      }, { status: 500, headers: CORS });
    }

    // Extrage serviciile aplicate
    const servicesApplied = serviceList.map(s => s.Code);

    return NextResponse.json({
      ok: true,
      awb: String(awb),
      parcelId: info?.ParcelId,
      pdf: data?.Labels || null,
      servicesApplied,
      orderId,
      orderName,
    }, { headers: CORS });

  } catch (e) {
    console.error('[GLS] Error:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}
