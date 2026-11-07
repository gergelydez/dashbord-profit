/**
 * lib/agent/auth.ts
 * Optional PIN for the agent endpoints. If AGENT_PIN is set in Vercel, every
 * /api/agent/* call must send it in the `x-agent-pin` header (the page asks once
 * and remembers it on that device). If AGENT_PIN is not set, access is open,
 * like the rest of the dashboard.
 */
import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

export function checkPin(req: Request): NextResponse | null {
  const pin = process.env.AGENT_PIN;
  if (!pin) return null;
  const got = req.headers.get('x-agent-pin') || '';
  const a = Buffer.from(got), b = Buffer.from(pin);
  if (a.length === b.length && timingSafeEqual(a, b)) return null;
  return NextResponse.json({ error: 'PIN greșit sau lipsă', needPin: true }, { status: 401 });
}
