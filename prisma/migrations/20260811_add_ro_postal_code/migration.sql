-- Local Romanian postal code dataset for /api/validate-address (judet/localitate/strada -> zip)
CREATE TABLE IF NOT EXISTS "RoPostalCode" (
    "id" SERIAL PRIMARY KEY,
    "judet" TEXT NOT NULL,
    "localitate" TEXT NOT NULL,
    "strada" TEXT,
    "zip" TEXT NOT NULL,
    "judetNorm" TEXT NOT NULL,
    "localitateNorm" TEXT NOT NULL,
    "stradaNorm" TEXT
);

CREATE INDEX IF NOT EXISTS "RoPostalCode_zip_idx" ON "RoPostalCode" ("zip");
CREATE INDEX IF NOT EXISTS "RoPostalCode_judetNorm_localitateNorm_idx" ON "RoPostalCode" ("judetNorm", "localitateNorm");
CREATE INDEX IF NOT EXISTS "RoPostalCode_judetNorm_localitateNorm_stradaNorm_idx" ON "RoPostalCode" ("judetNorm", "localitateNorm", "stradaNorm");
