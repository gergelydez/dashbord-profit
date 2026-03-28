import { NextResponse } from 'next/server';

const trackingCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

const GLS_API_KEY = process.env.GLS_API_KEY || '';
const GLS_APP_ID  = process.env.GLS_APP_ID  || '';

// GLS event codes → status intern
// Documentație: /tracking/events/codes
const GLS_EVENT_STATUS = {
  // Status livrat
  'DELIVERED': 'delivered',
  'DELIVERED_PS': 'delivered',
  // În livrare
  'INDELIVERY': 'out_for_delivery',
  'OUT_FOR_DELIVERY': 'out_for_delivery',
  // În tranzit
  'INTRANSIT': 'in_transit',
  'IN_TRANSIT': 'in_transit',
  'INWAREHOUSE': 'in_transit',
  'PICKED_UP': 'in_transit',
  'PREADVICE': 'in_transit',
  // Tentativă eșuată
  'NOTDELIVERED': 'failed_attempt',
  'NOT_DELIVERED': 'failed_attempt',
  'MISROUTED': 'in_transit',
  // Retur
  'RETURNED': 'returned',
  'RETURN': 'returned',
  'RETURNEDTOSTATION': 'returned',
};

const SAMEDAY_STATUS_MAP = {
  '1':'in_transit','2':'in_transit','3':'in_transit',
  '4':'out_for_delivery','5':'delivered','6':'failed_attempt',
  '7':'returned','8':'returned','10':'in_transit',
  '11':'failure','24':'out_for_delivery','25':'in_transit',
};

function getAuthHeader() {
  // Basic Auth cu AppID:APIKey
  return `Basic ${Buffer.from(`${GLS_APP_ID}:${GLS_API_KEY}`).toString('base64')}`;
}

async function trackGLS(awb) {
  const cacheKey = `gls_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  if (!GLS_API_KEY) return null;

  try {
    // Endpoint corect din documentație
    const url = `https://api-sandbox.gls-group.net/track-and-trace-v1/tracking/simple/trackids/${awb}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': getAuthHeader(),
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.log('[GLS] Error:', res.status, awb);
      return null;
    }

    const data = await res.json();
    console.log('[GLS] Response for', awb, ':', JSON.stringify(data).slice(0, 300));

    // Response: { parcels: [{ parcelNumber, status, events: [...] }] }
    const parcel = data?.parcels?.[0] || data?.[0] || data;
    if (!parcel) return null;

    const events = parcel.events || [];
    const lastEvent = events[0] || {}; // primul = cel mai recent
    
    // Status din câmpul parcel.status sau din ultimul eveniment
    const statusCode = String(
      parcel.status?.code || parcel.deliveryStatus || 
      parcel.statusCode || lastEvent.code || lastEvent.eventCode || ''
    ).toUpperCase().replace(/\s/g, '_');

    const mapped = GLS_EVENT_STATUS[statusCode] || 'in_transit';

    const result = {
      status: mapped,
      statusRaw: statusCode,
      lastUpdate: lastEvent.timestamp || lastEvent.date || parcel.lastUpdate || '',
      location: lastEvent.location?.city || lastEvent.city || lastEvent.depot || '',
      description: lastEvent.description || lastEvent.eventDescription || '',
    };

    trackingCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch(e) {
    console.log('[GLS] Exception:', e.message, awb);
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
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const awb    = searchParams.get('awb');
  const courier = searchParams.get('courier') || 'gls';
  const debug  = searchParams.get('debug') === '1';

  if (!awb) return NextResponse.json({ error: 'AWB lipsă' }, { status: 400 });

  if (debug) {
    if (!GLS_API_KEY) return NextResponse.json({
      error: 'GLS_API_KEY lipsă în Vercel Environment Variables'
    });

    const results = [];
    const authHeader = getAuthHeader();

    // Testăm endpoint-urile corecte din documentație
    const endpoints = [
      `https://api-sandbox.gls-group.net/track-and-trace-v1/tracking/simple/trackids/${awb}`,
      `https://api-sandbox.gls-group.net/track-and-trace-v1/tracking/simple/references/${awb}`,
    ];

    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        const text = await r.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 300); }
        results.push({ url, status: r.status, response: parsed });
      } catch(e) {
        results.push({ url, error: e.message });
      }
    }

    return NextResponse.json({
      awb,
      auth: `Basic ${GLS_APP_ID.slice(0,6)}:${GLS_API_KEY.slice(0,6)}...`,
      results
    });
  }

  const c = courier.toLowerCase();
  const result = c.includes('sameday') ? await trackSameday(awb) : await trackGLS(awb);
  return NextResponse.json({ awb, courier, ...result });
}

export async function POST(request) {
  try {
    const { orders } = await request.json();
    if (!orders?.length) return NextResponse.json({ results: [] });

    if (!GLS_API_KEY) return NextResponse.json({
      results: [],
      error: 'GLS_API_KEY lipsă. Adaugă în Vercel → Settings → Environment Variables.'
    });

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

