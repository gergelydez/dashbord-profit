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
      'DELIVERED':'delivered',
      'IN_TRANSIT':'in_transit',
      'OUT_FOR_DELIVERY':'out_for_delivery',
      'ATTEMPTED_DELIVERY':'attempted_delivery',
      'FAILURE':'failure',
      'FAILED_ATTEMPT':'failed_attempt',
      'RETURNED':'returned',
      'RETURN_IN_PROGRESS':'return_in_progress',
      'DELIVERY_EXCEPTION':'failure',
      'FAILED_DELIVERY':'failed_delivery',
      'REFUSED':'failure',
      'LABEL_PRINTED':'label_printed',
      'CONFIRMED':'confirmed',
      'NOT_DELIVERED':'failure',
    };
    const ds = (f.displayStatus||'').toUpperCase();
    const mappedStatus = ssMap[ds] || ds.toLowerCase();
    // Log pentru statusuri necunoscute - ajută la debugging
    if (ds && !ssMap[ds]) console.log('[GLS STATUS UNKNOWN]', ds, 'order:', node.name);
    return {
      updated_at: f.updatedAt, created_at: f.createdAt,
      tracking_number: ti.number || '', tracking_company: ti.company || '',
      shipment_status: mappedStatus,
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
  const domain     = searchParams.get('domain');
  const token      = searchParams.get('token');
  const createdMin = (searchParams.get('created_at_min') || '2020-01-01T00:00:00').slice(0,10);

  if (!domain || !token) {
    return NextResponse.json({ error: 'Missing domain or token' }, { status: 400 });
  }

  const gqlUrl = `https://${domain}/admin/api/2024-01/graphql.json`;
  const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

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

    return NextResponse.json({ orders: allOrders }, {
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

