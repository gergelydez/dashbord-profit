import { NextResponse } from 'next/server';

// ── Mapare statusuri GLS → statusul nostru intern ──
const GLS_STATUS_MAP = {
  // Coduri GLS cunoscute
  'DELIVERED':           'delivered',
  'DELIVERED_PS':        'delivered',    // livrat la punct de ridicare
  'IN_TRANSIT':          'in_transit',
  'OUT_FOR_DELIVERY':    'out_for_delivery',
  'PICKED_UP':           'in_transit',   // preluat de curier
  'INWAREHOUSE':         'in_transit',   // în depozit GLS
  'INDELIVERY':          'out_for_delivery',
  'NOTDELIVERED':        'failed_attempt',
  'RETURNED':            'returned',
  'CANCELLED':           'failure',
  // Coduri numerice GLS
  '1':  'in_transit',    // Colet preluat
  '2':  'in_transit',    // În tranzit
  '3':  'out_for_delivery', // În livrare
  '4':  'delivered',     // Livrat
  '5':  'failed_attempt',// Tentativă eșuată
  '6':  'returned',      // Retur
  '7':  'in_transit',    // În depozit
};

// ── Mapare statusuri Sameday → statusul nostru intern ──
const SAMEDAY_STATUS_MAP = {
  '1':   'in_transit',      // Awb creat
  '2':   'in_transit',      // Preluat de curier
  '3':   'in_transit',      // În tranzit
  '4':   'out_for_delivery',// În livrare
  '5':   'delivered',       // Livrat
  '6':   'failed_attempt',  // Tentativă eșuată
  '7':   'returned',        // Retur în curs
  '8':   'returned',        // Retur finalizat
  '9':   'failed_attempt',  // Livrare parțială
  '10':  'in_transit',      // Reprogramat
  '11':  'failure',         // Anulat
  '24':  'out_for_delivery',// La curier pentru livrare
  '25':  'in_transit',      // Sosit în depozit local
};

async function trackGLS(awb) {
  try {
    const url = `https://gls-group.eu/app/service/open/rest/RO/ro/rstt001?match=${awb}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    // GLS returnează { tuStatus: [...], ...}
    const events = data.tuStatus?.[0]?.history || [];
    if (!events.length) return null;

    // Ultimul eveniment = statusul curent
    const last = events[events.length - 1];
    const statusCode = (last.evtDscr || last.status || '').toUpperCase();
    const mapped = GLS_STATUS_MAP[statusCode] || 'in_transit';

    return {
      status: mapped,
      statusRaw: last.evtDscr || '',
      lastUpdate: last.date || last.evtDateTime || '',
      location: last.address?.city || last.location || '',
      events: events.slice(-5).reverse().map(e => ({
        date: e.date || e.evtDateTime || '',
        description: e.evtDscr || e.description || '',
        location: e.address?.city || e.location || '',
      })),
    };
  } catch {
    return null;
  }
}

async function trackSameday(awb) {
  try {
    // Sameday API public - unele endpoint-uri nu necesită auth
    const url = `https://api.sameday.ro/api/public/awb/${awb}/awb-history`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      // Fallback: tracking page scraping
      return await trackSamedayScrape(awb);
    }

    const data = await res.json();
    const history = data.awbHistory || data.history || [];
    if (!history.length) return null;

    const last = history[0]; // Sameday returnează descrescător
    const statusCode = String(last.statusId || last.status || '');
    const mapped = SAMEDAY_STATUS_MAP[statusCode] || 'in_transit';

    return {
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
  } catch {
    return null;
  }
}

async function trackSamedayScrape(awb) {
  try {
    const url = `https://www.sameday.ro/tracking?awb=${awb}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extrage statusul din HTML
    const statusMatch = html.match(/class="[^"]*status[^"]*"[^>]*>([^<]+)</i);
    if (!statusMatch) return null;

    const statusText = statusMatch[1].trim().toLowerCase();
    let mapped = 'in_transit';
    if (statusText.includes('livrat')) mapped = 'delivered';
    else if (statusText.includes('livrare')) mapped = 'out_for_delivery';
    else if (statusText.includes('retur')) mapped = 'returned';
    else if (statusText.includes('anulat')) mapped = 'failure';

    return { status: mapped, statusRaw: statusMatch[1].trim(), lastUpdate: '', location: '', events: [] };
  } catch {
    return null;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const awb = searchParams.get('awb');
  const courier = (searchParams.get('courier') || '').toLowerCase();

  if (!awb) return NextResponse.json({ error: 'AWB lipsă' }, { status: 400 });

  let result = null;

  if (courier.includes('gls')) {
    result = await trackGLS(awb);
  } else if (courier.includes('sameday') || courier.includes('same day')) {
    result = await trackSameday(awb);
  } else {
    // Încearcă ambii
    result = await trackGLS(awb) || await trackSameday(awb);
  }

  if (!result) {
    return NextResponse.json({
      status: null,
      error: 'Nu am putut obține statusul de la curier',
      awb, courier,
    });
  }

  return NextResponse.json({ ...result, awb, courier });
}

// POST pentru tracking multiplu (batch) - folosit la sincronizare
export async function POST(request) {
  try {
    const { orders } = await request.json();
    if (!orders?.length) return NextResponse.json({ results: [] });

    // Procesăm maxim 20 comenzi în paralel (evităm rate limiting)
    const batch = orders.slice(0, 20);
    const results = await Promise.allSettled(
      batch.map(async ({ id, awb, courier }) => {
        if (!awb) return { id, status: null };
        let tracking = null;
        if (courier?.includes('gls')) tracking = await trackGLS(awb);
        else if (courier?.includes('sameday')) tracking = await trackSameday(awb);
        else tracking = await trackGLS(awb) || await trackSameday(awb);
        return { id, awb, ...tracking };
      })
    );

    return NextResponse.json({
      results: results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { id: batch[i].id, status: null, error: r.reason?.message }
      ),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

