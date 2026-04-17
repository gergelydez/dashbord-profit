/**
 * app/api/orders-server/route.js
 * Server-side orders fetch — uses shop config from env vars (no manual token needed).
 * Uses REST API (NOT GraphQL) to avoid Shopify "Customer object" PII restriction
 * on newer/lower-plan stores. Same approach as /api/connector/orders.
 */
import { NextResponse } from 'next/server';
import { getShopConfig, SHOP_CONFIGS } from '@/lib/shops';

const API_VERSION = '2024-01';
const serverCache = new Map();
const CACHE_TTL = 60 * 1000;

const mapFin = (s) => ({
  paid: 'paid', pending: 'pending', refunded: 'refunded', voided: 'voided',
  partially_paid: 'partially_paid', partially_refunded: 'partially_refunded',
  authorized: 'authorized',
}[s] || (s || '').toLowerCase());

function procFulfillments(fulfillments) {
  if (!fulfillments?.length) return { ts: 'pending', trackingNo: '', trackingCompany: '', fulfilledAt: '', courier: 'unknown' };

  const deliveredF = fulfillments.find(f => (f.shipment_status || '').toLowerCase() === 'delivered');
  const f = deliveredF || fulfillments[fulfillments.length - 1];
  const fulfilledAt = f.updated_at || f.created_at || '';
  const trackingNo = f.tracking_number || '';
  const trackingCompany = (f.tracking_company || '').toLowerCase();

  const ss = (f.shipment_status || '').toLowerCase();
  let ts = 'pending';
  if (!ss || ss === 'null') {
    if (f.status === 'success' || f.status === 'fulfilled') {
      const days = fulfilledAt ? (Date.now() - new Date(fulfilledAt)) / 86400000 : 999;
      ts = days > 10 ? 'livrat' : 'incurs';
    }
  } else if (ss === 'delivered') ts = 'livrat';
  else if (['failure', 'failed_attempt', 'returned', 'failed_delivery', 'return_in_progress'].includes(ss)) ts = 'retur';
  else if (ss === 'out_for_delivery') ts = 'outfor';
  else if (ss === 'label_printed') ts = 'pending';
  else if (['in_transit', 'confirmed'].includes(ss)) {
    const days = fulfilledAt ? (Date.now() - new Date(fulfilledAt)) / 86400000 : 0;
    ts = days > 10 ? 'livrat' : 'incurs';
  }

  const courier = trackingCompany.includes('sameday') ? 'sameday'
    : trackingCompany.includes('gls') || trackingCompany.includes('mygls') ? 'gls'
    : trackingCompany.includes('fan') ? 'fan'
    : trackingCompany.includes('cargus') ? 'cargus'
    : trackingCompany.includes('dpd') ? 'dpd'
    : trackingCompany ? 'other' : 'unknown';

  return { ts, trackingNo, trackingCompany: f.tracking_company || '', fulfilledAt, courier };
}

