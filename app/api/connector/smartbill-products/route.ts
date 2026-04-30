/**
 * app/api/connector/smartbill-products/route.ts
 * GET /api/connector/smartbill-products?q=<query>&debug=1
 *
 * Caută produse în Gestiunea SmartBill.
 * Cu ?debug=1 returnează răspunsul brut de la fiecare endpoint testat.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { loadSmartBillConfig } from '@/lib/invoicing/smartbill';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

interface StockProduct {
  productName?: string; productCode?: string;
  measuringUnit?: string; productMeasuringUnit?: string;
  quantity?: number; price?: number;
  name?: string; code?: string; [k: string]: unknown;
}

interface StockWarehouseGroup {
  warehouse?: { warehouseName?: string; [k: string]: unknown };
  products?: StockProduct[];
  // flat format fallback
  productName?: string; productCode?: string;
  measuringUnit?: string; quantity?: number; price?: number;
  [k: string]: unknown;
}

function makeAuth(e: string, t: string) {
  return Buffer.from(`${e.trim()}:${t.trim()}`).toString('base64');
}

/**
 * SmartBill /stocks returns TWO possible structures:
 *
 * NESTED (grouped by warehouse):
 *   { list: [{ warehouse: { warehouseName }, products: [{ productName, productCode, measuringUnit, quantity, price }] }] }
 *
 * FLAT (old format):
 *   { list: [{ productName, productCode, productMeasuringUnit, quantity, price }] }
 */
function extractProducts(data: Record<string, unknown>, warehouseName = ''): Array<{ code: string; name: string; unit: string; price: number; stock: number; warehouse: string }> {
  const list = (data.list ?? data.stocks ?? data.products ?? data.data ?? []) as StockWarehouseGroup[];
  const result: Array<{ code: string; name: string; unit: string; price: number; stock: number; warehouse: string }> = [];

  for (const entry of list) {
    // NESTED format: entry has warehouse + products array
    if (Array.isArray(entry.products)) {
      const wh = entry.warehouse?.warehouseName ?? warehouseName;
      for (const p of entry.products) {
        const code = String(p.productCode ?? p.code ?? '');
        const name = String(p.productName ?? p.name ?? '');
        if (!code && !name) continue;
        result.push({
          code,
          name,
          unit:      String(p.measuringUnit ?? p.productMeasuringUnit ?? 'buc'),
          price:     Number(p.price) || 0,
          stock:     Number(p.quantity) || 0,
          warehouse: wh,
        });
      }
    } else {
      // FLAT format: entry is the product directly
      const code = String(entry.productCode ?? entry.code ?? '');
      const name = String(entry.productName ?? entry.name ?? '');
      if (!code && !name) continue;
      result.push({
        code,
        name,
        unit:      String(entry.measuringUnit ?? entry.productMeasuringUnit ?? 'buc'),
        price:     Number(entry.price) || 0,
        stock:     Number(entry.quantity) || 0,
        warehouse: warehouseName,
      });
    }
  }

  return result;
}

function norm(s: string) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function tryFetch(url: string, auth: string): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data, text: text.slice(0, 500) };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: (e as Error).message };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q     = (searchParams.get('q') || '').trim();
  const debug = searchParams.get('debug') === '1';

  if (!q) return NextResponse.json({ products: [] });

  const cfg = loadSmartBillConfig();
  if (!cfg.email || !cfg.token || !cfg.cif) {
    return NextResponse.json({ error: 'SmartBill neconfigurat' }, { status: 500 });
  }

  const auth  = makeAuth(cfg.email, cfg.token);
  const today = new Date().toISOString().slice(0, 10);
  const cif   = encodeURIComponent(cfg.cif);
  const wh    = cfg.warehouseName ? encodeURIComponent(cfg.warehouseName) : '';
  const qEnc  = encodeURIComponent(q);

  // Toate URL-urile de încercat — în ordinea probabilității
  const urls = [
    `${BASE}/stocks?cif=${cif}&date=${today}&productCode=${qEnc}`,
    `${BASE}/stocks?cif=${cif}&date=${today}&productName=${qEnc}`,
    wh && `${BASE}/stocks?cif=${cif}&date=${today}&productCode=${qEnc}&warehouseName=${wh}`,
    wh && `${BASE}/stocks?cif=${cif}&date=${today}&productName=${qEnc}&warehouseName=${wh}`,
    // Fără dată — unele versiuni nu cer date
    `${BASE}/stocks?cif=${cif}&productCode=${qEnc}`,
    `${BASE}/stocks?cif=${cif}&productName=${qEnc}`,
    // Încarcă tot și filtrează local
    `${BASE}/stocks?cif=${cif}&date=${today}`,
    wh && `${BASE}/stocks?cif=${cif}&date=${today}&warehouseName=${wh}`,
  ].filter(Boolean) as string[];

  const debugLog: Record<string, unknown> = {};
  const qNorm = norm(q);

  for (const url of urls) {
    const key = url.replace(BASE, '').replace(cif, 'CIF');
    const result = await tryFetch(url, auth);

    if (debug) debugLog[key] = result;

    if (!result.ok) continue;

    const data = result.data as Record<string, unknown>;
    const all  = extractProducts(data, cfg.warehouseName);

    if (!all.length) continue;

    // Filtrare locală după query
    const matched = all.filter(p =>
      norm(p.code).includes(qNorm) || norm(p.name).includes(qNorm)
    );

    if (matched.length > 0) {
      const response: Record<string, unknown> = {
        products: matched.slice(0, 15),
        source:   key,
      };
      if (debug) response._debug = debugLog;
      return NextResponse.json(response);
    }

    // URL-ul a returnat date dar query-ul nu s-a găsit — listăm ce există
    if (url.includes(`date=${today}`) && !url.includes('productCode=') && !url.includes('productName=')) {
      const response: Record<string, unknown> = {
        products: [],
        allProducts: debug ? all : undefined,
        error: `Produsul "${q}" nu există în Gestiunea SmartBill. Produse disponibile: ${all.slice(0, 5).map(p => `${p.code} (${p.name})`).join(', ')}${all.length > 5 ? '...' : ''}`,
      };
      if (debug) response._debug = debugLog;
      return NextResponse.json(response);
    }
  }

  const response: Record<string, unknown> = {
    products: [],
    error: 'Nu s-au putut încărca produsele din Gestiunea SmartBill.',
  };
  if (debug) response._debug = debugLog;
  return NextResponse.json(response);
}
