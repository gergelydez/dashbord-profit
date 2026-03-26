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
    // Fields fără payment_gateway — Shopify nu îl returnează în list
    const fields = 'id,name,financial_status,fulfillment_status,fulfillments,cancelled_at,created_at,total_price,currency,line_items,shipping_address,billing_address,tags,note_attributes,processed_at';
    const createdMin = searchParams.get('created_at_min') || '';
    let allOrders = [];
    let url = `https://${domain}/admin/api/2024-01/orders.json?limit=250&status=any&fields=${fields}`;
    if (createdMin) url += `&created_at_min=${createdMin}`;

    // Paginare completă
    while (url) {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return NextResponse.json({ error: err.errors || `Shopify ${res.status}` }, { status: res.status });
      }
      const data = await res.json();
      allOrders = allOrders.concat(data.orders || []);

      // Link header pentru pagina următoare
      const link = res.headers.get('link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }

    // Pentru comenzile cu fin='paid', obținem payment_gateway individual
    // Shopify returnează payment_gateway pe endpoint-ul individual dar nu în list
    const paidOrders = allOrders.filter(o => o.financial_status === 'paid');

    if (paidOrders.length > 0) {
      // Facem request-uri în paralel, max 10 simultan
      const batchSize = 10;
      for (let i = 0; i < paidOrders.length; i += batchSize) {
        const batch = paidOrders.slice(i, i + batchSize);
        await Promise.all(batch.map(async (order) => {
          try {
            const r = await fetch(
              `https://${domain}/admin/api/2024-01/orders/${order.id}.json?fields=id,payment_gateway`,
              { headers, cache: 'no-store' }
            );
            if (r.ok) {
              const d = await r.json();
              order.payment_gateway = d.order?.payment_gateway || '';
            }
          } catch { /* skip */ }
        }));
      }
    }

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
