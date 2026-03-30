// app/api/smartbill/products/route.js
// Pune acest fișier la: app/api/smartbill/products/route.js

import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(email, token) {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email     = searchParams.get('email');
  const token     = searchParams.get('token');
  const cif       = searchParams.get('cif');
  const warehouse = searchParams.get('warehouse') || '';

  if (!email || !token || !cif) {
    return NextResponse.json({ error: 'email, token și cif sunt obligatorii' }, { status: 400 });
  }

  const auth    = makeAuth(email, token);
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

  try {
    const prodRes = await fetch(`${BASE}/product?cif=${encodeURIComponent(cif)}`, {
      headers, cache: 'no-store', signal: AbortSignal.timeout(15000),
    });

    if (!prodRes.ok) {
      const err = await prodRes.text();
      return NextResponse.json({ error: `SmartBill ${prodRes.status}`, details: err.slice(0, 300) }, { status: prodRes.status });
    }

    const prodData = await prodRes.json();
    const rawList  = prodData.list || prodData.products || prodData.data || [];

    const products = rawList
      .filter(p => p && (p.name || p.productName))
      .map(p => ({
        sku:     p.code || p.productCode || p.sku || '',
        name:    p.name || p.productName || '',
        cost:    parseFloat(p.purchasePrice ?? p.buyingPrice ?? p.costPrice ?? p.price ?? 0) || 0,
        stock:   parseFloat(p.quantity ?? p.stock ?? 0) || 0,
        unit:    p.measuringUnit || 'buc',
        updated: new Date().toISOString().slice(0, 7),
      }))
      .filter(p => p.name);

    if (warehouse) {
      try {
        const sRes = await fetch(
          `${BASE}/stock?cif=${encodeURIComponent(cif)}&warehouseName=${encodeURIComponent(warehouse)}`,
          { headers, cache: 'no-store', signal: AbortSignal.timeout(10000) }
        );
        if (sRes.ok) {
          const sData  = await sRes.json();
          const sItems = sData.list || sData.stocks || sData.data || [];
          const sMap   = {};
          sItems.forEach(s => {
            const code = s.code || s.productCode || s.sku || '';
            if (code) sMap[code] = {
              stock: parseFloat(s.quantity ?? s.stock ?? 0) || 0,
              cost:  parseFloat(s.purchasePrice ?? s.costPrice ?? s.price ?? 0) || 0,
            };
          });
          products.forEach(p => {
            const s = sMap[p.sku];
            if (s) { if (s.cost > 0) p.cost = s.cost; p.stock = s.stock; }
          });
        }
      } catch { /* gestiune opțională */ }
    }

    const stdCosts = products
      .filter(p => p.cost > 0)
      .map(p => ({
        id:       p.sku || p.name,
        sku:      p.sku,
        name:     p.name,
        pattern:  p.name.toLowerCase(),
        excludes: [],
        cost:     p.cost,
        updated:  p.updated,
      }));

    return NextResponse.json({ ok: true, count: products.length, products, stdCosts });

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

