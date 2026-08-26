/**
 * GET /api/mail/documents?month=&status= — list for the folder browser.
 * PATCH — reclassify a document (typically one sitting in "Neclasificate"):
 * moves the actual Drive file into the correct folder and, optionally,
 * creates a SortRule so future mail from the same domain classifies
 * automatically.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { getOrCreateMonthPath, uploadFile, moveFile, trashFile } from '@/lib/google/drive';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const status = searchParams.get('status');

  const where: { month?: string; status?: string } = {};
  if (month) where.month = month;
  if (status) where.status = status;

  const documents = await db.ingestedDocument.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true, senderEmail: true, subject: true, category: true, subcategory: true,
      month: true, filename: true, mimeType: true, driveUrl: true, status: true, receivedAt: true,
    },
  });
  return NextResponse.json({ documents });
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { id?: string; category?: string; subcategory?: string; createRule?: boolean };
    const { id, category, subcategory, createRule } = body;
    if (!id || !category) return NextResponse.json({ error: 'id și category sunt obligatorii' }, { status: 400 });

    const doc = await db.ingestedDocument.findUnique({ where: { id } });
    if (!doc) return NextResponse.json({ error: 'Document negăsit' }, { status: 404 });

    const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
    if (!googleAccount?.refreshToken) return NextResponse.json({ error: 'Cont Google neconectat' }, { status: 400 });
    const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));

    const folderId = await getOrCreateMonthPath(auth, doc.month, category, subcategory || null);

    let driveFileId = doc.driveFileId;
    let driveUrl = doc.driveUrl;
    if (driveFileId) {
      await moveFile(auth, driveFileId, folderId);
    } else if (doc.fileData) {
      const uploaded = await uploadFile(auth, doc.filename, folderId, Buffer.from(doc.fileData), doc.mimeType);
      driveFileId = uploaded.fileId;
      driveUrl = uploaded.webViewLink;
    }

    await db.ingestedDocument.update({
      where: { id },
      data: { category, subcategory: subcategory || null, status: 'ingested', driveFileId, driveUrl, fileData: null },
    });

    if (createRule) {
      const domain = doc.senderEmail.split('@')[1] || '';
      if (domain) {
        await db.sortRule.create({
          data: { category, subcategory: subcategory || null, matchType: 'sender_domain', matchValue: domain },
        }).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** DELETE ?id= — trashes the Drive file (if any) and drops the DB row. Used when
 * a document turns out to be from a sender the user wants to ignore entirely. */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id lipsă' }, { status: 400 });

    const doc = await db.ingestedDocument.findUnique({ where: { id } });
    if (!doc) return NextResponse.json({ ok: true }); // already gone

    if (doc.driveFileId) {
      const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
      if (googleAccount?.refreshToken) {
        const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));
        await trashFile(auth, doc.driveFileId).catch(() => {});
      }
    }

    await db.ingestedDocument.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
