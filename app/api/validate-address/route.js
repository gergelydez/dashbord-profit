import { NextResponse } from 'next/server';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

// Baza de date coduri poștale românești (prefix județ → interval ZIP)
// Sursa: regulamentul Poșta Română + coduripostale.ro
const COUNTY_ZIP_RANGES = {
  'alba':          [[510000, 517999]],
  'arad':          [[300000, 317999]],
  'argeș':         [[110000, 117999]],
  'arges':         [[110000, 117999]],
  'bacău':         [[600000, 607999]],
  'bacau':         [[600000, 607999]],
  'bihor':         [[410000, 417999]],
  'bistrița-năsăud':[[420000, 427999]],
  'bistrita-nasaud':[[420000, 427999]],
  'botoșani':      [[710000, 717999]],
  'botosani':      [[710000, 717999]],
  'brăila':        [[810000, 817999]],
  'braila':        [[810000, 817999]],
  'brașov':        [[500000, 507999]],
  'brasov':        [[500000, 507999]],
  'bucurești':     [[10000, 69999]],
  'bucuresti':     [[10000, 69999]],
  'buzău':         [[120000, 127999]],
  'buzau':         [[120000, 127999]],
  'călărași':      [[910000, 917999]],
  'calarasi':      [[910000, 917999]],
  'caraș-severin': [[320000, 327999]],
  'caras-severin': [[320000, 327999]],
  'cluj':          [[400000, 407999]],
  'constanța':     [[900000, 907999]],
  'constanta':     [[900000, 907999]],
  'covasna':       [[520000, 527999]],
  'dâmbovița':     [[130000, 137999]],
  'dambovita':     [[130000, 137999]],
  'dolj':          [[200000, 207999]],
  'galați':        [[800000, 807999]],
  'galati':        [[800000, 807999]],
  'giurgiu':       [[80000, 87999]],
  'gorj':          [[210000, 217999]],
  'harghita':      [[530000, 537999]],
  'hunedoara':     [[330000, 337999]],
  'ialomița':      [[920000, 927999]],
  'ialomita':      [[920000, 927999]],
  'iași':          [[700000, 707999]],
  'iasi':          [[700000, 707999]],
  'ilfov':         [[70000, 77999]],
  'maramureș':     [[430000, 437999]],
  'maramures':     [[430000, 437999]],
  'mehedinți':     [[220000, 227999]],
  'mehedinti':     [[220000, 227999]],
  'mureș':         [[540000, 547999]],
  'mures':         [[540000, 547999]],
  'neamț':         [[610000, 617999]],
  'neamt':         [[610000, 617999]],
  'olt':           [[230000, 237999]],
  'prahova':       [[100000, 107999]],
  'sălaj':         [[450000, 457999]],
  'salaj':         [[450000, 457999]],
  'satu mare':     [[440000, 447999]],
  'sibiu':         [[550000, 557999]],
  'suceava':       [[720000, 727999]],
  'teleorman':     [[140000, 147999]],
  'timiș':         [[300000, 307999]],
  'timis':         [[300000, 307999]],
  'tulcea':        [[820000, 827999]],
  'vâlcea':        [[240000, 247999]],
  'valcea':        [[240000, 247999]],
  'vaslui':        [[730000, 737999]],
  'vrancea':       [[620000, 627999]],
};

