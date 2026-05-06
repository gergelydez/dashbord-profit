/**
 * GET /api/connector/setup-webhooks?shop=hu
 * Înregistrează webhook-urile Shopify necesare pentru auto-facturare.
 * Apelează o singură dată după deploy.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getShopConfig, getDefaultShopKey } from '@/lib/shops';

const REQUIRED_TOPICS = ['orders/create', 'orders/paid', 'orders/updated', 'orders/cancelled', 'orders/fulfilled'];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const shopKey = searchParams.get('shop') || getDefaultShopKey();

  let shopCfg;
  try { shopCfg = getShopConfig(shopKey); }
  catch { return NextResponse.json({ error: `Shop "${shopKey}" neconfigurat` }, { status: 400 }); }

  const { domain, accessToken } = shopCfg;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  if (!appUrl) return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL not set' }, { status: 500 });

  const webhookUrl = `${appUrl}/api/webhooks/shopify`;

  // Get existing webhooks
  const listRes = await fetch(`https://${domain}/admin/api/2026-07/webhooks.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken },
    cache: 'no-store',
  });
  const { webhooks: existing = [] } = await listRes.json();

  // Șterge webhook-urile care pointează spre un URL diferit (URL vechi după rename/redeploy)
  for (const w of existing as Array<{id: number; topic: string; address: string}>) {
    if (REQUIRED_TOPICS.includes(w.topic) && w.address !== webhookUrl) {
      await fetch(`https://${domain}/admin/api/2026-07/webhooks/${w.id}.json`, {
        method: 'DELETE',
        headers: { 'X-Shopify-Access-Token': accessToken },
        cache: 'no-store',
      });
    }
  }

  // Re-fetch după ștergere
  const listRes2 = await fetch(`https://${domain}/admin/api/2026-07/webhooks.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken },
    cache: 'no-store',
  });
  const { webhooks: existing2 = [] } = await listRes2.json();
  const existingTopics = new Set(
    (existing2 as Array<{topic: string; address: string}>)
      .filter(w => w.address === webhookUrl)
      .map(w => w.topic)
  );

  const results: Record<string, string> = {};

  for (const topic of REQUIRED_TOPICS) {
    if (existingTopics.has(topic)) {
      results[topic] = '✓ already registered';
      continue;
    }

    const res = await fetch(`https://${domain}/admin/api/2026-07/webhooks.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhook: { topic, address: webhookUrl, format: 'json' },
      }),
      cache: 'no-store',
    });

    results[topic] = res.ok ? '✓ registered' : `✗ error ${res.status}`;
  }

  return NextResponse.json({ ok: true, shop: shopKey, domain, webhookUrl, results });
}
