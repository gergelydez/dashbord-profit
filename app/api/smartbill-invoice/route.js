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

// Încearcă să colecteze (încaseze) o factură
async function collectInvoice(auth, cif, series, number, value) {
  const body = {
    companyVatCode: cif,
    seriesName: series,
    number: String(number),
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentValue: parseFloat(value) || 0,
    isCash: false, // ramburs = numerar, dar în SmartBill marcăm ca "altă metodă"
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

// Notează factura în Shopify ca note_attribute (identic cu xConnector)
async function markInvoiceInShopify({ shopifyDomain, shopifyToken, orderId, invoiceSeries, invoiceNumber, smartbillCif }) {
  if (!shopifyDomain || !shopifyToken || !orderId) return { ok: false, error: 'Date Shopify lipsă' };

  // Construim URL-ul facturii SmartBill (format standard)
  const invoiceUrl = `https://cloud.smartbill.ro/document/factura?cif=${smartbillCif}&series=${invoiceSeries}&number=${invoiceNumber}`;

  // Obținem note_attributes existente
  const getRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders/${orderId}.json?fields=note_attributes,tags`, {
    headers: { 'X-Shopify-Access-Token': shopifyToken },
    cache: 'no-store',
  });
  if (!getRes.ok) return { ok: false, error: `Shopify GET ${getRes.status}` };
  const orderData = await getRes.json();
  const existingAttrs = orderData.order?.note_attributes || [];

  // Construim note_attributes noi (păstrăm existente, adăugăm/actualizăm facturile)
  const newAttrs = existingAttrs.filter(a =>
    !['xconnector-invoice-url','xconnector-invoice-short-url','invoice-number','invoice-series'].includes((a.name||'').toLowerCase())
  );
  newAttrs.push(
    { name: 'xconnector-invoice-url', value: invoiceUrl },
    { name: 'invoice-number', value: String(invoiceNumber) },
    { name: 'invoice-series', value: invoiceSeries },
  );

  // Adăugăm tag 'invoiced' dacă nu există
  const existingTags = (orderData.order?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!existingTags.includes('invoiced')) existingTags.push('invoiced');

  const updateRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders/${orderId}.json`, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': shopifyToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      order: {
        id: orderId,
        note_attributes: newAttrs,
        tags: existingTags.join(', '),
      }
    }),
    cache: 'no-store',
  });
  const updateData = await updateRes.json();
  if (!updateRes.ok) return { ok: false, error: `Shopify PUT ${updateRes.status}` };

  return { ok: true, invoiceUrl };
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
        return NextResponse.json({ error: 'Nu am putut detecta seria de facturi. Completează câmpul "Serie" înainte de generare.' }, { status: 400 });
      }
    }

    const issueDate = new Date().toISOString().slice(0, 10);

    // Construiește produsele cu SKU pentru descărcare gestiune
    const buildProduct = (item) => {
      const prod = {
        name: (item.name || 'Produs').slice(0, 255),
        isDiscount: false,
        measuringUnitName: 'buc',
        currency: order.currency || 'RON',
        quantity: Math.max(1, parseInt(item.qty) || 1),
        price: parseFloat(item.price) || 0,
        isTaxIncluded: true,
        taxName: 'Normala',
        taxPercentage: 21,
        isService: false,
        saveToDb: false,
      };
      // SKU — necesar pentru descărcare gestiune
      if (item.sku) prod.code = item.sku;
      return prod;
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
      useStock: order.useStock === true,  // descărcare stoc — activat doar dacă setat explicit
      observations: `Comanda Shopify ${order.name}`,
      mentions: '',
      products,
    };

    // ── Generează factura ──
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
      return NextResponse.json({ error: `SmartBill ${invRes.status}: ${errMsg}` }, { status: invRes.status });
    }

    const invoiceSeries = invData.series;
    const invoiceNumber = invData.number;
    const invoiceTotal  = parseFloat(order.total) || 0;

    // ── Încasare automată dacă comanda e plătită pe Shopify ──
    let collected = false;
    if (order.isPaid && invoiceSeries && invoiceNumber) {
      const collectResult = await collectInvoice(auth, cif, invoiceSeries, invoiceNumber, invoiceTotal);
      collected = collectResult.ok;
    }

    // ── Notare în Shopify (note_attributes + tag) ──
    let shopifyMarked = false;
    let invoiceUrl = '';
    if (shopifyDomain && shopifyToken && order.id) {
      const markResult = await markInvoiceInShopify({
        shopifyDomain,
        shopifyToken,
        orderId: order.id,
        invoiceSeries,
        invoiceNumber,
        smartbillCif: cif,
      });
      shopifyMarked = markResult.ok;
      invoiceUrl = markResult.invoiceUrl || '';
    }

    return NextResponse.json({
      ok: true,
      series: invoiceSeries,
      number: invoiceNumber,
      collected,
      shopifyMarked,
      invoiceUrl,
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
    const res = await fetch(`${BASE}/invoice/series?cif=${cif}`, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      cache: 'no-store',
    });
    const raw = await res.text();
    let data; try { data = JSON.parse(raw); } catch { data = {}; }
    if (!res.ok) return NextResponse.json({ error: `SmartBill ${res.status}` }, { status: res.status });
    const list = data.list || data.invoiceSeries || [];
    return NextResponse.json({ series: list.map(s => s.name || s) });
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

