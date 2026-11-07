/**
 * GET /api/agent/overview?period=today|yesterday|7d|30d|month
 * Live stats for every connected shop, side by side.
 */
import { NextResponse } from 'next/server';
import { SHOP_CONFIGS } from '@/lib/shops';
import { getShopStats, type Period } from '@/lib/agent/shopify-data';
import { checkPin } from '@/lib/agent/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PERIODS: Period[] = ['today', 'yesterday', '7d', '30d', 'month'];

export async function GET(req: Request) {
  const denied = checkPin(req);
  if (denied) return denied;
  const p = new URL(req.url).searchParams.get('period') as Period;
  const period = PERIODS.includes(p) ? p : 'today';
  const shops = await Promise.all(SHOP_CONFIGS.map(s => getShopStats(s.key, period)));
  return NextResponse.json({ period, shops, generatedAt: new Date().toISOString() });
}
