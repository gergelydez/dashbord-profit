/**
 * POST /api/mail/manual-upload-extras — manual upload for bank statements
 * ("extrase bancare"). Unlike Recepție, this is pure archival: no AWB
 * matching, no content parsing, no invoice linking — the bank never emails
 * these, so they always arrive this way, and there's nothing to classify
 * beyond "this month's Extras folder". Idempotent via the same
 * `manual:<filename>` messageId convention as the other manual uploads.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { getOrCreateMonthPath, uploadFile } from '@/lib/google/drive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'file lipsă' }, { status: 400 });
    const filename = (form.get('filename') as string) || 'document.pdf';
    const month = (form.get('month') as string) || currentMonth();

    const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
    if (!googleAccount?.refreshToken) return NextResponse.json({ error: 'Cont Google neconectat' }, { status: 400 });
    const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = filename.toLowerCase().endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';

    const key = {
      mailAccountId_messageId_filename: { mailAccountId: googleAccount.id, messageId: `manual:${filename}`, filename },
    };
    const existing = await db.ingestedDocument.findUnique({ where: key });
    if (existing) {
      return NextResponse.json({ ok: true, uploaded: false, status: 'duplicate', filename });
    }

    const folderId = await getOrCreateMonthPath(auth, month, 'Extras', null);
    const { fileId, webViewLink } = await uploadFile(auth, filename, folderId, buffer, mimeType);

    await db.ingestedDocument.create({
      data: {
        mailAccountId: googleAccount.id,
        messageId: `manual:${filename}`,
        senderEmail: 'incarcare-manuala@extras',
        subject: filename,
        category: 'Extras',
        subcategory: null,
        month,
        filename,
        mimeType,
        driveFileId: fileId,
        driveUrl: webViewLink,
        status: 'ingested',
        receivedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, uploaded: true, filename });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
