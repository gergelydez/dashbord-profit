/**
 * GET/POST /api/mail/sync — incremental sync for every connected, active
 * mailbox: only messages received since the last successful sync. Called by
 * the daily Vercel Cron (vercel.json) AND by the "Sincronizează acum" button
 * in /documente — the cron alone (once/day on Hobby plan) is too slow for
 * same-day filing, the button is the primary way this actually gets used.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { listNewMessageIds, fetchMessage, getCurrentHistoryId } from '@/lib/mail/gmail-client';
import { fetchNewMessages } from '@/lib/mail/imap-client';
import { ingestMessages } from '@/lib/mail/ingest';

interface AccountResult {
  email: string;
  ingested: number;
  failed: number;
  error?: string;
}

export async function GET() {
  const accounts = await db.mailAccount.findMany({ where: { active: true } });
  const results: AccountResult[] = [];

  for (const account of accounts) {
    try {
      if (account.provider === 'gmail') {
        if (!account.refreshToken) throw new Error('Lipsește refresh token');
        const auth = getAuthorizedClient(account.id, decrypt(account.refreshToken));

        let messageIds: string[] = [];
        let newCursor: string;
        try {
          if (!account.lastSyncCursor) throw new Error('HISTORY_ID_EXPIRED');
          const r = await listNewMessageIds(auth, account.lastSyncCursor);
          messageIds = r.messageIds;
          newCursor = r.newHistoryId;
        } catch (e) {
          if ((e as Error).message === 'HISTORY_ID_EXPIRED') {
            // Cursor missing or too old (Gmail retains ~1 week of history) —
            // reset the baseline to "now"; use backfill to catch up anything missed.
            newCursor = await getCurrentHistoryId(auth);
          } else {
            throw e;
          }
        }

        const messages = [];
        for (const id of messageIds) {
          const msg = await fetchMessage(auth, id);
          if (msg) messages.push(msg);
        }
        const r = await ingestMessages(account.id, messages);
        await db.mailAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date(), lastSyncCursor: newCursor } });
        results.push({ email: account.email, ...r });
      } else if (account.provider === 'yahoo') {
        if (!account.appPassword) throw new Error('Lipsește parola de aplicație');
        const creds = { email: account.email, appPassword: decrypt(account.appPassword) };
        const sinceUid = parseInt(account.lastSyncCursor || '0', 10);
        const { messages, lastUid } = await fetchNewMessages(creds, sinceUid);
        const r = await ingestMessages(account.id, messages);
        await db.mailAccount.update({
          where: { id: account.id },
          data: { lastSyncAt: new Date(), lastSyncCursor: lastUid !== null ? String(lastUid) : account.lastSyncCursor },
        });
        results.push({ email: account.email, ...r });
      }
    } catch (e) {
      results.push({ email: account.email, ingested: 0, failed: 0, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, results });
}

export const POST = GET;
