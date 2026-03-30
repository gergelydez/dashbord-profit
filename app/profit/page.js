'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

const fmt = (n, dec = 2) => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtK = (n) => Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'K' : fmt(n, 0);
const today = new Date();
// preset default: last_month (luna trecuta)


function splitCSV(line) {
  const res = []; let cur = '', q = false;
  for (const c of line) { if (c === '"') q = !q; else if ((c === ',' || c === ';') && !q) { res.push(cur); cur = ''; } else cur += c; }
  res.push(cur); return res;
}

const DEFAULT_PRODUCT_COSTS = [
  { id: 'BW-2NEGRU',     sku: 'BW-2NEGRU',     pattern: 'balkan watch 2',             excludes: [], name: 'BALKAN WATCH 2',                      cost: 203.15, updated: '30.03.2026' },
  { id: 'G69',           sku: 'G69',            pattern: 'bratara inteligenta g69',    excludes: [], name: 'Bratara inteligenta G69',              cost: 93.77,  updated: '30.03.2026' },
  { id: 'TG19',          sku: 'TG19',           pattern: 'bratara inteligenta tg19',   excludes: [], name: 'Bratara inteligenta TG19',             cost: 88.83,  updated: '30.03.2026' },
  { id: 'VITRO',         sku: 'VITRO',          pattern: 'bratara inteligenta vitro',  excludes: [], name: 'Bratara inteligenta VITRO',            cost: 104.68, updated: '30.03.2026' },
  { id: 'CHARGER-C',     sku: 'CHARGER-C',      pattern: 'cablu incarcare',            excludes: [], name: 'Cablu incarcare',                      cost: 11.77,  updated: '30.03.2026' },
  { id: 'CLAMPS',        sku: 'CLAMPS',         pattern: 'carlige din aluminiu',       excludes: [], name: 'Carlige din aluminiu',                 cost: 18.63,  updated: '30.03.2026' },
  { id: 'LX10-B',        sku: 'LX10-B',         pattern: 'casti tidalux lx10',         excludes: [], name: 'Casti TIDALUX LX10',                   cost: 60.06,  updated: '30.03.2026' },
  { id: 'EARBUDS2',      sku: 'EARBUDS2',       pattern: 'earbuds2',                   excludes: [], name: 'Casti audio cu bluetooth',             cost: 20.79,  updated: '30.03.2026' },
  { id: 'EARBUDS1',      sku: 'EARBUDS1',       pattern: 'earbuds1',                   excludes: [], name: 'Casti wireless',                       cost: 20.83,  updated: '30.03.2026' },
  { id: 'C20PRO',        sku: 'C20PRO',         pattern: 'c20 pro',                    excludes: [], name: 'Ceas inteligent C20 PRO',              cost: 31.70,  updated: '30.03.2026' },
  { id: 'DM58',          sku: 'DM58',           pattern: 'delta max plus',             excludes: [], name: 'Ceas inteligent DELTA MAX PLUS',       cost: 158.85, updated: '30.03.2026' },
  { id: 'M99',           sku: 'M99',            pattern: 'delta max ultra',            excludes: [], name: 'Ceas inteligent DELTA MAX ULTRA',      cost: 244.77, updated: '30.03.2026' },
  { id: 'WATCHX',        sku: 'WATCHX',         pattern: 'watch x',                    excludes: [], name: 'Ceas inteligent WATCH X',              cost: 115.27, updated: '30.03.2026' },
  { id: 'Z85BLACK',      sku: 'Z85BLACK',       pattern: 'z85',                        excludes: [], name: 'CEAS INTELIGENT Z85 MAX',              cost: 72.30,  updated: '30.03.2026' },
  { id: 'CP1',           sku: 'CP1',            pattern: 'corector postura',           excludes: [], name: 'Corector postura',                     cost: 32.84,  updated: '30.03.2026' },
  { id: 'WBAND',         sku: 'WBAND',          pattern: 'curea ceas inteligent',      excludes: [], name: 'Curea ceas inteligent',                cost: 16.91,  updated: '30.03.2026' },
  { id: 'WBAND-M',       sku: 'WBAND-M',        pattern: 'curea smartwatch',           excludes: [], name: 'Curea smartwatch WBAND-M',             cost: 10.55,  updated: '30.03.2026' },
  { id: 'HD300PRO',      sku: 'HD300PRO',       pattern: 'delta max pro',              excludes: [], name: 'DELTA MAX PRO',                        cost: 181.00, updated: '30.03.2026' },
  { id: 'BW-2GRI',       sku: 'BW-2GRI',        pattern: 'bw-2gri',                    excludes: [], name: 'Delta Max Ultra Smartwatch 4G (BW-2GRI)', cost: 203.15, updated: '30.03.2026' },
  { id: 'PRST',          sku: 'PRST',           pattern: 'etichete autoadezive',       excludes: [], name: 'Etichete autoadezive',                 cost: 34.12,  updated: '30.03.2026' },
  { id: 'WARMER',        sku: 'WARMER',         pattern: 'fierbator',                  excludes: [], name: 'Fierbator apa-lapte',                  cost: 232.77, updated: '30.03.2026' },
  { id: 'DM56',          sku: 'DM56',           pattern: 'glamx delta max',            excludes: [], name: 'GLAMX DELTA MAX DM56',                 cost: 154.80, updated: '30.03.2026' },
  { id: 'HUSA1',         sku: 'HUSA1',          pattern: 'husa protectie',             excludes: [], name: 'Husa protectie scaune auto',           cost: 42.54,  updated: '30.03.2026' },
  { id: 'SMSWCSV1',      sku: 'SMSWCSV1',       pattern: 'intrerupator cap scara',     excludes: [], name: 'INTRERUPATOR CAP SCARA V1',            cost: 70.21,  updated: '30.03.2026' },
  { id: 'SMSWV4',        sku: 'SMSWV4',         pattern: 'intrerupator smart v4',      excludes: [], name: 'INTRERUPATOR SMART V4',                cost: 62.26,  updated: '30.03.2026' },
  { id: 'PR-1',          sku: 'PR-1',           pattern: 'imprimanta etichete',        excludes: [], name: 'Imprimanta etichete',                  cost: 224.05, updated: '30.03.2026' },
  { id: 'XPERTCHEMY',    sku: 'XPERTCHEMY',     pattern: 'kit restaurare faruri',      excludes: [], name: 'KIT RESTAURARE FARURI',                cost: 23.45,  updated: '30.03.2026' },
  { id: 'LED3IN1',       sku: 'LED3IN1',        pattern: 'lampa led 3 in 1',           excludes: [], name: 'Lampa LED 3 IN 1',                     cost: 47.13,  updated: '30.03.2026' },
  { id: 'MPAD',          sku: 'MPAD',           pattern: 'mouse pad',                  excludes: [], name: 'Mouse Pad',                            cost: 143.37, updated: '30.03.2026' },
  { id: 'PORT-ZIGBEE-V1',sku: 'PORT-ZIGBEE-V1', pattern: 'port zigbee',               excludes: [], name: 'PORT ZIGBEE',                          cost: 73.34,  updated: '30.03.2026' },
  { id: 'SMC2',          sku: 'SMC2',           pattern: 'priza dubla',                excludes: [], name: 'PRIZA DUBLA',                          cost: 42.84,  updated: '30.03.2026' },
  { id: 'PRINTSERVER',   sku: 'PRINTSERVER',    pattern: 'printer server',             excludes: [], name: 'Printer Server',                       cost: 151.64, updated: '30.03.2026' },
  { id: 'DM76',          sku: 'DM76',           pattern: 'dm76',                       excludes: [], name: 'SMARTWATCH DELTA MAX GOLD',            cost: 162.42, updated: '30.03.2026' },
  { id: 'WS-1-B',        sku: 'WS-1-B',         pattern: 'ws-1',                       excludes: [], name: 'SMARTWATCH WS-1',                      cost: 63.76,  updated: '30.03.2026' },
  { id: 'SET2',          sku: 'SET2',           pattern: 'set bijuterii femei',        excludes: [], name: 'Set bijuterii femei',                  cost: 23.77,  updated: '30.03.2026' },
  { id: 'SET1',          sku: 'SET1',           pattern: 'set cadou barbati',          excludes: [], name: 'Set cadou barbati',                    cost: 72.96,  updated: '30.03.2026' },
  { id: 'SET2IN1',       sku: 'SET2IN1',        pattern: 'set smartwatch+casti',       excludes: [], name: 'Set smartwatch+casti',                 cost: 22.99,  updated: '30.03.2026' },
  { id: 'SK41',          sku: 'SK41',           pattern: 'kalobee sk41',               excludes: [], name: 'Smartwatch Kalobee SK41',              cost: 112.73, updated: '30.03.2026' },
  { id: 'X122',          sku: 'X122',           pattern: 'sterilizator uv tidalux',    excludes: [], name: 'Sterilizator UV Tidalux X122',         cost: 87.67,  updated: '30.03.2026' },
  { id: 'H9IN1-VERDE',   sku: 'H9IN1-VERDE',    pattern: 'suport inteligent 9in1 verde',excludes:[], name: 'Suport inteligent 9in1 Verde',         cost: 6.76,   updated: '30.03.2026' },
  { id: 'H9IN1-alb',     sku: 'H9IN1-alb',      pattern: 'suport inteligent 9in1 alb', excludes:[], name: 'Suport inteligent 9in1 Alb',           cost: 6.76,   updated: '30.03.2026' },
  { id: '9IN1-COLOR',    sku: '9IN1-COLOR',     pattern: 'suport inteligent 9in1 color',excludes:[], name: 'Suport inteligent 9in1 Color',        cost: 6.76,   updated: '30.03.2026' },
  { id: 'H9IN1-GRI',     sku: 'H9IN1-GRI',      pattern: 'suport inteligent 9in1 gri', excludes:[], name: 'Suport inteligent 9in1 Gri',           cost: 6.76,   updated: '30.03.2026' },
  { id: 'H9IN1-ROZ',     sku: 'H9IN1-ROZ',      pattern: 'suport inteligent 9in1 roz', excludes:[], name: 'Suport inteligent 9in1 Roz',           cost: 6.76,   updated: '30.03.2026' },
  { id: 'FAN1',          sku: 'FAN1',           pattern: 'ventilator turbo fan',       excludes: [], name: 'VENTILATOR TURBO FAN',                 cost: 31.17,  updated: '30.03.2026' },
  { id: 'U8',            sku: 'U8',             pattern: 'u8',                         excludes: [], name: 'WATCH ULTRA U8',                       cost: 207.89, updated: '30.03.2026' },
];

// URL-ul fișierului JSON de pe GitHub (raw) — actualizează cu repo-ul tău
const COSTS_JSON_URL = '/product-costs.json';

// Merge costuri noi peste costuri existente — update SKU-uri cunoscute, adauga SKU-uri noi
function mergeCosts(existing, incoming) {
  const result = [...existing];
  incoming.forEach(newItem => {
    const existingIdx = result.findIndex(e => e.sku === newItem.sku || e.id === newItem.id);
    if (existingIdx >= 0) {
      // Updateaza costul si data pentru toate variantele cu acelasi SKU
      result.forEach((item, i) => {
        if (item.sku === newItem.sku) {
          result[i] = { ...item, cost: newItem.cost, updated: newItem.updated };
        }
      });
    } else {
      // Produs nou — adauga
      result.push(newItem);
    }
  });
  return result;
}

// Parseaza un fisier import-cost XLSX cu structura: SKU, Produs, Cant, ..., Col L = parte intreaga cost, Col M = zecimale
function parseImportCostXLSX(file, existingCosts, onSuccess, onError) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const doImport = () => {
      try {
        const wb = window.XLSX.read(ev.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
        const today = new Date().toISOString().slice(0,7);
        const incoming = [];
        rows.slice(1).forEach(row => {
          const sku = String(row[0]||'').trim();
          const name = String(row[1]||'').trim();
          if (!sku || !name || sku === 'SKU') return;
          // Col L (index 11) = parte intreaga, Col M (index 12) = zecimale
          const intPart = parseFloat(row[11]) || 0;
          const decPart = parseFloat(row[12]) || 0;
          const cost = parseFloat(`${intPart}.${String(Math.round(decPart)).padStart(2,'0')}`);
          if (cost > 0) {
            incoming.push({
              id: sku,
              sku: sku,
              pattern: sku.toLowerCase(),
              excludes: [],
              name: name,
              cost: cost,
              updated: today,
            });
          }
        });
        if (incoming.length === 0) { onError('Nu s-au găsit produse cu cost valid.'); return; }
        const merged = mergeCosts(existingCosts, incoming);
        onSuccess(merged, incoming);
      } catch(e) { onError(e.message); }
    };
    if (window.XLSX) doImport();
    else { const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload=doImport; document.head.appendChild(s); }
  };
  reader.readAsArrayBuffer(file);
}

const DEFAULT_FIXED = [
  { id: 1, name: 'Shopify subscription', amount: '290', currency: 'RON', perOrder: false, perOrderAmt: '' },
  { id: 2, name: 'Contabilitate', amount: '600', currency: 'RON', perOrder: false, perOrderAmt: '' },
  { id: 3, name: 'Ambalaje', amount: '', currency: 'RON', perOrder: true, perOrderAmt: '1' },
];

// Calculat: 2522.34 RON / 118 colete = 21.37 RON/colet
const TRANSPORT_DEFAULT = 21.37;

// ── IDENTIC CU DASHBOARD ──────────────────────────────────────────
const pad2 = n => String(n).padStart(2, '0');
const toISO2 = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

// getRange — copiat identic din page.js
function getRange(preset, customFrom, customTo) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  switch (preset) {
    case 'today':       return { from: toISO2(now), to: toISO2(now) };
    case 'yesterday':   { const y2 = new Date(y,m,d-1); return { from: toISO2(y2), to: toISO2(y2) }; }
    case 'week':        return { from: toISO2(new Date(y,m,d-6)), to: toISO2(now) };
    case 'month':       return { from: `${y}-${pad2(m+1)}-01`, to: toISO2(now) };
    case 'last_month':  { const lm = new Date(y,m,0); return { from: `${lm.getFullYear()}-${pad2(lm.getMonth()+1)}-01`, to: toISO2(lm) }; }
    case 'last_7':      return { from: toISO2(new Date(y,m,d-6)), to: toISO2(now) };
    case 'last_30':     return { from: toISO2(new Date(y,m,d-29)), to: toISO2(now) };
    case 'last_90':     return { from: toISO2(new Date(y,m,d-89)), to: toISO2(now) };
    case 'year':        return { from: `${y}-01-01`, to: toISO2(now) };
    case 'custom':      return { from: customFrom, to: customTo };
    default:            return { from: toISO2(new Date(y,m,d-29)), to: toISO2(now) };
  }
}

