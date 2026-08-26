/**
 * POST /api/mail/stats/compute — sums every "GLS / Rambursuri" xlsx already
 * ingested for a month and writes the total into MonthlyStat.glsIncasat, so
 * the card doesn't have to be filled in by hand once the documents are in.
 * Sameday isn't wired up yet — its remittance file format hasn't been
 * confirmed against a real sample.
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

    const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
    const auth = googleAccount?.refreshToken
      ? getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken))
      : null;

    let total = 0;
    let filesUsed = 0;
    const errors: string[] = [];
    for (const doc of docs) {
      try {
        let buffer: Buffer | null = null;
        if (doc.fileData) buffer = Buffer.from(doc.fileData);
        else if (doc.driveFileId && auth) buffer = await downloadFile(auth, doc.driveFileId);
        if (!buffer) { errors.push(`${doc.filename}: fără date (nici Drive, nici fallback)`); continue; }
        const sum = sumGlsRambursuriXlsx(buffer);
        if (sum === 0) errors.push(`${doc.filename}: 0 detectat — verifică formatul`);
        total += sum;
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

    return NextResponse.json({ ok: true, total, filesUsed, checked: docs.length, errors, stat });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
