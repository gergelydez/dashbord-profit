-- Local Hungarian postal code dataset for glato.hu addresses (megye/telepules/resz -> zip)
CREATE TABLE IF NOT EXISTS "HuPostalCode" (
    "id" SERIAL PRIMARY KEY,
    "megye" TEXT NOT NULL,
    "telepules" TEXT NOT NULL,
    "resz" TEXT,
    "zip" TEXT NOT NULL,
    "megyeNorm" TEXT NOT NULL,
    "telepulesNorm" TEXT NOT NULL,
    "reszNorm" TEXT
);

CREATE INDEX IF NOT EXISTS "HuPostalCode_zip_idx" ON "HuPostalCode" ("zip");
CREATE INDEX IF NOT EXISTS "HuPostalCode_megyeNorm_telepulesNorm_idx" ON "HuPostalCode" ("megyeNorm", "telepulesNorm");
