/**
 * GET /api/connector/label-proxy?url=<encoded-url>
 * Proxy pentru etichete externe (xConnector) — evită CORS în browser
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const ALLOWED_HOSTS = [
  'xconnector.app',
  'api.mygls.ro',
  'api.mygls.hu',
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url') || '';

  if (!rawUrl) {
    return NextResponse.json({ error: 'url param required' }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: 'URL invalid' }, { status: 400 });
  }

  // Securitate: doar hosturi permise
  if (!ALLOWED_HOSTS.some(h => targetUrl.hostname === h || targetUrl.hostname.endsWith('.' + h))) {
    return NextResponse.json({ error: 'Host nepermis' }, { status: 403 });
  }

  try {
    const res = await fetch(rawUrl, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream error ${res.status}` }, { status: res.status });
    }

    const buf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'application/pdf';

    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type':        contentType,
        'Content-Disposition': `inline; filename="label.pdf"`,
        'Cache-Control':       'private, max-age=3600',
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
