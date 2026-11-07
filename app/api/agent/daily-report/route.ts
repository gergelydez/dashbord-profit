/**
 * /api/agent/daily-report
 *  GET  (Vercel cron, every morning)  → generates + stores yesterday's report
 *  GET  ?date=YYYY-MM-DD (dashboard)   → returns a stored report (latest if no date)
 *  POST (dashboard "Generează acum")   → regenerates now
 */
import { NextResponse } from 'next/server';
import { generateReport, loadReport, listReportDates } from '@/lib/agent/report';
import { checkPin } from '@/lib/agent/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function isCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get('authorization') === `Bearer ${secret}`;
  return (req.headers.get('user-agent') || '').startsWith('vercel-cron');
}

export async function GET(req: Request) {
  try {
    if (isCron(req)) {
      const report = await generateReport();
      return NextResponse.json({ ok: true, date: report.date });
    }
    const denied = checkPin(req);
    if (denied) return denied;
    const date = new URL(req.url).searchParams.get('date') || undefined;
    const [report, dates] = await Promise.all([loadReport(date), listReportDates()]);
    return NextResponse.json({ report, dates, storage: process.env.REDIS_URL ? 'redis' : 'none' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = checkPin(req);
  if (denied) return denied;
  try {
    const report = await generateReport();
    return NextResponse.json({ report, dates: await listReportDates() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
