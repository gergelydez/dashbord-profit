import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(email, token) {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

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

function normalizeName(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatchScore(orderClient, invoiceClient) {
  const a = normalizeName(orderClient);
  const b = normalizeName(invoiceClient);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const wordsA = a.split(' ').filter(w => w.length > 1);
  const wordsB = b.split(' ').filter(w => w.length > 1);
  if (!wordsA.length) return 0;
  const matches = wordsA.filter(w => wordsB.includes(w));
  return matches.length / wordsA.length;
}

async function fetchInvoiceList(auth, cif) {
  const today = new Date();
  const from = new Date(today);
  from.setFullYear(from.getFullYear() - 1);
  const dateFrom = from.toISOString().slice(0, 10);
  const dateTo   = today.toISOString().slice(0, 10);

  const endpoints = [
    `${BASE}/invoices?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${dateTo}`,
    `${BASE}/invoice/list?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${dateTo}`,
    `${BASE}/invoices/text?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${dateTo}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        const list = data.list || data.invoices || data.invoiceList || [];
        if (list.length > 0) return list;
      }
    } catch {}
  }
  return [];
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, token, cif, orders, shopifyDomain, shopifyToken } = body;

    if (!email || !token || !cif) {
      return NextResponse.json({ error: 'Credențiale SmartBill lipsă.' }, { status: 400 });
    }
    if (!orders?.length) {
      return NextResponse.json({ error: 'Lista comenzi lipsă.' }, { status: 400 });
    }

    const auth = makeAuth(email, token);
    const invoices = await fetchInvoiceList(auth, cif);

    const found = {};
    const notFound = [];
    const shopifyUpdated = [];

    const today = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(); fromDate.setFullYear(fromDate.getFullYear() - 1);
    const dateFrom = fromDate.toISOString().slice(0, 10);

    for (const order of orders) {
      const orderName = order.name;
      const cleanName = orderName.replace('#', '').trim();
      let match = null;
      let matchType = null;

      // PASUL 1: după numărul comenzii în observations
      if (invoices.length > 0) {
        match = invoices.find(inv => {
          const obs = (inv.observations || inv.description || inv.clientRef || inv.mentions || '').toLowerCase();
          return obs.includes(orderName.toLowerCase()) || obs.includes(cleanName);
        });
        if (match) matchType = 'order';
      }

      // PASUL 2: după numele clientului (minim 80% cuvinte comune)
      if (!match && order.client && invoices.length > 0) {
        const bestMatch = invoices
          .map(inv => ({
            inv,
            score: nameMatchScore(order.client, inv.clientName || inv.client || inv.buyerName || ''),
          }))
          .filter(x => x.score >= 0.8)
          .sort((a, b) => b.score - a.score)[0];
        if (bestMatch) { match = bestMatch.inv; matchType = 'name'; }
      }

      // PASUL 3: după total + primul cuvânt din nume
      if (!match && order.client && order.total && invoices.length > 0) {
        const orderTotal = parseFloat(order.total);
        const namePart = normalizeName(order.client).split(' ')[0];
        const byTotal = invoices.find(inv => {
          const invTotal = parseFloat(inv.totalAmount || inv.total || inv.grandTotal || 0);
          const invClient = normalizeName(inv.clientName || inv.client || '');
          return Math.abs(invTotal - orderTotal) < 0.5 && invClient.includes(namePart);
        });
        if (byTotal) { match = byTotal; matchType = 'total+name'; }
      }

      // PASUL 4: search API SmartBill direct (dacă lista era goală sau nu s-a găsit)
      if (!match) {
        try {
          // 4a: după numărul comenzii
          const sRes = await fetch(
            `${BASE}/invoices/text?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${today}&text=${encodeURIComponent(cleanName)}`,
            { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }, cache: 'no-store' }
          );
          if (sRes.ok) {
            const sData = await sRes.json();
            const list = sData.list || sData.invoices || [];
            if (list.length > 0) { match = list[0]; matchType = 'search-order'; }
          }

          // 4b: după primul cuvânt din numele clientului + validare total
          if (!match && order.client) {
            const clientWord = order.client.split(' ')[0];
            const sRes2 = await fetch(
              `${BASE}/invoices/text?cif=${encodeURIComponent(cif)}&from=${dateFrom}&to=${today}&text=${encodeURIComponent(clientWord)}`,
              { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }, cache: 'no-store' }
            );
            if (sRes2.ok) {
              const sData2 = await sRes2.json();
              const list2 = sData2.list || sData2.invoices || [];
              const byTotal2 = list2.find(inv => {
                const invTotal = parseFloat(inv.totalAmount || inv.total || 0);
                return Math.abs(invTotal - parseFloat(order.total)) < 0.5;
              });
              if (byTotal2) { match = byTotal2; matchType = 'search-name+total'; }
              else if (list2.length === 1) { match = list2[0]; matchType = 'search-name'; }
            }
          }
        } catch {}
      }

      if (match) {
        const series = match.seriesName || match.series || '';
        const number = match.number || match.invoiceNumber || '';
        const url    = match.webLink || match.pdfLink || match.url || match.documentUrl || '';

        found[orderName] = { series, number, url, matchType, date: match.issueDate || match.date || '' };

        // Write-back în Shopify note_attributes
        if (shopifyDomain && shopifyToken && order.id) {
          const sbRes = await markInvoiceInShopify({
            shopifyDomain, shopifyToken,
            orderId: order.id,
            invoiceSeries: series,
            invoiceNumber: number,
            invoiceUrl: url,
          });
          if (sbRes.ok) shopifyUpdated.push(orderName);
        }
      } else {
        notFound.push(orderName);
      }
    }

    return NextResponse.json({ found, notFound, shopifyUpdated, total: invoices.length });

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

