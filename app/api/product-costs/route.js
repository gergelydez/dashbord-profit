import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain');
  const token = searchParams.get('token');

  if (!domain || !token) {
    return NextResponse.json({ error: 'Missing domain or token' }, { status: 400 });
  }

  try {
    const headers = {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    };

    // Step 1: Get all variants with inventory_item_id
    const allVariants = [];
    let variantUrl = `https://${domain}/admin/api/2024-01/variants.json?limit=250&fields=id,title,sku,product_id,inventory_item_id,price`;
    
    while (variantUrl) {
      const res = await fetch(variantUrl, { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`Variants fetch failed: ${res.status}`);
      const data = await res.json();
      allVariants.push(...(data.variants || []));
      const link = res.headers.get('Link') || '';
      const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
      variantUrl = nextMatch ? nextMatch[1] : null;
    }

    if (!allVariants.length) return NextResponse.json({ costs: {}, variantCosts: {} });

    // Step 2: Get inventory items (cost) in batches of 100
    const inventoryItemIds = [...new Set(allVariants.map(v => v.inventory_item_id).filter(Boolean))];
    const costByInvId = {};

    for (let i = 0; i < inventoryItemIds.length; i += 100) {
      const batch = inventoryItemIds.slice(i, i + 100);
      const invRes = await fetch(
        `https://${domain}/admin/api/2024-01/inventory_items.json?ids=${batch.join(',')}&fields=id,sku,cost`,
        { headers, cache: 'no-store' }
      );
      if (!invRes.ok) continue;
      const invData = await invRes.json();
      (invData.inventory_items || []).forEach(item => {
        if (item.cost) costByInvId[item.id] = parseFloat(item.cost);
      });
    }

    // Step 3: Get all products for title matching
    const allProducts = [];
    let productUrl = `https://${domain}/admin/api/2024-01/products.json?limit=250&fields=id,title,variants`;
    while (productUrl) {
      const res = await fetch(productUrl, { headers, cache: 'no-store' });
      if (!res.ok) break;
      const data = await res.json();
      allProducts.push(...(data.products || []));
      const link = res.headers.get('Link') || '';
      const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
      productUrl = nextMatch ? nextMatch[1] : null;
    }

    // Step 4: Build cost maps
    const costs = {};        // name key -> cost (for matching by product+variant name)
    const variantCosts = {}; // variant_id -> cost (most reliable)
    const skuCosts = {};     // sku -> cost

    allProducts.forEach(product => {
      (product.variants || []).forEach(variant => {
        const cost = costByInvId[variant.inventory_item_id];
        if (!cost) return;

        // Map by variant ID (most reliable - used in line_items)
        variantCosts[String(variant.id)] = cost;

        // Map by SKU
        if (variant.sku) {
          skuCosts[variant.sku.toLowerCase().trim()] = cost;
        }

        // Map by "Product Title - Variant Title" (various formats)
        const varTitle = variant.title === 'Default Title' ? '' : variant.title;
        const fullName = varTitle
          ? `${product.title} - ${varTitle}`.toLowerCase().trim()
          : product.title.toLowerCase().trim();
        costs[fullName] = cost;

        // Also store shorter keys for partial matching
        costs[product.title.toLowerCase().trim()] = cost;
        if (varTitle) costs[varTitle.toLowerCase().trim()] = cost;
      });
    });

    return NextResponse.json({ 
      costs,        // name-based matching
      variantCosts, // variant_id based (best)
      skuCosts,     // sku-based
      variantCount: allVariants.length,
      productCount: allProducts.length,
    });

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
