/**
 * lib/mail/parse-meta-invoice.ts
 * Reads a Meta Ads "Invoice for ..." PDF (the ones in Meta's own
 * Billing → Transactions export) and pulls out the payment status and
 * amount — confirmed against a real export: each PDF has a
 * "Product type" / "Meta ads" / <status> / <amount> block, where
 * status is exactly "Paid" or "Failed".
 *
 * Uses pdf-parse@1.x deliberately (not the current v2, which pulls in
 * @napi-rs/canvas — a native binary dependency that's risky on Vercel's
 * serverless runtime) since only plain text extraction is needed here.
 *
 * Imports the inner lib file directly, NOT the package root ('pdf-parse'):
 * pdf-parse@1.1.1's index.js runs `if (!module.parent) { <read its own
 * bundled test fixture> }` at module load time, which throws ENOENT the
 * moment webpack's module wrapping makes module.parent falsy (confirmed:
 * this crashes Next.js's "Collecting page data" build step, and would
 * crash the deployed function the same way). lib/pdf-parse.js exports the
 * identical function without that debug branch.
 */
import pdf from 'pdf-parse/lib/pdf-parse.js';

export interface MetaInvoiceInfo {
  status: 'paid' | 'failed' | 'unknown';
  amount: number | null;
  invoiceDate: Date | null;
}

export async function parseMetaInvoicePdf(buffer: Buffer): Promise<MetaInvoiceInfo> {
  const data = await pdf(buffer);
  const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean);

  const typeIdx = lines.indexOf('Product type');
  if (typeIdx === -1) return { status: 'unknown', amount: null, invoiceDate: null };

  const statusLine = (lines[typeIdx + 2] || '').toLowerCase();
  const amountLine = lines[typeIdx + 3] || '';
  const amountMatch = amountLine.match(/(\d+(?:[.,]\d+)?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '.')) : null;

  let status: MetaInvoiceInfo['status'] = 'unknown';
  if (statusLine === 'paid') status = 'paid';
  else if (statusLine === 'failed') status = 'failed';

  const dateIdx = lines.indexOf('Invoice/payment date');
  let invoiceDate: Date | null = null;
  if (dateIdx !== -1 && lines[dateIdx + 1]) {
    const parsed = new Date(lines[dateIdx + 1].replace(',', ''));
    if (!isNaN(parsed.getTime())) invoiceDate = parsed;
  }

  return { status, amount, invoiceDate };
}

/** Meta's export filenames are prefixed "YYYY-MM-DDTHH-MM ..." — more
 * reliable for month bucketing than re-parsing the in-PDF date text. */
export function monthFromMetaFilename(filename: string): string | null {
  const m = filename.match(/^(\d{4})-(\d{2})-\d{2}/);
  return m ? `${m[1]}-${m[2]}` : null;
}
