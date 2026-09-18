import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/setup-receptie-costs?secret=<CONNECTOR_SECRET>
 * One-time setup endpoint — same pattern as /api/admin/setup-mail-tables:
 * creates the ProductCost table directly via the app's own DB connection.
 * Idempotent (CREATE TABLE/INDEX IF NOT EXISTS) — safe to hit more than once.
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
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ProductCost" (
        "sku" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "costRON" DECIMAL(12,2) NOT NULL,
        "costCuTvaRON" DECIMAL(12,2),
        "source" TEXT NOT NULL DEFAULT 'import',
        "updatedAt" TIMESTAMP(3) NOT NULL
      )
    `);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProductCost_name_idx" ON "ProductCost" ("name")`);

    return NextResponse.json({ ok: true, message: 'Tabela ProductCost a fost creată.' });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
