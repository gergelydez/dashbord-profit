import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const token = searchParams.get('token');
  const cif   = searchParams.get('cif');
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const type  = searchParams.get('type') || 'products'; // products | expense | invoice

  if (!email || !token || !cif) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  // Token may contain pipe | character (e.g. "003|98fc...") - this is normal for SmartBill
  // searchParams.get() auto-decodes %7C -> | so token should be correct here
  const cleanToken = token.trim();
  const cleanEmail = email.trim();
  const auth = Buffer.from(`${cleanEmail}:${cleanToken}`).toString('base64');
  
  const headers = {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  try {
    if (type === 'products') {
      // ── Fetch product list with prices ──
      // SmartBill has a products endpoint that returns all products with buying price
      const res = await fetch(
        `https://ws.smartbill.ro/SBORO/api/product/list?cif=${cif}&page=1&pageSize=500`,
        { headers, cache: 'no-store' }
      );
      const raw = await res.text();

      // Try to parse as JSON
      let data;
      try { data = JSON.parse(raw); }
      catch { return NextResponse.json({ error: `SmartBill răspuns invalid: ${raw.slice(0, 200)}` }, { status: 502 }); }

      if (!res.ok) return NextResponse.json({ error: `SmartBill ${res.status}: ${JSON.stringify(data)}` }, { status: res.status });

      // Extract product costs from product list
      const costs = {};
      const products = data.products || data.list || data.Produse || [];
      products.forEach(p => {
        const name = (p.name || p.denumire || p.Name || '').toLowerCase().trim();
        const sku  = (p.code || p.cod || p.Cod || '').toLowerCase().trim();
        // buyingPrice = cost de achizitie
        const cost = parseFloat(p.buyingPrice || p.pretAchizitie || p.costPrice || p.pret || 0);
        if (name && cost > 0) costs[name] = cost;
        if (sku  && cost > 0) costs[sku]  = cost;
      });

      return NextResponse.json({ costs, products, rawCount: products.length });
    }

    if (type === 'expense') {
      // ── Fetch purchase invoices ──
      const [year, m] = month.split('-');
      const days = new Date(year, m, 0).getDate();
      const res = await fetch(
        `https://ws.smartbill.ro/SBORO/api/expense/list?cif=${cif}&seriesname=&from=${year}-${m}-01&to=${year}-${m}-${days}&page=1&pageSize=500`,
        { headers, cache: 'no-store' }
      );
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); }
      catch { return NextResponse.json({ error: `SmartBill răspuns invalid: ${raw.slice(0, 300)}` }, { status: 502 }); }
      if (!res.ok) return NextResponse.json({ error: `SmartBill ${res.status}: ${JSON.stringify(data)}` }, { status: res.status });

      // Extract costs from purchase invoices
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

      return NextResponse.json({ costs, rawCount: bills.length, data });
    }

    if (type === 'test') {
      // Test connection - try multiple endpoints and return raw responses
      const results = {};
      const testUrls = [
        { name: 'product/list', url: `https://ws.smartbill.ro/SBORO/api/product/list?cif=${cif}&page=1&pageSize=3` },
        { name: 'invoice/list', url: `https://ws.smartbill.ro/SBORO/api/invoice/list?cif=${cif}&seriesname=&from=2026-03-01&to=2026-03-31&page=1&pageSize=3` },
        { name: 'expense/list', url: `https://ws.smartbill.ro/SBORO/api/expense/list?cif=${cif}&seriesname=&from=2026-03-01&to=2026-03-31&page=1&pageSize=3` },
        { name: 'company',      url: `https://ws.smartbill.ro/SBORO/api/company/allbyusername` },
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
      return NextResponse.json({ results, auth_used: `${email}:***` });
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
