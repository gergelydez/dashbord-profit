import { NextResponse } from 'next/server';
import { getShopConfig, getDefaultShopKey } from '@/lib/shops';

// ── Flattened product/variant catalog for the manual "Etichetă nouă" picker ──
// Server-side only: the Shopify access token never reaches the browser.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shopKey = searchParams.get('shop') || getDefaultShopKey();

  let shop;
  try {
    shop = getShopConfig(shopKey);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }

  try {
    const headers = { 'X-Shopify-Access-Token': shop.accessToken, 'Content-Type': 'application/json' };
    const products = [];
    let url = `https://${shop.domain}/admin/api/2024-01/products.json?limit=250&status=active&fields=id,title,image,variants`;

    while (url) {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`Shopify products fetch failed: ${res.status}`);
      const data = await res.json();
      products.push(...(data.products || []));
      const link = res.headers.get('Link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }

    const flat = [];
    for (const p of products) {
      for (const v of (p.variants || [])) {
        const variantTitle = v.title && v.title !== 'Default Title' ? v.title : '';
        flat.push({
          id: `${p.id}-${v.id}`,
          title: variantTitle ? `${p.title} - ${variantTitle}` : p.title,
          sku: v.sku || '',
          price: parseFloat(v.price) || 0,
          image: p.image?.src || null,
        });
      }
    }

    return NextResponse.json({ ok: true, products: flat, count: flat.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