// Dicționar: prefix ZIP (3 cifre) → județul corect
const ZIP_PREFIX_TO_COUNTY = {
  '010': 'București', '011': 'București', '012': 'București', '013': 'București',
  '014': 'București', '015': 'București', '016': 'București', '017': 'București',
  '018': 'București', '019': 'București', '020': 'București', '021': 'București',
  '022': 'București', '023': 'București', '024': 'București', '025': 'București',
  '026': 'București', '027': 'București', '028': 'București', '029': 'București',
  '030': 'București', '031': 'București', '032': 'București', '033': 'București',
  '034': 'București', '035': 'București', '036': 'București', '037': 'București',
  '038': 'București', '039': 'București', '040': 'București', '041': 'București',
  '042': 'București', '043': 'București', '044': 'București', '045': 'București',
  '046': 'București', '047': 'București', '048': 'București', '049': 'București',
  '050': 'București', '051': 'București', '052': 'București', '053': 'București',
  '054': 'București', '055': 'București', '056': 'București', '057': 'București',
  '058': 'București', '059': 'București', '060': 'București', '061': 'București',
  '062': 'București', '063': 'București', '064': 'București', '065': 'București',
  '066': 'București', '067': 'București', '068': 'București', '069': 'București',
  '070': 'Ilfov', '071': 'Ilfov', '072': 'Ilfov', '073': 'Ilfov',
  '074': 'Ilfov', '075': 'Ilfov', '076': 'Ilfov', '077': 'Ilfov',
  '080': 'Giurgiu', '081': 'Giurgiu', '082': 'Giurgiu', '083': 'Giurgiu',
  '084': 'Giurgiu', '085': 'Giurgiu', '086': 'Giurgiu', '087': 'Giurgiu',
  '100': 'Prahova', '101': 'Prahova', '102': 'Prahova', '103': 'Prahova',
  '104': 'Prahova', '105': 'Prahova', '106': 'Prahova', '107': 'Prahova',
  '110': 'Argeș', '111': 'Argeș', '112': 'Argeș', '113': 'Argeș',
  '114': 'Argeș', '115': 'Argeș', '116': 'Argeș', '117': 'Argeș',
  '120': 'Buzău', '121': 'Buzău', '122': 'Buzău', '123': 'Buzău',
  '124': 'Buzău', '125': 'Buzău', '126': 'Buzău', '127': 'Buzău',
  '130': 'Dâmbovița', '131': 'Dâmbovița', '132': 'Dâmbovița', '133': 'Dâmbovița',
  '134': 'Dâmbovița', '135': 'Dâmbovița', '136': 'Dâmbovița', '137': 'Dâmbovița',
  '140': 'Teleorman', '141': 'Teleorman', '142': 'Teleorman', '143': 'Teleorman',
  '144': 'Teleorman', '145': 'Teleorman', '146': 'Teleorman', '147': 'Teleorman',
  '200': 'Dolj', '201': 'Dolj', '202': 'Dolj', '203': 'Dolj',
  '204': 'Dolj', '205': 'Dolj', '206': 'Dolj', '207': 'Dolj',
  '210': 'Gorj', '211': 'Gorj', '212': 'Gorj', '213': 'Gorj',
  '214': 'Gorj', '215': 'Gorj', '216': 'Gorj', '217': 'Gorj',
  '220': 'Mehedinți', '221': 'Mehedinți', '222': 'Mehedinți', '223': 'Mehedinți',
  '224': 'Mehedinți', '225': 'Mehedinți', '226': 'Mehedinți', '227': 'Mehedinți',
  '230': 'Olt', '231': 'Olt', '232': 'Olt', '233': 'Olt',
  '234': 'Olt', '235': 'Olt', '236': 'Olt', '237': 'Olt',
  '240': 'Vâlcea', '241': 'Vâlcea', '242': 'Vâlcea', '243': 'Vâlcea',
  '244': 'Vâlcea', '245': 'Vâlcea', '246': 'Vâlcea', '247': 'Vâlcea',
  '300': 'Timiș', '301': 'Timiș', '302': 'Timiș', '303': 'Timiș',
  '304': 'Timiș', '305': 'Timiș', '306': 'Timiș', '307': 'Timiș',
  '308': 'Timiș', '309': 'Timiș', '310': 'Arad', '311': 'Arad',
  '312': 'Arad', '313': 'Arad', '314': 'Arad', '315': 'Arad',
  '316': 'Arad', '317': 'Arad', '320': 'Caraș-Severin', '321': 'Caraș-Severin',
  '322': 'Caraș-Severin', '323': 'Caraș-Severin', '324': 'Caraș-Severin',
  '325': 'Caraș-Severin', '326': 'Caraș-Severin', '327': 'Caraș-Severin',
  '330': 'Hunedoara', '331': 'Hunedoara', '332': 'Hunedoara', '333': 'Hunedoara',
  '334': 'Hunedoara', '335': 'Hunedoara', '336': 'Hunedoara', '337': 'Hunedoara',
  '400': 'Cluj', '401': 'Cluj', '402': 'Cluj', '403': 'Cluj',
  '404': 'Cluj', '405': 'Cluj', '406': 'Cluj', '407': 'Cluj',
  '410': 'Bihor', '411': 'Bihor', '412': 'Bihor', '413': 'Bihor',
  '414': 'Bihor', '415': 'Bihor', '416': 'Bihor', '417': 'Bihor',
  '420': 'Bistrița-Năsăud', '421': 'Bistrița-Năsăud', '422': 'Bistrița-Năsăud',
  '423': 'Bistrița-Năsăud', '424': 'Bistrița-Năsăud', '425': 'Bistrița-Năsăud',
  '426': 'Bistrița-Năsăud', '427': 'Bistrița-Năsăud',
  '430': 'Maramureș', '431': 'Maramureș', '432': 'Maramureș', '433': 'Maramureș',
  '434': 'Maramureș', '435': 'Maramureș', '436': 'Maramureș', '437': 'Maramureș',
  '440': 'Satu Mare', '441': 'Satu Mare', '442': 'Satu Mare', '443': 'Satu Mare',
  '444': 'Satu Mare', '445': 'Satu Mare', '446': 'Satu Mare', '447': 'Satu Mare',
  '450': 'Sălaj', '451': 'Sălaj', '452': 'Sălaj', '453': 'Sălaj',
  '454': 'Sălaj', '455': 'Sălaj', '456': 'Sălaj', '457': 'Sălaj',
  '500': 'Brașov', '501': 'Brașov', '502': 'Brașov', '503': 'Brașov',
  '504': 'Brașov', '505': 'Brașov', '506': 'Brașov', '507': 'Brașov',
  '510': 'Alba', '511': 'Alba', '512': 'Alba', '513': 'Alba',
  '514': 'Alba', '515': 'Alba', '516': 'Alba', '517': 'Alba',
  '520': 'Covasna', '521': 'Covasna', '522': 'Covasna', '523': 'Covasna',
  '524': 'Covasna', '525': 'Covasna', '526': 'Covasna', '527': 'Covasna',
  '530': 'Harghita', '531': 'Harghita', '532': 'Harghita', '533': 'Harghita',
  '534': 'Harghita', '535': 'Harghita', '536': 'Harghita', '537': 'Harghita',
  '540': 'Mureș', '541': 'Mureș', '542': 'Mureș', '543': 'Mureș',
  '544': 'Mureș', '545': 'Mureș', '546': 'Mureș', '547': 'Mureș',
  '550': 'Sibiu', '551': 'Sibiu', '552': 'Sibiu', '553': 'Sibiu',
  '554': 'Sibiu', '555': 'Sibiu', '556': 'Sibiu', '557': 'Sibiu',
  '600': 'Bacău', '601': 'Bacău', '602': 'Bacău', '603': 'Bacău',
  '604': 'Bacău', '605': 'Bacău', '606': 'Bacău', '607': 'Bacău',
  '610': 'Neamț', '611': 'Neamț', '612': 'Neamț', '613': 'Neamț',
  '614': 'Neamț', '615': 'Neamț', '616': 'Neamț', '617': 'Neamț',
  '620': 'Vrancea', '621': 'Vrancea', '622': 'Vrancea', '623': 'Vrancea',
  '624': 'Vrancea', '625': 'Vrancea', '626': 'Vrancea', '627': 'Vrancea',
  '700': 'Iași', '701': 'Iași', '702': 'Iași', '703': 'Iași',
  '704': 'Iași', '705': 'Iași', '706': 'Iași', '707': 'Iași',
  '710': 'Botoșani', '711': 'Botoșani', '712': 'Botoșani', '713': 'Botoșani',
  '714': 'Botoșani', '715': 'Botoșani', '716': 'Botoșani', '717': 'Botoșani',
  '720': 'Suceava', '721': 'Suceava', '722': 'Suceava', '723': 'Suceava',
  '724': 'Suceava', '725': 'Suceava', '726': 'Suceava', '727': 'Suceava',
  '730': 'Vaslui', '731': 'Vaslui', '732': 'Vaslui', '733': 'Vaslui',
  '734': 'Vaslui', '735': 'Vaslui', '736': 'Vaslui', '737': 'Vaslui',
  '800': 'Galați', '801': 'Galați', '802': 'Galați', '803': 'Galați',
  '804': 'Galați', '805': 'Galați', '806': 'Galați', '807': 'Galați',
  '810': 'Brăila', '811': 'Brăila', '812': 'Brăila', '813': 'Brăila',
  '814': 'Brăila', '815': 'Brăila', '816': 'Brăila', '817': 'Brăila',
  '820': 'Tulcea', '821': 'Tulcea', '822': 'Tulcea', '823': 'Tulcea',
  '824': 'Tulcea', '825': 'Tulcea', '826': 'Tulcea', '827': 'Tulcea',
  '900': 'Constanța', '901': 'Constanța', '902': 'Constanța', '903': 'Constanța',
  '904': 'Constanța', '905': 'Constanța', '906': 'Constanța', '907': 'Constanța',
  '910': 'Călărași', '911': 'Călărași', '912': 'Călărași', '913': 'Călărași',
  '914': 'Călărași', '915': 'Călărași', '916': 'Călărași', '917': 'Călărași',
  '920': 'Ialomița', '921': 'Ialomița', '922': 'Ialomița', '923': 'Ialomița',
  '924': 'Ialomița', '925': 'Ialomița', '926': 'Ialomița', '927': 'Ialomița',
};

