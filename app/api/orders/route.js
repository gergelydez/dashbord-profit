import { NextResponse } from 'next/server';

const buildQuery = (cursor, createdAtMin) => `{
  orders(
    first: 250
    ${cursor ? `after: "${cursor}"` : ''}
    query: "created_at:>=${createdAtMin} status:any"
    sortKey: CREATED_AT
    reverse: true
  ) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id name createdAt cancelledAt processedAt
        displayFinancialStatus displayFulfillmentStatus
        tags email
        paymentGatewayNames
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { name city province address1 address2 }
        billingAddress  { name city province address1 address2 }
        lineItems(first: 20) {
          edges {
            node {
              name title quantity
              variant { sku price id }
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
        }
        fulfillments {
          updatedAt createdAt
          trackingInfo { number company }
          displayStatus
        }
        customAttributes { key value }
        customerJourneySummary {
          lastVisit {
            source
            referrerUrl
            landingPage
            utmParameters { source medium campaign }
          }
        }
      }
    }
  }
}`;

const mapFinancial = (s) => ({
  'PAID':'paid','PENDING':'pending','REFUNDED':'refunded','VOIDED':'voided',
  'PARTIALLY_PAID':'partially_paid','PARTIALLY_REFUNDED':'partially_refunded','AUTHORIZED':'authorized',
}[s] || (s||'').toLowerCase());

const mapFulfillment = (s) => ({
  'FULFILLED':'fulfilled','UNFULFILLED':null,'PARTIALLY_FULFILLED':'partial',
  'IN_TRANSIT':'in_transit','OUT_FOR_DELIVERY':'out_for_delivery','DELIVERED':'delivered',
  'ATTEMPTED_DELIVERY':'attempted_delivery','FAILURE':'failure',
}[s] !== undefined ? {'FULFILLED':'fulfilled','UNFULFILLED':null,'PARTIALLY_FULFILLED':'partial','IN_TRANSIT':'in_transit','OUT_FOR_DELIVERY':'out_for_delivery','DELIVERED':'delivered','ATTEMPTED_DELIVERY':'attempted_delivery','FAILURE':'failure'}[s] : (s||'').toLowerCase());