// applyTrackingOverrides — copiat din page.js
function applyTrackingOverrides(orders) {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('gx_track_ov') : null;
    const ov = raw ? JSON.parse(raw) : {};
    if (!Object.keys(ov).length) return orders;
    return orders.map(o => {
      const override = ov[o.id];
      if (!override) return o;
      return { ...o, ts: override.ts,
        trackingStatus: override.statusRaw || o.trackingStatus,
        trackingLastUpdate: override.lastUpdate || o.trackingLastUpdate,
        trackingLocation: override.location || o.trackingLocation,
      };
    });
  } catch { return orders; }
}

// ── getFinalStatus — copiat identic din page.js ──────────────────
// Citeste glsAwbMap si sdAwbMap din localStorage
function getGlsAwbMap() {
  try { const s = localStorage.getItem('gls_awb_map'); return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function getSdAwbMap() {
  try { const s = localStorage.getItem('sd_awb_map'); return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function getFinalStatus(o, glsAwbMap, sdAwbMap) {
  if (o.courier === 'gls') {
    const awb = (o.trackingNo || '').trim();
    if (awb && glsAwbMap[awb]) return glsAwbMap[awb];
    return o.ts;
  }
  if (o.courier === 'sameday') {
    const awb = (o.trackingNo || '').trim();
    if (awb && sdAwbMap[awb]) return sdAwbMap[awb];
    return o.ts !== 'pending' ? o.ts : null;
  }
  return o.ts;
}

// getLivrateInPeriod — identic cu dashboard:
// createdAt in perioada + getFinalStatus === 'livrat' (include GLS AWB map)
function getLivrateInPeriod(allOrders, preset, customFrom, customTo) {
  const { from, to } = getRange(preset, customFrom, customTo);
  const fromD = new Date(from + 'T00:00:00');
  const toD   = new Date(to   + 'T23:59:59');
  const glsMap = getGlsAwbMap();
  const sdMap  = getSdAwbMap();
  return allOrders.filter(o => {
    const created = new Date(o.createdAt || o.created_at || '');
    if (created < fromD || created > toD) return false;
    return getFinalStatus(o, glsMap, sdMap) === 'livrat';
  });
}

// getReturInPeriod — createdAt in perioada + getFinalStatus === 'retur'
function getReturInPeriod(allOrders, preset, customFrom, customTo) {
  const { from, to } = getRange(preset, customFrom, customTo);
  const fromD = new Date(from + 'T00:00:00');
  const toD   = new Date(to   + 'T23:59:59');
  const glsMap = getGlsAwbMap();
  const sdMap  = getSdAwbMap();
  return allOrders.filter(o => {
    const created = new Date(o.createdAt || o.created_at || '');
    if (created < fromD || created > toD) return false;
    return getFinalStatus(o, glsMap, sdMap) === 'retur';
  });
}
const TVA_RATE = 0.21;

// Statusuri Shopify care indică retur/refuz — aceeași logică ca dashboard-ul principal
const RETURNED_SHIPMENT = new Set(['failure','failed_attempt','returned','failed_delivery','return_in_progress']);

function exportCostsToXLSX(stdCosts) {
  const doExport = () => {
    const wb = window.XLSX.utils.book_new();
    const data = [
      ['ID', 'Nume produs', 'Pattern detectie', 'Excluderi', 'Cost RON', 'Ultima actualizare'],
      ...stdCosts.map(s => [s.id, s.name, s.pattern, (s.excludes || []).join(', '), s.cost, new Date().toLocaleDateString('ro-RO')])
    ];
    const ws = window.XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{wch:15},{wch:40},{wch:20},{wch:30},{wch:12},{wch:20}];
    window.XLSX.utils.book_append_sheet(wb, ws, 'Costuri Produse');
    window.XLSX.writeFile(wb, `glamx_costuri_${new Date().toISOString().slice(0,10)}.xlsx`);
  };
  if (window.XLSX) doExport();
  else { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = doExport; document.head.appendChild(s); }
}

function importCostsFromXLSX(file, onSuccess) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const doImport = () => {
      const wb = window.XLSX.read(ev.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
      const costs = rows.slice(1).filter(r => r[0] && r[1]).map(r => ({
        id: String(r[0]||''), name: String(r[1]||''), pattern: String(r[2]||'').toLowerCase(),
        excludes: String(r[3]||'').split(',').map(x=>x.trim()).filter(Boolean), cost: parseFloat(r[4])||0,
      }));
      if (costs.length > 0) onSuccess(costs);
    };
    if (window.XLSX) doImport();
    else { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = doImport; document.head.appendChild(s); }
  };
  reader.readAsArrayBuffer(file);
}

export default function ProfitPage() {
  const [preset, setPreset] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [activeTab, setActiveTab] = useState('summary');
  const [sortProd, setSortProd]   = useState('profit');
  const [showNoCost, setShowNoCost] = useState(false);
  const [perUnit, setPerUnit]     = useState(false);
  const [showOrdersSku, setShowOrdersSku] = useState(null);

  // Shopify
  const [shopifyOrders, setShopifyOrders] = useState([]); // comenzi livrate in luna selectata
  const [allShopifyOrders, setAllShopifyOrders] = useState([]); // toate comenzile (pentru retur)
  const [shopifyLoading, setShopifyLoading] = useState(false);

  // SmartBill credențiale
  const [sbEmail, setSbEmail] = useState(() => { try { return localStorage.getItem('sb_email')||''; } catch { return ''; }});
  const [sbToken, setSbToken] = useState(() => { try { return localStorage.getItem('sb_token')||''; } catch { return ''; }});
  const [sbCif,   setSbCif]   = useState(() => { try { return localStorage.getItem('sb_cif')  ||''; } catch { return ''; }});
  const [sbWh,    setSbWh]    = useState(() => { try { return localStorage.getItem('sb_warehouse')||''; } catch { return ''; }});
  const saveSbCreds = () => {
    try {
      localStorage.setItem('sb_email', sbEmail);
      localStorage.setItem('sb_token', sbToken);
      localStorage.setItem('sb_cif',   sbCif);
      localStorage.setItem('sb_warehouse', sbWh);
      setSbCostsMsg('✅ Credențiale salvate!');
    } catch {}
  };
  const [shopifyDone, setShopifyDone] = useState(false);

  // GLS
  const [glsCost, setGlsCost] = useState(0);
  const [glsManual, setGlsManual] = useState('');
  const [glsRows, setGlsRows] = useState([]);
  const [glsDone, setGlsDone] = useState(false);
  const [transportPerParcel, setTransportPerParcel] = useState(TRANSPORT_DEFAULT);

  // SameDay — detectat automat din Shopify (courier field)
  const [sdTransportPerParcel, setSdTransportPerParcel] = useState(28);

  // Marketing
  const [useCPA, setUseCPA] = useState(true);
  const [cpaValue, setCpaValue] = useState('65');
  const [metaCost, setMetaCost] = useState('');
  const [tikTokCost, setTikTokCost] = useState('');
  const [googleCost, setGoogleCost] = useState('');
  const [otherMktCost, setOtherMktCost] = useState('');

  // TVA
  const [tvaOnMeta, setTvaOnMeta] = useState(true);
  const [tvaOnShopify, setTvaOnShopify] = useState(true);

  // Fixed costs
  const [fixedCosts, setFixedCosts] = useState(DEFAULT_FIXED);
  const [otherCosts, setOtherCosts] = useState([]);

  // Product costs
  const [stdCosts, setStdCosts] = useState(() => {
    try { const s = localStorage.getItem('glamx_std_costs'); return s ? JSON.parse(s) : DEFAULT_PRODUCT_COSTS; } catch { return DEFAULT_PRODUCT_COSTS; }
  });
  const [costsLoading, setCostsLoading] = useState(false);
  const [costsLastUpdated, setCostsLastUpdated] = useState('');
  const [productCosts, setProductCosts] = useState({});
  const [shopifyCosts, setShopifyCosts] = useState({});
  const [shopifyVariantCosts, setShopifyVariantCosts] = useState({});
  const [shopifySkuCosts, setShopifySkuCosts] = useState({});
  const [manualCosts, setManualCosts] = useState({});
  const [costSource, setCostSource] = useState({});

  const xlsxImportRef = useRef(null);
  const importCostRef = useRef(null);
  const sbExcelRef    = useRef(null); // Import Excel stoc la zi din SmartBill
  const [sbCostsLoading, setSbCostsLoading] = useState(false);
  const [sbCostsMsg, setSbCostsMsg] = useState('');

  // Parsează Excel-ul "Stoc la zi" exportat din SmartBill Gestiune
  // Coloane: Produs | U.M. | Stoc final | Cost unitar | Sold final
  const importSmartBillExcel = (file) => {
    if (!file) return;
    setSbCostsMsg('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        // Parser nativ BIFF8/MULRK pentru XLS SmartBill
        // SmartBill exportă cu MULRK records (nu RK simplu) + merged cells pe loturi
        const buf  = ev.target.result;
        const data = new Uint8Array(buf);
        const dv   = new DataView(buf);

        // Citim OLE2 + FAT + Workbook stream
        const sectorSize = 2 ** dv.getUint16(30, true);
        const fatSector  = dv.getUint32(76, true);
        const fatOff     = (fatSector + 1) * sectorSize;
        const fat        = Array.from({length: sectorSize/4}, (_,i) => dv.getUint32(fatOff + i*4, true));

        // Workbook stream (sector chain starting at 0)
        const wbChunks = [];
        let sec = 0; const visited = new Set();
        while (sec !== 0xFFFFFFFE && sec !== 0xFFFFFFFF && !visited.has(sec)) {
          visited.add(sec);
          const off = (sec + 1) * sectorSize;
          wbChunks.push(data.slice(off, off + sectorSize));
          sec = fat[sec] ?? 0xFFFFFFFE;
        }
        const wb = new Uint8Array(wbChunks.reduce((a, c) => a + c.length, 0));
        let wbPos = 0;
        wbChunks.forEach(c => { wb.set(c, wbPos); wbPos += c.length; });
        const wbDv = new DataView(wb.buffer);

        function decodeRK(rk) {
          let val;
          if (rk & 2) { val = rk >> 2; }
          else {
            const tmp = new DataView(new ArrayBuffer(8));
            tmp.setUint32(4, (rk & 0xFFFFFFFC), true);
            tmp.setUint32(0, 0, true);
            val = tmp.getFloat64(0, true);
          }
          return (rk & 1) ? val / 100 : val;
        }

        // Parse SST
        const sst = [];
        let pos = 0;
        while (pos < wb.length - 4) {
          const rt = wbDv.getUint16(pos, true);
          const rl = wbDv.getUint16(pos + 2, true);
          if (rt === 0x00FC) { // SST
            const unique = wbDv.getUint32(pos + 8, true);
            let sp = pos + 12;
            for (let i = 0; i < unique && sp < pos + 4 + rl; i++) {
              const sl = wbDv.getUint16(sp, true);
              const fl = wb[sp + 2]; sp += 3;
              if (fl & 4) { const rt2 = wbDv.getUint16(sp, true); sp += 2 + rt2*4; }
              let s = '';
              if (fl & 1) {
                for (let j = 0; j < sl; j++) s += String.fromCharCode(wbDv.getUint16(sp + j*2, true));
                sp += sl * 2;
              } else {
                for (let j = 0; j < sl; j++) s += String.fromCharCode(wb[sp + j]);
                sp += sl;
              }
              sst.push(s);
            }
            break;
          }
          pos += 4 + rl;
        }

        // Parse LABELSST + MULRK + RK + NUMBER
        const strings = {}, numbers = {};
        pos = 0;
        while (pos < wb.length - 4) {
          const rt = wbDv.getUint16(pos, true);
          const rl = wbDv.getUint16(pos + 2, true);
          if (rt === 0x00FD && rl >= 8) { // LABELSST
            const r = wbDv.getUint16(pos+4, true), c = wbDv.getUint16(pos+6, true);
            const idx = wbDv.getUint32(pos+12, true);
            if (idx < sst.length) strings[`${r},${c}`] = sst[idx];
          } else if (rt === 0x00BD) { // MULRK
            const r = wbDv.getUint16(pos+4, true), fc = wbDv.getUint16(pos+6, true);
            let off = pos + 8, col = fc;
            while (off + 6 <= pos + 4 + rl - 2) {
              const rk = wbDv.getUint32(off+2, true);
              numbers[`${r},${col}`] = Math.round(decodeRK(rk) * 10000) / 10000;
              off += 6; col++;
            }
          } else if (rt === 0x027E && rl >= 8) { // RK
            const r = wbDv.getUint16(pos+4, true), c = wbDv.getUint16(pos+6, true);
            numbers[`${r},${c}`] = decodeRK(wbDv.getUint32(pos+12, true));
          } else if (rt === 0x0203 && rl >= 12) { // NUMBER
            const r = wbDv.getUint16(pos+4, true), c = wbDv.getUint16(pos+6, true);
            numbers[`${r},${c}`] = Math.round(wbDv.getFloat64(pos+10, true) * 10000) / 10000;
          }
          pos += 4 + rl;
        }

        // Colectăm date per SKU: CMP = total_sold / total_stoc
        const skuMap = {};
        for (const key of Object.keys(numbers)) {
          const [r, c] = key.split(',').map(Number);
          if (c !== 5) continue; // col 5 = Cost unitar
          const stoc = numbers[`${r},4`] || 0;
          const cost = numbers[`${r},5`] || 0;
          const sold = numbers[`${r},6`] || 0;
          const sku  = (strings[`${r},2`] || '').trim();
          const name = (strings[`${r},1`] || '').trim();
          if (!sku || stoc <= 0 || cost <= 0) continue;
          if (!skuMap[sku]) skuMap[sku] = { name, totalStoc: 0, totalSold: 0 };
          skuMap[sku].totalStoc += stoc;
          skuMap[sku].totalSold += sold;
        }

        const updated  = new Date().toISOString().slice(0, 7);
        const incoming = Object.entries(skuMap)
          .filter(([, d]) => d.totalStoc > 0)
          .map(([sku, d]) => ({
            id: sku, sku,
            name: d.name,
            pattern: d.name.toLowerCase(),
            excludes: [],
            cost: Math.round(d.totalSold / d.totalStoc * 100) / 100,
            updated,
          }));

        if (!incoming.length) {
          setSbCostsMsg('❌ Nu s-au găsit produse. Asigură-te că ai bifat "Cost unitar" la Filtrare în SmartBill înainte de export.');
          return;
        }

        const merged = mergeCosts(stdCosts, incoming);
        setStdCosts(merged);
        localStorage.setItem('glamx_std_costs', JSON.stringify(merged));
        setSbCostsMsg(`✅ ${incoming.length} produse importate cu CMP din SmartBill!`);
      } catch (e) { setSbCostsMsg(`❌ ${e.message}`); }
    };
    reader.readAsArrayBuffer(file);
  };

  // Fetch costuri produse din SmartBill nomenclator
  const fetchSmartBillCosts = async () => {
    const email = localStorage.getItem('sb_email');
    const token = localStorage.getItem('sb_token');
    const cif   = localStorage.getItem('sb_cif');
    const wh    = localStorage.getItem('sb_warehouse') || '';
    if (!email || !token || !cif) {
      setSbCostsMsg('❌ Completează credențialele SmartBill în tab-ul Costuri → Shopify');
      return;
    }
    setSbCostsLoading(true);
    setSbCostsMsg('');
    try {
      const url = `/api/smartbill/products?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&cif=${encodeURIComponent(cif)}${wh?`&warehouse=${encodeURIComponent(wh)}`:''}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSbCostsMsg(`❌ ${data.error || data.details || 'Eroare SmartBill'}`);
        return;
      }
      if (!data.stdCosts?.length) {
        setSbCostsMsg('⚠️ Nu s-au găsit produse cu preț de achiziție în SmartBill. Verifică că ai modulul Gestiune activ și prețuri de achiziție setate.');
        return;
      }
      // Merge cu costurile existente — SmartBill are prioritate
      const merged = mergeCosts(stdCosts, data.stdCosts);
      setStdCosts(merged);
      localStorage.setItem('glamx_std_costs', JSON.stringify(merged));
      setSbCostsMsg(`✅ ${data.stdCosts.length} produse importate din SmartBill!`);
    } catch (e) {
      setSbCostsMsg(`❌ ${e.message}`);
    } finally {
      setSbCostsLoading(false);
    }
  };

  // ── LOAD SAVED SETTINGS ──
  useEffect(() => {
    const g = (key) => localStorage.getItem(key);
    const sf = g('glamx_fixed_costs'); if (sf) setFixedCosts(JSON.parse(sf));
    const ss = g('glamx_std_costs'); if (ss) { try { setStdCosts(JSON.parse(ss)); } catch {} }
    const so = g('glamx_other_costs'); if (so) setOtherCosts(JSON.parse(so));
    if (g('glamx_meta_cost')) setMetaCost(g('glamx_meta_cost'));
    if (g('glamx_tiktok_cost')) setTikTokCost(g('glamx_tiktok_cost'));
    if (g('glamx_google_cost')) setGoogleCost(g('glamx_google_cost'));
    if (g('glamx_other_mkt')) setOtherMktCost(g('glamx_other_mkt'));
    if (g('glamx_cpa_value')) setCpaValue(g('glamx_cpa_value'));
    const sucpa = g('glamx_use_cpa'); if (sucpa !== null) setUseCPA(sucpa === 'true');
    const stp = g('glamx_transport_per_parcel'); if (stp) setTransportPerParcel(parseFloat(stp)||TRANSPORT_DEFAULT);
    const ssc = g('glamx_shopify_costs'); if (ssc) setShopifyCosts(JSON.parse(ssc));
    const svc = g('glamx_shopify_variant_costs'); if (svc) setShopifyVariantCosts(JSON.parse(svc));
    const ssku = g('glamx_shopify_sku_costs'); if (ssku) setShopifySkuCosts(JSON.parse(ssku));

    // Load orders (saved from previous session) — profit estimat imediat
    // Citeste din gx_orders_all (cheia salvata de dashboard) — contine ultimele 60 zile
    const sord = g('gx_orders_all') || g('gx_orders_60') || g('gx_orders');
    if (sord) {
      try {
        const p = JSON.parse(sord);
        const withOv = applyTrackingOverrides(p);
        const livrate = getLivrateInPeriod(withOv, preset, customFrom, customTo);
        setAllShopifyOrders(withOv);
        if (livrate.length > 0) { setShopifyOrders(livrate); setShopifyDone(true); }
      } catch {}
    }

    // Incarca costuri din product-costs.json (public folder) — are prioritate peste localStorage
    // daca fisierul exista si e mai nou decat ce e salvat
    fetch(COSTS_JSON_URL)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || !Array.isArray(data)) return;
        // Merge cu ce e in localStorage — costurile din JSON sunt mai fresh
        const localRaw = localStorage.getItem('glamx_std_costs');
        const local = localRaw ? JSON.parse(localRaw) : DEFAULT_PRODUCT_COSTS;
        const merged = mergeCosts(local, data);
        setStdCosts(merged);
        localStorage.setItem('glamx_std_costs', JSON.stringify(merged));
        const lastUpd = data.find(d => d.updated && d.updated !== '—')?.updated || '';
        if (lastUpd) setCostsLastUpdated(lastUpd);
      })
      .catch(() => { /* fisierul nu exista inca — folosim localStorage */ });
  }, []);

  // ── FETCH SHOPIFY ──
  // Re-filtreaza comenzile cand se schimba luna
  useEffect(() => {
    if (!preset) return;
    const g = (key) => localStorage.getItem(key);
    const sord = g('gx_orders_all') || g('gx_orders_60') || g('gx_orders');
    if (!sord) return;
    try {
      const p = JSON.parse(sord);
      const withOv = applyTrackingOverrides(p);
      const livrate = getLivrateInPeriod(withOv, preset, customFrom, customTo);
      if (livrate.length > 0) { setShopifyOrders(livrate); setShopifyDone(true); }
      else { setShopifyOrders([]); setShopifyDone(false); }
    } catch {}
  }, [preset, customFrom, customTo]);

  const fetchShopify = async () => {
    const domain = localStorage.getItem('gx_d');
    const token = localStorage.getItem('gx_t');
    if (!domain || !token) { alert('Conectează-te mai întâi la Shopify din pagina principală!'); return; }
    setShopifyLoading(true);
    try {
      const { from: fetchFrom, to: fetchTo } = getRange(preset, customFrom, customTo);
      const fields = 'id,name,financial_status,fulfillment_status,fulfillments,cancelled_at,created_at,total_price,line_items,note_attributes,tags';
      const res = await fetch(`/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&created_at_min=${fetchFrom}T00:00:00&created_at_max=${fetchTo}T23:59:59&fields=${fields}&force=1`);
      const data = await res.json();
      const orders = (data.orders || []).filter(o => !o.cancelled_at && o.financial_status !== 'voided');
      const processed = orders.map(o => {
        const fulfillmentData = (o.fulfillments || []).find(f => f.tracking_company || f.tracking_number);
        const trackingCompany = (fulfillmentData?.tracking_company || '').toLowerCase();
        const courier = trackingCompany.includes('sameday') || trackingCompany.includes('same day') ? 'sameday'
                      : trackingCompany.includes('gls') || trackingCompany.includes('mygls') ? 'gls'
                      : trackingCompany ? 'other' : 'unknown';
        return {
          id: o.id, name: o.name,
          total: parseFloat(o.total_price) || 0,
          financial: o.financial_status,
          fulfillment: o.fulfillment_status,
          fulfillments: o.fulfillments || [],
          courier,
          items: (o.line_items || []).map(i => ({ name: i.name, sku: i.sku||'', variantId: String(i.variant_id||''), qty: i.quantity||1, price: parseFloat(i.price)||0 })),
          createdAt: o.created_at,
          tags: o.tags||'',
        };
      });
      const withOv = applyTrackingOverrides(processed);
      const livrate = getLivrateInPeriod(withOv, preset, customFrom, customTo);
      setAllShopifyOrders(withOv);
      setShopifyOrders(livrate.length > 0 ? livrate : processed);
      setShopifyDone(true);
      localStorage.setItem('gx_orders_profit', JSON.stringify(processed));

      try {
        const costRes = await fetch(`/api/product-costs?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}`);
        const costData = await costRes.json();
        if (costData.costs || costData.variantCosts) {
          setShopifyCosts(costData.costs||{}); setShopifyVariantCosts(costData.variantCosts||{}); setShopifySkuCosts(costData.skuCosts||{});
          localStorage.setItem('glamx_shopify_costs', JSON.stringify(costData.costs||{}));
          localStorage.setItem('glamx_shopify_variant_costs', JSON.stringify(costData.variantCosts||{}));
          localStorage.setItem('glamx_shopify_sku_costs', JSON.stringify(costData.skuCosts||{}));
        }
      } catch {}
    } catch (e) { alert('Eroare Shopify: ' + e.message); }
    finally { setShopifyLoading(false); }
  };

  // ── GLS PARSE ──
  const parseGLSExcel = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const isXLSX = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    const processData = (hdrs, dataRows) => {
      const findCol = (...names) => hdrs.find(h => names.some(n => h === n)) || hdrs.find(h => names.some(n => h.includes(n)));
      const totalKey = findCol('total amount','total','amount','suma','valoare');
      const parcelKey = findCol('parcel number','parcel','colet','awb','tracking');
      let total = 0; const parsed = [];
      dataRows.forEach(r => {
        const rawVal = r[totalKey];
        const cost = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal||'0').replace(',','.').replace(/[^0-9.-]/g,''))||0;
        const parcel = String(r[parcelKey]||'').trim();
        if (cost > 0) { total += cost; parsed.push({ parcel, cost }); }
      });
      setGlsRows(parsed); setGlsCost(total); setGlsDone(true);
    };
    if (isXLSX) {
      reader.onload = (ev) => {
        const load = () => {
          const wb = window.XLSX.read(ev.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
          const hdrs = (json[0]||[]).map(h => String(h||'').toLowerCase().trim());
          const dataRows = json.slice(1).map(row => { const o={}; hdrs.forEach((h,i)=>o[h]=row[i]!==undefined?row[i]:''); return o; }).filter(r=>Object.values(r).some(v=>v!==''&&v!==null));
          processData(hdrs, dataRows);
        };
        if (window.XLSX) load(); else { const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload=load; document.head.appendChild(s); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (ev) => {
        const lines = ev.target.result.split(/\r?\n/).filter(l=>l.trim());
        const hdrs = splitCSV(lines[0]).map(h=>h.replace(/"/g,'').trim().toLowerCase());
        const dataRows = lines.slice(1).map(l=>{ const vals=splitCSV(l); const o={}; hdrs.forEach((h,i)=>o[h]=(vals[i]||'').replace(/"/g,'').trim()); return o; }).filter(r=>Object.values(r).some(v=>v));
        processData(hdrs, dataRows);
      };
      reader.readAsText(file, 'UTF-8');
    }
  };

  // ── SAMEDAY PARSE (acelasi format ca GLS) ──
  const parseSameDayExcel = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const isXLSX = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    const processData = (hdrs, dataRows) => {
      const findCol = (...names) => hdrs.find(h => names.some(n => h === n)) || hdrs.find(h => names.some(n => h.includes(n)));
      const totalKey = findCol('total amount','total','amount','suma','valoare','cost');
      const parcelKey = findCol('parcel number','parcel','colet','awb','tracking','expeditie');
      let total = 0; const parsed = [];
      dataRows.forEach(r => {
        const rawVal = r[totalKey];
        const cost = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal||'0').replace(',','.').replace(/[^0-9.-]/g,''))||0;
        const parcel = String(r[parcelKey]||'').trim();
        if (cost > 0) { total += cost; parsed.push({ parcel, cost }); }
      });
      setSdRows(parsed); setSdCost(total); setSdDone(true);
    };
    if (isXLSX) {
      reader.onload = (ev) => {
        const load = () => {
          const wb = window.XLSX.read(ev.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
          const hdrs = (json[0]||[]).map(h => String(h||'').toLowerCase().trim());
          const dataRows = json.slice(1).map(row => { const o={}; hdrs.forEach((h,i)=>o[h]=row[i]!==undefined?row[i]:''); return o; }).filter(r=>Object.values(r).some(v=>v!==''&&v!==null));
          processData(hdrs, dataRows);
        };
        if (window.XLSX) load(); else { const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload=load; document.head.appendChild(s); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (ev) => {
        const lines = ev.target.result.split(/\r?\n/).filter(l=>l.trim());
        const hdrs = splitCSV(lines[0]).map(h=>h.replace(/"/g,'').trim().toLowerCase());
        const dataRows = lines.slice(1).map(l=>{ const vals=splitCSV(l); const o={}; hdrs.forEach((h,i)=>o[h]=(vals[i]||'').replace(/"/g,'').trim()); return o; }).filter(r=>Object.values(r).some(v=>v));
        processData(hdrs, dataRows);
      };
      reader.readAsText(file, 'UTF-8');
    }
  };

  // ── CALCULATIONS ──

  // Comenzi livrate si platite
  // shopifyOrders contine deja doar comenzile livrate in luna selectata
  // (filtrate prin getLivrateInPeriod — identic cu dashboard-ul)
  const deliveredOrders = shopifyOrders;

  // Colete refuzate/returnate — aceeasi logica ca dashboard-ul principal
  // Retururi in luna selectata — din allShopifyOrders (nu doar cele livrate)
  const returnedOrders = getReturInPeriod(allShopifyOrders, preset, customFrom, customTo);

  const totalRevenue = deliveredOrders.reduce((s, o) => s + (o.total || 0), 0);
  const totalOrders = deliveredOrders.length;
  const totalItems = deliveredOrders.reduce((s, o) => s + (o.items||[]).reduce((ss, i) => ss + (i.qty||1), 0), 0);
  const returnedCount = returnedOrders.length;

  const resolveCost = (item) => {
    const nameKey = (item.name||'').toLowerCase().trim();
    const skuKey = (item.sku||'').toLowerCase().trim();
    const variantId = String(item.variantId||'');
    const override = costSource[item.name];
    if (override === 'manual' || (!override && manualCosts[item.name] !== undefined && manualCosts[item.name] !== '')) return { cost: parseFloat(manualCosts[item.name])||0, src: 'manual' };
    if (override === 'smartbill' || (!override && productCosts[nameKey])) return { cost: productCosts[nameKey]||0, src: 'smartbill' };
    const shopifyCost = (variantId?shopifyVariantCosts[variantId]:null) || (skuKey?shopifySkuCosts[skuKey]:null) || shopifyCosts[nameKey];
    if (override === 'shopify' || (!override && shopifyCost)) return { cost: shopifyCost||0, src: 'shopify' };
    for (const std of stdCosts) {
      const pat = std.pattern.toLowerCase(); if (!pat) continue;
      if (nameKey.includes(pat)) {
        const excluded = (std.excludes||[]).some(ex => nameKey.includes(ex.toLowerCase()));
        if (!excluded) return { cost: typeof std.cost==='number'?std.cost:parseFloat(std.cost)||0, src: 'standard' };
      }
    }
    return { cost: 0, src: 'none' };
  };

  const getCOGS = useCallback(() => {
    if (!shopifyOrders.length) return 0;
    return deliveredOrders.reduce((total, order) => total + (order.items||[]).reduce((s, item) => s + (resolveCost(item).cost * (item.qty||1)), 0), 0);
  }, [deliveredOrders, productCosts, shopifyCosts, shopifyVariantCosts, shopifySkuCosts, manualCosts, costSource, stdCosts]);

  const cogs = getCOGS();

  // Transport
  // Detect courier per order from Shopify data
  const glsMapC = getGlsAwbMap();
  const sdMapC  = getSdAwbMap();
  const sdOrders   = deliveredOrders.filter(o => o.courier === 'sameday');
  const glsOrders  = deliveredOrders.filter(o => o.courier === 'gls' || !o.courier || o.courier === 'unknown' || o.courier === '');
  const glsCount   = glsOrders.length;
  const sdCount    = sdOrders.length;
  const totalParcelCount = totalOrders;

  const costPerParcel    = glsDone && glsRows.length > 0 ? glsCost / glsRows.length : transportPerParcel;
  const sdCostPerParcel  = sdTransportPerParcel;

  // Transport: GLS real (din excel) + SameDay calculat automat
  const glsEffective = glsDone ? glsCost : glsCount * transportPerParcel;
  const sdEffective  = sdCount * sdTransportPerParcel;
  const effectiveTransportCost = glsEffective + sdEffective;

  // Colete refuzate — cost transport dus+retur + CPA pierdut
  const refusedTransportCost = returnedCount * costPerParcel; // doar retur (transportul dus e deja in costul GLS)

  // Marketing — definit inainte de effectiveCPA ca sa poata fi folosit
  const metaNum = parseFloat(metaCost)||0;
  const tikTokNum = parseFloat(tikTokCost)||0;
  const googleNum = parseFloat(googleCost)||0;
  const otherMktNum = parseFloat(otherMktCost)||0;
  const cpaTotal = useCPA ? (parseFloat(cpaValue)||0) * totalOrders : 0;
  const manualMarketingTotal = metaNum + tikTokNum + googleNum + otherMktNum;
  const totalMarketing = useCPA ? cpaTotal : manualMarketingTotal;
  const roasMarketing = totalMarketing > 0 ? totalRevenue / totalMarketing : 0;

  // CPA efectiv real: daca avem sume reale folosim alea, altfel cpaValue fix
  const effectiveCPA = (!useCPA && totalOrders > 0 && totalMarketing > 0)
    ? totalMarketing / totalOrders
    : (parseFloat(cpaValue) || 0);
  const refusedCpaCost = returnedCount * effectiveCPA;
  const totalRefusedCost = refusedTransportCost + refusedCpaCost;

  // TVA intracomunitara pe Meta + Shopify (nu TikTok)
  const shopifyFixAmount = parseFloat(fixedCosts.find(c => c.name.toLowerCase().includes('shopify'))?.amount||'0')||0;
  const tvaBase = (tvaOnMeta && !useCPA ? metaNum : 0) + (tvaOnShopify ? shopifyFixAmount : 0);
  const totalTVA = tvaBase * TVA_RATE;

  // Fixed & other
  const totalFixed = fixedCosts.reduce((s, c) => s + (c.perOrder ? (parseFloat(c.perOrderAmt)||0)*totalOrders : (parseFloat(c.amount)||0)), 0);
  const totalOther = otherCosts.reduce((s, c) => s + (parseFloat(c.amount)||0), 0);

  // Totals
  const totalCosts = cogs + effectiveTransportCost + totalMarketing + totalFixed + totalOther + totalRefusedCost;
  const grossProfit = totalRevenue - cogs;
  const netProfitBeforeTVA = totalRevenue - totalCosts;
  const netProfitAfterTVA = netProfitBeforeTVA - totalTVA;
  const marginBefore = totalRevenue > 0 ? (netProfitBeforeTVA / totalRevenue) * 100 : 0;
  const marginAfter = totalRevenue > 0 ? (netProfitAfterTVA / totalRevenue) * 100 : 0;

  // Is this estimated (no GLS, CPA mode)?
  const isEstimated = !glsDone || useCPA;

  // Helpers
  const addFixed = () => setFixedCosts(p => [...p, { id: Date.now(), name: '', amount: '', currency: 'RON', perOrder: false, perOrderAmt: '' }]);
  const updateFixed = (id, field, val) => setFixedCosts(p => p.map(c => c.id === id ? { ...c, [field]: val } : c));
  const removeFixed = (id) => setFixedCosts(p => p.filter(c => c.id !== id));
  const addOther = () => setOtherCosts(p => [...p, { id: Date.now(), name: '', amount: '' }]);
  const updateOther = (id, field, val) => setOtherCosts(p => p.map(c => c.id === id ? { ...c, [field]: val } : c));
  const removeOther = (id) => setOtherCosts(p => p.filter(c => c.id !== id));

  const saveSettings = () => {
    localStorage.setItem('glamx_fixed_costs', JSON.stringify(fixedCosts));
    localStorage.setItem('glamx_other_costs', JSON.stringify(otherCosts));
    localStorage.setItem('glamx_meta_cost', metaCost);
    localStorage.setItem('glamx_tiktok_cost', tikTokCost);
    localStorage.setItem('glamx_google_cost', googleCost);
    localStorage.setItem('glamx_other_mkt', otherMktCost);
    localStorage.setItem('glamx_std_costs', JSON.stringify(stdCosts));
    localStorage.setItem('glamx_cpa_value', cpaValue);
    localStorage.setItem('glamx_use_cpa', String(useCPA));
    localStorage.setItem('glamx_transport_per_parcel', String(transportPerParcel));
    localStorage.setItem('glamx_sd_transport_per_parcel', String(sdTransportPerParcel));
    localStorage.setItem('glamx_sd_transport_per_parcel', String(sdTransportPerParcel));
    alert('✅ Salvat!');
  };

  const uniqueProducts = [...new Set(deliveredOrders.flatMap(o => (o.items||[]).map(i => i.name).filter(Boolean)))];

  const CSS = `
    .profit-wrap{max-width:900px;margin:0 auto;padding:12px 12px 100px}
    .pf-header{display:flex;align-items:center;gap:10px;background:rgba(7,9,14,.9);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px 14px;margin-bottom:12px;flex-wrap:wrap}
    .pf-logo{width:36px;height:36px;border-radius:10px;overflow:hidden;flex-shrink:0}
    .pf-logo img{width:100%;height:100%;object-fit:cover}
    .pf-title-wrap{flex:1;min-width:0}
    .pf-title{font-size:15px;font-weight:800;letter-spacing:-.4px}
    .pf-sub{font-size:10px;color:var(--c-text3)}
    .pf-month input[type=month]{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--c-text);border-radius:8px;padding:5px 8px;font-size:12px;font-weight:600;outline:none;-webkit-appearance:none}
    .pf-back{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:var(--c-text3);padding:5px 10px;border-radius:8px;font-size:11px;font-weight:600;text-decoration:none;flex-shrink:0}
    .pf-est-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.25);color:var(--c-yellow);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700}
    .pf-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px}
    .pf-tab{display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 4px;border-radius:10px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03);color:var(--c-text4);font-size:10px;font-weight:700;cursor:pointer;transition:all .15s;text-transform:uppercase;letter-spacing:.4px}
    .pf-tab-icon{font-size:18px;line-height:1}
    .pf-tab.active{background:rgba(249,115,22,.12);border-color:rgba(249,115,22,.3);color:var(--c-orange)}
    .pf-tab:active{transform:scale(.95)}
    .pf-net-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
    .pf-net-card{border-radius:14px;padding:14px 16px;border:1px solid}
    .pf-net-card.green{background:rgba(16,185,129,.06);border-color:rgba(16,185,129,.2)}
    .pf-net-card.yellow{background:rgba(245,158,11,.06);border-color:rgba(245,158,11,.25)}
    .pf-net-card.red{background:rgba(244,63,94,.06);border-color:rgba(244,63,94,.2)}
    .pf-net-label{font-size:10px;font-weight:700;color:var(--c-text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
    .pf-net-val{font-size:22px;font-weight:900;letter-spacing:-.6px;font-family:'Syne',system-ui,sans-serif;line-height:1.1}
    .pf-net-val.green{color:var(--c-green)}
    .pf-net-val.yellow{color:var(--c-yellow)}
    .pf-net-val.red{color:var(--c-red)}
    .pf-net-sub{font-size:10px;color:var(--c-text4);margin-top:3px}
    .pf-stat-row{display:flex;gap:6px;margin-bottom:14px}
    .pf-stat{flex:1;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px 12px;min-width:0}
    .pf-stat-label{font-size:9px;color:var(--c-text4);text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:3px}
    .pf-stat-val{font-size:18px;font-weight:800;font-family:'Syne',system-ui,sans-serif;line-height:1}
    .pf-kpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
    .pf-kpi{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:11px 13px;border-left:3px solid var(--accent,#f97316)}
    .pf-kpi-emoji{font-size:16px;margin-bottom:3px}
    .pf-kpi-val{font-size:18px;font-weight:800;letter-spacing:-.4px;font-family:'Syne',system-ui,sans-serif;color:var(--accent,#f97316);line-height:1.1}
    .pf-kpi-label{font-size:9px;color:var(--c-text3);margin-top:2px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
    .pf-kpi-sub{font-size:9px;color:var(--c-text4);margin-top:2px}
    .pf-pl{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden;margin-bottom:14px}
    .pf-pl-row{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid rgba(255,255,255,.04)}
    .pf-pl-row:last-child{border-bottom:none}
    .pf-pl-row.subtotal{background:rgba(255,255,255,.03)}
    .pf-pl-row.profit-pos{background:rgba(16,185,129,.05)}
    .pf-pl-row.profit-neg{background:rgba(244,63,94,.05)}
    .pf-pl-row.tva-row{background:rgba(245,158,11,.04)}
    .pf-pl-row.returned-row{background:rgba(244,63,94,.03)}
    .pf-pl-label{font-size:11px;color:var(--c-text3);display:flex;align-items:center;gap:5px}
    .pf-pl-val{font-size:11px;font-weight:700;font-family:monospace}
    .pf-pl-val.pos{color:var(--c-green)}
    .pf-pl-val.neg-c{color:var(--c-red)}
    .pf-pl-val.orange{color:var(--c-orange)}
    .pf-pl-val.yellow{color:var(--c-yellow)}
    .pf-stitle{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--c-text3);margin:16px 0 8px;display:flex;align-items:center;gap:8px}
    .pf-stitle::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.05)}
    .pf-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:14px;margin-bottom:10px}
    .pf-card.done{border-color:rgba(16,185,129,.25)}
    .pf-card-header{display:flex;align-items:center;gap:8px;margin-bottom:10px}
    .pf-card-icon{font-size:18px;flex-shrink:0}
    .pf-card-title{font-size:13px;font-weight:700;flex:1}
    .pf-card-status{font-size:10px;color:var(--c-text4)}
    .pf-card-status.ok{color:var(--c-green)}
    .pf-card-status.warn{color:var(--c-red)}
    .pf-src-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:12px}
    .pf-src-row:last-child{border-bottom:none}
    .pf-src-key{color:var(--c-text3)}
    .pf-src-val{font-family:monospace;font-weight:600}
    .pf-btn{display:flex;align-items:center;justify-content:center;gap:6px;border-radius:10px;font-size:12px;font-weight:700;padding:10px 14px;cursor:pointer;border:none;transition:all .15s;width:100%}
    .pf-btn:active{transform:scale(.97)}
    .pf-btn-orange{background:var(--c-orange);color:white}
    .pf-btn-orange:disabled{opacity:.4}
    .pf-btn-ghost{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--c-text3)}
    .pf-btn-green{background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.3);color:var(--c-green)}
    .pf-btn-red{background:rgba(244,63,94,.1);border:1px solid rgba(244,63,94,.2);color:var(--c-red);padding:6px 8px;width:auto;border-radius:8px}
    .pf-input{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:var(--c-text);border-radius:8px;padding:9px 12px;font-size:13px;outline:none;width:100%;transition:border-color .15s}
    .pf-input:focus{border-color:rgba(249,115,22,.4)}
    .pf-label{font-size:10px;color:var(--c-text4);text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px;font-weight:700;display:block}
    .pf-toggle-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0}
    .pf-toggle-label{font-size:12px;color:var(--c-text2);font-weight:600}
    .pf-toggle-sub{font-size:10px;color:var(--c-text4);margin-top:1px}
    .pf-switch{position:relative;width:40px;height:22px;flex-shrink:0}
    .pf-switch input{opacity:0;width:0;height:0}
    .pf-slider{position:absolute;inset:0;background:rgba(255,255,255,.12);border-radius:11px;cursor:pointer;transition:.2s}
    .pf-slider::before{content:'';position:absolute;width:16px;height:16px;border-radius:50%;background:white;left:3px;top:3px;transition:.2s}
    input:checked+.pf-slider{background:var(--c-orange)}
    input:checked+.pf-slider::before{transform:translateX(18px)}
    .mkt-mode{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px}
    .mkt-mode-btn{padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);font-size:11px;font-weight:700;color:var(--c-text4);cursor:pointer;text-align:center;transition:all .15s}
    .mkt-mode-btn.active{background:rgba(168,85,247,.12);border-color:rgba(168,85,247,.3);color:#a855f7}
    .pf-cost-row{display:flex;gap:6px;align-items:center;margin-bottom:8px}
    .pf-bar-wrap{height:4px;background:rgba(255,255,255,.06);border-radius:2px;margin-top:5px;overflow:hidden}
    .pf-bar-fill{height:100%;border-radius:2px;transition:width .8s}
    .pf-prod-table{width:100%;border-collapse:collapse;font-size:11px}
    .pf-prod-table th{padding:7px 8px;text-align:left;font-size:9px;color:var(--c-text4);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid rgba(255,255,255,.05);background:rgba(255,255,255,.02)}
    .pf-prod-table td{padding:8px 8px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle}
    .pf-prod-table tr:last-child td{border-bottom:none}
    .xlsx-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
    .returned-box{background:rgba(244,63,94,.05);border:1px solid rgba(244,63,94,.15);border-radius:10px;padding:12px;margin-top:10px}
    .tva-box{background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.15);border-radius:10px;padding:12px}
    .pf-navlinks{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px}
    .pf-navlink{display:flex;align-items:center;justify-content:center;gap:4px;padding:8px 4px;border-radius:10px;font-size:10px;font-weight:800;text-decoration:none;text-align:center;border:1px solid;letter-spacing:.2px}
    .pf-navlink:active{opacity:.7;transform:scale(.95)}
    .pf-save-bar{position:fixed;bottom:calc(62px + env(safe-area-inset-bottom,0px) + 12px);right:14px;z-index:150}
    .pf-save-btn{background:linear-gradient(135deg,var(--c-orange),#ea580c);color:white;border:none;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 4px 20px rgba(249,115,22,.35);display:flex;align-items:center;gap:6px}
    .pf-save-btn:active{transform:scale(.96)}
    .pf-spin{display:inline-block;animation:pfspin .7s linear infinite}
    @keyframes pfspin{to{transform:rotate(360deg)}}
    @media(min-width:640px){.pf-kpi-grid{grid-template-columns:repeat(3,1fr)}.pf-net-grid{grid-template-columns:1fr 1fr 1fr}}
    @media(min-width:900px){.profit-wrap{padding:20px 20px 80px}}
  `;

  return (
    <>
      <style>{CSS}</style>
      <div className="profit-wrap">

        {/* HEADER */}
        <div className="pf-header">
          <div className="pf-logo"><img src="/icon-192.png" alt="GLAMX"/></div>
          <div className="pf-title-wrap">
            <div className="pf-title">💹 Calculator Profit</div>
            <div style={{display:'flex',alignItems:'center',gap:6,marginTop:2}}>
              <span className="pf-sub">{(()=>{const r=getRange(preset,customFrom,customTo);return r.from.slice(0,7)===r.to.slice(0,7)?new Date(r.from+'T12:00:00').toLocaleString('ro-RO',{month:'long',year:'numeric'}):r.from+' — '+r.to;})()}</span>
              {shopifyDone && isEstimated && <span className="pf-est-badge">⚡ Estimat</span>}
              {shopifyDone && !isEstimated && <span style={{fontSize:10,color:'var(--c-green)',fontWeight:700}}>✓ Real</span>}
            </div>
          </div>

          <a href="/" className="pf-back">← Back</a>
        </div>

        {/* PRESET BUTTONS */}
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
          {[
            {id:'month',     l:'Luna aceasta'},
            {id:'last_month',l:'Luna trecută'},
            {id:'last_30',   l:'30 zile'},
            {id:'last_7',    l:'7 zile'},
            {id:'last_90',   l:'90 zile'},
          ].map(p=>(
            <button key={p.id} onClick={()=>setPreset(p.id)}
              style={{padding:'7px 12px',borderRadius:20,border:'1px solid',fontSize:11,fontWeight:700,cursor:'pointer',transition:'all .15s',
                background:preset===p.id?'rgba(249,115,22,.2)':'rgba(255,255,255,.04)',
                borderColor:preset===p.id?'var(--c-orange)':'rgba(255,255,255,.1)',
                color:preset===p.id?'var(--c-orange)':'var(--c-text4)'}}>
              {p.l}
            </button>
          ))}
        </div>

        {/* NAV */}
        <div className="pf-navlinks">
          <a href="/profit" className="pf-navlink" style={{background:'rgba(16,185,129,.1)',color:'#10b981',borderColor:'rgba(16,185,129,.2)'}}>💹 Profit</a>
          <a href="/stats" className="pf-navlink" style={{background:'rgba(59,130,246,.1)',color:'#3b82f6',borderColor:'rgba(59,130,246,.2)'}}>📊 Stats</a>
          <a href="/import" className="pf-navlink" style={{background:'rgba(168,85,247,.1)',color:'#a855f7',borderColor:'rgba(168,85,247,.2)'}}>📦 Import</a>
          <a href="/whatsapp" className="pf-navlink" style={{background:'rgba(37,211,102,.1)',color:'#25d366',borderColor:'rgba(37,211,102,.2)'}}>📱 WA</a>
        </div>

        {/* TABS */}
        <div className="pf-tabs">
          {[{id:'summary',icon:'📊',label:'Sumar'},{id:'costs',icon:'💸',label:'Costuri'},{id:'products',icon:'📦',label:'Produse'},{id:'analysis',icon:'🔬',label:'Analiză'},{id:'settings',icon:'⚙️',label:'Setări'}].map(tab => (
            <button key={tab.id} className={`pf-tab${activeTab===tab.id?' active':''}`} onClick={() => setActiveTab(tab.id)}>
              <span className="pf-tab-icon">{tab.icon}</span>{tab.label}
            </button>
          ))}
        </div>

        {/* ══ SUMAR ══ */}
        {activeTab === 'summary' && (
          <>
            {/* Shopify connect if not done */}
            {!shopifyDone && (
              <div className="pf-card" style={{marginBottom:14}}>
                <div className="pf-card-header"><span className="pf-card-icon">🛍️</span><span className="pf-card-title">Conectează Shopify pentru profit live</span></div>
                <p style={{fontSize:12,color:'var(--c-text3)',marginBottom:10,lineHeight:1.6}}>Odată conectat, profitul estimativ apare automat de fiecare dată când deschizi pagina.</p>
                <button className="pf-btn pf-btn-orange" onClick={fetchShopify} disabled={shopifyLoading}>
                  {shopifyLoading?<><span className="pf-spin">⟳</span> Se încarcă…</>:'⟳ Încarcă comenzile lunii'}
                </button>
              </div>
            )}

            {/* Profit cards */}
            <div className="pf-net-grid">
              <div className={`pf-net-card ${netProfitBeforeTVA>=0?'green':'red'}`}>
                <div className="pf-net-label">Profit net {isEstimated?'(est.)':''}</div>
                <div className={`pf-net-val ${netProfitBeforeTVA>=0?'green':'red'}`}>{netProfitBeforeTVA>=0?'+':''}{fmtK(netProfitBeforeTVA)} RON</div>
                <div className="pf-net-sub">Marjă {marginBefore.toFixed(1)}% · fără TVA</div>
              </div>
              <div className={`pf-net-card ${netProfitAfterTVA>=0?'yellow':'red'}`}>
                <div className="pf-net-label">După TVA 21%</div>
                <div className={`pf-net-val ${netProfitAfterTVA>=0?'yellow':'red'}`}>{netProfitAfterTVA>=0?'+':''}{fmtK(netProfitAfterTVA)} RON</div>
                <div className="pf-net-sub">TVA de plată: <strong style={{color:'var(--c-yellow)'}}>{fmt(totalTVA)} RON</strong></div>
              </div>
            </div>

            {/* Stats row */}
            <div className="pf-stat-row">
              {[
                {label:'Comenzi',val:totalOrders,color:'var(--c-orange)'},
                {label:'Refuzate',val:returnedCount,color:returnedCount>0?'var(--c-red)':'var(--c-text4)'},
                {label:'Venituri',val:fmtK(totalRevenue)+'K',color:'var(--c-green)'},
                {label:'Profit/cmd',val:totalOrders>0?fmtK(netProfitAfterTVA/totalOrders):'—',color:netProfitAfterTVA>=0?'var(--c-green)':'var(--c-red)'},
              ].map((s,i)=>(
                <div key={i} className="pf-stat">
                  <div className="pf-stat-label">{s.label}</div>
                  <div className="pf-stat-val" style={{color:s.color}}>{s.val}</div>
                </div>
              ))}
              {shopifyDone && (
                <button className="pf-btn pf-btn-ghost" style={{width:'auto',padding:'0 10px',flexShrink:0}} onClick={fetchShopify} disabled={shopifyLoading} title="Reîncarcă">
                  {shopifyLoading?<span className="pf-spin">⟳</span>:'↺'}
                </button>
              )}
            </div>

            {/* KPIs */}
            <div className="pf-kpi-grid">
              {[
                {emoji:'📦',val:fmtK(cogs),label:'Cost produse',sub:cogs>0?`${totalRevenue>0?Math.round(cogs/totalRevenue*100):0}% venituri`:'Necompletat',accent:'#3b82f6'},
                {emoji:'🚚',val:fmtK(effectiveTransportCost),label:'Transport',sub:shopifyDone?`GLS ${glsCount}×${fmt(costPerParcel,0)} + SD ${sdCount}×${sdTransportPerParcel}`:`Est. ${fmt(transportPerParcel,2)} RON/col`,accent:'#f59e0b'},
                {emoji:'📣',val:fmtK(totalMarketing),label:'Marketing',sub:useCPA?`CPA ${cpaValue} RON · ROAS ${roasMarketing.toFixed(1)}x`:`ROAS ${roasMarketing.toFixed(1)}x`,accent:'#a855f7'},
                {emoji:'↩️',val:returnedCount>0?fmtK(totalRefusedCost):'0',label:'Colete refuzate',sub:returnedCount>0?`${returnedCount} retur · transport+CPA`:'Detectate automat din Shopify',accent:returnedCount>0?'#f43f5e':'#64748b'},
                {emoji:'🧾',val:fmt(totalTVA,0),label:'TVA de plată',sub:'Meta+Shopify · 21%',accent:'#f59e0b'},
                {emoji:'🔧',val:fmtK(totalFixed+totalOther),label:'Costuri fixe',sub:`${fixedCosts.length} categorii`,accent:'#64748b'},
              ].map((k,i) => (
                <div key={i} className="pf-kpi" style={{'--accent':k.accent}}>
                  <div className="pf-kpi-emoji">{k.emoji}</div>
                  <div className="pf-kpi-val">{k.val}</div>
                  <div className="pf-kpi-label">{k.label}</div>
                  <div className="pf-kpi-sub">{k.sub}</div>
                </div>
              ))}
            </div>

            {/* P&L */}
            <div className="pf-stitle">Detaliu P&L {isEstimated&&<span className="pf-est-badge" style={{fontSize:9}}>⚡ valori estimate</span>}</div>
            <div className="pf-pl">
              <div className="pf-pl-row"><span className="pf-pl-label">💰 Venituri brute</span><span className="pf-pl-val orange">+{fmt(totalRevenue)} RON</span></div>
              <div className="pf-pl-row"><span className="pf-pl-label">📦 Cost produse (COGS)</span><span className="pf-pl-val neg-c">-{fmt(cogs)} RON</span></div>
              <div className="pf-pl-row subtotal"><span className="pf-pl-label" style={{fontWeight:700}}>= Profit brut</span><span className={`pf-pl-val ${grossProfit>=0?'pos':'neg-c'}`}>{grossProfit>=0?'+':''}{fmt(grossProfit)} RON <span style={{fontSize:9,opacity:.6}}>({totalRevenue>0?Math.round(grossProfit/totalRevenue*100):0}%)</span></span></div>
              <div className="pf-pl-row">
                <span className="pf-pl-label">🚚 Transport {glsDone?'GLS (real)':'GLS (est.)'}{sdCount>0?' + SameDay':''}</span>
                <span className="pf-pl-val neg-c">-{fmt(effectiveTransportCost)} RON
                  {sdCount>0&&<span style={{fontSize:9,opacity:.6,marginLeft:4}}>({fmt(glsEffective)}+{fmt(sdEffective)})</span>}
                </span>
              </div>
              <div className="pf-pl-row"><span className="pf-pl-label">📣 Marketing {useCPA?`(CPA ${cpaValue} RON)`:''}</span><span className="pf-pl-val neg-c">-{fmt(totalMarketing)} RON</span></div>
              {returnedCount > 0 && (
                <div className="pf-pl-row returned-row">
                  <span className="pf-pl-label">↩️ Retur {returnedCount} colete (transport retur + CPA {fmt(effectiveCPA,0)} RON)</span>
                  <span className="pf-pl-val neg-c">-{fmt(totalRefusedCost)} RON</span>
                </div>
              )}
              {fixedCosts.map(c => <div key={c.id} className="pf-pl-row"><span className="pf-pl-label">🔧 {c.name||'Cost fix'}{c.perOrder?` (${c.perOrderAmt}×${totalOrders})`:''}</span><span className="pf-pl-val neg-c">-{fmt(c.perOrder?(parseFloat(c.perOrderAmt)||0)*totalOrders:parseFloat(c.amount)||0)} RON</span></div>)}
              {otherCosts.map(c => <div key={c.id} className="pf-pl-row"><span className="pf-pl-label">📌 {c.name||'Alt cost'}</span><span className="pf-pl-val neg-c">-{fmt(parseFloat(c.amount)||0)} RON</span></div>)}
              <div className="pf-pl-row subtotal"><span className="pf-pl-label" style={{fontWeight:700}}>= Total costuri</span><span className="pf-pl-val neg-c">-{fmt(totalCosts)} RON</span></div>
              <div className={`pf-pl-row ${netProfitBeforeTVA>=0?'profit-pos':'profit-neg'}`}>
                <span className="pf-pl-label" style={{fontWeight:800}}>🚀 Profit net (fără TVA)</span>
                <span className="pf-pl-val" style={{fontWeight:900,color:netProfitBeforeTVA>=0?'var(--c-green)':'var(--c-red)'}}>{netProfitBeforeTVA>=0?'+':''}{fmt(netProfitBeforeTVA)} RON</span>
              </div>
              {tvaBase > 0 && (
                <div className="pf-pl-row tva-row">
                  <span className="pf-pl-label">🧾 TVA intracomunitară 21% (Meta{tvaOnShopify?'+Shopify':''})</span>
                  <span className="pf-pl-val yellow">-{fmt(totalTVA)} RON</span>
                </div>
              )}
              <div className={`pf-pl-row ${netProfitAfterTVA>=0?'profit-pos':'profit-neg'}`}>
                <span className="pf-pl-label" style={{fontWeight:800}}>✅ Profit net (după TVA)</span>
                <span className="pf-pl-val" style={{fontWeight:900,fontSize:13,color:netProfitAfterTVA>=0?'var(--c-green)':'var(--c-red)'}}>{netProfitAfterTVA>=0?'+':''}{fmt(netProfitAfterTVA)} RON</span>
              </div>
            </div>

            {/* Retururi detectate */}
            {returnedCount > 0 && (
              <>
                <div className="pf-stitle">Colete refuzate/returnate — detectate automat</div>
                <div className="pf-card" style={{borderColor:'rgba(244,63,94,.2)'}}>
                  <div style={{fontSize:12,color:'var(--c-text3)',lineHeight:1.8}}>
                    <div>📦 Colete refuzate/returnate: <strong style={{color:'var(--c-red)'}}>{returnedCount}</strong></div>
                    <div>🚚 Cost transport retur: <strong style={{color:'var(--c-red)'}}>{returnedCount} × {fmt(costPerParcel,2)} = {fmt(refusedTransportCost)} RON</strong></div>
                    <div>📣 CPA pierdut ({useCPA?`fix ${cpaValue}`:`efectiv ${fmt(effectiveCPA,0)}`} RON): <strong style={{color:'var(--c-red)'}}>{returnedCount} × {fmt(effectiveCPA,0)} = {fmt(refusedCpaCost)} RON</strong></div>
                    <div style={{borderTop:'1px solid rgba(244,63,94,.15)',marginTop:6,paddingTop:6,fontWeight:700}}>Total pierdut din refuzuri: <strong style={{color:'var(--c-red)'}}>{fmt(totalRefusedCost)} RON</strong></div>
                  </div>
                  <div style={{marginTop:10}}>
                    {returnedOrders.slice(0,5).map(o => (
                      <div key={o.id} style={{fontSize:10,color:'var(--c-text4)',padding:'4px 0',borderBottom:'1px solid rgba(255,255,255,.04)'}}>
                        {o.name} · {o.fulfillments?.[0]?.shipment_status||o.financial}
                      </div>
                    ))}
                    {returnedOrders.length > 5 && <div style={{fontSize:10,color:'var(--c-text4)',marginTop:4}}>+{returnedOrders.length-5} mai multe</div>}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ══ COSTURI ══ */}
        {activeTab === 'costs' && (
          <>
            {/* Transport */}
            <div className="pf-stitle">Transport GLS</div>
            <div className={`pf-card ${glsDone?'done':''}`}>
              <div className="pf-card-header">
                <span className="pf-card-icon">🚚</span>
                <span className="pf-card-title">Cost transport</span>
                <span className={`pf-card-status ${glsDone?'ok':''}`}>{glsDone?`✓ ${fmt(glsCost)} RON${sdDone?' · Total: '+fmt(effectiveTransportCost)+' RON':' ('+fmt(costPerParcel,2)+'/col)'}`:`Est. ${fmt(transportPerParcel,2)} RON/colet`}</span>
              </div>
              <label className="pf-label">Excel lunar GLS (.csv / .xlsx)</label>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={parseGLSExcel} style={{fontSize:12,color:'var(--c-text3)',marginBottom:8}} />
              {glsDone && (
                <div style={{fontSize:12,color:'var(--c-text3)',marginBottom:8}}>
                  {glsRows.length} colete · <strong style={{color:'var(--c-yellow)'}}>{fmt(glsCost)} RON</strong> · {fmt(costPerParcel,2)} RON/colet
                  <button className="pf-btn pf-btn-ghost" style={{marginTop:6,width:'auto',padding:'4px 10px',fontSize:11}} onClick={()=>{setGlsDone(false);setGlsCost(0);setGlsRows([]);}}>✕ Șterge</button>
                </div>
              )}
              {!glsDone && (
                <>
                  <label className="pf-label" style={{marginTop:8}}>Sau introdu manual (RON)</label>
                  <div style={{display:'flex',gap:6,marginBottom:10}}>
                    <input className="pf-input" type="text" inputMode="decimal" placeholder="Ex: 2522.34" value={glsManual} onChange={e=>setGlsManual(e.target.value)} />
                    <button className="pf-btn pf-btn-orange" style={{width:'auto',padding:'0 14px'}} onClick={()=>{const v=parseFloat(glsManual.replace(',','.')); if(!isNaN(v)&&v>0){setGlsCost(v);setGlsDone(true);}}}>OK</button>
                  </div>
                  <label className="pf-label">Cost estimat per colet (RON) — folosit până încarci GLS real</label>
                  <input className="pf-input" type="number" step="0.01" value={transportPerParcel} onChange={e=>setTransportPerParcel(parseFloat(e.target.value)||0)} />
                  <div style={{fontSize:10,color:'var(--c-text4)',marginTop:4}}>📊 Calculat luna trecută: 2522.34 ÷ 118 = <strong>21.37 RON/colet</strong></div>
                </>
              )}
            </div>

            {/* SameDay — auto din Shopify */}
            <div className="pf-stitle">Transport SameDay</div>
            <div className="pf-card" style={{borderColor:sdCount>0?'rgba(16,185,129,.25)':'rgba(255,255,255,.06)'}}>
              <div className="pf-card-header">
                <span className="pf-card-icon">⚡</span>
                <span className="pf-card-title">Cost transport SameDay</span>
                <span className="pf-card-status" style={{color:sdCount>0?'var(--c-green)':'var(--c-text4)'}}>
                  {sdCount>0?`✓ ${sdCount} colete · ${fmt(sdEffective)} RON`:'0 colete detectate'}
                </span>
              </div>
              <div style={{background:'rgba(16,185,129,.06)',border:'1px solid rgba(16,185,129,.15)',borderRadius:8,padding:'8px 12px',fontSize:11,color:'var(--c-text3)',marginBottom:10,lineHeight:1.7}}>
                <div>📦 Comenzi SameDay detectate automat din Shopify: <strong style={{color:'var(--c-green)'}}>{sdCount}</strong></div>
                <div>📦 Comenzi GLS: <strong>{glsCount}</strong></div>
              </div>
              <label className="pf-label">Cost per colet SameDay (RON)</label>
              <input className="pf-input" type="number" step="0.5" value={sdTransportPerParcel} onChange={e=>setSdTransportPerParcel(parseFloat(e.target.value)||0)} />
              {sdCount>0&&<div style={{fontSize:10,color:'var(--c-text4)',marginTop:4}}>{sdCount} × {sdTransportPerParcel} RON = <strong>{fmt(sdEffective)} RON</strong></div>}
            </div>

            {/* Marketing */}
            <div className="pf-stitle">Marketing</div>
            <div className="pf-card">
              <div className="pf-card-header">
                <span className="pf-card-icon">📣</span>
                <span className="pf-card-title">Costuri marketing</span>
                <span className="pf-card-status">{totalMarketing>0?`${fmt(totalMarketing)} RON`:'Necompletat'}</span>
              </div>
              <div className="mkt-mode">
                <button className={`mkt-mode-btn${useCPA?' active':''}`} onClick={()=>setUseCPA(true)}>🎯 CPA / comandă</button>
                <button className={`mkt-mode-btn${!useCPA?' active':''}`} onClick={()=>setUseCPA(false)}>💰 Sume reale</button>
              </div>
              {useCPA ? (
                <>
                  <label className="pf-label">CPA — Cost per Achiziție (RON)</label>
                  <input className="pf-input" type="number" step="1" value={cpaValue} onChange={e=>setCpaValue(e.target.value)} />
                  <div style={{marginTop:8,padding:'8px 10px',background:'rgba(168,85,247,.06)',border:'1px solid rgba(168,85,247,.15)',borderRadius:8,fontSize:11,color:'var(--c-text3)',lineHeight:1.7}}>
                    <div>{cpaValue} RON × {totalOrders} comenzi = <strong style={{color:'#a855f7'}}>{fmt(cpaTotal)} RON</strong></div>
                    {totalMarketing>0&&totalRevenue>0&&<div>ROAS: <strong style={{color:'#a855f7'}}>{roasMarketing.toFixed(2)}x</strong></div>}
                    <div style={{fontSize:10,color:'var(--c-text4)',marginTop:4}}>⚠️ Modul CPA: TVA Meta nu se calculează separat. Treci la "Sume reale" pentru TVA precis.</div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{display:'grid',gap:8}}>
                    {[
                      {l:'Meta Ads (RON)',v:metaCost,s:setMetaCost,badge:'TVA 21%',badgeColor:'var(--c-yellow)'},
                      {l:'TikTok Ads (RON)',v:tikTokCost,s:setTikTokCost,badge:'TVA inclus',badgeColor:'var(--c-text4)'},
                      {l:'Google Ads (RON)',v:googleCost,s:setGoogleCost,badge:'TVA inclus RO',badgeColor:'var(--c-text4)'},
                      {l:'Alte platforme (RON)',v:otherMktCost,s:setOtherMktCost,badge:null},
                    ].map((f,i)=>(
                      <div key={i}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
                          <label className="pf-label" style={{margin:0}}>{f.l}</label>
                          {f.badge&&<span style={{fontSize:9,color:f.badgeColor,background:f.badgeColor==='var(--c-yellow)'?'rgba(245,158,11,.1)':'rgba(255,255,255,.05)',padding:'2px 6px',borderRadius:4,fontWeight:700}}>{f.badge}</span>}
                        </div>
                        <input className="pf-input" type="number" placeholder="0" value={f.v} onChange={e=>f.s(e.target.value)} />
                      </div>
                    ))}
                  </div>
                  {totalMarketing>0&&<div style={{marginTop:8,padding:'8px 10px',background:'rgba(168,85,247,.06)',border:'1px solid rgba(168,85,247,.15)',borderRadius:8,fontSize:11,color:'var(--c-text3)',lineHeight:1.7}}>
                    <div>Total: <strong style={{color:'#a855f7'}}>{fmt(totalMarketing)} RON</strong></div>
                    {totalOrders>0&&<div>CPA efectiv: <strong>{fmt(totalMarketing/totalOrders)} RON/cmd</strong></div>}
                    {totalOrders>0&&tvaOnMeta&&<div style={{color:'var(--c-yellow)'}}>CPA efectiv cu TVA 21%: <strong>{fmt((totalMarketing + totalTVA) / totalOrders)} RON/cmd</strong></div>}
                    {totalRevenue>0&&<div>ROAS: <strong>{roasMarketing.toFixed(2)}x</strong></div>}
                  </div>}
                </>
              )}
            </div>

            {/* TVA */}
            <div className="pf-stitle">TVA intracomunitară</div>
            <div className="pf-card">
              <div className="pf-card-header"><span className="pf-card-icon">🧾</span><span className="pf-card-title">TVA de plată · 21%</span><span className="pf-card-status" style={{color:'var(--c-yellow)'}}>{fmt(totalTVA)} RON</span></div>
              <div className="tva-box">
                <div style={{fontSize:11,color:'var(--c-text3)',marginBottom:10,lineHeight:1.6}}>TVA intracomunitară pe servicii digitale din UE. TikTok emite factură cu TVA inclusă.</div>
                {[
                  {label:'Meta Ads',val:tvaOnMeta,set:setTvaOnMeta,base:!useCPA?metaNum:0,note:useCPA?'Treci la "Sume reale" pentru calcul':''},
                  {label:'Shopify subscription',val:tvaOnShopify,set:setTvaOnShopify,base:shopifyFixAmount,note:''},
                  {label:'TikTok Ads',val:false,set:()=>{},base:0,note:'TVA deja inclus pe factură',disabled:true},
                ].map((item,i) => (
                  <div key={i} className="pf-toggle-row" style={{borderBottom:'1px solid rgba(255,255,255,.04)',paddingBottom:8,marginBottom:4,opacity:item.disabled?.8:1}}>
                    <div style={{flex:1}}>
                      <div className="pf-toggle-label" style={{fontSize:11}}>{item.label}</div>
                      {item.note?<div className="pf-toggle-sub">{item.note}</div>:item.base>0&&<div className="pf-toggle-sub">Bază: {fmt(item.base)} RON → TVA: {fmt(item.base*TVA_RATE)} RON</div>}
                    </div>
                    {!item.disabled&&<label className="pf-switch"><input type="checkbox" checked={item.val} onChange={e=>item.set(e.target.checked)}/><span className="pf-slider"></span></label>}
                    {item.disabled&&<span style={{fontSize:10,color:'var(--c-text4)'}}>OFF</span>}
                  </div>
                ))}
                {tvaBase > 0 && <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid rgba(245,158,11,.2)',fontSize:12}}>
                  <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--c-text3)'}}>Bază TVA</span><span style={{fontFamily:'monospace'}}>{fmt(tvaBase)} RON</span></div>
                  <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontWeight:700}}><span>TVA de plată</span><span style={{fontFamily:'monospace',color:'var(--c-yellow)'}}>{fmt(totalTVA)} RON</span></div>
                </div>}
              </div>
            </div>

            {/* Fixed costs */}
            <div className="pf-stitle">Costuri fixe</div>
            <div className="pf-card" style={{marginBottom:10}}>
              {fixedCosts.map(c => (
                <div key={c.id} style={{marginBottom:10,paddingBottom:10,borderBottom:'1px solid rgba(255,255,255,.05)'}}>
                  <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
                    <input className="pf-input" type="text" placeholder="Nume cost" value={c.name} onChange={e=>updateFixed(c.id,'name',e.target.value)} style={{flex:2}} />
                    <button className="pf-btn pf-btn-red" onClick={()=>removeFixed(c.id)}>✕</button>
                  </div>
                  <div className="pf-toggle-row" style={{padding:'4px 0'}}>
                    <div><div className="pf-toggle-label" style={{fontSize:11}}>Per comandă</div><div className="pf-toggle-sub">Înmulțit cu nr. comenzi</div></div>
                    <label className="pf-switch"><input type="checkbox" checked={!!c.perOrder} onChange={e=>updateFixed(c.id,'perOrder',e.target.checked)}/><span className="pf-slider"></span></label>
                  </div>
                  {c.perOrder?(
                    <><label className="pf-label">RON / comandă</label>
                    <input className="pf-input" type="number" step="0.1" value={c.perOrderAmt||''} onChange={e=>updateFixed(c.id,'perOrderAmt',e.target.value)} placeholder="Ex: 1" />
                    <div style={{fontSize:10,color:'var(--c-text4)',marginTop:3}}>{c.perOrderAmt||0} × {totalOrders} = <strong>{fmt((parseFloat(c.perOrderAmt)||0)*totalOrders)} RON</strong></div></>
                  ):(
                    <><label className="pf-label">Sumă lunară (RON)</label>
                    <input className="pf-input" type="number" step="1" value={c.amount} onChange={e=>updateFixed(c.id,'amount',e.target.value)} placeholder="0" /></>
                  )}
                </div>
              ))}
              <button className="pf-btn pf-btn-ghost" onClick={addFixed}>+ Adaugă cost fix</button>
            </div>

            <div className="pf-stitle">Alte costuri variabile</div>
            <div className="pf-card">
              {otherCosts.length===0&&<div style={{fontSize:12,color:'var(--c-text4)',marginBottom:8}}>Nu ai adăugat.</div>}
              {otherCosts.map(c=>(
                <div key={c.id} className="pf-cost-row">
                  <input className="pf-input" type="text" placeholder="Nume" value={c.name} onChange={e=>updateOther(c.id,'name',e.target.value)} />
                  <input className="pf-input" type="number" placeholder="RON" value={c.amount} onChange={e=>updateOther(c.id,'amount',e.target.value)} style={{flex:'0 0 90px'}} />
                  <button className="pf-btn pf-btn-red" onClick={()=>removeOther(c.id)}>✕</button>
                </div>
              ))}
              <button className="pf-btn pf-btn-ghost" onClick={addOther}>+ Adaugă cost variabil</button>
            </div>
          </>
        )}

        {/* ══ PRODUSE ══ */}
        {activeTab === 'products' && (
          <>
            <div className="pf-stitle">Prețuri de achiziție</div>
            <div className="pf-card" style={{marginBottom:10}}>
              <p style={{fontSize:12,color:'var(--c-text3)',marginBottom:12,lineHeight:1.6}}>Prețurile tale de achiziție — cele mai noi. Au prioritate față de Shopify.</p>
              <table className="pf-prod-table">
                <thead><tr><th>Produs</th><th style={{width:90,textAlign:'right'}}>Cost RON</th><th style={{width:32}}></th></tr></thead>
                <tbody>
                  {stdCosts.map((s,i) => (
                    <tr key={s.id}>
                      <td style={{color:'var(--c-text3)',fontSize:11}}>{s.name}</td>
                      <td style={{textAlign:'right'}}>
                        <input type="text" inputMode="decimal" value={s.cost}
                          onChange={e=>setStdCosts(p=>p.map((x,j)=>j===i?{...x,cost:e.target.value}:x))}
                          onBlur={e=>{const v=parseFloat(String(e.target.value).replace(',','.')); if(!isNaN(v)) setStdCosts(p=>p.map((x,j)=>j===i?{...x,cost:v}:x));}}
                          style={{background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',color:'var(--c-green)',borderRadius:6,padding:'4px 8px',fontSize:12,width:'80px',fontFamily:'monospace',textAlign:'right',outline:'none'}} />
                      </td>
                      <td><button onClick={()=>setStdCosts(p=>p.filter((_,j)=>j!==i))} style={{background:'transparent',border:'1px solid rgba(244,63,94,.3)',color:'var(--c-red)',borderRadius:6,padding:'3px 6px',fontSize:11,cursor:'pointer'}}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={()=>setStdCosts(p=>[...p,{id:'new_'+Date.now(),pattern:'',excludes:[],name:'Produs nou',cost:0}])} style={{marginTop:8}} className="pf-btn pf-btn-ghost">+ Adaugă produs</button>
            </div>

            <div className="pf-stitle">Import stoc nou / Export</div>
            <div className="pf-card">
              <p style={{fontSize:12,color:'var(--c-text3)',marginBottom:10,lineHeight:1.6}}>
                Importă direct fișierul <strong>import-cost.xlsx</strong> primit la fiecare stoc nou.
                Produsele existente se actualizează, produsele noi se adaugă automat.
                {costsLastUpdated && <span style={{color:'var(--c-green)',marginLeft:6}}>✓ Actualizat {costsLastUpdated}</span>}
              </p>
              <div style={{display:'grid',gap:8}}>
                <button className="pf-btn pf-btn-orange" onClick={fetchSmartBillCosts} disabled={sbCostsLoading}
                  style={{background:'linear-gradient(135deg,#10b981,#059669)'}}>
                  {sbCostsLoading ? <><span className="pf-spin">⟳</span> Se sincronizează...</> : '🔄 Sincronizează prețuri din SmartBill (API)'}
                </button>
                <button className="pf-btn pf-btn-ghost" onClick={()=>sbExcelRef.current?.click()}
                  style={{borderColor:'rgba(16,185,129,.4)',color:'#10b981'}}>
                  📊 Import Excel SmartBill (Stoc la zi → Exporta Excel)
                </button>
                <input ref={sbExcelRef} type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{display:'none'}}
                  onChange={e=>{if(e.target.files[0]) importSmartBillExcel(e.target.files[0]); e.target.value='';}}/>
                {sbCostsMsg && (
                  <div style={{fontSize:11,padding:'6px 10px',borderRadius:8,
                    background: sbCostsMsg.startsWith('✅') ? 'rgba(16,185,129,.1)' : sbCostsMsg.startsWith('⚠') ? 'rgba(245,158,11,.1)' : 'rgba(244,63,94,.1)',
                    color: sbCostsMsg.startsWith('✅') ? '#10b981' : sbCostsMsg.startsWith('⚠') ? '#f59e0b' : '#f43f5e',
                    border: `1px solid ${sbCostsMsg.startsWith('✅') ? 'rgba(16,185,129,.2)' : sbCostsMsg.startsWith('⚠') ? 'rgba(245,158,11,.2)' : 'rgba(244,63,94,.2)'}`,
                  }}>
                    {sbCostsMsg}
                  </div>
                )}
                <button className="pf-btn pf-btn-orange" onClick={()=>importCostRef.current?.click()}>
                  📦 Import stoc nou (import-cost.xlsx)
                </button>
                <div className="xlsx-actions" style={{marginTop:0}}>
                  <button className="pf-btn pf-btn-green" onClick={()=>exportCostsToXLSX(stdCosts)}>⬇️ Export listă curentă</button>
                  <button className="pf-btn pf-btn-ghost" onClick={()=>xlsxImportRef.current?.click()}>⬆️ Import format standard</button>
                </div>
              </div>
              {/* Import stoc nou — format import-cost.xlsx */}
              <input ref={importCostRef} type="file" accept=".xlsx,.xls" style={{display:'none'}}
                onChange={e=>{
                  const f=e.target.files[0];
                  if(f) parseImportCostXLSX(f, stdCosts,
                    (merged, incoming) => {
                      setStdCosts(merged);
                      localStorage.setItem('glamx_std_costs', JSON.stringify(merged));
                      // Salveaza si in product-costs.json (download pentru GitHub)
                      const blob = new Blob([JSON.stringify(merged, null, 2)], {type:'application/json'});
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = 'product-costs.json'; a.click();
                      URL.revokeObjectURL(url);
                      alert('✅ Actualizat ' + incoming.length + ' produse! Uploadeaza product-costs.json pe GitHub in folderul /public.');
                    },
                    (err) => alert('Eroare import: ' + err)
                  );
                  e.target.value='';
                }} />
              {/* Import format standard XLSX */}
              <input ref={xlsxImportRef} type="file" accept=".xlsx,.xls" style={{display:'none'}}
                onChange={e=>{const f=e.target.files[0]; if(f) importCostsFromXLSX(f,costs=>{setStdCosts(costs);localStorage.setItem('glamx_std_costs',JSON.stringify(costs));alert(`✅ Importat ${costs.length} produse!`);}); e.target.value='';}} />
              <div style={{marginTop:10,padding:'8px 10px',background:'rgba(16,185,129,.06)',border:'1px solid rgba(16,185,129,.15)',borderRadius:8,fontSize:10,color:'var(--c-text3)',lineHeight:1.7}}>
                <strong style={{color:'#10b981'}}>Import Excel SmartBill (recomandat):</strong><br/>
                1. SmartBill → Gestiune → <strong>Rapoarte → Stoc la zi</strong><br/>
                2. Click <strong>Filtrare</strong> → bifează <strong>"Cost unitar"</strong><br/>
                3. Click <strong>Exporta Excel</strong><br/>
                4. Apasă butonul verde "Import Excel SmartBill" de mai sus
              </div>
              <div style={{marginTop:6,padding:'8px 10px',background:'rgba(249,115,22,.06)',border:'1px solid rgba(249,115,22,.15)',borderRadius:8,fontSize:10,color:'var(--c-text3)',lineHeight:1.7}}>
                <strong>Flux import stoc nou (factură furnizor):</strong><br/>
                1. Primești stoc nou → apasă "Import stoc nou" → selectezi fișierul<br/>
                2. Se descarcă automat <code>product-costs.json</code><br/>
                3. Uploadezi în <code>/public</code> pe GitHub ✓
              </div>
            </div>

            {uniqueProducts.length > 0 && (
              <>
                <div className="pf-stitle">Cost rezolvat</div>
                <div className="pf-card">
                  <table className="pf-prod-table">
                    <thead><tr><th>Produs</th><th style={{width:80,textAlign:'right'}}>Cost</th><th style={{width:44,textAlign:'center'}}>Sursă</th></tr></thead>
                    <tbody>
                      {uniqueProducts.slice(0,25).map(prod => {
                        const {cost:rc,src:as} = resolveCost({name:prod,sku:'',variantId:''});
                        const cs = costSource[prod]||as;
                        const srcColor={standard:'#10b981',shopify:'#3b82f6',smartbill:'#a855f7',manual:'#f59e0b',none:'#f43f5e'};
                        const srcLabel={standard:'STD',shopify:'SH',smartbill:'SB',manual:'M',none:'?'};
                        return (
                          <tr key={prod}>
                            <td style={{color:'var(--c-text3)',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={prod}>{prod}</td>
                            <td style={{textAlign:'right'}}><span style={{fontFamily:'monospace',fontSize:12,color:rc>0?'var(--c-green)':'var(--c-red)',fontWeight:700}}>{rc} RON</span></td>
                            <td style={{textAlign:'center'}}><span style={{fontSize:9,fontWeight:800,color:srcColor[cs]||'#64748b',background:`${srcColor[cs]}20`,padding:'2px 5px',borderRadius:4}}>{srcLabel[cs]||'?'}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{marginTop:8,fontSize:10,color:'var(--c-text4)'}}>STD = standard · SH = Shopify · SB = SmartBill · M = manual</div>
                </div>
              </>
            )}
          </>
        )}

        {/* ══ ANALIZĂ PER PRODUS ══ */}
        {activeTab === 'analysis' && (() => {
          const transportPerOrder  = totalOrders > 0 ? effectiveTransportCost / totalOrders : 0;
          const marketingPerOrder  = totalOrders > 0 ? totalMarketing / totalOrders : 0;
          const fixedPerOrder      = totalOrders > 0 ? (totalFixed + totalOther) / totalOrders : 0;
          const cheltuieliPerOrder = transportPerOrder + marketingPerOrder + fixedPerOrder;

          // Grupăm pe SKU (nu pe variantă) — DM56 silicon, DM56 metal = același SKU
          const skuMap = {};
          deliveredOrders.forEach(order => {
            const itemsInOrder = (order.items || []);
            const totalQtyOrder = itemsInOrder.reduce((s,i) => s + (i.qty||1), 0) || 1;
            itemsInOrder.forEach(item => {
              const sku = (item.sku || item.name || 'necunoscut').trim();
              const { cost: costAch } = resolveCost(item);
              const qty  = item.qty || 1;
              const pret = item.price || 0;
              // Cheltuielile se distribuie proporțional pe cantitate
              const chelt = (cheltuieliPerOrder / totalQtyOrder) * qty;
              if (!skuMap[sku]) skuMap[sku] = {
                sku,
                // Numele canonical = primul întâlnit (fără variantă dacă e posibil)
                name: item.name || sku,
                costUnit: costAch, // costul per bucată (e fix per SKU)
                hasCost: costAch > 0,
                qty: 0, revenue: 0, cogs: 0, chelt: 0, profit: 0,
                orders: [], // comenzile care conțin acest SKU
              };
              skuMap[sku].qty     += qty;
              skuMap[sku].revenue += pret * qty;
              skuMap[sku].cogs    += costAch * qty;
              skuMap[sku].chelt   += chelt;
              skuMap[sku].profit  += (pret - costAch) * qty - chelt;
              // Adăugăm comanda la lista produsului (fără duplicate)
              if (!skuMap[sku].orders.find(o => o.id === order.id)) {
                skuMap[sku].orders.push({ id: order.id, name: order.name||order.id, client: order.client||'', total: order.total||0, date: (order.createdAt||'').slice(0,10) });
              }
            });
          });

          const sorted = Object.values(skuMap)
            .filter(p => p.qty > 0 && (showNoCost || p.hasCost))
            .sort((a, b) => {
              if (sortProd === 'profit')  return b.profit - a.profit;
              if (sortProd === 'revenue') return b.revenue - a.revenue;
              if (sortProd === 'qty')     return b.qty - a.qty;
              if (sortProd === 'margin')  return (b.revenue > 0 ? b.profit/b.revenue : -999) - (a.revenue > 0 ? a.profit/a.revenue : -999);
              return 0;
            });

          const totalRevProd    = sorted.reduce((s,p) => s+p.revenue, 0);
          const totalProfitProd = sorted.reduce((s,p) => s+p.profit, 0);
          const totalQtyProd    = sorted.reduce((s,p) => s+p.qty, 0);

          return (
            <>
              <div className="pf-stitle">Analiză profit per produs</div>
              {!deliveredOrders.length ? (
                <div className="pf-card" style={{textAlign:'center',color:'var(--c-text4)',padding:24}}>
                  Încarcă comenzile din tab-ul Setări → Shopify mai întâi.
                </div>
              ) : (
                <>
                  {/* Sumar */}
                  <div className="pf-card" style={{marginBottom:8}}>
                    {/* Filtre + Toggle */}
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:10}}>
                      <span style={{fontSize:11,color:'var(--c-text3)'}}>Sortare:</span>
                      {[['profit','💰 Profit'],['revenue','💵 Vânzări'],['qty','📦 Qty'],['margin','📈 Marjă']].map(([id,lbl]) => (
                        <button key={id} onClick={()=>setSortProd(id)}
                          style={{padding:'4px 10px',borderRadius:20,fontSize:11,cursor:'pointer',fontWeight:sortProd===id?700:400,
                            background:sortProd===id?'#f97316':'#1e2a35',border:`1px solid ${sortProd===id?'#f97316':'#243040'}`,color:sortProd===id?'white':'#94a3b8'}}>
                          {lbl}
                        </button>
                      ))}
                      <button onClick={()=>setPerUnit(v=>!v)}
                        style={{padding:'5px 12px',borderRadius:20,fontSize:11,fontWeight:700,cursor:'pointer',
                          background:perUnit?'linear-gradient(135deg,#3b82f6,#1d4ed8)':'#1e2a35',
                          border:`1px solid ${perUnit?'#3b82f6':'#243040'}`,color:perUnit?'white':'#94a3b8'}}>
                        {perUnit ? '📦 /buc' : '📊 Total'}
                      </button>
                      <label style={{fontSize:11,color:'var(--c-text3)',display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
                        <input type="checkbox" checked={showNoCost} onChange={e=>setShowNoCost(e.target.checked)}/>
                        Fără cost
                      </label>
                    </div>
                    {/* KPI */}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
                      {[
                        {label:'Profit total', val:fmt(totalProfitProd)+' RON', color:'#10b981'},
                        {label:'Vânzări', val:fmt(totalRevProd)+' RON', color:'#f97316'},
                        {label:'Buc vândute', val:totalQtyProd, color:'#3b82f6'},
                      ].map(({label,val,color}) => (
                        <div key={label} style={{background:`rgba(0,0,0,.3)`,borderRadius:8,padding:'8px 10px',textAlign:'center',border:`1px solid ${color}22`}}>
                          <div style={{fontSize:16,fontWeight:800,color}}>{val}</div>
                          <div style={{fontSize:10,color:'var(--c-text4)'}}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Card per SKU */}
                  {sorted.map((p, idx) => {
                    const margin   = p.revenue > 0 ? (p.profit/p.revenue*100) : 0;
                    const profitClr= p.profit > 0 ? '#10b981' : '#f43f5e';
                    const div      = perUnit ? p.qty : 1;
                    const isOpen   = showOrdersSku === p.sku;
                    return (
                      <div key={p.sku} style={{background:'#0d1520',border:`1px solid ${isOpen?'rgba(249,115,22,.4)':'#1e2a35'}`,borderRadius:10,marginBottom:6,overflow:'hidden'}}>
                        <div style={{padding:'12px 14px'}}>
                          {/* Header: rang + SKU badge + nome + qty clickabil */}
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                            <span style={{fontSize:10,color:'#334155',minWidth:18}}>#{idx+1}</span>
                            <span style={{fontFamily:'monospace',fontSize:10,background:'rgba(249,115,22,.1)',color:'#f97316',padding:'2px 6px',borderRadius:4,whiteSpace:'nowrap'}}>{p.sku}</span>
                            <span style={{fontSize:12,fontWeight:700,color:'#e8edf2',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</span>
                            {/* Qty clickabil — deschide lista comenzilor */}
                            <button onClick={()=>setShowOrdersSku(isOpen ? null : p.sku)}
                              style={{background:isOpen?'rgba(249,115,22,.2)':'rgba(255,255,255,.06)',border:`1px solid ${isOpen?'#f97316':'#243040'}`,
                                color:isOpen?'#f97316':'#94a3b8',borderRadius:8,padding:'3px 10px',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
                              {p.qty} buc {isOpen?'▲':'▼'}
                            </button>
                          </div>
                          {/* Bar */}
                          <div style={{height:3,background:'#1e2a35',borderRadius:2,marginBottom:8,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${totalRevProd>0?Math.min(100,p.revenue/totalRevProd*200):0}%`,background:p.profit>0?'#10b981':'#f43f5e',borderRadius:2}}/>
                          </div>
                          {/* 4 cifre */}
                          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:4}}>
                            {[
                              {lbl:'Vânzări',      val:p.revenue/div,  clr:'#f97316'},
                              {lbl:'Cost ach.',    val:p.cogs/div,     clr:'#f43f5e', hide:!p.hasCost},
                              {lbl:'Cheltuieli',   val:p.chelt/div,    clr:'#f59e0b'},
                              {lbl:perUnit?'Profit/buc':`Profit ${margin.toFixed(1)}%`, val:p.profit/div, clr:profitClr, bold:true},
                            ].map(({lbl,val,clr,hide,bold})=>(
                              <div key={lbl} style={{textAlign:'center'}}>
                                <div style={{fontSize:bold?12:11,fontWeight:bold?800:700,color:clr}}>{hide?'—':fmt(val)+' RON'}</div>
                                <div style={{fontSize:9,color:'var(--c-text4)'}}>{lbl}</div>
                              </div>
                            ))}
                          </div>
                          {!p.hasCost && <div style={{marginTop:6,fontSize:10,color:'#f59e0b',background:'rgba(245,158,11,.06)',borderRadius:6,padding:'3px 8px'}}>⚠ Cost achiziție necunoscut</div>}
                        </div>

                        {/* Lista comenzilor expandabilă */}
                        {isOpen && (
                          <div style={{borderTop:'1px solid rgba(249,115,22,.2)',background:'rgba(0,0,0,.3)',padding:'8px 14px'}}>
                            <div style={{fontSize:10,color:'#f97316',fontWeight:700,marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>
                              {p.orders.length} comenzi cu {p.sku}
                            </div>
                            {p.orders.map(o => (
                              <div key={o.id} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,.04)',fontSize:11}}>
                                <span style={{color:'#f97316',fontWeight:700,minWidth:55,fontFamily:'monospace'}}>{o.name}</span>
                                <span style={{color:'#94a3b8',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.client}</span>
                                <span style={{color:'#10b981',fontWeight:600,whiteSpace:'nowrap'}}>{fmt(o.total)} RON</span>
                                <span style={{color:'#475569',fontSize:10,whiteSpace:'nowrap'}}>{o.date}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div style={{fontSize:10,color:'var(--c-text4)',textAlign:'center',padding:'8px 0'}}>
                    {fmt(cheltuieliPerOrder)} RON cheltuieli/comandă distribuite proporțional
                  </div>
                </>
              )}
            </>
          );
        })()}

        {/* ══ SETĂRI ══ */}
                  <div style={{fontSize:10,color:'var(--c-text4)',textAlign:'center',padding:'8px 0'}}>
                    Cheltuieli distribuite proporțional per item · {fmt(cheltuieliPerOrder)} RON/comandă
                  </div>
                </>
              )}
            </>
          );
        })()}

        {/* ══ SETĂRI ══ */}
        {activeTab === 'settings' && (
          <>
            <div className="pf-stitle">SmartBill — Credențiale API</div>
            <div className="pf-card" style={{borderColor: sbEmail&&sbToken&&sbCif ? 'rgba(16,185,129,.3)' : 'rgba(249,115,22,.3)'}}>
              <div className="pf-card-header">
                <span className="pf-card-icon">🔑</span>
                <span className="pf-card-title">Credențiale SmartBill</span>
                <span className="pf-card-status" style={{color: sbEmail&&sbToken&&sbCif ? 'var(--c-green)' : 'var(--c-yellow)'}}>
                  {sbEmail&&sbToken&&sbCif ? `✓ ${sbEmail}` : 'Necompletat'}
                </span>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {[
                  {label:'Email cont SmartBill', val:sbEmail, set:setSbEmail, type:'email',    ph:'email@firma.ro'},
                  {label:'Token API SmartBill',  val:sbToken, set:setSbToken, type:'password', ph:'Token din Contul Meu → Integrări'},
                  {label:'CIF firmă',             val:sbCif,   set:setSbCif,   type:'text',     ph:'RO12345678'},
                  {label:'Gestiune (opțional)',   val:sbWh,    set:setSbWh,    type:'text',     ph:'ex: Depozit principal'},
                ].map(({label,val,set,type,ph}) => (
                  <div key={label}>
                    <label className="pf-label">{label}</label>
                    <input className="pf-input" type={type} value={val} placeholder={ph}
                      onChange={e=>set(e.target.value)} autoComplete="off"/>
                  </div>
                ))}
                <div style={{fontSize:10,color:'var(--c-text4)',padding:'6px 8px',background:'rgba(249,115,22,.05)',borderRadius:6,lineHeight:1.7}}>
                  📍 Token-ul se găsește în SmartBill → <strong>Contul Meu → Integrări</strong> → secțiunea API din josul paginii.<br/>
                  Gestiunea este opțională — dacă o completezi, prețurile de achiziție vin direct din stoc (mai precise).
                </div>
                <button className="pf-btn pf-btn-orange" onClick={saveSbCreds}
                  disabled={!sbEmail||!sbToken||!sbCif}>
                  💾 Salvează credențiale
                </button>
              </div>
            </div>
            <div className="pf-stitle">Shopify</div>
            <div className={`pf-card ${shopifyDone?'done':''}`}>
              <div className="pf-card-header"><span className="pf-card-icon">🛍️</span><span className="pf-card-title">Date comenzi</span><span className={`pf-card-status ${shopifyDone?'ok':''}`}>{shopifyDone?`✓ ${deliveredOrders.length} comenzi`:'Neconectat'}</span></div>
              {!shopifyDone?(
                <button className="pf-btn pf-btn-orange" onClick={fetchShopify} disabled={shopifyLoading}>{shopifyLoading?<><span className="pf-spin">⟳</span> Se încarcă…</>:'⟳ Încarcă comenzile lunii'}</button>
              ):(
                <div>
                  <div className="pf-src-row"><span className="pf-src-key">Venituri</span><span className="pf-src-val" style={{color:'var(--c-orange)'}}>{fmt(totalRevenue)} RON</span></div>
                  <div className="pf-src-row"><span className="pf-src-key">Comenzi livrate+plătite</span><span className="pf-src-val">{totalOrders}</span></div>
                  <div className="pf-src-row"><span className="pf-src-key">Colete returnate</span><span className="pf-src-val" style={{color:returnedCount>0?'var(--c-red)':'var(--c-green)'}}>{returnedCount}</span></div>
                  <button className="pf-btn pf-btn-ghost" style={{marginTop:8}} onClick={fetchShopify} disabled={shopifyLoading}>{shopifyLoading?<><span className="pf-spin">⟳</span></>:'↺ Reîncarcă'}</button>
                </div>
              )}
            </div>

            <div className="pf-stitle">Sumar complet</div>
            <div className="pf-card">
              {[
                {label:'Venituri totale',val:fmt(totalRevenue)+' RON',c:'var(--c-orange)'},
                {label:'Cost produse (COGS)',val:fmt(cogs)+' RON',c:'#3b82f6'},
                {label:'Transport GLS',val:fmt(glsEffective)+' RON',c:'var(--c-yellow)'},
                {label:'Transport SameDay',val:fmt(sdEffective)+' RON',c:'var(--c-yellow)'},
                {label:'Transport total',val:fmt(effectiveTransportCost)+' RON',c:'var(--c-orange)'},
                {label:'Marketing',val:fmt(totalMarketing)+' RON',c:'#a855f7'},
                {label:'Colete refuzate (transport+CPA)',val:fmt(totalRefusedCost)+' RON',c:'var(--c-red)'},
                {label:'Costuri fixe + variabile',val:fmt(totalFixed+totalOther)+' RON',c:'var(--c-text3)'},
                {label:'Profit net (fără TVA)',val:(netProfitBeforeTVA>=0?'+':'')+fmt(netProfitBeforeTVA)+' RON',c:netProfitBeforeTVA>=0?'var(--c-green)':'var(--c-red)'},
                {label:'TVA de plată (21%)',val:fmt(totalTVA)+' RON',c:'var(--c-yellow)'},
                {label:'Profit net (după TVA)',val:(netProfitAfterTVA>=0?'+':'')+fmt(netProfitAfterTVA)+' RON',c:netProfitAfterTVA>=0?'var(--c-green)':'var(--c-red)'},
                {label:'Marjă (fără TVA)',val:marginBefore.toFixed(1)+'%',c:marginBefore>=0?'var(--c-green)':'var(--c-red)'},
                {label:'Marjă (după TVA)',val:marginAfter.toFixed(1)+'%',c:marginAfter>=0?'var(--c-yellow)':'var(--c-red)'},
                {label:'ROAS',val:roasMarketing.toFixed(2)+'x',c:'#a855f7'},
              ].map((r,i)=>(
                <div key={i} className="pf-src-row"><span className="pf-src-key">{r.label}</span><span className="pf-src-val" style={{color:r.c}}>{r.val}</span></div>
              ))}
            </div>
          </>
        )}

      </div>

      <div className="pf-save-bar">
        <button className="pf-save-btn" onClick={saveSettings}>💾 Salvează</button>
      </div>
    </>
  );
}