function normalizeStr(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i')
    .trim();
}

function getCountyFromZip(zip) {
  const z = (zip || '').replace(/\s/g, '');
  if (z.length !== 6 || !/^\d{6}$/.test(z)) return null;
  return ZIP_PREFIX_TO_COUNTY[z.slice(0, 3)] || null;
}

function validateZipMatchesCounty(zip, county) {
  const z = (zip || '').replace(/\s/g, '');
  if (!z || z.length !== 6) return { ok: false, reason: 'format' };

  const countyFromZip = getCountyFromZip(z);
  if (!countyFromZip) return { ok: true }; // ZIP necunoscut — nu putem valida

  const normalCounty = normalizeStr(county);
  const normalFromZip = normalizeStr(countyFromZip);

  // Verifică match — suficient dacă unul conține pe celălalt
  if (normalFromZip.includes(normalCounty) || normalCounty.includes(normalFromZip)) {
    return { ok: true, countyFromZip };
  }

  // Cazuri speciale
  if ((normalCounty === 'bucuresti' || normalCounty === 'b') && normalFromZip === 'bucuresti') {
    return { ok: true, countyFromZip };
  }

  return { ok: false, reason: 'mismatch', countyFromZip, expectedCounty: countyFromZip };
}

function validateZipMatchesCity(zip, city, county) {
  const z = (zip || '').replace(/\s/g, '');
  if (!z || z.length !== 6 || !/^\d{6}$/.test(z)) return null;

  const countyFromZip = getCountyFromZip(z);
  if (!countyFromZip) return null;

  // Verifică județ
  const matchResult = validateZipMatchesCounty(z, county);
  if (!matchResult.ok) {
    return {
      mismatch: true,
      countyFromZip: matchResult.countyFromZip,
      message: `Codul poștal ${z} aparține județului ${matchResult.countyFromZip}, nu ${county || '?'}. Distanța poate fi de zeci de km.`,
    };
  }
  return { mismatch: false, countyFromZip };
}

