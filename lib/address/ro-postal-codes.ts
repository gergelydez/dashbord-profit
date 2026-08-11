/**
 * lib/address/ro-postal-codes.ts
 * Precise, offline Romanian postal-code validation backed by RoPostalCode
 * (seeded from prisma/data/ro-postal-codes.csv — see prisma/seed-postal-codes.ts).
 *
 * Replaces the old Geoapify/Nominatim-based validation: those are general
 * geocoders, not reliable for exact județ+localitate+stradă <-> cod poștal
 * matching in Romania. This queries a local dataset instead — instant, no
 * external API, no rate limits.
 */
import { db } from '@/lib/db';

// ─── Normalization ────────────────────────────────────────────────────────────
// Same normalization is applied at seed time (judetNorm/localitateNorm/stradaNorm
// columns) and at query time, so lookups are exact-match on an index instead of
// depending on a Postgres extension (e.g. unaccent) that may not be enabled.

export function normalizeText(s: string | null | undefined): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const STREET_PREFIXES = [
  'strada', 'str', 'bulevardul', 'bulevard', 'bd', 'b dul', 'aleea', 'al',
  'calea', 'soseaua', 'sos', 'piata', 'p ta', 'intrarea', 'intr',
  'fundatura', 'fnd', 'prelungirea', 'prel', 'drumul', 'dr',
];

/** Normalizes a street name and strips a leading "Strada"/"Bd."/etc. prefix, if any. */
export function normalizeStreet(s: string | null | undefined): string {
  const n = normalizeText(s);
  for (const p of STREET_PREFIXES) {
    if (n === p) return '';
    if (n.startsWith(p + ' ')) return n.slice(p.length + 1).trim();
  }
  return n;
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

export async function lookupByZip(zip: string) {
  return db.roPostalCode.findMany({ where: { zip: (zip || '').replace(/\D/g, '') }, take: 20 });
}

export async function lookupByLocation(judet: string, localitate: string, strada?: string) {
  const judetNorm = normalizeText(judet);
  const localitateNorm = normalizeText(localitate);
  const where: { judetNorm: string; localitateNorm: string; stradaNorm?: string } = { judetNorm, localitateNorm };
  if (strada) where.stradaNorm = normalizeStreet(strada);
  return db.roPostalCode.findMany({ where, take: 50 });
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface RoAddressInput {
  judet?: string | null;
  localitate?: string | null;
  strada?: string | null; // free-text address1, may include house number — used as a soft signal only
  zip?: string | null;
}

export interface RoAddressSuggestion {
  zip?: string;
  judet?: string;
  localitate?: string;
  streetHint?: string;
}

export interface RoAddressValidationResult {
  ok: boolean;
  issues: string[];
  zipMatchesLocation: boolean | null; // null = couldn't be determined (missing/unknown data)
  suggestion: RoAddressSuggestion | null;
}

export async function validateRoAddress(input: RoAddressInput): Promise<RoAddressValidationResult> {
  const judet = (input.judet || '').trim();
  const localitate = (input.localitate || '').trim();
  const zip = (input.zip || '').replace(/\D/g, '');
  const judetNorm = normalizeText(judet);
  const localitateNorm = normalizeText(localitate);

  const issues: string[] = [];
  let suggestion: RoAddressSuggestion | null = null;
  let zipMatchesLocation: boolean | null = null;

  if (zip && zip.length !== 6) {
    issues.push('Codul poștal nu are 6 cifre.');
  }

  if (!judetNorm || !localitateNorm) {
    issues.push('Județul sau localitatea lipsesc.');
    return { ok: false, issues, zipMatchesLocation: null, suggestion: null };
  }

  const locationRows = await db.roPostalCode.findMany({ where: { judetNorm, localitateNorm }, take: 500 });

  if (locationRows.length === 0) {
    // Localitatea nu a fost găsită sub acest județ — poate fi o eroare de județ, sau un typo.
    const sameNameElsewhere = await db.roPostalCode.findMany({
      where: { localitateNorm }, take: 10, distinct: ['judetNorm'],
    });
    if (sameNameElsewhere.length > 0) {
      const judete = sameNameElsewhere.map(r => r.judet).join(', ');
      issues.push(`Localitatea "${localitate}" nu există în județul "${judet}" — a fost găsită însă în: ${judete}.`);
      suggestion = { judet: sameNameElsewhere[0].judet };
    } else if (zip) {
      const byZip = await lookupByZip(zip);
      if (byZip.length) {
        issues.push(`Nu am găsit localitatea "${localitate}" în baza de date, dar codul poștal ${zip} corespunde localității ${byZip[0].localitate}, județul ${byZip[0].judet}.`);
        suggestion = { localitate: byZip[0].localitate, judet: byZip[0].judet };
      } else {
        issues.push(`Nu am găsit nici localitatea "${localitate}", nici codul poștal ${zip} în baza de date.`);
      }
    } else {
      issues.push(`Localitatea "${localitate}" nu a fost găsită în județul "${judet}".`);
    }
    return { ok: false, issues, zipMatchesLocation: null, suggestion };
  }

  const zipsForLocation = Array.from(new Set(locationRows.map(r => r.zip)));
  const hasMultipleZips = zipsForLocation.length > 1;

  if (zip) {
    zipMatchesLocation = zipsForLocation.includes(zip);
    if (!zipMatchesLocation) {
      const byZip = await lookupByZip(zip);
      if (byZip.length) {
        issues.push(`Codul poștal ${zip} corespunde de fapt localității ${byZip[0].localitate}, județul ${byZip[0].judet} — nu localității "${localitate}".`);
      }
      const correctZip = zipsForLocation[0];
      issues.push(`Pentru ${localitate}, județul ${judet}, codul poștal corect este ${correctZip}${hasMultipleZips ? ' (localitatea are mai multe coduri, în funcție de stradă)' : ''}.`);
      suggestion = { zip: correctZip };
    }
  } else {
    const correctZip = zipsForLocation[0];
    issues.push(`Codul poștal lipsește — pentru ${localitate}, județul ${judet}, ar trebui să fie ${correctZip}${hasMultipleZips ? ' (verifică și strada, localitatea are mai multe coduri)' : ''}.`);
    suggestion = { zip: correctZip };
  }

  // Verificare informativă pe stradă — doar când localitatea chiar are mai multe coduri poștale,
  // ca să nu semnalăm fals-pozitiv din potriviri aproximative de text pe nume de stradă.
  if (hasMultipleZips && input.strada) {
    const addrNorm = normalizeText(input.strada);
    const withStreet = locationRows.filter(r => r.stradaNorm);
    const match = withStreet.find(r => r.stradaNorm && addrNorm.includes(r.stradaNorm));
    if (match && zip && match.zip !== zip) {
      issues.push(`Notă: pentru strada "${match.strada}" din ${localitate}, codul poștal uzual este ${match.zip}.`);
      suggestion = { ...(suggestion || {}), zip: match.zip, streetHint: `${match.strada}: ${match.zip}` };
    }
  }

  return { ok: issues.length === 0, issues, zipMatchesLocation, suggestion };
}
