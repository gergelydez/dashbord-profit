import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET — citit de Profit page la fiecare încărcare (nu cache-uit în
// localStorage ca restul costurilor), ca sursa cea mai proaspătă de cost.
export async function GET() {
  try {
    const rows = await db.productCost.findMany({ orderBy: { updatedAt: 'desc' } });
    const costs = rows.map(r => ({
      sku: r.sku,
      name: r.name,
      costRON: Number(r.costRON),
      costCuTvaRON: r.costCuTvaRON != null ? Number(r.costCuTvaRON) : null,
      source: r.source,
      updatedAt: r.updatedAt,
    }));
    return NextResponse.json({ ok: true, costs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST — salvat din calculatorul de Import la fiecare NIR nou.
// Body: { products: [{sku, name, costRON, costCuTvaRON}], confirm: boolean }
// Fără confirm=true, doar calculează diferența față de ce e deja în DB și o
// returnează (nu scrie nimic) — clientul arată diferența și cere confirmare
// explicită înainte de re-apelare cu confirm:true, care scrie efectiv.
export async function POST(request) {
  try {
    const { products, confirm } = await request.json();
    if (!Array.isArray(products) || !products.length) {
      return NextResponse.json({ ok: false, error: 'Lipsă produse.' }, { status: 400 });
    }
    const skus = products.map(p => String(p.sku || '').trim()).filter(Boolean);
    if (skus.length !== products.length) {
      return NextResponse.json({ ok: false, error: 'Fiecare produs trebuie să aibă SKU.' }, { status: 400 });
    }

    const existing = await db.productCost.findMany({ where: { sku: { in: skus } } });
    const existingBySku = new Map(existing.map(r => [r.sku, r]));

    const nou = [], schimbate = [], neschimbate = [];
    for (const p of products) {
      const sku = String(p.sku).trim();
      const costRON = Math.round((parseFloat(p.costRON) || 0) * 100) / 100;
      const old = existingBySku.get(sku);
      if (!old) {
        nou.push({ sku, name: p.name, costRON });
      } else if (Math.abs(Number(old.costRON) - costRON) >= 0.01) {
        schimbate.push({ sku, name: p.name, costVechi: Number(old.costRON), costNou: costRON });
      } else {
        neschimbate.push({ sku, name: p.name, costRON });
      }
    }

    if (!confirm) {
      return NextResponse.json({ ok: true, needsConfirm: true, diff: { nou, schimbate, neschimbate: neschimbate.length } });
    }

    await db.$transaction(products.map(p => {
      const sku = String(p.sku).trim();
      const costRON = Math.round((parseFloat(p.costRON) || 0) * 100) / 100;
      const costCuTvaRON = p.costCuTvaRON != null ? Math.round((parseFloat(p.costCuTvaRON) || 0) * 100) / 100 : null;
      return db.productCost.upsert({
        where: { sku },
        create: { sku, name: p.name || sku, costRON, costCuTvaRON, source: 'import' },
        update: { name: p.name || sku, costRON, costCuTvaRON, source: 'import' },
      });
    }));

    return NextResponse.json({ ok: true, updated: products.length, diff: { nou, schimbate, neschimbate: neschimbate.length } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
