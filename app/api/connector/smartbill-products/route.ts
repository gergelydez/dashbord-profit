/**
 * app/api/connector/smartbill-products/route.ts
 * GET /api/connector/smartbill-products?q=<name_or_code>
 *
 * Caută produse în Gestiunea SmartBill.
 *
 * Documentat oficial în SDK C# SmartBill:
 *   GET /stocks?cif={cif}&date={YYYY-MM-DD}&productName={q}&productCode={q}&warehouseName={wh}
 *
 * IMPORTANT: dacă stocul e 0, SmartBill poate să nu returneze produsul.
 * De aceea facem 2 cereri: una cu productCode, una cu productName — în paralel.
 * Și returnăm toate rezultatele indiferent de cantitate.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { loadSmartBillConfig } from '@/lib/invoicing/smartbill';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

interface StockItem {
  productName?:           string;
  productCode?:           string;
  productMeasuringUnit?:  string;
  warehouseName?:         string;
  quantity?:              number;
  price?:                 number;
  // câmpuri alternative
  name?: string; code?: string; denumire?: string; cod?: string;
  stoc?: number; cantitate?: number;
  [k: string]: unknown;
}

function norm(s: string) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function makeAuth(e: string, t: string) {
  return Buffer.from(`${e.trim()}:${t.trim()}`).toString('base64');
}

function mapItem(p: StockItem) {
  return {
    code:      String(p.productCode ?? p.code ?? p.cod ?? ''),
    name:      String(p.productName ?? p.name ?? p.denumire ?? ''),
    unit:      String(p.productMeasuringUnit ?? 'buc'),
    price:     Number(p.price) || 0,
    stock:     Number(p.quantity ?? p.stoc ?? p.cantitate) || 0,
    warehouse: String(p.warehouseName ?? ''),
  };
}

async function fetchStocks(auth: string, params: URLSearchParams): Promise<StockItem[]> {
  const res = await fetch(`${BASE}/stocks?${params}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SmartBill ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json() as Record<string, unknown>;
  return (data.list ?? data.stocks ?? data.products ?? data.data ?? []) as StockItem[];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ products: [] });

  const cfg = loadSmartBillConfig();
  if (!cfg.email || !cfg.token || !cfg.cif) {
    return NextResponse.json({ error: 'SmartBill neconfigurat (SMARTBILL_EMAIL / SMARTBILL_TOKEN / SMARTBILL_CIF)' }, { status: 500 });
  }

  const auth  = makeAuth(cfg.email, cfg.token);
  const today = new Date().toISOString().slice(0, 10);

  // Construim seturile de parametri pentru fiecare variantă de căutare
  const base = { cif: cfg.cif, date: today };
  if (cfg.warehouseName) Object.assign(base, { warehouseName: cfg.warehouseName });

  const byCode = new URLSearchParams({ ...base, productCode: q });
  const byName = new URLSearchParams({ ...base, productName: q });

  // Rulăm ambele cereri în paralel
  const [codeResult, nameResult] = await Promise.allSettled([
    fetchStocks(auth, byCode),
    fetchStocks(auth, byName),
  ]);

  const codeItems = codeResult.status === 'fulfilled' ? codeResult.value : [];
  const nameItems = nameResult.status === 'fulfilled' ? nameResult.value : [];
  const errors: string[] = [];
  if (codeResult.status === 'rejected') errors.push((codeResult.reason as Error).message);
  if (nameResult.status === 'rejected') errors.push((nameResult.reason as Error).message);

  // Merge + deduplicare după cod
  const seen = new Set<string>();
  const all: ReturnType<typeof mapItem>[] = [];

  for (const raw of [...codeItems, ...nameItems]) {
    const mapped = mapItem(raw);
    const key = mapped.code || mapped.name;
    if (key && !seen.has(key)) {
      seen.add(key);
      all.push(mapped);
    }
  }

  // Dacă nu s-a găsit nimic cu parametrii exacti, încearcă fără filtru (toate produsele)
  // și filtrează local — util când SmartBill nu returnează produse cu stoc 0
  if (all.length === 0) {
    try {
      const allParams = new URLSearchParams({ cif: cfg.cif, date: today });
      if (cfg.warehouseName) allParams.set('warehouseName', cfg.warehouseName);

      const allItems = await fetchStocks(auth, allParams);
      const qNorm = norm(q);

      const filtered = allItems
        .map(mapItem)
        .filter(p => norm(p.code).includes(qNorm) || norm(p.name).includes(qNorm));

      if (filtered.length > 0) {
        return NextResponse.json({ products: filtered.slice(0, 15), source: 'all+filter' });
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  if (all.length === 0 && errors.length > 0) {
    return NextResponse.json({ products: [], error: errors.join(' | ') }, { status: 200 });
  }

  return NextResponse.json({
    products: all.slice(0, 15),
    source: 'stocks',
  });
}
