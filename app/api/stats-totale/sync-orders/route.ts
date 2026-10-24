/**
 * app/api/stats-totale/sync-orders/route.ts
 * POST { shop, from, to } — sincronizare completă, pentru UN magazin și UN
 * interval (gândit pentru bucăți lunare, apelat repetat din pagina
 * Statistici Totale): aduce comenzile live din Shopify, le salvează în DB
 * (upsertOrderFromWebhook — același cod folosit de webhook-uri, deci merge
 * identic indiferent dacă rândul există deja sau nu), apoi pentru fiecare
 * fulfillment cu AWB creează/actualizează rândul Shipment și îi ia statusul
 * de livrare live (din /api/tracking — același sistem deja dovedit pe
 * pagina Comenzi), ca retururile și COD-ul încasat să fie corecte din prima
 * dată când pagina de statistici citește din DB, nu doar când apeși pe
 * "Trage live" din nou.
 *
 * Asta rezolvă de la sursă atât golul GLS (AWB-uri xConnector fără
 * Shipment la noi), cât și Sameday — fulfillment-ul Shopify conține
 * tracking_company + tracking_number indiferent de curier, deci funcționează
 * identic pentru ambii, fără să depindem de discovery-ul slab al Sameday
 * (care nu oferă dată/referință per AWB).
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { db } from '@/lib/db';
import { getShopConfig } from '@/lib/shops';
import { getAccessToken } from '@/lib/shopify/ccg-token';
import { upsertOrderFromWebhook, type WebhookOrderPayload } from '@/lib/services/order-processor';

const API_VERSION = '2026-07';
const ONLINE_GW = ['shopify_payments', 'stripe', 'paypal'];
const isOnlineGateway = (gw: string) => !!gw && ONLINE_GW.some(g => gw.toLowerCase().includes(g));

interface ShopifyFulfillment {
  tracking_company?: string;
  tracking_number?:  string;
  tracking_numbers?: string[];
  tracking_url?:     string;
}
interface ShopifyOrder extends WebhookOrderPayload {
  fulfillments?: ShopifyFulfillment[];
}

function normalizeCourier(trackingCompany: string): string {
  const c = (trackingCompany || '').toLowerCase();
  if (c.includes('gls')) return 'gls';
  if (c.includes('sameday') || c.includes('same day')) return 'sameday';
  return c.trim() || 'unknown';
}

async function fetchAllOrders(domain: string, token: string, from: string, to: string): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = [];
  let pageInfo: string | null = null;
  let guard = 0;
  while (guard++ < 40) {
    const params = new URLSearchParams({ limit: '250' });
    if (pageInfo) {
      params.set('page_info', pageInfo);
    } else {
      params.set('status', 'any');
      params.set('created_at_min', `${from}T00:00:00Z`);
      params.set('created_at_max', `${to}T23:59:59Z`);
    }
    const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/orders.json?${params}`, {
      headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store',
    });
    if (!res.ok) break;
    const data = await res.json() as { orders: ShopifyOrder[] };
    orders.push(...(data.orders || []));

    const link = res.headers.get('Link') || '';
    const nextMatch = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    if (!nextMatch) break;
    pageInfo = nextMatch[1];
  }
  return orders;
}

export async function POST(request: Request) {
  try {
    const { shop: shopKey, from, to } = await request.json() as { shop?: string; from?: string; to?: string };
    if (!shopKey || !from || !to) return NextResponse.json({ error: 'shop/from/to lipsă' }, { status: 400 });

    let shopCfg;
    try { shopCfg = getShopConfig(shopKey); }
    catch { return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 }); }

    const token = await getAccessToken(shopCfg);
    let shop = await db.shop.findFirst({ where: { domain: shopCfg.domain } });
    if (!shop) shop = await db.shop.create({ data: { domain: shopCfg.domain, accessToken: token, active: true } });

    const orders = await fetchAllOrders(shopCfg.domain, token, from, to);

    let ordersCreated = 0, ordersUpdated = 0, shipmentsCreated = 0;
    const toRefresh: Array<{ shipmentId: string; trackingNumber: string; courier: string; online: boolean }> = [];

    for (const o of orders) {
      const existing = await db.order.findFirst({ where: { shopId: shop.id, shopifyId: String(o.id) }, select: { id: true } });
      const orderId = await upsertOrderFromWebhook(shop.id, shopCfg.domain, o);
      if (existing) ordersUpdated++; else ordersCreated++;

      const online = isOnlineGateway((o.payment_gateway_names ?? [])[0] ?? o.payment_gateway ?? '');

      for (const f of (o.fulfillments || [])) {
        const trackingNumber = f.tracking_number || f.tracking_numbers?.[0];
        if (!trackingNumber) continue;
        const courier = normalizeCourier(f.tracking_company || '');

        const existingShip = await db.shipment.findUnique({ where: { orderId_courier: { orderId, courier } } });
        let shipmentId: string;
        if (!existingShip) {
          const created = await db.shipment.create({
            data: { orderId, shopId: shop.id, courier, trackingNumber, trackingUrl: f.tracking_url || null, status: 'CREATED' },
          });
          shipmentId = created.id;
          shipmentsCreated++;
          toRefresh.push({ shipmentId, trackingNumber, courier, online });
        } else {
          shipmentId = existingShip.id;
          // Doar statusurile încă "nelămurite" merită reverificate — un AWB
          // deja confirmat DELIVERED/RETURNED nu are rost să-l tragem din nou
          // la fiecare sincronizare.
          if (['CREATED', 'PENDING', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(existingShip.status)) {
            toRefresh.push({ shipmentId, trackingNumber: existingShip.trackingNumber, courier, online });
          }
        }
      }
    }

    // Status livrare live pentru AWB-urile noi/neconfirmate — același /api/tracking,
    // în loturi de 15 (mărime dovedită, ca fiecare cerere serverless să rămână scurtă).
    let statusUpdated = 0;
    if (toRefresh.length) {
      const origin = new URL(request.url).origin;
      for (let i = 0; i < toRefresh.length; i += 15) {
        const chunk = toRefresh.slice(i, i + 15);
        const byId = new Map(chunk.map(c => [c.shipmentId, c]));
        const r = await fetch(`${origin}/api/tracking`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orders: chunk.map(c => ({ id: c.shipmentId, awb: c.trackingNumber, courier: c.courier })) }),
        }).then(res => res.json()).catch(() => ({ results: [] })) as { results?: Array<{ id: string; status?: string; hasReturnCode?: boolean }> };

        for (const res of (r.results || [])) {
          const meta = byId.get(res.id);
          if (!meta) continue;
          let newStatus: string | null = null;
          if (res.hasReturnCode) {
            newStatus = 'RETURNED';
          } else if (res.status === 'delivered') {
            // Regula deja dovedită pe pagina Comenzi: GLS reutilizează codul
            // "delivered" și pentru predarea coletului retur înapoi la noi —
            // fără ramburs (plată online), "delivered" înseamnă de fapt retur.
            newStatus = (meta.courier === 'gls' && meta.online) ? 'RETURNED' : 'DELIVERED';
          } else if (['returned', 'failed_attempt', 'failed_delivery', 'return_in_progress', 'failure'].includes(res.status || '')) {
            newStatus = 'RETURNED';
          } else if (res.status === 'out_for_delivery') {
            newStatus = 'OUT_FOR_DELIVERY';
          } else if (res.status === 'in_transit' || res.status === 'confirmed') {
            newStatus = 'IN_TRANSIT';
          }
          if (newStatus) {
            await db.shipment.update({
              where: { id: res.id },
              data: {
                status: newStatus as 'DELIVERED' | 'RETURNED' | 'OUT_FOR_DELIVERY' | 'IN_TRANSIT',
                ...(newStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
              },
            });
            statusUpdated++;
          }
        }
      }
    }

    return NextResponse.json({
      ok: true, shopKey, totalOrders: orders.length,
      ordersCreated, ordersUpdated, shipmentsCreated, statusUpdated,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
