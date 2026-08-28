/**
 * GET /api/mail/combine-pdfs?month=&category=&subcategory= — merges every
 * matching PDF into a single PDF, streamed inline so a phone's built-in PDF
 * viewer opens it directly with its own print/share button — one tap
 * instead of opening and printing each file separately.
 *
 * `category` is optional: omitting it combines every PDF in the whole
 * month across all categories (the "print everything at once" button),
 * confirmed needed at real scale — up to ~200 files in one month. Drive
 * downloads run with bounded concurrency instead of one-at-a-time so that
 * volume finishes inside the serverless function's time limit; the actual
 * page-merge is cheap and stays sequential to keep page order stable
 * (grouped by category/subcategory, oldest first within each).
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
import type { IngestedDocument } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DOWNLOAD_CONCURRENCY = 8;

async function downloadAll(auth: ReturnType<typeof getAuthorizedClient>, docs: IngestedDocument[]): Promise<(Buffer | null)[]> {
  const buffers: (Buffer | null)[] = new Array(docs.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < docs.length) {
      const i = next++;
      const fileId = docs[i].driveFileId;
      if (!fileId) continue;
      try {
        buffers[i] = await downloadFile(auth, fileId);
      } catch {
        buffers[i] = null; // a single unreachable file shouldn't block the rest
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, docs.length) }, worker));
  return buffers;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const category = searchParams.get('category');
  const subcategory = searchParams.get('subcategory');
  if (!month) return NextResponse.json({ error: 'month lipsă' }, { status: 400 });

  const where = category
    ? { month, category, subcategory: subcategory || null, driveFileId: { not: null } }
    : { month, driveFileId: { not: null } };

  const allDocs = await db.ingestedDocument.findMany({
    where,
    orderBy: [{ category: 'asc' }, { subcategory: 'asc' }, { receivedAt: 'asc' }],
  });
  const docs = allDocs.filter(d => /\.pdf$/i.test(d.filename));
  if (docs.length === 0) return NextResponse.json({ error: 'Niciun PDF găsit' }, { status: 404 });

  const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
  if (!googleAccount?.refreshToken) return NextResponse.json({ error: 'Cont Google neconectat' }, { status: 400 });
  const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));

  const buffers = await downloadAll(auth, docs);

  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    if (!buf) continue;
    try {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) merged.addPage(page);
    } catch {
      // A single unreadable/corrupt PDF shouldn't block the rest of the merge.
    }
  }
  if (merged.getPageCount() === 0) {
    return NextResponse.json({ error: 'Niciun PDF n-a putut fi citit' }, { status: 422 });
  }

  const bytes = await merged.save();
  const label = category ? (subcategory ? `${category}_${subcategory}` : category) : 'Toate';
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${label}_${month}.pdf"`,
    },
  });
}
