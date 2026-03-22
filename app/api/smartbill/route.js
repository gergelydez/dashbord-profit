import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const token = searchParams.get('token');
  const cif   = searchParams.get('cif');
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const type  = searchParams.get('type') || 'products';

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

  // SmartBill Cloud API - correct base URL
  // Docs: https://api.smartbill.ro
  const BASE = 'https://ws.smartbill.ro/SBORO/api';

  try {
    if (type === 'test') {
      // Test all known SmartBill API endpoint patterns
      const results = {};
      const testUrls = [
        // SmartBill Cloud - ws.smartbill.ro
        { name: 'ws/invoice-list',  url: `${BASE}/invoice/list?cif=${cif}&seriesname=&from=2026-02-01&to=2026-02-28&page=1&pageSize=3` },
        { name: 'ws/expense-list',  url: `${BASE}/expense/list?cif=${cif}&seriesname=&from=2026-02-01&to=2026-02-28&page=1&pageSize=3` },
        { name: 'ws/product-list',  url: `${BASE}/product/list?cif=${cif}&page=1&pageSize=3` },
        { name: 'ws/taxes',         url: `${BASE}/tax?cif=${cif}` },
        // Alternative SmartBill API
        { name: 'api-v1/invoices',  url: `https://api.smartbill.ro/v1/invoice/list?cif=${cif}&from=2026-02-01&to=2026-02-28` },
        { name: 'api-v1/products',  url: `https://api.smartbill.ro/v1/product/list?cif=${cif}` },
        // Try without /SBORO/
        { name: 'ws-direct/invoice', url: `https://ws.smartbill.ro/api/invoice/list?cif=${cif}&from=2026-02-01&to=2026-02-28&page=1&pageSize=3` },
        { name: 'ws-direct/expense', url: `https://ws.smartbill.ro/api/expense/list?cif=${cif}&from=2026-02-01&to=2026-02-28&page=1&pageSize=3` },
      ];
      
      for (const { name, url } of testUrls) {
        try {
          const r = await fetch(url, { headers, cache: 'no-store' });
          const raw = await r.text();
          let parsed;
          try { parsed = JSON.parse(raw); } catch { parsed = null; }
          results[name] = { 
            status: r.status, 
            isJson: !!parsed, 
            preview: raw.slice(0, 200),
            url: url
          };
        } catch (e) {
          results[name] = { error: e.message, url };
        }
      }
      return NextResponse.json({ results, auth_used: `${cleanEmail}:***`, token_length: cleanToken.length });
    }

    if (type === 'expense') {
      const [year, m] = month.split('-');
      const days = new Date(year, m, 0).getDate();
      const url = `${BASE}/expense/list?cif=${cif}&seriesname=&from=${year}-${m}-01&to=${year}-${m}-${days}&page=1&pageSize=500`;
      const res = await fetch(url, { headers, cache: 'no-store' });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); }
      catch { return NextResponse.json({ error: `SmartBill răspuns invalid: ${raw.slice(0, 300)}` }, { status: 502 }); }
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
      return NextResponse.json({ costs, rawCount: bills.length });
    }

    if (type === 'products') {
      const url = `${BASE}/product/list?cif=${cif}&page=1&pageSize=500`;
      const res = await fetch(url, { headers, cache: 'no-store' });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); }
      catch { return NextResponse.json({ error: `SmartBill răspuns invalid: ${raw.slice(0, 200)}` }, { status: 502 }); }
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
      return NextResponse.json({ costs, products, rawCount: products.length });
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

