/**
 * POST /api/mail/manual-upload — handles one PDF at a time (the client
 * unzips a Meta "Transactions" export in-browser and posts each PDF
 * separately, since a whole export zip can be 10+ MB — well past what a
 * single Vercel serverless request body should carry).
 *
 * Only invoices whose in-PDF status is "Paid" get uploaded to Drive and
 * recorded — "Failed" transactions are real Meta line items that never
 * actually charged the card, so they must never count toward spend or
 * clutter the archive. Idempotent per filename, so re-submitting the same
 * export twice doesn't create duplicates.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { getOrCreateMonthPath, uploadFile } from '@/lib/google/drive';
import { parseMetaInvoicePdf, monthFromMetaFilename } from '@/lib/mail/parse-meta-invoice';

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

    const buffer = Buffer.from(await file.arrayBuffer());
    const info = await parseMetaInvoicePdf(buffer);

    if (info.status !== 'paid') {
      return NextResponse.json({ ok: true, uploaded: false, status: info.status, filename });
    }

    const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
    if (!googleAccount?.refreshToken) return NextResponse.json({ error: 'Cont Google neconectat' }, { status: 400 });

    const month =
      monthFromMetaFilename(filename) ||
      (info.invoiceDate ? `${info.invoiceDate.getFullYear()}-${String(info.invoiceDate.getMonth() + 1).padStart(2, '0')}` : currentMonth());

    const key = {
      mailAccountId_messageId_filename: { mailAccountId: googleAccount.id, messageId: `manual:${filename}`, filename },
    };
    const existing = await db.ingestedDocument.findUnique({ where: key });
    if (existing) {
      return NextResponse.json({ ok: true, uploaded: false, status: 'duplicate', filename, month, amount: info.amount });
    }

    const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));
    const folderId = await getOrCreateMonthPath(auth, month, 'Facebook', null);
    const { fileId, webViewLink } = await uploadFile(auth, filename, folderId, buffer, 'application/pdf');

    await db.ingestedDocument.create({
      data: {
        mailAccountId: googleAccount.id,
        messageId: `manual:${filename}`,
        senderEmail: 'incarcare-manuala@meta-ads',
        subject: `Meta Ads — factură plătită${info.amount != null ? ` (${info.amount} RON)` : ''}`,
        category: 'Facebook',
        subcategory: null,
        month,
        filename,
        mimeType: 'application/pdf',
        driveFileId: fileId,
        driveUrl: webViewLink,
        status: 'ingested',
        amount: info.amount,
        receivedAt: info.invoiceDate || new Date(),
      },
    });

    return NextResponse.json({ ok: true, uploaded: true, status: 'paid', amount: info.amount, month, filename });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
