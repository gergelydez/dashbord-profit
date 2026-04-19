import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(email, token) {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

// ── Salvează factura înapoi în Shopify ───────────────────────────────────────
async function markInvoiceInShopify({ shopifyDomain, shopifyToken, orderId, invoiceSeries, invoiceNumber, invoiceUrl }) {
  if (!shopifyDomain || !shopifyToken || !orderId) return { ok: false };
  try {
    const getRes = await fetch(
      `https://${shopifyDomain}/admin/api/2024-01/orders/${orderId}.json?fields=note_attributes,tags`,
      { headers: { 'X-Shopify-Access-Token': shopifyToken }, cache: 'no-store' }
    );
    if (!getRes.ok) return { ok: false };
    const orderData = await getRes.json();

    const existingAttrs = (orderData.order?.note_attributes || []).filter(a => {
      const n = (a.name || '').toLowerCase();
      return !['xconnector-invoice-url', 'invoice-short-url', 'invoice-number', 'invoice-series', 'invoice-url'].includes(n);
    });
    existingAttrs.push(
      { name: 'invoice-number',         value: String(invoiceNumber) },
      { name: 'invoice-series',         value: String(invoiceSeries) },
      { name: 'invoice-short-url',      value: invoiceUrl || '' },
      { name: 'xconnector-invoice-url', value: invoiceUrl || '' },
    );

    const tags = (orderData.order?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    if (!tags.includes('invoiced')) tags.push('invoiced');

    const updateRes = await fetch(
      `https://${shopifyDomain}/admin/api/2024-01/orders/${orderId}.json`,
      {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: { id: orderId, note_attributes: existingAttrs, tags: tags.join(', ') } }),
        cache: 'no-store',
      }
    );
    return { ok: updateRes.ok };
  } catch { return { ok: false }; }
}

// ── Normalizare text pentru comparare ────────────────────────────────────────
function norm(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameScore(a, b) {
  const wa = norm(a).split(' ').filter(w => w.length > 1);
  const wb = norm(b).split(' ').filter(w => w.length > 1);
  if (!wa.length || !wb.length) return 0;
  const hits = wa.filter(w => wb.includes(w));
  return hits.length / wa.length;
}

// ── Fetch lista facturi SmartBill ─────────────────────────────────────────────
// Endpoint corect documentat: GET /invoice?cif=...&from=...&to=...&seriesName=...
async function fetchAllInvoices(auth, cif, seriesName) {
  const today = new Date().toISOString().slice(0, 10);
  const from  = new Date(); from.setFullYear(from.getFullYear() - 1);
  const dateFrom = from.toISOString().slice(0, 10);

  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

  // Încearcă toate variantele endpoint-ului de listare SmartBill
  const urls = [
    // Endpoint principal documentat SmartBill
    `${BASE}/invoice?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${today}`,
    // Cu serie specifică
    seriesName ? `${BASE}/invoice?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${today}&seriesName=${encodeURIComponent(seriesName)}` : null,
    // Variante alternative
    `${BASE}/invoices?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${today}`,
    `${BASE}/invoice/list?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${today}`,
  ].filter(Boolean);

  const debugInfo = [];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const raw = await res.text();
      debugInfo.push({ url: url.replace(BASE, ''), status: res.status, preview: raw.slice(0, 200) });

      if (!res.ok) continue;

      let data;
      try { data = JSON.parse(raw); } catch { continue; }

      // SmartBill returnează { list: [...] } sau { invoices: [...] }
      const list = data.list || data.invoices || data.data || [];
      if (list.length > 0) return { list, debug: debugInfo };
    } catch (e) {
      debugInfo.push({ url: url.replace(BASE, ''), error: e.message });
    }
  }

  return { list: [], debug: debugInfo };
}

