/**
 * lib/agent/actions.ts
 * Write operations the agent can PROPOSE. They are never run by the agent itself:
 * the dashboard shows them as a card and they run only when the user taps "Confirmă"
 * (POST /api/agent/execute).
 */
import { gql, getLocations, resolveShopKeys } from './shopify-data';

export type AgentAction =
  | { type: 'update_variant_prices'; shop: string; summary: string; productId: string;
      variants: { variantId: string; price?: string; compareAtPrice?: string | null }[] }
  | { type: 'update_product'; shop: string; summary: string; productId: string;
      fields: { title?: string; status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'; descriptionHtml?: string; tags?: string[] } }
  | { type: 'set_inventory'; shop: string; summary: string; locationId?: string;
      items: { inventoryItemId: string; quantity: number }[] }
  | { type: 'create_discount'; shop: string; summary: string; code: string; percentage: number;
      title?: string; startsAt?: string; endsAt?: string | null };

export const ACTION_TYPES = ['update_variant_prices', 'update_product', 'set_inventory', 'create_discount'] as const;

/** Light structural validation so a malformed proposal fails before reaching Shopify. */
export function validateAction(a: any): string | null {
  if (!a || typeof a !== 'object') return 'acțiune invalidă';
  if (!ACTION_TYPES.includes(a.type)) return `tip necunoscut: ${a.type}`;
  try { a.shop = resolveShopKeys(a.shop)[0]; } catch (e: any) { return e.message; }
  if (!a.summary) return 'lipsește summary';
  switch (a.type) {
    case 'update_variant_prices':
      if (!String(a.productId).startsWith('gid://shopify/Product/')) return 'productId trebuie să fie gid://shopify/Product/…';
      if (!Array.isArray(a.variants) || !a.variants.length) return 'lipsesc variantele';
      if (a.variants.some((v: any) => !String(v.variantId).startsWith('gid://shopify/ProductVariant/'))) return 'variantId invalid';
      return null;
    case 'update_product':
      if (!String(a.productId).startsWith('gid://shopify/Product/')) return 'productId invalid';
      if (!a.fields || !Object.keys(a.fields).length) return 'nimic de modificat';
      return null;
    case 'set_inventory':
      if (!Array.isArray(a.items) || !a.items.length) return 'lipsesc itemii de stoc';
      if (a.items.some((i: any) => !String(i.inventoryItemId).startsWith('gid://shopify/InventoryItem/') || !Number.isInteger(i.quantity) || i.quantity < 0))
        return 'inventoryItemId sau cantitate invalidă';
      return null;
    case 'create_discount':
      if (!/^[A-Za-z0-9_-]{3,40}$/.test(a.code || '')) return 'cod reducere invalid (3-40 caractere, litere/cifre)';
      if (!(a.percentage > 0 && a.percentage <= 90)) return 'procent invalid (1-90)';
      return null;
  }
  return null;
}

function userErrors(errs: { field?: string[]; message: string }[] | undefined) {
  if (errs?.length) throw new Error(errs.map(e => `${e.field?.join('.') ?? ''} ${e.message}`.trim()).join('; '));
}

export async function executeAction(a: AgentAction): Promise<string> {
  switch (a.type) {
    case 'update_variant_prices': {
      const d = await gql(a.shop, `mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $p, variants: $v) {
          productVariants { id title price compareAtPrice } userErrors { field message }
        } }`, {
        p: a.productId,
        v: a.variants.map(v => ({
          id: v.variantId,
          ...(v.price !== undefined ? { price: String(v.price) } : {}),
          ...(v.compareAtPrice !== undefined ? { compareAtPrice: v.compareAtPrice === null ? null : String(v.compareAtPrice) } : {}),
        })),
      });
      userErrors(d.productVariantsBulkUpdate.userErrors);
      return d.productVariantsBulkUpdate.productVariants.map((v: any) => `${v.title}: ${v.price}${v.compareAtPrice ? ` (vechi ${v.compareAtPrice})` : ''}`).join(', ');
    }
    case 'update_product': {
      const d = await gql(a.shop, `mutation($p: ProductUpdateInput!) {
        productUpdate(product: $p) { product { id title status } userErrors { field message } } }`,
        { p: { id: a.productId, ...a.fields } });
      userErrors(d.productUpdate.userErrors);
      return `${d.productUpdate.product.title} — ${d.productUpdate.product.status}`;
    }
    case 'set_inventory': {
      let locationId = a.locationId;
      if (!locationId) {
        const locs = await getLocations(a.shop);
        locationId = (locs.find((l: any) => l.isActive) || locs[0])?.id;
        if (!locationId) throw new Error('Nicio locație de stoc găsită');
      }
      const d = await gql(a.shop, `mutation($i: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $i) { inventoryAdjustmentGroup { id } userErrors { field message } } }`, {
        i: {
          name: 'available', reason: 'correction',
          quantities: a.items.map(i => ({ inventoryItemId: i.inventoryItemId, locationId, quantity: i.quantity, changeFromQuantity: null })),
        },
      });
      userErrors(d.inventorySetQuantities.userErrors);
      return `stoc setat pentru ${a.items.length} variante`;
    }
    case 'create_discount': {
      const d = await gql(a.shop, `mutation($d: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } } }`, {
        d: {
          title: a.title || a.code, code: a.code,
          startsAt: a.startsAt || new Date().toISOString(),
          ...(a.endsAt ? { endsAt: a.endsAt } : {}),
          context: { all: 'ALL' },
          customerGets: { value: { percentage: a.percentage / 100 }, items: { all: true } },
        },
      });
      userErrors(d.discountCodeBasicCreate.userErrors);
      return `cod ${a.code} (-${a.percentage}%) creat`;
    }
  }
}
