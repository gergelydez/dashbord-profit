/**
 * app/api/connector/smartbill-products/route.ts
 * GET /api/connector/smartbill-products?q=<name_or_code>
 *
 * Searches SmartBill Gestiunea Mărfuri using the official /stocks endpoint.
 *
 * Confirmed from smartbill-ts-sdk (official SDK):
 * GET /stocks?cif={cif}&date={YYYY-MM-DD}&productName={q}&productCode={q}&warehouseName={name}
 *
 * We call it TWICE — once searching by productName, once by productCode —
 * then merge and deduplicate results.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { loadSmartBillConfig } from '@/lib/invoicing/smartbill';

interface SmartBillStockItem {
  productName:            string;
  productCode:            string;
  productMeasuringUnit?:  string;
  warehouseName?:         string;
  quantity?:              number;
  price?:                 number;
}

function makeAuth(email: string, token: string): string {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

async function fetchStocks(
  auth: string,
  cif: string,
  date: string,
  filterKey: 'productName' | 'productCode',
  filterValue: string,
  warehouseName?: string,
): Promise<SmartBillStockItem[]> {
  const params = new URLSearchParams({ cif, date, [filterKey]: filterValue });
  if (warehouseName) params.set('warehouseName', warehouseName);

  const res = await fetch(
    `https://ws.smartbill.ro/SBORO/api/stocks?${params}`,
    {
      headers: {
        Authorization:  `Basic ${auth}`,
        Accept:         'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SmartBill ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as { list?: SmartBillStockItem[] };
  return data.list ?? [];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();

  if (!q || q.length < 1) {
    return NextResponse.json({ products: [] });
  }

  const cfg = loadSmartBillConfig();
  if (!cfg.email || !cfg.token || !cfg.cif) {
    return NextResponse.json(
      { error: 'SmartBill neconfigurat (SMARTBILL_EMAIL / SMARTBILL_TOKEN / SMARTBILL_CIF)' },
      { status: 500 },
    );
  }

  const auth = makeAuth(cfg.email, cfg.token);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    // Search by name AND by code in parallel, then merge results
    const [byName, byCode] = await Promise.allSettled([
      fetchStocks(auth, cfg.cif, today, 'productName', q, cfg.warehouseName),
      fetchStocks(auth, cfg.cif, today, 'productCode', q, cfg.warehouseName),
    ]);

    const nameResults  = byName.status  === 'fulfilled' ? byName.value  : [];
    const codeResults  = byCode.status  === 'fulfilled' ? byCode.value  : [];
    const nameError    = byName.status  === 'rejected'  ? (byName.reason as Error).message  : null;
    const codeError    = byCode.status  === 'rejected'  ? (byCode.reason as Error).message  : null;

    // If both failed, return the error
    if (nameResults.length === 0 && codeResults.length === 0 && (nameError || codeError)) {
      return NextResponse.json(
        { error: nameError || codeError, products: [] },
        { status: 400 },
      );
    }

    // Merge and deduplicate by productCode
    const seen = new Set<string>();
    const merged: SmartBillStockItem[] = [];
    for (const item of [...nameResults, ...codeResults]) {
      const key = item.productCode || item.productName;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }

    const products = merged.slice(0, 10).map(p => ({
      code:      p.productCode             || '',
      name:      p.productName             || '',
      unit:      p.productMeasuringUnit    || 'buc',
      price:     Number(p.price)           || 0,
      stock:     p.quantity                ?? null,
      warehouse: p.warehouseName           || '',
    }));

    return NextResponse.json({ products });

  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
