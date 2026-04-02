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

// GLS Status Codes → status intern (din Appendix G documentație MyGLS)
function mapGLSStatus(statusCode) {
  const code = parseInt(statusCode);
  // LIVRAT
  if ([5, 54, 55, 58, 92, 93].includes(code)) return 'delivered';
  // LA CURIER / ÎN LIVRARE AZI
  if ([4, 32, 85].includes(code)) return 'out_for_delivery';
  // RETUR
  if ([23, 40].includes(code)) return 'returned';
  // TENTATIVĂ EȘUATĂ
  if ([11,12,14,15,16,17,18,19,20,33,34,35,36,43,68,87,88,89,90].includes(code)) return 'failed_attempt';
  // ÎN TRANZIT (toate celelalte stări active)
  // 1=preluat, 2=plecat din depozit, 3=ajuns depozit, 6=stocat, 7=stocat
  // 8=ridicare proprie, 9=reprogramat, 10=scan normal
  // 21=eroare sortare, 22=trimis la sortare, 25=redirecționat
  // 26=ajuns depozit, 27=ajuns depozit, 41=redirecționat
  // 47=plecat depozit, 51=date înregistrate, 52=date ramburs
  // 53=tranzit depozit, 83=pickup înregistrat, 86=preluat de curier
  if ([1,2,3,6,7,8,9,10,13,21,22,24,25,26,27,29,41,46,47,
       51,52,53,56,59,80,83,84,85,86,97,99].includes(code)) return 'in_transit';
  // Default
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

    // Parsăm data GLS: /Date(1774645401000+0100)/ → timestamp
    const parseGLSDate = (dateStr) => {
      if (!dateStr) return '';
      const match = dateStr.match(/\/Date\((\d+)/);
      if (match) return new Date(parseInt(match[1])).toISOString();
      return dateStr;
    };

    const result = {
      status: mapped,
      statusRaw: last.StatusCode,
      statusDescription: last.StatusDescription || '',
      lastUpdate: parseGLSDate(last.StatusDate),
      location: last.DepotCity || '',
    };

    trackingCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch(e) {
    console.log('[GLS RO] Exception:', e.message, awb);
    return null;
  }
}

// ── SAMEDAY TRACKING (autentificat cu credențiale client) ──
const SD_BASE = 'https://api.sameday.ro';
const SD_USER = process.env.SAMEDAY_USERNAME;
const SD_PASS = process.env.SAMEDAY_PASSWORD;

// Token cache — valid 12h, reîmprospătat automat
let sdTokenCache = { token: null, expiresAt: 0 };

async function getSamedayToken() {
  if (sdTokenCache.token && Date.now() < sdTokenCache.expiresAt) {
    return sdTokenCache.token;
  }
  if (!SD_USER || !SD_PASS) throw new Error('Lipsesc SAMEDAY_USERNAME / SAMEDAY_PASSWORD în env vars');

  const res = await fetch(`${SD_BASE}/api/authenticate`, {
    method: 'POST',
    headers: {
      'X-AUTH-USERNAME': SD_USER,
      'X-AUTH-PASSWORD': SD_PASS,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Sameday auth ${res.status}: ${txt.slice(0, 100)}`);
  }

  const data = await res.json();
  sdTokenCache = {
    token: data.token,
    expiresAt: Date.now() + 11 * 60 * 60 * 1000, // 11h (token valid 12h)
  };
  return data.token;
}

// Mapare statusuri Sameday (statusId din API-ul autentificat)
// Sursa: documentație Sameday + testare live
function mapSamedayStatus(statusId) {
  const id = parseInt(statusId);
  // LIVRAT
  if ([5, 9].includes(id)) return 'delivered';
  // LA CURIER / ÎN LIVRARE AZI
  if ([4, 10].includes(id)) return 'out_for_delivery';
  // RETUR confirmat (nu simplu "returnat" din Shopify)
  if ([8, 11, 12].includes(id)) return 'returned';
  // TENTATIVĂ EȘUATĂ
  if ([6, 7].includes(id)) return 'failed_attempt';
  // ÎN TRANZIT (toate celelalte stări active: preluat, hub, sortare, etc.)
  return 'in_transit';
}

async function trackSameday(awb) {
  const cacheKey = `sd_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const token = await getSamedayToken();

    // Endpoint autentificat — returnează istoricul complet al coletului
    const res = await fetch(`${SD_BASE}/api/client/awb/${awb.trim()}/awb-history`, {
      headers: {
        'X-AUTH-TOKEN': token,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });

    if (!res.ok) {
      // Fallback: endpoint alternativ
      const res2 = await fetch(`${SD_BASE}/api/awb/${awb.trim()}/status`, {
        headers: { 'X-AUTH-TOKEN': token, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      });
      if (!res2.ok) {
        console.log('[SAMEDAY] Ambele endpoint-uri au eșuat pentru AWB:', awb, res.status, res2.status);
        return null;
      }
      const d2 = await res2.json();
      const result2 = {
        status: mapSamedayStatus(d2.statusId || d2.status || ''),
        statusRaw: d2.statusLabel || d2.statusDescription || String(d2.statusId || ''),
        lastUpdate: d2.statusDate || d2.date || '',
        location: d2.county || d2.location || '',
      };
      trackingCache.set(cacheKey, { data: result2, ts: Date.now() });
      return result2;
    }

    const data = await res.json();
    console.log('[SAMEDAY] Response for', awb, ':', JSON.stringify(data).slice(0, 300));

    // Ultimul status = primul din awbHistory (cel mai recent)
    const history = data.awbHistory || data.history || [];
    const last = history[0];
    if (!last) return null;

    const result = {
      status: mapSamedayStatus(last.statusId || last.status || ''),
      statusRaw: last.statusLabel || last.statusDescription || String(last.statusId || ''),
      statusDescription: last.statusLabel || last.statusDescription || '',
      lastUpdate: last.statusDate || last.date || '',
      location: last.county || last.city || last.location || '',
    };

    trackingCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;

  } catch(e) {
    console.log('[SAMEDAY] Exception:', e.message, 'AWB:', awb);
    return null;
  }
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

