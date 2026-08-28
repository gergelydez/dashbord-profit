/**
 * GET /api/mail/download-file?id=<IngestedDocument.id> — streams the raw
 * bytes of one already-ingested document straight from Drive. Needed
 * because the server never keeps a parsed copy of anything: the client-side
 * "combine Excel, one page per file" feature (app/documente/page.js) has to
 * fetch each source .xlsx's actual bytes to parse them with XLSX.js in the
 * browser, the same way a fresh upload would.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { downloadFile } from '@/lib/google/drive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id lipsă' }, { status: 400 });

  const doc = await db.ingestedDocument.findUnique({ where: { id } });
  if (!doc?.driveFileId) return NextResponse.json({ error: 'Fișier negăsit pe Drive' }, { status: 404 });

  const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
  if (!googleAccount?.refreshToken) return NextResponse.json({ error: 'Cont Google neconectat' }, { status: 400 });
  const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));

  const buf = await downloadFile(auth, doc.driveFileId);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': doc.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${doc.filename}"`,
    },
  });
}
