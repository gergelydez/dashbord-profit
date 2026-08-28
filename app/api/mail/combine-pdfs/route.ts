/**
 * GET /api/mail/combine-pdfs?month=&category=&subcategory= — merges every
 * PDF in that folder into a single PDF, streamed inline so a phone's
 * built-in PDF viewer opens it directly with its own print/share button —
 * one tap instead of opening and printing N separate files.
 *
 * Runs server-side deliberately, unlike the xlsx→PDF conversion elsewhere
 * in this feature: pdf-lib is pure JS with no Worker/canvas dependency (the
 * class of problem that made pdf.js unreliable here), so none of that
 * risk applies to a page-merge operation.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { downloadFile } from '@/lib/google/drive';
import { PDFDocument } from 'pdf-lib';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const category = searchParams.get('category');
  const subcategory = searchParams.get('subcategory');
  if (!month || !category) return NextResponse.json({ error: 'month și category sunt obligatorii' }, { status: 400 });

  const allDocs = await db.ingestedDocument.findMany({
    where: { month, category, subcategory: subcategory || null, driveFileId: { not: null } },
    orderBy: { receivedAt: 'asc' },
  });
  const docs = allDocs.filter(d => /\.pdf$/i.test(d.filename));
  if (docs.length === 0) return NextResponse.json({ error: 'Niciun PDF găsit în acest folder' }, { status: 404 });

  const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
  if (!googleAccount?.refreshToken) return NextResponse.json({ error: 'Cont Google neconectat' }, { status: 400 });
  const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));

  const merged = await PDFDocument.create();
  for (const doc of docs) {
    if (!doc.driveFileId) continue;
    try {
      const buf = await downloadFile(auth, doc.driveFileId);
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) merged.addPage(page);
    } catch {
      // A single unreadable/corrupt PDF shouldn't block the rest of the merge.
    }
  }
  if (merged.getPageCount() === 0) {
    return NextResponse.json({ error: 'Niciun PDF din acest folder n-a putut fi citit' }, { status: 422 });
  }

  const bytes = await merged.save();
  const label = subcategory ? `${category}_${subcategory}` : category;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${label}_${month}.pdf"`,
    },
  });
}
