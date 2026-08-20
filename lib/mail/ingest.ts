/**
 * lib/mail/ingest.ts
 * Shared processing for both the incremental sync and the historical
 * backfill route: classify each message's attachments by sender, upload
 * to Drive under the right month/category folder, record an
 * IngestedDocument row. Idempotent per (mailAccountId, messageId, filename)
 * — safe to re-run over the same messages without duplicating uploads.
 *
 * Drive is always the account with provider 'gmail' (there's only ever one
 * connected — Drive access came bundled with the single Google OAuth grant),
 * regardless of which mailbox (Gmail or Yahoo) a message was read from.
 */
import { db } from '@/lib/db';
import { decrypt } from '@/lib/security/crypt';
import { getAuthorizedClient } from '@/lib/google/oauth';
import { getOrCreateMonthPath, uploadFile } from '@/lib/google/drive';
import { classifySender } from './classify';
import type { FetchedMessage } from './types';

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function ingestMessages(
  mailAccountId: string,
  messages: FetchedMessage[],
): Promise<{ ingested: number; failed: number }> {
  if (messages.length === 0) return { ingested: 0, failed: 0 };

  const googleAccount = await db.mailAccount.findFirst({ where: { provider: 'gmail', active: true } });
  if (!googleAccount?.refreshToken) {
    throw new Error('Niciun cont Google conectat — Drive e obligatoriu ca destinație de stocare.');
  }
  const auth = getAuthorizedClient(googleAccount.id, decrypt(googleAccount.refreshToken));

  let ingested = 0;
  let failed = 0;

  for (const msg of messages) {
    const { category, subcategory } = await classifySender(msg.senderEmail);
    const month = monthKey(msg.receivedAt);

    for (const att of msg.attachments) {
      const key = { mailAccountId_messageId_filename: { mailAccountId, messageId: msg.messageId, filename: att.filename } };
      const existing = await db.ingestedDocument.findUnique({ where: key });
      if (existing && existing.status !== 'failed') continue; // already ingested — 'failed' rows are retried below

      try {
        const folderId = await getOrCreateMonthPath(auth, month, category, subcategory);
        const { fileId, webViewLink } = await uploadFile(auth, att.filename, folderId, att.data, att.mimeType);
        await db.ingestedDocument.upsert({
          where: key,
          create: {
            mailAccountId, messageId: msg.messageId, senderEmail: msg.senderEmail, subject: msg.subject,
            category, subcategory, month, filename: att.filename, mimeType: att.mimeType,
            driveFileId: fileId, driveUrl: webViewLink,
            status: category === 'Neclasificate' ? 'unclassified' : 'ingested',
            receivedAt: msg.receivedAt,
          },
          update: {
            driveFileId: fileId, driveUrl: webViewLink,
            status: category === 'Neclasificate' ? 'unclassified' : 'ingested',
            fileData: null,
          },
        });
        ingested++;
      } catch {
        // Non-fatal — mirrors lib/storage/s3.ts's fallback: keep the bytes in
        // the DB so a later sync/retry can pick this attachment back up.
        await db.ingestedDocument.upsert({
          where: key,
          create: {
            mailAccountId, messageId: msg.messageId, senderEmail: msg.senderEmail, subject: msg.subject,
            category, subcategory, month, filename: att.filename, mimeType: att.mimeType,
            status: 'failed', fileData: att.data, receivedAt: msg.receivedAt,
          },
          update: { status: 'failed', fileData: att.data },
        }).catch(() => {});
        failed++;
      }
    }
  }

  return { ingested, failed };
}
