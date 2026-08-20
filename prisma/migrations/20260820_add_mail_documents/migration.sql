-- Email → Google Drive document sorting: mailbox connections, sort rules,
-- ingested-document audit log, generic app settings, monthly financial rollup.
CREATE TABLE IF NOT EXISTS "AppSetting" (
    "key" TEXT PRIMARY KEY,
    "value" JSONB NOT NULL
);

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
);
CREATE UNIQUE INDEX IF NOT EXISTS "MailAccount_email_key" ON "MailAccount" ("email");
CREATE INDEX IF NOT EXISTS "MailAccount_provider_idx" ON "MailAccount" ("provider");

CREATE TABLE IF NOT EXISTS "SortRule" (
    "id" TEXT PRIMARY KEY,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "matchType" TEXT NOT NULL,
    "matchValue" TEXT NOT NULL,
    "filenameContains" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SortRule_matchType_matchValue_idx" ON "SortRule" ("matchType", "matchValue");
ALTER TABLE "SortRule" ADD COLUMN IF NOT EXISTS "filenameContains" TEXT;

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
);
CREATE UNIQUE INDEX IF NOT EXISTS "IngestedDocument_mailAccountId_messageId_filename_key" ON "IngestedDocument" ("mailAccountId", "messageId", "filename");
CREATE INDEX IF NOT EXISTS "IngestedDocument_month_category_idx" ON "IngestedDocument" ("month", "category");
CREATE INDEX IF NOT EXISTS "IngestedDocument_status_idx" ON "IngestedDocument" ("status");

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
);
CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyStat_month_key" ON "MonthlyStat" ("month");
