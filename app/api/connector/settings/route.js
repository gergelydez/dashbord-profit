/**
 * app/api/connector/settings/route.ts
 *
 * GET  /api/connector/settings?shop=ro   → { autoInvoice: boolean }
 * POST /api/connector/settings           → { shop, autoInvoice } → saves setting
 *
 * Settings sunt stocate in process.env memory + fisier JSON persistent.
 * Nu necesita migrare DB — foloseste un fisier simplu /tmp/xconnector-settings.json
 */
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const SETTINGS_FILE = path.join(process.cwd(), 'xconnector-settings.json');

interface Settings {
  [shopKey: string]: {
    autoInvoice: boolean;
  };
}

async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    return JSON.parse(raw) as Settings;
  } catch {
    return {};
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const shop = searchParams.get('shop') || 'ro';

  const settings = await readSettings();
  const shopSettings = settings[shop] ?? { autoInvoice: false };

  return NextResponse.json({ ok: true, shop, ...shopSettings });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { shop?: string; autoInvoice?: boolean };
    const shop = body.shop || 'ro';
    const autoInvoice = Boolean(body.autoInvoice);

    const settings = await readSettings();
    settings[shop] = { ...settings[shop], autoInvoice };
    await writeSettings(settings);

    return NextResponse.json({ ok: true, shop, autoInvoice });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

