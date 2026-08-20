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

export async function classifyAttachment(senderEmail: string, filename: string): Promise<Classification> {
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
  return { category: best.category, subcategory: best.subcategory };
}
