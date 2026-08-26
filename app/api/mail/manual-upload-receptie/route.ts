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
 *     extractAwb — e.g. "9485142461_inv50.pdf" or "Invoice_tracking<awb>.xlsx"
 *     with no invoice-number segment at all). The client-side xlsx→PDF
 *     conversion (app/documente/page.js's convertXlsxToPdf) also reads the
 *     invoice number straight out of the sheet's cells for exactly this case
 *     — confirmed real example: "Invoice_tracking1309608801.xlsx" has the
 *     tracking/AWB number in its filename but NOT the invoice number, so
 *     without this the invoiceNumber→awb link would never get recorded and
 *     the NIR that only knows the invoice number would never resolve. When
 *     the client sends that extracted invoiceNumber alongside, record the
 *     link here too, same as step 1.
 *  3. PDF text mentions an invoice number (NIR: "Factura SX6193524801", or
 *     generic "Invoice No: X") and a link for it already exists — file under
 *     the linked AWB.
 *  4. Invoice number found but no link yet (e.g. the NIR arrived before the
 *     transport invoice) — filed as unclassified with the invoice number in
 *     the subject, so step 1/2 above can reconcile it retroactively once the
 *     transport invoice does show up (see the reconcile step below).
 *  5. Nothing found — plain Neclasificate, same as the email pipeline's
 *     default when a sender/pattern isn't recognized.
 *
 * Re-uploading the SAME filename (confirmed real usage: retrying a file
 * stuck in "AWB negăsit" after a code fix, without deleting it first) must
 * not just bounce off as a duplicate — a document that's still 'unclassified'
 * gets its classification re-attempted and, if resolved this time, is moved
 * in place rather than re-uploaded as a second Drive file. Only an already
 * successfully-filed ('ingested') document short-circuits as a true no-op
 * duplicate.
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
    // Extracted client-side, straight from the original xlsx's cells, before
    // it got converted to PDF (the server never sees the original sheet) —
    // see the big comment above for why the filename alone isn't reliable.
    const formInvoiceNumber = (form.get('invoiceNumber') as string) || null;
    const formAwb = (form.get('awb') as string) || null;

    const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
    if (!googleAccount?.refreshToken) return NextResponse.json({ error: 'Cont Google neconectat' }, { status: 400 });
    const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));

    const buffer = Buffer.from(await file.arrayBuffer());

    const key = {
      mailAccountId_messageId_filename: { mailAccountId: googleAccount.id, messageId: `manual:${filename}`, filename },
    };
    const existing = await db.ingestedDocument.findUnique({ where: key });
    if (existing && existing.status !== 'unclassified') {
      return NextResponse.json({ ok: true, uploaded: false, status: 'duplicate', filename, awb: null, invoiceNumber: null });
    }

    let awb: string | null = null;
    let invoiceNumber: string | null = null;
    let newlyLinked = false;
    // Not used for routing — only surfaced back to the client so a still-
    // unresolved file shows exactly WHY, instead of guessing from screenshots
    // (the same instrumentation approach that root-caused the GLS parser bug).
    let path = 'none';
    let pdfTextSample: string | null = null;

    const transportMatch = extractInvoiceAwbFromFilename(filename);
    if (transportMatch) {
      awb = transportMatch.awb;
      invoiceNumber = transportMatch.invoiceNumber;
      await recordInvoiceAwbLink(invoiceNumber, awb);
      newlyLinked = true;
      path = 'filename:Invoice_<num>_tracking<awb>';
    } else {
      const directAwb = extractAwb(filename);
      if (directAwb) {
        awb = directAwb.replace(/^AWB-/i, '');
        // The filename carried an AWB but no invoice-number segment (e.g.
        // "Invoice_tracking1309608801.xlsx") — the client's cell-level
        // extraction is the only source for the invoice number in that
        // case, so record the link here too, not just in the branch above.
        if (formInvoiceNumber) {
          invoiceNumber = formInvoiceNumber;
          await recordInvoiceAwbLink(invoiceNumber, awb);
          newlyLinked = true;
          path = 'filename-awb+form-invoiceNumber';
        } else {
          path = 'filename-awb-only (nicio legătură invoice->awb creată)';
        }
      } else if (formAwb && formInvoiceNumber) {
        // Neither pattern matched the filename at all, but the client still
        // found both values by reading the sheet's cells directly.
        awb = formAwb;
        invoiceNumber = formInvoiceNumber;
        await recordInvoiceAwbLink(invoiceNumber, awb);
        newlyLinked = true;
        path = 'form-awb+form-invoiceNumber';
      } else {
        // Only PDF text extraction is allowed to fail silently (falls through
        // to Neclasificate below, same as "nothing recognizable") — a lookup
        // failure is a real system error (e.g. a missing table) and must
        // surface as one instead of being misreported as "no AWB found yet".
        const text = await pdf(buffer).then(r => r.text).catch(() => '');
        pdfTextSample = text.slice(0, 400);
        invoiceNumber = extractInvoiceNumberFromText(text) || formInvoiceNumber;
        if (invoiceNumber) {
          awb = await lookupAwbByInvoiceNumber(invoiceNumber);
          path = awb ? 'pdf-text-invoiceNumber+link-gasit' : 'pdf-text-invoiceNumber, dar niciun link salvat pentru el';
        } else {
          path = 'nimic gasit (nici filename, nici form, nici text PDF)';
        }
      }
    }

    const category = awb ? 'Receptie' : 'Neclasificate';
    const subcategory = awb ? toAwbSubcategory(awb) : null;
    const subject = invoiceNumber && !awb
      ? `Așteaptă asociere AWB pentru factura ${invoiceNumber}`
      : (invoiceNumber ? `Factură: ${invoiceNumber}` : filename);
    const debug = { path, formInvoiceNumber, formAwb, pdfTextSample };

    if (existing) {
      // Retrying a file that's still stuck as unclassified. If it's still
      // not resolved, leave it exactly as-is (no Drive/DB writes) instead of
      // erroring — same observable "pending" outcome as the first attempt.
      if (!awb) {
        return NextResponse.json({ ok: true, uploaded: false, status: 'pending', filename, awb: null, invoiceNumber, debug });
      }
      const targetFolder = await getOrCreateMonthPath(auth, existing.month, category, subcategory);
      if (existing.driveFileId) await moveFile(auth, existing.driveFileId, targetFolder);
      await db.ingestedDocument.update({
        where: { id: existing.id },
        data: { category, subcategory, subject, status: 'ingested' },
      });
    } else {
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
    }

    // A transport invoice just got linked — reconcile any earlier upload that
    // was waiting on this exact invoice number (e.g. the NIR arrived first).
    let reconciled = 0;
    if (newlyLinked && invoiceNumber) {
      const pending = await db.ingestedDocument.findMany({
        where: { status: 'unclassified', subject: `Așteaptă asociere AWB pentru factura ${invoiceNumber}` },
      });
      for (const doc of pending) {
        const targetSub = toAwbSubcategory(awb!);
        const targetFolder = await getOrCreateMonthPath(auth, doc.month, 'Receptie', targetSub);
        if (doc.driveFileId) await moveFile(auth, doc.driveFileId, targetFolder);
        await db.ingestedDocument.update({
          where: { id: doc.id },
          data: { category: 'Receptie', subcategory: targetSub, status: 'ingested' },
        });
        reconciled++;
      }
    }

    return NextResponse.json({ ok: true, uploaded: true, filename, awb, invoiceNumber, category, subcategory, reconciled, debug });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
