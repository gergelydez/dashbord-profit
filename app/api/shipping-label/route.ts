/**
 * app/api/shipping-label/route.ts — Secure AWB label PDF download
 *
 * GET /api/shipping-label?id=UUID&token=HASH
 *
 * Security: same mechanism as /api/invoice (HMAC-signed, time-limited token).
 *
 * Response:
 *  Content-Type: application/pdf
 *  Content-Disposition: attachment; filename="AWB-GLS-12345678.pdf"
 *
 * Fallback: if no label PDF is stored, redirects to the carrier tracking URL.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { verifyToken } from '@/lib/security/tokens';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { fetchFromS3, isS3Key } from '@/lib/storage/s3';

const log = logger.child({ module: 'api/shipping-label' });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id    = searchParams.get('id')    ?? '';
  const token = searchParams.get('token') ?? '';

  // ── 1. Validate signed token ────────────────────────────────────────────
  let verifiedId: string;
  try {
    verifiedId = verifyToken(token);
  } catch (err) {
    log.warn('Invalid/expired label token', { id, error: (err as Error).message });
    return NextResponse.json(
      { error: 'Invalid or expired link. Please request a new download link.' },
      { status: 401 },
    );
  }

  if (verifiedId !== id) {
    return NextResponse.json({ error: 'Token mismatch' }, { status: 401 });
  }

  // ── 2. Fetch shipment from DB ───────────────────────────────────────────
  const shipment = await db.shipment.findUnique({ where: { id } });
  if (!shipment) {
    return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
  }

  if (shipment.status === 'CANCELLED') {
    return NextResponse.json({ error: 'This shipment has been cancelled' }, { status: 410 });
  }

  const filename = `AWB-${shipment.courier.toUpperCase()}-${shipment.trackingNumber}.pdf`;

  // ── 3. Serve PDF ─────────────────────────────────────────────────────────

  // Option A: S3 stored label
  if (isS3Key(shipment.labelStorageKey)) {
    try {
      const buf = await fetchFromS3(shipment.labelStorageKey!);
      return pdfResponse(buf, filename);
    } catch (err) {
      log.error('S3 fetch failed for label', {
        shipmentId: id,
        error: (err as Error).message,
      });
    }
  }

  // Option B: Inline DB storage
  if (shipment.labelData) {
    return pdfResponse(Buffer.from(shipment.labelData), filename);
  }

  // Option C: No label PDF — redirect to carrier tracking page
  if (shipment.trackingUrl) {
    log.info('No local label PDF — redirecting to tracking URL', { shipmentId: id });
    return NextResponse.redirect(shipment.trackingUrl);
  }

  return NextResponse.json({ error: 'Label not available' }, { status: 404 });
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
