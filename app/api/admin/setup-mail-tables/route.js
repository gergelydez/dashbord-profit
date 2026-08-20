import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/setup-mail-tables?secret=<CONNECTOR_SECRET>
 * One-time setup endpoint — same pattern as /api/admin/seed-postal-codes:
 * creates the tables for the email→Drive sorting feature (AppSetting,
 * MailAccount, SortRule, IngestedDocument, MonthlyStat) directly via the
 * app's own DB connection, so no separate DB tooling access is needed.
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
      CREATE TABLE IF NOT EXISTS "AppSetting" (
        "key" TEXT PRIMARY KEY,
        "value" JSONB NOT NULL
      )
    `);

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MailAccount" (
        "id" TEXT PRIMARY KEY,
        "provider" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "refreshToken" TEXT,
        "appPassword" TEXT,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "lastSyncAt" TIMESTAMP(3),
        "lastSyncCursor" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MailAccount_email_key" ON "MailAccount" ("email")`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MailAccount_provider_idx" ON "MailAccount" ("provider")`);

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SortRule" (
        "id" TEXT PRIMARY KEY,
        "category" TEXT NOT NULL,
        "subcategory" TEXT,
        "matchType" TEXT NOT NULL,
        "matchValue" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SortRule_matchType_matchValue_idx" ON "SortRule" ("matchType", "matchValue")`);

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "IngestedDocument" (
        "id" TEXT PRIMARY KEY,
        "mailAccountId" TEXT NOT NULL REFERENCES "MailAccount"("id"),
        "messageId" TEXT NOT NULL,
        "senderEmail" TEXT NOT NULL,
        "subject" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "subcategory" TEXT,
        "month" TEXT NOT NULL,
        "filename" TEXT NOT NULL,
        "mimeType" TEXT NOT NULL,
        "driveFileId" TEXT,
        "driveUrl" TEXT,
        "status" TEXT NOT NULL DEFAULT 'ingested',
        "fileData" BYTEA,
        "receivedAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "IngestedDocument_mailAccountId_messageId_filename_key" ON "IngestedDocument" ("mailAccountId", "messageId", "filename")`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "IngestedDocument_month_category_idx" ON "IngestedDocument" ("month", "category")`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "IngestedDocument_status_idx" ON "IngestedDocument" ("status")`);

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MonthlyStat" (
        "id" TEXT PRIMARY KEY,
        "month" TEXT NOT NULL,
        "glsIncasat" DECIMAL(12,2),
        "sdIncasat" DECIMAL(12,2),
        "metaSpend" DECIMAL(12,2),
        "tiktokSpend" DECIMAL(12,2),
        "googleSpend" DECIMAL(12,2),
        "profit" DECIMAL(12,2),
        "extra" JSONB NOT NULL DEFAULT '{}',
        "updatedAt" TIMESTAMP(3) NOT NULL
      )
    `);
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyStat_month_key" ON "MonthlyStat" ("month")`);

    return NextResponse.json({ ok: true, message: 'Tabelele pentru Documente au fost create.' });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