function mapOrder(o) {
  const addr = o.shipping_address || o.billing_address || {};
  const notes = o.note_attributes || [];

  const invUrlAttr   = notes.find(a => (a.name || '').toLowerCase().includes('invoice-url') && !(a.name || '').toLowerCase().includes('short'));
  const invShortAttr = notes.find(a => (a.name || '').toLowerCase().includes('invoice-short-url'));
  const invoiceUrl   = invUrlAttr?.value || '';
  const invoiceShort = invShortAttr?.value || '';
  const invNumMatch  = invoiceUrl.match(/[?&]n=(\d+)/);
  const invoiceNumber = invNumMatch ? invNumMatch[1] : '';
  const hasInvoice   = !!(invoiceUrl || invoiceShort);

  const { ts, trackingNo, trackingCompany, fulfilledAt, courier } = procFulfillments(o.fulfillments);
  const finalTs = o.cancelled_at ? 'anulat' : ts;

  const prods = (o.line_items || []).map(i => i.name || '').join(' + ');

  const addrIssues = [];
  if (!addr.name || addr.name.trim().length < 3) addrIssues.push('Nume lipsă');
  if (!addr.address1 || addr.address1.trim().length < 5) addrIssues.push('Adresă incompletă');
  if (!addr.city || addr.city.trim().length < 2) addrIssues.push('Oraș lipsă');
  const ph = (o.phone || addr.phone || '').replace(/\D/g, '');
  if (ph.length < 9) addrIssues.push('Telefon invalid');

  return {
    id: String(o.id),
    name: o.name || '',
    fin: mapFin(o.financial_status),
    ts: finalTs,
    trackingNo,
    client: addr.name || `${addr.first_name || ''} ${addr.last_name || ''}`.trim() || '',
    oras: addr.city || '',
    total: parseFloat(o.total_price) || 0,
    prods,
    prodShort: prods.length > 45 ? prods.slice(0, 45) + '…' : prods,
    createdAt: o.created_at || '',
    fulfilledAt,
    courier,
    trackingCompany,
    invoiceNumber,
    hasInvoice,
    invoiceUrl,
    invoiceShort,
    gateway: o.payment_gateway || '',
    paidAt: o.processed_at || '',
    currency: o.presentment_currency || o.currency || 'HUF',
    address: [addr.address1, addr.address2].filter(Boolean).join(', '),
    county: addr.province || '',
    zip: addr.zip || '',
    phone: o.phone || addr.phone || '',
    clientEmail: o.email || '',
    utmSource: '', utmMedium: '', utmCampaign: '', referrerUrl: '',
    items: (o.line_items || []).map(i => ({
      name: i.name || i.title || 'Produs',
      sku: i.sku || '',
      qty: i.quantity || 1,
      price: parseFloat(i.price) || 0,
      variantId: String(i.variant_id || ''),
    })),
    addrIssues,
  };
}

async function fetchAllOrders(domain, accessToken, createdMin, force) {
  const cacheKey = `rest_${domain}_${createdMin}`;
  const cached = serverCache.get(cacheKey);
  if (!force && cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return { orders: cached.orders, source: 'cache' };
  }

  let allRaw = [];
  let nextPageInfo = null;
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > 25000) break;

    const params = new URLSearchParams({ limit: '250', status: 'any' });
    if (nextPageInfo) {
      params.set('page_info', nextPageInfo);
    } else {
      params.set('created_at_min', `${createdMin}T00:00:00Z`);
      params.set('order', 'created_at desc');
    }

    const url = `https://${domain}/admin/api/${API_VERSION}/orders.json?${params}`;
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopify REST ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    allRaw = allRaw.concat(data.orders || []);

    const link = res.headers.get('Link') || '';
    const nextMatch = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    if (nextMatch) {
      nextPageInfo = nextMatch[1];
    } else {
      break;
    }
  }

  const mapped = allRaw.map(mapOrder);
  serverCache.set(cacheKey, { orders: mapped, ts: Date.now() });
  for (const [k, v] of serverCache.entries()) {
    if (Date.now() - v.ts > 5 * 60 * 1000) serverCache.delete(k);
  }

  return { orders: mapped, source: 'rest' };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shopKey    = searchParams.get('shop') || 'ro';
  const createdMin = (searchParams.get('created_at_min') || '').slice(0, 10)
    || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const force = searchParams.get('force') === '1';

  let shopCfg;
  try {
    shopCfg = getShopConfig(shopKey);
  } catch (e) {
    return NextResponse.json({
      error: `Shop "${shopKey}" not configured. Add SHOPIFY_DOMAIN_${shopKey.toUpperCase()} and SHOPIFY_ACCESS_TOKEN_${shopKey.toUpperCase()} to env vars.`
    }, { status: 400 });
  }

  try {
    const { orders, source } = await fetchAllOrders(shopCfg.domain, shopCfg.accessToken, createdMin, force);
    return NextResponse.json({
      orders,
      source,
      count: orders.length,
      shop: shopKey,
      currency: orders[0]?.currency || (shopKey === 'hu' ? 'HUF' : 'RON'),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST() {
  const configured = SHOP_CONFIGS.map(s => ({
    key: s.key,
    label: s.label,
    flag: s.flag,
    hasServerConfig: true,
  }));
  return NextResponse.json({ shops: configured });
}