export async function POST(request) {
  try {
    const { name, address, city, county, zip, phone, skipEmpty } = await request.json();
    const issues = [];
    const zipClean = (zip || '').replace(/\s/g, '');

    // ── Validare adresă stradală ───────────────────────────────────────────
    if (!address || address.trim().length < 3) {
      issues.push({ field: 'address', severity: 'error', msg: 'Adresa stradală lipsește sau e prea scurtă' });
    } else if (!/\d/.test(address)) {
      issues.push({ field: 'address', severity: 'warning', msg: 'Adresa nu conține număr stradal — curierul nu poate livra' });
    }

    // ── Validare ZIP format ────────────────────────────────────────────────
    if (!zipClean) {
      issues.push({ field: 'zip', severity: 'error', msg: 'Cod poștal lipsă' });
    } else if (!/^\d{6}$/.test(zipClean)) {
      issues.push({ field: 'zip', severity: 'error', msg: 'Codul poștal trebuie să aibă exact 6 cifre' });
    } else if (county) {
      const zipCheck = validateZipMatchesCity(zipClean, city, county);
      if (zipCheck?.mismatch) {
        issues.push({ field: 'zip', severity: 'error', msg: zipCheck.message, countyFromZip: zipCheck.countyFromZip });
      }
    }

    // ── Validare oraș ──────────────────────────────────────────────────────
    if (!city || city.trim().length < 2) {
      issues.push({ field: 'city', severity: 'error', msg: 'Orașul lipsește' });
    }

    // ── Validare județ ─────────────────────────────────────────────────────
    if (!county || county.trim().length < 2) {
      issues.push({ field: 'county', severity: 'warning', msg: 'Județul lipsește — poate cauza erori la curier' });
    }

    // ── Validare telefon ───────────────────────────────────────────────────
    if (!skipEmpty || phone) {
      const digits = (phone || '').replace(/\D/g, '');
      if (!digits || digits.length < 9) {
        issues.push({ field: 'phone', severity: 'error', msg: 'Telefon invalid (minim 9 cifre)' });
      } else if (!digits.startsWith('07') && !digits.startsWith('02') && !digits.startsWith('03')) {
        issues.push({ field: 'phone', severity: 'warning', msg: 'Prefix telefon neobișnuit pentru România' });
      }
    }

    // ── Validare nume ──────────────────────────────────────────────────────
    if (!skipEmpty && (!name || name.trim().length < 3)) {
      issues.push({ field: 'name', severity: 'error', msg: 'Numele destinatarului lipsește' });
    }

    // ── LOOKUP ZIP EXACT via API-uri externe ──────────────────────────────
    // Încearcă să găsească ZIP-ul corect pentru strada + orașul dat
    let suggestion = null;

    if (city && zipClean && zipClean.length === 6) {
      try {
        // 1. Încearcă Nominatim cu query specific pentru stradă + oraș
        const streetForQuery = address ? address.replace(/\d+.*$/, '').trim() : '';
        const query = [streetForQuery, city, county, 'Romania'].filter(Boolean).join(', ');
        const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=ro&addressdetails=1`;
        
        const nomRes = await fetch(nomUrl, {
          headers: { 'User-Agent': 'FulfillmentBridge/2.0 contact@glamx.ro' },
          signal: AbortSignal.timeout(4000),
          cache: 'no-store',
        });
        
        if (nomRes.ok) {
          const results = await nomRes.json();
          
          // Caută rezultatul cu cel mai bun match pentru strada noastră
          let bestMatch = null;
          for (const r of results) {
            const a = r.address || {};
            const postcode = (a.postcode || '').replace(/\s/g, '');
            if (!postcode || postcode.length !== 6) continue;
            
            // Verifică că orașul se potrivește
            const rCity = normalizeStr(a.city || a.town || a.village || a.municipality || '');
            const qCity = normalizeStr(city);
            if (!rCity.includes(qCity) && !qCity.includes(rCity)) continue;
            
            bestMatch = { postcode, city: a.city||a.town||a.village||city, county: a.county||county, road: a.road||'' };
            break;
          }
          
          if (bestMatch && bestMatch.postcode !== zipClean) {
            // ZIP diferit față de ce a introdus clientul
            suggestion = {
              postcode: bestMatch.postcode,
              city: bestMatch.city,
              county: bestMatch.county,
              formattedAddress: address,
              zipMismatch: true,
              zipMessage: `⚠️ ZIP incorect! Strada "${streetForQuery || address}" din ${city} are codul ${bestMatch.postcode}, nu ${zipClean}. Distanța între aceste coduri poate fi zeci de km.`,
            };
            // Actualizează și eroarea din issues
            const idx = issues.findIndex(i => i.field === 'zip');
            const msg = { field: 'zip', severity: 'error', msg: `Cod poștal incorect — corect pentru ${city}: ${bestMatch.postcode}` };
            if (idx >= 0) issues[idx] = msg;
            else issues.push(msg);
          } else if (bestMatch && bestMatch.postcode === zipClean) {
            // ZIP confirmat corect
            suggestion = {
              postcode: bestMatch.postcode,
              city: bestMatch.city,
              county: bestMatch.county,
              formattedAddress: address,
              zipMismatch: false,
              zipMessage: `✓ Cod poștal ${zipClean} confirmat pentru ${city}`,
            };
          }
        }
      } catch (e) {
        console.warn('[validate-address] Nominatim error:', e.message);
        // Fallback la validarea pe bază de prefix județ
        if (county) {
          const zipCheck = validateZipMatchesCity(zipClean, city, county);
          if (zipCheck?.mismatch) {
            suggestion = {
              county: zipCheck.countyFromZip,
              postcode: zipClean,
              city, zipMismatch: true,
              zipMessage: `⚠️ ZIP ${zipClean} aparține județului ${zipCheck.countyFromZip}, nu ${county}!`,
              formattedAddress: address,
            };
          }
        }
      }
    }

    // Dacă ZIP lipsește
    if (!zipClean && city) {
      suggestion = {
        zipMissing: true,
        zipMessage: `Cod poștal lipsă. Verificați pe postaromana.ro pentru ${city}.`,
        formattedAddress: address, city, county,
      };
    }

    return NextResponse.json({
      ok: true,
      valid: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      suggestion,
    }, { headers: CORS });

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: CORS });
  }
}
