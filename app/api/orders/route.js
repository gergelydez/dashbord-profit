import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain');
  const token  = searchParams.get('token');

  if (!domain || !token) {
    return NextResponse.json({ error: 'Missing domain or token' }, { status: 400 });
  }

  const headers = {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
  };

  try {
    // NU specificăm fields — returnăm TOTUL de la Shopify
    // Astfel obținem payment_gateway, payment_details, și orice alt câmp disponibil
    const createdMin = searchParams.get('created_at_min') || '';
    let allOrders = [];
    let url = `https://${domain}/admin/api/2024-01/orders.json?limit=250&status=any`;
    if (createdMin) url += `&created_at_min=${createdMin}`;

    while (url) {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return NextResponse.json({ error: err.errors || `Shopify ${res.status}` }, { status: res.status });
      }
      const data = await res.json();
      allOrders = allOrders.concat(data.orders || []);

      const link = res.headers.get('link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }

    // Returnăm toate datele — page.js va extrage payment_gateway din ele
    return NextResponse.json({ orders: allOrders }, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
