import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(email, token) {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

// ── Normalizare robustă ───────────────────────────────────────────────────────
function norm(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // diacritice
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Scor potrivire cuvinte: câte cuvinte din A se găsesc în B
function wordScore(a, b) {
  const wa = norm(a).split(' ').filter(w => w.length > 1);
  const wb = norm(b).split(' ').filter(w => w.length > 1);
  if (!wa.length || !wb.length) return 0;
  const matched = wa.filter(w => wb.includes(w)).length;
  return matched / wa.length;
}

// ── Salvează factura în Shopify ───────────────────────────────────────────────
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

// ── Fetch lista facturi SmartBill pentru o zi/perioadă ────────────────────────
async function fetchInvoiceList(auth, cif, seriesName, from, to) {
  // SmartBill API suportă: GET /invoice/list?cif=...&seriesName=...&from=YYYY-MM-DD&to=YYYY-MM-DD
  const url = `${BASE}/invoice/list?cif=${encodeURIComponent(cif)}&seriesName=${encodeURIComponent(seriesName)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, list: [] };
    const data = await res.json();
    const list = data.list || data.invoices || data.invoicesList || [];
    return { ok: true, list };
  } catch (e) {
    return { ok: false, list: [] };
  }
}

// ── Fetch factură individuală după număr ──────────────────────────────────────
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

// ── Obține seriile disponibile ────────────────────────────────────────────────
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

// ── Extrage numele clientului dintr-o factură SmartBill ───────────────────────
function getClientName(inv) {
  if (typeof inv.client === 'string') return inv.client;
  if (inv.client?.name) return inv.client.name;
  return inv.clientName || inv.buyerName || inv.clientname || '';
}

// ── Extrage orașul dintr-o factură SmartBill ──────────────────────────────────
function getClientCity(inv) {
  if (inv.client?.city) return inv.client.city;
  return inv.clientCity || inv.city || '';
}

// ── Potrivire factură cu comandă ──────────────────────────────────────────────
// Logică: factura a fost emisă automat la plasarea comenzii
// => data facturii = data comenzii, client = același nume, oraș = același
function matchInvoiceToOrder(inv, invNum, sName, order, cif) {
  const clientInv  = getClientName(inv);
  const cityInv    = getClientCity(inv);
  const invTotal   = parseFloat(inv.totalAmount || inv.total || inv.grandTotal || inv.amount || 0);
  const orderTotal = parseFloat(order.total) || 0;
  const obs        = norm(inv.observations || inv.description || inv.mentions || '');
  const cleanNum   = (order.name || '').replace(/[^0-9]/g, '');

  // Scoruri de matching
  const nameScr  = wordScore(order.client, clientInv);
  const cityScr  = order.oras && cityInv ? wordScore(order.oras, cityInv) : 0;
  const totalOk  = orderTotal > 0 && Math.abs(invTotal - orderTotal) < 0.5;
  const obsMatch = cleanNum && (obs.includes(cleanNum) || obs.includes(norm(order.name || '')));
  const orderNumMatch = inv.orderNumber && String(inv.orderNumber).includes(cleanNum);

  let matchType = null;

  // 1. Numărul comenzii în observations sau câmp dedicat (cel mai sigur)
  if (obsMatch || orderNumMatch) {
    matchType = obsMatch ? 'observations' : 'orderNumber';
  }
  // 2. Nume client ≥80% + total potrivit
  else if (nameScr >= 0.8 && totalOk) {
    matchType = `name(${Math.round(nameScr * 100)}%)+total`;
  }
  // 3. Nume client ≥80% + oraș potrivit
  else if (nameScr >= 0.8 && cityScr >= 0.5) {
    matchType = `name(${Math.round(nameScr * 100)}%)+oras`;
  }
  // 4. Nume client ≥80% singur (dacă nu avem alte date)
  else if (nameScr >= 0.9) {
    matchType = `name(${Math.round(nameScr * 100)}%)`;
  }
  // 5. Total exact + primul cuvânt din nume
  else if (totalOk) {
    const firstWord = norm(order.client || '').split(' ')[0];
    if (firstWord && firstWord.length > 2 && norm(clientInv).includes(firstWord)) {
      matchType = 'total+firstword';
    }
  }

  if (!matchType) return null;

  const invoiceUrl = inv.webLink || inv.pdfLink || inv.url ||
    `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cif)}&series=${encodeURIComponent(sName)}&number=${encodeURIComponent(invNum)}`;

  return { series: sName, number: String(invNum), url: invoiceUrl, matchType, client: clientInv };
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

    // ── Obține seriile ────────────────────────────────────────────────────────
    let seriesList = await getSeriesList(auth, cif, seriesName);
    if (!seriesList.length && seriesName) {
      seriesList = [{ name: seriesName, nextNumber: null }];
    }
    if (!seriesList.length) {
      return NextResponse.json({ error: 'Nu s-au găsit serii de facturi.' }, { status: 400 });
    }

    const found          = {};
    const shopifyUpdated = [];

    // ── Helper: procesează o listă de facturi vs comenzi ─────────────────────
    function processInvoiceList(invoices, sName) {
      for (const inv of invoices) {
        if (Object.keys(found).length === orders.length) break;
        const invNum = inv.number || inv.invoiceNumber || inv.documentNumber;
        if (!invNum) continue;
        for (const order of orders) {
          if (found[order.name]) continue;
          const match = matchInvoiceToOrder(inv, invNum, sName, order, cif);
          if (match) {
            found[order.name] = match;
          }
        }
      }
    }

    // ── Helper: salvează în Shopify ce am găsit ───────────────────────────────
    async function persistFound() {
      for (const order of orders) {
        const f = found[order.name];
        if (!f || f._persisted) continue;
        f._persisted = true;
        if (shopifyDomain && shopifyToken && order.id) {
          const r = await markInvoiceInShopify({
            shopifyDomain, shopifyToken,
            orderId: order.id,
            invoiceSeries: f.series,
            invoiceNumber: f.number,
            invoiceUrl: f.url,
          });
          if (r.ok) shopifyUpdated.push(order.name);
        }
      }
    }

    for (const serie of seriesList) {
      if (Object.keys(found).length === orders.length) break;
      const sName = serie.name;

      // ── STRATEGIA 1: fetch invoice/list pe data exactă a fiecărei comenzi ──
      // Facturile au fost emise automat la plasarea comenzii => data identică
      // Grupăm comenzile după zi pentru a minimiza apelurile API
      const byDate = {};
      for (const order of orders) {
        if (found[order.name]) continue;
        if (!order.createdAt) continue;
        const day = order.createdAt.slice(0, 10); // YYYY-MM-DD
        if (!byDate[day]) byDate[day] = [];
        byDate[day].push(order);
      }

      let listAPIWorked = false;

      if (Object.keys(byDate).length > 0) {
        // Fetch în paralel pentru toate zilele distincte (max 10 concurent)
        const days = Object.keys(byDate).sort().reverse(); // cele mai recente primul
        const PARALLEL = 5;

        for (let i = 0; i < days.length; i += PARALLEL) {
          const chunk = days.slice(i, i + PARALLEL);
          const results = await Promise.allSettled(
            chunk.map(day => fetchInvoiceList(auth, cif, sName, day, day))
          );

          for (let j = 0; j < chunk.length; j++) {
            const day = chunk[j];
            const res = results[j].status === 'fulfilled' ? results[j].value : { ok: false, list: [] };

            if (res.ok) {
              listAPIWorked = true;
              if (res.list.length > 0) {
                scanLog.push(`${sName}: ${day} = ${res.list.length} facturi`);
                processInvoiceList(res.list, sName);
              } else {
                // Zi fără facturi — poate data comenzii e alta față de data facturii
                // Încearcă și ziua anterioară / următoare
                const d = new Date(day);
                const prev = new Date(d); prev.setDate(d.getDate() - 1);
                const next = new Date(d); next.setDate(d.getDate() + 1);
                const prevStr = prev.toISOString().slice(0, 10);
                const nextStr = next.toISOString().slice(0, 10);

                const [rPrev, rNext] = await Promise.allSettled([
                  fetchInvoiceList(auth, cif, sName, prevStr, prevStr),
                  fetchInvoiceList(auth, cif, sName, nextStr, nextStr),
                ]);
                if (rPrev.status === 'fulfilled' && rPrev.value.ok && rPrev.value.list.length > 0) {
                  scanLog.push(`${sName}: ${prevStr}(adj) = ${rPrev.value.list.length}`);
                  processInvoiceList(rPrev.value.list, sName);
                }
                if (rNext.status === 'fulfilled' && rNext.value.ok && rNext.value.list.length > 0) {
                  scanLog.push(`${sName}: ${nextStr}(adj) = ${rNext.value.list.length}`);
                  processInvoiceList(rNext.value.list, sName);
                }
              }
            }
          }
        }
      }

      // ── STRATEGIA 2 (fallback): dacă API list nu merge, scan pe luni ────────
      if (!listAPIWorked) {
        scanLog.push(`${sName}: API list indisponibil, scan pe perioade lunare`);
        const now = new Date();

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

          const r = await fetchInvoiceList(auth, cif, sName, fromDate, toDate);
          if (r.ok && r.list.length > 0) {
            listAPIWorked = true;
            scanLog.push(`${sName}: ${fromDate}→${toDate} = ${r.list.length} facturi`);
            processInvoiceList(r.list, sName);
          }
        }
      }

      // ── STRATEGIA 3 (fallback final): scan individual complet ────────────────
      if (!listAPIWorked && Object.keys(found).length < orders.length) {
        let nextNum = serie.nextNumber;

        if (!nextNum) {
          // Binary search pentru a găsi ultimul număr de factură existent
          let lo = 1, hi = 10000, last = 0;
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const inv = await fetchInvoice(auth, cif, sName, mid);
            if (inv) { last = mid; lo = mid + 1; }
            else { hi = mid - 1; }
          }
          nextNum = last + 1;
        }

        scanLog.push(`${sName}: scan individual complet #1→#${nextNum - 1}`);

        const BATCH = 20;
        for (let batch = nextNum - 1; batch >= 1; batch -= BATCH) {
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
              if (match) found[order.name] = match;
            }
          }
        }
      }

      if (Object.keys(found).length === orders.length) break;
    }

    // ── Salvează tot ce am găsit în Shopify ───────────────────────────────────
    await persistFound();

    const notFound = orders.map(o => o.name).filter(n => !found[n]);

    // Curăță flag intern înainte de răspuns
    Object.values(found).forEach(f => delete f._persisted);

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
