/**
 * app/api/connector/settings/route.js
 *
 * GET  /api/connector/settings?shop=ro   → { autoInvoice: boolean }
 * POST /api/connector/settings           → { shop, autoInvoice } → saves setting
 *
 * Settings sunt stocate in Redis (nu in filesystem — Vercel e read-only).
 * Fallback: daca Redis nu e disponibil, returneaza default fara a crasha.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const KEY = (shop) => `xconnector:settings:${shop}`;

async function getRedis() {
  try {
    const { getRedisConnection } = await import('@/lib/redis');
    return getRedisConnection();
  } catch {
    return null;
  }
}

async function readSettings(shop) {
  try {
    const redis = await getRedis();
    if (!redis) return { autoInvoice: false };
    const raw = await redis.get(KEY(shop));
    if (!raw) return { autoInvoice: false };
    return JSON.parse(raw);
  } catch {
    return { autoInvoice: false };
  }
}

async function writeSettings(shop, settings) {
  const redis = await getRedis();
  if (!redis) throw new Error('Redis nu este disponibil. Verifica REDIS_URL in Vercel env.');
  await redis.set(KEY(shop), JSON.stringify(settings));
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shop = searchParams.get('shop') || 'ro';
  const settings = await readSettings(shop);
  return NextResponse.json({ ok: true, shop, ...settings });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const shop = body.shop || 'ro';
    const autoInvoice = Boolean(body.autoInvoice);
    const current = await readSettings(shop);
    await writeSettings(shop, { ...current, autoInvoice });
    return NextResponse.json({ ok: true, shop, autoInvoice });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
