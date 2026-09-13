import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loadPostalCodeRecords } from '@/lib/address/postal-seed-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/seed-postal-codes?secret=<CONNECTOR_SECRET>
 * One-time setup endpoint: creates the RoPostalCode table (if missing) and
 * imports prisma/data/ro-postal-codes.csv (bundled in the deployed app, so
 * this needs no separate DB tooling — it reuses the same Prisma connection
 * every other route already uses). Resumable: re-hitting the same URL picks
 * up from the current row count, so a Vercel function timeout on the first
 * call just means calling it again finishes the rest. Idempotent once done.
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

    const records = loadPostalCodeRecords();
    const existing = await db.roPostalCode.count();

    if (existing >= records.length) {
      return NextResponse.json({ ok: true, done: true, message: `Deja importat complet (${existing} rânduri).` });
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
        ok: true, done: false, imported: i, total: records.length,
        message: `Importat ${i}/${records.length}. Accesează din nou același link ca să continui (se reia automat de unde a rămas).`,
      });
    }

    return NextResponse.json({ ok: true, done: true, imported: i, total: records.length, message: 'Import complet.' });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
