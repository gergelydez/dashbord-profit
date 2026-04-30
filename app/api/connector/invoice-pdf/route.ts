/**
 * Proxy PDF SmartBill — servește PDF-ul cu autentificare server-side
 * GET /api/connector/invoice-pdf?series=GLA&number=2768
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { loadSmartBillConfig } from '@/lib/invoicing/smartbill';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const series = searchParams.get('series') || '';
  const number = searchParams.get('number') || '';
  if (!series || !number) return NextResponse.json({ error: 'series și number obligatorii' }, { status: 400 });

  const cfg = loadSmartBillConfig();
  if (!cfg.email || !cfg.token || !cfg.cif) return NextResponse.json({ error: 'SmartBill neconfigurat' }, { status: 500 });

  const auth = Buffer.from(`${cfg.email.trim()}:${cfg.token.trim()}`).toString('base64');

  try {
    const res = await fetch(
      `https://ws.smartbill.ro/SBORO/api/invoice/pdf?cif=${encodeURIComponent(cfg.cif)}&seriesname=${encodeURIComponent(series)}&number=${encodeURIComponent(number)}`,
      { headers: { Authorization: `Basic ${auth}`, Accept: 'application/pdf, */*' }, cache: 'no-store' },
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `SmartBill ${res.status}: ${text.slice(0, 200)}` }, { status: res.status });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10 || buf.slice(0, 5).toString('ascii') !== '%PDF-')
      return NextResponse.json({ error: 'PDF indisponibil' }, { status: 502 });

    return new Response(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Factura-${series}${number}.pdf"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
