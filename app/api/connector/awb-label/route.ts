/**
 * GET /api/connector/awb-label?id=<shipmentId>
 * GET /api/connector/awb-label?tracking=<trackingNumber>
 *
 * Prioritate:
 * 1. DB propriu (S3 sau labelData)
 * 2. GLS API (GetParcelStatuses → ParcelId → GetPrintedLabels)
 * 3. Redirect la xConnector (dacă shipment.trackingUrl e xconnector.app)
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
  if (!username || !password) throw new Error('GLS credentials lipsă');
  const encoded  = new TextEncoder().encode(password);
  const hashBuf  = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  const pwdBytes = Array.from(new Uint8Array(hashBuf));
  return { Username: username, Password: pwdBytes, ClientNumberList: [clientNumber] };
}

async function glsPost(endpoint: string, body: Record<string, unknown>) {
  const auth = await buildAuth();
  const res  = await fetch(`${GLS_BASE}/${endpoint}`, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...auth, ...body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GLS HTTP ${res.status}`);
  return JSON.parse(text);
}

async function fetchLabelFromGls(trackingNumber: string): Promise<Buffer | null> {
  // Pasul 1: GetParcelStatuses → ParcelId din StatusInfo ("MyGLS-12345")
  const statusData = await glsPost('GetParcelStatuses', {
    ParcelNumber:    parseInt(trackingNumber, 10),
    ReturnPOD:       false,
    LanguageIsoCode: 'RO',
  });

  const statusList = statusData.ParcelStatusList as Array<Record<string, unknown>> || [];
  let parcelId: number | null = null;
  for (const s of statusList) {
    const match = String(s.StatusInfo || '').match(/MyGLS-(\d+)/);
    if (match) { parcelId = parseInt(match[1], 10); break; }
  }
  if (!parcelId) return null;

  // Pasul 2: GetPrintedLabels cu ParcelIdList
  const labelData = await glsPost('GetPrintedLabels', {
    ParcelIdList: [parcelId], PrintPosition: 1,
    ShowPrintDialog: false, TypeOfPrinter: 'A4_4x1',
  });

  const errors = labelData.GetPrintedLabelsErrorList as Array<Record<string, unknown>> || [];

  // Eroarea 18 = deja generat → încearcă GetPrintData
  if (errors.length > 0 && Number(errors[0]?.ErrorCode) === 18) {
    const printData = await glsPost('GetPrintData', {
      ParcelIdList: [parcelId], PrintPosition: 1,
      ShowPrintDialog: false, TypeOfPrinter: 'A4_4x1',
    });
    const pdf = printData.Pdfdocument || printData.Labels;
    if (typeof pdf === 'string' && pdf.length > 100) return Buffer.from(pdf, 'base64');
    return null;
  }

  if (errors.length > 0) throw new Error(`GLS error ${errors[0]?.ErrorCode}: ${errors[0]?.ErrorDescription}`);

  const labels = labelData.Labels;
  if (typeof labels === 'string' && labels.length > 100) return Buffer.from(labels, 'base64');
  if (Array.isArray(labels) && typeof labels[0] === 'string') return Buffer.from(labels[0], 'base64');
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id       = searchParams.get('id')       || '';
  const tracking = searchParams.get('tracking') || '';

  // ── Option A: by shipment ID from our DB ──────────────────────────────
  if (id) {
    const shipment = await db.shipment.findUnique({ where: { id } });
    if (!shipment) return NextResponse.json({ error: 'AWB negăsit în DB' }, { status: 404 });

    const filename = `AWB_${shipment.courier.toUpperCase()}_${shipment.trackingNumber}.pdf`;

    // 1. S3
    if (isS3Key(shipment.labelStorageKey)) {
      try { return pdfResponse(await fetchFromS3(shipment.labelStorageKey!), filename); }
      catch { /* fallthrough */ }
    }

    // 2. DB labelData
    if (shipment.labelData) return pdfResponse(Buffer.from(shipment.labelData), filename);

    // 3. GLS API
    try {
      const buf = await fetchLabelFromGls(shipment.trackingNumber);
      if (buf) {
        await db.shipment.update({ where: { id }, data: { labelData: buf } }).catch(() => {});
        return pdfResponse(buf, filename);
      }
    } catch (e) { console.error('[awb-label]', e); }

    // 4. xConnector URL din trackingUrl salvat în DB
    if (shipment.trackingUrl?.includes('xconnector.app')) {
      return NextResponse.redirect(shipment.trackingUrl);
    }

    return NextResponse.json({ error: 'Eticheta nu este disponibilă' }, { status: 404 });
  }

  // ── Option B: by tracking number ──────────────────────────────────────
  if (tracking) {
    const clean    = String(tracking).replace(/\s/g, '');
    const filename = `AWB_GLS_${clean}.pdf`;

    // 1. Caută în DB după trackingNumber
    const shipment = await db.shipment.findFirst({
      where: { trackingNumber: clean }, orderBy: { createdAt: 'desc' },
    });

    if (shipment) {
      if (isS3Key(shipment.labelStorageKey)) {
        try { return pdfResponse(await fetchFromS3(shipment.labelStorageKey!), filename); }
        catch { /* fallthrough */ }
      }
      if (shipment.labelData) return pdfResponse(Buffer.from(shipment.labelData), filename);

      // xConnector URL din DB
      if (shipment.trackingUrl?.includes('xconnector.app')) {
        return NextResponse.redirect(shipment.trackingUrl);
      }
    }

    // 2. GLS API
    try {
      const buf = await fetchLabelFromGls(clean);
      if (buf) {
        if (shipment) await db.shipment.update({ where: { id: shipment.id }, data: { labelData: buf } }).catch(() => {});
        return pdfResponse(buf, filename);
      }
    } catch (e) { console.error('[awb-label] GLS:', (e as Error).message); }

    return NextResponse.json({ error: `Eticheta pentru AWB ${clean} nu este disponibilă` }, { status: 404 });
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
