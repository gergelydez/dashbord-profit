/**
 * app/api/connector/settings/route.js
 * Settings per-shop salvate în DB (Shop.settings JSON) + Redis cache.
 * Persistent la restart/refresh — nu depinde de Redis.
 *
 * GET  /api/connector/settings?shop=hu  → { autoInvoice: boolean }
 * POST /api/connector/settings          → { shop, autoInvoice }
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const REDIS_KEY = (shop) => `xconnector:settings:${shop}`;

// ── DB helpers ────────────────────────────────────────────────────────────────
async function readFromDb(shopKey) {
  try {
    const { db } = await import('@/lib/db');
    const { SHOP_CONFIGS } = await import('@/lib/shops');
    const cfg = SHOP_CONFIGS.find(s => s.key === shopKey);
    if (!cfg?.domain) return null;
    const shop = await db.shop.findUnique({ where: { domain: cfg.domain } });
    if (!shop?.settings) return null;
    const s = typeof shop.settings === 'string' ? JSON.parse(shop.settings) : shop.settings;
    return s;
  } catch { return null; }
}

async function writeToDb(shopKey, settings) {
  try {
    const { db } = await import('@/lib/db');
    const { SHOP_CONFIGS } = await import('@/lib/shops');
    const cfg = SHOP_CONFIGS.find(s => s.key === shopKey);
    if (!cfg?.domain) return;
    await db.shop.updateMany({
      where: { domain: cfg.domain },
      data:  { settings },
    });
  } catch { /* non-fatal */ }
}

// ── Redis helpers ─────────────────────────────────────────────────────────────
async function readFromRedis(shop) {
  try {
    const { getRedisConnection } = await import('@/lib/redis');
    const redis = getRedisConnection();
    const raw = await Promise.race([
      redis.get(REDIS_KEY(shop)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
    ]);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function writeToRedis(shop, settings) {
  try {
    const { getRedisConnection } = await import('@/lib/redis');
    const redis = getRedisConnection();
    await redis.set(REDIS_KEY(shop), JSON.stringify(settings));
  } catch { /* non-fatal */ }
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shop = searchParams.get('shop') || 'ro';

  // Redis first (fast cache)
  const cached = await readFromRedis(shop);
  if (cached?.autoInvoice !== undefined) {
    return NextResponse.json({ ok: true, shop, autoInvoice: Boolean(cached.autoInvoice) });
  }

  // DB fallback (persistent source of truth)
  const fromDb = await readFromDb(shop);
  if (fromDb?.autoInvoice !== undefined) {
    await writeToRedis(shop, fromDb); // repopulate cache
    return NextResponse.json({ ok: true, shop, autoInvoice: Boolean(fromDb.autoInvoice) });
  }

  return NextResponse.json({ ok: true, shop, autoInvoice: false });
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json();
    const shop = body.shop || 'ro';
    const autoInvoice = Boolean(body.autoInvoice);
    const settings = { autoInvoice };

    // Save to BOTH — DB is source of truth, Redis is cache
    await Promise.allSettled([
      writeToDb(shop, settings),
      writeToRedis(shop, settings),
    ]);

    return NextResponse.json({ ok: true, shop, autoInvoice });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
