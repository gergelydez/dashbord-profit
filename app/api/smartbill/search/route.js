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

// ── Obține seriile + nextNumber ───────────────────────────────────────────────
async function getSeriesWithNextNumber(auth, cif, preferredSeries) {
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

  // Încearcă toate variantele endpoint-ului pentru serii
  const endpoints = [
    `${BASE}/invoice/series?cif=${encodeURIComponent(cif)}`,
    `${BASE}/series?cif=${encodeURIComponent(cif)}&type=f`,
    `${BASE}/series?cif=${encodeURIComponent(cif)}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const list = data.list || data.invoiceSeries || data.seriesList || [];
      if (!list.length) continue;

      // Sortează: seria preferată primul
      const sorted = [...list].sort((a, b) => {
        const an = a.name || a;
        const bn = b.name || b;
        if (preferredSeries && an === preferredSeries) return -1;
        if (preferredSeries && bn === preferredSeries) return 1;
        return 0;
      });

      return sorted.map(s => ({
        name:       s.name || s,
        nextNumber: parseInt(s.nextNumber || s.next || s.nextSeriesNumber || 0) || null,
      }));
    } catch {}
  }
  return [];
}

// ── Fetch factură individuală SmartBill ───────────────────────────────────────
async function fetchInvoice(auth, cif, seriesName, number) {
  const url = `${BASE}/invoice?cif=${encodeURIComponent(cif)}&seriesName=${encodeURIComponent(seriesName)}&number=${encodeURIComponent(number)}`;
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.invoice || data.invoiceDetails || (data.seriesName || data.series ? data : null);
  } catch { return null; }
}

// ── Estimează nextNumber prin binary search ────────────────────────────────────
// Dacă API-ul nu returnează nextNumber, găsim ultima factură existentă
async function estimateNextNumber(auth, cif, seriesName) {
  // Încearcă numere mari descrescător până găsim una existentă
  const probes = [500, 400, 300, 200, 150, 100, 50, 30, 10, 5, 1];
  for (const n of probes) {
    const inv = await fetchInvoice(auth, cif, seriesName, n);
    if (inv) return n + 1; // găsit la n, deci next e n+1 sau mai mare
  }
  return 100; // fallback
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

    // Obține seriile disponibile
    let seriesList = await getSeriesWithNextNumber(auth, cif, seriesName);

    // Dacă nu s-au găsit serii din API dar avem seriesName din UI, folosim direct aceea
    if (!seriesList.length && seriesName) {
      seriesList = [{ name: seriesName, nextNumber: null }];
    }

    if (!seriesList.length) {
      return NextResponse.json({
        error: 'Nu s-au găsit serii de facturi. Asigură-te că seria (ex: GLA) e selectată în câmpul Serie de deasupra.',
      }, { status: 400 });
    }

    const found          = {};
    const shopifyUpdated = [];
    const scanLog        = [];

    for (const serie of seriesList) {
      const sName = serie.name;
      let nextNum = serie.nextNumber;

      // Dacă nu știm nextNumber, îl estimăm
      if (!nextNum) {
        nextNum = await estimateNextNumber(auth, cif, sName);
        scanLog.push(`${sName}: nextNumber estimat ~${nextNum}`);
      } else {
        scanLog.push(`${sName}: nextNumber=${nextNum}`);
      }

      // Scanăm ultimele 100 facturi (sau mai multe dacă avem 26 comenzi)
      const scanCount = Math.max(100, orders.length * 4);
      const startNum  = nextNum - 1;
      const endNum    = Math.max(1, startNum - scanCount);

      // Fetch în paralel câte 10
      for (let batch = startNum; batch >= endNum; batch -= 10) {
        const nums = [];
        for (let n = batch; n >= Math.max(endNum, batch - 9); n--) nums.push(n);

        const results = await Promise.allSettled(
          nums.map(n => fetchInvoice(auth, cif, sName, n))
        );

        for (let i = 0; i < results.length; i++) {
          const inv = results[i].status === 'fulfilled' ? results[i].value : null;
          if (!inv) continue;

          const invNum    = nums[i];
          const obs       = norm(inv.observations || inv.description || inv.mentions || '');
          const clientInv = inv.clientName || inv.client || inv.buyerName || '';
          const invTotal  = parseFloat(inv.totalAmount || inv.total || inv.grandTotal || inv.amount || 0);
          const invUrl    = inv.webLink || inv.pdfLink || inv.url ||
            `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cif)}&series=${encodeURIComponent(sName)}&number=${encodeURIComponent(invNum)}`;

          for (const order of orders) {
            if (found[order.name]) continue;

            const cleanNum   = order.name.replace(/[^0-9]/g, '');
            const orderTotal = parseFloat(order.total) || 0;
            let matchType    = null;

            // 1. Numărul comenzii în observations
            if (obs.includes(cleanNum) || obs.includes(norm(order.name))) {
              matchType = 'observations';
            }
            // 2. Potrivire nume client ≥80%
            else if (nameScore(order.client, clientInv) >= 0.8) {
              matchType = `name(${Math.round(nameScore(order.client, clientInv)*100)}%)`;
            }
            // 3. Total + primul cuvânt din nume
            else if (orderTotal > 0 && Math.abs(invTotal - orderTotal) < 1) {
              const firstWord = norm(order.client || '').split(' ')[0];
              if (firstWord && norm(clientInv).includes(firstWord)) {
                matchType = 'total+name';
              }
            }

            if (matchType) {
              found[order.name] = {
                series: sName, number: String(invNum),
                url: invUrl, matchType,
                client: clientInv,
              };

              if (shopifyDomain && shopifyToken && order.id) {
                const r = await markInvoiceInShopify({
                  shopifyDomain, shopifyToken,
                  orderId:       order.id,
                  invoiceSeries: sName,
                  invoiceNumber: String(invNum),
                  invoiceUrl:    invUrl,
                });
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

    return NextResponse.json({
      found, notFound, shopifyUpdated,
      scanned: scanLog.join(' | '),
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
