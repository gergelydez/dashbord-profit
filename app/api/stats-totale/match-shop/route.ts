/**
 * app/api/stats-totale/match-shop/route.ts
 * POST { names: string[] } — pentru fiecare "ClientReference" găsit pe un
 * AWB direct din MyGLS (ex. "#1042"), caută un Order cu acel shopifyName în
 * DB-ul nostru (indiferent de magazin) și întoarce magazinul lui.
 *
 * Folosit de pagina Statistici Totale când tragem volumul real de colete
 * direct din MyGLS (nu doar ce avem noi în DB) — multe AWB-uri vechi (create
 * prin aplicația xConnector originală, înainte să existe webhook-urile
 * noastre) n-au niciodată un rând Order la noi, deci rămân neatribuite unui
 * magazin — dar tot contează la volumul real de colete/încasări COD.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { SHOP_CONFIGS } from '@/lib/shops';

export async function POST(request: Request) {
  try {
    const { names } = await request.json() as { names?: string[] };
    const clean = Array.from(new Set((names || []).map(n => (n || '').trim()).filter(Boolean)));
    if (!clean.length) return NextResponse.json({ matches: {} });

    const shops = await db.shop.findMany({ select: { id: true, domain: true } });
    const shopKeyByDomain = new Map<string, string>();
    for (const cfg of SHOP_CONFIGS) shopKeyByDomain.set(cfg.domain, cfg.key);
    const shopKeyById = new Map<string, string>();
    for (const s of shops) shopKeyById.set(s.id, shopKeyByDomain.get(s.domain) || s.domain);

    const orders = await db.order.findMany({
      where: { shopifyName: { in: clean } },
      select: { shopifyName: true, shopId: true },
    });

    const matches: Record<string, string> = {};
    for (const o of orders) {
      matches[o.shopifyName] = shopKeyById.get(o.shopId) || 'necunoscut';
    }

    return NextResponse.json({ matches });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
