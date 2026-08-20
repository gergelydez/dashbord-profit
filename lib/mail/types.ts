/**
 * lib/mail/types.ts
 * Shared shape both gmail-client.ts and imap-client.ts normalize into, so the
 * sync/backfill routes and classify.ts don't need to know which provider a
 * message came from.
 */

export interface FetchedAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface FetchedMessage {
  messageId: string; // Gmail: message id · Yahoo/IMAP: UID as a string
  senderEmail: string;
  subject: string;
  receivedAt: Date;
  attachments: FetchedAttachment[];
}

const ATTACHMENT_MIME_ALLOW = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
]);
const ATTACHMENT_EXT_ALLOW = /\.(pdf|xlsx|xls)$/i;

/** Only PDF/Excel attachments are relevant — every document category we sort (rambursuri, facturi) always arrives as one of these. */
export function isRelevantAttachment(filename: string, mimeType: string): boolean {
  return ATTACHMENT_MIME_ALLOW.has(mimeType) || ATTACHMENT_EXT_ALLOW.test(filename || '');
}
