/**
 * POST /api/mail/manual-upload-receptie — manual upload for customs/receiving
 * paperwork (transport invoices, NIR, supplier invoices) that doesn't arrive
 * by email. The client always sends a PDF (an .xlsx like the transport
 * commercial invoice is converted to PDF client-side before this call, per
 * requirement — Recepție only ever holds PDFs).
 *
 * Routing, in order:
 *  1. Filename matches "Invoice_<invoiceNumber>_tracking<awb>" (the transport
 *     commercial invoice) — record the invoiceNumber→awb link for later
 *     documents that only know the invoice number, then file under that AWB.
 *  2. Filename itself contains an AWB (matches lib/mail/classify.ts's
 *     extractAwb — e.g. "9485142461_inv50.pdf") — file under that AWB
 *     directly, no lookup needed.
 *  3. PDF text mentions an invoice number (NIR: "Factura SX6193524801", or
 *     generic "Invoice No: X") and a link for it already exists — file under
 *     the linked AWB.
 *  4. Invoice number found but no link yet (e.g. the NIR arrived before the
 *     transport invoice) — filed as unclassified with the invoice number in
 *     the subject, so step 1 above can reconcile it retroactively once the
 *     transport invoice does show up (see the reconcile step below).
 *  5. Nothing found — plain Neclasificate, same as the email pipeline's
 *     default when a sender/pattern isn't recognized.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { getOrCreateMonthPath, uploadFile, moveFile } from '@/lib/google/drive';
import { extractAwb } from '@/lib/mail/classify';
import { extractInvoiceAwbFromFilename, extractInvoiceNumberFromText, recordInvoiceAwbLink, lookupAwbByInvoiceNumber } from '@/lib/mail/invoice-awb-link';
import pdf from 'pdf-parse/lib/pdf-parse.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function toAwbSubcategory(raw: string): string {
  return raw.toUpperCase().startsWith('AWB-') ? raw.toUpperCase() : `AWB-${raw}`;
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

    let awb: string | null = null;
    let invoiceNumber: string | null = null;
    let newlyLinked = false;

    const transportMatch = extractInvoiceAwbFromFilename(filename);
    if (transportMatch) {
      awb = transportMatch.awb;
      invoiceNumber = transportMatch.invoiceNumber;
      await recordInvoiceAwbLink(invoiceNumber, awb);
      newlyLinked = true;
    } else {
      const directAwb = extractAwb(filename);
      if (directAwb) {
        awb = directAwb.replace(/^AWB-/i, '');
      } else {
        try {
          const text = (await pdf(buffer)).text;
          invoiceNumber = extractInvoiceNumberFromText(text);
          if (invoiceNumber) awb = await lookupAwbByInvoiceNumber(invoiceNumber);
        } catch {
          // unreadable PDF text — falls through to Neclasificate below
        }
      }
    }

    const category = awb ? 'Recepție' : 'Neclasificate';
    const subcategory = awb ? toAwbSubcategory(awb) : null;
    const subject = invoiceNumber && !awb
      ? `Așteaptă asociere AWB pentru factura ${invoiceNumber}`
      : (invoiceNumber ? `Factură: ${invoiceNumber}` : filename);

    const key = {
      mailAccountId_messageId_filename: { mailAccountId: googleAccount.id, messageId: `manual:${filename}`, filename },
    };
    const existing = await db.ingestedDocument.findUnique({ where: key });
    if (existing) {
      return NextResponse.json({ ok: true, uploaded: false, status: 'duplicate', filename, awb, invoiceNumber });
    }

    const folderId = await getOrCreateMonthPath(auth, month, category, subcategory);
    const { fileId, webViewLink } = await uploadFile(auth, filename, folderId, buffer, 'application/pdf');

    await db.ingestedDocument.create({
      data: {
        mailAccountId: googleAccount.id,
        messageId: `manual:${filename}`,
        senderEmail: 'incarcare-manuala@receptie',
        subject,
        category,
        subcategory,
        month,
        filename,
        mimeType: 'application/pdf',
        driveFileId: fileId,
        driveUrl: webViewLink,
        status: awb ? 'ingested' : 'unclassified',
        receivedAt: new Date(),
      },
    });

    // A transport invoice just got linked — reconcile any earlier upload that
    // was waiting on this exact invoice number (e.g. the NIR arrived first).
    let reconciled = 0;
    if (newlyLinked && invoiceNumber) {
      const pending = await db.ingestedDocument.findMany({
        where: { status: 'unclassified', subject: `Așteaptă asociere AWB pentru factura ${invoiceNumber}` },
      });
      for (const doc of pending) {
        const targetSub = toAwbSubcategory(awb!);
        const targetFolder = await getOrCreateMonthPath(auth, doc.month, 'Recepție', targetSub);
        if (doc.driveFileId) await moveFile(auth, doc.driveFileId, targetFolder);
        await db.ingestedDocument.update({
          where: { id: doc.id },
          data: { category: 'Recepție', subcategory: targetSub, status: 'ingested' },
        });
        reconciled++;
      }
    }

    return NextResponse.json({ ok: true, uploaded: true, filename, awb, invoiceNumber, category, subcategory, reconciled });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
