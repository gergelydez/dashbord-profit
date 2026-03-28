import { NextResponse } from 'next/server';

const trackingCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

// ── GLS: parsăm pagina HTML de tracking ──
async function trackGLS(awb) {
  const cacheKey = `gls_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    // Încercăm mai multe URL-uri GLS
    const urls = [
      `https://gls-group.eu/app/service/open/rest/RO/ro/rstt001?match=${awb}`,
      `https://gls-group.com/app/service/open/rest/RO/ro/rstt001?match=${awb}`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://gls-group.eu/',
            'Origin': 'https://gls-group.eu',
            'Accept-Language': 'ro-RO,ro;q=0.9',
          },
          signal: AbortSignal.timeout(12000),
        });

        const text = await res.text();
        console.log('[GLS] URL:', url, 'Status:', res.status, 'Response preview:', text.slice(0, 100));

        // Dacă e HTML → blochează
        if (text.trim().startsWith('<')) {
          console.log('[GLS] Răspuns HTML, încearcă altul...');
          continue;
        }

        // Parsăm JSON
        const data = JSON.parse(text);
        const tuStatus = data.tuStatus?.[0];
        if (!tuStatus) return null;

        const history = tuStatus.history || [];
        const pb = tuStatus.progressBar || {};

        // Determinăm statusul din progressBar
        const pbStatus = String(pb.statusBar || pb.status || '').toUpperCase();
        const lastEvt = history.length ? history[history.length - 1] : null;
        const lastEvtDesc = String(lastEvt?.evtDscr || '').toUpperCase();

        const STATUS_MAP = {
          'DELIVERED': 'delivered', 'INDELIVERY': 'out_for_delivery',
          'IN_TRANSIT': 'in_transit', 'INWAREHOUSE': 'in_transit',
          'PICKED_UP': 'in_transit', 'NOT_DELIVERED': 'failed_attempt',
          'NOTDELIVERED': 'failed_attempt', 'RETURNED': 'returned',
          '0': 'in_transit', '1': 'in_transit', '2': 'in_transit',
          '3': 'out_for_delivery', '4': 'delivered', '5': 'failed_attempt',
          '6': 'returned',
        };

        const mapped = STATUS_MAP[pbStatus] || STATUS_MAP[lastEvtDesc] || 'in_transit';

        const result = {
          status: mapped,
          statusRaw: lastEvtDesc || pbStatus,
          lastUpdate: lastEvt?.date || '',
          location: lastEvt?.address?.city || lastEvt?.depotName || '',
        };

        trackingCache.set(cacheKey, { data: result, ts: Date.now() });
        return result;
      } catch(e2) {
        console.log('[GLS] Error for', url, ':', e2.message);
      }
    }

    // Dacă toate URL-urile eșuează, încercăm API alternativ
    return await trackGLSAlternative(awb);
  } catch(e) {
    console.log('[GLS] Exception:', e.message);
    return null;
  }
}

// ── GLS alternativ: track17 / tracktry API ──
async function trackGLSAlternative(awb) {
  try {
    // Folosim track-trace.com care are proxy pentru GLS
    const res = await fetch(`https://api.ship24.com/public/v1/trackers/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer apik_5uSGhAkJhIdmT8HMf1BkZOKcDqQFbr',
      },
      body: JSON.stringify({ trackingNumber: awb }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const events = data.data?.trackings?.[0]?.events || [];
    if (!events.length) return null;

    const last = events[0];
    const statusCode = last.status?.toLowerCase() || '';
    const mapped =
      statusCode.includes('deliver') ? 'delivered' :
      statusCode.includes('out') ? 'out_for_delivery' :
      statusCode.includes('return') ? 'returned' :
      statusCode.includes('fail') ? 'failed_attempt' : 'in_transit';

    return {
      status: mapped,
      statusRaw: last.statusMilestone || last.status || '',
      lastUpdate: last.occurrenceDatetime || '',
      location: last.location?.name || '',
    };
  } catch {
    return null;
  }
}

// ── Sameday tracking ──
async function trackSameday(awb) {
  const cacheKey = `sd_${awb}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const STATUS_MAP = {
    '1':'in_transit','2':'in_transit','3':'in_transit',
    '4':'out_for_delivery','5':'delivered','6':'failed_attempt',
    '7':'returned','8':'returned','10':'in_transit',
    '11':'failure','24':'out_for_delivery','25':'in_transit',
  };

  try {
    const res = await fetch(`https://api.sameday.ro/api/public/awb/${awb}/awb-history`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const history = data.awbHistory || [];
    if (!history.length) return null;

    const last = history[0];
    const mapped = STATUS_MAP[String(last.statusId || '')] || 'in_transit';

    const result = {
      status: mapped,
      statusRaw: last.statusLabel || '',
      lastUpdate: last.statusDate || '',
      location: last.county || '',
    };
    trackingCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch { return null; }
}

// ── GET: debug sau single AWB ──
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const awb = searchParams.get('awb');
  const courier = (searchParams.get('courier') || '').toLowerCase();
  const debug = searchParams.get('debug') === '1';

  if (!awb) return NextResponse.json({ error: 'AWB lipsă' }, { status: 400 });

  if (debug) {
    // Debug: răspuns brut GLS
    try {
      const url = `https://gls-group.eu/app/service/open/rest/RO/ro/rstt001?match=${awb}`;
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://gls-group.eu/',
        },
        signal: AbortSignal.timeout(10000),
      });
      const text = await res.text();
      const isJson = !text.trim().startsWith('<');
      return NextResponse.json({
        awb,
        httpStatus: res.status,
        isJson,
        preview: text.slice(0, 500),
        headers: Object.fromEntries(res.headers.entries()),
      });
    } catch(e) {
      return NextResponse.json({ awb, error: e.message });
    }
  }

  let result = null;
  if (courier.includes('sameday')) result = await trackSameday(awb);
  else result = await trackGLS(awb);

  return NextResponse.json({ awb, courier, ...result });
}

// ── POST: batch tracking ──
export async function POST(request) {
  try {
    const { orders } = await request.json();
    if (!orders?.length) return NextResponse.json({ results: [] });

    const results = [];
    // Batch de 5 cu pauze
    for (let i = 0; i < orders.length; i += 5) {
      const batch = orders.slice(i, i + 5);
      const batchResults = await Promise.allSettled(
        batch.map(async ({ id, awb, courier }) => {
          if (!awb) return { id, status: null };
          const c = (courier || '').toLowerCase();
          const tracking = c.includes('sameday')
            ? await trackSameday(awb)
            : await trackGLS(awb);
          return { id, awb, courier, ...tracking };
        })
      );
      results.push(...batchResults.map((r, idx) =>
        r.status === 'fulfilled' ? r.value : { id: batch[idx]?.id, status: null, error: r.reason?.message }
      ));
      if (i + 5 < orders.length) await new Promise(r => setTimeout(r, 600));
    }

    return NextResponse.json({ results, count: results.length });
  } catch(e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

