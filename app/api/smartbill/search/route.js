import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(email, token) {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
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

// ── Fetch lista facturi SmartBill după perioadă ───────────────────────────────
async function fetchInvoiceList(auth, cif, seriesName, from, to) {
  const urls = [
    `${BASE}/invoice/list?cif=${encodeURIComponent(cif)}&seriesName=${encodeURIComponent(seriesName)}&from=${from}&to=${to}`,
    `${BASE}/invoices?cif=${encodeURIComponent(cif)}&seriesName=${encodeURIComponent(seriesName)}&from=${from}&to=${to}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const list = data.list || data.invoices || data.invoicesList || [];
      if (list.length > 0) return list;
    } catch {}
  }
  return [];
}

// ── Fetch factură individuală ──────────────────────────────────────────────────
async function fetchInvoice(auth, cif, seriesName, number) {
  try {
    const res = await fetch(
      `${BASE}/invoice?cif=${encodeURIComponent(cif)}&seriesName=${encodeURIComponent(seriesName)}&number=${encodeURIComponent(number)}`,
      {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.invoice || data.invoiceDetails || (data.seriesName || data.series ? data : null);
  } catch { return null; }
}

async function getSeriesList(auth, cif, preferredSeries) {
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };
  for (const url of [
    `${BASE}/invoice/series?cif=${encodeURIComponent(cif)}`,
    `${BASE}/series?cif=${encodeURIComponent(cif)}&type=f`,
    `${BASE}/series?cif=${encodeURIComponent(cif)}`,
  ]) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const list = data.list || data.invoiceSeries || data.seriesList || [];
      if (!list.length) continue;
      return list
        .map(s => ({ name: s.name || s, nextNumber: parseInt(s.nextNumber || s.next || 0) || null }))
        .sort((a, b) => {
          if (preferredSeries && a.name === preferredSeries) return -1;
          if (preferredSeries && b.name === preferredSeries) return 1;
          return 0;
        });
    } catch {}
  }
  return [];
}

function matchInvoiceToOrder(inv, invNum, sName, order, cif) {
  const obs       = norm(inv.observations || inv.description || inv.mentions || inv.obs || '');
  const clientInv = inv.clientName || inv.client?.name || inv.buyerName || (typeof inv.client === 'string' ? inv.client : '') || '';
  const invTotal  = parseFloat(inv.totalAmount || inv.total || inv.grandTotal || inv.amount || 0);
  const orderTotal= parseFloat(order.total) || 0;
  const cleanNum  = order.name.replace(/[^0-9]/g, '');

  let matchType = null;

  if (cleanNum && (obs.includes(cleanNum) || obs.includes(norm(order.name)))) {
    matchType = 'observations';
  } else if (inv.orderNumber && String(inv.orderNumber).includes(cleanNum)) {
    matchType = 'orderNumber';
  } else if (nameScore(order.client, clientInv) >= 0.8) {
    matchType = `name(${Math.round(nameScore(order.client, clientInv) * 100)}%)`;
  } else if (orderTotal > 0 && Math.abs(invTotal - orderTotal) < 1) {
    const firstWord = norm(order.client || '').split(' ')[0];
    if (firstWord && norm(clientInv).includes(firstWord)) {
      matchType = 'total+name';
    }
  }

  if (!matchType) return null;

  const invoiceUrl = inv.webLink || inv.pdfLink || inv.url ||
    `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cif)}&series=${encodeURIComponent(sName)}&number=${encodeURIComponent(invNum)}`;

  return { series: sName, number: String(invNum), url: invoiceUrl, matchType, client: clientInv };
}

// ── Scanare completă prin numere individuale ──────────────────────────────────
// Scanează de la nextNumber-1 până la 1, în batch-uri paralele de 20
async function scanAllInvoices(auth, cif, sName, nextNum, orders, found, shopifyDomain, shopifyToken, shopifyUpdated, scanLog) {
  const BATCH = 20; // apeluri paralele per rundă
  const startNum = nextNum - 1;

  scanLog.push(`${sName}: scan complet #${startNum}→#1 (${startNum} facturi)`);

  for (let batch = startNum; batch >= 1; batch -= BATCH) {
    if (Object.keys(found).length === orders.length) break;

    const nums = [];
    for (let n = batch; n >= Math.max(1, batch - BATCH + 1); n--) nums.push(n);

    const results = await Promise.allSettled(
      nums.map(n => fetchInvoice(auth, cif, sName, n))
    );

    for (let i = 0; i < results.length; i++) {
      const inv = results[i].status === 'fulfilled' ? results[i].value : null;
      if (!inv) continue;

      for (const order of orders) {
        if (found[order.name]) continue;
        const match = matchInvoiceToOrder(inv, nums[i], sName, order, cif);
        if (match) {
          found[order.name] = match;
          if (shopifyDomain && shopifyToken && order.id) {
            const r = await markInvoiceInShopify({
              shopifyDomain, shopifyToken,
              orderId: order.id,
              invoiceSeries: sName,
              invoiceNumber: String(nums[i]),
              invoiceUrl: match.url,
            });
            if (r.ok) shopifyUpdated.push(order.name);
          }
        }
      }
    }
  }
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
    const scanLog = [];

    let seriesList = await getSeriesList(auth, cif, seriesName);
    if (!seriesList.length && seriesName) {
      seriesList = [{ name: seriesName, nextNumber: null }];
    }
    if (!seriesList.length) {
      return NextResponse.json({ error: 'Nu s-au găsit serii de facturi.' }, { status: 400 });
    }

    const found          = {};
    const shopifyUpdated = [];

    for (const serie of seriesList) {
      if (Object.keys(found).length === orders.length) break;

      const sName = serie.name;

      // ── Strategie 1: API list pe ultimele 6 luni ─────────────────────────
      const now = new Date();
      let usedListAPI = false;

      for (let i = 0; i < 6; i++) {
        if (Object.keys(found).length === orders.length) break;
        let fromDate, toDate;
        if (i === 0) {
          fromDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
          toDate   = now.toISOString().slice(0, 10);
        } else {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          fromDate = d.toISOString().slice(0, 10);
          toDate   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
        }

        const invoices = await fetchInvoiceList(auth, cif, sName, fromDate, toDate);
        if (invoices.length > 0) {
          usedListAPI = true;
          scanLog.push(`${sName}: ${fromDate}→${toDate} = ${invoices.length} facturi`);

          for (const inv of invoices) {
            if (Object.keys(found).length === orders.length) break;
            const invNum = inv.number || inv.invoiceNumber || inv.documentNumber;
            if (!invNum) continue;

            for (const order of orders) {
              if (found[order.name]) continue;
              const match = matchInvoiceToOrder(inv, invNum, sName, order, cif);
              if (match) {
                found[order.name] = match;
                if (shopifyDomain && shopifyToken && order.id) {
                  const r = await markInvoiceInShopify({
                    shopifyDomain, shopifyToken, orderId: order.id,
                    invoiceSeries: sName, invoiceNumber: String(invNum), invoiceUrl: match.url,
                  });
                  if (r.ok) shopifyUpdated.push(order.name);
                }
              }
            }
          }
        }
      }

      // ── Strategie 2: Scan complet individual dacă API list nu merge ──────
      if (!usedListAPI && Object.keys(found).length < orders.length) {
        let nextNum = serie.nextNumber;

        if (!nextNum) {
          // Detectează nextNumber rapid cu binary search
          let lo = 1, hi = 5000, last = 0;
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const inv = await fetchInvoice(auth, cif, sName, mid);
            if (inv) { last = mid; lo = mid + 1; }
            else { hi = mid - 1; }
          }
          nextNum = last + 1;
        }

        await scanAllInvoices(
          auth, cif, sName, nextNum, orders,
          found, shopifyDomain, shopifyToken, shopifyUpdated, scanLog
        );
      }
    }

    const notFound = orders.map(o => o.name).filter(n => !found[n]);

    return NextResponse.json({ found, notFound, shopifyUpdated, scanned: scanLog.join(' | ') });

  } catch (e) {
    console.error('[SmartBill Search]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
  });
}
