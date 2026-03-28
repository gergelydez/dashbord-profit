import { NextResponse } from 'next/server';

// Cache în memorie — nu verificăm același AWB mai des de 30 min
const trackingCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minute

// ── GLS România status codes ──
// Documentație: https://gls-group.eu/app/service/open/rest/RO/ro/rstt001
const GLS_STATUS_MAP = {
  // Text descriptiv (evtDscr)
  'DELIVERED':              'delivered',
  'DELIVERED_PS':           'delivered',
  'PICKED_UP':              'in_transit',
  'IN_TRANSIT':             'in_transit',
  'IN_WAREHOUSE':           'in_transit',
  'INWAREHOUSE':            'in_transit',
  'OUT_FOR_DELIVERY':       'out_for_delivery',
  'INDELIVERY':             'out_for_delivery',
  'AT_DELIVERY':            'out_for_delivery',
  'NOT_DELIVERED':          'failed_attempt',
  'NOTDELIVERED':           'failed_attempt',
  'RETURN_TO_SENDER':       'returned',
  'RETURNED':               'returned',
  'CANCELLED':              'failure',
  // Coduri numerice GLS
  '0': 'in_transit',   // AWB creat
  '1': 'in_transit',   // Preluat de la expeditor
  '2': 'in_transit',   // Ajuns în depozit
  '3': 'out_for_delivery', // Ieșit pentru livrare
  '4': 'delivered',    // Livrat
  '5': 'failed_attempt',  // Tentativă eșuată
  '6': 'returned',     // Retur
  '7': 'in_transit',   // Reprogramat
};

// ── Sameday status codes ──
const SAMEDAY_STATUS_MAP = {
  '1':  'in_transit',       // AWB creat
  '2':  'in_transit',       // Preluat de curier
  '3':  'in_transit',       // În tranzit
  '4':  'out_for_delivery', // Ieșit pentru livrare
  '5':  'delivered',        // Livrat
  '6':  'failed_attempt',   // Tentativă eșuată
  '7':  'returned',         // Retur în curs
  '8':  'returned',         // Retur finalizat
  '9':  'failed_attempt',   // Livrare parțială
  '10': 'in_transit',       // Reprogramat
  '11': 'failure',          // Anulat
  '24': 'out_for_delivery', // La curier local
  '25': 'in_transit',       // Sosit depozit local
};

async function trackGLS(awb) {
  // Check cache
  const cacheKey = `gls_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return { ...cached.data, fromCache: true };
  }

  try {
    const url = `https://gls-group.eu/app/service/open/rest/RO/ro/rstt001?match=${awb}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; GLAMX-Dashboard)',
        'Origin': 'https://gls-group.eu',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.log('[GLS TRACK] Error:', res.status, awb);
      return null;
    }

    const data = await res.json();
    console.log('[GLS TRACK] Raw response for', awb, ':', JSON.stringify(data).slice(0, 200));

    // GLS API response structure: { tuStatus: [{ history: [...], progressBar: {...} }] }
    const tuStatus = data.tuStatus?.[0];
    if (!tuStatus) return null;

    const history = tuStatus.history || [];
    const progressBar = tuStatus.progressBar || {};

    // Status curent din progressBar (mai fiabil) sau ultimul eveniment
    const currentStatus = progressBar.statusText || '';
    const statusCode = String(progressBar.status || '');

    // Determinăm statusul mapped
    let mapped = GLS_STATUS_MAP[currentStatus.toUpperCase()] 
              || GLS_STATUS_MAP[statusCode]
              || 'in_transit';

    // Ultimul eveniment din history
    const lastEvent = history.length > 0 ? history[history.length - 1] : null;
    if (lastEvent) {
      const evtCode = String(lastEvent.evtDscr || '').toUpperCase();
      const altMapped = GLS_STATUS_MAP[evtCode];
      if (altMapped) mapped = altMapped;
    }

    const result = {
      status: mapped,
      statusRaw: currentStatus || lastEvent?.evtDscr || '',
      lastUpdate: lastEvent?.date || lastEvent?.evtDateTime || '',
      location: lastEvent?.address?.city || lastEvent?.depotName || '',
      events: history.slice(-5).reverse().map(e => ({
        date: e.date || e.evtDateTime || '',
        description: e.evtDscr || '',
        location: e.address?.city || e.depotName || '',
      })),
    };

    // Cache rezultatul
    trackingCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch (e) {
    console.log('[GLS TRACK] Exception:', e.message, 'awb:', awb);
    return null;
  }
}

async function trackSameday(awb) {
  const cacheKey = `sd_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return { ...cached.data, fromCache: true };
  }

  try {
    const url = `https://api.sameday.ro/api/public/awb/${awb}/awb-history`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const history = data.awbHistory || data.history || [];
    if (!history.length) return null;

    const last = history[0];
    const statusCode = String(last.statusId || last.status || '');
    const mapped = SAMEDAY_STATUS_MAP[statusCode] || 'in_transit';

    const result = {
      status: mapped,
      statusRaw: last.statusLabel || last.description || '',
      lastUpdate: last.statusDate || last.date || '',
      location: last.county || last.transitLocation || '',
      events: history.slice(0, 5).map(e => ({
        date: e.statusDate || e.date || '',
        description: e.statusLabel || e.description || '',
        location: e.county || e.transitLocation || '',
      })),
    };

    trackingCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch {
    return null;
  }
}

// GET: tracking single AWB (cu debug=1 returnează răspunsul brut GLS)
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const awb = searchParams.get('awb');
  const courier = (searchParams.get('courier') || '').toLowerCase();
  const debug = searchParams.get('debug') === '1';

  if (!awb) return NextResponse.json({ error: 'AWB lipsă' }, { status: 400 });

  // Debug mode: returnează răspunsul brut GLS
  if (debug) {
    try {
      const url = `https://gls-group.eu/app/service/open/rest/RO/ro/rstt001?match=${awb}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      });
      const raw = await res.json();
      return NextResponse.json({ awb, raw, status: res.status });
    } catch(e) {
      return NextResponse.json({ awb, error: e.message });
    }
  }

  let result = null;
  if (courier.includes('gls')) result = await trackGLS(awb);
  else if (courier.includes('sameday')) result = await trackSameday(awb);
  else result = await trackGLS(awb) || await trackSameday(awb);

  return NextResponse.json({ ...result, awb, courier });
}

// POST: batch tracking pentru mai multe comenzi
export async function POST(request) {
  try {
    const { orders } = await request.json();
    if (!orders?.length) return NextResponse.json({ results: [] });

    // Max 15 concurrent pentru a nu supraîncărca API-ul GLS
    const results = [];
    const batches = [];
    for (let i = 0; i < orders.length; i += 5) {
      batches.push(orders.slice(i, i + 5));
    }

    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map(async ({ id, awb, courier }) => {
          if (!awb) return { id, status: null };
          let tracking = null;
          const c = (courier || '').toLowerCase();
          if (c.includes('gls')) tracking = await trackGLS(awb);
          else if (c.includes('sameday')) tracking = await trackSameday(awb);
          else tracking = await trackGLS(awb);
          return { id, awb, courier, ...tracking };
        })
      );
      results.push(...batchResults.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { id: batch[i].id, status: null }
      ));
      // Pauză mică între batch-uri
      if (batches.length > 1) await new Promise(r => setTimeout(r, 500));
    }

    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

