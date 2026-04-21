import { NextResponse } from 'next/server';

/**
 * GET /api/gls-config
 * Returns GLS configuration STATUS from ENV vars.
 * NEVER exposes credentials — only tells the frontend what is set.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

export async function GET() {
  const hasUser   = !!process.env.GLS_USERNAME;
  const hasPass   = !!process.env.GLS_PASSWORD;
  const hasClient = !!process.env.GLS_CLIENT_NUMBER;
  const hasPickup = !!(process.env.GLS_PICKUP_NAME && process.env.GLS_PICKUP_CITY && process.env.GLS_PICKUP_ZIP);

  const missing = [];
  if (!hasUser)   missing.push('GLS_USERNAME');
  if (!hasPass)   missing.push('GLS_PASSWORD');
  if (!hasPickup) missing.push('GLS_PICKUP_NAME / GLS_PICKUP_CITY / GLS_PICKUP_ZIP');

  return NextResponse.json({
    configured: hasUser && hasPass,
    hasPickup,
    clientNumber: process.env.GLS_CLIENT_NUMBER || '—',
    pickupCity:   process.env.GLS_PICKUP_CITY   || '',
    pickupName:   process.env.GLS_PICKUP_NAME   || '',
    missing,
    envSummary: {
      GLS_USERNAME:      hasUser   ? '✅ setat' : '❌ lipsă',
      GLS_PASSWORD:      hasPass   ? '✅ setat' : '❌ lipsă',
      GLS_CLIENT_NUMBER: hasClient ? `✅ ${process.env.GLS_CLIENT_NUMBER}` : '⚠️ folosește default 553003585',
      GLS_PICKUP_NAME:   process.env.GLS_PICKUP_NAME   ? `✅ ${process.env.GLS_PICKUP_NAME}`   : '❌ lipsă',
      GLS_PICKUP_STREET: process.env.GLS_PICKUP_STREET ? `✅ ${process.env.GLS_PICKUP_STREET}` : '❌ lipsă',
      GLS_PICKUP_CITY:   process.env.GLS_PICKUP_CITY   ? `✅ ${process.env.GLS_PICKUP_CITY}`   : '❌ lipsă',
      GLS_PICKUP_ZIP:    process.env.GLS_PICKUP_ZIP    ? `✅ ${process.env.GLS_PICKUP_ZIP}`    : '❌ lipsă',
      GLS_PICKUP_COUNTY: process.env.GLS_PICKUP_COUNTY ? `✅ ${process.env.GLS_PICKUP_COUNTY}` : '⚠️ opțional',
      GLS_PICKUP_PHONE:  process.env.GLS_PICKUP_PHONE  ? '✅ setat'                             : '⚠️ opțional',
    },
  }, { headers: CORS });
}

