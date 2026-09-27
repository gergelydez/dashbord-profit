/**
 * lib/address/hu-postal-codes.ts
 * Precise, offline Hungarian postal-code lookup backed by HuPostalCode
 * (seeded from prisma/data/hu-postal-codes.csv — see
 * lib/address/postal-seed-data.ts's loadHuPostalCodeRecords).
 *
 * Same role as lib/address/ro-postal-codes.ts, for glato.hu orders. Reuses
 * that file's normalizeText — no Hungary-specific street-prefix stripping is
 * needed since the source data has no street-level granularity, only an
 * optional "Településrész" (settlement part), used exactly like RO's
 * `strada` for disambiguating settlements with more than one postal code.
 */
import { db } from '@/lib/db';
import { normalizeText } from './ro-postal-codes';

export { normalizeText };

export async function lookupByZip(zip: string) {
  return db.huPostalCode.findMany({ where: { zip: (zip || '').replace(/\D/g, '') }, take: 20 });
}

export async function lookupByLocation(megye: string, telepules: string, resz?: string) {
  const megyeNorm = normalizeText(megye);
  const telepulesNorm = normalizeText(telepules);
  const where: { megyeNorm: string; telepulesNorm: string; reszNorm?: string } = { megyeNorm, telepulesNorm };
  if (resz) where.reszNorm = normalizeText(resz);
  return db.huPostalCode.findMany({ where, take: 50 });
}

/** Autocomplete: települések al căror nume începe cu `prefix`, opțional filtrate pe megye. */
export async function searchLocalities(prefix: string, megye?: string, limit = 15) {
  const p = normalizeText(prefix);
  if (!p) return [];
  const where: { telepulesNorm: { startsWith: string }; megyeNorm?: string } = { telepulesNorm: { startsWith: p } };
  if (megye) where.megyeNorm = normalizeText(megye);
  return db.huPostalCode.findMany({
    where,
    distinct: ['megyeNorm', 'telepulesNorm'],
    select: { megye: true, telepules: true },
    orderBy: { telepules: 'asc' },
    take: limit,
  });
}
