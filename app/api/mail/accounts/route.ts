/**
 * GET /api/mail/accounts — connected mailboxes for the Documente page.
 * DELETE ?id= — disconnects (soft: marks inactive, keeps ingestion history).
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const accounts = await db.mailAccount.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, provider: true, email: true, active: true, lastSyncAt: true, createdAt: true },
  });
  return NextResponse.json({ accounts });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id lipsă' }, { status: 400 });
  await db.mailAccount.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
