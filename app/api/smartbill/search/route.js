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

// ── Obține seria + nextNumber din SmartBill ──────────────────────────────────
async function getSeriesInfo(auth, cif, preferredSeries) {
  const res = await fetch(`${BASE}/invoice/series?cif=${encodeURIComponent(cif)}`, {
    headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return [];

  const data = await res.json();
  const list = data.list || data.invoiceSeries || [];

  // Sortăm: seria preferată primul
  return list.sort((a, b) => {
    if (preferredSeries && a.name === preferredSeries) return -1;
    if (preferredSeries && b.name === preferredSeries) return 1;
    return 0;
  });
}

// ── Fetch factură individuală din SmartBill ──────────────────────────────────
async function fetchInvoice(auth, cif, seriesName, number) {
  const url = `${BASE}/invoice?cif=${encodeURIComponent(cif)}&seriesName=${encodeURIComponent(seriesName)}&number=${encodeURIComponent(number)}`;
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // SmartBill returnează { invoice: {...} } sau direct obiectul
    return data.invoice || data.invoiceDetails || (data.series ? data : null);
  } catch { return null; }
}

// ── POST /api/smartbill/search ────────────────────────────────────────────────
// Strategie: obține nextNumber din serie → fetch înapoi ultimele ~60 facturi
// → caută în observations/clientName numărul comenzii sau numele clientului
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

    // Obține toate seriile disponibile
    const seriesList = await getSeriesInfo(auth, cif, seriesName);
    if (!seriesList.length) {
      return NextResponse.json({ error: 'Nu s-au putut obține seriile de facturi din SmartBill. Verifică credențialele.' }, { status: 400 });
    }

    // Construim indexul comenzilor de căutat
    const orderIndex = {};
    for (const o of orders) {
      orderIndex[o.name] = o;
    }

    const found        = {};
    const shopifyUpdated = [];

    // Pentru fiecare serie, fetch ultimele N facturi și caută comenzile
    for (const serie of seriesList) {
      const sName      = serie.name || serie;
      const nextNum    = parseInt(serie.nextNumber || serie.next || 0);
      if (!nextNum || !sName) continue;

      // Fetch ultimele 80 facturi (nextNumber-1 down to nextNumber-80)
      const startNum = Math.max(1, nextNum - 1);
      const endNum   = Math.max(1, nextNum - 80);

      // Fetch în paralel, câte 10 odată
      for (let batch = startNum; batch >= endNum; batch -= 10) {
        const nums = [];
        for (let n = batch; n >= Math.max(endNum, batch - 9); n--) nums.push(n);

        const results = await Promise.all(
          nums.map(n => fetchInvoice(auth, cif, sName, n))
        );

        for (let i = 0; i < results.length; i++) {
          const inv = results[i];
          if (!inv) continue;

          const invNum    = nums[i];
          const obs       = norm(inv.observations || inv.description || inv.mentions || '');
          const clientInv = inv.clientName || inv.client || inv.buyerName || '';
          const invTotal  = parseFloat(inv.totalAmount || inv.total || inv.grandTotal || inv.amount || 0);
          const invUrl    = inv.webLink || inv.pdfLink || inv.url ||
            `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cif)}&series=${encodeURIComponent(sName)}&number=${encodeURIComponent(invNum)}`;

          // Caută dacă această factură corespunde vreunei comenzi
          for (const [orderName, order] of Object.entries(orderIndex)) {
            if (found[orderName]) continue; // deja găsită

            const cleanNum   = orderName.replace(/[^0-9]/g, '');
            const orderTotal = parseFloat(order.total) || 0;

            let matchType = null;

            // 1. Numărul comenzii în observations
            if (obs.includes(cleanNum) || obs.includes(norm(orderName))) {
              matchType = 'observations';
            }
            // 2. Numele clientului (≥80% potrivire)
            else if (nameScore(order.client, clientInv) >= 0.8) {
              matchType = `name(${Math.round(nameScore(order.client, clientInv)*100)}%)`;
            }
            // 3. Total exact + primul cuvânt din nume
            else if (orderTotal > 0 && Math.abs(invTotal - orderTotal) < 1) {
              const firstWord = norm(order.client || '').split(' ')[0];
              if (firstWord && norm(clientInv).includes(firstWord)) {
                matchType = 'total+name';
              }
            }

            if (matchType) {
              found[orderName] = {
                series: sName, number: String(invNum),
                url: invUrl, matchType,
                date: inv.issueDate || inv.date || '',
                client: clientInv,
              };

              // Write-back în Shopify
              if (shopifyDomain && shopifyToken && order.id) {
                const r = await markInvoiceInShopify({
                  shopifyDomain, shopifyToken,
                  orderId:       order.id,
                  invoiceSeries: sName,
                  invoiceNumber: String(invNum),
                  invoiceUrl:    invUrl,
                });
                if (r.ok) shopifyUpdated.push(orderName);
              }
            }
          }
        }

        // Dacă am găsit toate comenzile, oprim
        if (Object.keys(found).length === orders.length) break;
      }

      if (Object.keys(found).length === orders.length) break;
    }

    const notFound = orders.map(o => o.name).filter(n => !found[n]);

    return NextResponse.json({
      found, notFound, shopifyUpdated,
      scanned: seriesList.map(s => `${s.name}(next:${s.nextNumber})`).join(', '),
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
