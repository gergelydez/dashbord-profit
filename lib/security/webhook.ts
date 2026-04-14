/**
 * lib/security/webhook.ts — Shopify webhook HMAC verification
 *
 * Shopify signs every webhook with HMAC-SHA256 using the app's client secret.
 * The signature is in the X-Shopify-Hmac-Sha256 header as a base64 string.
 * We MUST verify this before processing to prevent spoofed requests.
 *
 * Docs: https://shopify.dev/docs/apps/webhooks/configuration/https#step-5-verify-the-webhook
 */

import { createHmac, timingSafeEqual } from 'crypto';

const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';

if (!WEBHOOK_SECRET && process.env.NODE_ENV === 'production') {
  console.warn(
    '[security/webhook] SHOPIFY_WEBHOOK_SECRET is not set — webhook verification disabled!',
  );
}

/**
 * Verify the HMAC signature on a Shopify webhook request.
 *
 * IMPORTANT: You must pass the raw request body as a Buffer (before JSON.parse).
 * Next.js App Router: use `await request.arrayBuffer()` then `Buffer.from(...)`.
 *
 * @returns true if signature is valid (or secret is not configured in dev)
 */
export function verifyShopifyWebhook(
  rawBody: Buffer,
  signature: string,
): boolean {
  if (!WEBHOOK_SECRET) {
    // Allow in development without secret — log a warning
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[webhook] SHOPIFY_WEBHOOK_SECRET not set, skipping verification');
      return true;
    }
    return false;
  }

  if (!signature) return false;

  const computed = createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('base64');

  // Prevent timing attacks via constant-time comparison
  try {
    const a = Buffer.from(computed, 'base64');
    const b = Buffer.from(signature, 'base64');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Extract standard Shopify webhook headers from a Next.js Request.
 */
export function extractWebhookHeaders(request: Request) {
  return {
    topic:       request.headers.get('x-shopify-topic') ?? '',
    shopDomain:  request.headers.get('x-shopify-shop-domain') ?? '',
    eventId:     request.headers.get('x-shopify-webhook-id') ?? '',
    hmac:        request.headers.get('x-shopify-hmac-sha256') ?? '',
    apiVersion:  request.headers.get('x-shopify-api-version') ?? '',
  };
}
