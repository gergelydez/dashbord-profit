/**
 * GET /api/mail/google/callback — Google OAuth redirect target.
 * Exchanges the auth code for a refresh token, stores it encrypted on
 * MailAccount, and establishes the incremental-sync baseline (current
 * historyId) so the next sync only picks up mail from here on — older mail
 * is caught up separately via the backfill button/date picker.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { exchangeCodeForAccount, getAuthorizedClient } from '@/lib/google/oauth';
import { getCurrentHistoryId } from '@/lib/mail/gmail-client';
import { encrypt } from '@/lib/security/crypt';
import { verifyToken } from '@/lib/security/tokens';

export const dynamic = 'force-dynamic';

function redirectTo(path: string) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  return NextResponse.redirect(`${appUrl}${path}`);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) return redirectTo(`/documente?mailError=${encodeURIComponent(errorParam)}`);
  if (!code || !state) return redirectTo('/documente?mailError=missing_code');

  try {
    verifyToken(state);
  } catch {
    return redirectTo('/documente?mailError=invalid_state');
  }

  try {
    const { refreshToken, email } = await exchangeCodeForAccount(code);

    const account = await db.mailAccount.upsert({
      where: { email },
      create: { provider: 'gmail', email, refreshToken: encrypt(refreshToken), active: true },
      update: { provider: 'gmail', refreshToken: encrypt(refreshToken), active: true },
    });

    const auth = getAuthorizedClient(account.id, refreshToken);
    const historyId = await getCurrentHistoryId(auth);
    await db.mailAccount.update({ where: { id: account.id }, data: { lastSyncCursor: historyId } });

    return redirectTo(`/documente?connected=${encodeURIComponent(email)}`);
  } catch (e) {
    return redirectTo(`/documente?mailError=${encodeURIComponent((e as Error).message)}`);
  }
}
