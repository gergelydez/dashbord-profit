import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/setup-shipment-delivered-at?secret=<CONNECTOR_SECRET>
 * One-time setup endpoint — same pattern as /api/admin/setup-receptie-costs:
 * adds the Shipment.deliveredAt column directly via the app's own DB connection.
 * Idempotent (ADD COLUMN IF NOT EXISTS) — safe to hit more than once.
 */
function checkSecret(provided) {
  const expected = process.env.CONNECTOR_SECRET || '';
  const key = provided || '';
  if (!key || !expected || key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (!checkSecret(searchParams.get('secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await db.$executeRawUnsafe(`ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3)`);
    return NextResponse.json({ ok: true, message: 'Coloana Shipment.deliveredAt a fost adăugată.' });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
