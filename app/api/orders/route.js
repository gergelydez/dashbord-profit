import { NextResponse } from 'next/server';

const serverCache = new Map();
const CACHE_TTL = 60 * 1000;

const buildQuery = (cursor, createdAtMin) => {
  const afterClause = cursor ? `after: "${cursor}"` : '';
  return `{
  orders(
    first: 250
    ${afterClause}
    query: "created_at:>=${createdAtMin} status:any"
    sortKey: CREATED_AT
    reverse: true
  ) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id name createdAt cancelledAt processedAt
        displayFinancialStatus displayFulfillmentStatus
        paymentGatewayNames
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { name city province }
        billingAddress { name city province }
        lineItems(first: 10) {
          edges { node { name quantity } }
        }
        fulfillments {
          updatedAt createdAt
          trackingInfo { number company }
          displayStatus
        }
        customAttributes { key value }
      }
    }
  }
}`;
};

const mapFinancial = (s) => ({
  'PAID':'paid','PENDING':'pending','REFUNDED':'refunded','VOIDED':'voided',
  'PARTIALLY_PAID':'partially_paid','PARTIALLY_REFUNDED':'partially_refunded','AUTHORIZED':'authorized',
}[s] || (s||'').toLowerCase());

const mapFulfillment = (s) => {
  const m = {
    'FULFILLED':'fulfilled','UNFULFILLED':null,'PARTIALLY_FULFILLED':'partial',
    'IN_TRANSIT':'in_transit','OUT_FOR_DELIVERY':'out_for_delivery','DELIVERED':'delivered',
    'ATTEMPTED_DELIVERY':'attempted_delivery','FAILURE':'failure',
  };
  return m[s] !== undefined ? m[s] : (s||'').toLowerCase();
};

function toRestOrder(node) {
  const fulfillments = (node.fulfillments || []).map(f => {
    const ti = (f.trackingInfo || [])[0] || {};
    const ssMap = {
      'DELIVERED': 'delivered',
      'DELIVERED_TO_PICKUP_POINT': 'delivered',
      'IN_TRANSIT': 'in_transit',
      'CONFIRMED': 'in_transit',
      'FULFILLED': 'in_transit',
      'LABEL_PRINTED': 'label_printed',
      'OUT_FOR_DELIVERY': 'out_for_delivery',
      'WITH_COURIER': 'out_for_delivery',
      'AT_PICKUP_POINT': 'out_for_delivery',
      'ATTEMPTED_DELIVERY': 'failed_attempt',
      'FAILED_ATTEMPT': 'failed_attempt',
      'NOT_DELIVERED': 'failed_attempt',
      'DELIVERY_EXCEPTION': 'failed_attempt',
      'FAILURE': 'failure',
      'FAILED_DELIVERY': 'failure',
      'REFUSED': 'failure',
      'RETURNED': 'returned',
      'RETURN_IN_PROGRESS': 'return_in_progress',
      'RETURN_TO_SENDER': 'return_in_progress',
      'CANCELED': null,
    };
    const ds = (f.displayStatus || '').toUpperCase();
    let mappedStatus;
    if (ds === 'CANCELED') {
      mappedStatus = null;
    } else if (ssMap.hasOwnProperty(ds)) {
      mappedStatus = ssMap[ds];
    } else {
      if (ds) console.log('[STATUS NECUNOSCUT]', ds, 'order:', node.name);
      mappedStatus = ds.toLowerCase() || null;
    }
    return {
      updated_at: f.updatedAt,
      created_at: f.createdAt,
      tracking_number: ti.number || '',
      tracking_company: ti.company || '',
      shipment_status: mappedStatus,
    };
  });

  const lineItems = (node.lineItems?.edges || []).map(e => ({
    name: e.node.name || '',
    quantity: e.node.quantity || 1,
    price: '0',
    sku: '',
  }));

  const gateways = node.paymentGatewayNames || [];
  const addr  = node.shippingAddress || node.billingAddress || {};
  const baddr = node.billingAddress || {};

  return {
    id: (node.id || '').replace(/[^0-9]/g, ''),
    name: node.name || '',
    financial_status: mapFinancial(node.displayFinancialStatus),
    fulfillment_status: mapFulfillment(node.displayFulfillmentStatus),
    payment_gateway: gateways[0] || '',
    cancelled_at: node.cancelledAt || null,
    created_at: node.createdAt || '',
    processed_at: node.processedAt || '',
    total_price: node.totalPriceSet?.shopMoney?.amount || '0',
    currency: node.totalPriceSet?.shopMoney?.currencyCode || 'RON',
    note_attributes: (node.customAttributes || []).map(a => ({ name: a.key, value: a.value })),
    utmSource: '', utmMedium: '', utmCampaign: '', referrerUrl: '', landingPage: '',
    shipping_address: { name: addr.name||'', city: addr.city||'', province: addr.province||'', address1: '', address2: '' },
    billing_address:  { name: baddr.name||'', city: baddr.city||'', province: baddr.province||'', address1: '', address2: '' },
    fulfillments,
    line_items: lineItems,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get('force') === '1';
  const domain = searchParams.get('domain');
  const token = searchParams.get('token');
  const createdMin = (searchParams.get('created_at_min') || '2020-01-01T00:00:00').slice(0, 10);

  if (!domain || !token) {
    return NextResponse.json({ error: 'Missing domain or token' }, { status: 400 });
  }

  const cacheKey = `${domain}_${createdMin}`;
  const cached = serverCache.get(cacheKey);
  if (!forceRefresh && cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return NextResponse.json({ orders: cached.orders, source: 'cache' }, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  const gqlUrl = `https://${domain}/admin/api/2024-01/graphql.json`;
  const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

  try {
    let allOrders = [];
    let cursor = null;
    let hasNextPage = true;
    const startTime = Date.now();

    while (hasNextPage) {
      if (Date.now() - startTime > 22000) {
        console.log('[ORDERS] Timeout preventiv după', allOrders.length, 'comenzi');
        break;
      }

      const res = await fetch(gqlUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: buildQuery(cursor, createdMin) }),
        cache: 'no-store',
      });

      if (!res.ok) {
        return NextResponse.json({ error: `GraphQL HTTP ${res.status}` }, { status: res.status });
      }

      const json = await res.json();
      if (json.errors?.length) {
        return NextResponse.json({ error: json.errors[0]?.message }, { status: 400 });
      }

      const ordersData = json.data?.orders;
      if (!ordersData) break;

      allOrders = allOrders.concat(ordersData.edges.map(e => toRestOrder(e.node)));
      hasNextPage = ordersData.pageInfo.hasNextPage;
      cursor = ordersData.pageInfo.endCursor;
    }

    serverCache.set(cacheKey, { orders: allOrders, ts: Date.now() });
    for (const [k, v] of serverCache.entries()) {
      if (Date.now() - v.ts > 5 * 60 * 1000) serverCache.delete(k);
    }

    return NextResponse.json({ orders: allOrders, source: 'graphql', count: allOrders.length }, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
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

