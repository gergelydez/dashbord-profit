/**
 * app/api/connector/shops/route.ts
 * GET — returns list of configured shops (key + label + flag only, no secrets).
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { SHOP_CONFIGS } from '@/lib/shops';

export async function GET() {
  const shops = SHOP_CONFIGS.map(({ key, label, flag }) => ({ key, label, flag }));
  return NextResponse.json({ shops });
}
