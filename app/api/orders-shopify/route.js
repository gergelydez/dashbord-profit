/**
 * app/api/orders-shopify/route.js
 * 
 * Fetch comenzi direct din Shopify API folosind credențialele din env vars (Vercel).
 * Folosit pentru RO și orice shop cu credențiale server-side dar fără DB webhooks.
 */
import { NextResponse } from 'next/server';
import { SHOP_CONFIGS } from '@/lib/shops';

export const dynamic = 'force-dynamic';

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
        id name createdAt cancelledAt processedAt phone
        displayFinancialStatus displayFulfillmentStatus
        paymentGatewayNames
        totalPriceSet { shopMoney { amount currencyCode } }
        presentmentCurrencyCode
        shippingAddress { name address1 address2 city province zip phone }
        billingAddress  { name address1 address2 city province zip phone }
        lineItems(first: 10) {
          edges { node { name quantity originalUnitPriceSet { shopMoney { amount } } variant { sku } } }
        }
        fulfillments {
          updatedAt createdAt
          trackingInfo { number company }
          displayStatus
        }
        customAttributes { key value }
        note
        noteAttributes { name value }
      }
    }
  }
}`;

const mapFinancial = s => ({ 'PAID':'paid','PENDING':'pending','REFUNDED':'refunded','VOIDED':'voided','PARTIALLY_PAID':'partially_paid','PARTIALLY_REFUNDED':'partially_refunded','AUTHORIZED':'authorized' }[s] || (s||'').toLowerCase());

function toRestOrder(node) {
  const addr = node.shippingAddress || node.billingAddress || {};
  const total = node.totalPriceSet?.shopMoney?.amount || '0';
  const currency = node.presentmentCurrencyCode || node.totalPriceSet?.shopMoney?.currencyCode || 'RON';
  const fulfillments = (node.fulfillments || []).map(f => ({
    updated_at: f.updatedAt, created_at: f.createdAt,
    tracking_number: f.trackingInfo?.[0]?.number || '',
    tracking_company: f.trackingInfo?.[0]?.company || '',
    shipment_status: (() => {
      const s = (f.displayStatus || '').toUpperCase();
      if (s === 'DELIVERED') return 'delivered';
      if (s === 'OUT_FOR_DELIVERY') return 'out_for_delivery';
      if (['IN_TRANSIT','CONFIRMED'].includes(s)) return 'in_transit';
      if (['FAILURE','FAILED_ATTEMPT'].includes(s)) return 'failure';
      if (s === 'LABEL_PRINTED') return 'label_printed';
      if (s === 'ATTEMPTED_DELIVERY') return 'failed_attempt';
      return (f.displayStatus || '').toLowerCase();
    })(),
  }));
  return {
    id: parseInt(node.id.replace('gid://shopify/Order/', '')),
    name: node.name,
    created_at: node.createdAt,
    cancelled_at: node.cancelledAt || null,
    processed_at: node.processedAt,
    financial_status: mapFinancial(node.displayFinancialStatus),
    fulfillment_status: node.displayFulfillmentStatus === 'FULFILLED' ? 'fulfilled' : null,
    total_price: total,
    presentment_currency: currency,
    currency,
    phone: node.phone || addr.phone || '',
    email: node.email || '',
    payment_gateway: (node.paymentGatewayNames || [])[0] || '',
    shipping_address: addr.name ? { name: addr.name, address1: addr.address1, address2: addr.address2, city: addr.city, province: addr.province, zip: addr.zip, phone: addr.phone } : null,
    billing_address: null,
    line_items: (node.lineItems?.edges || []).map(e => ({
      name: e.node.name, quantity: e.node.quantity,
      price: e.node.originalUnitPriceSet?.shopMoney?.amount || '0',
      sku: e.node.variant?.sku || '',
    })),
    fulfillments,
    note_attributes: node.noteAttributes || [],
  };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const shopKey = searchParams.get('shop') || 'ro';
    const createdAtMin = searchParams.get('created_at_min') || new Date(Date.now() - 365*24*60*60*1000).toISOString().slice(0,10);

    const shopConfig = SHOP_CONFIGS.find(s => s.key === shopKey);
    if (!shopConfig) return NextResponse.json({ error: `Shop '${shopKey}' not configured in env vars` }, { status: 400 });

    const { domain, accessToken } = shopConfig;
    const gqlUrl = `https://${domain}/admin/api/2024-01/graphql.json`;
    const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };

    let allOrders = [], cursor = null, hasNext = true, page = 0;
    while (hasNext && page < 20) {
      page++;
      const res = await fetch(gqlUrl, { method: 'POST', headers, body: JSON.stringify({ query: buildQuery(cursor, createdAtMin) }), cache: 'no-store' });
      if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}`);
      const json = await res.json();
      if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');
      const ordersConn = json.data?.orders;
      if (!ordersConn) break;
      allOrders.push(...ordersConn.edges.map(e => toRestOrder(e.node)));
      hasNext = ordersConn.pageInfo.hasNextPage;
      cursor = ordersConn.pageInfo.endCursor;
    }

    return NextResponse.json({ orders: allOrders, count: allOrders.length, shop: shopKey });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST — returnează lista de shop-uri configurate (pentru getServerConfiguredShops)
export async function POST() {
  const shops = SHOP_CONFIGS.map(s => ({ key: s.key, label: s.label }));
  return NextResponse.json({ shops });
}

