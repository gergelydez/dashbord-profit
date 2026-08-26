/**
 * POST /api/mail/reclassify — re-applies the current SortRule set to every
 * already-ingested document. Needed because ingest.ts classifies once at
 * upload time and never re-touches a document afterwards, so adding/editing
 * rules (e.g. splitting GLS into Rambursuri vs Facturi transport by
 * filename) has no effect on mail that arrived before the rule existed —
 * this route is what actually moves those older files into the right
 * Drive subfolder and updates the DB record to match.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { getOrCreateMonthPath, moveFile, trashFile } from '@/lib/google/drive';
import { classifyAttachment, isIgnored } from '@/lib/mail/classify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
    if (!googleAccount?.refreshToken) return NextResponse.json({ error: 'Cont Google neconectat' }, { status: 400 });
    const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));

    const docs = await db.ingestedDocument.findMany({ where: { status: { in: ['ingested', 'unclassified'] } } });

    let changed = 0;
    for (const doc of docs) {
      // Manually uploaded documents (Meta invoices via /api/mail/manual-upload,
      // Recepție documents via /api/mail/manual-upload-receptie) are classified
      // directly at upload time — there's no real sender, so no SortRule can
      // ever match them. Re-running classifyAttachment on them here would
      // always come up empty and wrongly bounce them into Neclasificate
      // (confirmed: this happened to 49 already-classified Meta invoices the
      // first time this ran) — skip them entirely instead of re-deriving.
      if (doc.messageId.startsWith('manual:')) continue;

      const { category, subcategory } = await classifyAttachment(doc.senderEmail, doc.filename, doc.subject);

      if (isIgnored(category)) {
        if (doc.driveFileId) await trashFile(auth, doc.driveFileId).catch(() => {});
        await db.ingestedDocument.delete({ where: { id: doc.id } });
        changed++;
        continue;
      }

      if (category === doc.category && subcategory === doc.subcategory) continue;

      if (doc.driveFileId) {
        const folderId = await getOrCreateMonthPath(auth, doc.month, category, subcategory);
        await moveFile(auth, doc.driveFileId, folderId);
      }

      await db.ingestedDocument.update({
        where: { id: doc.id },
        data: { category, subcategory, status: category === 'Neclasificate' ? 'unclassified' : 'ingested' },
      });
      changed++;
    }

    return NextResponse.json({ ok: true, checked: docs.length, changed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
