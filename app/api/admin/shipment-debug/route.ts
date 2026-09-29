import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';

/**
 * GET /api/admin/shipment-debug?awb=<tracking>&secret=<CONNECTOR_SECRET>
 * Diagnostic: arată dacă există un rând Shipment în DB pentru un AWB și ce
 * conține — folosit ca să depistăm de ce gls-sync nu "vede" anumite colete
 * (ex: AWB creat printr-un flux mai vechi, fără rând Shipment propriu).
 */
function checkSecret(provided: string | null) {
  const expected = process.env.CONNECTOR_SECRET || '';
  const key = provided || '';
  if (!key || !expected || key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!checkSecret(searchParams.get('secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const awb = (searchParams.get('awb') || '').trim();
  if (!awb) return NextResponse.json({ error: 'awb lipsă' }, { status: 400 });

  try {
    const shipment = await db.shipment.findFirst({
      where: { trackingNumber: awb },
      include: { order: { select: {
        id: true, shopifyId: true, shopifyName: true, status: true,
        fulfillmentStatus: true, financialStatus: true, isPaid: true,
        createdAt: true, shopifyCreatedAt: true,
      } } },
    });

    return NextResponse.json({
      ok: true,
      awb,
      shipmentFound: !!shipment,
      shipment: shipment ? {
        id: shipment.id, courier: shipment.courier, status: shipment.status,
        deliveredAt: shipment.deliveredAt, createdAt: shipment.createdAt, updatedAt: shipment.updatedAt,
      } : null,
      order: shipment?.order || null,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
