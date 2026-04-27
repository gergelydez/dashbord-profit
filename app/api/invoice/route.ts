/**
 * app/api/invoice/route.ts — Secure invoice PDF download
 */

import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { verifyToken } from '@/lib/security/tokens';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { fetchFromS3, isS3Key, storePdf, isDbKey } from '@/lib/storage/s3';

const log = logger.child({ module: 'api/invoice' });

const SB_BASE = 'https://ws.smartbill.ro/SBORO/api';

async function fetchPdfFromSmartBill(
  email: string,
  token: string,
  cif: string,
  series: string,
  number: string,
): Promise<Buffer | null> {
  try {
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const url  = `${SB_BASE}/invoice/pdf?cif=${encodeURIComponent(cif)}&series=${encodeURIComponent(series)}&number=${encodeURIComponent(number)}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept':        'application/pdf, */*',
        'Content-Type':  'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      log.warn('SmartBill PDF fetch failed', { status: res.status, series, number });
      return null;
    }

    const buf   = Buffer.from(await res.arrayBuffer());
    const isPdf = buf.length > 10 && buf.slice(0, 5).toString('ascii') === '%PDF-';
    if (!isPdf) {
      log.warn('SmartBill response is not a PDF', { size: buf.length });
      return null;
    }

    log.info('SmartBill PDF fetched successfully', { series, number, size: buf.length });
    return buf;
  } catch (e) {
    log.warn('SmartBill PDF fetch exception', { error: (e as Error).message });
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id    = searchParams.get('id')    ?? '';
  const token = searchParams.get('token') ?? '';

  // Credențiale SmartBill — din env vars SAU din query params (trimise de browser)
  const sbEmail = searchParams.get('sb_email') || process.env.SMARTBILL_EMAIL || '';
  const sbToken = searchParams.get('sb_token') || process.env.SMARTBILL_TOKEN || '';
  const sbCif   = searchParams.get('sb_cif')   || process.env.SMARTBILL_CIF   || '';

  // ── 1. Validate signed token ──────────────────────────────────────────────
  let verifiedId: string;
  try {
    verifiedId = verifyToken(token);
  } catch (err) {
    return NextResponse.json(
      { error: 'Link expirat sau invalid. Generează un link nou.' },
      { status: 401 },
    );
  }

  if (verifiedId !== id) {
    return NextResponse.json({ error: 'Token mismatch' }, { status: 401 });
  }

  // ── 2. Fetch invoice from DB ──────────────────────────────────────────────
  const invoice = await db.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: 'Factura nu a fost găsită' }, { status: 404 });
  }

  if (invoice.status === 'CANCELLED') {
    return NextResponse.json({ error: 'Factura a fost anulată' }, { status: 410 });
  }

  const filename = `Factura-${invoice.series}${invoice.number}.pdf`;

  // ── 3. Option A: PDF în S3 ────────────────────────────────────────────────
  if (isS3Key(invoice.pdfStorageKey)) {
    try {
      const buf = await fetchFromS3(invoice.pdfStorageKey!);
      return pdfResponse(buf, filename);
    } catch (err) {
      log.error('S3 fetch failed', { error: (err as Error).message });
    }
  }

  // ── 4. Option B: PDF în DB ────────────────────────────────────────────────
  if (invoice.pdfData) {
    return pdfResponse(Buffer.from(invoice.pdfData), filename);
  }

  // ── 5. Option C: Descarcă live din SmartBill cu credențialele disponibile ─
  if (sbEmail && sbToken && sbCif) {
    const pdfBuf = await fetchPdfFromSmartBill(sbEmail, sbToken, sbCif, invoice.series, invoice.number);
    if (pdfBuf) {
      // Cache în DB pentru apelurile viitoare
      try {
        const stored = await storePdf(pdfBuf, 'invoices', id);
        await db.invoice.update({
          where: { id },
          data: {
            pdfStorageKey: stored.key,
            pdfData: isDbKey(stored.key) ? pdfBuf : undefined,
          },
        });
      } catch (cacheErr) {
        log.warn('PDF cache failed (non-fatal)', { error: (cacheErr as Error).message });
      }
      return pdfResponse(pdfBuf, filename);
    }
  }

  // ── 6. Option D: Pagina HTML cu instrucțiuni ──────────────────────────────
  // invoiceUrl din SmartBill poate fi gol sau invalid — nu redirectăm
  const hasCreds = !!(sbEmail && sbToken && sbCif);
  const html = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Factură ${invoice.series}${invoice.number}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
    .card{background:#1e293b;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px 24px;max-width:400px;width:100%;text-align:center}
    h1{font-size:18px;font-weight:700;color:#f97316;margin:12px 0 8px}
    p{font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:20px}
    .btn{display:block;background:#f97316;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-size:14px;font-weight:700;margin-bottom:10px}
    .btn-sec{display:block;background:transparent;color:#60a5fa;text-decoration:none;padding:10px 20px;border-radius:10px;font-size:13px;border:1px solid rgba(96,165,250,.3);margin-bottom:8px}
    code{background:#0f172a;padding:2px 8px;border-radius:4px;font-size:12px;color:#f97316;font-family:monospace}
    .warn{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:10px 14px;font-size:12px;color:#f59e0b;margin-bottom:20px;text-align:left}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:48px">📄</div>
    <h1>Factură ${invoice.series}${invoice.number}</h1>
    ${!hasCreds ? `
    <div class="warn">
      ⚠️ Credențialele SmartBill nu sunt configurate pe server.<br><br>
      Adaugă în Vercel Environment Variables:<br>
      <code>SMARTBILL_EMAIL</code><br>
      <code>SMARTBILL_TOKEN</code><br>
      <code>SMARTBILL_CIF</code>
    </div>` : `
    <div class="warn">⚠️ PDF-ul nu a putut fi descărcat din SmartBill. Verifică că seria și numărul sunt corecte.</div>`}
    <p>Descarcă factura direct din SmartBill Cloud:</p>
    <a href="https://cloud.smartbill.ro" class="btn" target="_blank">🔑 Deschide SmartBill Cloud</a>
    <a href="https://cloud.smartbill.ro/core/factura/lista" class="btn-sec" target="_blank">📋 Lista facturi</a>
    <p style="margin-top:16px;font-size:11px;color:#475569">
      Serie: <code>${invoice.series}</code> &nbsp; Număr: <code>${invoice.number}</code>
    </p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function pdfResponse(buffer: Buffer, filename: string): Response {
  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':           'application/pdf',
      'Content-Disposition':    `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length':         String(buffer.length),
      'Cache-Control':          'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
