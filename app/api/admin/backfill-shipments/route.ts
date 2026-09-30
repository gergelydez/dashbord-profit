import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { db } from '@/lib/db';
import { ShipmentStatus } from '@prisma/client';

/**
 * GET /api/admin/backfill-shipments?secret=<CONNECTOR_SECRET>&days=60
 *
 * Unele AWB-uri au fost create printr-un flux mai vechi (sau webhook-ul
 * inițial n-a apucat să scrie un rând Shipment) — orderul are tracking
 * number/curier salvat doar în rawPayload-ul Shopify (fulfillments), fără
 * niciun rând în tabela Shipment. gls-sync interoghează DOAR tabela
 * Shipment, deci acele colete nu sunt niciodată verificate/actualizate,
 * indiferent cât de bine funcționează restul sincronizării.
 *
 * Acest endpoint găsește comenzile fără niciun Shipment, extrage tracking
 * number + curier din rawPayload.fulfillments (dacă există) și creează
 * rândul Shipment lipsă (status inițial CREATED — următoarea rulare de
 * gls-sync/sameday-sync îi va prelua statusul real).
 */
function checkSecret(provided: string | null) {
  const expected = process.env.CONNECTOR_SECRET || '';
  const key = provided || '';
  if (!key || !expected || key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function detectCourier(company: string): 'gls' | 'sameday' | null {
  const c = company.toLowerCase();
  if (c.includes('gls') || c.includes('mygls')) return 'gls';
  if (c.includes('sameday') || c.includes('same day')) return 'sameday';
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!checkSecret(searchParams.get('secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = searchParams.get('dry') === 'true';
  const days   = Math.min(parseInt(searchParams.get('days') ?? '60', 10), 365);

  try {
    const since = new Date(Date.now() - days * 86_400_000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders = await db.order.findMany({
      where: {
        createdAt: { gte: since },
        shipments: { none: {} },
        fulfillmentStatus: { not: null },
      },
      select: { id: true, shopId: true, shopifyName: true, rawPayload: true },
      take: 500,
    });

    const toCreate: Array<{ orderId: string; shopId: string; orderName: string; courier: string; trackingNumber: string }> = [];
    for (const o of orders) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = o.rawPayload as any;
      const fulfillments: Array<{ tracking_number?: string; tracking_company?: string }> = payload?.fulfillments || [];
      for (const f of fulfillments) {
        const courier = detectCourier(f.tracking_company || '');
        const trackingNumber = (f.tracking_number || '').trim();
        if (courier && trackingNumber) {
          toCreate.push({ orderId: o.id, shopId: o.shopId, orderName: o.shopifyName, courier, trackingNumber });
          break; // un singur Shipment per curier — primul fulfillment valid ajunge
        }
      }
    }

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, scanned: orders.length, toCreate: toCreate.length, items: toCreate });
    }

    let created = 0;
    const errors: string[] = [];
    for (const item of toCreate) {
      try {
        await db.shipment.create({
          data: {
            orderId: item.orderId, shopId: item.shopId,
            courier: item.courier, trackingNumber: item.trackingNumber,
            status: ShipmentStatus.CREATED,
          },
        });
        created++;
      } catch (e) {
        errors.push(`${item.orderName} (${item.trackingNumber}): ${(e as Error).message}`);
      }
    }

    return NextResponse.json({
      ok: true, scanned: orders.length, found: toCreate.length, created,
      errors: errors.length > 0 ? errors : undefined,
      message: `Create ${created} rânduri Shipment lipsă din ${toCreate.length} găsite.`,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
