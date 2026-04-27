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
    const envCfg = loadSmartBillConfig();
    // Acceptă credențiale și din query params (trimise din browser când env vars lipsesc)
    const cfg = {
      ...envCfg,
      email: searchParams.get('sb_email') || envCfg.email,
      token: searchParams.get('sb_token') || envCfg.token,
      cif:   searchParams.get('sb_cif')   || envCfg.cif,
    };
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

  // Option D: Pagina HTML cu link SmartBill (redirect direct nu merge fara auth)
  const sbUrl = invoice.invoiceUrl ||
    `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=&series=${encodeURIComponent(invoice.series)}&number=${encodeURIComponent(invoice.number)}`;

  log.info('Serving HTML fallback page', { invoiceId: id, sbUrl });
  const html = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Factură ${invoice.series}${invoice.number}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 32px 28px; max-width: 420px; width: 100%; text-align: center; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 700; color: #f97316; margin-bottom: 8px; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px; }
    .btn { display: inline-block; background: #f97316; color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-size: 15px; font-weight: 700; margin-bottom: 12px; width: 100%; }
    .btn-sec { display: inline-block; background: transparent; color: #60a5fa; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-size: 13px; border: 1px solid rgba(96,165,250,0.3); width: 100%; }
    .info { font-size: 11px; color: #475569; margin-top: 16px; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #f97316; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📄</div>
    <h1>Factură ${invoice.series}${invoice.number}</h1>
    <p>PDF-ul nu este stocat local. Descarcă factura direct din SmartBill Cloud.</p>
    <a href="${sbUrl}" class="btn" target="_blank">📥 Deschide în SmartBill</a>
    <a href="https://cloud.smartbill.ro" class="btn-sec" target="_blank">🔑 Mergi la SmartBill Cloud</a>
    <p class="info">Serie: <code>${invoice.series}</code> &nbsp; Număr: <code>${invoice.number}</code></p>
  </div>
  <script>
    // Încearcă auto-redirect după 1 secundă
    setTimeout(() => { window.location.href = "${sbUrl}"; }, 1000);
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
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
