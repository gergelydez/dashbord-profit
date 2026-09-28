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
  const username     = process.env.GLS_USERNAME     || '';
  const password     = process.env.GLS_PASSWORD     || '';
  const clientNumber = parseInt(process.env.GLS_CLIENT_NUMBER || '0', 10);
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GLS ${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Use Prisma's ShipmentStatus enum directly to stay in sync with the schema
type AppStatus = ShipmentStatus;

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

const ACTIVE_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.CREATED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.FAILED_ATTEMPT,
];

async function fetchGlsStatuses(trackingNumbers: string[]) {
  const results = new Map<string, { newStatus: AppStatus; glsCode: unknown; glsDescription: string; lastEvent: string }>();
  const BATCH = 10;

  for (let i = 0; i < trackingNumbers.length; i += BATCH) {
    const batch = trackingNumbers.slice(i, i + BATCH);
    await Promise.all(batch.map(async (tn) => {
      try {
        const parcelNum = parseInt(tn.replace(/\D/g, ''), 10);
        if (isNaN(parcelNum)) return;
        const data = await glsPost('GetParcelStatuses', {
          ParcelNumber:    parcelNum,
          ReturnPOD:       false,
          LanguageIsoCode: 'RO',
        });
        const statusList: Array<Record<string, unknown>> =
          (data?.ParcelStatusList ?? data?.GetParcelStatusesResult?.ParcelStatusList ?? []) as Array<Record<string, unknown>>;
        if (!Array.isArray(statusList) || statusList.length === 0) return;
        const events: Array<Record<string, unknown>> =
          (statusList[0]?.ParcelEvents ?? statusList[0]?.StatusList ?? []) as Array<Record<string, unknown>>;
        if (events.length === 0) return;
        const last = events[events.length - 1];
        const code = last?.Code ?? last?.StatusCode ?? 0;
        const desc = String(last?.Description ?? last?.StatusDescription ?? '');
        results.set(tn, {
          newStatus:      mapGlsStatus(code, desc),
          glsCode:        code,
          glsDescription: desc,
          lastEvent:      `${String(last?.Date ?? '')} ${String(last?.Time ?? '')} — ${desc}`.trim(),
        });
      } catch (err) {
        console.warn(`[gls-sync] failed for ${tn}:`, (err as Error).message);
      }
    }));
    if (i + BATCH < trackingNumbers.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
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
    const glsStatuses = await fetchGlsStatuses(trackingNumbers).catch((err) => {
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
