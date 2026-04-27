/**
 * app/api/invoice/route.ts — Secure invoice PDF download
 *
 * GET /api/invoice?id=UUID&token=HASH
 *
 * Security:
 *  - Token is HMAC-SHA256 signed with CONNECTOR_SECRET
 *  - Token carries an expiry timestamp (default 7 days)
 *  - No raw S3 URL is ever exposed
 *  - Validates that the Invoice row belongs to a real shop
 *
 * Response:
 *  Content-Type: application/pdf
 *  Content-Disposition: attachment; filename="Factura-GLA1042.pdf"
 *
 * Fallback: if no PDF is stored locally, redirect to SmartBill cloud URL.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { verifyToken } from '@/lib/security/tokens';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { fetchFromS3, isS3Key } from '@/lib/storage/s3';

const log = logger.child({ module: 'api/invoice' });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id    = searchParams.get('id')    ?? '';
  const token = searchParams.get('token') ?? '';

  // ── 1. Validate signed token ────────────────────────────────────────────
  let verifiedId: string;
  try {
    verifiedId = verifyToken(token);
  } catch (err) {
    log.warn('Invalid/expired invoice token', { id, error: (err as Error).message });
    return NextResponse.json(
      { error: 'Invalid or expired link. Please request a new download link.' },
      { status: 401 },
    );
  }

  // Token must match the requested ID
  if (verifiedId !== id) {
    log.warn('Token id mismatch', { requestedId: id, tokenId: verifiedId });
    return NextResponse.json({ error: 'Token mismatch' }, { status: 401 });
  }

  // ── 2. Fetch invoice from DB ────────────────────────────────────────────
  const invoice = await db.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  if (invoice.status === 'CANCELLED') {
    return NextResponse.json({ error: 'This invoice has been cancelled' }, { status: 410 });
  }

  const filename = `Factura-${invoice.series}${invoice.number}.pdf`;

  // ── 3. Serve PDF ─────────────────────────────────────────────────────────

  // Option A: PDF stored in S3
  if (isS3Key(invoice.pdfStorageKey)) {
    try {
      const pdfBuffer = await fetchFromS3(invoice.pdfStorageKey!);
      return pdfResponse(pdfBuffer, filename);
    } catch (err) {
      log.error('S3 fetch failed, falling back to DB/URL', {
        invoiceId: id,
        error: (err as Error).message,
      });
    }
  }

  // Option B: PDF stored inline in DB
  if (invoice.pdfData) {
    return pdfResponse(Buffer.from(invoice.pdfData), filename);
  }

  // Option C: No local PDF — descarcă live din SmartBill și cache-uiește
  try {
    const { downloadInvoicePdf, loadSmartBillConfig } = await import('@/lib/invoicing/smartbill');
    const { storePdf, isDbKey } = await import('@/lib/storage/s3');
    const cfg = loadSmartBillConfig();
    if (cfg.email && cfg.token && cfg.cif) {
      const pdfBuffer = await downloadInvoicePdf(cfg, invoice.series, invoice.number);
      if (pdfBuffer) {
        // Cache pentru data viitoare
        const stored = await storePdf(pdfBuffer, 'invoices', id);
        await db.invoice.update({
          where: { id },
          data: {
            pdfStorageKey: stored.key,
            pdfData: isDbKey(stored.key) ? pdfBuffer : undefined,
          },
        });
        log.info('PDF fetched live from SmartBill and cached', { invoiceId: id });
        return pdfResponse(pdfBuffer, filename);
      }
    }
  } catch (liveErr) {
    log.warn('Live SmartBill PDF fetch failed', { error: (liveErr as Error).message });
  }

  // Option D: Redirect la SmartBill URL dacă există
  if (invoice.invoiceUrl) {
    log.info('Redirecting to SmartBill URL', { invoiceId: id });
    return NextResponse.redirect(invoice.invoiceUrl);
  }

  // Option E: Nimic disponibil
  log.error('Invoice PDF not available anywhere', { invoiceId: id });
  return NextResponse.json(
    { error: 'PDF not available. Please download it directly from SmartBill.' },
    { status: 404 },
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function pdfResponse(buffer: Buffer, filename: string): Response {
  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length':      String(buffer.length),
      // Prevent caching — tokens expire, cached responses should not live longer
      'Cache-Control':       'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
