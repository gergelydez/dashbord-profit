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

/**
 * Returns all configured webhook secrets (one per shop).
 * Tries shop-specific secrets first (SHOPIFY_WEBHOOK_SECRET_RO / _HU),
 * then falls back to the generic SHOPIFY_WEBHOOK_SECRET.
 */
function getWebhookSecrets(): string[] {
  const secrets: string[] = [];
  const generic = process.env.SHOPIFY_WEBHOOK_SECRET || '';
  const ro = process.env.SHOPIFY_WEBHOOK_SECRET_RO || '';
  const hu = process.env.SHOPIFY_WEBHOOK_SECRET_HU || '';
  if (ro)      secrets.push(ro);
  if (hu)      secrets.push(hu);
  if (generic) secrets.push(generic);
  // deduplicate
  return Array.from(new Set(secrets));
}

function verifyWithSecret(rawBody: Buffer, signature: string, secret: string): boolean {
  const computed = createHmac('sha256', secret).update(rawBody).digest('base64');
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
 * Verify the HMAC signature on a Shopify webhook request.
 * Tries all configured secrets — supports multi-shop with different app secrets.
 */
export function verifyShopifyWebhook(
  rawBody: Buffer,
  signature: string,
): boolean {
  const secrets = getWebhookSecrets();

  if (secrets.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[webhook] No webhook secret set, skipping verification');
      return true;
    }
    return false;
  }

  if (!signature) return false;

  // Accept if ANY configured secret matches
  return secrets.some(secret => verifyWithSecret(rawBody, signature, secret));
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
