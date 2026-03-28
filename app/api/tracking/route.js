import { NextResponse } from 'next/server';

const trackingCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
let glsToken = null;
let glsTokenExpiry = 0;

const GLS_API_KEY = process.env.GLS_API_KEY || '';
const GLS_APP_ID  = process.env.GLS_APP_ID  || '';

const SAMEDAY_STATUS_MAP = {
  '1':'in_transit','2':'in_transit','3':'in_transit',
  '4':'out_for_delivery','5':'delivered','6':'failed_attempt',
  '7':'returned','8':'returned','10':'in_transit',
  '11':'failure','24':'out_for_delivery','25':'in_transit',
};

const GLS_EVENT_STATUS = {
  'DELIVERED':'delivered','DELIVERED_PS':'delivered',
  'INDELIVERY':'out_for_delivery','OUT_FOR_DELIVERY':'out_for_delivery',
  'INTRANSIT':'in_transit','IN_TRANSIT':'in_transit',
  'INWAREHOUSE':'in_transit','PICKED_UP':'in_transit','PREADVICE':'in_transit',
  'NOTDELIVERED':'failed_attempt','NOT_DELIVERED':'failed_attempt',
  'RETURNED':'returned','RETURN':'returned',
};

// Obținem JWT token de la GLS OAuth
async function getGLSToken() {
  if (glsToken && Date.now() < glsTokenExpiry - 60000) return glsToken;

  try {
    // GLS OAuth2 endpoint
    const res = await fetch('https://api-sandbox.gls-group.net/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${GLS_APP_ID}:${GLS_API_KEY}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.log('[GLS AUTH] Failed:', res.status, text.slice(0, 200));
      return null;
    }

    const data = await res.json();
    glsToken = data.access_token;
    glsTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    console.log('[GLS AUTH] Token obtained, expires in', data.expires_in, 's');
    return glsToken;
  } catch(e) {
    console.log('[GLS AUTH] Exception:', e.message);
    return null;
  }
}

async function trackGLS(awb) {
  const cacheKey = `gls_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const token = await getGLSToken();
  if (!token) return null;

  try {
    const url = `https://api-sandbox.gls-group.net/track-and-trace-v1/tracking/simple/trackids/${awb}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.log('[GLS TRACK] Error:', res.status, awb);
      return null;
    }

    const data = await res.json();
    const parcel = data?.parcels?.[0] || data?.[0] || data;
    const events = parcel?.events || [];
    const lastEvent = events[0] || {};

    const statusCode = String(
      parcel?.status?.code || parcel?.deliveryStatus ||
      lastEvent?.code || lastEvent?.eventCode || ''
    ).toUpperCase().replace(/\s/g,'_');

    const result = {
      status: GLS_EVENT_STATUS[statusCode] || 'in_transit',
      statusRaw: statusCode,
      lastUpdate: lastEvent?.timestamp || lastEvent?.date || '',
      location: lastEvent?.location?.city || lastEvent?.city || '',
      description: lastEvent?.description || '',
    };

    trackingCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch(e) {
    console.log('[GLS TRACK] Exception:', e.message);
    return null;
  }
}

async function trackSameday(awb) {
  const cacheKey = `sd_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  try {
    const res = await fetch(`https://api.sameday.ro/api/public/awb/${awb}/awb-history`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    const last = (data.awbHistory||[])[0];
    if (!last) return null;
    const result = {
      status: SAMEDAY_STATUS_MAP[String(last.statusId||'')] || 'in_transit',
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
    const results = {};

    // Test 1: OAuth token
    try {
      const tokenRes = await fetch('https://api-sandbox.gls-group.net/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${GLS_APP_ID}:${GLS_API_KEY}`).toString('base64')}`,
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(10000),
      });
      const tokenText = await tokenRes.text();
      let tokenData;
      try { tokenData = JSON.parse(tokenText); } catch { tokenData = tokenText.slice(0,200); }
      results.oauth = { status: tokenRes.status, data: tokenData };

      // Test 2: dacă avem token, testăm tracking
      if (tokenRes.ok && tokenData.access_token) {
        const trackRes = await fetch(
          `https://api-sandbox.gls-group.net/track-and-trace-v1/tracking/simple/trackids/${awb}`,
          {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000),
          }
        );
        const trackText = await trackRes.text();
        let trackData;
        try { trackData = JSON.parse(trackText); } catch { trackData = trackText.slice(0,300); }
        results.tracking = { status: trackRes.status, data: trackData };
      }
    } catch(e) {
      results.error = e.message;
    }

    return NextResponse.json({ awb, credentials: { appId: GLS_APP_ID.slice(0,8)+'...', apiKey: GLS_API_KEY.slice(0,8)+'...' }, results });
  }

  const c = courier.toLowerCase();
  const result = c.includes('sameday') ? await trackSameday(awb) : await trackGLS(awb);
  return NextResponse.json({ awb, courier, ...result });
}

export async function POST(request) {
  try {
    const { orders } = await request.json();
    if (!orders?.length) return NextResponse.json({ results: [] });
    if (!GLS_API_KEY) return NextResponse.json({ results: [], error: 'GLS_API_KEY lipsă' });

    const results = [];
    for (let i = 0; i < orders.length; i += 5) {
      const batch = orders.slice(i, i + 5);
      const batchRes = await Promise.allSettled(
        batch.map(async ({ id, awb, courier }) => {
          if (!awb) return { id, status: null };
          const t = (courier||'').toLowerCase().includes('sameday')
            ? await trackSameday(awb) : await trackGLS(awb);
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

