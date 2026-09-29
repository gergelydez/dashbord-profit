-- gls-sync scria "deliveredAt" pe Shipment de la implementarea auto-colectării
-- (sesiunea anterioară), dar coloana n-a existat niciodată în DB — update-ul
-- pica silențios de fiecare dată când un colet ajungea DELIVERED, așa că
-- Shipment.status nu se mai actualiza deloc pentru livrări reale, iar
-- auto-collect-on-delivery nu a pornit niciodată.
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
