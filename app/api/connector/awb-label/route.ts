/**
 * GET /api/connector/awb-label?id=<shipmentId>
 * SAU
 * GET /api/connector/awb-label?tracking=<trackingNumber>&courier=gls
 *
 * Proxy pentru eticheta AWB — servește PDF-ul din DB/S3 sau direct din GLS API.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
import { fetchFromS3, isS3Key } from '@/lib/storage/s3';

async function fetchFromGls(trackingNumber: string): Promise<Buffer | null> {
  try {
    const username     = process.env.GLS_USERNAME || '';
    const password     = process.env.GLS_PASSWORD || '';
    const clientNumber = parseInt(process.env.GLS_CLIENT_NUMBER || '0', 10);

    if (!username || !password) return null;

    // SHA-512 hash password
    const encoded = new TextEncoder().encode(password);
    const buf     = await globalThis.crypto.subtle.digest('SHA-512', encoded);
    const pwdBytes = Array.from(new Uint8Array(buf));

    // Try RO first, then HU
    const bases = ['https://api.mygls.ro/ParcelService.svc/json', 'https://api.mygls.hu/ParcelService.svc/json'];

    for (const base of bases) {
      try {
        const res = await fetch(`${base}/GetPrintedLabels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            Username:         username,
            Password:         pwdBytes,
            ClientNumberList: [clientNumber],
            ParcelNumberList: [parseInt(trackingNumber, 10)],
            TypeOfPrinter:    'A4_2x2',
            PrintPosition:    1,
            ShowPrintDialog:  false,
          }),
          cache: 'no-store',
        });

        const responseText = await res.text();
        console.log(`[awb-label] GLS ${base} status=${res.status} body=${responseText.slice(0, 500)}`);
        if (!res.ok) continue;
        let data: Record<string, unknown>;
        try { data = JSON.parse(responseText); } catch { continue; }
        const labels = data?.Labels;

        let labelBase64: string | null = null;
        if (Array.isArray(labels) && typeof labels[0] === 'string' && labels[0].length > 100) {
          labelBase64 = labels[0];
        } else if (typeof labels === 'string' && labels.length > 100) {
          labelBase64 = labels as string;
        }

        if (labelBase64) return Buffer.from(labelBase64, 'base64');
      } catch { continue; }
    }
    return null;
  } catch { return null; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id       = searchParams.get('id') || '';
  const tracking = searchParams.get('tracking') || '';

  // Option A: by shipment ID from our DB
  if (id) {
    const shipment = await db.shipment.findUnique({ where: { id } });
    if (!shipment) return NextResponse.json({ error: 'AWB negăsit' }, { status: 404 });

    const filename = `AWB_${shipment.courier.toUpperCase()}_${shipment.trackingNumber}.pdf`;

    if (isS3Key(shipment.labelStorageKey)) {
      try {
        const buf = await fetchFromS3(shipment.labelStorageKey!);
        return pdfResponse(buf, filename);
      } catch { /* fallthrough */ }
    }

    if (shipment.labelData) {
      return pdfResponse(Buffer.from(shipment.labelData), filename);
    }

    // No local PDF — try GLS API
    const glsBuf = await fetchFromGls(shipment.trackingNumber);
    if (glsBuf) {
      // Save for next time
      await db.shipment.update({ where: { id }, data: { labelData: glsBuf } }).catch(() => {});
      return pdfResponse(glsBuf, filename);
    }

    if (shipment.trackingUrl) return NextResponse.redirect(shipment.trackingUrl);
    return NextResponse.json({ error: 'Eticheta nu este disponibilă' }, { status: 404 });
  }

  // Option B: by tracking number directly (for Shopify fulfillment AWBs)
  if (tracking) {
    const filename = `AWB_GLS_${tracking}.pdf`;
    const glsBuf = await fetchFromGls(tracking);
    if (glsBuf) return pdfResponse(glsBuf, filename);
    return NextResponse.json({ error: 'Eticheta nu a putut fi descărcată din GLS' }, { status: 404 });
  }

  return NextResponse.json({ error: 'id sau tracking required' }, { status: 400 });
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
