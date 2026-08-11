'use client';
/**
 * app/fulfillment/product-images.js
 * Product photos for the Fulfillment page's line-item rows — reuses the
 * existing /api/gls/products endpoint (already CCG-token-aware, works for
 * every shop including glato) instead of adding a new Shopify API call.
 * Fetched once per shop, cached client-side for the session.
 */
import { useState, useEffect, useRef, useMemo } from 'react';

const cacheByShop = new Map(); // shopKey -> catalog array (module-level, survives remounts)

const normSku = s => (s || '').toString().trim().toLowerCase();
const normTitle = s => (s || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function useProductImages(shopKey) {
  const [catalog, setCatalog] = useState(() => cacheByShop.get(shopKey) || []);
  const [loading, setLoading] = useState(!cacheByShop.has(shopKey));
  const fetchedShop = useRef(null);

  useEffect(() => {
    if (!shopKey || fetchedShop.current === shopKey) return;
    fetchedShop.current = shopKey;

    if (cacheByShop.has(shopKey)) {
      setCatalog(cacheByShop.get(shopKey));
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/gls/products?shop=${shopKey}`)
      .then(r => r.json())
      .then(data => {
        const products = data.ok ? (data.products || []) : [];
        cacheByShop.set(shopKey, products);
        setCatalog(products);
      })
      .catch(() => { cacheByShop.set(shopKey, []); setCatalog([]); })
      .finally(() => setLoading(false));
  }, [shopKey]);

  const bySku = useMemo(() => {
    const m = new Map();
    for (const p of catalog) if (p.sku) m.set(normSku(p.sku), p);
    return m;
  }, [catalog]);

  /** item: {sku, name} from an order line item. Returns {image, title} or null. */
  const getImage = (item) => {
    if (!item) return null;
    const sku = normSku(item.sku);
    if (sku && bySku.has(sku)) {
      const p = bySku.get(sku);
      if (p.image) return { image: p.image, title: p.title };
    }
    // Fallback: fuzzy title match (item name contains the catalog product title, or vice versa)
    const nameNorm = normTitle(item.name);
    if (nameNorm) {
      const match = catalog.find(p => p.image && p.title && (nameNorm.includes(normTitle(p.title)) || normTitle(p.title).includes(nameNorm)));
      if (match) return { image: match.image, title: match.title };
    }
    return null;
  };

  return { catalog, loading, getImage };
}
