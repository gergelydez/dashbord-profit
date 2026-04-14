// app/api/tracking-overrides/route.js
import { createClient } from 'redis';
import { NextResponse } from 'next/server';

let client = null;

async function getClient() {
  if (client) return client;
  try {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (e) => { console.error('[REDIS]', e.message); client = null; });
    await client.connect();
    return client;
  } catch (e) {
    console.error('[REDIS] Connect error:', e.message);
    client = null;
    return null;
  }
}

const KEY = 'gx_tracking_overrides';

// GET — citește toate overrides
export async function GET() {
  try {
    const redis = await getClient();
    if (!redis) return NextResponse.json({ overrides: {}, source: 'unavailable' });
    const raw = await redis.get(KEY);
    const overrides = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ overrides, source: 'redis', count: Object.keys(overrides).length });
  } catch (e) {
    return NextResponse.json({ overrides: {}, error: e.message });
  }
}

// POST — salvează/merge overrides
export async function POST(request) {
  try {
    const { overrides } = await request.json();
    if (!overrides) return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    const redis = await getClient();
    if (!redis) return NextResponse.json({ error: 'Redis unavailable' }, { status: 503 });
    const raw = await redis.get(KEY);
    const existing = raw ? JSON.parse(raw) : {};
    const merged = { ...existing, ...overrides };
    await redis.set(KEY, JSON.stringify(merged));
    return NextResponse.json({ ok: true, count: Object.keys(merged).length });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
