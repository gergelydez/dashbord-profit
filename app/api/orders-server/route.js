/**
 * app/api/orders-server/route.js
 *
 * Citeste comenzile DIN DB (salvate prin webhooks) — exact ca XConnector.
 * Asta evita restrictia Shopify "Customer object" PII de pe planuri lower.
 * DB-ul are toate datele: customerName, phone, address, totalPrice etc.
 * salvate de webhook-ul orders/create + orders/updated.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getShopConfig, SHOP_CONFIGS } from '@/lib/shops';

export const dynamic = 'force-dynamic';

/* ── Map DB Order → formatul așteptat de page.js (dashboard) ── */
function mapDbOrder(o) {
  // Determina statusul de tracking/livrare din fulfillmentStatus + rawPayload
  let ts = 'pending';
  let trackingNo = '';
  let trackingCompany = '';
  let fulfilledAt = '';
  let courier = 'unknown';

  // Incearca sa extraga date de tracking din rawPayload (webhookul contine fulfillments)
  try {
    const raw = o.rawPayload;
    const fulfillments = raw?.fulfillments || [];
    if (fulfillments.length > 0) {
      const deliveredF = fulfillments.find(f => (f.shipment_status || '').toLowerCase() === 'delivered');
      const f = deliveredF || fulfillments[fulfillments.length - 1];
      fulfilledAt = f.updated_at || f.created_at || '';
      trackingNo = f.tracking_number || '';
      trackingCompany = (f.tracking_company || '').toLowerCase();

      const ss = (f.shipment_status || '').toLowerCase();
      if (!ss || ss === 'null') {
        if (o.fulfillmentStatus === 'fulfilled') {
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

      courier = trackingCompany.includes('sameday') ? 'sameday'
        : trackingCompany.includes('gls') || trackingCompany.includes('mygls') ? 'gls'
        : trackingCompany.includes('fan') ? 'fan'
        : trackingCompany.includes('cargus') ? 'cargus'
        : trackingCompany.includes('dpd') ? 'dpd'
        : trackingCompany ? 'other' : 'unknown';
    } else if (o.fulfillmentStatus === 'fulfilled') {
      ts = 'livrat'; // no fulfillment details but marked fulfilled
    }
  } catch {}

  if (o.status === 'CANCELLED') ts = 'anulat';

  // Invoice info din DB (relatii)
  const invoice = o.invoices?.[0] || null;
  const shipment = o.shipments?.[0] || null;
  const hasInvoice = !!(invoice);
  const invoiceUrl = invoice ? `/api/connector/invoice?id=${invoice.id}` : '';

  // Note attributes din rawPayload (pentru invoice URL din xConnector)
  let noteInvoiceUrl = '';
  let noteInvoiceShort = '';
  let noteInvoiceNumber = '';
  try {
    const notes = o.rawPayload?.note_attributes || [];
    const invAttr  = notes.find(a => (a.name || '').toLowerCase().includes('invoice-url') && !(a.name || '').toLowerCase().includes('short'));
    const shortAttr = notes.find(a => (a.name || '').toLowerCase().includes('invoice-short-url'));
    noteInvoiceUrl   = invAttr?.value || '';
    noteInvoiceShort = shortAttr?.value || '';
    const m = noteInvoiceUrl.match(/[?&]n=(\d+)/);
    noteInvoiceNumber = m ? m[1] : '';
  } catch {}

  const finalInvoiceUrl   = invoiceUrl || noteInvoiceUrl;
  const finalInvoiceShort = noteInvoiceShort;
  const finalHasInvoice   = hasInvoice || !!(noteInvoiceUrl);
  const invoiceNumber     = invoice ? `${invoice.series}${invoice.number}` : noteInvoiceNumber;

  // Line items din DB (JSON)
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];
  const prods = items.map(i => i.name || '').filter(Boolean).join(' + ');

  // Tracking din DB shipment (dacă există)
  if (shipment && !trackingNo) {
    trackingNo = shipment.trackingNumber || '';
    courier = (shipment.courier || '').toLowerCase();
    if (trackingNo) ts = 'incurs'; // are AWB = în tranzit (minim)
  }

  const gateway = o.paymentGateway || '';
  const ONLINE_GW = ['shopify_payments', 'stripe', 'paypal'];
  // isPaid vine direct din DB (setat de webhook)

  return {
    id: o.shopifyId,
    name: o.shopifyName,
    fin: (o.financialStatus || '').toLowerCase(),
    ts,
    trackingNo,
    client: o.customerName || '',
    oras: o.shippingCity || '',
    total: Number(o.totalPrice) || 0,
    prods,
    prodShort: prods.length > 45 ? prods.slice(0, 45) + '…' : prods,
    createdAt: o.shopifyCreatedAt ? o.shopifyCreatedAt.toISOString() : o.createdAt.toISOString(),
    fulfilledAt,
    courier,
    trackingCompany,
    invoiceNumber,
    hasInvoice: finalHasInvoice,
    invoiceUrl: finalInvoiceUrl,
    invoiceShort: finalInvoiceShort,
    gateway,
    paidAt: '',
    currency: o.currency || 'HUF',
    address: [o.shippingAddress1, o.shippingAddress2].filter(Boolean).join(', '),
    county: o.shippingProvince || '',
    zip: o.shippingZip || '',
    phone: o.customerPhone || '',
    clientEmail: o.customerEmail || '',
    utmSource: '', utmMedium: '', utmCampaign: '', referrerUrl: '',
    items: items.map(i => ({
      name: i.name || 'Produs',
      sku: i.sku || '',
      qty: i.qty || i.quantity || 1,
      price: Number(i.price) || 0,
      variantId: i.variantId || '',
    })),
    addrIssues: [],
    // Câmpuri extra pentru compatibilitate cu xConnector sync
    _dbId: o.id,
    _dbStatus: o.status,
  };
}

/* ── GET: fetch orders din DB pentru shop-ul dat ── */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shopKey    = searchParams.get('shop') || 'ro';
  const createdMin = (searchParams.get('created_at_min') || '').slice(0, 10)
    || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // Gaseste shopul in DB dupa domain
  let shopCfg;
  try {
    shopCfg = getShopConfig(shopKey);
  } catch (e) {
    return NextResponse.json({
      error: `Shop "${shopKey}" not configured. Adaugă SHOPIFY_DOMAIN_${shopKey.toUpperCase()} și SHOPIFY_ACCESS_TOKEN_${shopKey.toUpperCase()} în env vars.`
    }, { status: 400 });
  }

  // Gaseste Shop row in DB
  const shop = await db.shop.findFirst({ where: { domain: shopCfg.domain } });
  if (!shop) {
    // Shop-ul nu are inca date in DB — inseamna ca webhookurile nu au ajuns inca
    return NextResponse.json({
      orders: [],
      count: 0,
      shop: shopKey,
      currency: shopKey === 'hu' ? 'HUF' : 'RON',
      warning: 'Shop-ul nu are date în DB. Verifică că webhookurile Shopify sunt configurate pentru acest magazin.',
    });
  }

  const since = new Date(createdMin + 'T00:00:00Z');

  try {
    const dbOrders = await db.order.findMany({
      where: {
        shopId: shop.id,
        shopifyCreatedAt: { gte: since },
      },
      include: {
        invoices:  { take: 1, orderBy: { createdAt: 'desc' } },
        shipments: { take: 1, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { shopifyCreatedAt: 'desc' },
    });

    const orders = dbOrders.map(mapDbOrder);

    return NextResponse.json({
      orders,
      count: orders.length,
      shop: shopKey,
      currency: orders[0]?.currency || (shopKey === 'hu' ? 'HUF' : 'RON'),
      source: 'db',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/* ── POST: lista shopurilor configurate server-side (pentru auto-detectare) ── */
export async function POST() {
  const configured = SHOP_CONFIGS.map(s => ({
    key: s.key,
    label: s.label,
    flag: s.flag,
    hasServerConfig: true,
  }));
  return NextResponse.json({ shops: configured });
}