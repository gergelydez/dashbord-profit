/**
 * app/api/connector/repair-invoice-links/route.ts
 * Repară asocierile Invoice↔Order greșite — vezi bug-ul confirmat în
 * lib/services/invoice-service.ts (facturi "furate" de la comanda lor reală
 * și reatribuite alteia). Sursa de adevăr e exportul de facturi SmartBill
 * (Observatii conține referința comenzii la creare — imuabilă), nu DB-ul
 * nostru, care e exact ce s-a corupt.
 *
 * POST { items: [{ shopKey, orderName, series, number, client? }], apply }
 * apply=false (implicit) — DOAR previzualizare, nu scrie nimic.
 * apply=true  — aplică efectiv (create/reassign).
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { getShopConfig } from '@/lib/shops';

interface Item { shopKey: string; orderName: string; series: string; number: string; client?: string; }

export async function POST(request: Request) {
  try {
    const { items, apply } = await request.json() as { items?: Item[]; apply?: boolean };
    if (!items?.length) return NextResponse.json({ error: 'Nicio intrare de verificat.' }, { status: 400 });

    const shopCache = new Map<string, { id: string } | null>();
    const getShop = async (shopKey: string) => {
      if (shopCache.has(shopKey)) return shopCache.get(shopKey) ?? null;
      let shop: { id: string } | null = null;
      try {
        const cfg = getShopConfig(shopKey);
        shop = await db.shop.findFirst({ where: { domain: cfg.domain }, select: { id: true } });
      } catch { /* shop necunoscut */ }
      shopCache.set(shopKey, shop);
      return shop;
    };

    const results = [];
    for (const item of items) {
      const shop = await getShop(item.shopKey);
      if (!shop) { results.push({ ...item, action: 'skip', reason: 'Magazin neconfigurat/nesincronizat' }); continue; }

      const order = await db.order.findFirst({
        where: { shopId: shop.id, shopifyName: item.orderName },
        select: { id: true, shopifyName: true, customerName: true },
      });
      if (!order) {
        results.push({ ...item, action: 'skip', reason: 'Comanda nu există încă în baza noastră (nesincronizată)' });
        continue;
      }

      const existingInvoice = await db.invoice.findFirst({
        where: { shopId: shop.id, series: item.series, number: item.number },
        include: { order: { select: { shopifyName: true, customerName: true } } },
      });

      if (!existingInvoice) {
        results.push({
          ...item, action: 'create', shopifyCustomer: order.customerName,
          reason: `Factură lipsă din bază — se creează, legată de ${order.shopifyName}`,
        });
        if (apply) {
          await db.invoice.create({
            data: { orderId: order.id, shopId: shop.id, series: item.series, number: item.number, status: 'CREATED' },
          });
        }
        continue;
      }

      if (existingInvoice.orderId === order.id) {
        results.push({ ...item, action: 'ok', shopifyCustomer: order.customerName, reason: 'Deja corect asociată' });
        continue;
      }

      results.push({
        ...item, action: 'reassign', shopifyCustomer: order.customerName,
        wrongOwnerOrderName: existingInvoice.order.shopifyName,
        wrongOwnerCustomer: existingInvoice.order.customerName,
        reason: `Era asociată greșit la ${existingInvoice.order.shopifyName} (${existingInvoice.order.customerName}) — se mută la ${order.shopifyName} (${order.customerName})`,
      });
      if (apply) {
        await db.invoice.update({ where: { id: existingInvoice.id }, data: { orderId: order.id } });
      }
    }

    return NextResponse.json({ ok: true, results, applied: !!apply });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
