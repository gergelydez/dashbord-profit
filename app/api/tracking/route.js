import { NextResponse } from 'next/server';

const trackingCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
let glsToken = null;
let glsTokenExpiry = 0;

const GLS_APP_ID     = process.env.GLS_APP_ID     || ''; // client_id
const GLS_API_KEY    = process.env.GLS_API_KEY    || '';
const GLS_API_SECRET = process.env.GLS_API_SECRET || '';
const OAUTH_URL      = 'https://api-sandbox.gls-group.net/oauth2/v2/token';
const TRACKING_BASE  = 'https://api-sandbox.gls-group.net/track-and-trace-v1';

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

async function getGLSToken() {
  if (glsToken && Date.now() < glsTokenExpiry - 60000) return glsToken;
  try {
    const secret = process.env.GLS_API_SECRET || '';
    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Combinația corectă: Key:Secret (Basic Auth)
        'Authorization': `Basic ${Buffer.from(`${GLS_API_KEY}:${secret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.log('[GLS AUTH]', res.status, await res.text()); return null; }
    const data = await res.json();
    glsToken = data.access_token;
    glsTokenExpiry = Date.now() + (data.expires_in || 14400) * 1000;
    return glsToken;
  } catch(e) { console.log('[GLS AUTH]', e.message); return null; }
}

async function trackGLS(awb, createdAt = null) {
  const cacheKey = `gls_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const token = await getGLSToken();
  if (!token) return null;

  try {
    const url = `${TRACKING_BASE}/tracking/simple/trackids/${awb}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.log('[GLS TRACK]', res.status, awb); return null; }
    const data = await res.json();

    const parcel = data?.parcels?.[0] || data?.[0] || data;

    // E_404_01 = AWB negăsit/arhivat în GLS
    // Dacă comanda e mai veche de 14 zile → aproape sigur livrat și arhivat
    // Dacă e mai nouă → AWB poate nu e înregistrat încă în GLS
    if (parcel?.errorCode === 'E_404_01') {
      if (createdAt) {
        const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > 14) {
          return { status: 'delivered', statusRaw: 'ARCHIVED_GLS', lastUpdate: '', location: '' };
        }
      }
      return null; // Comandă recentă → nu schimbăm statusul
    }

    const events = parcel?.events || [];
    const lastEvent = events[0] || {};
    const statusCode = String(
      parcel?.status?.code || parcel?.deliveryStatus ||
      parcel?.statusCode || lastEvent?.code || lastEvent?.eventCode || ''
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
  } catch(e) { console.log('[GLS TRACK]', e.message); return null; }
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
    // Testăm toate combinațiile posibile
    try {
      const secret = GLS_API_SECRET || GLS_API_KEY;
      const combos = [
        // AppID:Secret — varianta corectă OAuth2
        { label: 'Basic AppID:Secret', headers: { 'Authorization': `Basic ${Buffer.from(`${GLS_APP_ID}:${secret}`).toString('base64')}` }, body: 'grant_type=client_credentials' },
        // Body cu client_id + client_secret
        { label: 'Body AppID+Secret', headers: {}, body: `grant_type=client_credentials&client_id=${GLS_APP_ID}&client_secret=${secret}` },
        // Key:Secret
        { label: 'Basic Key:Secret', headers: { 'Authorization': `Basic ${Buffer.from(`${GLS_API_KEY}:${secret}`).toString('base64')}` }, body: 'grant_type=client_credentials' },
        // Doar AppID:Key (varianta veche)
        { label: 'Basic AppID:Key', headers: { 'Authorization': `Basic ${Buffer.from(`${GLS_APP_ID}:${GLS_API_KEY}`).toString('base64')}` }, body: 'grant_type=client_credentials' },
      ];

      results.oauthTests = [];
      let bestToken = null;

      for (const combo of combos) {
        try {
          const r = await fetch(OAUTH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...combo.headers },
            body: combo.body,
            signal: AbortSignal.timeout(8000),
          });
          const text = await r.text();
          let data; try { data = JSON.parse(text); } catch { data = text.slice(0,100); }
          results.oauthTests.push({ label: combo.label, status: r.status, data });
          if (r.ok && data?.access_token) { bestToken = data.access_token; break; }
        } catch(e) {
          results.oauthTests.push({ label: combo.label, error: e.message });
        }
      }

      const r = { ok: !!bestToken };
      const data = bestToken ? { access_token: bestToken } : null;
      results.oauth = { found: !!bestToken };

      // Step 2: tracking cu token - răspuns COMPLET
      if (r.ok && data?.access_token) {
        // Testăm ambele endpoint-uri
        for (const endpoint of [
          `${TRACKING_BASE}/tracking/simple/trackids/${awb}`,
          `${TRACKING_BASE}/tracking/simple/references/${awb}`,
        ]) {
          const tr = await fetch(endpoint, {
            headers: { 'Authorization': `Bearer ${data.access_token}`, 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000),
          });
          const ttext = await tr.text();
          let tdata; try { tdata = JSON.parse(ttext); } catch { tdata = ttext.slice(0,500); }
          results['tracking_' + endpoint.split('/').pop()] = { 
            status: tr.status, 
            data: tdata  // Răspuns COMPLET netrunchiat
          };
        }
      }
    } catch(e) { results.error = e.message; }

    return NextResponse.json({
      awb,
      config: {
        appId: GLS_APP_ID ? GLS_APP_ID.slice(0,8)+'...' : '❌ lipsă',
        apiKey: GLS_API_KEY ? GLS_API_KEY.slice(0,8)+'...' : '❌ lipsă',
        oauthUrl: OAUTH_URL,
      },
      results,
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
    if (!GLS_API_KEY) return NextResponse.json({ results: [], error: 'GLS_API_KEY lipsă' });

    const results = [];
    for (let i = 0; i < orders.length; i += 5) {
      const batch = orders.slice(i, i + 5);
      const batchRes = await Promise.allSettled(
        batch.map(async ({ id, awb, courier, createdAt }) => {
          if (!awb) return { id, status: null };
          const t = (courier||'').toLowerCase().includes('sameday')
            ? await trackSameday(awb) : await trackGLS(awb, createdAt);
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

