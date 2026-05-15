import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const GLS_BASE = 'https://api.mygls.ro/ParcelService.svc/json';

async function buildAuth() {
  const username     = process.env.GLS_USERNAME || '';
  const password     = process.env.GLS_PASSWORD || '';
  const clientNumber = parseInt(process.env.GLS_CLIENT_NUMBER || '0', 10);
  const encoded  = new TextEncoder().encode(password);
  const hashBuf  = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  const pwdBytes = Array.from(new Uint8Array(hashBuf));
  return { Username: username, Password: pwdBytes, ClientNumberList: [clientNumber] };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tracking = (searchParams.get('tracking') || '').replace(/\s/g, '');

  const username     = process.env.GLS_USERNAME || 'LIPSĂ';
  const clientNumber = parseInt(process.env.GLS_CLIENT_NUMBER || '0', 10);
  const password     = process.env.GLS_PASSWORD || '';

  const encoded  = new TextEncoder().encode(password);
  const hashBuf  = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  const pwdBytes = Array.from(new Uint8Array(hashBuf));

  // Trimite request și arată exact ce s-a trimis
  const body = {
    Username: username,
    Password: pwdBytes,
    ClientNumberList: [clientNumber],
    ParcelNumber: parseInt(tracking, 10),
    ReturnPOD: false,
    LanguageIsoCode: 'RO',
  };

  const res = await fetch(`${GLS_BASE}/GetParcelStatuses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const data = await res.json();

  return NextResponse.json({
    credentiale_trimise: {
      username,
      clientNumber,
      parcelNumber: parseInt(tracking, 10),
      passwordHashLength: pwdBytes.length,
    },
    raspuns_gls: data,
  });
}