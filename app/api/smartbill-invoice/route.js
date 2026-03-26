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

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, token, cif, seriesName, order } = body;

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
        return NextResponse.json({ error: 'Nu am putut detecta seria de facturi.' }, { status: 400 });
      }
    }

    const issueDate = new Date().toISOString().slice(0, 10);

    const buildProduct = (item) => ({
      name: (item.name || 'Produs').slice(0, 255),
      code: item.sku || '',
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
    });

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
      useStock: false,
      observations: `Comanda Shopify ${order.name}`,
      mentions: '',
      products,
    };

    const res = await fetch(`${BASE}/invoice`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(invoiceBody),
      cache: 'no-store',
    });

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw: raw.slice(0, 500) }; }

    if (!res.ok) {
      const errMsg = data.errorText || data.message || data.error
        || (data.raw ? data.raw : JSON.stringify(data).slice(0, 300));
      return NextResponse.json(
        { error: `SmartBill ${res.status}: ${errMsg}` },
        { status: res.status }
      );
    }

    return NextResponse.json({ ok: true, series: data.series, number: data.number });

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
    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }
    if (!res.ok) {
      return NextResponse.json({ error: `SmartBill ${res.status}` }, { status: res.status });
    }
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

