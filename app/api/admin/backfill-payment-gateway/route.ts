import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { db } from '@/lib/db';

/**
 * GET /api/admin/backfill-payment-gateway?secret=<CONNECTOR_SECRET>&days=90
 *
 * upsertOrderFromWebhook citea payload.payment_gateway (câmp aproape
 * mereu absent din webhook-urile Shopify) în loc de payment_gateway_names
 * (array-ul chiar trimis) — Order.paymentGateway a rămas gol pentru orice
 * comandă salvată înainte de fix, ceea ce făcea ca orice comandă plătită
 * online cu cardul să fie clasificată greșit drept ramburs COD (pagina
 * Comenzi, auto-invoice payment type, auto-collect).
 *
 * Acest endpoint recitește payment_gateway_names din rawPayload-ul deja
 * salvat (fără niciun apel către Shopify) și completează Order.paymentGateway
 * pentru comenzile unde a rămas gol.
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
  const dryRun = searchParams.get('dry') === 'true';
  const days   = Math.min(parseInt(searchParams.get('days') ?? '90', 10), 730);

  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const orders = await db.order.findMany({
      where: { createdAt: { gte: since }, paymentGateway: '' },
      select: { id: true, shopifyName: true, rawPayload: true },
      take: 1000,
    });

    const toUpdate: Array<{ id: string; orderName: string; gateway: string }> = [];
    for (const o of orders) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = o.rawPayload as any;
      const gateway = (payload?.payment_gateway_names || [])[0] || payload?.payment_gateway || '';
      if (gateway) toUpdate.push({ id: o.id, orderName: o.shopifyName, gateway });
    }

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, scanned: orders.length, toUpdate: toUpdate.length, items: toUpdate });
    }

    let updated = 0;
    const errors: string[] = [];
    for (const item of toUpdate) {
      try {
        await db.order.update({ where: { id: item.id }, data: { paymentGateway: item.gateway } });
        updated++;
      } catch (e) {
        errors.push(`${item.orderName}: ${(e as Error).message}`);
      }
    }

    return NextResponse.json({
      ok: true, scanned: orders.length, found: toUpdate.length, updated,
      errors: errors.length > 0 ? errors : undefined,
      message: `Actualizat gateway-ul de plată pentru ${updated} din ${toUpdate.length} comenzi găsite.`,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
