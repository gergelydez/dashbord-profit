/**
 * POST /api/mail/connect/yahoo { email, appPassword }
 * Tests the IMAP app-password login before saving anything, then stores it
 * encrypted and records the current mailbox UID as the incremental-sync
 * baseline (older mail is caught up separately via backfill).
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { testConnection, getCurrentUid } from '@/lib/mail/imap-client';
import { encrypt } from '@/lib/security/crypt';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { email, appPassword } = (await request.json()) as { email?: string; appPassword?: string };
    if (!email || !appPassword) {
      return NextResponse.json({ error: 'email și appPassword sunt obligatorii' }, { status: 400 });
    }

    await testConnection({ email, appPassword });
    const uid = await getCurrentUid({ email, appPassword });

    const account = await db.mailAccount.upsert({
      where: { email },
      create: { provider: 'yahoo', email, appPassword: encrypt(appPassword), active: true, lastSyncCursor: String(uid) },
      update: { provider: 'yahoo', appPassword: encrypt(appPassword), active: true, lastSyncCursor: String(uid) },
    });

    return NextResponse.json({ ok: true, account: { id: account.id, email: account.email, provider: account.provider } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
