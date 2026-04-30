/**
 * lib/services/invoice-service.ts
 *
 * Orchestrates the full invoice creation flow for one order:
 *  1. Idempotency check (skip if invoice already exists for this order)
 *  2. Build SmartBill payload from Order record
 *  3. Call SmartBill API → get series + number
 *  4. Download PDF from SmartBill
 *  5. Store PDF (S3 or DB)
 *  6. Persist Invoice row in DB
 *  7. Optionally issue receipt (chitanță) if order is paid
 *  8. Write invoice URL back to Shopify order
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  createInvoice,
  collectInvoice,
  downloadInvoicePdf,
  loadSmartBillConfig,
} from '@/lib/invoicing/smartbill';
import { storePdf, isDbKey } from '@/lib/storage/s3';
import { buildInvoiceUrl } from '@/lib/security/tokens';
import { addInvoiceToOrder, addTimelineEvent } from '@/lib/shopify/fulfillment';
import type { Order, Invoice } from '@prisma/client';

export interface InvoiceServiceResult {
  invoice:        Invoice;
  invoiceUrl:     string;
  shopifyUpdated: boolean;
  collected:      boolean;
}

/**
 * Create an invoice for the given Order row.
 * Idempotent: returns existing invoice if already created.
 */
export async function ensureInvoice(
  order: Order,
  shopifyAccessToken: string,
  shopifyDomain: string,
  withCollection?: boolean,
): Promise<InvoiceServiceResult> {
  const log = logger.child({ module: 'invoice-service', orderId: order.id, orderName: order.shopifyName });

  // ── Idempotency: return if invoice already exists ──────────────────────────
  const existing = await db.invoice.findFirst({
    where: { orderId: order.id, shopId: order.shopId, status: { in: ['CREATED', 'COLLECTED'] } },
  });
  if (existing) {
    log.info('Invoice already exists — skipping creation', { invoiceId: existing.id });
    const invoiceUrl = buildInvoiceUrl(existing.id);
    return {
      invoice:        existing,
      invoiceUrl,
      shopifyUpdated: existing.shopifyUpdated,
      collected:      existing.collected,
    };
  }

  // ── Build SmartBill input ──────────────────────────────────────────────────
  const cfg = loadSmartBillConfig();
  const lineItems = (order.lineItems as Array<{ name: string; sku: string; qty: number; price: number }>).map(
    (i) => ({ name: i.name, sku: i.sku, quantity: i.qty, price: i.price }),
  );

  log.info('Creating SmartBill invoice', { items: lineItems.length });

  // ── Call SmartBill ─────────────────────────────────────────────────────────
  const result = await createInvoice(cfg, {
    orderName:  order.shopifyName,
    currency:   order.currency,
    isPaid:     order.isPaid,
    totalPrice: Number(order.totalPrice),
    client: {
      name:    order.customerName,
      email:   order.customerEmail || undefined,
      address: order.shippingAddress1,
      city:    order.shippingCity,
      county:  order.shippingProvince,
    },
    lineItems,
  });

  // ── Download PDF ───────────────────────────────────────────────────────────
  const pdfBuffer = await downloadInvoicePdf(cfg, result.series, result.number);

  // ── Create Invoice row (needed before PDF storage, to get the ID) ──────────
  const invoice = await db.invoice.create({
    data: {
      orderId:    order.id,
      shopId:     order.shopId,
      series:     result.series,
      number:     result.number,
      invoiceUrl: result.invoiceUrl,
      status:     'CREATED',
    },
  });

  // ── Store PDF ──────────────────────────────────────────────────────────────
  let pdfStorageKey: string | null = null;
  let pdfData:       Buffer | null = null;

  if (pdfBuffer) {
    const stored = await storePdf(pdfBuffer, 'invoices', invoice.id);
    pdfStorageKey = stored.key;
    if (isDbKey(stored.key)) {
      pdfData = pdfBuffer;  // store inline in DB
    }
    await db.invoice.update({
      where: { id: invoice.id },
      data:  { pdfStorageKey, pdfData: pdfData ?? undefined },
    });
  } else {
    log.warn('SmartBill PDF not available, will serve SmartBill URL as fallback');
  }

  // ── Collect (issue receipt / chitanță) if order is paid OR explicitly requested ──
  let collected = false;
  const shouldCollect = withCollection === true || (withCollection === undefined && order.isPaid);
  if (shouldCollect && Number(order.totalPrice) > 0) {
    const collectResult = await collectInvoice(
      cfg, result.series, result.number,
      Number(order.totalPrice), order.customerName,
      order.currency,
    );
    collected = collectResult.ok;
    await db.invoice.update({
      where: { id: invoice.id },
      data: {
        collected,
        ...(collectResult.series ? { collectionSeries: collectResult.series } : {}),
        ...(collectResult.number ? { collectionNumber: collectResult.number } : {}),
      },
    });
  }

  // ── Build signed URL for this invoice ─────────────────────────────────────
  const invoiceUrl = buildInvoiceUrl(invoice.id);

  // ── Write back to Shopify ──────────────────────────────────────────────────
  let shopifyUpdated = false;
  try {
    await addInvoiceToOrder(
      { domain: shopifyDomain, accessToken: shopifyAccessToken },
      order.shopifyId,
      { invoiceUrl, invoiceSeries: result.series, invoiceNumber: result.number },
    );

    await addTimelineEvent(
      { domain: shopifyDomain, accessToken: shopifyAccessToken },
      order.shopifyGid ?? `gid://shopify/Order/${order.shopifyId}`,
      `✅ Factură ${result.series}${result.number} generată. [Descarcă PDF](${invoiceUrl})`,
    );

    shopifyUpdated = true;
    await db.invoice.update({ where: { id: invoice.id }, data: { shopifyUpdated: true } });
  } catch (err) {
    // Non-fatal: Shopify update can be retried separately
    log.warn('Failed to update Shopify with invoice URL', { error: (err as Error).message });
  }

  // ── Update Order status ────────────────────────────────────────────────────
  await db.order.update({
    where: { id: order.id },
    data:  { invoiceCreated: true, status: 'INVOICE_CREATED' },
  });

  const updatedInvoice = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });

  log.info('Invoice flow complete', {
    invoiceId: invoice.id,
    series: result.series,
    number: result.number,
    collected,
    shopifyUpdated,
  });

  return { invoice: updatedInvoice, invoiceUrl, shopifyUpdated, collected };
}