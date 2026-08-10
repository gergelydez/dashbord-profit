import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { getShopConfig, getDefaultShopKey } from '@/lib/shops';
import { getAccessToken } from '@/lib/shopify/ccg-token';
import { db } from '@/lib/db';
import { ensureInvoice } from '@/lib/services/invoice-service';
import { buildInvoiceUrl } from '@/lib/security/tokens';

/**
 * POST — Generează o factură SmartBill pentru o comandă telefonică/WhatsApp
 * creată direct din pagina GLS (fără comandă Shopify reală).
 *
 * Creează o comandă "sintetică" în baza noastră de date (shopifyId de forma
 * manual-<timestamp>, fără corespondent real în Shopify) și o rulează prin
 * exact același pipeline de facturare (ensureInvoice) folosit de xConnector.
 * Scrierea înapoi în Shopify e deja tratată ca non-fatală în ensureInvoice,
 * deci lipsa unei comenzi Shopify reale nu blochează generarea facturii.
 */
export async function POST(request) {
  try {
    const {
      shop: shopKey = getDefaultShopKey(),
      reference = '',
      client = {},
      address = {},
      lineItems = [],
      isPaid = false,
      withCollection,
      useStock,
      paymentType,
    } = await request.json();

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return NextResponse.json({ error: 'Selectează un produs pentru a putea factura.' }, { status: 400 });
    }
    if (!client.name) {
      return NextResponse.json({ error: 'Nume client lipsă.' }, { status: 400 });
    }

    let shopCfg;
    try { shopCfg = getShopConfig(shopKey); }
    catch { return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 }); }

    const token = await getAccessToken(shopCfg);
    const currency = shopKey === 'hu' ? 'HUF' : 'RON';

    let shop = await db.shop.findFirst({ where: { domain: shopCfg.domain } });
    if (!shop) {
      shop = await db.shop.create({ data: { domain: shopCfg.domain, accessToken: token, active: true } });
    }

    const totalPrice = lineItems.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseFloat(i.qty) || 0), 0);

    const order = await db.order.create({
      data: {
        shopId:           shop.id,
        shopifyId:        `manual-${Date.now()}`,
        shopifyName:      reference || `Manual-${Date.now()}`,
        financialStatus:  isPaid ? 'paid' : 'pending',
        totalPrice,
        currency,
        isPaid,
        paymentGateway:   'manual',
        customerName:     client.name || '',
        customerEmail:    client.email || '',
        customerPhone:    client.phone || '',
        shippingAddress1: address.address1 || '',
        shippingCity:     address.city || '',
        shippingProvince: address.county || '',
        shippingZip:      address.zip || '',
        lineItems:        lineItems.map(i => ({ name: i.name, sku: i.sku || '', qty: parseFloat(i.qty) || 0, price: parseFloat(i.price) || 0 })),
        shopifyCreatedAt: new Date(),
      },
    });

    const result = await ensureInvoice(order, token, shopCfg.domain, withCollection, useStock, undefined, paymentType);

    const smartbillUrl = result.invoice.invoiceUrl || null;
    const downloadUrl = buildInvoiceUrl(result.invoice.id) || smartbillUrl || '';

    return NextResponse.json({
      ok:           true,
      invoiceId:    result.invoice.id,
      series:       result.invoice.series,
      number:       result.invoice.number,
      status:       result.invoice.status,
      downloadUrl,
      smartbillUrl,
      collected:    result.collected,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
