/**
 * lib/mail/imap-client.ts
 * Reads a Yahoo (or any IMAP) mailbox read-only via imapflow — connects with
 * an app-specific password (never the account's real password), and only
 * ever calls .fetch()/.search(), never touches flags or moves/deletes
 * messages, so the original mailbox is never altered.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { FetchedMessage, isRelevantAttachment } from './types';

export interface ImapCredentials {
  email: string;
  appPassword: string;
  host?: string; // default: Yahoo
  port?: number;
}

function openClient(creds: ImapCredentials): ImapFlow {
  return new ImapFlow({
    host: creds.host || 'imap.mail.yahoo.com',
    port: creds.port || 993,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword },
    logger: false,
  });
}

/** Verifies the credentials actually work — used when connecting a new account. Throws on failure. */
export async function testConnection(creds: ImapCredentials): Promise<void> {
  const client = openClient(creds);
  await client.connect();
  await client.logout();
}

async function parseFetchedMessages(
  client: ImapFlow,
  range: Parameters<ImapFlow['fetch']>[0],
  options?: Parameters<ImapFlow['fetch']>[2],
): Promise<{ messages: FetchedMessage[]; lastUid: number | null }> {
  const messages: FetchedMessage[] = [];
  let lastUid: number | null = null;

  const lock = await client.getMailboxLock('INBOX');
  try {
    for await (const msg of client.fetch(range, { source: true }, options)) {
      lastUid = Math.max(lastUid ?? 0, msg.uid);
      if (!msg.source) continue;

      const parsed = await simpleParser(msg.source);
      const relevant = (parsed.attachments || [])
        .filter(a => isRelevantAttachment(a.filename || '', a.contentType || ''))
        .map(a => ({ filename: a.filename || 'atasament', mimeType: a.contentType || 'application/octet-stream', data: a.content }));
      if (relevant.length === 0) continue;

      const fromAddr = Array.isArray(parsed.from) ? parsed.from[0] : parsed.from;
      const senderEmail = (fromAddr?.value?.[0]?.address || '').toLowerCase();

      messages.push({
        messageId: String(msg.uid),
        senderEmail,
        subject: parsed.subject || '(fără subiect)',
        receivedAt: parsed.date || new Date(),
        attachments: relevant,
      });
    }
  } finally {
    lock.release();
  }

  return { messages, lastUid };
}

/** Incremental: messages with UID greater than the last one processed. */
export async function fetchNewMessages(creds: ImapCredentials, sinceUid: number): Promise<{ messages: FetchedMessage[]; lastUid: number | null }> {
  const client = openClient(creds);
  await client.connect();
  try {
    return await parseFetchedMessages(client, `${sinceUid + 1}:*`, { uid: true });
  } finally {
    await client.logout();
  }
}

/** Backfill: messages received on/after `since`. */
export async function fetchMessagesSince(creds: ImapCredentials, since: Date): Promise<{ messages: FetchedMessage[]; lastUid: number | null }> {
  const client = openClient(creds);
  await client.connect();
  try {
    return await parseFetchedMessages(client, { since });
  } finally {
    await client.logout();
  }
}

/** Highest UID currently in INBOX — the baseline cursor to store right after connecting a new account. */
export async function getCurrentUid(creds: ImapCredentials): Promise<number> {
  const client = openClient(creds);
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', { uidNext: true });
      return (status.uidNext || 1) - 1;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
