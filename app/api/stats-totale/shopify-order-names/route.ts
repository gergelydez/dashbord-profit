/**
 * app/api/stats-totale/shopify-order-names/route.ts
 * POST { from, to } — numele TUTUROR comenzilor (ex. "#1042") plasate în
 * intervalul dat, luate LIVE direct din fiecare magazin Shopify conectat
 * (nu din DB-ul nostru).
 *
 * De ce: /api/stats-totale/match-shop caută ClientReference-ul fiecărui
 * colet MyGLS printre comenzile din DB-ul nostru — dar DB-ul e exact ce
 * lipsește (webhook-uri ratate, comenzi vechi din aplicația xConnector
 * originală), deci majoritatea coletelor ieșeau "neatribuite" chiar dacă
 * comanda chiar există în Shopify. Shopify însuși e sursa de adevăr
 * completă — o interogăm direct, nu prin DB-ul nostru parțial.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { SHOP_CONFIGS } from '@/lib/shops';
import { getAccessToken } from '@/lib/shopify/ccg-token';

const API_VERSION = '2026-07';

async function fetchAllOrderNames(domain: string, token: string, from: string, to: string): Promise<string[]> {
  const names: string[] = [];
  let pageInfo: string | null = null;
  let guard = 0; // 250/pagină — opresc oricum la 80 de pagini (20.000 comenzi) per magazin, ca să nu rulăm la nesfârșit
  while (guard++ < 80) {
    const params = new URLSearchParams({ limit: '250', fields: 'name' });
    if (pageInfo) {
      params.set('page_info', pageInfo);
    } else {
      params.set('status', 'any');
      params.set('created_at_min', `${from}T00:00:00Z`);
      params.set('created_at_max', `${to}T23:59:59Z`);
    }
    const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/orders.json?${params}`, {
      headers: { 'X-Shopify-Access-Token': token },
      cache: 'no-store',
    });
    if (!res.ok) break;
    const { orders } = await res.json() as { orders: Array<{ name: string }> };
    for (const o of orders) if (o.name) names.push(o.name);

    const link = res.headers.get('Link') || '';
    const nextMatch = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    if (!nextMatch) break;
    pageInfo = nextMatch[1];
  }
  return names;
}

export async function POST(request: Request) {
  try {
    const { from, to } = await request.json() as { from?: string; to?: string };
    if (!from || !to) return NextResponse.json({ error: 'from/to lipsă' }, { status: 400 });

    const results = await Promise.allSettled(
      SHOP_CONFIGS.map(async (cfg) => {
        const token = await getAccessToken(cfg);
        const names = await fetchAllOrderNames(cfg.domain, token, from, to);
        return { shopKey: cfg.key, names };
      }),
    );

    const nameToShop: Record<string, string> = {};
    const perShop: Record<string, number> = {};
    const errors: Record<string, string> = {};
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const shopKey = SHOP_CONFIGS[i].key;
      if (r.status === 'fulfilled') {
        perShop[shopKey] = r.value.names.length;
        for (const name of r.value.names) nameToShop[name] = shopKey;
      } else {
        errors[shopKey] = r.reason instanceof Error ? r.reason.message : String(r.reason);
      }
    }

    return NextResponse.json({ ok: true, nameToShop, perShop, errors });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
