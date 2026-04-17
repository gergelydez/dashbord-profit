/**
 * app/api/connector/settings/route.js
 *
 * GET  /api/connector/settings?shop=ro   → { autoInvoice: boolean }
 * POST /api/connector/settings           → { shop, autoInvoice } → saves setting
 *
 * Settings sunt stocate in fisier JSON persistent langa proiect.
 */
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const SETTINGS_FILE = path.join(process.cwd(), 'xconnector-settings.json');

async function readSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeSettings(settings) {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shop = searchParams.get('shop') || 'ro';

  const settings = await readSettings();
  const shopSettings = settings[shop] ?? { autoInvoice: false };

  return NextResponse.json({ ok: true, shop, ...shopSettings });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const shop = body.shop || 'ro';
    const autoInvoice = Boolean(body.autoInvoice);

    const settings = await readSettings();
    settings[shop] = { ...settings[shop], autoInvoice };
    await writeSettings(settings);

    return NextResponse.json({ ok: true, shop, autoInvoice });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
