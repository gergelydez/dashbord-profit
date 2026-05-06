/**
 * GET /api/connector/awb-label?id=<shipmentId>
 * GET /api/connector/awb-label?tracking=<trackingNumber>
 *
 * Flux corect conform documentației MyGLS:
 * 1. GetParcelStatuses(ParcelNumber) → extrage ParcelId din StatusInfo
 * 2. GetPrintedLabels(ParcelIdList) → returnează PDF base64
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
import { fetchFromS3, isS3Key } from '@/lib/storage/s3';

const GLS_BASE = 'https://api.mygls.ro/ParcelService.svc/json';

async function buildAuth() {
  const username     = process.env.GLS_USERNAME || '';
  const password     = process.env.GLS_PASSWORD || '';
  const clientNumber = parseInt(process.env.GLS_CLIENT_NUMBER || '0', 10);

  if (!username || !password) {
    throw new Error('GLS credentials lipsă (GLS_USERNAME / GLS_PASSWORD)');
  }

  const encoded  = new TextEncoder().encode(password);
  const hashBuf  = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  const pwdBytes = Array.from(new Uint8Array(hashBuf));

  return { Username: username, Password: pwdBytes, ClientNumberList: [clientNumber] };
}

async function glsPost(endpoint: string, body: Record<string, unknown>) {
  const auth = await buildAuth();
  const res  = await fetch(`${GLS_BASE}/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({ ...auth, ...body }),
    cache:   'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GLS HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// Pasul 1: GetParcelStatuses → extrage ParcelId din câmpul StatusInfo
// StatusInfo conține "MyGLS-<ParcelId>" conform răspunsului observat
async function getParcelIdFromStatuses(trackingNumber: string): Promise<number | null> {
  const data = await glsPost('GetParcelStatuses', {
    ParcelNumber:    parseInt(trackingNumber, 10),
    ReturnPOD:       false,
    LanguageIsoCode: 'RO',
  });

  const errors = data.GetParcelStatusErrors as Array<Record<string, unknown>>;
  if (errors?.length) {
    console.log(`[awb-label] GetParcelStatuses errors:`, JSON.stringify(errors));
    return null;
  }

  const statusList = data.ParcelStatusList as Array<Record<string, unknown>> || [];
  console.log(`[awb-label] GetParcelStatuses returned ${statusList.length} statuses`);

  // StatusInfo format: "MyGLS-479207877" — extragem numărul
  for (const s of statusList) {
    const info = String(s.StatusInfo || '');
    const match = info.match(/MyGLS-(\d+)/);
    if (match) {
      const parcelId = parseInt(match[1], 10);
      console.log(`[awb-label] ParcelId extras din StatusInfo: ${parcelId} (din "${info}")`);
      return parcelId;
    }
  }

  console.log(`[awb-label] Nu s-a găsit ParcelId în StatusInfo. StatusList:`, JSON.stringify(statusList));
  return null;
}

// Pasul 2: GetPrintedLabels cu ParcelIdList — exact conform documentației
async function getPrintedLabel(parcelId: number): Promise<Buffer | null> {
  const data = await glsPost('GetPrintedLabels', {
    ParcelIdList:    [parcelId],
    PrintPosition:   1,
    ShowPrintDialog: false,
    TypeOfPrinter:   'A4_4x1',
  });

  const errors = data.GetPrintedLabelsErrorList as Array<Record<string, unknown>>;
  if (errors?.length) {
    console.log(`[awb-label] GetPrintedLabels errors:`, JSON.stringify(errors));
    throw new Error(`GLS error ${errors[0]?.ErrorCode}: ${errors[0]?.ErrorDescription}`);
  }

  const labels = data.Labels;
  if (typeof labels === 'string' && labels.length > 100) {
    return Buffer.from(labels, 'base64');
  }
  if (Array.isArray(labels) && typeof labels[0] === 'string' && labels[0].length > 100) {
    return Buffer.from(labels[0], 'base64');
  }

  console.log(`[awb-label] GetPrintedLabels no label. Keys:`, Object.keys(data));
  return null;
}

// Flux complet: tracking → ParcelId → PDF
async function fetchLabelFromGls(trackingNumber: string): Promise<Buffer | null> {
  const parcelId = await getParcelIdFromStatuses(trackingNumber);
  if (!parcelId) return null;
  return getPrintedLabel(parcelId);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id       = searchParams.get('id')       || '';
  const tracking = searchParams.get('tracking') || '';

  // ── Option A: by shipment ID from our DB ──────────────────────────────
  if (id) {
    const shipment = await db.shipment.findUnique({ where: { id } });
    if (!shipment) {
      return NextResponse.json({ error: 'AWB negăsit în DB' }, { status: 404 });
    }

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

    // Fallback: GLS API
    try {
      const buf = await fetchLabelFromGls(shipment.trackingNumber);
      if (buf) {
        await db.shipment.update({ where: { id }, data: { labelData: buf } }).catch(() => {});
        return pdfResponse(buf, filename);
      }
    } catch (e) {
      console.error('[awb-label]', e);
    }

    if (shipment.trackingUrl) return NextResponse.redirect(shipment.trackingUrl);
    return NextResponse.json({ error: 'Eticheta nu este disponibilă' }, { status: 404 });
  }

  // ── Option B: by tracking number ──────────────────────────────────────
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

    // 2. GLS API: GetParcelStatuses → ParcelId → GetPrintedLabels
    try {
      const buf = await fetchLabelFromGls(clean);
      if (buf) {
        if (shipment) {
          await db.shipment.update({ where: { id: shipment.id }, data: { labelData: buf } }).catch(() => {});
        }
        return pdfResponse(buf, filename);
      }
      return NextResponse.json({
        error: `Eticheta pentru AWB ${clean} nu este disponibilă`,
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
