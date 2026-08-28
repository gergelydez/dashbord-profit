import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ENV_USER = process.env.SAMEDAY_USERNAME || '';
const ENV_PASS = process.env.SAMEDAY_PASSWORD || '';
const SD_BASE  = 'https://api.sameday.ro';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

// Cache token în memorie (valabil ~1 oră la Sameday). Autentificare prin
// headere X-AUTH-USERNAME/X-AUTH-PASSWORD — la fel ca în /api/tracking, unde
// această formă chiar funcționează în producție (varianta cu username/parolă
// în body JSON, folosită în /api/sameday-awb, întorcea aici un răspuns fără
// "message" clar, ajungând să afișeze "[object Object]").
let _tokenCache = null;
async function sdAuth(user, pass) {
  if (_tokenCache && _tokenCache.user === user && Date.now() - _tokenCache.ts < 50 * 60 * 1000) {
    return _tokenCache.token;
  }
  const res = await fetch(`${SD_BASE}/api/authenticate`, {
    method: 'POST',
    headers: {
      'X-AUTH-USERNAME': user,
      'X-AUTH-PASSWORD': pass,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Auth răspuns invalid (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = data?.message || (typeof data?.error === 'string' ? data.error : data?.error?.message)
      || `Auth ${res.status}: ${JSON.stringify(data).slice(0, 200)}`;
    throw new Error(msg);
  }
  const token = data.token || data.Token;
  if (!token) throw new Error('Token lipsă în răspuns Sameday');
  _tokenCache = { token, user, ts: Date.now() };
  return token;
}

/**
 * GET /api/client/status-sync nu are documentație publică — folosit aici
 * DOAR ca sursă de descoperire a AWB-urilor care au avut vreo mișcare de
 * status în interval, nu ca sursă de adevăr pentru statusul lor (acela
 * vine din /api/tracking, deja verificat în producție). Forma exactă a
 * plicului de răspuns (cheia sub care vine lista de intrări) nu e
 * cunoscută dinainte, deci extragem defensiv orice formă rezonabilă și
 * întoarcem un sample brut ca să putem verifica/ajusta după primul test live.
 */
function extractEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['data', 'results', 'items', 'entries', 'statuses', 'content']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function extractAwb(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.parcelAwbNumber || entry.awbNumber || entry.awb || entry.parcelNumber || '').trim();
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!ENV_USER || !ENV_PASS) {
      return NextResponse.json({ ok: false, error: 'Credențiale Sameday lipsă (SAMEDAY_USERNAME/SAMEDAY_PASSWORD).' }, { headers: CORS });
    }

    const days = parseInt(body.days) || 30;
    const endTimestamp = Math.floor(Date.now() / 1000);
    const startTimestamp = endTimestamp - days * 86400;

    const token = await sdAuth(ENV_USER, ENV_PASS);

    const awbSet = new Set();
    const rawSample = [];
    let envelopeKeys = [];
    let page = 1;
    const countPerPage = 500;
    const MAX_PAGES = 40; // siguranță — nu se atinge niciodată la volume lunare normale
    let lastPageCount = countPerPage;

    while (lastPageCount === countPerPage && page <= MAX_PAGES) {
      const params = new URLSearchParams({
        startTimestamp: String(startTimestamp),
        endTimestamp: String(endTimestamp),
        page: String(page),
        countPerPage: String(countPerPage),
      });
      const res = await fetch(`${SD_BASE}/api/client/status-sync?${params}`, {
        headers: { 'X-AUTH-TOKEN': token, 'Accept': 'application/json' },
        cache: 'no-store',
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`status-sync (${res.status}): ${raw.slice(0, 300)}`);
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error(`Răspuns invalid status-sync: ${raw.slice(0, 200)}`); }

      if (page === 1) envelopeKeys = Array.isArray(data) ? ['(array direct)'] : Object.keys(data || {});
      const entries = extractEntries(data);
      for (const entry of entries) {
        const awb = extractAwb(entry);
        if (awb) awbSet.add(awb);
        if (rawSample.length < 3) rawSample.push(entry);
      }
      lastPageCount = entries.length;
      page++;
    }

    return NextResponse.json({
      ok: true,
      count: awbSet.size,
      awbs: Array.from(awbSet),
      pagesScanned: page - 1,
      debug: { envelopeKeys, rawSample, startTimestamp, endTimestamp },
    }, { headers: CORS });
  } catch (e) {
    console.error('[Sameday StatusSync]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}
