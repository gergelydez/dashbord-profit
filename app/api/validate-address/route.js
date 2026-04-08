import { NextResponse } from 'next/server';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

// Geoapify API key — gratuit 3000 req/zi, are toate străzile RO cu ZIP exact
// Setează GEOAPIFY_KEY în Vercel ENV sau folosim key-ul public de demo
const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || '';

// Nominatim ca fallback (fără key, dar mai puțin precis)
async function lookupNominatim(address, city) {
  const query = `${address}, ${city}, Romania`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=ro&addressdetails=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FulfillmentBridge/3.0' },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const results = await res.json();

  const norm = s => (s||'').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[șş]/g,'s').replace(/[țţ]/g,'t')
    .replace(/[ăâ]/g,'a').replace(/î/g,'i').trim();

  const cityN = norm(city);
  for (const r of results) {
    const a = r.address || {};
    const zip = (a.postcode||'').replace(/\s/g,'');
    if (!zip || zip.length !== 6 || !/^\d{6}$/.test(zip)) continue;
    const rCity = norm(a.city||a.town||a.village||a.municipality||a.suburb||'');
    // Verificare strictă — orașul trebuie să se potrivească
    if (!rCity || (!rCity.includes(cityN) && !cityN.includes(rCity))) continue;
    return {
      zip,
      city: a.city||a.town||a.village||city,
      county: a.county||'',
      street: a.road||'',
      source: 'nominatim',
    };
  }
  return null;
}

// Geoapify — are baza de date Poșta Română cu ZIP la nivel de stradă
async function lookupGeoapify(address, city, apiKey) {
  if (!apiKey) return null;
  const text = `${address}, ${city}, Romania`;
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&filter=countrycode:ro&format=json&limit=5&apiKey=${apiKey}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json();

  const norm = s => (s||'').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[șş]/g,'s').replace(/[țţ]/g,'t')
    .replace(/[ăâ]/g,'a').replace(/î/g,'i').trim();

  const cityN = norm(city);
  for (const r of (data.results||[])) {
    const zip = (r.postcode||'').replace(/\s/g,'');
    if (!zip || zip.length !== 6) continue;
    const rCity = norm(r.city||r.town||r.village||'');
    if (!rCity || (!rCity.includes(cityN) && !cityN.includes(rCity))) continue;
    return {
      zip,
      city: r.city||r.town||city,
      county: r.county||r.state||'',
      street: r.street||'',
      source: 'geoapify',
    };
  }
  return null;
}

// Validare locală telefon / câmpuri simple
function validateFields(fields) {
  const { name, address, city, zip, phone, skipEmpty } = fields;
  const issues = [];
  const zipClean = (zip||'').replace(/\s/g,'');

  if (!address||address.trim().length<3)
    issues.push({ field:'address', severity:'error', msg:'Adresa stradală lipsește' });
  else if (!/\d/.test(address))
    issues.push({ field:'address', severity:'warning', msg:'Adresa nu conține număr stradal' });

  if (!zipClean)
    issues.push({ field:'zip', severity:'error', msg:'Cod poștal lipsă' });
  else if (!/^\d{6}$/.test(zipClean))
    issues.push({ field:'zip', severity:'error', msg:'Codul poștal trebuie să aibă exact 6 cifre' });

  if (!city||city.trim().length<2)
    issues.push({ field:'city', severity:'error', msg:'Orașul lipsește' });

  if (!skipEmpty||phone) {
    const d = (phone||'').replace(/\D/g,'');
    if (!d||d.length<9)
      issues.push({ field:'phone', severity:'error', msg:'Telefon invalid (minim 9 cifre)' });
  }

  if (!skipEmpty&&(!name||name.trim().length<3))
    issues.push({ field:'name', severity:'error', msg:'Numele destinatarului lipsește' });

  return issues;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, address, city, county, zip, phone, skipEmpty } = body;
    const zipClean = (zip||'').replace(/\s/g,'');

    // Validare câmpuri de bază
    const issues = validateFields({ name, address, city, zip, phone, skipEmpty });

    // Dacă adresa sau orașul lipsesc, nu are rost să facem lookup
    if (!address||!city) {
      return NextResponse.json({ ok:true, valid:false, issues, suggestion:null }, { headers:CORS });
    }

    // ── LOOKUP ZIP EXACT ─────────────────────────────────────────────────
    let found = null;

    // 1. Geoapify (dacă avem key — cel mai precis, baza Poșta Română)
    if (GEOAPIFY_KEY) {
      found = await lookupGeoapify(address, city, GEOAPIFY_KEY);
    }

    // 2. Fallback Nominatim
    if (!found) {
      found = await lookupNominatim(address, city);
    }

    let suggestion = null;

    if (found) {
      const zipFromApi = found.zip;
      const match = zipClean === zipFromApi;

      if (!match && zipClean.length === 6) {
        // ZIP greșit — arată clar ce e corect
        const msg = `Pentru ${city}, ${address} codul poștal corect este ${zipFromApi}, nu ${zipClean}`;

        // Actualizează issues
        const idx = issues.findIndex(i=>i.field==='zip');
        const issue = { field:'zip', severity:'error', msg };
        if (idx>=0) issues[idx]=issue; else issues.push(issue);

        suggestion = {
          postcode: zipFromApi,
          city: found.city,
          county: found.county||county,
          formattedAddress: address,
          zipMismatch: true,
          zipMessage: `⚠️ ${msg}`,
          source: found.source,
        };
      } else if (match) {
        suggestion = {
          postcode: zipFromApi,
          city: found.city,
          county: found.county||county,
          formattedAddress: address,
          zipMismatch: false,
          zipMessage: `✓ Cod poștal ${zipClean} confirmat pentru ${address}, ${city}`,
          source: found.source,
        };
      }
    } else if (zipClean.length===6) {
      // API-urile nu au găsit strada — nu putem confirma sau infirma
      suggestion = {
        postcode: null,
        city, county,
        formattedAddress: address,
        zipMismatch: null,
        zipMessage: `Nu s-a putut verifica automat. Verificați manual pe postaromana.ro`,
      };
    }

    return NextResponse.json({
      ok: true,
      valid: issues.filter(i=>i.severity==='error').length===0,
      issues,
      suggestion,
    }, { headers:CORS });

  } catch(e) {
    return NextResponse.json({ error: e.message }, { status:500, headers:CORS });
  }
}