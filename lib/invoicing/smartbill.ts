/**
 * lib/invoicing/smartbill.ts — SmartBill invoicing adapter
 *
 * Covers:
 *  - createInvoice()   — POST /invoice
 *  - collectInvoice()  — POST /payment  (issue receipt / chitanță)
 *  - downloadInvoicePdf() — GET /invoice/pdf
 *  - getSeries()       — GET /series?cif=...&type=f
 *
 * Docs: https://ws.smartbill.ro/SBORO/api (Basic Auth: email:token)
 */

import { logger } from '@/lib/logger';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface SmartBillConfig {
  email:          string;
  token:          string;
  cif:            string;
  series:         string;    // invoice series, e.g. "GLA"
  paymentSeries?: string;    // receipt series, optional
  taxPercentage:  number;    // 19 | 9 | 5
  useStock:       boolean;
  warehouseName?: string;
}

export function loadSmartBillConfig(): SmartBillConfig {
  return {
    email:          process.env.SMARTBILL_EMAIL          || '',
    token:          process.env.SMARTBILL_TOKEN          || '',
    cif:            process.env.SMARTBILL_CIF            || '',
    series:         process.env.SMARTBILL_SERIES         || '',
    paymentSeries:  process.env.SMARTBILL_PAYMENT_SERIES || undefined,
    taxPercentage:  parseInt(process.env.SMARTBILL_TAX_PERCENTAGE || '19', 10),
    useStock:       process.env.SMARTBILL_USE_STOCK === 'true',
    warehouseName:  process.env.SMARTBILL_WAREHOUSE      || undefined,
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvoiceLineItem {
  name:     string;
  sku?:     string;
  quantity: number;
  price:    number;  // unit price (inclusive of tax)
}

export interface CreateInvoiceInput {
  orderName:   string;   // e.g. "#1042"
  currency:    string;
  isPaid:      boolean;
  totalPrice:  number;
  client: {
    name:    string;
    email?:  string;
    address: string;
    city:    string;
    county:  string;
  };
  lineItems:   InvoiceLineItem[];
}

export interface InvoiceResult {
  series:     string;
  number:     string;
  invoiceUrl: string;   // SmartBill cloud viewer URL (no auth required)
}

export interface CollectResult {
  ok:     boolean;
  series?: string;
  number?: string;
  error?: string;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function makeAuth(email: string, token: string): string {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

async function sbFetch(
  auth: string,
  path: string,
  options: Partial<RequestInit> = {},
): Promise<Response> {
  const customHeaders = (options.headers as Record<string, string>) || {};
  // Pentru PDF requests nu adaugam Content-Type/Accept JSON
  const isPdfRequest = (customHeaders['Accept'] || '').includes('octet-stream') ||
                       (customHeaders['Accept'] || '').includes('pdf');
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization:  `Basic ${auth}`,
      ...(!isPdfRequest ? {
        'Content-Type': 'application/json',
        Accept:         'application/json',
      } : {}),
      ...customHeaders,
    },
    cache: 'no-store',
  });
}

// ─── Series discovery ─────────────────────────────────────────────────────────

export async function getSeries(cfg: SmartBillConfig): Promise<string[]> {
  const auth = makeAuth(cfg.email, cfg.token);
  const res = await sbFetch(auth, `/series?cif=${cfg.cif}&type=f`);
  if (!res.ok) return [];
  const data = await res.json();
  const list: Array<{ name?: string }> = data.list ?? data.invoiceSeries ?? [];
  return list.map((s) => s.name ?? String(s)).filter(Boolean);
}

// ─── Invoice creation ─────────────────────────────────────────────────────────

export async function createInvoice(
  cfg: SmartBillConfig,
  input: CreateInvoiceInput,
): Promise<InvoiceResult> {
  const log = logger.child({ module: 'invoicing/smartbill', order: input.orderName });

  if (!cfg.email || !cfg.token || !cfg.cif) {
    throw new Error('SmartBill credentials not configured (SMARTBILL_EMAIL / SMARTBILL_TOKEN / SMARTBILL_CIF)');
  }

  const auth  = makeAuth(cfg.email, cfg.token);
  let series  = cfg.series;

  // Auto-discover series if not configured
  if (!series) {
    const available = await getSeries(cfg);
    series = available[0] ?? '';
    if (!series) throw new Error('SmartBill: could not determine invoice series. Set SMARTBILL_SERIES.');
  }

  const issueDate = new Date().toISOString().slice(0, 10);

  // Build product list
  let products = input.lineItems
    .filter((i) => i.price > 0)
    .map((i) => buildProduct(i, input.currency, cfg));

  // Fallback: single line item for the whole order
  if (!products.length) {
    products = [
      {
        name:              `Comanda Shopify ${input.orderName}`,
        code:              '',
        isDiscount:        false,
        measuringUnitName: 'buc',
        currency:          input.currency || 'RON',
        quantity:          1,
        price:             input.totalPrice,
        isTaxIncluded:     true,
        taxName:           'Normala',
        taxPercentage:     cfg.taxPercentage,
        isService:         false,
        saveToDb:          false,
        ...(cfg.useStock && cfg.warehouseName ? { warehouseName: cfg.warehouseName } : {}),
      },
    ];
  }

  const invoiceBody = {
    companyVatCode: cfg.cif,
    client: {
      name:       input.client.name.slice(0, 100),
      vatCode:    '',
      address:    input.client.address.slice(0, 255),
      isTaxPayer: false,
      city:       input.client.city  || '',
      county:     input.client.county || '',
      country:    'Romania',
      email:      input.client.email || '',
      saveToDb:   false,
    },
    issueDate,
    seriesName:   series,
    isDraft:      false,
    currency:     input.currency || 'RON',
    language:     'RO',
    precision:    2,
    useStock:     cfg.useStock,
    observations: `Comanda Shopify ${input.orderName}`,
    mentions:     '',
    products,
  };

  log.debug('Creating SmartBill invoice', { series, orderName: input.orderName });

  const res = await sbFetch(auth, '/invoice', {
    method: 'POST',
    body:   JSON.stringify(invoiceBody),
  });

  const rawText = await res.text();
  let data: Record<string, unknown>;
  try { data = JSON.parse(rawText); } catch {
    throw new Error(
      `SmartBill ${res.status}: invalid response (HTML?). Check email/token/CIF. Raw: ${rawText.slice(0, 200)}`,
    );
  }

  if (!res.ok) {
    const errMsg = (data.errorText ?? data.message ?? data.error ?? JSON.stringify(data).slice(0, 300)) as string;
    throw new Error(`SmartBill invoice error ${res.status}: ${errMsg}`);
  }

  const invoiceSeries = data.series as string;
  const invoiceNumber = data.number as string;
  const invoiceUrl =
    (data.url ?? data.documentUrl) as string ??
    `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cfg.cif)}&series=${encodeURIComponent(invoiceSeries)}&number=${encodeURIComponent(invoiceNumber)}`;

  log.info('SmartBill invoice created', { series: invoiceSeries, number: invoiceNumber });

  return { series: invoiceSeries, number: invoiceNumber, invoiceUrl };
}

// ─── Invoice PDF download ─────────────────────────────────────────────────────

/**
 * Download the invoice PDF bytes from SmartBill.
 * Returns null if SmartBill does not have the PDF available.
 */
export async function downloadInvoicePdf(
  cfg: SmartBillConfig,
  series: string,
  number: string,
): Promise<Buffer | null> {
  const log = logger.child({ module: 'invoicing/smartbill', series, number });
  const auth = makeAuth(cfg.email, cfg.token);

  try {
    const res = await sbFetch(auth, `/invoice/pdf?cif=${encodeURIComponent(cfg.cif)}&series=${encodeURIComponent(series)}&number=${encodeURIComponent(number)}`, {
      headers: { Accept: 'application/octet-stream' },
    });

    if (!res.ok) {
      log.warn('SmartBill PDF download failed', { status: res.status });
      return null;
    }

    const buf = await res.arrayBuffer();
    const bytes = Buffer.from(buf);

    // Sanity check: a valid PDF starts with "%PDF-"
    if (bytes.length < 10 || bytes.slice(0, 5).toString('ascii') !== '%PDF-') {
      log.warn('SmartBill PDF response does not look like a PDF', { size: bytes.length });
      return null;
    }

    log.info('SmartBill invoice PDF downloaded', { size: bytes.length });
    return bytes;
  } catch (e) {
    log.warn('SmartBill PDF download exception', { error: (e as Error).message });
    return null;
  }
}

// ─── Collect invoice (issue receipt / chitanță) ───────────────────────────────

export async function collectInvoice(
  cfg: SmartBillConfig,
  invoiceSeries: string,
  invoiceNumber: string,
  value: number,
  clientName: string,
  currency = 'RON',
): Promise<CollectResult> {
  const log = logger.child({ module: 'invoicing/smartbill', action: 'collect' });
  const auth = makeAuth(cfg.email, cfg.token);
  const issueDate = new Date().toISOString().slice(0, 10);

  const body = {
    companyVatCode: cfg.cif,
    client: {
      name:       (clientName || 'Client').slice(0, 100),
      vatCode:    '',
      isTaxPayer: false,
      address:    '',
      city:       '',
      county:     '',
      country:    'Romania',
      saveToDb:   false,
    },
    issueDate,
    currency,
    precision:         2,
    value:             Math.round(value * 100) / 100,
    isDraft:           false,
    type:              'Chitanta',
    isCash:            true,
    useInvoiceDetails: false,
    invoicesList:      [{ seriesName: invoiceSeries, number: String(invoiceNumber) }],
    ...(cfg.paymentSeries ? { seriesName: cfg.paymentSeries } : {}),
  };

  try {
    const res = await sbFetch(auth, '/payment', { method: 'POST', body: JSON.stringify(body) });
    const rawText = await res.text();
    let data: Record<string, unknown>;
    try { data = JSON.parse(rawText); } catch { data = { raw: rawText.slice(0, 200) }; }

    if (!res.ok) {
      const errMsg = (data.errorText ?? data.message ?? data.error ?? JSON.stringify(data).slice(0, 200)) as string;
      log.warn('SmartBill collect failed', { status: res.status, error: errMsg });
      return { ok: false, error: errMsg };
    }

    log.info('SmartBill invoice collected', { receiptSeries: data.series, receiptNumber: data.number });
    return { ok: true, series: data.series as string, number: data.number as string };
  } catch (e) {
    log.error('SmartBill collect exception', { error: (e as Error).message });
    return { ok: false, error: (e as Error).message };
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function buildProduct(
  item: InvoiceLineItem,
  currency: string,
  cfg: SmartBillConfig,
): Record<string, unknown> {
  return {
    name:              item.name.slice(0, 255),
    code:              item.sku || '',
    isDiscount:        false,
    measuringUnitName: 'buc',
    currency:          currency || 'RON',
    quantity:          Math.max(1, item.quantity),
    price:             item.price,
    isTaxIncluded:     true,
    taxName:           'Normala',
    taxPercentage:     cfg.taxPercentage,
    isService:         false,
    saveToDb:          false,
    ...(cfg.useStock && cfg.warehouseName ? { warehouseName: cfg.warehouseName } : {}),
  };
}
