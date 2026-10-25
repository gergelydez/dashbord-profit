-- SamedayAwbImport — persistă rândurile din exportul AWB Sameday (descărcat
-- manual din panoul Sameday), ca să nu mai fie nevoie reîncărcat la fiecare
-- vizită: dată reală de creare, status real în text, referința comenzii.
CREATE TABLE IF NOT EXISTS "SamedayAwbImport" (
    "id"           TEXT NOT NULL,
    "awb"          TEXT NOT NULL,
    "marketplace"  TEXT,
    "createdDate"  TIMESTAMP(3),
    "deliveredAt"  TIMESTAMP(3),
    "statusText"   TEXT NOT NULL DEFAULT '',
    "codAmount"    DECIMAL(10,2),
    "codCurrency"  TEXT NOT NULL DEFAULT 'RON',
    "observations" TEXT,
    "orderRef"     TEXT,
    "cost"         DECIMAL(10,2),
    "importedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamedayAwbImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SamedayAwbImport_awb_key" ON "SamedayAwbImport"("awb");
CREATE INDEX IF NOT EXISTS "SamedayAwbImport_createdDate_idx" ON "SamedayAwbImport"("createdDate");
CREATE INDEX IF NOT EXISTS "SamedayAwbImport_orderRef_idx" ON "SamedayAwbImport"("orderRef");
