/**
 * GET /api/connector/awb-label?id=<shipmentId>
 * GET /api/connector/awb-label?tracking=<trackingNumber>
 *
 * Servește PDF-ul etichetei AWB din DB/S3 sau direct din GLS API.
 * Folosește exact aceeași logică ca lib/couriers/gls.ts (fetchGlsLabel).
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
import { fetchFromS3, isS3Key } from '@/lib/storage/s3';

const GLS_BASE = 'https://api.mygls.ro/ParcelService.svc/json';

async function buildBaseReq() {
  const username     = process.env.GLS_USERNAME || '';
  const password     = process.env.GLS_PASSWORD || '';
  const clientNumber = parseInt(process.env.GLS_CLIENT_NUMBER || '0', 10);

  if (!username || !password) {
    throw new Error('GLS credentials lipsă (GLS_USERNAME / GLS_PASSWORD)');
  }

  // SHA-512 — exact ca în lib/couriers/gls.ts
  const encoded  = new TextEncoder().encode(password);
  const hashBuf  = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  const pwdBytes = Array.from(new Uint8Array(hashBuf));

  return {
    Username:         username,
    Password:         pwdBytes,
    ClientNumberList: [clientNumber],  // folosit în lib și funcționează
    WebshopEngine:    'Custom',
  };
}

// Descarcă eticheta direct cu ParcelNumberList (tracking number)
// Exact ca fetchGlsLabel() din lib/couriers/gls.ts
async function fetchLabelByTrackingNumber(trackingNumber: string): Promise<Buffer | null> {
  const baseReq = await buildBaseReq();

  const res = await fetch(`${GLS_BASE}/GetPrintedLabels`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      ...baseReq,
      ParcelNumberList: [parseInt(trackingNumber, 10)],
      TypeOfPrinter:    'A4_4x1',
      PrintPosition:    1,
      ShowPrintDialog:  false,
    }),
    cache: 'no-store',
  });

  const text = await res.text();
  console.log(`[awb-label] GetPrintedLabels status=${res.status} body=${text.slice(0, 400)}`);

  if (!res.ok) throw new Error(`GLS HTTP ${res.status}: ${text.slice(0, 200)}`);

  const data = JSON.parse(text);

  // Verifică erori GLS
  const errors = data?.GetPrintedLabelsErrorList;
  if (Array.isArray(errors) && errors.length > 0) {
    console.log(`[awb-label] GLS errors:`, JSON.stringify(errors));
    // Eroarea 10 = AWB nu are încă număr asignat (prea nou)
    // Eroarea 4 = ParcelId inexistent
    throw new Error(`GLS error ${errors[0]?.ErrorCode}: ${errors[0]?.ErrorDescription}`);
  }

  const labels = data?.Labels;
  if (Array.isArray(labels) && typeof labels[0] === 'string' && labels[0].length > 100) {
    return Buffer.from(labels[0], 'base64');
  }
  if (typeof labels === 'string' && labels.length > 100) {
    return Buffer.from(labels, 'base64');
  }

  console.log(`[awb-label] No label in response, keys:`, Object.keys(data));
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id       = searchParams.get('id')       || '';
  const tracking = searchParams.get('tracking') || '';

  // ── Option A: by shipment ID from our DB ────────────────────────────────
  if (id) {
    const shipment = await db.shipment.findUnique({ where: { id } });
    if (!shipment) {
      return NextResponse.json({ error: 'AWB negăsit în DB' }, { status: 404 });
    }

    const filename = `AWB_${shipment.courier.toUpperCase()}_${shipment.trackingNumber}.pdf`;

    // 1. S3
    if (isS3Key(shipment.labelStorageKey)) {
      try {
        const buf = await fetchFromS3(shipment.labelStorageKey!);
        return pdfResponse(buf, filename);
      } catch { /* fallthrough */ }
    }

    // 2. DB labelData
    if (shipment.labelData) {
      return pdfResponse(Buffer.from(shipment.labelData), filename);
    }

    // 3. GLS API cu tracking number
    try {
      const buf = await fetchLabelByTrackingNumber(shipment.trackingNumber);
      if (buf) {
        await db.shipment.update({ where: { id }, data: { labelData: buf } }).catch(() => {});
        return pdfResponse(buf, filename);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[awb-label] GLS fetch error:', msg);
    }

    if (shipment.trackingUrl) return NextResponse.redirect(shipment.trackingUrl);
    return NextResponse.json({ error: 'Eticheta nu este disponibilă' }, { status: 404 });
  }

  // ── Option B: by tracking number ────────────────────────────────────────
  if (tracking) {
    const clean    = String(tracking).replace(/\s/g, '');
    const filename = `AWB_GLS_${clean}.pdf`;

    // 1. Caută în DB după trackingNumber
    const shipment = await db.shipment.findFirst({
      where:   { trackingNumber: clean },
      orderBy: { createdAt: 'desc' },
    });

    if (shipment) {
      if (isS3Key(shipment.labelStorageKey)) {
        try {
          const buf = await fetchFromS3(shipment.labelStorageKey!);
          return pdfResponse(buf, `AWB_${shipment.courier.toUpperCase()}_${clean}.pdf`);
        } catch { /* fallthrough */ }
      }
      if (shipment.labelData) {
        return pdfResponse(Buffer.from(shipment.labelData), filename);
      }
    }

    // 2. GLS API direct — exact ca în lib/couriers/gls.ts
    try {
      const buf = await fetchLabelByTrackingNumber(clean);
      if (buf) {
        if (shipment) {
          await db.shipment.update({ where: { id: shipment.id }, data: { labelData: buf } }).catch(() => {});
        }
        return pdfResponse(buf, filename);
      }
      return NextResponse.json({
        error: `Eticheta pentru AWB ${clean} nu este disponibilă`,
        hint: 'AWB-ul poate fi prea nou (nu a fost încă procesat de GLS) sau aparține altui cont',
      }, { status: 404 });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'id sau tracking required' }, { status: 400 });
}

function pdfResponse(buf: Buffer, filename: string): Response {
  return new Response(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control':       'private, max-age=3600',
    },
  });
}