function toRestOrder(node) {
  const fulfillments = (node.fulfillments || []).map(f => {
    const ti = (f.trackingInfo || [])[0] || {};
    const ssMap = {
      // ── LIVRAT ──
      'DELIVERED':          'delivered',
      'DELIVERED_TO_PICKUP_POINT': 'delivered',

      // ── ÎN TRANZIT ──
      'IN_TRANSIT':         'in_transit',
      'CONFIRMED':          'in_transit',   // colet preluat de curier
      'FULFILLED':          'in_transit',   // AWB creat / predat curier
      'LABEL_PRINTED':      'label_printed',// AWB printat, nepredat încă

      // ── ÎN LIVRARE ──
      'OUT_FOR_DELIVERY':   'out_for_delivery',
      'WITH_COURIER':       'out_for_delivery', // la curier local
      'AT_PICKUP_POINT':    'out_for_delivery',

      // ── TENTATIVĂ EȘUATĂ ──
      'ATTEMPTED_DELIVERY': 'failed_attempt',
      'FAILED_ATTEMPT':     'failed_attempt',
      'NOT_DELIVERED':      'failed_attempt',
      'DELIVERY_EXCEPTION': 'failed_attempt',

      // ── RETUR ──
      'FAILURE':            'failure',
      'FAILED_DELIVERY':    'failure',
      'REFUSED':            'failure',
      'RETURNED':           'returned',
      'RETURN_IN_PROGRESS': 'return_in_progress',
      'RETURN_TO_SENDER':   'return_in_progress',
      'CANCELED':           '', // ignorat — comanda anulată se detectează din cancelled_at
    };
    const ds = (f.displayStatus||'').toUpperCase();
    const rawStatus = f.displayStatus || '';
    // CANCELED pe fulfillment = comanda anulată → null ca să nu suprascrie cancelled_at
    const mappedStatus = ds === 'CANCELED' ? null : (ssMap[ds] || ds.toLowerCase());
    // Log TOATE statusurile pentru debugging
    if (ds) console.log('[FULFILLMENT STATUS]', 
      'order:', node.name,
      '| displayStatus:', rawStatus,
      '| mapped:', mappedStatus,
      '| AWB:', ti.number || '-',
      '| courier:', ti.company || '-'
    );
    if (ds && !ssMap[ds]) console.log('[STATUS NECUNOSCUT - NEADAUGAT IN MAP]', ds, 'order:', node.name);
    return {
      updated_at: f.updatedAt, created_at: f.createdAt,
      tracking_number: ti.number || '', tracking_company: ti.company || '',
      shipment_status: mappedStatus || null,
    };
  });

  const lineItems = (node.lineItems?.edges || []).map(e => ({
    name: e.node.name || e.node.title || '',
    title: e.node.title || '',
    quantity: e.node.quantity || 1,
    price: e.node.variant?.price || e.node.originalUnitPriceSet?.shopMoney?.amount || '0',
    sku: e.node.variant?.sku || '',
    variant_id: e.node.variant?.id?.replace(/[^0-9]/g,'') || '',
  }));

  // paymentGatewayNames = array cu toate gateway-urile folosite pe comandă
  const gateways = node.paymentGatewayNames || [];
  const payment_gateway = gateways[0] || '';

  // Attribution din customerJourneySummary
  const journey     = node.customerJourneySummary?.lastVisit;
  const utmSource   = journey?.utmParameters?.source || journey?.source || '';
  const utmMedium   = journey?.utmParameters?.medium || '';
  const utmCampaign = journey?.utmParameters?.campaign || '';
  const referrerUrl = journey?.referrerUrl || '';
  const landingPage = journey?.landingPage || '';

  const addr  = node.shippingAddress || node.billingAddress || {};
  const baddr = node.billingAddress  || {};

  return {
    id: node.id.replace(/[^0-9]/g,''),
    name: node.name,
    financial_status: mapFinancial(node.displayFinancialStatus),
    fulfillment_status: mapFulfillment(node.displayFulfillmentStatus),
    payment_gateway,
    cancelled_at: node.cancelledAt || null,
    created_at: node.createdAt,
    processed_at: node.processedAt || '',
    total_price: node.totalPriceSet?.shopMoney?.amount || '0',
    currency: node.totalPriceSet?.shopMoney?.currencyCode || 'RON',
    email: node.email || '',
    tags: (node.tags || []).join(', '),
    note_attributes: (node.customAttributes || []).map(a => ({ name: a.key, value: a.value })),
    utmSource, utmMedium, utmCampaign, referrerUrl, landingPage,
    shipping_address: { name:addr.name||'', city:addr.city||'', province:addr.province||'', address1:addr.address1||'', address2:addr.address2||'' },
    billing_address:  { name:baddr.name||'', city:baddr.city||'', province:baddr.province||'', address1:baddr.address1||'', address2:baddr.address2||'' },
    fulfillments,
    line_items: lineItems,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get('force') === '1';
  const domain     = searchParams.get('domain');
  const token      = searchParams.get('token');
  const createdMin = (searchParams.get('created_at_min') || '2020-01-01T00:00:00').slice(0,10);

  if (!domain || !token) {
    return NextResponse.json({ error: 'Missing domain or token' }, { status: 400 });
  }

  const gqlUrl = `https://${domain}/admin/api/2024-01/graphql.json`;
  const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

  // Cache key bazat pe domain + perioadă
  const cacheKey = `${domain}_${createdMin}`;
  const cached = serverCache.get(cacheKey);
  if (!forceRefresh && cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return NextResponse.json({ orders: cached.orders, source: 'cache' }, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    let allOrders = [];
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const res = await fetch(gqlUrl, {
        method: 'POST', headers,
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
      cursor      = ordersData.pageInfo.endCursor;
    }

    const processed = allOrders; // deja procesate în toRestOrder
    // Salvăm în cache
    serverCache.set(cacheKey, { orders: processed, ts: Date.now() });
    // Curățăm cache-urile vechi (>5 min)
    for (const [k, v] of serverCache.entries()) {
      if (Date.now() - v.ts > 5 * 60 * 1000) serverCache.delete(k);
    }

    return NextResponse.json({ orders: processed, source: 'graphql' }, {
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
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' },
  });
}

