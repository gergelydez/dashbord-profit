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
  getSmartBillViewUrl,
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
  useStock?: boolean,
  lineItemsOverride?: Array<{ name: string; sku: string; quantity: number; price: number }>,
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

  // Use lineItemsOverride from modal (contains SKUs entered by user)
  // Fall back to DB order line items if no override provided
  const lineItems = lineItemsOverride && lineItemsOverride.length > 0
    ? lineItemsOverride
    : (order.lineItems as Array<{ name: string; sku: string; qty: number; price: number; warehouse?: string }>).map(
        (i) => ({ name: i.name, sku: i.sku, quantity: i.qty, price: i.price, warehouse: i.warehouse }),
      );

  log.info('Creating SmartBill invoice', { items: lineItems.length });

  // ── Call SmartBill ─────────────────────────────────────────────────────────
  const result = await createInvoice(cfg, {
    orderName:        order.shopifyName,
    currency:         order.currency,
    isPaid:           order.isPaid,
    totalPrice:       Number(order.totalPrice),
    useStockOverride: useStock,
    withCollection:   withCollection, // embed payment in invoice body
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

  // ── Create Invoice row — robust against all duplicate scenarios ──────────────
  // Delete any stale invoices for this order with a DIFFERENT series+number
  // (happens when user deletes from SmartBill and gets a new number)
  await db.invoice.deleteMany({
    where: {
      orderId: order.id,
      shopId:  order.shopId,
      NOT: { series: result.series, number: result.number },
    },
  });

  // Try to create; if duplicate (same series+number), find and update existing
  let invoice;
  try {
    invoice = await db.invoice.create({
      data: {
        orderId:    order.id,
        shopId:     order.shopId,
        series:     result.series,
        number:     result.number,
        invoiceUrl: result.invoiceUrl,
        status:     'CREATED',
      },
    });
  } catch {
    // Already exists (same series+number) — find and update it
    const existing2 = await db.invoice.findFirst({
      where: { shopId: order.shopId, series: result.series, number: result.number },
    });
    if (existing2) {
      invoice = await db.invoice.update({
        where: { id: existing2.id },
        data:  { orderId: order.id, invoiceUrl: result.invoiceUrl, status: 'CREATED' },
      });
    } else {
      throw new Error(`Nu s-a putut salva factura ${result.series}${result.number} în baza de date.`);
    }
  }

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

  // ── Collect via separate POST /payment (works without payment series) ────────
  let collected = false;
  const shouldCollect = withCollection === true || (withCollection === undefined && order.isPaid);
  if (shouldCollect && Number(order.totalPrice) > 0) {
    // paymentType from modal selector, fallback based on order payment status
    const resolvedPaymentType = paymentType || (order.isPaid ? 'Card' : 'Ramburs');
    const collectResult = await collectInvoice(
      cfg, result.series, result.number,
      Number(order.totalPrice), order.customerName,
      order.currency,
      resolvedPaymentType,
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
    if (!collectResult.ok) {
      // Throw so user sees the error — invoice was created but collection failed
      throw new Error(`Factura ${result.series}${result.number} a fost creată, dar încasarea a eșuat: ${collectResult.error || 'eroare necunoscută'}. Poți face încasarea manual din SmartBill.`);
    }
  }

  // ── Build signed URL for this invoice ─────────────────────────────────────
  // Use SmartBill cloud viewer URL (works without auth in browser)
  // Format: https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=...&series=...&number=...
  const smartbillViewUrl = getSmartBillViewUrl(cfg, result.series, result.number);
  const invoiceUrl = buildInvoiceUrl(invoice.id);

  // Save smartbill viewer URL in invoice record
  await db.invoice.update({
    where: { id: invoice.id },
    data:  { invoiceUrl: smartbillViewUrl },
  });

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
