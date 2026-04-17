/**
 * lib/security/tokens.ts — HMAC-signed, time-limited download tokens
 *
 * Token format (URL-safe):  <id>.<expiry_unix>.<hmac_hex>
 *
 * The HMAC signs (id + ":" + expiry) with CONNECTOR_SECRET using SHA-256.
 * This means:
 *   - Tokens are tamper-proof (impossible to forge without the secret)
 *   - Tokens auto-expire (expiry is embedded and verified server-side)
 *   - No DB lookup required to validate — pure crypto
 *
 * Consumers (invoice/AWB download endpoints) call verifyToken() which
 * returns the id if valid, or throws if tampered/expired.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.CONNECTOR_SECRET || '';
const DEFAULT_TTL_SECONDS = parseInt(
  process.env.SIGNED_URL_TTL || '604800', // 7 days
  10,
);

if (!SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('CONNECTOR_SECRET env var is required in production');
}

// ─── Private helpers ────────────────────────────────────────────────────────

function hmac(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Sign an entity ID and return a URL-safe token string.
 *
 * @param id       - UUID of the Invoice or Shipment row
 * @param ttl      - expiry in seconds from now (default: SIGNED_URL_TTL env)
 */
export function signToken(id: string, ttl = DEFAULT_TTL_SECONDS): string {
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const payload = `${id}:${expiry}`;
  const sig = hmac(payload);
  // Base64url-encode the three parts, joined by "."
  return [id, expiry, sig].join('.');
}

/**
 * Verify a token and return the embedded ID.
 *
 * @throws {Error} with a descriptive message on invalid/expired tokens
 */
export function verifyToken(token: string): string {
  if (!token) throw new Error('Missing token');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [id, expiryStr, sig] = parts;
  const expiry = parseInt(expiryStr, 10);

  if (!id || isNaN(expiry) || !sig) throw new Error('Malformed token');

  // Constant-time HMAC comparison to prevent timing attacks
  const expected = hmac(`${id}:${expiry}`);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(sig.padEnd(expected.length, '0'), 'hex');

  if (expectedBuf.length !== actualBuf.length) throw new Error('Invalid token');

  const valid = timingSafeEqual(expectedBuf, actualBuf);
  if (!valid) throw new Error('Invalid token signature');

  if (Math.floor(Date.now() / 1000) > expiry) {
    throw new Error('Token has expired');
  }

  return id;
}

/**
 * Build a full signed URL for the invoice PDF endpoint.
 */
export function buildInvoiceUrl(invoiceId: string, ttl?: number): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const token = signToken(invoiceId, ttl);
  return `${appUrl}/api/invoice?id=${invoiceId}&token=${token}`;
}

/**
 * Build a full signed URL for the shipping label PDF endpoint.
 */
export function buildShippingLabelUrl(shipmentId: string, ttl?: number): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  const token = signToken(shipmentId, ttl);
  return `${appUrl}/api/shipping-label?id=${shipmentId}&token=${token}`;
}
