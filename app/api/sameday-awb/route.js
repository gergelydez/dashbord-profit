import { NextResponse } from 'next/server';

const ENV_USER = process.env.SAMEDAY_USERNAME || '';
const ENV_PASS = process.env.SAMEDAY_PASSWORD || '';
const SD_BASE  = 'https://api.sameday.ro';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

// Cache token în memorie (valabil ~1 oră la Sameday)
let _tokenCache = null;

async function sdAuth(user, pass) {
  // Returnează token din cache dacă e valid (< 50 min)
  if (_tokenCache && _tokenCache.user === user && Date.now() - _tokenCache.ts < 50 * 60 * 1000) {
    return _tokenCache.token;
  }

  const res = await fetch(`${SD_BASE}/api/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AUTH-TOKEN': '' },
    body: JSON.stringify({ username: user, password: pass }),
    cache: 'no-store',
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Auth răspuns invalid (${res.status}): ${text.slice(0, 100)}`);
  }

  if (!res.ok) throw new Error(data?.message || data?.error || `Auth ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  const token = data.token || data.Token;
  if (!token) throw new Error('Token lipsă în răspuns Sameday');

  _tokenCache = { token, user, ts: Date.now() };
  return token;
}

async function sdGet(path, token) {
  const res = await fetch(`${SD_BASE}${path}`, {
    headers: { 'X-AUTH-TOKEN': token, 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Sameday GET ${path} (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function mapPickupPoints(data) {
  return (data.data || data || []).map(p => ({
    id: p.id || p.pickupPointId,
    name: p.name || p.alias || `Pickup #${p.id}`,
    city: p.city?.name || (typeof p.city === 'string' ? p.city : '') || '',
    address: p.address || '',
  })).filter(p => p.id);
}

function mapServices(data) {
  return (data.data || data || []).map(s => ({
    id: s.id || s.serviceId,
    name: s.name || `Serviciu #${s.id}`,
    code: s.code || '',
    isLocker: !!(s.name || '').toLowerCase().includes('locker'),
    isEasybox: !!(s.name || '').toLowerCase().includes('easybox'),
  })).filter(s => s.id);
}

function mapLockers(data) {
  const items = data.data || data.lockers || data.easyboxes || [];
  return items.map(l => ({
    id: l.id || l.lockerId,
    name: l.name || l.alias || `easybox #${l.id}`,
    address: l.address || l.street || '',
    city: l.city?.name || (typeof l.city === 'string' ? l.city : '') || '',
    county: l.county?.name || (typeof l.county === 'string' ? l.county : '') || '',
    postalCode: l.postalCode || l.zip || '',
  })).filter(l => l.id);
}

