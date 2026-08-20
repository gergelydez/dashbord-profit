/**
 * POST /api/mail/backfill { mailAccountId, since } — one-off historical
 * import for a single account, independent of the incremental sync cursor
 * (lastSyncCursor is untouched, so this never interferes with normal sync).
 * Used right after connecting a new account (default `since` = 1st of the
 * current month) and can be re-run any time for any date range.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { listMessageIdsSince, fetchMessage } from '@/lib/mail/gmail-client';
import { fetchMessagesSince } from '@/lib/mail/imap-client';
import { ingestMessages } from '@/lib/mail/ingest';

export async function POST(request: Request) {
  try {
    const { mailAccountId, since } = (await request.json()) as { mailAccountId?: string; since?: string };
    if (!mailAccountId || !since) {
      return NextResponse.json({ error: 'mailAccountId și since sunt obligatorii' }, { status: 400 });
    }
    const account = await db.mailAccount.findUnique({ where: { id: mailAccountId } });
    if (!account) return NextResponse.json({ error: 'Cont negăsit' }, { status: 404 });

    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) return NextResponse.json({ error: 'since invalid' }, { status: 400 });

    if (account.provider === 'gmail') {
      if (!account.refreshToken) throw new Error('Lipsește refresh token');
      const auth = getAuthorizedClient(account.id, decrypt(account.refreshToken));
      const ids = await listMessageIdsSince(auth, sinceDate);
      const messages = [];
      for (const id of ids) {
        const msg = await fetchMessage(auth, id);
        if (msg) messages.push(msg);
      }
      const r = await ingestMessages(account.id, messages);
      return NextResponse.json({ ok: true, ...r, checked: ids.length });
    }

    if (account.provider === 'yahoo') {
      if (!account.appPassword) throw new Error('Lipsește parola de aplicație');
      const creds = { email: account.email, appPassword: decrypt(account.appPassword) };
      const { messages } = await fetchMessagesSince(creds, sinceDate);
      const r = await ingestMessages(account.id, messages);
      return NextResponse.json({ ok: true, ...r, checked: messages.length });
    }

    return NextResponse.json({ error: 'Provider necunoscut' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
