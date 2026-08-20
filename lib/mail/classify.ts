/**
 * lib/mail/classify.ts
 * Matches a message's sender against SortRule (exact email first, then
 * domain). No match → 'Neclasificate', reviewed by hand from /documente,
 * which can create a new rule from there so future mail from the same
 * sender classifies automatically.
 */
import { db } from '@/lib/db';

export interface Classification {
  category: string;
  subcategory: string | null;
}

const UNCLASSIFIED: Classification = { category: 'Neclasificate', subcategory: null };

export async function classifySender(senderEmail: string): Promise<Classification> {
  const email = (senderEmail || '').trim().toLowerCase();
  if (!email) return UNCLASSIFIED;
  const domain = email.split('@')[1] || '';

  const rules = await db.sortRule.findMany();

  const exact = rules.find(r => r.matchType === 'sender_email' && r.matchValue.toLowerCase() === email);
  if (exact) return { category: exact.category, subcategory: exact.subcategory };

  const byDomain = domain
    ? rules.find(r => r.matchType === 'sender_domain' && r.matchValue.toLowerCase() === domain)
    : undefined;
  if (byDomain) return { category: byDomain.category, subcategory: byDomain.subcategory };

  return UNCLASSIFIED;
}
