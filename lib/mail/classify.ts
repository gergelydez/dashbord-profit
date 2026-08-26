/**
 * lib/mail/classify.ts
 * Matches one attachment against SortRule, scored by specificity so the most
 * precise rule wins: a rule with a filenameContains filter outranks a
 * sender-only rule for the same sender (lets e.g. GLS split into
 * "Rambursuri" vs "Facturi transport" — same sender domain, different
 * attachment naming pattern — via two rules instead of one). Exact sender
 * email outranks sender domain at equal filename-specificity.
 * No match → 'Neclasificate', reviewed by hand from /documente, which can
 * create a new rule from there so future mail from the same sender/pattern
 * classifies automatically.
 */
import { db } from '@/lib/db';

export interface Classification {
  category: string;
  subcategory: string | null;
}

const UNCLASSIFIED: Classification = { category: 'Neclasificate', subcategory: null };

/** A rule whose category is "Ignorat" (any casing) marks a sender's mail as
 * noise — e.g. a noreply@ address whose attachments aren't worth keeping —
 * so it's skipped entirely instead of landing in Neclasificate. */
export function isIgnored(category: string): boolean {
  return category.trim().toLowerCase() === 'ignorat';
}

/** Sentinel a rule's subcategory can hold instead of a fixed string: means
 * "extract the AWB number from this message and use AWB-<number> as the
 * actual subcategory" — e.g. DHL customs-clearance mail, where every email
 * is a different shipment (a fixed subcategory would dump them all in one
 * folder) but the AWB always appears in the subject as "AWB: <digits>". */
export const AWB_SUBCATEGORY = '{AWB}';

/**
 * Not every DHL notification's subject actually says "AWB" (confirmed:
 * a "Formular de împuternicire" and other generic notices don't) — but
 * every DHL attachment filename seen so far carries the shipment number as
 * a bare digit run ("9485142461_awb50.pdf", "DHL_import_1309608801.pdf",
 * "7794472825.pdf"), so that's tried first as the more reliable signal;
 * an explicit "AWB: <digits>" label in either string is preferred over a
 * bare number when present, since it's unambiguous by construction.
 */
export function extractAwb(text: string): string | null {
  const labeled = (text || '').match(/AWB[:#\s]*#?(\d{6,})/i);
  if (labeled) return `AWB-${labeled[1]}`;
  const numbers = (text || '').match(/\d{6,}/g);
  if (!numbers || numbers.length === 0) return null;
  const longest = numbers.reduce((a, b) => (b.length > a.length ? b : a));
  return `AWB-${longest}`;
}

export async function classifyAttachment(senderEmail: string, filename: string, subject?: string): Promise<Classification> {
  const email = (senderEmail || '').trim().toLowerCase();
  if (!email) return UNCLASSIFIED;
  const domain = email.split('@')[1] || '';
  const fname = (filename || '').toLowerCase();

  const rules = await db.sortRule.findMany();

  const candidates = rules.filter(r => {
    if (r.matchType === 'sender_email' && r.matchValue.toLowerCase() !== email) return false;
    if (r.matchType === 'sender_domain' && (!domain || r.matchValue.toLowerCase() !== domain)) return false;
    if (r.filenameContains && !fname.includes(r.filenameContains.toLowerCase())) return false;
    return true;
  });
  if (candidates.length === 0) return UNCLASSIFIED;

  candidates.sort((a, b) => {
    const score = (r: (typeof candidates)[number]) => (r.filenameContains ? 2 : 0) + (r.matchType === 'sender_email' ? 1 : 0);
    return score(b) - score(a);
  });

  const best = candidates[0];
  if (best.subcategory === AWB_SUBCATEGORY) {
    const awb = extractAwb(filename || '') || extractAwb(subject || '');
    return { category: best.category, subcategory: awb };
  }
  return { category: best.category, subcategory: best.subcategory };
}
