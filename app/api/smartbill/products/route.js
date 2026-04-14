import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(email, token) {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

function extractProducts(data) {
  const items = data.list || data.stocks || data.products || data.data || [];
  const result = [];
  items.forEach(p => {
    const name = p.name || p.productName || p.denumire || '';
    const sku  = p.code || p.productCode || p.cod || p.sku || '';
    const cost = parseFloat(
      p.unitCost ?? p.costUnitar ?? p.cost ??
      p.purchasePrice ?? p.pretAchizitie ??
      p.buyingPrice ?? p.costPrice ?? 0
    ) || 0;
    if (name && cost > 0) {
      result.push({ sku, name, cost, stock: parseFloat(p.quantity ?? p.cantitate ?? p.stoc ?? 0) || 0 });
    }
  });
  return result;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email     = searchParams.get('email');
  const token     = searchParams.get('token');
  const cif       = searchParams.get('cif');
  const warehouse = searchParams.get('warehouse') || '';
  const date      = new Date().toISOString().slice(0, 10);

  if (!email || !token || !cif) {
    return NextResponse.json({ error: 'email, token și cif sunt obligatorii' }, { status: 400 });
  }

  const auth    = makeAuth(email, token);
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

  const endpoints = [
    warehouse && `${BASE}/report/stock?cif=${encodeURIComponent(cif)}&date=${date}&warehouseName=${encodeURIComponent(warehouse)}`,
    warehouse && `${BASE}/stock?cif=${encodeURIComponent(cif)}&warehouseName=${encodeURIComponent(warehouse)}&date=${date}`,
    warehouse && `${BASE}/stocks?cif=${encodeURIComponent(cif)}&warehouseName=${encodeURIComponent(warehouse)}`,
    `${BASE}/report/stock?cif=${encodeURIComponent(cif)}&date=${date}`,
    `${BASE}/stock?cif=${encodeURIComponent(cif)}&date=${date}`,
    `${BASE}/stocks?cif=${encodeURIComponent(cif)}`,
    `${BASE}/product?cif=${encodeURIComponent(cif)}`,
    `${BASE}/products?cif=${encodeURIComponent(cif)}`,
  ].filter(Boolean);

  const tried = [];
  for (const url of endpoints) {
    tried.push(url.replace(BASE, ''));
    try {
      const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const products = extractProducts(data);
      if (!products.length) continue;

      const updated  = new Date().toISOString().slice(0, 7);
      const stdCosts = products.map(p => ({
        id: p.sku || p.name, sku: p.sku, name: p.name,
        pattern: p.name.toLowerCase(), excludes: [],
        cost: p.cost, updated,
      }));

      return NextResponse.json({ ok: true, count: products.length, source: url.replace(BASE,''), products, stdCosts });
    } catch { continue; }
  }

  return NextResponse.json({
    ok: false, tried,
    error: 'API SmartBill nu expune costurile de achiziție. Folosește Export Excel din SmartBill.',
    useExcel: true,
  }, { status: 404 });
}

