import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loadPostalCodeRecords } from '@/lib/address/postal-seed-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

/**
 * GET /api/postal-lookup/seed — status check only (no import), used by the
 * AWB Manager settings panel to show whether autocomplete/postal lookups
 * actually have data to work with.
 */
export async function GET() {
  try {
    await ensureTable();
    const count = await db.roPostalCode.count();
    const total = loadPostalCodeRecords().length;
    return NextResponse.json({ ok: true, count, total, complete: count >= total }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}

async function ensureTable() {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RoPostalCode" (
      "id" SERIAL PRIMARY KEY,
      "judet" TEXT NOT NULL,
      "localitate" TEXT NOT NULL,
      "strada" TEXT,
      "zip" TEXT NOT NULL,
      "judetNorm" TEXT NOT NULL,
      "localitateNorm" TEXT NOT NULL,
      "stradaNorm" TEXT
    )
  `);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RoPostalCode_zip_idx" ON "RoPostalCode" ("zip")`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RoPostalCode_judetNorm_localitateNorm_idx" ON "RoPostalCode" ("judetNorm", "localitateNorm")`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RoPostalCode_judetNorm_localitateNorm_stradaNorm_idx" ON "RoPostalCode" ("judetNorm", "localitateNorm", "stradaNorm")`);
}

/**
 * POST /api/postal-lookup/seed — imports prisma/data/ro-postal-codes.csv
 * (bundled with the app) if the table is empty/incomplete. Deliberately NOT
 * secret-gated like /api/admin/seed-postal-codes: it only ever inserts from
 * the bundled CSV (no user input reaches the DB), it's idempotent (a second
 * call just confirms "already done"), and gating it behind CONNECTOR_SECRET
 * would mean the person actually hitting this — from the AWB Manager
 * settings panel, because address autocomplete came back empty — needs a
 * secret they don't have handy. Resumable: a timeout just means the next
 * click picks up where it left off.
 */
export async function POST() {
  try {
    await ensureTable();
    const records = loadPostalCodeRecords();
    const existing = await db.roPostalCode.count();

    if (existing >= records.length) {
      return NextResponse.json({ ok: true, done: true, count: existing, total: records.length, message: `Deja populat (${existing} coduri poștale).` }, { headers: CORS });
    }

    const BATCH = 5000;
    const TIME_BUDGET_MS = 45000;
    const start = Date.now();
    let i = existing;
    while (i < records.length && Date.now() - start < TIME_BUDGET_MS) {
      const batch = records.slice(i, i + BATCH);
      await db.roPostalCode.createMany({ data: batch });
      i += batch.length;
    }

    if (i < records.length) {
      return NextResponse.json({
        ok: true, done: false, count: i, total: records.length,
        message: `Importat ${i}/${records.length} — apasă din nou ca să continui.`,
      }, { headers: CORS });
    }

    return NextResponse.json({ ok: true, done: true, count: i, total: records.length, message: `Import complet: ${i} coduri poștale.` }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}