export async function GET() {
  if (!ENV_USER || !ENV_PASS) {
    return NextResponse.json({
      ok: false,
      configured: false,
      message: 'SAMEDAY_USERNAME sau SAMEDAY_PASSWORD lipsesc din Vercel env vars.',
    }, { headers: CORS });
  }
  try {
    const token = await sdAuth(ENV_USER, ENV_PASS);
    const [ptsData, svcsData] = await Promise.all([
      sdGet('/api/client/pickup-points', token),
      sdGet('/api/client/services', token),
    ]);
    return NextResponse.json({
      ok: true,
      configured: true,
      pickupPoints: mapPickupPoints(ptsData),
      services: mapServices(svcsData),
    }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ ok: false, configured: false, error: e.message }, { status: 500, headers: CORS });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const user = body.username || ENV_USER || '';
    const pass = body.password || ENV_PASS || '';

    if (!user || !pass) {
      return NextResponse.json({ ok: false, error: 'Completează username și parola Sameday.' }, { headers: CORS });
    }

    const token = await sdAuth(user, pass);

    // ── TEST CONEXIUNE ─────────────────────────────────────────────────────
    if (body.action === 'test_connection' || body.action === 'get_config') {
      const [ptsData, svcsData] = await Promise.all([
        sdGet('/api/client/pickup-points', token),
        sdGet('/api/client/services', token),
      ]);
      return NextResponse.json({
        ok: true,
        configured: true,
        pickupPoints: mapPickupPoints(ptsData),
        services: mapServices(svcsData),
      }, { headers: CORS });
    }

    // ── LOCKERE / EASYBOXURI ───────────────────────────────────────────────
    if (body.action === 'get_lockers') {
      try {
        const county = (body.county || '').trim();
        const city   = (body.city || '').trim();

        // Construim query params
        const params = new URLSearchParams({ page: '1', perPage: '200' });
        if (county) params.set('county', county);
        if (city)   params.set('city', city);

        const lockerData = await sdGet(`/api/client/lockers?${params}`, token);
        const lockers = mapLockers(lockerData);

        return NextResponse.json({ ok: true, lockers, total: lockers.length }, { headers: CORS });
      } catch (e) {
        console.error('[Sameday] get_lockers error:', e.message);
        return NextResponse.json({ ok: true, lockers: [], error: e.message }, { headers: CORS });
      }
    }

    // ── GENERARE AWB ───────────────────────────────────────────────────────
    const {
      pickupPointId,
      serviceId,
      lockerId,         // ID locker DESTINATAR (livrare la easybox)
      senderEasyboxId,  // ID easybox EXPEDITOR (predare de către expeditor)
      recipientName,
      phone,
      email,
      address,
      city,
      county,
      zip,
      weight,
      parcels,
      content,
      isCOD,
      total,
      orderName,
      orderId,
      openPackage,
      saturdayDelivery,
      thermo,
      repaymentTransport,
      observations,
      insuredValue,
      manualAwb,
    } = body;

    // AWB manual
    if (manualAwb) {
      return NextResponse.json({ ok: true, awb: manualAwb, mode: 'manual' }, { headers: CORS });
    }

    // Validare câmpuri obligatorii
    if (!recipientName || recipientName.trim().length < 2) {
      return NextResponse.json({
        ok: false,
        error: 'Numele destinatarului lipsește.',
        requiresCorrection: true,
      }, { status: 422, headers: CORS });
    }

    const phoneClean = (phone || '').replace(/\D/g, '').slice(-10);
    if (phoneClean.length < 9) {
      return NextResponse.json({
        ok: false,
        error: `Telefon invalid: "${phone}". Sameday necesită minim 9 cifre.`,
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

    // Pickup point fallback
    let ppId = pickupPointId;
    if (!ppId) {
      const ptsData = await sdGet('/api/client/pickup-points', token);
      ppId = mapPickupPoints(ptsData)[0]?.id;
      if (!ppId) throw new Error('Nu există pickup points configurate în contul Sameday.');
    }

    // Service fallback
    let svcId = serviceId;
    if (!svcId) {
      const svcsData = await sdGet('/api/client/services', token);
      svcId = mapServices(svcsData)[0]?.id;
      if (!svcId) throw new Error('Nu există servicii disponibile în contul Sameday.');
    }

    // Construiește body AWB
    const awbBody = {
      awbPayment:              isCOD ? 1 : 0,
      cashOnDelivery:          isCOD ? Math.round(parseFloat(total) * 100) / 100 || 0 : 0,
      cashOnDeliveryReturns:   0,
      insuredValue:            parseFloat(insuredValue) || 0,
      packageType:             0,
      packageNumber:           parseInt(parcels) || 1,
      packageWeight:           parseFloat(weight) || 1,
      observations:            (observations || content || `Comanda ${orderName}`).slice(0, 255),
      reference:               (orderName || '').slice(0, 50),
      recipientName:           (recipientName || '').slice(0, 100),
      recipientPhone:          phoneClean,
      recipientEmail:          (email || '').slice(0, 100),
      recipientAddress:        (address || '').slice(0, 200),
      recipientCity:           (city || '').slice(0, 100),
      recipientCounty:         (county || '').slice(0, 100),
      recipientPostalCode:     (zip || '').replace(/\s/g, '').slice(0, 10),
      pickupPoint:             parseInt(ppId),
      service_id:              parseInt(svcId),
      openPackage:             openPackage ? 1 : 0,
      repaymentTransport:      repaymentTransport ? 1 : 0,
      saturday_delivery:       saturdayDelivery ? 1 : 0,
      thermo:                  thermo ? 1 : 0,
    };

    // BUGFIX: lockerId = destinatarul primește la easybox (recipient locker)
    if (lockerId) {
      awbBody.locker_id = parseInt(lockerId);
    }

    // BUGFIX: senderEasyboxId = expeditorul predă la easybox (sender locker)
    // Sameday folosește "lockerFirstMile" sau "senderLocker" în funcție de API version
    if (senderEasyboxId) {
      awbBody.lockerFirstMile = parseInt(senderEasyboxId);
    }

    console.log('[Sameday] AWB payload:', JSON.stringify(awbBody, null, 2));

    const awbRes = await fetch(`${SD_BASE}/api/awb`, {
      method: 'POST',
      headers: {
        'X-AUTH-TOKEN': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(awbBody),
      cache: 'no-store',
    });

    const raw = await awbRes.text();
    console.log('[Sameday] AWB response raw:', raw.slice(0, 500));

    let data;
    try { data = JSON.parse(raw); } catch {
      throw new Error(`Răspuns invalid Sameday: ${raw.slice(0, 200)}`);
    }

    if (!awbRes.ok) {
      // Mesaj de eroare mai clar
      const errMsg = data.message || data.error ||
        (data.violations ? data.violations.map(v => `${v.message}`).join('; ') : null) ||
        JSON.stringify(data).slice(0, 300);
      throw new Error(errMsg);
    }

    const awbNumber = data.awbNumber || data.AWBNumber || data.awb || data.data?.awbNumber;
    if (!awbNumber) {
      throw new Error(`AWB negăsit în răspuns: ${JSON.stringify(data).slice(0, 300)}`);
    }

    return NextResponse.json({
      ok: true,
      awb: String(awbNumber),
      parcelIds: data.parcelNumbers || [],
      mode: (lockerId || senderEasyboxId) ? 'easybox' : 'standard',
      orderId,
      orderName,
    }, { headers: CORS });

  } catch (e) {
    console.error('[Sameday] Error:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}