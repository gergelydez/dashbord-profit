import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const token = searchParams.get('token');
  const cif   = searchParams.get('cif');
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const type  = searchParams.get('type') || 'expense';

  if (!email || !token || !cif) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  const cleanToken = token.trim();
  const cleanEmail = email.trim();
  const auth = Buffer.from(`${cleanEmail}:${cleanToken}`).toString('base64');
  const headers = {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const BASE = 'https://ws.smartbill.ro/SBORO/api';

  try {
    if (type === 'test') {
      const results = {};
      // From test results we know /tax works → auth OK
      // Now test the correct invoice/expense endpoints
      const [year, m] = month.split('-');
      const days = new Date(parseInt(year), parseInt(m), 0).getDate();
      const from = `${year}-${m}-01`;
      const to   = `${year}-${m}-${String(days).padStart(2,'0')}`;

      const testUrls = [
        // Correct SmartBill Cloud endpoints (from official docs)
        { name: 'bills/list',         url: `${BASE}/bills?cif=${cif}&from=${from}&to=${to}&page=1&pageSize=3` },
        { name: 'invoice/list-v2',    url: `${BASE}/invoices?cif=${cif}&from=${from}&to=${to}&page=1&pageSize=3` },
        { name: 'expense/v2',         url: `${BASE}/expenses?cif=${cif}&from=${from}&to=${to}&page=1&pageSize=3` },
        { name: 'invoice/list-exact', url: `${BASE}/invoice/list?cif=${cif}&seriesname=&from=${from}&to=${to}&page=1&pageSize=3` },
        { name: 'expense/list-exact', url: `${BASE}/expense/list?cif=${cif}&seriesname=&from=${from}&to=${to}&page=1&pageSize=3` },
        { name: 'product/list-exact', url: `${BASE}/product/list?cif=${cif}&page=1&pageSize=3` },
        // Try without seriesname param
        { name: 'invoice/noseries',   url: `${BASE}/invoice/list?cif=${cif}&from=${from}&to=${to}&page=1&pageSize=3` },
        { name: 'expense/noseries',   url: `${BASE}/expense/list?cif=${cif}&from=${from}&to=${to}&page=1&pageSize=3` },
        // Try different path formats
        { name: 'factura/list',       url: `${BASE}/factura/list?cif=${cif}&from=${from}&to=${to}` },
        { name: 'chitanta/list',      url: `${BASE}/chitanta/list?cif=${cif}&from=${from}&to=${to}` },
        // Tax works - try similar patterns
        { name: 'tax-check',          url: `${BASE}/tax?cif=${cif}` },
        { name: 'company/all',        url: `${BASE}/company/allbyusername` },
        { name: 'series/list',        url: `${BASE}/invoice/series?cif=${cif}` },
        { name: 'series/expense',     url: `${BASE}/expense/series?cif=${cif}` },
      ];

      for (const { name, url } of testUrls) {
        try {
          const r = await fetch(url, { headers, cache: 'no-store' });
          const raw = await r.text();
          let parsed;
          try { parsed = JSON.parse(raw); } catch { parsed = null; }
          results[name] = { status: r.status, isJson: !!parsed, preview: raw.slice(0, 150) };
        } catch (e) {
          results[name] = { error: e.message };
        }
      }
      return NextResponse.json({ results, note: 'auth_works=true (tax returned 400 JSON)', token_length: cleanToken.length });
    }

    if (type === 'expense') {
      const [year, m] = month.split('-');
      const days = new Date(parseInt(year), parseInt(m), 0).getDate();
      const from = `${year}-${m}-01`;
      const to   = `${year}-${m}-${String(days).padStart(2,'0')}`;

      // Try multiple endpoint variants
      const endpoints = [
        `${BASE}/expense/list?cif=${cif}&seriesname=&from=${from}&to=${to}&page=1&pageSize=500`,
        `${BASE}/expense/list?cif=${cif}&from=${from}&to=${to}&page=1&pageSize=500`,
        `${BASE}/expenses?cif=${cif}&from=${from}&to=${to}&page=1&pageSize=500`,
      ];

      for (const url of endpoints) {
        const res = await fetch(url, { headers, cache: 'no-store' });
        if (res.status === 404) continue;
        const raw = await res.text();
        let data;
        try { data = JSON.parse(raw); } catch {
          return NextResponse.json({ error: `Invalid JSON from ${url}: ${raw.slice(0,200)}` }, { status: 502 });
        }
        if (!res.ok) return NextResponse.json({ error: `SmartBill ${res.status}: ${JSON.stringify(data)}` }, { status: res.status });

        const costs = {};
        const bills = data.list || data.bills || data.expenses || [];
        bills.forEach(bill => {
          const lines = bill.billEntries || bill.products || bill.lines || bill.Produse || [];
          lines.forEach(line => {
            const name = (line.name || line.denumire || line.productName || '').toLowerCase().trim();
            const sku  = (line.code || line.cod || '').toLowerCase().trim();
            const cost = parseFloat(line.price || line.unitPrice || line.pretUnitar || line.pret || 0);
            if (name && cost > 0) costs[name] = cost;
            if (sku  && cost > 0) costs[sku]  = cost;
          });
        });
        return NextResponse.json({ costs, rawCount: bills.length, usedUrl: url });
      }
      return NextResponse.json({ error: 'Niciun endpoint expense nu a funcționat' }, { status: 404 });
    }

    if (type === 'products') {
      const endpoints = [
        `${BASE}/product/list?cif=${cif}&page=1&pageSize=500`,
        `${BASE}/products?cif=${cif}&page=1&pageSize=500`,
      ];

      for (const url of endpoints) {
        const res = await fetch(url, { headers, cache: 'no-store' });
        if (res.status === 404) continue;
        const raw = await res.text();
        let data;
        try { data = JSON.parse(raw); } catch {
          return NextResponse.json({ error: `Invalid JSON: ${raw.slice(0,200)}` }, { status: 502 });
        }
        if (!res.ok) return NextResponse.json({ error: `SmartBill ${res.status}: ${JSON.stringify(data)}` }, { status: res.status });

        const costs = {};
        const products = data.products || data.list || data.Produse || [];
        products.forEach(p => {
          const name = (p.name || p.denumire || p.Name || '').toLowerCase().trim();
          const sku  = (p.code || p.cod || p.Cod || '').toLowerCase().trim();
          const cost = parseFloat(p.buyingPrice || p.pretAchizitie || p.costPrice || p.pret || 0);
          if (name && cost > 0) costs[name] = cost;
          if (sku  && cost > 0) costs[sku]  = cost;
        });
        return NextResponse.json({ costs, products, rawCount: products.length, usedUrl: url });
      }
      return NextResponse.json({ error: 'Niciun endpoint products nu a funcționat' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Unknown type' }, { status: 400 });

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
  });
}
