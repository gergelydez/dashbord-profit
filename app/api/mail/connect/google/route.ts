/**
 * GET /api/mail/connect/google — redirects to Google's consent screen.
 * The `state` param is an HMAC-signed, 10-minute token (reusing
 * lib/security/tokens.ts, the same signing already used for invoice/label
 * download URLs) so the callback can verify the redirect actually
 * originated from us, without needing a session store.
 */
import { NextResponse } from 'next/server';
import { buildConsentUrl } from '@/lib/google/oauth';
import { signToken } from '@/lib/security/tokens';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = signToken('google-connect', 600);
    const url = buildConsentUrl(state);
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
