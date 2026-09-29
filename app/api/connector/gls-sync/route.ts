import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { ShipmentStatus, OrderStatus } from '@prisma/client';
import { getAccessTokenForDomain } from '@/lib/shopify/ccg-token';
import { shopifyGraphQL } from '@/lib/shopify/client';
import { loadSmartBillConfig, collectInvoice } from '@/lib/invoicing/smartbill';

const MARK_PAID_MUTATION = `
  mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) {
    orderMarkAsPaid(input: $input) {
      order { id }
      userErrors { field message }
    }
  }
`;

/**
 * La livrare confirmată pentru o comandă ramburs: încasează automat factura
 * în SmartBill (dacă există și nu e deja încasată) și marchează comanda ca
 * plătită în Shopify — banii chiar au fost colectați de curier la livrare,
 * doar sistemul nu știa încă. Non-fatal: erorile nu opresc sincronizarea GLS.
 */
async function autoCollectOnDelivery(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { shop: true } });
  if (!order || order.isPaid) return;

  const gw = (order.paymentGateway || '').toLowerCase();
  const isCod = gw.includes('cash') || gw.includes('ramburs') || gw.includes('cod') || gw === 'manual' || !order.isPaid;
  if (!isCod) return;

  // 1. Încasează factura existentă (dacă e deja generată și nu e deja încasată)
  try {
    const invoice = await db.invoice.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
    if (invoice && !invoice.collected) {
      const cfg = loadSmartBillConfig();
      const result = await collectInvoice(cfg, invoice.series, invoice.number, Number(order.totalPrice), order.customerName, order.currency, 'Ramburs');
      if (result.ok) {
        await db.invoice.update({ where: { id: invoice.id }, data: { collected: true, collectionSeries: result.series, collectionNumber: result.number } });
      } else {
        console.warn('[gls-sync] auto-collect invoice failed', order.id, result.error);
      }
    }
  } catch (e) {
    console.warn('[gls-sync] auto-collect invoice error', order.id, (e as Error).message);
  }

  // 2. Marchează comanda ca plătită în Shopify
  try {
    const accessToken = await getAccessTokenForDomain(order.shop.domain);
    const orderGid = order.shopifyGid || `gid://shopify/Order/${order.shopifyId}`;
    await shopifyGraphQL(
      { domain: order.shop.domain, accessToken },
      MARK_PAID_MUTATION,
      { input: { id: orderGid } },
    );
    await db.order.update({ where: { id: order.id }, data: { isPaid: true, financialStatus: 'paid' } });
  } catch (e) {
    console.warn('[gls-sync] orderMarkAsPaid error', order.id, (e as Error).message);
  }
}

const GLS_BASE = 'https://api.mygls.ro/ParcelService.svc/json';

async function buildAuth() {
  const username = process.env.GLS_USERNAME || '';
  const password = process.env.GLS_PASSWORD || '';
  const encoded  = new TextEncoder().encode(password);
  const hashBuf  = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  const pwdBytes = Array.from(new Uint8Array(hashBuf));
  // GetParcelStatuses nu vrea ClientNumberList (spre deosebire de crearea AWB-urilor) —
  // /api/tracking (care chiar funcționează, confirmat live) nu-l trimite deloc; adăugarea
  // lui aici era motivul pentru care gls-sync primea glsQueried:0 pentru toate coletele.
  return { Username: username, Password: pwdBytes };
}

