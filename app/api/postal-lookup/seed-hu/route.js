import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loadHuPostalCodeRecords } from '@/lib/address/postal-seed-data';

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
 * GET /api/postal-lookup/seed-hu — status check only (no import). Same role
 * as /api/postal-lookup/seed but for HuPostalCode (glato.hu addresses).
 */
export async function GET() {
  try {
    await ensureTable();
    const count = await db.huPostalCode.count();
    const total = loadHuPostalCodeRecords().length;
    return NextResponse.json({ ok: true, count, total, complete: count >= total }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}

async function ensureTable() {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HuPostalCode" (
      "id" SERIAL PRIMARY KEY,
      "megye" TEXT NOT NULL,
      "telepules" TEXT NOT NULL,
      "resz" TEXT,
      "zip" TEXT NOT NULL,
      "megyeNorm" TEXT NOT NULL,
      "telepulesNorm" TEXT NOT NULL,
      "reszNorm" TEXT
    )
  `);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "HuPostalCode_zip_idx" ON "HuPostalCode" ("zip")`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "HuPostalCode_megyeNorm_telepulesNorm_idx" ON "HuPostalCode" ("megyeNorm", "telepulesNorm")`);
}

/**
 * POST /api/postal-lookup/seed-hu — imports prisma/data/hu-postal-codes.csv
 * (bundled with the app) if the table is empty/incomplete. Not secret-gated,
 * same reasoning as /api/postal-lookup/seed: bundled data only, idempotent,
 * resumable.
 */
export async function POST() {
  try {
    await ensureTable();
    const records = loadHuPostalCodeRecords();
    const existing = await db.huPostalCode.count();

    if (existing >= records.length) {
      return NextResponse.json({ ok: true, done: true, count: existing, total: records.length, message: `Deja populat (${existing} coduri poștale).` }, { headers: CORS });
    }

    const BATCH = 5000;
    const TIME_BUDGET_MS = 45000;
    const start = Date.now();
    let i = existing;
    while (i < records.length && Date.now() - start < TIME_BUDGET_MS) {
      const batch = records.slice(i, i + BATCH);
      await db.huPostalCode.createMany({ data: batch });
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
