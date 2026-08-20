/**
 * lib/mail/gmail-client.ts
 * Reads Gmail messages + attachments via the Gmail API (gmail.readonly scope
 * only — never modifies, labels, or deletes anything in the mailbox).
 *
 * Two ways to discover messages:
 *  - listNewMessageIds(): incremental sync via history.list from a saved
 *    historyId cursor (MailAccount.lastSyncCursor).
 *  - listMessageIdsSince(): date-ranged backfill via messages.list + an
 *    `after:` search query, for mail received before the mailbox was connected.
 * Both just return message ids; fetchMessage() does the real work of pulling
 * headers + attachment bytes for one message.
 */
import type { OAuth2Client } from 'google-auth-library';
import { google, gmail_v1 } from 'googleapis';
import { FetchedAttachment, FetchedMessage, isRelevantAttachment } from './types';

/** Current Gmail historyId — the baseline cursor to store right after connecting a new account. */
export async function getCurrentHistoryId(auth: OAuth2Client): Promise<string> {
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.getProfile({ userId: 'me' });
  if (!res.data.historyId) throw new Error('Gmail nu a întors un historyId');
  return res.data.historyId;
}

/** Incremental: message ids added since `sinceHistoryId`, plus the new cursor to save. */
export async function listNewMessageIds(
  auth: OAuth2Client,
  sinceHistoryId: string,
): Promise<{ messageIds: string[]; newHistoryId: string }> {
  const gmail = google.gmail({ version: 'v1', auth });
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let newHistoryId = sinceHistoryId;

  do {
    let res;
    try {
      res = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: sinceHistoryId,
        historyTypes: ['messageAdded'],
        pageToken,
      });
    } catch (e) {
      // historyId too old (Gmail only retains ~1 week of history) — caller
      // should fall back to a backfill from the last known sync date instead.
      const status = (e as { code?: number }).code;
      if (status === 404) throw new Error('HISTORY_ID_EXPIRED');
      throw e;
    }

    for (const h of res.data.history || []) {
      for (const m of h.messagesAdded || []) {
        if (m.message?.id) ids.add(m.message.id);
      }
    }
    if (res.data.historyId) newHistoryId = res.data.historyId;
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return { messageIds: Array.from(ids), newHistoryId };
}

/** Backfill: message ids received on/after `since`, up to `maxResults`. */
export async function listMessageIdsSince(auth: OAuth2Client, since: Date, maxResults = 300): Promise<string[]> {
  const gmail = google.gmail({ version: 'v1', auth });
  const y = since.getFullYear();
  const m = String(since.getMonth() + 1).padStart(2, '0');
  const d = String(since.getDate()).padStart(2, '0');
  const q = `after:${y}/${m}/${d} has:attachment`;
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.messages.list({ userId: 'me', q, pageToken, maxResults: 100 });
    for (const m of res.data.messages || []) if (m.id) ids.push(m.id);
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken && ids.length < maxResults);

  return ids.slice(0, maxResults);
}

function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function findAttachmentParts(part: gmail_v1.Schema$MessagePart | undefined, out: gmail_v1.Schema$MessagePart[]): void {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) out.push(part);
  for (const child of part.parts || []) findAttachmentParts(child, out);
}

/** Pulls headers + relevant attachment bytes for one message. Returns null if it has no PDF/Excel attachment. */
export async function fetchMessage(auth: OAuth2Client, messageId: string): Promise<FetchedMessage | null> {
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const payload = res.data.payload;
  if (!payload) return null;

  const headers = payload.headers || [];
  const fromHeader = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
  const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '(fără subiect)';
  const senderEmail = (fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader).trim().toLowerCase();
  const receivedAt = res.data.internalDate ? new Date(parseInt(res.data.internalDate, 10)) : new Date();

  const attachmentParts: gmail_v1.Schema$MessagePart[] = [];
  findAttachmentParts(payload, attachmentParts);

  const attachments: FetchedAttachment[] = [];
  for (const part of attachmentParts) {
    if (!part.filename || !part.body?.attachmentId) continue;
    if (!isRelevantAttachment(part.filename, part.mimeType || '')) continue;
    const attRes = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: part.body.attachmentId,
    });
    if (!attRes.data.data) continue;
    attachments.push({
      filename: part.filename,
      mimeType: part.mimeType || 'application/octet-stream',
      data: decodeBase64Url(attRes.data.data),
    });
  }

  if (attachments.length === 0) return null;
  return { messageId, senderEmail, subject, receivedAt, attachments };
}
