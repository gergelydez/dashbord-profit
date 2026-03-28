import { NextResponse } from 'next/server';
import crypto from 'crypto';

const trackingCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

// Credențiale MyGLS România din Vercel env vars
const GLS_USERNAME = process.env.GLS_USERNAME || ''; // email MyGLS
const GLS_PASSWORD = process.env.GLS_PASSWORD || ''; // parola MyGLS

// API URL România
const GLS_RO_URL = 'https://api.mygls.ro/ParcelService.svc/json/GetParcelStatuses';

// Parola trebuie hash-uită cu SHA512
function hashPassword(password) {
  return Array.from(
    crypto.createHash('sha512').update(password, 'utf8').digest()
  );
}

// GLS Status Codes → status intern (din Appendix G)
function mapGLSStatus(statusCode) {
  const code = parseInt(statusCode);
  if ([5, 54, 55, 58, 92].includes(code)) return 'delivered';
  if ([4, 32].includes(code)) return 'out_for_delivery';
  if ([23, 40].includes(code)) return 'returned';
  if ([11,12,14,15,16,17,18,19,20,33,34,35,36].includes(code)) return 'failed_attempt';
  if ([1,2,3,6,7,8,9,10,21,22,25,26,27,41,47,51,52,53].includes(code)) return 'in_transit';
  return 'in_transit';
}

async function trackGLS(awb) {
  const cacheKey = `gls_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  if (!GLS_USERNAME || !GLS_PASSWORD) {
    console.log('[GLS RO] Credențiale lipsă!');
    return null;
  }

  try {
    const body = {
      Username: GLS_USERNAME,
      Password: hashPassword(GLS_PASSWORD),
      ParcelNumber: parseInt(awb),
      ReturnPOD: false,
      LanguageIsoCode: 'RO',
    };

    const res = await fetch(GLS_RO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.log('[GLS RO] Error:', res.status, awb);
      return null;
    }

    const data = await res.json();
    console.log('[GLS RO] Response for', awb, ':', JSON.stringify(data).slice(0, 300));

    // Verificăm erori
    const errors = data.GetParcelStatusErrors || [];
    if (errors.length > 0) {
      console.log('[GLS RO] Errors:', errors);
      return null;
    }

    // Luăm statusurile
    const statusList = data.ParcelStatusList || [];
    if (!statusList.length) return null;

    // Ultimul status = primul din listă (cel mai recent)
    const last = statusList[0];
    const mapped = mapGLSStatus(last.StatusCode);

    const result = {
      status: mapped,
      statusRaw: last.StatusCode,
      statusDescription: last.StatusDescription || '',
      lastUpdate: last.StatusDate || '',
      location: last.DepotCity || '',
    };

    trackingCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch(e) {
    console.log('[GLS RO] Exception:', e.message, awb);
    return null;
  }
}

// Sameday tracking
const SAMEDAY_STATUS_MAP = {
  '1':'in_transit','2':'in_transit','3':'in_transit',
  '4':'out_for_delivery','5':'delivered','6':'failed_attempt',
  '7':'returned','8':'returned','10':'in_transit',
  '11':'failure','24':'out_for_delivery','25':'in_transit',
};

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

// GET: single AWB sau debug
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const awb    = searchParams.get('awb');
  const courier = searchParams.get('courier') || 'gls';
  const debug  = searchParams.get('debug') === '1';

  if (!awb) return NextResponse.json({ error: 'AWB lipsă' }, { status: 400 });

  if (debug) {
    try {
      const body = {
        Username: GLS_USERNAME,
        Password: hashPassword(GLS_PASSWORD),
        ParcelNumber: parseInt(awb),
        ReturnPOD: false,
        LanguageIsoCode: 'RO',
      };

      const res = await fetch(GLS_RO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, Password: '[SHA512_HASH]' }),
        signal: AbortSignal.timeout(10000),
      });

      // Refacem cu parola reală
      const res2 = await fetch(GLS_RO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      const data = await res2.json();
      return NextResponse.json({
        awb,
        credentials: {
          username: GLS_USERNAME ? `✅ ${GLS_USERNAME}` : '❌ lipsă GLS_USERNAME',
          password: GLS_PASSWORD ? '✅ setat' : '❌ lipsă GLS_PASSWORD',
        },
        httpStatus: res2.status,
        response: data,
      });
    } catch(e) {
      return NextResponse.json({ awb, error: e.message });
    }
  }

  const c = courier.toLowerCase();
  const result = c.includes('sameday') ? await trackSameday(awb) : await trackGLS(awb);
  return NextResponse.json({ awb, courier, ...result });
}

// POST: batch tracking
export async function POST(request) {
  try {
    const { orders } = await request.json();
    if (!orders?.length) return NextResponse.json({ results: [] });

    if (!GLS_USERNAME || !GLS_PASSWORD) {
      return NextResponse.json({
        results: [],
        error: 'Lipsesc GLS_USERNAME și GLS_PASSWORD în Vercel Environment Variables'
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
      if (i + 5 < orders.length) await new Promise(r => setTimeout(r, 300));
    }

    return NextResponse.json({ results, count: results.length });
  } catch(e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

