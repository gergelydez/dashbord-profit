/**
 * POST /api/agent/chat
 * Body: { messages: [{role, content}], shops?: string[] }
 * → { reply, actions: AgentAction[] (pending confirmation), toolLog }
 */
import { NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent/agent';
import { checkPin } from '@/lib/agent/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = checkPin(req);
  if (denied) return denied;
  try {
    const { messages, shops } = await req.json();
    if (!Array.isArray(messages) || !messages.length) return NextResponse.json({ error: 'Lipsește mesajul' }, { status: 400 });
    const out = await runAgent(messages, Array.isArray(shops) ? shops : undefined);
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Eroare agent' }, { status: 500 });
  }
}
