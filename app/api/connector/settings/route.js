/**
 * app/api/connector/settings/route.js
 * Settings per-shop salvate în PostgreSQL (WebhookEvent tabel ca KV store).
 * 100% persistent — nu depinde de Redis.
 *
 * GET  /api/connector/settings?shop=hu
 * POST /api/connector/settings  { shop, autoInvoice }
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// Folosim WebhookEvent ca key-value store pentru setări
// shopifyEventId = "settings:hu", topic = "settings", payload = { autoInvoice: true }
const SETTINGS_KEY = (shop) => `settings:${shop}`;

async function readFromDb(shop) {
  try {
    const { db } = await import('@/lib/db');
    const record = await db.webhookEvent.findUnique({
      where: { shopifyEventId: SETTINGS_KEY(shop) },
    });
    if (!record) return { autoInvoice: false };
    const payload = typeof record.payload === 'string'
      ? JSON.parse(record.payload)
      : record.payload;
    return payload || { autoInvoice: false };
  } catch (e) {
    console.error('readFromDb error:', e.message);
    return { autoInvoice: false };
  }
}

async function writeToDb(shop, settings) {
  const { db } = await import('@/lib/db');
  await db.webhookEvent.upsert({
    where:  { shopifyEventId: SETTINGS_KEY(shop) },
    create: {
      shopifyEventId: SETTINGS_KEY(shop),
      topic:          'settings',
      shopDomain:     shop,
      payload:        settings,
      processed:      true,
    },
    update: {
      payload:    settings,
      processedAt: new Date(),
    },
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shop = searchParams.get('shop') || 'ro';
  const settings = await readFromDb(shop);
  return NextResponse.json({ ok: true, shop, ...settings });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const shop = body.shop || 'ro';
    const autoInvoice = Boolean(body.autoInvoice);
    const current = await readFromDb(shop);
    await writeToDb(shop, { ...current, autoInvoice });
    return NextResponse.json({ ok: true, shop, autoInvoice });
  } catch (err) {
    console.error('POST settings error:', err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
