/**
 * app/api/stats-totale/route.ts
 * GET — agregare lunară a tuturor comenzilor din DB (toate magazinele
 * Shopify: ro/hu/glato/glatohu), pentru pagina Statistici Totale.
 *
 * Per lună + per magazin calculează: nr. comenzi, anulate, valoare, încasat
 * COD (ramburs livrat — curierul l-a predat deja), încasat Card (Shopify
 * Payments/Stripe/PayPal, indiferent de livrare — banii intră la comandă),
 * neîncasat COD (ramburs încă în curs, nelivrat/neretur), retururi (din
 * Shipment.status, deja validat de logica anti-cod-5-ambiguu din gls-sync/
 * tracking), facturate/nefacturate (din Invoice).
 *
 * Nu adună valori din monede diferite — fiecare bucket e per monedă reală a
 * comenzii (RON pentru ro/glato, HUF pentru hu/glatohu de regulă), ca un
 * total global să nu amestece silențios RON cu HUF.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { SHOP_CONFIGS } from '@/lib/shops';

const ONLINE_GW = ['shopify_payments', 'stripe', 'paypal'];
const isOnlineGateway = (gw: string) => !!gw && ONLINE_GW.some(g => gw.toLowerCase().includes(g));

interface Bucket {
  orders: number;
  cancelled: number;
  valoare: number;
  codIncasat: number;
  codNeincasat: number;
  cardIncasat: number;
  retururi: number;
  facturate: number;
  nefacturate: number;
  awbCreate: number;
}

function emptyBucket(): Bucket {
  return { orders: 0, cancelled: 0, valoare: 0, codIncasat: 0, codNeincasat: 0, cardIncasat: 0, retururi: 0, facturate: 0, nefacturate: 0, awbCreate: 0 };
}

interface LineItem { name?: string; sku?: string; qty?: number; price?: number; isShipping?: boolean; isDiscount?: boolean }
interface ProductAgg { name: string; sku: string; qty: number; revenue: Record<string, number> }

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
  const to   = searchParams.get('to')   || new Date().toISOString().slice(0, 10);

  try {
    const shops = await db.shop.findMany({ select: { id: true, domain: true } });
    const shopKeyByDomain = new Map<string, string>();
    for (const cfg of SHOP_CONFIGS) shopKeyByDomain.set(cfg.domain, cfg.key);
    const shopKeyById = new Map<string, string>();
    for (const s of shops) shopKeyById.set(s.id, shopKeyByDomain.get(s.domain) || s.domain);

    const fromD = new Date(`${from}T00:00:00Z`);
    const toD   = new Date(`${to}T23:59:59Z`);

    // Grupăm după shopifyCreatedAt (data reală a comenzii în Shopify) — NU
    // după createdAt (momentul în care rândul a ajuns în DB-ul nostru, care
    // poate fi mult mai târziu pentru comenzi recuperate/backfill-uite).
    // shopifyCreatedAt poate fi totuși null pentru comenzi "sintetice" create
    // de pipeline-ul vechi de facturare (lib/services/legacy-order-link.js,
    // când o factură era generată pentru o comandă încă neajunsă prin
    // webhook) — pentru acelea cădem pe createdAt, altfel ar dispărea complet
    // din statistici.
    const orders = await db.order.findMany({
      where: {
        OR: [
          { shopifyCreatedAt: { gte: fromD, lte: toD } },
          { shopifyCreatedAt: null, createdAt: { gte: fromD, lte: toD } },
        ],
      },
      select: {
        shopId: true, createdAt: true, shopifyCreatedAt: true, totalPrice: true, currency: true,
        paymentGateway: true, status: true, financialStatus: true, lineItems: true,
        invoices: { select: { id: true }, take: 1 },
        shipments: { select: { status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // months[monthKey][shopKey] — bucket lunar per magazin
    const months: Record<string, Record<string, Bucket>> = {};
    // shopTotals[shopKey] — total pe tot intervalul, per magazin
    const shopTotals: Record<string, Bucket> = {};
    const shopCurrency: Record<string, string> = {};
    // produse vândute în tot intervalul (toate magazinele active), pe sku+nume
    const productMap = new Map<string, ProductAgg>();

    for (const o of orders) {
      const effDate  = o.shopifyCreatedAt || o.createdAt;
      const monthKey = effDate.toISOString().slice(0, 7);
      const shopKey  = shopKeyById.get(o.shopId) || 'necunoscut';
      shopCurrency[shopKey] = o.currency;

      if (!months[monthKey]) months[monthKey] = {};
      if (!months[monthKey][shopKey]) months[monthKey][shopKey] = emptyBucket();
      if (!shopTotals[shopKey]) shopTotals[shopKey] = emptyBucket();

      const total       = Number(o.totalPrice);
      const cancelled    = o.status === 'CANCELLED';
      const finStatus     = (o.financialStatus || '').toLowerCase();
      const refunded      = finStatus === 'refunded' || finStatus === 'voided';
      const delivered     = o.shipments.some(s => s.status === 'DELIVERED');
      const returned       = o.shipments.some(s => s.status === 'RETURNED');
      const online         = isOnlineGateway(o.paymentGateway);
      const hasInvoice      = o.invoices.length > 0;
      const hasAwb          = o.shipments.length > 0;

      for (const bucket of [months[monthKey][shopKey], shopTotals[shopKey]]) {
        bucket.orders++;
        if (cancelled) { bucket.cancelled++; continue; }
        bucket.valoare += total;
        if (returned) bucket.retururi++;
        if (hasAwb) bucket.awbCreate++;
        if (hasInvoice) bucket.facturate++; else bucket.nefacturate++;
        if (refunded) continue; // banii nu mai sunt la noi — nu intră în niciun "încasat"
        if (online) bucket.cardIncasat += total;
        else if (delivered) bucket.codIncasat += total;
        else if (!returned) bucket.codNeincasat += total;
      }

      if (!cancelled) {
        const items = Array.isArray(o.lineItems) ? (o.lineItems as unknown as LineItem[]) : [];
        for (const it of items) {
          if (it.isShipping || it.isDiscount || !it.name) continue;
          const key = (it.sku || it.name).toLowerCase().trim();
          if (!productMap.has(key)) productMap.set(key, { name: it.name, sku: it.sku || '', qty: 0, revenue: {} });
          const p = productMap.get(key)!;
          const qty = Number(it.qty) || 0;
          p.qty += qty;
          p.revenue[o.currency] = (p.revenue[o.currency] || 0) + qty * (Number(it.price) || 0);
        }
      }
    }

    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 100);

    return NextResponse.json({
      ok: true,
      from, to,
      shopKeys: Object.keys(shopTotals),
      shopCurrency,
      months,
      shopTotals,
      topProducts,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
