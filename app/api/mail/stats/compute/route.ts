/**
 * POST /api/mail/stats/compute — sums every "GLS / Rambursuri" xlsx already
 * ingested for a month and writes the total into MonthlyStat.glsIncasat, so
 * the card doesn't have to be filled in by hand once the documents are in.
 * See /api/mail/stats/compute-sameday for the Sameday equivalent.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { downloadFile } from '@/lib/google/drive';
import { sumGlsRambursuriXlsx } from '@/lib/mail/parse-gls-rambursuri';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { month } = (await request.json()) as { month?: string };
    if (!month) return NextResponse.json({ error: 'month lipsă' }, { status: 400 });

    const docs = await db.ingestedDocument.findMany({
      where: { month, category: 'GLS', subcategory: 'Rambursuri' },
    });

    // Detect duplicate filenames anywhere in the month (any category/status) —
    // if GLS sends more than one attachment per day sharing the same
    // filename (e.g. a short reference list AND the full statement), a
    // "Vezi" click in the folder browser and this compute pass could be
    // looking at two different underlying Drive files despite an identical
    // displayed name.
    const allMonthDocs = await db.ingestedDocument.findMany({
      where: { month, filename: { in: docs.map(d => d.filename) } },
      select: { filename: true, messageId: true, category: true, status: true },
    });
    const duplicates = Object.entries(
      allMonthDocs.reduce<Record<string, number>>((acc, d) => {
        acc[d.filename] = (acc[d.filename] || 0) + 1;
        return acc;
      }, {}),
    ).filter(([, count]) => count > 1);

    const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
    const auth = googleAccount?.refreshToken
      ? getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken))
      : null;

    let total = 0;
    let filesUsed = 0;
    const errors: string[] = [];
    const perFile: { filename: string; headerFound: boolean; total: number; sheetNames: string[]; rowCount: number; source: string; headerHex?: string; driveUrl: string | null; messageId: string }[] = [];
    let debug: { filename: string; bufferBytes: number; sheetNames: string[]; rowCount: number; sampleRows?: string[][]; source: string; headerHex?: string } | undefined;

    for (const doc of docs) {
      try {
        let buffer: Buffer | null = null;
        let source = 'none';
        if (doc.driveFileId && auth) { buffer = await downloadFile(auth, doc.driveFileId); source = 'Drive'; }
        else if (doc.fileData) { buffer = Buffer.from(doc.fileData); source = 'fileData (DB fallback, nu Drive)'; }
        if (!buffer) { errors.push(`${doc.filename}: fără date (nici Drive, nici fallback)`); continue; }

        const result = sumGlsRambursuriXlsx(buffer);
        perFile.push({ filename: doc.filename, headerFound: result.headerFound, total: result.total, sheetNames: result.sheetNames, rowCount: result.rowCount, source, headerHex: result.headerHex, driveUrl: doc.driveUrl, messageId: doc.messageId });
        if (!result.headerFound) {
          errors.push(`${doc.filename}: header „Sumă ramburs" negăsit (sursă: ${source})`);
          if (!debug) {
            debug = { filename: doc.filename, bufferBytes: buffer.length, sheetNames: result.sheetNames, rowCount: result.rowCount, sampleRows: result.sampleRows, source, headerHex: result.headerHex };
          }
        }
        total += result.total;
        filesUsed++;
      } catch (e) {
        errors.push(`${doc.filename}: ${(e as Error).message}`);
      }
    }
    total = Math.round(total * 100) / 100;

    const stat = await db.monthlyStat.upsert({
      where: { month },
      create: { month, glsIncasat: total },
      update: { glsIncasat: total },
    });

    return NextResponse.json({ ok: true, total, filesUsed, checked: docs.length, errors, debug, perFile, duplicates, stat });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
