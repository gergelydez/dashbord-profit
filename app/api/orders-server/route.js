/**
 * app/api/orders-server/route.js
 * Server-side orders fetch — uses shop config from env vars (no manual token needed).
 * Used by the main dashboard (app/page.js) for shops configured via env (e.g. HU).
 * Compatible with the same GraphQL logic as /api/orders but pulls credentials server-side.
 */
import { NextResponse } from 'next/server';
import { getShopConfig, SHOP_CONFIGS } from '@/lib/shops';

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
        id name createdAt cancelledAt processedAt phone email
        displayFinancialStatus displayFulfillmentStatus
        paymentGatewayNames
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { name address1 address2 city province zip phone }
        billingAddress { name address1 address2 city province zip phone }
        lineItems(first: 10) {
          edges {
            node {
              name quantity
              originalUnitPriceSet { shopMoney { amount } }
              variant { sku }
            }
          }
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
      'DELIVERED': 'delivered', 'DELIVERED_TO_PICKUP_POINT': 'delivered',
      'IN_TRANSIT': 'in_transit', 'CONFIRMED': 'in_transit', 'FULFILLED': 'in_transit',
      'LABEL_PRINTED': 'label_printed', 'OUT_FOR_DELIVERY': 'out_for_delivery',
      'WITH_COURIER': 'out_for_delivery', 'AT_PICKUP_POINT': 'out_for_delivery',
      'ATTEMPTED_DELIVERY': 'failed_attempt', 'FAILED_ATTEMPT': 'failed_attempt',
      'NOT_DELIVERED': 'failed_attempt', 'DELIVERY_EXCEPTION': 'failed_attempt',
      'FAILURE': 'failure', 'FAILED_DELIVERY': 'failure', 'REFUSED': 'failure',
      'RETURNED': 'returned', 'RETURN_IN_PROGRESS': 'return_in_progress',
      'RETURN_TO_SENDER': 'return_in_progress', 'CANCELED': null,
    };
    const ds = (f.displayStatus || '').toUpperCase();
    const mappedStatus = ds === 'CANCELED' ? null : (ssMap.hasOwnProperty(ds) ? ssMap[ds] : (ds.toLowerCase() || null));
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
    price: parseFloat(e.node.originalUnitPriceSet?.shopMoney?.amount || '0'),
    sku: e.node.variant?.sku || '',
  }));

  const addr  = node.shippingAddress || node.billingAddress || {};
  const baddr = node.billingAddress || {};
  const gateways = node.paymentGatewayNames || [];

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
    email: node.email || '',
    phone: node.phone || addr.phone || '',
    shipping_address: { name: addr.name||'', address1: addr.address1||'', address2: addr.address2||'', city: addr.city||'', province: addr.province||'', zip: addr.zip||'', phone: addr.phone||'' },
    billing_address:  { name: baddr.name||'', address1: baddr.address1||'', address2: baddr.address2||'', city: baddr.city||'', province: baddr.province||'', zip: baddr.zip||'' },
    fulfillments,
    line_items: lineItems,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shopKey     = searchParams.get('shop') || 'ro';
  const createdMin  = (searchParams.get('created_at_min') || '2020-01-01T00:00:00').slice(0, 10);
  const forceRefresh = searchParams.get('force') === '1';

  // Get shop config from env vars (server-side — no credentials exposed to client)
  let shopCfg;
  try {
    shopCfg = getShopConfig(shopKey);
  } catch (e) {
    return NextResponse.json({ error: `Shop "${shopKey}" not configured. Add SHOPIFY_DOMAIN_${shopKey.toUpperCase()} and SHOPIFY_ACCESS_TOKEN_${shopKey.toUpperCase()} to env vars.` }, { status: 400 });
  }

  const { domain, accessToken } = shopCfg;
  const cacheKey = `${shopKey}_${createdMin}`;
  const cached = serverCache.get(cacheKey);

  if (!forceRefresh && cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return NextResponse.json({ orders: cached.orders, source: 'cache', shop: shopKey });
  }

  const gqlUrl = `https://${domain}/admin/api/2024-01/graphql.json`;
  const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };

  try {
    let allOrders = [];
    let cursor = null;
    let hasNextPage = true;
    const startTime = Date.now();

    while (hasNextPage) {
      if (Date.now() - startTime > 22000) break;

      const res = await fetch(gqlUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: buildQuery(cursor, createdMin) }),
        cache: 'no-store',
      });

      if (!res.ok) {
        return NextResponse.json({ error: `Shopify GraphQL HTTP ${res.status}` }, { status: res.status });
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

    return NextResponse.json({ orders: allOrders, source: 'graphql', count: allOrders.length, shop: shopKey, currency: allOrders[0]?.currency || 'RON' });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** Returns which shops are configured server-side (for auto-detection in dashboard) */
export async function POST() {
  const configured = SHOP_CONFIGS.map(s => ({
    key: s.key,
    label: s.label,
    flag: s.flag,
    hasServerConfig: true,
  }));
  return NextResponse.json({ shops: configured });
}

