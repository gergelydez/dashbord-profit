/**
 * GET /api/mail/download-month?month=2026-08 — streams a single zip with
 * every ingested document for that month, organized into
 * Category/Subcategory folders inside the archive, pulled live from Drive.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { Readable, PassThrough } from 'stream';
import { ZipArchive } from 'archiver';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { downloadFile } from '@/lib/google/drive';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  if (!month) return NextResponse.json({ error: 'month lipsă' }, { status: 400 });

  const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
  if (!googleAccount?.refreshToken) return NextResponse.json({ error: 'Cont Google neconectat' }, { status: 400 });
  const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));

  const documents = await db.ingestedDocument.findMany({
    where: { month, driveFileId: { not: null } },
  });

  if (documents.length === 0) {
    return NextResponse.json({ error: 'Nicio comandă pentru această lună' }, { status: 404 });
  }

  const archive = new ZipArchive({ level: 9 });
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  (async () => {
    for (const doc of documents) {
      if (!doc.driveFileId) continue;
      try {
        const buf = await downloadFile(auth, doc.driveFileId);
        const folder = doc.subcategory ? `${doc.category}/${doc.subcategory}` : doc.category;
        archive.append(buf, { name: `${folder}/${doc.filename}` });
      } catch {
        // skip files that fail to download rather than aborting the whole zip
      }
    }
    await archive.finalize();
  })();

  return new NextResponse(Readable.toWeb(passthrough) as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Documente_${month}.zip"`,
    },
  });
}
