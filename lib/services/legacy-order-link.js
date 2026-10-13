/**
 * lib/services/legacy-order-link.js
 *
 * `app/api/smartbill-invoice` și `app/api/smartbill/search` sunt pipeline-ul
 * vechi de facturare (credențiale SmartBill introduse de utilizator în pagina
 * Comenzi, nu din variabile de mediu) și nu scriau NICIODATĂ în baza noastră
 * Postgres — doar creau factura în SmartBill și încercau o notare în Shopify
 * note_attributes. Pentru magazinele non-RO, acea notare pica mereu silențios
 * fiindcă domain/token trimise de client din localStorage erau goale (glato/
 * glatohu/hu folosesc credențiale server-side CCG, nu browser), deci factura
 * devenea complet "invizibilă" pentru `hasInvoice` — deși exista real în
 * SmartBill. Acest modul rezolvă domeniul+tokenul real al magazinului
 * server-side (de încredere) și asigură rândurile Shop+Order+Invoice în DB.
 */
import { db } from '@/lib/db';
import { getShopConfig } from '@/lib/shops';
import { getAccessToken } from '@/lib/shopify/ccg-token';

// Rezolvă domeniul+tokenul Shopify real pentru magazin. Preferă config-ul
// server (CCG/token static per shopKey) — mai de încredere decât ce trimite
// clientul, care e mereu gol pentru magazinele non-RO. Cade pe fallback-ul
// trimis de client doar dacă shopKey e necunoscut (ex. "ro" fără variabilele
// de mediu SHOPIFY_DOMAIN_RO configurate, caz în care RO ține domain/token
// în localStorage browser, nu server-side).
export async function resolveShopDomainAndToken(shopKey, fallbackDomain, fallbackToken) {
  let domain = fallbackDomain || '';
  let token = fallbackToken || '';
  try {
    const cfg = getShopConfig(shopKey || '');
    domain = cfg.domain;
    token = await getAccessToken(cfg);
  } catch {
    // shop necunoscut sau neconfigurat — rămânem pe fallback-ul trimis de client
  }
  return { domain, token };
}

export async function ensureShopRow(domain, token) {
  if (!domain) return null;
  let shop = await db.shop.findFirst({ where: { domain } });
  if (!shop) {
    shop = await db.shop.create({ data: { domain, accessToken: token || '' } });
  } else if (token && shop.accessToken !== token) {
    shop = await db.shop.update({ where: { id: shop.id }, data: { accessToken: token } });
  }
  return shop;
}

// Găsește comanda existentă în DB (ingerată deja printr-un webhook) sau
// creează un rând minimal din datele trimise de client — astfel încât
// factura să se poată lega de o comandă reală, chiar dacă webhook-ul
// Shopify nu a (re)ajuns încă la noi.
export async function ensureOrderRow(shop, order) {
  if (!shop || !order?.id) return null;
  const shopifyId = String(order.id);
  let dbOrder = await db.order.findFirst({ where: { shopId: shop.id, shopifyId } });
  if (!dbOrder) {
    dbOrder = await db.order.create({
      data: {
        shopId:           shop.id,
        shopifyId,
        shopifyName:      order.name || `#${shopifyId}`,
        financialStatus:  order.isPaid ? 'paid' : 'pending',
        totalPrice:       parseFloat(order.total) || 0,
        currency:         order.currency || 'RON',
        isPaid:           !!order.isPaid,
        paymentGateway:   order.paymentType === 'Card' ? 'shopify_payments' : 'cod',
        customerName:     order.client || '',
        customerEmail:    order.clientEmail || '',
        shippingAddress1: order.address || '',
        shippingCity:     order.city || '',
        shippingProvince: order.county || '',
        shippingCountry:  order.country || 'RO',
        lineItems:        order.items || [],
      },
    });
  }
  return dbOrder;
}

// Idempotent: aceeași factură (serie+număr) nu se duplică niciodată per shop.
export async function recordInvoice({ shop, order, series, number, invoiceUrl, collected, shopifyUpdated }) {
  if (!shop || !order || !series || !number) return null;
  const numberStr = String(number);
  try {
    return await db.invoice.upsert({
      where: { shopId_series_number: { shopId: shop.id, series, number: numberStr } },
      create: {
        orderId:        order.id,
        shopId:         shop.id,
        series,
        number:         numberStr,
        invoiceUrl:     invoiceUrl || null,
        collected:      !!collected,
        status:         collected ? 'COLLECTED' : 'CREATED',
        shopifyUpdated: !!shopifyUpdated,
      },
      update: {
        invoiceUrl:     invoiceUrl || undefined,
        collected:      !!collected,
        status:         collected ? 'COLLECTED' : 'CREATED',
        shopifyUpdated: !!shopifyUpdated,
      },
    });
  } catch (e) {
    console.error('[legacy-order-link] recordInvoice failed:', e.message);
    return null;
  }
}
