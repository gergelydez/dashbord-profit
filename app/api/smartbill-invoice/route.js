import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(email, token) {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

async function getDefaultSeries(auth, cif) {
  const res = await fetch(`${BASE}/invoice/series?cif=${cif}`, {
    headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json();
  const list = data.list || data.invoiceSeries || [];
  return list.find(s => s.nextNumber)?.name || list[0]?.name || null;
}

async function collectInvoice(auth, cif, series, number, value) {
  const res = await fetch(`${BASE}/invoice/paymentlist`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      companyVatCode: cif,
      seriesName: series,
      number: String(number),
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentValue: parseFloat(value) || 0,
      isCash: false,
      type: 'Chitanta',
    }),
    cache: 'no-store',
  });
  return { ok: res.ok };
}

async function markInvoiceInShopify({ shopifyDomain, shopifyToken, orderId, invoiceSeries, invoiceNumber, invoiceUrl }) {
  if (!shopifyDomain || !shopifyToken || !orderId) return { ok: false };
  try {
    const getRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders/${orderId}.json?fields=note_attributes,tags`, {
      headers: { 'X-Shopify-Access-Token': shopifyToken }, cache: 'no-store',
    });
    if (!getRes.ok) return { ok: false };
    const orderData = await getRes.json();
    const existingAttrs = (orderData.order?.note_attributes || []).filter(a => {
      const n = (a.name||'').toLowerCase();
      return !['xconnector-invoice-url','invoice-number','invoice-series'].includes(n);
    });
    existingAttrs.push(
      { name: 'xconnector-invoice-url', value: invoiceUrl },
      { name: 'invoice-number', value: String(invoiceNumber) },
      { name: 'invoice-series', value: invoiceSeries },
    );
    const tags = (orderData.order?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    if (!tags.includes('invoiced')) tags.push('invoiced');
    const updateRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders/${orderId}.json`, {
      method: 'PUT',
      headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: { id: orderId, note_attributes: existingAttrs, tags: tags.join(', ') } }),
      cache: 'no-store',
    });
    return { ok: updateRes.ok };
  } catch { return { ok: false }; }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, token, cif, seriesName, order, shopifyDomain, shopifyToken } = body;

    if (!email || !token || !cif || !order) {
      return NextResponse.json({ error: 'Date lipsă.' }, { status: 400 });
    }

    const auth = makeAuth(email, token);
    const series = seriesName || await getDefaultSeries(auth, cif);
    if (!series) return NextResponse.json({ error: 'Completează câmpul "Serie" înainte de generare.' }, { status: 400 });

    const issueDate = new Date().toISOString().slice(0, 10);
    const useStock  = order.useStock === true && !!order.warehouseName;

    // Construiește produsele
    // Când useStock=true: trimitem DOAR code (SKU) — SmartBill găsește produsul
    // din gestiune după code și preia automat numele, UM, TVA din gestiune
    // NU trimitem name separat — ar putea crea conflict cu numele din gestiune
    const buildProduct = (item) => {
      const sku = (item.sku || '').trim();
      const qty = Math.max(1, parseInt(item.qty) || 1);
      const price = parseFloat(item.price) || 0;

      if (useStock && sku) {
        // Cu gestiune: SmartBill identifică produsul după code (SKU)
        // și preia toate datele (nume, UM, TVA) din gestiune
        return {
          name: (item.name || 'Produs').slice(0, 255), // fallback dacă SKU nu există în gestiune
          code: sku,
          isDiscount: false,
          measuringUnitName: 'buc',
          currency: order.currency || 'RON',
          quantity: qty,
          price,
          isTaxIncluded: true,
          taxName: 'Normala',
          taxPercentage: 21,
          isService: false,
          saveToDb: false,
        };
      }

      // Fără gestiune: produs simplu
      return {
        name: (item.name || 'Produs').slice(0, 255),
        code: sku || '',
        isDiscount: false,
        measuringUnitName: 'buc',
        currency: order.currency || 'RON',
        quantity: qty,
        price,
        isTaxIncluded: true,
        taxName: 'Normala',
        taxPercentage: 21,
        isService: false,
        saveToDb: false,
      };
    };

    let products = (order.items || []).filter(i => parseFloat(i.price) > 0).map(buildProduct);
    if (!products.length) {
      products = [{ name: `Comanda ${order.name}`, code: '', isDiscount: false, measuringUnitName: 'buc', currency: order.currency || 'RON', quantity: 1, price: parseFloat(order.total) || 0, isTaxIncluded: true, taxName: 'Normala', taxPercentage: 21, isService: false, saveToDb: false }];
    }

    const invoiceBody = {
      companyVatCode: cif,
      client: {
        name: (order.client || 'Client').slice(0, 100),
        vatCode: '', regCom: '',
        address: (order.address || '').slice(0, 255),
        isTaxPayer: false,
        city: order.city || '',
        county: order.county || '',
        country: 'Romania',
        email: order.clientEmail || '',
        saveToDb: false,
      },
      issueDate,
      seriesName: series,
      isDraft: false,
      currency: order.currency || 'RON',
      language: 'RO',
      precision: 2,
      useStock,
      ...(useStock ? { warehouseName: order.warehouseName } : {}),
      observations: `Comanda Shopify ${order.name}`,
      mentions: '',
      products,
    };

    const invRes = await fetch(`${BASE}/invoice`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(invoiceBody),
      cache: 'no-store',
    });

    const invRaw = await invRes.text();
    let invData; try { invData = JSON.parse(invRaw); } catch { invData = { raw: invRaw.slice(0, 300) }; }

    if (!invRes.ok) {
      const errMsg = invData.errorText || invData.message || invData.error || JSON.stringify(invData).slice(0, 300);
      return NextResponse.json({
        error: `SmartBill ${invRes.status}: ${errMsg}`,
        _sentBody: JSON.stringify({ useStock, warehouseName: order.warehouseName, products: products.map(p => ({ code: p.code, name: p.name.slice(0,30) })) }),
      }, { status: invRes.status });
    }

    const invoiceSeries = invData.series;
    const invoiceNumber = invData.number;

    // URL factură — din răspuns sau construit corect
    // Format corect SmartBill cloud: /core/factura/vizualizeaza/
    const invoiceUrl = invData.url || invData.documentUrl ||
      `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cif)}&series=${encodeURIComponent(invoiceSeries)}&number=${encodeURIComponent(invoiceNumber)}`;

    // Încasare automată (Shopify Payments)
    let collected = false;
    if (order.isPaid) {
      const r = await collectInvoice(auth, cif, invoiceSeries, invoiceNumber, order.total);
      collected = r.ok;
    }

    // Notare în Shopify
    let shopifyMarked = false;
    if (shopifyDomain && shopifyToken && order.id) {
      const r = await markInvoiceInShopify({ shopifyDomain, shopifyToken, orderId: order.id, invoiceSeries, invoiceNumber, invoiceUrl });
      shopifyMarked = r.ok;
    }

    return NextResponse.json({
      ok: true,
      series: invoiceSeries,
      number: invoiceNumber,
      invoiceUrl,
      collected,
      shopifyMarked,
      stockDecreased: useStock,
    });

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const token = searchParams.get('token');
  const cif   = searchParams.get('cif');
  if (!email || !token || !cif) return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });

  const auth = makeAuth(email, token);
  try {
    const [sRes, wRes] = await Promise.all([
      fetch(`${BASE}/invoice/series?cif=${cif}`, { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }, cache: 'no-store' }),
      fetch(`${BASE}/warehouse/list?cif=${cif}`, { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }, cache: 'no-store' }),
    ]);
    const sData = sRes.ok ? await sRes.json() : {};
    const wData = wRes.ok ? await wRes.json() : {};
    return NextResponse.json({
      series: (sData.list || sData.invoiceSeries || []).map(s => s.name || s),
      warehouses: (wData.list || wData.warehouses || []).map(w => w.name || w),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
}

