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

const GLS_BASE = 'https://api.mygls.ro/ParcelService.svc/json';

async function glsAuth() {
  const username = process.env.GLS_USERNAME || '';
  const password = process.env.GLS_PASSWORD || '';
  if (!username || !password) throw new Error('GLS credentials lipsă (GLS_USERNAME / GLS_PASSWORD)');

  // SHA-512 hash — documentația cere byte array, nu hex string
  const encoded  = new TextEncoder().encode(password);
  const hashBuf  = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  const pwdBytes = Array.from(new Uint8Array(hashBuf));

  return { Username: username, Password: pwdBytes };
}

async function glsPost(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const auth = await glsAuth();
  const res  = await fetch(`${GLS_BASE}/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({ ...auth, ...body }),
    cache:   'no-store',
  });
  const text = await res.text();
  console.log(`[awb-label] GLS ${endpoint} status=${res.status} body=${text.slice(0, 300)}`);
  if (!res.ok) throw new Error(`GLS HTTP ${res.status}`);
  return JSON.parse(text);
}

// Pasul 1: GetParcelList → găsim ParcelId intern după tracking number
async function findParcelId(trackingNumber: string): Promise<number | null> {
  const today = new Date();
  const from  = new Date();
  from.setDate(today.getDate() - 180); // 180 zile înapoi

  // Căutăm după PrintDate (data generării etichetei)
  const data = await glsPost('GetParcelList', {
    PrintDateFrom: from.toISOString(),
    PrintDateTo:   today.toISOString(),
  });

  const list: Array<Record<string, unknown>> = (data.PrintDataInfoList as Array<Record<string, unknown>>) || [];

  // Căutăm după ParcelNumber sau ParcelNumberWithCheckdigit
  // GLS returnează numere ca Long — comparăm ca string pentru a evita overflow
  const clean = String(trackingNumber).replace(/\s/g, '');
  const parcel = list.find(p =>
    String(p.ParcelNumber)               === clean ||
    String(p.ParcelNumberWithCheckdigit) === clean
  );

  if (!parcel) {
    console.log(`[awb-label] Tracking ${clean} negăsit în ${list.length} parcele (PrintDate 180 zile)`);

    // Fallback: caută după PickupDate
    const data2 = await glsPost('GetParcelList', {
      PickupDateFrom: from.toISOString(),
      PickupDateTo:   today.toISOString(),
    });
    const list2: Array<Record<string, unknown>> = (data2.PrintDataInfoList as Array<Record<string, unknown>>) || [];
    const parcel2 = list2.find(p =>
      String(p.ParcelNumber)               === clean ||
      String(p.ParcelNumberWithCheckdigit) === clean
    );
    if (!parcel2) {
      console.log(`[awb-label] Tracking ${clean} negăsit nici după PickupDate (${list2.length} parcele)`);
      return null;
    }
    console.log(`[awb-label] Găsit via PickupDate: ParcelId=${parcel2.ParcelId}`);
    return parcel2.ParcelId as number;
  }

  console.log(`[awb-label] Găsit via PrintDate: ParcelId=${parcel.ParcelId}`);
  return parcel.ParcelId as number;
}

// Pasul 2: GetPrintedLabels cu ParcelIdList — returnează PDF base64
async function fetchFromGls(trackingNumber: string): Promise<Buffer | null> {
  try {
    const parcelId = await findParcelId(trackingNumber);
    if (!parcelId) return null;

    // GetPrintedLabels — câmpul corect este ParcelIdList, NU ParcelNumberList
    const data = await glsPost('GetPrintedLabels', {
      ParcelIdList:   [parcelId],
      PrintPosition:  1,
      ShowPrintDialog: false,
      TypeOfPrinter:  'A4_4x1', // A4_4x1 = o etichetă per pagină, cea mai clară
    });

    const errors = data.GetPrintedLabelsErrorList as Array<Record<string, unknown>> | undefined;
    if (errors?.length) {
      console.log(`[awb-label] GLS error: ${JSON.stringify(errors[0])}`);
      return null;
    }

    // Labels vine ca string base64
    const labels = data.Labels as string | undefined;
    if (!labels || labels.length < 100) return null;

    return Buffer.from(labels, 'base64');
  } catch (e) {
    console.error('[awb-label] fetchFromGls error:', e);
    return null;
  }
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
      await db.shipment.update({ where: { id }, data: { labelData: glsBuf } }).catch(() => {});
      return pdfResponse(glsBuf, filename);
    }

    if (shipment.trackingUrl) return NextResponse.redirect(shipment.trackingUrl);
    return NextResponse.json({ error: 'Eticheta nu este disponibilă' }, { status: 404 });
  }

  // Option B: by tracking number
  if (tracking) {
    const clean = String(tracking).replace(/\s/g, '');
    const filename = `AWB_GLS_${clean}.pdf`;

    // 1. Caută mai întâi în DB-ul propriu după trackingNumber
    const shipmentByTracking = await db.shipment.findFirst({
      where: { trackingNumber: clean },
      orderBy: { createdAt: 'desc' },
    });

    if (shipmentByTracking) {
      console.log(`[awb-label] Găsit în DB: shipmentId=${shipmentByTracking.id}`);

      if (isS3Key(shipmentByTracking.labelStorageKey)) {
        try {
          const buf = await fetchFromS3(shipmentByTracking.labelStorageKey!);
          return pdfResponse(buf, `AWB_${shipmentByTracking.courier.toUpperCase()}_${clean}.pdf`);
        } catch { /* fallthrough */ }
      }

      if (shipmentByTracking.labelData) {
        return pdfResponse(Buffer.from(shipmentByTracking.labelData), filename);
      }
    }

    // 2. Fallback: încearcă GLS API direct (GetParcelList → GetPrintedLabels)
    try {
      const glsBuf = await fetchFromGls(clean);
      if (glsBuf) {
        // Salvează în DB dacă avem shipment
        if (shipmentByTracking) {
          await db.shipment.update({ where: { id: shipmentByTracking.id }, data: { labelData: glsBuf } }).catch(() => {});
        }
        return pdfResponse(glsBuf, filename);
      }

      return NextResponse.json({
        error: `AWB ${clean} negăsit`,
        hint: 'AWB-ul nu există în DB-ul local și nici în contul MyGLS conectat. Dacă AWB-ul a fost generat de xConnector, încearcă accesarea prin /api/shipping-label cu token semnat.',
        tracking: clean,
      }, { status: 404 });

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[awb-label] Error:', msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
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
