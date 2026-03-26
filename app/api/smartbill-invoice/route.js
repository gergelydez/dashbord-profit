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

function buildInvoiceUrl(invData, cif) {
  if (invData.url) return invData.url;
  if (invData.documentUrl) return invData.documentUrl;
  if (invData.invoiceUrl) return invData.invoiceUrl;
  if (invData.series && invData.number) {
    return `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cif)}&series=${encodeURIComponent(invData.series)}&number=${encodeURIComponent(invData.number)}`;
  }
  return '';
}

async function collectInvoice(auth, cif, series, number, value) {
  const body = {
    companyVatCode: cif,
    seriesName: series,
    number: String(number),
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentValue: parseFloat(value) || 0,
    isCash: false,
    type: 'Chitanta',
  };
  const res = await fetch(`${BASE}/invoice/paymentlist`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const raw = await res.text();
  let data; try { data = JSON.parse(raw); } catch { data = {}; }
  return { ok: res.ok, data };
}

async function markInvoiceInShopify({ shopifyDomain, shopifyToken, orderId, invoiceSeries, invoiceNumber, invoiceUrl }) {
  if (!shopifyDomain || !shopifyToken || !orderId) return { ok: false, error: 'Date Shopify lipsă' };

  const getRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders/${orderId}.json?fields=note_attributes,tags`, {
    headers: { 'X-Shopify-Access-Token': shopifyToken },
    cache: 'no-store',
  });
  if (!getRes.ok) return { ok: false, error: `Shopify GET ${getRes.status}` };
  const orderData = await getRes.json();
  const existingAttrs = orderData.order?.note_attributes || [];

  const newAttrs = existingAttrs.filter(a => {
    const n = (a.name||'').toLowerCase();
    return !['xconnector-invoice-url','xconnector-invoice-short-url','invoice-number','invoice-series'].includes(n);
  });

  newAttrs.push(
    { name: 'xconnector-invoice-url', value: invoiceUrl },
    { name: 'invoice-number', value: String(invoiceNumber) },
    { name: 'invoice-series', value: invoiceSeries },
  );

  const existingTags = (orderData.order?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!existingTags.includes('invoiced')) existingTags.push('invoiced');

  const updateRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders/${orderId}.json`, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: { id: orderId, note_attributes: newAttrs, tags: existingTags.join(', ') } }),
    cache: 'no-store',
  });

  if (!updateRes.ok) return { ok: false, error: `Shopify PUT ${updateRes.status}` };
  return { ok: true };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, token, cif, seriesName, order, shopifyDomain, shopifyToken } = body;

    if (!email || !token || !cif) {
      return NextResponse.json({ error: 'Credențiale SmartBill lipsă.' }, { status: 400 });
    }
    if (!order) {
      return NextResponse.json({ error: 'Date comandă lipsă.' }, { status: 400 });
    }

    const auth = makeAuth(email, token);

    let series = seriesName;
    if (!series) {
      series = await getDefaultSeries(auth, cif);
      if (!series) {
        return NextResponse.json({ error: 'Nu am putut detecta seria. Completează câmpul "Serie".' }, { status: 400 });
      }
    }

    const issueDate = new Date().toISOString().slice(0, 10);

    // Declară useStock ÎNAINTE de orice utilizare
    const useStock = order.useStock === true && !!order.warehouseName;

    // Dacă useStock=true, preluăm produsele din gestiunea SmartBill după SKU
    // Astfel numele de pe factură = numele din gestiune (nu din Shopify)
    let warehouseProducts = {};
    if (useStock && order.warehouseName) {
      try {
        const wpRes = await fetch(
          `${BASE}/product/list?cif=${encodeURIComponent(cif)}&warehouseName=${encodeURIComponent(order.warehouseName)}&page=1&pageSize=500`,
          { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }, cache: 'no-store' }
        );
        if (wpRes.ok) {
          const wpData = await wpRes.json();
          const list = wpData.products || wpData.list || [];
          list.forEach(p => {
            const code = (p.code || p.cod || '').trim();
            if (code) warehouseProducts[code] = p;
          });
        }
      } catch { /* non-critical */ }
    }

    const buildProduct = (item) => {
      const sku = (item.sku || '').trim();
      // Dacă avem gestiune și SKU → căutăm produsul în gestiune
      const warehouseProd = (useStock && sku) ? warehouseProducts[sku] : null;

      return {
        // Dacă produsul există în gestiune → folosim NUMELE LUI (nu cel din Shopify)
        // Altfel SmartBill nu poate face match și nu scade stocul
        name: warehouseProd
          ? (warehouseProd.name || warehouseProd.denumire || item.name || 'Produs').slice(0, 255)
          : (item.name || 'Produs').slice(0, 255),
        code: sku || '',
        isDiscount: false,
        measuringUnitName: warehouseProd
          ? (warehouseProd.measuringUnitName || warehouseProd.unitateMasura || 'buc')
          : 'buc',
        currency: order.currency || 'RON',
        quantity: Math.max(1, parseInt(item.qty) || 1),
        price: parseFloat(item.price) || 0,
        isTaxIncluded: true,
        taxName: 'Normala',
        taxPercentage: 21,
        isService: false,
        saveToDb: false,
      };
    };

    let products = (order.items || [])
      .filter(i => i.name && parseFloat(i.price) > 0)
      .map(buildProduct);

    if (!products.length) {
      products = [{
        name: `Comanda Shopify ${order.name}`,
        code: '',
        isDiscount: false,
        measuringUnitName: 'buc',
        currency: order.currency || 'RON',
        quantity: 1,
        price: parseFloat(order.total) || 0,
        isTaxIncluded: true,
        taxName: 'Normala',
        taxPercentage: 21,
        isService: false,
        saveToDb: false,
      }];
    }

    // Construiește body-ul facturii
    const invoiceBody = {
      companyVatCode: cif,
      client: {
        name: (order.client || 'Client').slice(0, 100),
        vatCode: '',
        regCom: '',
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
      // warehouseName trimis DOAR dacă useStock e true
      ...(useStock ? { warehouseName: order.warehouseName } : {}),
      observations: `Comanda Shopify ${order.name}`,
      mentions: '',
      products,
    };

    // Log complet pentru debugging gestiune
    console.log('[SmartBill Invoice] Body:', JSON.stringify({
      useStock,
      warehouseName: order.warehouseName,
      products: products.map(p => ({ name: p.name, code: p.code, qty: p.quantity })),
    }));

    const invRes = await fetch(`${BASE}/invoice`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(invoiceBody),
      cache: 'no-store',
    });

    const invRaw = await invRes.text();
    let invData; try { invData = JSON.parse(invRaw); } catch { invData = { raw: invRaw.slice(0, 500) }; }

    if (!invRes.ok) {
      const errMsg = invData.errorText || invData.message || invData.error
        || (invData.raw ? invData.raw : JSON.stringify(invData).slice(0, 300));
      return NextResponse.json({
        error: `SmartBill ${invRes.status}: ${errMsg}`,
        _sentBody: { useStock, warehouseName: order.warehouseName },
      }, { status: invRes.status });
    }

    const invoiceSeries = invData.series;
    const invoiceNumber = invData.number;
    const invoiceTotal  = parseFloat(order.total) || 0;
    const invoiceUrl    = buildInvoiceUrl(invData, cif);

    // Încasare automată dacă plătit online
    let collected = false;
    if (order.isPaid && invoiceSeries && invoiceNumber) {
      const collectResult = await collectInvoice(auth, cif, invoiceSeries, invoiceNumber, invoiceTotal);
      collected = collectResult.ok;
    }

    // Notare în Shopify
    let shopifyMarked = false;
    if (shopifyDomain && shopifyToken && order.id && invoiceUrl) {
      const markResult = await markInvoiceInShopify({
        shopifyDomain, shopifyToken,
        orderId: order.id,
        invoiceSeries, invoiceNumber, invoiceUrl,
      });
      shopifyMarked = markResult.ok;
    }

    return NextResponse.json({
      ok: true,
      series: invoiceSeries,
      number: invoiceNumber,
      invoiceUrl,
      collected,
      shopifyMarked,
      stockDecreased: useStock,
      // Debug info vizibil în răspuns
      _debug: {
        useStock,
        warehouseName: order.warehouseName || null,
        productsWithCode: products.filter(p => p.code).length,
        totalProducts: products.length,
        smartbillResponse: JSON.stringify(invData).slice(0, 300),
      },
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

  if (!email || !token || !cif) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  const auth = makeAuth(email, token);

  try {
    const [seriesRes, warehouseRes] = await Promise.all([
      fetch(`${BASE}/invoice/series?cif=${cif}`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
        cache: 'no-store',
      }),
      fetch(`${BASE}/warehouse/list?cif=${cif}`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
        cache: 'no-store',
      }),
    ]);

    const seriesData  = seriesRes.ok  ? await seriesRes.json()  : {};
    const warehouseData = warehouseRes.ok ? await warehouseRes.json() : {};

    const seriesList    = (seriesData.list    || seriesData.invoiceSeries || []).map(s => s.name || s);
    const warehouseList = (warehouseData.list || warehouseData.warehouses || []).map(w => w.name || w);

    return NextResponse.json({ series: seriesList, warehouses: warehouseList });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
  });
}

