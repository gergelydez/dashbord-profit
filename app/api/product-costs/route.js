import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain');
  const token = searchParams.get('token');

  if (!domain || !token) {
    return NextResponse.json({ error: 'Missing domain or token' }, { status: 400 });
  }

  try {
    // Fetch all products with their variants and cost_per_item
    // cost_per_item requires inventory_item_id, so we need 2 calls:
    // 1. Get all variants with inventory_item_id
    // 2. Get inventory items with cost

    const allVariants = [];
    let variantUrl = `https://${domain}/admin/api/2024-01/variants.json?limit=250&fields=id,title,sku,product_id,inventory_item_id,price`;

    // Fetch all variants (paginated)
    while (variantUrl) {
      const res = await fetch(variantUrl, {
        headers: { 'X-Shopify-Access-Token': token },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Variants fetch failed: ${res.status}`);
      const data = await res.json();
      allVariants.push(...(data.variants || []));

      // Check for next page via Link header
      const link = res.headers.get('Link') || '';
      const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
      variantUrl = nextMatch ? nextMatch[1] : null;
    }

    if (!allVariants.length) {
      return NextResponse.json({ costs: {} });
    }

    // Get inventory item IDs in batches of 100
    const inventoryItemIds = allVariants.map(v => v.inventory_item_id).filter(Boolean);
    const costs = {}; // sku -> cost, title -> cost

    for (let i = 0; i < inventoryItemIds.length; i += 100) {
      const batch = inventoryItemIds.slice(i, i + 100);
      const invRes = await fetch(
        `https://${domain}/admin/api/2024-01/inventory_items.json?ids=${batch.join(',')}&fields=id,sku,cost`,
        {
          headers: { 'X-Shopify-Access-Token': token },
          cache: 'no-store',
        }
      );
      if (!invRes.ok) continue;
      const invData = await invRes.json();

      // Map inventory_item_id -> cost
      const costByInvId = {};
      (invData.inventory_items || []).forEach(item => {
        if (item.cost) costByInvId[item.id] = parseFloat(item.cost);
      });

      // Map variant SKU and title -> cost
      allVariants.forEach(v => {
        const cost = costByInvId[v.inventory_item_id];
        if (cost) {
          if (v.sku) costs[v.sku.toLowerCase().trim()] = cost;
          // Also store by product_id+variant for matching
          costs[`variant_${v.id}`] = cost;
        }
      });
    }

    // Also get product titles for matching by name
    const productRes = await fetch(
      `https://${domain}/admin/api/2024-01/products.json?limit=250&fields=id,title,variants`,
      {
        headers: { 'X-Shopify-Access-Token': token },
        cache: 'no-store',
      }
    );
    if (productRes.ok) {
      const productData = await productRes.json();
      (productData.products || []).forEach(p => {
        (p.variants || []).forEach(v => {
          const cost = costs[`variant_${v.id}`];
          if (cost) {
            // Store by product title + variant title for name matching
            const key = v.title === 'Default Title'
              ? p.title.toLowerCase().trim()
              : `${p.title} - ${v.title}`.toLowerCase().trim();
            costs[key] = cost;
          }
        });
      });
    }

    return NextResponse.json({ costs, variantCount: allVariants.length });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
  });
}

