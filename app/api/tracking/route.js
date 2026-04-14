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
  if ([5, 9, 30].includes(id)) return 'delivered';
  // LA CURIER / ÎN LIVRARE (statusId 33 = curier urmează să livreze, 4 = preluat de curier)
  if ([4, 10, 33, 34, 35].includes(id)) return 'out_for_delivery';
  // RETUR CONFIRMAT — doar când e explicit retur finalizat
  if ([21, 22].includes(id)) return 'returned';
  // TENTATIVĂ EȘUATĂ
  if ([6, 13, 14, 15, 16, 17, 18, 19, 20].includes(id)) return 'failed_attempt';
  // ÎN TRANZIT — toate celelalte (1,7,8,11,23,24,25,26,27,84 etc.)
  return 'in_transit';
}

// Parsează răspuns XML sau JSON de la Sameday
function parseSamedayResponse(text) {
  // Încearcă JSON primul
  try {
    const j = JSON.parse(text);
    const history = j.awbHistory || j.history || [];
    const last = history[0];
    if (last) return {
      statusId: last.statusId,
      statusLabel: last.statusLabel || last.statusDescription || '',
      statusDate: last.statusDate || last.date || '',
      county: last.county || last.city || '',
    };
  } catch {}

  // Parsare XML — API-ul Sameday returnează XML în multe cazuri
  try {
    // Extragem primul <entry> din <awbHistory> (cel mai recent status)
    const awbHistoryMatch = text.match(/<awbHistory>([\s\S]*?)<\/awbHistory>/);
    if (!awbHistoryMatch) return null;
    const firstEntry = awbHistoryMatch[1].match(/<entry>([\s\S]*?)<\/entry>/);
    if (!firstEntry) return null;
    const entryXml = firstEntry[1];

    const getXmlVal = (xml, tag) => {
      const m = xml.match(new RegExp(`<${tag}>[^<]*<!\[CDATA\[([^\]]*)]]\/[^<]*>\|\/?\ *<${tag}>([^<]*)<\/${tag}>`));
      if (m) return (m[1] || m[2] || '').trim();
      const m2 = xml.match(new RegExp(`<${tag}><!\[CDATA\[([\s\S]*?)\]\]><\/${tag}>`));
      return m2 ? m2[1].trim() : '';
    };

    // Extragem statusId — primul tag simplu (nu CDATA)
    const statusIdMatch = entryXml.match(/<statusId>\s*(\d+)\s*<\/statusId>/);
    const statusId = statusIdMatch ? statusIdMatch[1] : '';

    // Status text — primul <status> din entry
    const statusMatch = entryXml.match(/<status>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/status>/);
    const statusLabel = statusMatch ? statusMatch[1].trim() : '';

    const dateMatch = entryXml.match(/<statusDate>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/statusDate>/);
    const statusDate = dateMatch ? dateMatch[1].trim() : '';

    const countyMatch = entryXml.match(/<county>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/county>/);
    const county = countyMatch ? countyMatch[1].trim() : '';

    if (!statusId) return null;
    return { statusId, statusLabel, statusDate, county };
  } catch(e) {
    console.log('[SAMEDAY] XML parse error:', e.message);
    return null;
  }
}

async function trackSameday(awb) {
  const cacheKey = `sd_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    // Încercăm ÎNTÂI endpoint-ul public (nu necesită autentificare, funcționează sigur)
    const pubRes = await fetch(`${SD_BASE}/api/public/awb/${awb.trim()}/awb-history`, {
      headers: { 'Accept': 'application/json, text/xml, */*' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });

    if (pubRes.ok) {
      const text = await pubRes.text();
      console.log('[SAMEDAY] Public response for', awb, ':', text.slice(0, 200));
      const parsed = parseSamedayResponse(text);
      if (parsed && parsed.statusId) {
        const result = {
          status: mapSamedayStatus(parsed.statusId),
          statusRaw: parsed.statusLabel || String(parsed.statusId),
          statusDescription: parsed.statusLabel || '',
          lastUpdate: parsed.statusDate || '',
          location: parsed.county || '',
        };
        trackingCache.set(cacheKey, { data: result, ts: Date.now() });
        return result;
      }
    }

    // Fallback: API autentificat
    const token = await getSamedayToken();
    const authRes = await fetch(`${SD_BASE}/api/client/awb/${awb.trim()}/awb-history`, {
      headers: { 'X-AUTH-TOKEN': token, 'Accept': 'application/json, text/xml, */*' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });

    if (!authRes.ok) {
      console.log('[SAMEDAY] Auth endpoint failed:', authRes.status, 'AWB:', awb);
      return null;
    }

    const text2 = await authRes.text();
    const parsed2 = parseSamedayResponse(text2);
    if (!parsed2 || !parsed2.statusId) return null;

    const result2 = {
      status: mapSamedayStatus(parsed2.statusId),
      statusRaw: parsed2.statusLabel || String(parsed2.statusId),
      statusDescription: parsed2.statusLabel || '',
      lastUpdate: parsed2.statusDate || '',
      location: parsed2.county || '',
    };

    trackingCache.set(cacheKey, { data: result2, ts: Date.now() });
    return result2;

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


