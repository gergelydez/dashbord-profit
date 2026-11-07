/**
 * POST /api/agent/execute
 * Body: { actions: AgentAction[] } — runs ONLY actions the user confirmed in the UI.
 * → { results: [{ ok, shop, summary, result?, error? }] }
 */
import { NextResponse } from 'next/server';
import { executeAction, validateAction, type AgentAction } from '@/lib/agent/actions';
import { checkPin } from '@/lib/agent/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = checkPin(req);
  if (denied) return denied;
  try {
    const { actions } = await req.json();
    if (!Array.isArray(actions) || !actions.length) return NextResponse.json({ error: 'Nicio acțiune' }, { status: 400 });
    if (actions.length > 20) return NextResponse.json({ error: 'Maxim 20 de acțiuni odată' }, { status: 400 });

    const results = [];
    for (const a of actions as AgentAction[]) {
      const err = validateAction(a);
      if (err) { results.push({ ok: false, shop: a?.shop, summary: a?.summary, error: err }); continue; }
      try {
        const result = await executeAction(a);
        results.push({ ok: true, shop: a.shop, summary: a.summary, result });
      } catch (e: any) {
        results.push({ ok: false, shop: a.shop, summary: a.summary, error: e.message });
      }
    }
    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Eroare' }, { status: 500 });
  }
}
