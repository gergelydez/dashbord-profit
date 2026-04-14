/**
 * app/api/connector/validate-address/route.ts
 * POST — validates a Romanian address via xConnector's public UI.
 * Parses HTML response to extract ZIP match and score.
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

function stripDiacritics(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export async function POST(request: Request) {
  const { county, city, zip, street, number: num = '' } = await request.json() as {
    county: string; city: string; zip: string; street: string; number?: string;
  };

  if (!street || !city) {
    return NextResponse.json({ error: 'street and city are required' }, { status: 400 });
  }

  const params = new URLSearchParams({
    searchType: 'all',
    county:   stripDiacritics(county || ''),
    city:     stripDiacritics(city),
    zipcode:  zip || '',
    address1: stripDiacritics(street),
    address2: num,
  });

  const url = `https://address-validator.xconnector.app/ui/zipcodes?${params}`;

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AddressValidator/1.0)' },
    });

    if (!res.ok) throw new Error(`Validator HTTP ${res.status}`);
    const html = await res.text();

    // Pass / fail
    const hasPass = html.includes('matcher-card--pass');
    const hasFail = html.includes('matcher-card--fail');

    // Correct ZIP suggested by the validator
    const correctZipM = html.match(/matches the ZIP code \[<strong>(\d+)<\/strong>\]/);
    const correctZip  = correctZipM ? correctZipM[1] : null;

    // Scores
    const scoreStr = (key: string) => {
      const m = html.match(new RegExp(`${key}: <strong>(\\d+)%<\\/strong>`));
      return m ? parseInt(m[1]) : null;
    };

    const scores = {
      street: scoreStr('Street'),
      city:   scoreStr('City'),
      county: scoreStr('County'),
      zip:    scoreStr('ZIP'),
    };

    // Matched street/city labels
    const streetMatchM = html.match(/&quot;(.*?)&quot; → &quot;(.*?)&quot;/);
    const streetMatched = streetMatchM ? streetMatchM[2] : null;

    const zipMismatch = !!(correctZip && zip && correctZip !== zip.trim());

    return NextResponse.json({
      found:       hasPass || (!hasFail && !!correctZip),
      zipMismatch,
      correctZip,
      inputZip:    zip,
      streetMatched,
      scores,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
