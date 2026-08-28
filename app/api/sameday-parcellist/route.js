import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ENV_USER = process.env.SAMEDAY_USERNAME || '';
const ENV_PASS = process.env.SAMEDAY_PASSWORD || '';
const SD_BASE  = 'https://api.sameday.ro';

// Confirmat live pe cont: status-sync respinge orice interval
// startTimestamp/endTimestamp mai mare de 7200s ("Diferența dintre date
// trebuie să fie mai mică de 7200 secunde!") — nu e un simplu limit de
// paginare, e o regulă de validare pe fereastra de timp cerută. Scanăm deci
// perioada cerută în ferestre de sub 2h, în paralel (loturi mici, ca să nu
// lovim rate-limiting), și oprim înainte de limita funcției dacă intervalul
// e prea mare ca să încapă întreg — raportăm transparent cât am acoperit.
const WINDOW_SECONDS = 7000;
const MAX_DAYS = 45;
const CONCURRENCY = 6;
const BATCH_PAUSE_MS = 100;
const TIME_BUDGET_MS = 45000;

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

// O singură fereastră de sub 7200s — paginată defensiv (nu ar trebui să
// depășească o pagină pe 2h la volume normale, dar nu presupunem asta).
async function scanWindow(token, startTs, endTs) {
  const awbs = [];
  let envelopeKeys = null;
  let sample = null;
  let page = 1;
  const countPerPage = 500;
  let lastCount = countPerPage;

  while (lastCount === countPerPage && page <= 3) {
    const params = new URLSearchParams({
      startTimestamp: String(startTs),
      endTimestamp: String(endTs),
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
      if (awb) awbs.push(awb);
      if (!sample) sample = entry;
    }
    lastCount = entries.length;
    page++;
  }

  return { awbs, envelopeKeys, sample };
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!ENV_USER || !ENV_PASS) {
      return NextResponse.json({ ok: false, error: 'Credențiale Sameday lipsă (SAMEDAY_USERNAME/SAMEDAY_PASSWORD).' }, { headers: CORS });
    }

    const days = Math.min(parseInt(body.days) || 30, MAX_DAYS);
    const endTimestamp = Math.floor(Date.now() / 1000);
    const startTimestamp = endTimestamp - days * 86400;

    const windows = [];
    for (let winEnd = endTimestamp; winEnd > startTimestamp; winEnd -= WINDOW_SECONDS) {
      windows.push([Math.max(startTimestamp, winEnd - WINDOW_SECONDS), winEnd]);
    }
    // cele mai recente ferestre primele — dacă bugetul de timp ne oprește
    // înainte de a acoperi tot intervalul cerut, tot avem datele proaspete

    const token = await sdAuth(ENV_USER, ENV_PASS);

    const awbSet = new Set();
    const rawSample = [];
    let envelopeKeys = null;
    let windowErrors = 0;
    let scanned = 0;
    const t0 = Date.now();

    for (let i = 0; i < windows.length; i += CONCURRENCY) {
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
      const batch = windows.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(([s, e]) => scanWindow(token, s, e)));
      for (const r of results) {
        scanned++;
        if (r.status === 'fulfilled') {
          for (const awb of r.value.awbs) awbSet.add(awb);
          if (!envelopeKeys && r.value.envelopeKeys) envelopeKeys = r.value.envelopeKeys;
          if (rawSample.length < 3 && r.value.sample) rawSample.push(r.value.sample);
        } else {
          windowErrors++;
        }
      }
      if (i + CONCURRENCY < windows.length) await new Promise(res => setTimeout(res, BATCH_PAUSE_MS));
    }

    const truncated = scanned < windows.length;

    return NextResponse.json({
      ok: true,
      count: awbSet.size,
      awbs: Array.from(awbSet),
      debug: {
        envelopeKeys, rawSample, startTimestamp, endTimestamp,
        windowSeconds: WINDOW_SECONDS,
        totalWindows: windows.length,
        windowsScanned: scanned,
        windowErrors,
        truncated,
        coverageHours: Math.round((scanned * WINDOW_SECONDS) / 3600),
        note: truncated ? 'Intervalul cerut e prea mare pentru limita de 2h/cerere a status-sync — am acoperit doar cele mai recente ore înainte să depășim bugetul de timp al funcției.' : undefined,
      },
    }, { headers: CORS });
  } catch (e) {
    console.error('[Sameday StatusSync]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}
