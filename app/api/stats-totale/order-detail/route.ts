/**
 * app/api/stats-totale/order-detail/route.ts
 * GET ?id=<Order.id> — tot ce știm despre O comandă, pentru fereastra de
 * detaliu din Statistici Totale (click pe un rând din drill-down): client,
 * telefon, email, adresă, produse, plată (ramburs/card), facturi, AWB-uri.
 * Istoricul live al AWB-ului îl ia clientul separat din /api/tracking (GET),
 * care are deja cache de 30 min per AWB.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';

const ONLINE_GW = ['shopify_payments', 'stripe', 'paypal'];
const isOnlineGateway = (gw: string) => !!gw && ONLINE_GW.some(g => gw.toLowerCase().includes(g));

type RawAddress = { name?: string; company?: string; address1?: string; address2?: string; city?: string; province?: string; zip?: string; country?: string; phone?: string };
type RawPayload = {
  note?: string;
  tags?: string;
  payment_gateway_names?: string[];
  shipping_lines?: { title?: string; price?: string }[];
  discount_codes?: { code?: string; amount?: string }[];
  subtotal_price?: string;
  total_discounts?: string;
  billing_address?: RawAddress;
  customer?: { orders_count?: number; first_name?: string; last_name?: string; note?: string };
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  order_status_url?: string;
};

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id lipsă' }, { status: 400 });

    const o = await db.order.findUnique({
      where: { id },
      include: {
        shop: { select: { domain: true } },
        invoices: { select: { series: true, number: true, invoiceUrl: true, collected: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        shipments: {
          select: { courier: true, trackingNumber: true, trackingUrl: true, status: true, deliveredAt: true, codAmount: true, weight: true, parcels: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!o) return NextResponse.json({ error: 'Comanda nu există în baza de date' }, { status: 404 });

    const raw = (o.rawPayload || {}) as RawPayload;
    const gateway = o.paymentGateway || raw.payment_gateway_names?.[0] || '';
    const billing = raw.billing_address;
    const shopifyNumericId = o.shopifyId;

    return NextResponse.json({
      ok: true,
      order: {
        id: o.id,
        name: o.shopifyName,
        date: (o.shopifyCreatedAt || o.createdAt).toISOString(),
        shopDomain: o.shop.domain,
        shopifyAdminUrl: o.shop.domain && shopifyNumericId ? `https://${o.shop.domain}/admin/orders/${shopifyNumericId}` : null,
        status: o.status,
        cancelReason: raw.cancel_reason || null,
        financialStatus: o.financialStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        total: Number(o.totalPrice),
        subtotal: raw.subtotal_price != null ? Number(raw.subtotal_price) : null,
        currency: o.currency,
        payment: {
          gateway,
          online: isOnlineGateway(gateway),
          isPaid: o.isPaid,
        },
        customer: {
          name: o.customerName,
          phone: o.customerPhone,
          email: o.customerEmail,
          ordersCount: raw.customer?.orders_count ?? null,
        },
        shipping: {
          address1: o.shippingAddress1,
          address2: o.shippingAddress2,
          city: o.shippingCity,
          province: o.shippingProvince,
          zip: o.shippingZip,
          country: o.shippingCountry,
          method: raw.shipping_lines?.[0]?.title || null,
        },
        billing: billing ? {
          name: billing.name || '', company: billing.company || '',
          address1: billing.address1 || '', address2: billing.address2 || '',
          city: billing.city || '', province: billing.province || '', zip: billing.zip || '',
        } : null,
        lineItems: o.lineItems,
        discountCodes: (raw.discount_codes || []).map(d => d.code).filter(Boolean),
        note: raw.note || '',
        tags: raw.tags || '',
        invoices: o.invoices.map(i => ({
          number: `${i.series}${i.number}`, url: i.invoiceUrl, collected: i.collected, status: i.status,
        })),
        shipments: o.shipments.map(s => ({
          courier: s.courier,
          awb: s.trackingNumber,
          trackingUrl: s.trackingUrl,
          status: s.status,
          deliveredAt: s.deliveredAt?.toISOString() || null,
          cod: s.codAmount != null ? Number(s.codAmount) : null,
          weight: s.weight != null ? Number(s.weight) : null,
          parcels: s.parcels,
          createdAt: s.createdAt.toISOString(),
        })),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
