import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(email, token) {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

// ── Salvează factura în Shopify note_attributes ──────────────────────────────
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

function norm(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function nameScore(a, b) {
  const wa = norm(a).split(' ').filter(w => w.length > 1);
  const wb = norm(b).split(' ').filter(w => w.length > 1);
  if (!wa.length || !wb.length) return 0;
  return wa.filter(w => wb.includes(w)).length / wa.length;
}

// ── Parsează XLS SmartBill export ────────────────────────────────────────────
// Coloane: Nr.crt | Client | CIF | Adresa | Factura | Data | Scadenta | Status | Moneda | Total | TotalRON | Aviz | Observatii | SPV
function parseSmartBillXLS(base64xls) {
  // Decodăm base64 → buffer
  const binary = atob(base64xls);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // Parsăm cu xlrd-style — folosim o implementare simplă pentru XLS binar
  // XLS format: căutăm rândurile de date după header
  // Returnăm array de { orderName, invoiceCode, client, total, observations }
  throw new Error('XLS parsing needs server-side xlrd');
}

// ── POST /api/smartbill/search ────────────────────────────────────────────────
// Acceptă fie xlsData (base64 XLS export SmartBill) fie caută prin API
export async function POST(request) {
  try {
    const body = await request.json();
    const { email, token, cif, orders, shopifyDomain, shopifyToken, seriesName, xlsData } = body;

    if (!orders?.length) {
      return NextResponse.json({ error: 'Lista comenzi lipsă.' }, { status: 400 });
    }

    // ── CALEA 1: XLS upload ───────────────────────────────────────────────────
    if (xlsData) {
      return await searchFromXLS(xlsData, orders, shopifyDomain, shopifyToken, cif);
    }

    // ── CALEA 2: API SmartBill (fallback) ─────────────────────────────────────
    if (!email || !token || !cif) {
      return NextResponse.json({ error: 'Credențiale SmartBill sau XLS lipsă.' }, { status: 400 });
    }

    const auth = makeAuth(email, token);
    return await searchViaAPI(auth, cif, orders, shopifyDomain, shopifyToken, seriesName);

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── Căutare din XLS export SmartBill ─────────────────────────────────────────
async function searchFromXLS(xlsBase64, orders, shopifyDomain, shopifyToken, cif) {
  // xlsBase64 e trimis din frontend după ce userul uploadează fișierul
  // Parsăm CSV-ul/XLS-ul — frontend-ul îl convertește în JSON înainte să trimită
  // xlsData e array de rânduri: [{ invoiceCode, client, observations, total }]
  const rows = xlsBase64; // frontend trimite deja JSON parsed

  const found          = {};
  const shopifyUpdated = [];

  for (const order of orders) {
    const cleanNum   = order.name.replace(/[^0-9]/g, '');
    const orderTotal = parseFloat(order.total) || 0;

    for (const row of rows) {
      const obs       = norm(row.observations || '');
      const clientRow = row.client || '';
      const rowTotal  = parseFloat(row.total) || 0;

      // Extrage seria și numărul din codul facturii (ex: GLA2690 → serie=GLA, number=2690)
      const invoiceMatch = (row.invoiceCode || '').match(/^([A-Z]+)(\d+)$/);
      if (!invoiceMatch) continue;
      const [, series, number] = invoiceMatch;

      let matchType = null;

      // 1. Numărul comenzii în observations (ex: "Order: #3190")
      if (obs.includes(cleanNum) || obs.includes(norm(order.name))) {
        matchType = 'observations';
      }
      // 2. Potrivire nume client ≥80%
      else if (nameScore(order.client, clientRow) >= 0.8) {
        matchType = `name(${Math.round(nameScore(order.client, clientRow)*100)}%)`;
      }
      // 3. Total + primul cuvânt din nume
      else if (orderTotal > 0 && Math.abs(rowTotal - orderTotal) < 1) {
        const firstWord = norm(order.client || '').split(' ')[0];
        if (firstWord && norm(clientRow).includes(firstWord)) {
          matchType = 'total+name';
        }
      }

      if (matchType) {
        const invUrl = `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cif || '')}&series=${encodeURIComponent(series)}&number=${encodeURIComponent(number)}`;

        found[order.name] = { series, number, url: invUrl, matchType, client: clientRow };

        if (shopifyDomain && shopifyToken && order.id) {
          const r = await markInvoiceInShopify({
            shopifyDomain, shopifyToken,
            orderId: order.id,
            invoiceSeries: series,
            invoiceNumber: number,
            invoiceUrl: invUrl,
          });
          if (r.ok) shopifyUpdated.push(order.name);
        }
        break;
      }
    }
  }

  const notFound = orders.map(o => o.name).filter(n => !found[n]);
  return NextResponse.json({ found, notFound, shopifyUpdated, scanned: `XLS: ${rows.length} facturi` });
}

// ── Căutare via API SmartBill (fetch individual) ──────────────────────────────
async function searchViaAPI(auth, cif, orders, shopifyDomain, shopifyToken, seriesName) {
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

  // Obține seriile
  let seriesList = [];
  for (const url of [
    `${BASE}/invoice/series?cif=${encodeURIComponent(cif)}`,
    `${BASE}/series?cif=${encodeURIComponent(cif)}&type=f`,
  ]) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const list = data.list || data.invoiceSeries || [];
      if (list.length) { seriesList = list; break; }
    } catch {}
  }

  if (!seriesList.length && seriesName) {
    seriesList = [{ name: seriesName, nextNumber: null }];
  }
  if (!seriesList.length) {
    return NextResponse.json({ error: 'Nu s-au găsit serii. Uploadează exportul XLS din SmartBill.' }, { status: 400 });
  }

  const found = {};
  const shopifyUpdated = [];
  const scanLog = [];

  for (const serie of seriesList) {
    const sName  = serie.name || serie;
    let nextNum  = parseInt(serie.nextNumber || 0);
    if (!nextNum) {
      // Estimare: probe descrescătoare
      for (const n of [500, 300, 200, 100, 50, 10]) {
        try {
          const r = await fetch(`${BASE}/invoice?cif=${encodeURIComponent(cif)}&seriesName=${encodeURIComponent(sName)}&number=${n}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(4000) });
          if (r.ok) { nextNum = n + 1; break; }
        } catch {}
      }
      if (!nextNum) nextNum = 100;
    }
    scanLog.push(`${sName}(next:${nextNum})`);

    const scanCount = Math.max(100, orders.length * 4);
    for (let batch = nextNum - 1; batch >= Math.max(1, nextNum - scanCount); batch -= 10) {
      const nums = Array.from({ length: 10 }, (_, i) => batch - i).filter(n => n >= 1);
      const results = await Promise.allSettled(
        nums.map(n => fetch(`${BASE}/invoice?cif=${encodeURIComponent(cif)}&seriesName=${encodeURIComponent(sName)}&number=${n}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : null).catch(() => null))
      );

      for (let i = 0; i < results.length; i++) {
        const data = results[i].value;
        const inv  = data?.invoice || data?.invoiceDetails || (data?.seriesName ? data : null);
        if (!inv) continue;

        const invNum   = nums[i];
        const obs      = norm(inv.observations || inv.description || '');
        const clientInv = inv.clientName || inv.client || '';
        const invTotal = parseFloat(inv.totalAmount || inv.total || 0);
        const invUrl   = `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cif)}&series=${encodeURIComponent(sName)}&number=${invNum}`;

        for (const order of orders) {
          if (found[order.name]) continue;
          const cleanNum = order.name.replace(/[^0-9]/g, '');
          const orderTotal = parseFloat(order.total) || 0;
          let matchType = null;

          if (obs.includes(cleanNum) || obs.includes(norm(order.name))) matchType = 'observations';
          else if (nameScore(order.client, clientInv) >= 0.8) matchType = `name(${Math.round(nameScore(order.client, clientInv)*100)}%)`;
          else if (orderTotal > 0 && Math.abs(invTotal - orderTotal) < 1) {
            const fw = norm(order.client || '').split(' ')[0];
            if (fw && norm(clientInv).includes(fw)) matchType = 'total+name';
          }

          if (matchType) {
            found[order.name] = { series: sName, number: String(invNum), url: invUrl, matchType, client: clientInv };
            if (shopifyDomain && shopifyToken && order.id) {
              const r = await markInvoiceInShopify({ shopifyDomain, shopifyToken, orderId: order.id, invoiceSeries: sName, invoiceNumber: String(invNum), invoiceUrl: invUrl });
              if (r.ok) shopifyUpdated.push(order.name);
            }
          }
        }
      }
      if (Object.keys(found).length === orders.length) break;
    }
    if (Object.keys(found).length === orders.length) break;
  }

  const notFound = orders.map(o => o.name).filter(n => !found[n]);
  return NextResponse.json({ found, notFound, shopifyUpdated, scanned: scanLog.join(' | ') });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
  });
}
