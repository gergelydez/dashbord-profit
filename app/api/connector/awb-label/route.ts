/**
 * GET /api/connector/awb-label?id=<shipmentId>
 * Proxy pentru eticheta AWB — servește PDF-ul din DB/S3 direct în browser.
 * Nu necesită token — folosit pentru iframe preview și download.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
import { fetchFromS3, isS3Key } from '@/lib/storage/s3';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const shipment = await db.shipment.findUnique({ where: { id } });
  if (!shipment) return NextResponse.json({ error: 'AWB negăsit' }, { status: 404 });

  const filename = `AWB_${shipment.courier.toUpperCase()}_${shipment.trackingNumber}.pdf`;

  // Option A: S3
  if (isS3Key(shipment.labelStorageKey)) {
    try {
      const buf = await fetchFromS3(shipment.labelStorageKey!);
      return pdfResponse(buf, filename);
    } catch { /* fallthrough */ }
  }

  // Option B: DB inline
  if (shipment.labelData) {
    return pdfResponse(Buffer.from(shipment.labelData), filename);
  }

  // Option C: tracking URL fallback
  if (shipment.trackingUrl) {
    return NextResponse.redirect(shipment.trackingUrl);
  }

  return NextResponse.json({ error: 'Eticheta nu este disponibilă' }, { status: 404 });
}

function pdfResponse(buf: Buffer, filename: string): Response {
  return new Response(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
