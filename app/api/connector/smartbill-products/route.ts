/**
 * app/api/connector/smartbill-products/route.ts
 * GET /api/connector/smartbill-products?q=<name_or_code>&shop=<key>
 *
 * Searches SmartBill Gestiunea Mărfuri for products.
 *
 * SmartBill does NOT have a product search endpoint in their public API.
 * The correct endpoint is GET /stocks which returns all stock items
 * with their codes and names. We filter client-side by the query.
 *
 * Endpoint: GET /stocks?cif={cif}&warehouseName={name}
 * Response: { list: [{ productName, productCode, productMeasuringUnit, quantity, price }] }
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { loadSmartBillConfig } from '@/lib/invoicing/smartbill';

interface SmartBillStockItem {
  productName:           string;
  productCode:           string;
  productMeasuringUnit?: string;
  warehouseName?:        string;
  quantity?:             number;
  price?:                number;
}

function makeAuth(email: string, token: string): string {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().toLowerCase();

  if (!q || q.length < 1) {
    return NextResponse.json({ products: [] });
  }

  const cfg = loadSmartBillConfig();
  if (!cfg.email || !cfg.token || !cfg.cif) {
    return NextResponse.json({ error: 'SmartBill neconfigurat (SMARTBILL_EMAIL / SMARTBILL_TOKEN / SMARTBILL_CIF)' }, { status: 500 });
  }

  const auth = makeAuth(cfg.email, cfg.token);

  // Build query params — warehouseName is optional
  const params = new URLSearchParams({ cif: cfg.cif });
  if (cfg.warehouseName) params.set('warehouseName', cfg.warehouseName);

  try {
    const res = await fetch(
      `https://ws.smartbill.ro/SBORO/api/stocks?${params}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept:        'application/json',
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      },
    );

    const rawText = await res.text();
    
    if (!res.ok) {
      return NextResponse.json(
        { error: `SmartBill ${res.status}: ${rawText.slice(0, 300)}` },
        { status: res.status },
      );
    }

    let data: { list?: SmartBillStockItem[] };
    try {
      data = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: `Răspuns invalid SmartBill: ${rawText.slice(0, 200)}` }, { status: 500 });
    }

    const all: SmartBillStockItem[] = data.list ?? [];

    // Filter by query — match name OR code, case-insensitive
    const matched = all.filter(p => {
      const name = (p.productName || '').toLowerCase();
      const code = (p.productCode || '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });

    // Return top 10 matches
    const products = matched.slice(0, 10).map(p => ({
      code:      p.productCode      || '',
      name:      p.productName      || '',
      unit:      p.productMeasuringUnit || 'buc',
      price:     Number(p.price)    || 0,
      stock:     p.quantity         ?? null,
      warehouse: p.warehouseName    || '',
    }));

    return NextResponse.json({ products, total: all.length });

  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
