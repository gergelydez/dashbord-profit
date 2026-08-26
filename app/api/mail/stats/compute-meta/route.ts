/**
 * POST /api/mail/stats/compute-meta — re-downloads and re-parses every
 * "Facebook" (Meta Ads) document ingested for a month and writes the sum
 * into MonthlyStat.metaSpend, updating each document's stored `amount`
 * along the way.
 *
 * Deliberately re-parses from source every time rather than trusting the
 * `amount` column set at upload time: a real bug in the original amount
 * regex silently truncated any invoice ≥ 1000 (e.g. "RON1,866.20" parsed
 * as 1.866) — re-parsing here means fixing that regex self-heals every
 * past upload the next time this is pressed, no manual re-upload needed.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { downloadFile } from '@/lib/google/drive';
import { parseMetaInvoicePdf } from '@/lib/mail/parse-meta-invoice';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { month } = (await request.json()) as { month?: string };
    if (!month) return NextResponse.json({ error: 'month lipsă' }, { status: 400 });

    const docs = await db.ingestedDocument.findMany({ where: { month, category: 'Facebook' } });

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
        if (doc.driveFileId && auth) buffer = await downloadFile(auth, doc.driveFileId);
        else if (doc.fileData) buffer = Buffer.from(doc.fileData);
        if (!buffer) { errors.push(`${doc.filename}: fără date (nici Drive, nici fallback)`); continue; }

        const info = await parseMetaInvoicePdf(buffer);
        if (info.amount == null) { errors.push(`${doc.filename}: sumă nedetectată`); continue; }

        if (Number(doc.amount ?? -1) !== info.amount) {
          await db.ingestedDocument.update({ where: { id: doc.id }, data: { amount: info.amount } });
        }
        total += info.amount;
        filesUsed++;
      } catch (e) {
        errors.push(`${doc.filename}: ${(e as Error).message}`);
      }
    }
    total = Math.round(total * 100) / 100;

    const stat = await db.monthlyStat.upsert({
      where: { month },
      create: { month, metaSpend: total },
      update: { metaSpend: total },
    });

    return NextResponse.json({ ok: true, total, filesUsed, checked: docs.length, errors, stat });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
