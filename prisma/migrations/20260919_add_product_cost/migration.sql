-- Cost de recepție per SKU, salvat din calculatorul de Import la fiecare NIR nou.
CREATE TABLE IF NOT EXISTS "ProductCost" (
    "sku" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "costRON" DECIMAL(12,2) NOT NULL,
    "costCuTvaRON" DECIMAL(12,2),
    "source" TEXT NOT NULL DEFAULT 'import',
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "ProductCost_name_idx" ON "ProductCost" ("name");
