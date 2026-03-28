import { NextResponse } from 'next/server';

const trackingCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

// Credențiale GLS din env vars
const GLS_API_KEY    = process.env.GLS_API_KEY || '';
const GLS_APP_ID = process.env.GLS_APP_ID || '';

// Mapare statusuri GLS
const GLS_STATUS_MAP = {
  // Status text
  'DELIVERED':          'delivered',
  'DELIVERED_PS':       'delivered',
  'INDELIVERY':         'out_for_delivery',
  'OUT_FOR_DELIVERY':   'out_for_delivery',
  'IN_TRANSIT':         'in_transit',
  'INWAREHOUSE':        'in_transit',
  'PICKED_UP':          'in_transit',
  'NOTDELIVERED':       'failed_attempt',
  'NOT_DELIVERED':      'failed_attempt',
  'RETURNED':           'returned',
  'RETURN_TO_SENDER':   'returned',
  'CANCELLED':          'failure',
  // Coduri numerice
  '0': 'in_transit', '1': 'in_transit', '2': 'in_transit',
  '3': 'out_for_delivery', '4': 'delivered',
  '5': 'failed_attempt',  '6': 'returned',
};

const SAMEDAY_STATUS_MAP = {
  '1':'in_transit','2':'in_transit','3':'in_transit',
  '4':'out_for_delivery','5':'delivered','6':'failed_attempt',
  '7':'returned','8':'returned','10':'in_transit',
  '11':'failure','24':'out_for_delivery','25':'in_transit',
};

async function trackGLS(awb) {
  const cacheKey = `gls_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  if (!GLS_API_KEY) {
    console.log('[GLS] GLS_API_KEY lipsă!');
    return null;
  }

  try {
    // GLS Official API - Parcel Tracking
    const url = `https://api.gls-group.eu/public/v3/tracking/parcel-numbers/${awb}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${GLS_APP_ID}:${GLS_API_KEY}`).toString('base64')}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.log('[GLS] API error:', res.status, await res.text().catch(()=>''));
      return null;
    }

    const data = await res.json();
    console.log('[GLS] Response:', JSON.stringify(data).slice(0, 300));

    // GLS v3 response structure
    const parcel = data?.parcel || data;
    const events = parcel?.events || parcel?.history || [];
    const lastEvent = events[0] || events[events.length - 1] || {};

    const statusCode = String(
      parcel?.status?.code || parcel?.deliveryStatus ||
      lastEvent?.code || lastEvent?.evtDscr || ''
    ).toUpperCase();

    const mapped = GLS_STATUS_MAP[statusCode] || 'in_transit';

    const result = {
      status: mapped,
      statusRaw: statusCode,
      lastUpdate: lastEvent?.timestamp || lastEvent?.date || '',
      location: lastEvent?.location?.city || lastEvent?.address?.city || '',
      description: lastEvent?.description || lastEvent?.evtDscr || '',
    };

    trackingCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch(e) {
    console.log('[GLS] Exception:', e.message);
    return null;
  }
}

async function trackSameday(awb) {
  const cacheKey = `sd_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const res = await fetch(
      `https://api.sameday.ro/api/public/awb/${awb}/awb-history`,
      {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const history = data.awbHistory || [];
    if (!history.length) return null;

    const last = history[0];
    const result = {
      status: SAMEDAY_STATUS_MAP[String(last.statusId || '')] || 'in_transit',
      statusRaw: last.statusLabel || '',
      lastUpdate: last.statusDate || '',
      location: last.county || '',
    };
    trackingCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch { return null; }
}

// GET: single AWB sau debug
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const awb     = searchParams.get('awb');
  const courier = searchParams.get('courier') || 'gls';
  const debug   = searchParams.get('debug') === '1';

  if (!awb) return NextResponse.json({ error: 'AWB lipsă' }, { status: 400 });

  if (debug) {
    // Testăm conexiunea GLS cu răspuns brut
    if (!GLS_API_KEY) {
      return NextResponse.json({
        error: 'GLS_API_KEY lipsă',
        hint: 'Adaugă GLS_API_KEY și GLS_API_SECRET în Vercel → Settings → Environment Variables'
      });
    }
    try {
      // Testăm mai multe variante URL GLS
      // Testăm combinații URL + auth method
      const tests = [
        { url: `https://api.gls-group.eu/public/v3/tracking/parcel-numbers/${awb}`,
          headers: { 'Authorization': `Basic ${Buffer.from(`${GLS_APP_ID}:${GLS_API_KEY}`).toString('base64')}`, 'Accept': 'application/json' }},
        { url: `https://api.gls-group.eu/public/v3/tracking/parcel-numbers/${awb}`,
          headers: { 'Authorization': `apikey ${GLS_API_KEY}`, 'Accept': 'application/json' }},
        { url: `https://api.gls-group.eu/public/v3/tracking/parcel-numbers/${awb}`,
          headers: { 'Authorization': `Bearer ${GLS_API_KEY}`, 'Accept': 'application/json' }},
        { url: `https://api.gls-group.eu/public/v3/tracking/parcel-numbers/${awb}?appid=${GLS_APP_ID}`,
          headers: { 'Authorization': `apikey ${GLS_API_KEY}`, 'Accept': 'application/json' }},
        { url: `https://api.gls-group.eu/public/v3/tracking/parcel-numbers/${awb}`,
          headers: { 'x-api-key': GLS_API_KEY, 'Accept': 'application/json' }},
      ];
      const results = [];
      for (const test of tests) {
        try {
          const r = await fetch(test.url, {
            headers: { ...test.headers, 'User-Agent': 'GLAMX-Dashboard/1.0' },
            signal: AbortSignal.timeout(8000),
          });
          const text = await r.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 200); }
          results.push({ url: test.url, authType: Object.keys(test.headers)[0], status: r.status, response: parsed });
        } catch(e2) {
          results.push({ url: test.url, error: e2.message });
        }
      }
      return NextResponse.json({
        awb,
        apiKey: GLS_API_KEY ? `✅ ${GLS_API_KEY.slice(0,8)}...` : '❌ lipsă',
        appId: GLS_APP_ID ? `✅ ${GLS_APP_ID.slice(0,8)}...` : '❌ lipsă',
        results,
      });
    } catch(e) {
      return NextResponse.json({ awb, error: e.message });
    }
  }

  const c = courier.toLowerCase();
  const result = c.includes('sameday')
    ? await trackSameday(awb)
    : await trackGLS(awb);

  return NextResponse.json({ awb, courier, ...result });
}

// POST: batch tracking
export async function POST(request) {
  try {
    const { orders } = await request.json();
    if (!orders?.length) return NextResponse.json({ results: [] });

    if (!GLS_API_KEY) {
      return NextResponse.json({
        results: [],
        error: 'GLS_API_KEY lipsă. Adaugă în Vercel → Settings → Environment Variables.'
      });
    }

    const results = [];
    for (let i = 0; i < orders.length; i += 5) {
      const batch = orders.slice(i, i + 5);
      const batchRes = await Promise.allSettled(
        batch.map(async ({ id, awb, courier }) => {
          if (!awb) return { id, status: null };
          const c = (courier||'').toLowerCase();
          const t = c.includes('sameday') ? await trackSameday(awb) : await trackGLS(awb);
          return { id, awb, courier, ...t };
        })
      );
      results.push(...batchRes.map((r, idx) =>
        r.status === 'fulfilled' ? r.value : { id: batch[idx]?.id, status: null }
      ));
      if (i + 5 < orders.length) await new Promise(r => setTimeout(r, 400));
    }

    return NextResponse.json({ results, count: results.length });
  } catch(e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

