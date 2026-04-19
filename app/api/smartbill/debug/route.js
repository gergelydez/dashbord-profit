import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(e, t) {
  return Buffer.from(`${e.trim()}:${t.trim()}`).toString('base64');
}

export async function GET() {
  const email  = process.env.SMARTBILL_EMAIL;
  const token  = process.env.SMARTBILL_TOKEN;
  const cif    = process.env.SMARTBILL_CIF;
  const series = process.env.SMARTBILL_SERIES || 'GLA';

  if (!email || !token || !cif) {
    return NextResponse.json({ error: 'Env vars lipsă: SMARTBILL_EMAIL / SMARTBILL_TOKEN / SMARTBILL_CIF' }, { status: 500 });
  }

  const auth = makeAuth(email, token);
  const out  = { env: { email, cif, series }, invoices: {} };

  // Fetch 3 facturi consecutive ca să vedem structura reală
  for (const n of [2690, 2689, 2688, 100, 1]) {
    try {
      const res = await fetch(
        `${BASE}/invoice?cif=${encodeURIComponent(cif)}&seriesName=${encodeURIComponent(series)}&number=${n}`,
        { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) }
      );
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      out.invoices[`${series}${n}`] = { status: res.status, json };
    } catch (e) {
      out.invoices[`${series}${n}`] = { error: e.message };
    }
  }

  return NextResponse.json(out);
}
