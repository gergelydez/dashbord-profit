-- SamedayMonthSnapshot — persistă rezultatul (deja clasificat EMG/retur
-- client) al unei trageri live Sameday status-sync, per lună, ca lunile
-- încheiate să nu mai fie retrase din Sameday de fiecare dată.
CREATE TABLE IF NOT EXISTS "SamedayMonthSnapshot" (
    "id"               TEXT NOT NULL,
    "monthKey"         TEXT NOT NULL,
    "emagAwbs"         JSONB NOT NULL DEFAULT '[]',
    "clientReturnAwbs" JSONB NOT NULL DEFAULT '[]',
    "truncated"        BOOLEAN NOT NULL DEFAULT false,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamedayMonthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SamedayMonthSnapshot_monthKey_key" ON "SamedayMonthSnapshot"("monthKey");
