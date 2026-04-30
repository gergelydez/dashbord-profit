/**
 * app/api/connector/smartbill-products/route.ts
 * GET /api/connector/smartbill-products?q=<name_or_code>
 *
 * Searches SmartBill Gestiunea Mărfuri for products matching the query.
 * Used in the invoice modal to auto-associate products that lack SKU.
 *
 * SmartBill API endpoint: GET /product?cif=...&productName=...
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { loadSmartBillConfig } from '@/lib/invoicing/smartbill';

interface SmartBillProduct {
  code:              string;
  name:              string;
  measuringUnitName: string;
  currency:          string;
  price:             number;
  warehouseName?:    string;
  stock?:            number;
}

function makeAuth(email: string, token: string): string {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() || '';

  if (!q || q.length < 2) {
    return NextResponse.json({ products: [] });
  }

  const cfg = loadSmartBillConfig();
  if (!cfg.email || !cfg.token || !cfg.cif) {
    return NextResponse.json({ error: 'SmartBill neconfigurat' }, { status: 500 });
  }

  const auth = makeAuth(cfg.email, cfg.token);

  try {
    // SmartBill: GET /product?cif=...&productName=...
    const res = await fetch(
      `https://ws.smartbill.ro/SBORO/api/product?cif=${encodeURIComponent(cfg.cif)}&productName=${encodeURIComponent(q)}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `SmartBill ${res.status}: ${text.slice(0, 200)}` }, { status: res.status });
    }

    const data = await res.json();
    // SmartBill returns { list: [...] } or { products: [...] }
    const raw: SmartBillProduct[] = data.list ?? data.products ?? [];

    const products = raw.map((p) => ({
      code:  p.code  || '',
      name:  p.name  || '',
      unit:  p.measuringUnitName || 'buc',
      price: Number(p.price) || 0,
      warehouse: p.warehouseName || '',
      stock: p.stock ?? null,
    }));

    return NextResponse.json({ products });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
