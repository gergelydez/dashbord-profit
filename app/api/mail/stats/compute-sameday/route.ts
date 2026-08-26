/**
 * POST /api/mail/stats/compute-sameday — sums every "Sameday / Rambursuri"
 * xlsx already ingested for a month and writes the total into
 * MonthlyStat.sdIncasat. Mirrors /api/mail/stats/compute (GLS).
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { downloadFile } from '@/lib/google/drive';
import { sumSamedayRambursuriXlsx } from '@/lib/mail/parse-sameday-rambursuri';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { month } = (await request.json()) as { month?: string };
    if (!month) return NextResponse.json({ error: 'month lipsă' }, { status: 400 });

    const docs = await db.ingestedDocument.findMany({
      where: { month, category: 'Sameday', subcategory: 'Rambursuri' },
    });

    const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
    const auth = googleAccount?.refreshToken
      ? getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken))
      : null;

    let total = 0;
    let filesUsed = 0;
    const errors: string[] = [];
    const perFile: { filename: string; headerFound: boolean; total: number; sheetNames: string[]; rowCount: number; source: string; driveUrl: string | null }[] = [];

    for (const doc of docs) {
      try {
        let buffer: Buffer | null = null;
        let source = 'none';
        if (doc.driveFileId && auth) { buffer = await downloadFile(auth, doc.driveFileId); source = 'Drive'; }
        else if (doc.fileData) { buffer = Buffer.from(doc.fileData); source = 'fileData (DB fallback, nu Drive)'; }
        if (!buffer) { errors.push(`${doc.filename}: fără date (nici Drive, nici fallback)`); continue; }

        const result = sumSamedayRambursuriXlsx(buffer);
        perFile.push({ filename: doc.filename, headerFound: result.headerFound, total: result.total, sheetNames: result.sheetNames, rowCount: result.rowCount, source, driveUrl: doc.driveUrl });
        if (!result.headerFound) errors.push(`${doc.filename}: coloana sumei negăsită (sursă: ${source})`);
        total += result.total;
        filesUsed++;
      } catch (e) {
        errors.push(`${doc.filename}: ${(e as Error).message}`);
      }
    }
    total = Math.round(total * 100) / 100;

    const stat = await db.monthlyStat.upsert({
      where: { month },
      create: { month, sdIncasat: total },
      update: { sdIncasat: total },
    });

    return NextResponse.json({ ok: true, total, filesUsed, checked: docs.length, errors, perFile, stat });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