async function glsPost(endpoint: string, body: Record<string, unknown>) {
  const auth = await buildAuth();
  const res  = await fetch(`${GLS_BASE}/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({ ...auth, ...body }),
    cache:   'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GLS ${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Use Prisma's ShipmentStatus enum directly to stay in sync with the schema
type AppStatus = ShipmentStatus;

// Coduri GLS de refuz/retur explicit — vezi app/api/tracking/route.js
// (GLS_RETURN_CODES) pentru istoricul deciziilor: 34/35 au fost scoase
// fiindcă pe acest cont comenzi cu ele în istoric au fost livrate/încasate
// cu succes. Ținem lista identică ca să nu ajungem cu două surse de adevăr
// care se contrazic (asta a fost exact bug-ul din runda cu Sameday).
const GLS_RETURN_CODES = [14, 17, 23, 40, 90];
// Codul 5 e ambiguu — GLS îl reciclează atât pentru "livrat" cât și pentru
// "predare retur înapoi la depozit", deci scanăm tot istoricul după un cod
// de retur explicit DOAR când ultimul status e 5. Pentru orice alt cod final
// contează doar ultimul status.
const GLS_AMBIGUOUS_DELIVERED_CODE = 5;

function mapGlsStatus(statusCode: unknown, description?: string): AppStatus {
  const code = typeof statusCode === 'string' ? parseInt(statusCode, 10) : Number(statusCode);
  if (!isNaN(code)) {
    if ([4, 5, 6, 16].includes(code))   return ShipmentStatus.DELIVERED;
    if ([1, 15].includes(code))          return ShipmentStatus.IN_TRANSIT;   // PICKED_UP → IN_TRANSIT
    if ([3, 20].includes(code))          return ShipmentStatus.OUT_FOR_DELIVERY;
    if ([2, 17, 18, 19].includes(code)) return ShipmentStatus.IN_TRANSIT;
    if ([7, 8, 9, 10].includes(code))   return ShipmentStatus.FAILED_ATTEMPT; // FAILED_DELIVERY → FAILED_ATTEMPT
    if ([11, 14].includes(code))         return ShipmentStatus.RETURNED;
    if ([12, 13].includes(code))         return ShipmentStatus.IN_TRANSIT;
    if (code === 0)                       return ShipmentStatus.CREATED;
  }
  const desc = (description || String(statusCode)).toLowerCase();
  if (desc.includes('livrat') || desc.includes('deliver'))   return ShipmentStatus.DELIVERED;
  if (desc.includes('ridicat') || desc.includes('pickup'))   return ShipmentStatus.IN_TRANSIT;
  if (desc.includes('livrare') || desc.includes('out for'))  return ShipmentStatus.OUT_FOR_DELIVERY;
  if (desc.includes('tranzit') || desc.includes('transit') || desc.includes('hub') || desc.includes('depozit')) return ShipmentStatus.IN_TRANSIT;
  if (desc.includes('refuzat') || desc.includes('absent') || desc.includes('nelivrat')) return ShipmentStatus.FAILED_ATTEMPT;
  if (desc.includes('returnat') || desc.includes('return'))  return ShipmentStatus.RETURNED;
  return ShipmentStatus.IN_TRANSIT;
}

// GLS trimite datele ca /Date(1774645401000+0100)/ — parsăm timestamp-ul.
function parseGlsDate(dateStr: unknown): string {
  const s = String(dateStr ?? '');
  const match = s.match(/\/Date\((\d+)/);
  if (match) return new Date(parseInt(match[1], 10)).toISOString();
  return s;
}

const ACTIVE_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.CREATED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.FAILED_ATTEMPT,
];

async function fetchGlsStatuses(trackingNumbers: string[]) {
  const results = new Map<string, { newStatus: AppStatus; glsCode: unknown; glsDescription: string; lastEvent: string }>();
  const diagnostics: string[] = [];
  const BATCH = 10;

  for (let i = 0; i < trackingNumbers.length; i += BATCH) {
    const batch = trackingNumbers.slice(i, i + BATCH);
    await Promise.all(batch.map(async (tn) => {
      try {
        const parcelNum = parseInt(tn.replace(/\D/g, ''), 10);
        if (isNaN(parcelNum)) { diagnostics.push(`${tn}: tracking number invalid (nu conține cifre)`); return; }
        const data = await glsPost('GetParcelStatuses', {
          ParcelNumber:    parcelNum,
          ReturnPOD:       false,
          LanguageIsoCode: 'RO',
        });
        const glsErrors = data?.GetParcelStatusErrors ?? [];
        if (Array.isArray(glsErrors) && glsErrors.length > 0) {
          diagnostics.push(`${tn}: GLS a răspuns cu eroare — ${JSON.stringify(glsErrors).slice(0, 200)}`);
          return;
        }
        if (data?.ErrorCode || data?.ErrorDescription) {
          diagnostics.push(`${tn}: GLS a răspuns cu eroare — ${data.ErrorCode ?? ''} ${data.ErrorDescription ?? ''}`.trim());
          return;
        }
        // ParcelStatusList e o listă PLATĂ de evenimente, cel mai recent primul
        // (nu imbricată sub .ParcelEvents — asta era a doua cauză pentru care
        // sincronizarea nu găsea niciun status, chiar și după ce autentificarea
        // a fost reparată). Aceeași formă ca în app/api/tracking/route.js,
        // singura implementare confirmată să funcționeze cu acest cont GLS.
        const statusList: Array<Record<string, unknown>> =
          (data?.ParcelStatusList ?? []) as Array<Record<string, unknown>>;
        if (!Array.isArray(statusList) || statusList.length === 0) {
          diagnostics.push(`${tn}: GLS n-a returnat niciun status pentru acest AWB`);
          return;
        }
        const last = statusList[0];
        const lastCode = parseInt(String(last?.StatusCode ?? ''), 10);
        const desc = String(last?.StatusDescription ?? '');
        const hasReturnCode = lastCode === GLS_AMBIGUOUS_DELIVERED_CODE
          ? statusList.some(s => GLS_RETURN_CODES.includes(parseInt(String(s?.StatusCode ?? ''), 10)))
          : GLS_RETURN_CODES.includes(lastCode);
        results.set(tn, {
          newStatus:      hasReturnCode ? ShipmentStatus.RETURNED : mapGlsStatus(lastCode, desc),
          glsCode:        lastCode,
          glsDescription: desc,
          lastEvent:      `${parseGlsDate(last?.StatusDate)} — ${desc}`.trim(),
        });
      } catch (err) {
        const msg = (err as Error).message;
        console.warn(`[gls-sync] failed for ${tn}:`, msg);
        diagnostics.push(`${tn}: ${msg}`);
      }
    }));
    if (i + BATCH < trackingNumbers.length) await new Promise(r => setTimeout(r, 300));
  }
  return { results, diagnostics };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dry') === 'true';
  const days   = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 90);
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 250);
  const startedAt = Date.now();

  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const shipments = await db.shipment.findMany({
      where: {
        courier:        { in: ['gls', 'GLS'] },
        status:         { in: ACTIVE_STATUSES },
        createdAt:      { gte: since },
        trackingNumber: { not: '' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, trackingNumber: true, status: true, createdAt: true, orderId: true },
    });

    if (shipments.length === 0) {
      return NextResponse.json({
        ok: true,
        message: `Nu sunt colete GLS active in ultimele ${days} zile.`,
        synced: 0,
        elapsed: Date.now() - startedAt,
      });
    }

    const trackingNumbers = Array.from(new Set(shipments.map(s => s.trackingNumber).filter(Boolean)));
    const { results: glsStatuses, diagnostics } = await fetchGlsStatuses(trackingNumbers).catch((err) => {
      throw new Error(`GLS API error: ${(err as Error).message}`);
    });

    const updates = shipments.flatMap(s => {
      const r = glsStatuses.get(s.trackingNumber);
      if (!r || r.newStatus === s.status) return [];
      return [{ shipmentId: s.id, orderId: s.orderId, trackingNumber: s.trackingNumber, oldStatus: s.status, ...r }];
    });

    if (dryRun) {
      return NextResponse.json({
        ok: true, dryRun: true,
        checked: shipments.length, glsQueried: glsStatuses.size,
        toUpdate: updates.length, updates,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        elapsed: Date.now() - startedAt,
      });
    }

    let updated = 0;
    const errors: string[] = [];
    for (const u of updates) {
      try {
        await db.shipment.update({
          where: { id: u.shipmentId },
          data: {
            status:    u.newStatus,
            updatedAt: new Date(),
            ...(u.newStatus === ShipmentStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
          },
        });
        if (u.newStatus === ShipmentStatus.DELIVERED && u.orderId) {
          await db.order.update({
            where: { id: u.orderId },
            data: { status: OrderStatus.FULFILLED, fulfilled: true },
          }).catch(() => {});
          await autoCollectOnDelivery(u.orderId).catch(() => {});
        }
        updated++;
      } catch (dbErr) {
        errors.push(`${u.trackingNumber}: ${(dbErr as Error).message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      checked: shipments.length,
      glsQueried: glsStatuses.size,
      updated,
      unchanged: shipments.length - updates.length,
      errors: errors.length > 0 ? errors : undefined,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
      updates: updates.map(u => ({
        tracking:  u.trackingNumber,
        oldStatus: u.oldStatus,
        newStatus: u.newStatus,
        glsCode:   u.glsCode,
        lastEvent: u.lastEvent,
      })),
      elapsed: Date.now() - startedAt,
      message: `Actualizat ${updated} din ${shipments.length} colete GLS.`,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export const POST = GET;
