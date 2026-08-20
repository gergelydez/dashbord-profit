/**
 * lib/security/crypt.ts
 * Symmetric encryption for mailbox credentials at rest (Gmail refresh token,
 * Yahoo IMAP app password) — separate from lib/security/tokens.ts's HMAC
 * signing (that's for tamper-proof URLs, this is for encrypting secrets we
 * store in the DB so a DB leak alone doesn't expose live mailbox access).
 *
 * AES-256-GCM: MAIL_ENCRYPTION_KEY (32 random bytes, hex) + a fresh random IV
 * per call, authenticated (GCM tag) so tampering is detected on decrypt.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard nonce size

function getKey(): Buffer {
  const hex = process.env.MAIL_ENCRYPTION_KEY || '';
  if (hex.length !== 64) {
    throw new Error('MAIL_ENCRYPTION_KEY must be 32 bytes as hex (64 chars) — generate with: openssl rand -hex 32');
  }
  return Buffer.from(hex, 'hex');
}

/** Returns "iv:authTag:ciphertext", all hex-encoded, joined with ':'. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

export function decrypt(payload: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertextHex] = payload.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
