import { NextResponse } from 'next/server';

const SD_BASE = 'https://api.sameday.ro';

// Credentials from Vercel Environment Variables (never exposed to browser)
const SD_USER = process.env.SAMEDAY_USERNAME;
const SD_PASS = process.env.SAMEDAY_PASSWORD;

async function getToken() {
  const res = await fetch(`${SD_BASE}/api/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AUTH-TOKEN': '' },
    body: JSON.stringify({ username: SD_USER, password: SD_PASS }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Sameday auth ${res.status}: ${txt.slice(0, 100)}`);
  }
  const data = await res.json();
  return data.token;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const awbs = (searchParams.get('awbs') || '').split(',').filter(Boolean);

  if (!SD_USER || !SD_PASS) {
    return NextResponse.json({ error: 'Sameday credentials not configured in environment variables' }, { status: 500 });
  }

  try {
    const token = await getToken();

    if (!awbs.length) {
      return NextResponse.json({ ok: true, message: 'Autentificare Sameday reușită!' });
    }

    const results = {};
    for (const awb of awbs.slice(0, 100)) {
      try {
        const res = await fetch(`${SD_BASE}/api/client/parcel-status/${awb.trim()}`, {
          headers: { 'X-AUTH-TOKEN': token, 'Accept': 'application/json' },
          cache: 'no-store',
        });
        if (res.ok) {
          results[awb] = await res.json();
        } else {
          const res2 = await fetch(`${SD_BASE}/api/awb/${awb.trim()}/status`, {
            headers: { 'X-AUTH-TOKEN': token, 'Accept': 'application/json' },
            cache: 'no-store',
          });
          results[awb] = res2.ok ? await res2.json() : { httpStatus: res.status };
        }
      } catch (e) {
        results[awb] = { error: e.message };
      }
    }

    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
  });
}
