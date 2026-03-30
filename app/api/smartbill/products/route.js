import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(email, token) {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

// Încearcă mai multe endpoint-uri SmartBill pentru a găsi produsele cu prețuri
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
  const headers = {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const products = [];
  let source = '';

  // Endpoint 1: Stoc pe gestiune (cel mai precis — are prețul de achiziție)
  if (warehouse) {
    try {
      const url = `${BASE}/stock?cif=${encodeURIComponent(cif)}&warehouseName=${encodeURIComponent(warehouse)}`;
      const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = await res.json();
        const items = data.list || data.stocks || data.data || [];
        items.forEach(p => {
          const name = p.name || p.productName || p.denumire || '';
          const sku  = p.code || p.productCode || p.cod || p.sku || '';
          // Prețul de achiziție fără TVA
          const cost = parseFloat(
            p.purchasePrice ?? p.achizitie ?? p.pretAchizitie ??
            p.buyingPrice ?? p.costPrice ?? p.price ?? 0
          ) || 0;
          if (name && cost > 0) {
            products.push({ sku, name, cost, stock: parseFloat(p.quantity ?? p.cantitate ?? 0) || 0 });
          }
        });
        if (products.length > 0) source = `stoc gestiune "${warehouse}"`;
      }
    } catch (e) {
      console.warn('[SB] Stoc endpoint failed:', e.message);
    }
  }

  // Endpoint 2: Toate gestiunile (dacă nu am gestiune specificată sau n-am găsit nimic)
  if (products.length === 0) {
    const warehouseEndpoints = [
      `${BASE}/stock?cif=${encodeURIComponent(cif)}`,
      `${BASE}/stocks?cif=${encodeURIComponent(cif)}`,
    ];
    for (const url of warehouseEndpoints) {
      try {
        const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const data = await res.json();
          const items = data.list || data.stocks || data.data || [];
          items.forEach(p => {
            const name = p.name || p.productName || p.denumire || '';
            const sku  = p.code || p.productCode || p.cod || p.sku || '';
            const cost = parseFloat(
              p.purchasePrice ?? p.achizitie ?? p.pretAchizitie ??
              p.buyingPrice ?? p.costPrice ?? p.price ?? 0
            ) || 0;
            if (name && cost > 0 && !products.find(x => x.sku === sku && x.name === name)) {
              products.push({ sku, name, cost, stock: parseFloat(p.quantity ?? p.cantitate ?? 0) || 0 });
            }
          });
          if (products.length > 0) { source = 'stoc toate gestiunile'; break; }
        }
      } catch { continue; }
    }
  }

  // Endpoint 3: Nomenclator produse
  if (products.length === 0) {
    const nomenclatorEndpoints = [
      `${BASE}/product?cif=${encodeURIComponent(cif)}`,
      `${BASE}/products?cif=${encodeURIComponent(cif)}`,
      `${BASE}/nomenclator/product?cif=${encodeURIComponent(cif)}`,
    ];
    for (const url of nomenclatorEndpoints) {
      try {
        const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const data = await res.json();
          const items = data.list || data.products || data.data || [];
          items.forEach(p => {
            const name = p.name || p.productName || p.denumire || '';
            const sku  = p.code || p.productCode || p.cod || p.sku || '';
            const cost = parseFloat(
              p.purchasePrice ?? p.pretAchizitie ?? p.buyingPrice ??
              p.costPrice ?? p.price ?? 0
            ) || 0;
            if (name && cost > 0) {
              products.push({ sku, name, cost, stock: 0 });
            }
          });
          if (products.length > 0) { source = 'nomenclator'; break; }
        }
      } catch { continue; }
    }
  }

  if (products.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'Nu s-au găsit produse cu preț de achiziție în SmartBill.',
      hint: 'Asigură-te că: 1) Ai modulul Gestiune activ în SmartBill 2) Produsele au preț de achiziție setat 3) Gestiunea este corectă (dacă ai specificat una)',
    }, { status: 404 });
  }

  const updated = new Date().toISOString().slice(0, 7);
  const stdCosts = products.map(p => ({
    id:       p.sku || p.name,
    sku:      p.sku,
    name:     p.name,
    pattern:  p.name.toLowerCase(),
    excludes: [],
    cost:     p.cost,
    updated,
  }));

  return NextResponse.json({ ok: true, count: products.length, source, products, stdCosts });
}
