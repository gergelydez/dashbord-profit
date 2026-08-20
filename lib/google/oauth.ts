/**
 * lib/google/oauth.ts
 * One Google OAuth app covers both Gmail (read-only) and Drive (upload-only)
 * for the /documente feature — a single consent screen grants both scopes, so
 * connecting "Google" once is enough regardless of whether Gmail itself ends
 * up used as a mailbox source.
 *
 * Unlike lib/shopify/ccg-token.ts (client_credentials — stateless, re-derivable
 * from client_id/secret alone), this is an authorization-code + refresh-token
 * flow: the refresh token is NOT re-derivable, so it must be persisted (see
 * MailAccount.refreshToken, encrypted with lib/security/crypt.ts). The
 * short-lived access token itself is refreshed transparently by the
 * googleapis client library — no manual expiry bookkeeping needed here.
 */
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

function baseClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI not configured');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Builds the Google consent screen URL. `state` should be an unguessable, single-use value the caller verifies on callback. */
export function buildConsentUrl(state: string): string {
  return baseClient().generateAuthUrl({
    access_type: 'offline', // required to receive a refresh_token
    prompt: 'consent',      // force refresh_token even if the user consented before
    scope: GOOGLE_SCOPES,
    state,
  });
}

/** Exchanges an authorization code for a refresh token + the connected account's email. */
export async function exchangeCodeForAccount(code: string): Promise<{ refreshToken: string; email: string }> {
  const client = baseClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google nu a întors un refresh_token — revocă accesul aplicației la https://myaccount.google.com/permissions și reconectează, ca ecranul de consimțământ să apară din nou.',
    );
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ auth: client, version: 'v2' });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) throw new Error('Google nu a întors adresa de email a contului conectat.');
  return { refreshToken: tokens.refresh_token, email: data.email };
}

// One authorized client per connected account, reused for the lifetime of a
// warm serverless instance — the googleapis client refreshes its own access
// token from the refresh_token automatically on each request as needed.
const clientCache = new Map<string, OAuth2Client>();

export function getAuthorizedClient(mailAccountId: string, refreshToken: string): OAuth2Client {
  let client = clientCache.get(mailAccountId);
  if (!client) {
    client = baseClient();
    client.setCredentials({ refresh_token: refreshToken });
    clientCache.set(mailAccountId, client);
  }
  return client;
}
