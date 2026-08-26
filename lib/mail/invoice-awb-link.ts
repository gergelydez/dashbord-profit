/**
 * lib/mail/invoice-awb-link.ts
 * Links a supplier's invoice number to the DHL AWB it shipped under.
 *
 * The chain (confirmed from real documents): the transport commercial
 * invoice's filename already carries both — "Invoice_<invoiceNumber>_
 * tracking<awb>.xlsx" — while the NIR ("Nota de recepție") and other
 * supplier paperwork only ever mention the invoice number in their text
 * ("... documente insotitoare Factura SX6193524801 ..."), never the AWB.
 * Recording the pair once (when the transport invoice is uploaded) lets
 * everything else that only knows the invoice number still get routed to
 * the right Recepție/AWB-<number> folder automatically.
 */
import { db } from '@/lib/db';

// Confirmed live: this table's rollout depended on a human remembering to
// hit /api/admin/setup-mail-tables after every deploy that touched it,
// which failed silently (a real request errored) the first few times.
// Creating it inline before every use — cheap once it already exists,
// since CREATE TABLE/INDEX IF NOT EXISTS is a no-op — makes this table
// self-provisioning instead of depending on that manual step at all.
let ensured = false;
async function ensureTable(): Promise<void> {
  if (ensured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "InvoiceAwbLink" (
      "invoiceNumber" TEXT PRIMARY KEY,
      "awb" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InvoiceAwbLink_awb_idx" ON "InvoiceAwbLink" ("awb")`);
  ensured = true;
}

export function extractInvoiceAwbFromFilename(filename: string): { invoiceNumber: string; awb: string } | null {
  const m = filename.match(/Invoice_([A-Za-z0-9]+)_tracking(\d+)/i);
  return m ? { invoiceNumber: m[1], awb: m[2] } : null;
}

/** Matches "Factura SX6193524801" (NIR wording) and generic "Invoice No: X" phrasing. */
export function extractInvoiceNumberFromText(text: string): string | null {
  const patterns = [/Factur[ăa]\s+([A-Za-z0-9-]{5,})/i, /Invoice\s*(?:No\.?|Number)?[:\s]+([A-Za-z0-9-]{5,})/i];
  for (const p of patterns) {
    const m = (text || '').match(p);
    if (m) return m[1];
  }
  return null;
}

export async function recordInvoiceAwbLink(invoiceNumber: string, awb: string): Promise<void> {
  await ensureTable();
  await db.invoiceAwbLink.upsert({
    where: { invoiceNumber },
    create: { invoiceNumber, awb },
    update: { awb },
  });
}

export async function lookupAwbByInvoiceNumber(invoiceNumber: string): Promise<string | null> {
  await ensureTable();
  const link = await db.invoiceAwbLink.findUnique({ where: { invoiceNumber } });
  return link?.awb ?? null;
}
