-- GlsParcelSnapshot — persistă coletele GLS trase live (MyGLS + status +
-- atribuire magazin) din Statistici Totale, ca lunile ÎNCHEIATE (nu luna
-- curentă) să nu mai fie nevoie retrase din MyGLS de fiecare dată.
CREATE TABLE IF NOT EXISTS "GlsParcelSnapshot" (
    "id"           TEXT NOT NULL,
    "parcelNumber" TEXT NOT NULL,
    "clientRef"    TEXT,
    "pickupDate"   TIMESTAMP(3),
    "deliveryName" TEXT,
    "deliveryCity" TEXT,
    "cod"          DECIMAL(10,2),
    "codCurrency"  TEXT,
    "shopKey"      TEXT NOT NULL,
    "delivered"    BOOLEAN NOT NULL DEFAULT false,
    "returned"     BOOLEAN NOT NULL DEFAULT false,
    "hasStatus"    BOOLEAN NOT NULL DEFAULT true,
    "importedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlsParcelSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GlsParcelSnapshot_parcelNumber_key" ON "GlsParcelSnapshot"("parcelNumber");
CREATE INDEX IF NOT EXISTS "GlsParcelSnapshot_pickupDate_idx" ON "GlsParcelSnapshot"("pickupDate");
CREATE INDEX IF NOT EXISTS "GlsParcelSnapshot_shopKey_idx" ON "GlsParcelSnapshot"("shopKey");
