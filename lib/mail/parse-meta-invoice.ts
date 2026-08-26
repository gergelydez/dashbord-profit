/**
 * lib/mail/parse-meta-invoice.ts
 * Reads a Meta Ads "Invoice for ..." PDF (the ones in Meta's own
 * Billing → Transactions export) and pulls out the payment status and
 * amount — confirmed against a real export: each PDF has a
 * "Product type" / "Meta ads" / <status> / <amount> block, where
 * status is exactly "Paid" or "Failed".
 *
 * Uses lib/mail/pdf-text.ts (pdfjs-dist directly) rather than pdf-parse —
 * see that file for why: pdf-parse's bundled 2017 pdf.js throws on PDFs a
 * real viewer opens fine, and pdf-parse v2 pulls in a native `canvas`
 * dependency that's risky on Vercel's serverless runtime, neither of
 * which pdfjs-dist's plain getTextContent() needs.
 */
import { extractPdfText } from './pdf-text';

/** "RON1,866.20" (comma thousands separator) must not be truncated at the
 * comma — confirmed bug: a naive \d+(?:[.,]\d+)? regex matches only "1,866"
 * out of "1,866.20", parsing as 1.866 instead of 1866.20 for any invoice
 * at or above 1000. Prefers a strict "digits,digits.NN" match (real money
 * amounts always have exactly 2 decimals) before falling back looser. */
function parseMoney(text: string): number | null {
  const strict = text.match(/([\d,]+\.\d{2})/);
  if (strict) return parseFloat(strict[1].replace(/,/g, ''));
  const loose = text.match(/([\d,]+(?:\.\d+)?)/);
  return loose ? parseFloat(loose[1].replace(/,/g, '')) : null;
}

export interface MetaInvoiceInfo {
  status: 'paid' | 'failed' | 'unknown';
  amount: number | null;
  invoiceDate: Date | null;
}

export async function parseMetaInvoicePdf(buffer: Buffer): Promise<MetaInvoiceInfo> {
  const text = await extractPdfText(buffer);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const typeIdx = lines.indexOf('Product type');
  if (typeIdx === -1) return { status: 'unknown', amount: null, invoiceDate: null };

  const statusLine = (lines[typeIdx + 2] || '').toLowerCase();
  const amountLine = lines[typeIdx + 3] || '';
  const amount = parseMoney(amountLine);

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