// ── POST /api/smartbill/search ────────────────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json();
    const { email, token, cif, orders, shopifyDomain, shopifyToken, seriesName } = body;

    if (!email || !token || !cif) {
      return NextResponse.json({ error: 'Credențiale SmartBill lipsă.' }, { status: 400 });
    }
    if (!orders?.length) {
      return NextResponse.json({ error: 'Lista comenzi lipsă.' }, { status: 400 });
    }

    const auth = makeAuth(email, token);

    // Fetch toate facturile o singură dată
    const { list: invoices, debug: fetchDebug } = await fetchAllInvoices(auth, cif, seriesName);

    const found        = {};
    const notFound     = [];
    const shopifyUpdated = [];
    const matchDetails = {}; // pentru debugging

    for (const order of orders) {
      const orderName  = order.name;          // '#3190'
      const cleanNum   = orderName.replace(/[^0-9]/g, ''); // '3190'
      const clientNorm = norm(order.client || '');
      const orderTotal = parseFloat(order.total) || 0;

      let match     = null;
      let matchType = null;

      // ── 1. Caută în lista bulk după observations/număr ──────────────────
      if (invoices.length > 0) {
        // 1a. Numărul comenzii în observations
        match = invoices.find(inv => {
          const obs = norm(inv.observations || inv.description || inv.mentions || inv.clientRef || '');
          return obs.includes(cleanNum) || obs.includes(norm(orderName));
        });
        if (match) matchType = 'observations';

        // 1b. Numele clientului (≥80% cuvinte comune)
        if (!match) {
          const best = invoices
            .map(inv => ({ inv, s: nameScore(order.client, inv.clientName || inv.client || inv.buyerName || '') }))
            .filter(x => x.s >= 0.8)
            .sort((a, b) => b.s - a.s)[0];
          if (best) { match = best.inv; matchType = `name(${Math.round(best.s*100)}%)`; }
        }

        // 1c. Numărul comenzii în clientRef sau alte câmpuri
        if (!match) {
          match = invoices.find(inv => {
            const allText = norm([
              inv.observations, inv.description, inv.mentions,
              inv.clientRef, inv.documentNumber, inv.referenceNumber,
            ].join(' '));
            return allText.includes(cleanNum);
          });
          if (match) matchType = 'clientRef';
        }

        // 1d. Total + primul cuvânt din nume
        if (!match && orderTotal > 0) {
          const firstWord = clientNorm.split(' ')[0];
          match = invoices.find(inv => {
            const invTotal = parseFloat(inv.totalAmount || inv.total || inv.grandTotal || inv.amount || 0);
            const invClient = norm(inv.clientName || inv.client || inv.buyerName || '');
            return Math.abs(invTotal - orderTotal) < 1 && firstWord && invClient.includes(firstWord);
          });
          if (match) matchType = 'total+name';
        }

        // 1e. Total exact (dacă totalul e unic — mai puțin sigur)
        if (!match && orderTotal > 10) {
          const byTotal = invoices.filter(inv => {
            const invTotal = parseFloat(inv.totalAmount || inv.total || inv.grandTotal || inv.amount || 0);
            return Math.abs(invTotal - orderTotal) < 0.01;
          });
          if (byTotal.length === 1) { match = byTotal[0]; matchType = 'total-exact'; }
        }
      }

      // ── 2. Fallback: search API individual (dacă lista goală sau nu s-a găsit) ──
      if (!match) {
        const today = new Date().toISOString().slice(0, 10);
        const fromD = new Date(); fromD.setFullYear(fromD.getFullYear() - 1);
        const dateFrom = fromD.toISOString().slice(0, 10);
        const headers  = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

        // 2a. Caută după numărul comenzii (text search)
        const searchUrls = [
          `${BASE}/invoice?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${today}&client=${encodeURIComponent(cleanNum)}`,
          `${BASE}/invoice?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${today}&name=${encodeURIComponent(orderName)}`,
        ];
        for (const url of searchUrls) {
          if (match) break;
          try {
            const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });
            if (!res.ok) continue;
            const data = await res.json();
            const list = data.list || data.invoices || [];
            if (list.length > 0) { match = list[0]; matchType = 'api-search-num'; }
          } catch {}
        }

        // 2b. Caută după primul cuvânt din numele clientului
        if (!match && order.client) {
          const firstWord = (order.client || '').split(' ')[0];
          try {
            const url = `${BASE}/invoice?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${today}&client=${encodeURIComponent(firstWord)}`;
            const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });
            if (res.ok) {
              const data = await res.json();
              const list = data.list || data.invoices || [];
              // Verifică totalul pentru confirmare
              const hit = list.find(inv => {
                const invTotal = parseFloat(inv.totalAmount || inv.total || inv.grandTotal || 0);
                return Math.abs(invTotal - orderTotal) < 1;
              }) || (list.length === 1 ? list[0] : null);
              if (hit) { match = hit; matchType = 'api-search-name'; }
            }
          } catch {}
        }
      }

      // ── Procesează rezultatul ────────────────────────────────────────────
      if (match) {
        const series = match.seriesName || match.series || match.invoiceSeries || '';
        const number = match.number || match.invoiceNumber || match.documentNumber || '';
        const url    = match.webLink || match.pdfLink || match.url || match.documentUrl ||
          (series && number ? `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cif)}&series=${encodeURIComponent(series)}&number=${encodeURIComponent(number)}` : '');

        found[orderName] = { series, number, url, matchType, date: match.issueDate || match.date || '' };
        matchDetails[orderName] = matchType;

        // Write-back în Shopify
        if (shopifyDomain && shopifyToken && order.id && number) {
          const sbRes = await markInvoiceInShopify({
            shopifyDomain, shopifyToken,
            orderId:       order.id,
            invoiceSeries: series,
            invoiceNumber: number,
            invoiceUrl:    url,
          });
          if (sbRes.ok) shopifyUpdated.push(orderName);
        }
      } else {
        notFound.push(orderName);
      }
    }

    return NextResponse.json({
      found, notFound, shopifyUpdated,
      total: invoices.length,
      debug: { fetchDebug, matchDetails },
    });

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
  });
}
