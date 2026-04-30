/**
 * app/api/connector/update-order/route.ts
 * POST — inline-edit customer info, COD/ramburs amount, and order note.
 *
 * Body shape:
 * {
 *   shopifyOrderId: string,
 *   shop?: string,
 *   customer?: { name?: string; phone?: string; email?: string },
 *   address?: { address1?: string; city?: string; zip?: string; province?: string },
 *   codAmount?: number,        // updates order note attribute "ramburs"
 *   note?: string,             // free-form order note
 *   lineItems?: Array<{ variantId?: string; name?: string; sku?: string; quantity?: number; price?: string }>,
 * }
 *
 * Shopify doesn't allow editing fulfilled order line items via REST.
 * For line items we update the order note_attributes with a JSON blob
 * that your invoice service can pick up, AND attempt a REST update
 * which may partially succeed on pending orders.
 */

import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { getShopConfig, getDefaultShopKey } from '@/lib/shops';

interface UpdateOrderBody {
  shopifyOrderId: string;
  shop?: string;
  customer?: {
    name?:  string;
    phone?: string;
    email?: string;
  };
  address?: {
    address1?: string;
    city?:     string;
    zip?:      string;
    province?: string;
  };
  codAmount?: number;
  note?: string;
  lineItems?: Array<{
    name?:     string;
    sku?:      string;
    quantity?: number;
    price?:    string;
  }>;
}

async function shopifyPut(domain: string, token: string, path: string, body: object) {
  const res = await fetch(`https://${domain}/admin/api/2026-07/${path}`, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

export async function POST(request: Request) {
  let body: UpdateOrderBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { shopifyOrderId, shop: shopKey = getDefaultShopKey(), customer, address, codAmount, note, lineItems } = body;

  if (!shopifyOrderId) {
    return NextResponse.json({ error: 'shopifyOrderId required' }, { status: 400 });
  }

  let shopCfg;
  try {
    shopCfg = getShopConfig(shopKey);
  } catch {
    return NextResponse.json({ error: `Shop "${shopKey}" not configured` }, { status: 400 });
  }

  const { domain, accessToken: token } = shopCfg;

  // ── Build Shopify order update payload ─────────────────────────────────────
  const orderPatch: Record<string, unknown> = { id: shopifyOrderId };
  const updatedFields: string[] = [];

  // Customer name (shipping + billing)
  if (customer?.name) {
    const [firstName, ...rest] = customer.name.trim().split(' ');
    const lastName = rest.join(' ') || '';
    orderPatch.shipping_address = {
      ...(orderPatch.shipping_address as object | undefined ?? {}),
      first_name: firstName,
      last_name:  lastName,
    };
    orderPatch.billing_address = {
      ...(orderPatch.billing_address as object | undefined ?? {}),
      first_name: firstName,
      last_name:  lastName,
    };
    updatedFields.push('name');
  }

  // Phone
  if (customer?.phone !== undefined) {
    orderPatch.shipping_address = {
      ...(orderPatch.shipping_address as object | undefined ?? {}),
      phone: customer.phone,
    };
    updatedFields.push('phone');
  }

  // Email
  if (customer?.email !== undefined) {
    orderPatch.email = customer.email;
    updatedFields.push('email');
  }

  // Address fields
  if (address) {
    const existing = (orderPatch.shipping_address as Record<string, string> | undefined) ?? {};
    if (address.address1 !== undefined) existing.address1 = address.address1;
    if (address.city     !== undefined) existing.city     = address.city;
    if (address.zip      !== undefined) existing.zip      = address.zip;
    if (address.province !== undefined) existing.province = address.province;
    orderPatch.shipping_address = existing;
    updatedFields.push('address');
  }

  // Note
  if (note !== undefined) {
    orderPatch.note = note;
    updatedFields.push('note');
  }

  // ── note_attributes for COD amount and line items override ─────────────────
  // We read current note_attributes first so we don't wipe existing ones
  const currentRes = await fetch(
    `https://${domain}/admin/api/2026-07/orders/${shopifyOrderId}.json?fields=note_attributes`,
    { headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store' },
  );

  let noteAttrs: Array<{ name: string; value: string }> = [];
  if (currentRes.ok) {
    const { order } = await currentRes.json();
    noteAttrs = Array.isArray(order?.note_attributes) ? order.note_attributes : [];
  }

  const setAttr = (name: string, value: string) => {
    const idx = noteAttrs.findIndex(a => a.name === name);
    if (idx >= 0) noteAttrs[idx].value = value;
    else noteAttrs.push({ name, value });
  };

  if (codAmount !== undefined) {
    setAttr('ramburs', String(codAmount));
    updatedFields.push('codAmount');
  }

  if (lineItems && lineItems.length > 0) {
    // Store edited line items as a note_attribute for invoice service to use
    setAttr('xc_line_items_override', JSON.stringify(lineItems));
    updatedFields.push('lineItems');
  }

  orderPatch.note_attributes = noteAttrs;

  // ── PUT to Shopify ─────────────────────────────────────────────────────────
  try {
    await shopifyPut(domain, token, `orders/${shopifyOrderId}.json`, { order: orderPatch });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: updatedFields });
}
