/**
 * POST /api/mail/reconcile-drive — { month: "2026-08" }
 * The app's DB and Drive can drift apart whenever Drive is touched
 * directly instead of through the app: a file dragged in manually never
 * gets a matching IngestedDocument row, and a file (or whole folder)
 * deleted straight from Drive leaves its row behind pointing at nothing —
 * confirmed live: deleting a duplicate "Recepție" (diacritic) folder from
 * Drive left 2 stale rows still showing in the app under that category.
 *
 * Walks the real Drive tree for one month (Month/Category[/Subcategory]/
 * files, matching lib/google/drive.ts's own layout) and reconciles the DB
 * against what's actually there:
 *  - a Drive file with no matching IngestedDocument row gets one created
 *    (category/subcategory read straight from the folder it's sitting in
 *    — that's the ground truth now, not whatever classification rule
 *    would have applied by sender);
 *  - a DB row whose driveFileId isn't found anywhere in the walk gets
 *    deleted (the file — or its folder — was removed directly on Drive).
 * Never touches rows with no driveFileId at all (e.g. a Recepție upload
 * still waiting on its AWB) — those were never on Drive to begin with.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { getMonthFolderId, listChildren, FOLDER_MIME } from '@/lib/google/drive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface FoundFile {
  id: string;
  name: string;
  mimeType: string;
  category: string;
  subcategory: string | null;
}

export async function POST(request: Request) {
  try {
    const { month } = (await request.json()) as { month?: string };
    if (!month) return NextResponse.json({ error: 'month lipsă' }, { status: 400 });

    const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
    if (!googleAccount?.refreshToken) return NextResponse.json({ error: 'Cont Google neconectat' }, { status: 400 });
    const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));

    const monthId = await getMonthFolderId(auth, month);
    const categoryFolders = (await listChildren(auth, monthId)).filter(c => c.mimeType === FOLDER_MIME);

    const found: FoundFile[] = [];
    for (const cat of categoryFolders) {
      const children = await listChildren(auth, cat.id);
      for (const child of children) {
        if (child.mimeType === FOLDER_MIME) {
          const subFiles = await listChildren(auth, child.id);
          for (const f of subFiles) {
            if (f.mimeType !== FOLDER_MIME) found.push({ id: f.id, name: f.name, mimeType: f.mimeType, category: cat.name, subcategory: child.name });
          }
        } else {
          found.push({ id: child.id, name: child.name, mimeType: child.mimeType, category: cat.name, subcategory: null });
        }
      }
    }

    const existingDocs = await db.ingestedDocument.findMany({ where: { month } });
    const existingByDriveId = new Map(existingDocs.filter(d => d.driveFileId).map(d => [d.driveFileId as string, d]));
    const foundIds = new Set(found.map(f => f.id));

    let imported = 0;
    for (const f of found) {
      if (existingByDriveId.has(f.id)) continue;
      await db.ingestedDocument.create({
        data: {
          mailAccountId: googleAccount.id,
          messageId: `manual:drive-sync:${f.id}`,
          senderEmail: 'sincronizare-drive@auto',
          subject: f.name,
          category: f.category,
          subcategory: f.subcategory,
          month,
          filename: f.name,
          mimeType: f.mimeType,
          driveFileId: f.id,
          driveUrl: `https://drive.google.com/file/d/${f.id}/view`,
          status: 'ingested',
          receivedAt: new Date(),
        },
      });
      imported++;
    }

    let removed = 0;
    for (const doc of existingDocs) {
      if (doc.driveFileId && !foundIds.has(doc.driveFileId)) {
        await db.ingestedDocument.delete({ where: { id: doc.id } });
        removed++;
      }
    }

    return NextResponse.json({ ok: true, scanned: found.length, imported, removed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
