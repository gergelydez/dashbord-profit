'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

const fmt = (n, dec = 2) => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtK = (n) => Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'K' : fmt(n, 0);
const today = new Date();

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
  { id: 'DM56b',         sku: 'DM56',           pattern: 'glamx delta max - militar',  excludes: [], name: 'GLAMX DELTA MAX DM56 Militar',          cost: 154.80, updated: '30.03.2026' },
  { id: 'DM56c',         sku: 'DM56',           pattern: 'glamx delta max - negru',    excludes: [], name: 'GLAMX DELTA MAX DM56 Negru',            cost: 154.80, updated: '30.03.2026' },
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
  { id: 'DM76b',         sku: 'DM76',           pattern: 'delta max gold',             excludes: [], name: 'SMARTWATCH DELTA MAX GOLD',            cost: 162.42, updated: '30.03.2026' },
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

const COSTS_JSON_URL = '/product-costs.json';

function mergeCosts(existing, incoming) {
  const result = [...existing];
  incoming.forEach(newItem => {
    const existingIdx = result.findIndex(e => e.sku === newItem.sku || e.id === newItem.id);
    if (existingIdx >= 0) {
      result.forEach((item, i) => {
        if (item.sku === newItem.sku) {
          result[i] = { ...item, cost: newItem.cost, updated: newItem.updated };
        }
      });
    } else {
      result.push(newItem);
    }
  });
  return result;
}

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
          const intPart = parseFloat(row[11]) || 0;
          const decPart = parseFloat(row[12]) || 0;
          const cost = parseFloat(`${intPart}.${String(Math.round(decPart)).padStart(2,'0')}`);
          if (cost > 0) {
            incoming.push({ id: sku, sku, pattern: sku.toLowerCase(), excludes: [], name, cost, updated: today });
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

const TRANSPORT_DEFAULT = 21.37;

const pad2 = n => String(n).padStart(2, '0');
const toISO2 = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

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

function getGlsAwbMap() {
  try { const s = localStorage.getItem('gls_awb_map'); return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function getSdAwbMap() {
  try { const s = localStorage.getItem('sd_awb_map'); return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function getFinalStatus(o, glsAwbMap, sdAwbMap) {
  // 1. AWB map override — sursa cea mai precisă
  if (o.courier === 'gls') {
    const awb = (o.trackingNo || '').trim();
    if (awb && glsAwbMap[awb]) return glsAwbMap[awb];
  }
  if (o.courier === 'sameday') {
    const awb = (o.trackingNo || '').trim();
    // SameDay: folosim DOAR AWB map sau ts deja setat — nu derivăm din Shopify fields
    // Shopify nu știe statusul real SameDay; fără AWB map = în tranzit
    if (awb && sdAwbMap[awb]) return sdAwbMap[awb];
    // SameDay fără confirmare în AWB map — păstrăm ts existent, nu presupunem retur
    if (o.ts && o.ts !== 'pending') return o.ts;
    return 'incurs'; // SameDay fără AWB confirmat = în tranzit, nu retur
  }

  // 2. ts explicit setat și valid
  if (o.ts && o.ts !== 'pending') return o.ts;

  // 3. Detectare din câmpurile Shopify (doar pentru GLS/alte curiere — nu SameDay)
  const fin  = (o.financial  || o.financial_status  || '').toLowerCase();
  const ful  = (o.fulfillment|| o.fulfillment_status || '').toLowerCase();
  const tags = (o.tags || '').toLowerCase();
  const shipStatuses = (o.fulfillments || []).map(f =>
    (f.shipment_status || f.tracking_status || '').toLowerCase()
  );

  // Retur confirmat — doar statusuri clare, nu 'cancelled' care poate fi altceva
  const RETUR_STATUSES = ['returned','failure','failed_attempt','return_in_progress','failed_delivery'];
  const isRetur = shipStatuses.some(s => RETUR_STATUSES.includes(s))
    || fin === 'refunded'
    || tags.includes('retur') || tags.includes('refuz');
  if (isRetur) return 'retur';

  // Livrat
  const isLivrat = shipStatuses.some(s => ['delivered'].includes(s))
    || (ful === 'fulfilled' && shipStatuses.length > 0);
  if (isLivrat) return 'livrat';

  // În tranzit
  if (shipStatuses.some(s => ['in_transit','confirmed','out_for_delivery','label_printed'].includes(s)))
    return 'incurs';

  return o.ts || 'pending';
}

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

function getReturInPeriod(allOrders, preset, customFrom, customTo) {
  const { from, to } = getRange(preset, customFrom, customTo);
  const fromD = new Date(from + 'T00:00:00');
  const toD   = new Date(to   + 'T23:59:59');
  const glsMap = getGlsAwbMap();
  const sdMap  = getSdAwbMap();
  return allOrders.filter(o => {
    const created = new Date(o.createdAt || o.created_at || '');
    if (created < fromD || created > toD) return false;
    // getFinalStatus cu logica extinsa detecteaza retur din orice camp
    return getFinalStatus(o, glsMap, sdMap) === 'retur';
  });
}

// Aplica ts corect la toate comenzile — PRIORITATE: gx_track_ov > GLS Excel > SameDay Excel > Shopify
function recomputeStatuses(orders) {
  const glsMap = getGlsAwbMap();
  const sdMap  = getSdAwbMap();
  let ovMap = {};
  try { const s = typeof window!=='undefined'?localStorage.getItem('gx_track_ov'):null; ovMap = s?JSON.parse(s):{}; } catch {}

  return orders.map(o => {
    // 1. Override explicit din tracking (GLS API live / manual) — SURSA CEA MAI PRECISĂ
    const ov = ovMap[o.id];
    if (ov && ov.ts && ov.ts !== 'pending') {
      return { ...o, ts: ov.ts,
        trackingStatus: ov.statusRaw || o.trackingStatus,
        trackingLastUpdate: ov.lastUpdate || o.trackingLastUpdate,
        trackingLocation: ov.location || o.trackingLocation,
      };
    }

    // 2. GLS Excel AWB map
    if (o.courier === 'gls') {
      const awb = (o.trackingNo || '').trim();
      if (awb && glsMap[awb]) return { ...o, ts: glsMap[awb] };
    }

    // 3. SameDay AWB map
    if (o.courier === 'sameday') {
      const awb = (o.trackingNo || '').trim();
      if (awb && sdMap[awb]) return { ...o, ts: sdMap[awb] };
      // SameDay fara confirmare AWB: nu presupunem retur, lasam ts existent sau incurs
      if (o.ts && o.ts !== 'pending') return o;
      return { ...o, ts: 'incurs' }; // SameDay in tranzit pana la confirmare
    }

    // 4. ts deja setat corect (din Shopify procOrder)
    if (o.ts && o.ts !== 'pending') return o;

    // 5. Deriva din Shopify fields (GLS sau alte curiere)
    return { ...o, ts: getFinalStatus(o, glsMap, sdMap) };
  });
}

const TVA_RATE = 0.21;

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
  const [showNoCost, setShowNoCost] = useState(true);
  const [perUnit, setPerUnit]     = useState(false);
  const [showOrdersSku, setShowOrdersSku] = useState(null);

  // ── ORDERS TAB STATE ──
  const [activeOrdersSkuFilter, setActiveOrdersSkuFilter] = useState('');
  const [ordersSearchText, setOrdersSearchText] = useState('');
  const [editingCost, setEditingCost] = useState({});
  const [tempCostEdit, setTempCostEdit] = useState({});
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [modalView, setModalView] = useState('sku'); // 'sku' | 'orders'
  const [modalSkuFilter, setModalSkuFilter] = useState('');
  const [modalEditCost, setModalEditCost] = useState({});
  const [modalTempCost, setModalTempCost] = useState({});

  // Shopify
  const [shopifyOrders, setShopifyOrders] = useState([]);
  const [allShopifyOrders, setAllShopifyOrders] = useState([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);

  // SmartBill
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

  // SameDay
  const [sdRows, setSdRows] = useState([]);
  const [sdCost, setSdCost] = useState(0);
  const [sdDone, setSdDone] = useState(false);
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
  const sbExcelRef    = useRef(null);
  const [sbCostsLoading, setSbCostsLoading] = useState(false);
  const [sbCostsMsg, setSbCostsMsg] = useState('');

  const importSmartBillExcel = (file) => {
    if (!file) return;
    setSbCostsMsg('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const buf  = ev.target.result;
        const data = new Uint8Array(buf);
        const dv   = new DataView(buf);
        const sectorSize = 2 ** dv.getUint16(30, true);
        const fatSector  = dv.getUint32(76, true);
        const fatOff     = (fatSector + 1) * sectorSize;
        const fat        = Array.from({length: sectorSize/4}, (_,i) => dv.getUint32(fatOff + i*4, true));
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
        const sst = [];
        let pos = 0;
        while (pos < wb.length - 4) {
          const rt = wbDv.getUint16(pos, true);
          const rl = wbDv.getUint16(pos + 2, true);
          if (rt === 0x00FC) {
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
        const strings = {}, numbers = {};
        pos = 0;
        while (pos < wb.length - 4) {
          const rt = wbDv.getUint16(pos, true);
          const rl = wbDv.getUint16(pos + 2, true);
          if (rt === 0x00FD && rl >= 8) {
            const r = wbDv.getUint16(pos+4, true), c = wbDv.getUint16(pos+6, true);
            const idx = wbDv.getUint32(pos+12, true);
            if (idx < sst.length) strings[`${r},${c}`] = sst[idx];
          } else if (rt === 0x00BD) {
            const r = wbDv.getUint16(pos+4, true), fc = wbDv.getUint16(pos+6, true);
            let off = pos + 8, col = fc;
            while (off + 6 <= pos + 4 + rl - 2) {
              const rk = wbDv.getUint32(off+2, true);
              numbers[`${r},${col}`] = Math.round(decodeRK(rk) * 10000) / 10000;
              off += 6; col++;
            }
          } else if (rt === 0x027E && rl >= 8) {
            const r = wbDv.getUint16(pos+4, true), c = wbDv.getUint16(pos+6, true);
            numbers[`${r},${c}`] = decodeRK(wbDv.getUint32(pos+12, true));
          } else if (rt === 0x0203 && rl >= 12) {
            const r = wbDv.getUint16(pos+4, true), c = wbDv.getUint16(pos+6, true);
            numbers[`${r},${c}`] = Math.round(wbDv.getFloat64(pos+10, true) * 10000) / 10000;
          }
          pos += 4 + rl;
        }
        const skuMap = {};
        for (const key of Object.keys(numbers)) {
          const [r, c] = key.split(',').map(Number);
          if (c !== 5) continue;
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
            id: sku, sku, name: d.name, pattern: d.name.toLowerCase(), excludes: [],
            cost: Math.round(d.totalSold / d.totalStoc * 100) / 100, updated,
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

  const fetchSmartBillCosts = async () => {
    const email = localStorage.getItem('sb_email');
    const token = localStorage.getItem('sb_token');
    const cif   = localStorage.getItem('sb_cif');
    const wh    = localStorage.getItem('sb_warehouse') || '';
    if (!email || !token || !cif) {
      setSbCostsMsg('❌ Completează credențialele SmartBill în tab-ul Setări');
      return;
    }
    setSbCostsLoading(true); setSbCostsMsg('');
    try {
      const url = `/api/smartbill/products?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&cif=${encodeURIComponent(cif)}${wh?`&warehouse=${encodeURIComponent(wh)}`:''}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.ok) { setSbCostsMsg(`❌ ${data.error || data.details || 'Eroare SmartBill'}`); return; }
      if (!data.stdCosts?.length) { setSbCostsMsg('⚠️ Nu s-au găsit produse cu preț de achiziție în SmartBill.'); return; }
      const merged = mergeCosts(stdCosts, data.stdCosts);
      setStdCosts(merged);
      localStorage.setItem('glamx_std_costs', JSON.stringify(merged));
      setSbCostsMsg(`✅ ${data.stdCosts.length} produse importate din SmartBill!`);
    } catch (e) { setSbCostsMsg(`❌ ${e.message}`); }
    finally { setSbCostsLoading(false); }
  };

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
    const sord = g('gx_orders_all') || g('gx_orders_60') || g('gx_orders');
    if (sord) {
      try {
        const p = JSON.parse(sord);
        const withOv = recomputeStatuses(applyTrackingOverrides(p));
        const livrate = getLivrateInPeriod(withOv, preset, customFrom, customTo);
        const retur   = getReturInPeriod(withOv, preset, customFrom, customTo);
        setAllShopifyOrders(withOv);
        if (livrate.length > 0) { setShopifyOrders(livrate); setShopifyDone(true); }
        // Debug: log ce s-a gasit
        console.log('[ProfitPage] Livrate:', livrate.length, 'Retur:', retur.length, 'Total:', withOv.length);
      } catch(e) { console.error('[ProfitPage] Load error:', e); }
    }
    fetch(COSTS_JSON_URL)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || !Array.isArray(data)) return;
        const localRaw = localStorage.getItem('glamx_std_costs');
        const local = localRaw ? JSON.parse(localRaw) : DEFAULT_PRODUCT_COSTS;
        const merged = mergeCosts(local, data);
        setStdCosts(merged);
        localStorage.setItem('glamx_std_costs', JSON.stringify(merged));
        const lastUpd = data.find(d => d.updated && d.updated !== '—')?.updated || '';
        if (lastUpd) setCostsLastUpdated(lastUpd);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!preset) return;
    // Custom: nu aplica dacă nu sunt ambele date completate
    if (preset === 'custom' && (!customFrom || !customTo)) return;
    const g = (key) => localStorage.getItem(key);
    const sord = g('gx_orders_all') || g('gx_orders_60') || g('gx_orders');
    if (!sord) return;
    try {
      const p = JSON.parse(sord);
      const withOv = recomputeStatuses(applyTrackingOverrides(p));
      const livrate = getLivrateInPeriod(withOv, preset, customFrom, customTo);
      setAllShopifyOrders(withOv);
      setShopifyOrders(livrate);
      setShopifyDone(livrate.length > 0);
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
        const fulfillmentsClean = (o.fulfillments || []).map(f => ({
          tracking_company: f.tracking_company || '',
          tracking_number:  f.tracking_number  || '',
          shipment_status:  f.shipment_status  || '',
          tracking_status:  f.tracking_status  || '',
          status:           f.status           || '',
        }));
        const mapped = {
          id: o.id, name: o.name,
          total: parseFloat(o.total_price) || 0,
          financial: o.financial_status, financial_status: o.financial_status,
          fulfillment: o.fulfillment_status, fulfillment_status: o.fulfillment_status,
          fulfillments: fulfillmentsClean,
          courier, trackingNo: fulfillmentData?.tracking_number || '',
          items: (o.line_items || []).map(i => ({ name: i.name, sku: i.sku||'', variantId: String(i.variant_id||''), qty: i.quantity||1, price: parseFloat(i.price)||0 })),
          createdAt: o.created_at, tags: o.tags||'',
        };
        const glsM = getGlsAwbMap(); const sdM = getSdAwbMap();
        mapped.ts = getFinalStatus(mapped, glsM, sdM);
        return mapped;
      });
      const withOv = applyTrackingOverrides(processed);
      const livrate = getLivrateInPeriod(withOv, preset, customFrom, customTo);
      setAllShopifyOrders(withOv);
      // Afișăm DOAR livrările — nu toată lista brută
      setShopifyOrders(livrate);
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
  const deliveredOrders = shopifyOrders;
  const returnedOrders = getReturInPeriod(allShopifyOrders, preset, customFrom, customTo);
  const totalRevenue = deliveredOrders.reduce((s, o) => s + (o.total || 0), 0);
  const totalOrders = deliveredOrders.length;
  const totalItems = deliveredOrders.reduce((s, o) => s + (o.items||[]).reduce((ss, i) => ss + (i.qty||1), 0), 0);
  const returnedCount = returnedOrders.length;

  const resolveCost = useCallback((item) => {
    const nameRaw = (item.name||'').trim();
    const nameKey = nameRaw.toLowerCase();
    const rawSku  = (item.sku||'').trim();
    const skuKey  = rawSku.toLowerCase();
    const variantId = String(item.variantId||'');

    const getCostVal = (s) => typeof s.cost==='number' ? s.cost : parseFloat(s.cost)||0;

    // 1. Override manual
    if (manualCosts[nameRaw] !== undefined && manualCosts[nameRaw] !== '')
      return { cost: parseFloat(manualCosts[nameRaw])||0, src: 'manual' };

    // 2. SmartBill productCosts
    if (productCosts[nameKey])
      return { cost: productCosts[nameKey]||0, src: 'smartbill' };

    // 3. Shopify variant/sku costs
    const shopifyCost = (variantId ? shopifyVariantCosts[variantId] : null)
      || (skuKey ? shopifySkuCosts[skuKey] : null)
      || shopifyCosts[nameKey];
    if (shopifyCost) return { cost: shopifyCost, src: 'shopify' };

    // 4. SKU exact match — PRIORITATE MAXIMĂ dacă SKU există
    if (skuKey) {
      const exact = stdCosts.find(s => (s.sku||s.id||'').toLowerCase() === skuKey);
      if (exact) return { cost: getCostVal(exact), src: 'standard' };
    }

    // 5. SKU prefix/suffix match (DM56-METAL → DM56, DM56/FOLIE → DM56)
    if (skuKey) {
      const prefix = stdCosts.find(s => {
        const b = (s.sku||s.id||'').toLowerCase();
        return b.length >= 2 && (skuKey === b || skuKey.startsWith(b+'-') || skuKey.startsWith(b+'/') || skuKey.startsWith(b+'_') || skuKey.endsWith('-'+b) || skuKey.endsWith('/'+b));
      });
      if (prefix) return { cost: getCostVal(prefix), src: 'standard' };
    }

    // 6. Pattern match pe NUME (sortat desc dupa lungime — mai specific castiga)
    const byPatLen = [...stdCosts].sort((a,b) => (b.pattern||'').length - (a.pattern||'').length);
    for (const std of byPatLen) {
      const pat = (std.pattern||'').toLowerCase().trim();
      if (!pat || pat.length < 3) continue;
      if (nameKey.includes(pat)) {
        const excluded = (std.excludes||[]).some(ex => nameKey.includes(ex.toLowerCase()));
        if (!excluded) return { cost: getCostVal(std), src: 'standard' };
      }
    }

    // 7. SKU-ul din stdCosts apare in NUMELE produsului
    for (const std of byPatLen) {
      const stdSku = (std.sku||std.id||'').toLowerCase();
      if (stdSku.length >= 2 && nameKey.includes(stdSku)) {
        return { cost: getCostVal(std), src: 'standard' };
      }
    }

    // 8. Fuzzy: toate cuvintele cheie din pattern apar in nume
    for (const std of byPatLen) {
      const words = (std.pattern||'').toLowerCase().split(/\s+/).filter(w=>w.length>=4);
      if (words.length >= 2 && words.every(w => nameKey.includes(w))) {
        const excluded = (std.excludes||[]).some(ex => nameKey.includes(ex.toLowerCase()));
        if (!excluded) return { cost: getCostVal(std), src: 'standard' };
      }
    }

    return { cost: 0, src: 'none' };
  }, [stdCosts, productCosts, shopifyCosts, shopifyVariantCosts, shopifySkuCosts, manualCosts, costSource]);

  const getCOGS = useCallback(() => {
    if (!shopifyOrders.length) return 0;
    return deliveredOrders.reduce((total, order) => total + (order.items||[]).reduce((s, item) => s + (resolveCost(item).cost * (item.qty||1)), 0), 0);
  }, [deliveredOrders, resolveCost]);

  const cogs = getCOGS();

  const glsMapC = getGlsAwbMap();
  const sdMapC  = getSdAwbMap();
  const sdOrders   = deliveredOrders.filter(o => o.courier === 'sameday');
  const glsOrders  = deliveredOrders.filter(o => o.courier === 'gls' || !o.courier || o.courier === 'unknown' || o.courier === '');
  const glsCount   = glsOrders.length;
  const sdCount    = sdOrders.length;
  const totalParcelCount = totalOrders;

  const costPerParcel    = glsDone && glsRows.length > 0 ? glsCost / glsRows.length : transportPerParcel;
  const sdCostPerParcel  = sdTransportPerParcel;

  const glsEffective = glsDone ? glsCost : glsCount * transportPerParcel;
  const sdEffective  = sdCount * sdTransportPerParcel;
  const effectiveTransportCost = glsEffective + sdEffective;

  const metaNum = parseFloat(metaCost)||0;
  const tikTokNum = parseFloat(tikTokCost)||0;
  const googleNum = parseFloat(googleCost)||0;
  const otherMktNum = parseFloat(otherMktCost)||0;

  // ── LOGICA CORECTĂ MARKETING + RETURURI ──────────────────────────────
  // Marketingul acopera TOATE comenzile expediate (livrate + returnate).
  // Nu scadem CPA pentru retururi separat — e deja in costul total marketing.
  // La retururi scadem DOAR transportul de retur (coletul fizic inapoi).
  //
  // Exemplu: 74 livrate + 5 returnate = 79 expediate
  //   Marketing 5.000 RON / 79 = 63.29 RON CPA real/expediat
  //   Retur cost = 5 × transport (doar colet retur)
  // ─────────────────────────────────────────────────────────────────────
  const totalExpediate = totalOrders + returnedCount;

  const cpaTotal = useCPA ? (parseFloat(cpaValue)||0) * totalExpediate : 0;
  const manualMarketingTotal = metaNum + tikTokNum + googleNum + otherMktNum;
  const totalMarketing = useCPA ? cpaTotal : manualMarketingTotal;
  const roasMarketing = totalMarketing > 0 ? totalRevenue / totalMarketing : 0;

  // CPA efectiv = marketing / toate comenzile expediate
  const effectiveCPA = totalExpediate > 0 && totalMarketing > 0
    ? totalMarketing / totalExpediate
    : (parseFloat(cpaValue) || 0);

  // Retururi = DOAR transport retur (marketing deja inclus in totalMarketing)
  const refusedTransportCost = returnedCount * costPerParcel;
  const totalRefusedCost = refusedTransportCost;

  const shopifyFixAmount = parseFloat(fixedCosts.find(c => c.name.toLowerCase().includes('shopify'))?.amount||'0')||0;
  const tvaBase = (tvaOnMeta && !useCPA ? metaNum : 0) + (tvaOnShopify ? shopifyFixAmount : 0);
  const totalTVA = tvaBase * TVA_RATE;

  const totalFixed = fixedCosts.reduce((s, c) => s + (c.perOrder ? (parseFloat(c.perOrderAmt)||0)*totalOrders : (parseFloat(c.amount)||0)), 0);
  const totalOther = otherCosts.reduce((s, c) => s + (parseFloat(c.amount)||0), 0);

  const totalCosts = cogs + effectiveTransportCost + totalMarketing + totalFixed + totalOther + totalRefusedCost;
  const grossProfit = totalRevenue - cogs;
  const netProfitBeforeTVA = totalRevenue - totalCosts;
  const netProfitAfterTVA = netProfitBeforeTVA - totalTVA;
  const marginBefore = totalRevenue > 0 ? (netProfitBeforeTVA / totalRevenue) * 100 : 0;
  const marginAfter = totalRevenue > 0 ? (netProfitAfterTVA / totalRevenue) * 100 : 0;
  const isEstimated = !glsDone || useCPA;

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
    .pf-back{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:var(--c-text3);padding:5px 10px;border-radius:8px;font-size:11px;font-weight:600;text-decoration:none;flex-shrink:0}
    .pf-est-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.25);color:var(--c-yellow);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700}
    .pf-tabs{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:14px}
    .pf-tab{display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 2px;border-radius:10px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03);color:var(--c-text4);font-size:9px;font-weight:700;cursor:pointer;transition:all .15s;text-transform:uppercase;letter-spacing:.3px}
    .pf-tab-icon{font-size:16px;line-height:1}
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
    .pf-prod-table{width:100%;border-collapse:collapse;font-size:11px}
    .pf-prod-table th{padding:7px 8px;text-align:left;font-size:9px;color:var(--c-text4);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid rgba(255,255,255,.05);background:rgba(255,255,255,.02)}
    .pf-prod-table td{padding:8px 8px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle}
    .pf-prod-table tr:last-child td{border-bottom:none}
    .xlsx-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
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
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
          {[
            {id:'month',     l:'Luna aceasta'},
            {id:'last_month',l:'Luna trecută'},
            {id:'last_30',   l:'30 zile'},
            {id:'last_7',    l:'7 zile'},
            {id:'last_90',   l:'90 zile'},
            {id:'year',      l:'Anul acesta'},
            {id:'custom',    l:'📅 Custom'},
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
        {/* CUSTOM DATE RANGE */}
        {preset === 'custom' && (
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,flexWrap:'wrap'}}>
            <span style={{fontSize:11,color:'var(--c-text4)'}}>De la:</span>
            <input type="date" value={customFrom}
              onChange={e=>setCustomFrom(e.target.value)}
              style={{background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'5px 8px',borderRadius:7,fontSize:11,outline:'none'}} />
            <span style={{fontSize:11,color:'var(--c-text4)'}}>Până la:</span>
            <input type="date" value={customTo}
              onChange={e=>setCustomTo(e.target.value)}
              style={{background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'5px 8px',borderRadius:7,fontSize:11,outline:'none'}} />
            <button
              onClick={()=>{
                if(customFrom && customTo) {
                  // Forțăm re-render cu valorile noi
                  setPreset('custom');
                }
              }}
              disabled={!customFrom || !customTo}
              style={{background:'#f97316',color:'white',border:'none',borderRadius:7,padding:'5px 14px',fontSize:11,fontWeight:700,cursor:'pointer',opacity:(!customFrom||!customTo)?.5:1}}>
              Aplică
            </button>
          </div>
        )}

        {/* NAV */}
        <div className="pf-navlinks">
          <a href="/profit" className="pf-navlink" style={{background:'rgba(16,185,129,.1)',color:'#10b981',borderColor:'rgba(16,185,129,.2)'}}>💹 Profit</a>
          <a href="/stats" className="pf-navlink" style={{background:'rgba(59,130,246,.1)',color:'#3b82f6',borderColor:'rgba(59,130,246,.2)'}}>📊 Stats</a>
          <a href="/import" className="pf-navlink" style={{background:'rgba(168,85,247,.1)',color:'#a855f7',borderColor:'rgba(168,85,247,.2)'}}>📦 Import</a>
          <a href="/whatsapp" className="pf-navlink" style={{background:'rgba(37,211,102,.1)',color:'#25d366',borderColor:'rgba(37,211,102,.2)'}}>📱 WA</a>
        </div>

        {/* TABS — 6 tabs now */}
        <div className="pf-tabs">
          {[
            {id:'summary',  icon:'📊', label:'Sumar'},
            {id:'costs',    icon:'💸', label:'Costuri'},
            {id:'orders',   icon:'🧾', label:'Comenzi'},
            {id:'products', icon:'📦', label:'Produse'},
            {id:'analysis', icon:'🔬', label:'Analiză'},
            {id:'settings', icon:'⚙️', label:'Setări'},
          ].map(tab => (
            <button key={tab.id} className={`pf-tab${activeTab===tab.id?' active':''}`} onClick={() => setActiveTab(tab.id)}>
              <span className="pf-tab-icon">{tab.icon}</span>{tab.label}
            </button>
          ))}
        </div>

        {/* ══ SUMAR ══ */}
        {activeTab === 'summary' && (
          <>
            {!shopifyDone && (
              <div className="pf-card" style={{marginBottom:14}}>
                <div className="pf-card-header"><span className="pf-card-icon">🛍️</span><span className="pf-card-title">Conectează Shopify pentru profit live</span></div>
                <p style={{fontSize:12,color:'var(--c-text3)',marginBottom:10,lineHeight:1.6}}>Odată conectat, profitul estimativ apare automat de fiecare dată când deschizi pagina.</p>
                <button className="pf-btn pf-btn-orange" onClick={fetchShopify} disabled={shopifyLoading}>
                  {shopifyLoading?<><span className="pf-spin">⟳</span> Se încarcă…</>:'⟳ Încarcă comenzile lunii'}
                </button>
              </div>
            )}
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
            <div className="pf-stat-row">
              {[
                {label:'Comenzi',val:totalOrders,color:'var(--c-orange)', clickable: true},
                {label:'Refuzate',val:returnedCount,color:returnedCount>0?'var(--c-red)':'var(--c-text4)'},
                {label:'Venituri',val:fmtK(totalRevenue)+'K',color:'var(--c-green)'},
                {label:'Profit/cmd',val:totalOrders>0?fmtK(netProfitAfterTVA/totalOrders):'—',color:netProfitAfterTVA>=0?'var(--c-green)':'var(--c-red)'},
              ].map((s,i)=>(
                <div key={i} className="pf-stat"
                  onClick={s.clickable && totalOrders > 0 ? ()=>setShowOrdersModal(true) : undefined}
                  style={s.clickable && totalOrders > 0 ? {cursor:'pointer',borderColor:'rgba(249,115,22,.25)',background:'rgba(249,115,22,.06)',transition:'all .15s'} : {}}>
                  <div className="pf-stat-label" style={s.clickable&&totalOrders>0?{color:'var(--c-orange)'}:{}}>{s.label} {s.clickable&&totalOrders>0&&<span style={{fontSize:8,opacity:.6}}>↗</span>}</div>
                  <div className="pf-stat-val" style={{color:s.color}}>{s.val}</div>
                </div>
              ))}
              {shopifyDone && (
                <button className="pf-btn pf-btn-ghost" style={{width:'auto',padding:'0 10px',flexShrink:0}} onClick={fetchShopify} disabled={shopifyLoading} title="Reîncarcă">
                  {shopifyLoading?<span className="pf-spin">⟳</span>:'↺'}
                </button>
              )}
            </div>
            <div className="pf-kpi-grid">
              {[
                {emoji:'📦',val:fmtK(cogs),label:'Cost produse',sub:cogs>0?`${totalRevenue>0?Math.round(cogs/totalRevenue*100):0}% venituri`:'Necompletat',accent:'#3b82f6'},
                {emoji:'🚚',val:fmtK(effectiveTransportCost),label:'Transport',sub:shopifyDone?`GLS ${glsCount}×${fmt(costPerParcel,0)} + SD ${sdCount}×${sdTransportPerParcel}`:`Est. ${fmt(transportPerParcel,2)} RON/col`,accent:'#f59e0b'},
                {emoji:'📣',val:fmtK(totalMarketing),label:'Marketing',sub:useCPA?`CPA ${fmt(effectiveCPA,0)} RON/exp · ${totalExpediate} exp · ROAS ${roasMarketing.toFixed(1)}x`:`ROAS ${roasMarketing.toFixed(1)}x · CPA ${fmt(effectiveCPA,0)} RON`,accent:'#a855f7'},
                {emoji:'↩️',val:returnedCount>0?fmtK(totalRefusedCost):'0',label:'Colete refuzate',sub:returnedCount>0?`${returnedCount} retur · doar transport retur`:'Detectate automat din Shopify',accent:returnedCount>0?'#f43f5e':'#64748b'},
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
              <div className="pf-pl-row"><span className="pf-pl-label">📣 Marketing {useCPA?`(CPA ${fmt(effectiveCPA,0)} RON × ${totalExpediate} exp.)`:''}</span><span className="pf-pl-val neg-c">-{fmt(totalMarketing)} RON</span></div>
              {returnedCount > 0 && (
                <div className="pf-pl-row returned-row">
                  <span className="pf-pl-label">↩️ Transport retur {returnedCount} colete · CPA inclus în marketing</span>
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
            {returnedCount > 0 && (
              <>
                <div className="pf-stitle">Colete refuzate/returnate — detectate automat</div>
                <div className="pf-card" style={{borderColor:'rgba(244,63,94,.2)'}}>
                  <div style={{fontSize:12,color:'var(--c-text3)',lineHeight:1.8}}>
                    <div>📦 Colete refuzate/returnate: <strong style={{color:'var(--c-red)'}}>{returnedCount}</strong></div>
                    <div>🚚 Transport retur: <strong style={{color:'var(--c-red)'}}>{returnedCount} × {fmt(costPerParcel,2)} = {fmt(refusedTransportCost)} RON</strong></div>
                    <div style={{fontSize:11,color:'#475569',marginTop:2,padding:'6px 8px',background:'rgba(255,255,255,.03)',borderRadius:6,lineHeight:1.6}}>
                      💡 CPA-ul pentru aceste comenzi <strong>nu se scade separat</strong> — marketingul ({fmt(totalMarketing)} RON) este împărțit la toate <strong>{totalExpediate} comenzi expediate</strong> (livrate + returnate), deci CPA efectiv este {fmt(effectiveCPA)} RON/comandă.
                    </div>
                    <div style={{borderTop:'1px solid rgba(244,63,94,.15)',marginTop:6,paddingTop:6,fontWeight:700}}>Cost net retururi (doar transport): <strong style={{color:'var(--c-red)'}}>{fmt(totalRefusedCost)} RON</strong></div>
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
                  <label className="pf-label">Cost estimat per colet (RON)</label>
                  <input className="pf-input" type="number" step="0.01" value={transportPerParcel} onChange={e=>setTransportPerParcel(parseFloat(e.target.value)||0)} />
                  <div style={{fontSize:10,color:'var(--c-text4)',marginTop:4}}>📊 Calculat luna trecută: 2522.34 ÷ 118 = <strong>21.37 RON/colet</strong></div>
                </>
              )}
            </div>
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
                    <div>{cpaValue} RON × {totalExpediate} expediate ({totalOrders} livrate + {returnedCount} retur) = <strong style={{color:'#a855f7'}}>{fmt(cpaTotal)} RON</strong></div>
                    <div style={{fontSize:10,color:'#64748b',marginTop:2}}>CPA real: <strong style={{color:'#a855f7'}}>{fmt(effectiveCPA)} RON/comandă expediată</strong></div>
                    {totalMarketing>0&&totalRevenue>0&&<div>ROAS: <strong style={{color:'#a855f7'}}>{roasMarketing.toFixed(2)}x</strong></div>}
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
                    {totalRevenue>0&&<div>ROAS: <strong>{roasMarketing.toFixed(2)}x</strong></div>}
                  </div>}
                </>
              )}
            </div>
            <div className="pf-stitle">TVA intracomunitară</div>
            <div className="pf-card">
              <div className="pf-card-header"><span className="pf-card-icon">🧾</span><span className="pf-card-title">TVA de plată · 21%</span><span className="pf-card-status" style={{color:'var(--c-yellow)'}}>{fmt(totalTVA)} RON</span></div>
              <div className="tva-box">
                <div style={{fontSize:11,color:'var(--c-text3)',marginBottom:10,lineHeight:1.6}}>TVA intracomunitară pe servicii digitale din UE.</div>
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

        {/* ══ COMENZI ══ */}
        {activeTab === 'orders' && (() => {
          const transportPerOrder  = totalOrders > 0 ? effectiveTransportCost / totalOrders : 0;
          const marketingPerOrder  = totalOrders > 0 ? totalMarketing / totalOrders : 0;
          const fixedPerOrder      = totalOrders > 0 ? (totalFixed + totalOther) / totalOrders : 0;
          const cheltuieliPerOrder = transportPerOrder + marketingPerOrder + fixedPerOrder;

          // Toate SKU-urile unice din comenzile livrate
          const allSkus = [...new Set(
            deliveredOrders.flatMap(o => (o.items||[]).map(i => (i.sku||'').trim()).filter(Boolean))
          )].sort();

          // Filtrare comenzi
          const filteredOrders = deliveredOrders.filter(order => {
            const matchesSku = !activeOrdersSkuFilter ||
              (order.items||[]).some(i =>
                (i.sku||'').toLowerCase() === activeOrdersSkuFilter.toLowerCase()
              );
            const matchesSearch = !ordersSearchText ||
              (order.name||'').toLowerCase().includes(ordersSearchText.toLowerCase()) ||
              (order.items||[]).some(i => (i.name||'').toLowerCase().includes(ordersSearchText.toLowerCase()));
            return matchesSku && matchesSearch;
          });

          // Calcul profit per comandă
          const calcOrderProfit = (order) => {
            const items = order.items || [];
            const totalQty = items.reduce((s,i) => s+(i.qty||1), 0) || 1;
            const revenue  = items.reduce((s,i) => s + (i.price||0)*(i.qty||1), 0);
            const cogsPart = items.reduce((s,i) => s + resolveCost(i).cost*(i.qty||1), 0);
            const chelt    = cheltuieliPerOrder;
            const profit   = revenue - cogsPart - chelt;
            const margin   = revenue > 0 ? profit/revenue*100 : 0;
            return { revenue, cogsPart, chelt, profit, margin, totalQty };
          };

          // Totaluri pentru comenzile filtrate
          const totalsFilt = filteredOrders.reduce((acc, o) => {
            const c = calcOrderProfit(o);
            acc.revenue  += c.revenue;
            acc.cogs     += c.cogsPart;
            acc.chelt    += c.chelt;
            acc.profit   += c.profit;
            return acc;
          }, { revenue:0, cogs:0, chelt:0, profit:0 });

          return (
            <>
              <div className="pf-stitle">Comenzi livrate — {filteredOrders.length} din {deliveredOrders.length}</div>

              {!deliveredOrders.length ? (
                <div className="pf-card" style={{textAlign:'center',color:'var(--c-text4)',padding:24}}>
                  <div style={{fontSize:24,marginBottom:8}}>🛍️</div>
                  <div style={{fontSize:13,marginBottom:12}}>Încarcă comenzile din tab-ul Setări → Shopify mai întâi.</div>
                  <button className="pf-btn pf-btn-orange" onClick={fetchShopify} disabled={shopifyLoading}>
                    {shopifyLoading?<><span className="pf-spin">⟳</span> Se încarcă…</>:'⟳ Încarcă comenzile'}
                  </button>
                </div>
              ) : (
                <>
                  {/* Filtre */}
                  <div className="pf-card" style={{marginBottom:8,padding:'10px 12px'}}>
                    <input className="pf-input" type="text" placeholder="🔍 Caută după nr. comandă sau produs..."
                      value={ordersSearchText} onChange={e=>setOrdersSearchText(e.target.value)}
                      style={{marginBottom:8}} />
                    <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>
                      <span style={{fontSize:10,color:'var(--c-text4)',fontWeight:700,flexShrink:0}}>SKU:</span>
                      <button onClick={()=>setActiveOrdersSkuFilter('')}
                        style={{padding:'4px 10px',borderRadius:20,fontSize:10,cursor:'pointer',fontWeight:!activeOrdersSkuFilter?700:400,
                          background:!activeOrdersSkuFilter?'#f97316':'#1e2a35',
                          border:`1px solid ${!activeOrdersSkuFilter?'#f97316':'#243040'}`,
                          color:!activeOrdersSkuFilter?'white':'#94a3b8'}}>
                        Toate ({deliveredOrders.length})
                      </button>
                      {allSkus.map(sku => {
                        const cnt = deliveredOrders.filter(o=>(o.items||[]).some(i=>(i.sku||'')===sku)).length;
                        return (
                          <button key={sku} onClick={()=>setActiveOrdersSkuFilter(activeOrdersSkuFilter===sku?'':sku)}
                            style={{padding:'4px 10px',borderRadius:20,fontSize:10,cursor:'pointer',fontWeight:activeOrdersSkuFilter===sku?700:400,
                              background:activeOrdersSkuFilter===sku?'rgba(249,115,22,.2)':'#1e2a35',
                              border:`1px solid ${activeOrdersSkuFilter===sku?'#f97316':'#243040'}`,
                              color:activeOrdersSkuFilter===sku?'#f97316':'#94a3b8'}}>
                            {sku} <span style={{opacity:.6}}>({cnt})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sumar filtre */}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:6,marginBottom:8}}>
                    {[
                      {label:'Vânzări',    val:fmt(totalsFilt.revenue)+' RON',  clr:'#f97316'},
                      {label:'Cost ach.',  val:fmt(totalsFilt.cogs)+' RON',     clr:'#f43f5e'},
                      {label:'Cheltuieli', val:fmt(totalsFilt.chelt)+' RON',    clr:'#f59e0b'},
                      {label:'Profit',     val:(totalsFilt.profit>=0?'+':'')+fmt(totalsFilt.profit)+' RON', clr:totalsFilt.profit>=0?'#10b981':'#f43f5e'},
                    ].map(({label,val,clr})=>(
                      <div key={label} style={{background:'#0d1520',border:`1px solid ${clr}22`,borderRadius:8,padding:'7px 8px',textAlign:'center'}}>
                        <div style={{fontSize:12,fontWeight:800,color:clr,fontFamily:'monospace',lineHeight:1.2}}>{val}</div>
                        <div style={{fontSize:9,color:'var(--c-text4)',marginTop:2}}>{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Lista comenzilor */}
                  {filteredOrders.map(order => {
                    const { revenue, cogsPart, chelt, profit, margin } = calcOrderProfit(order);
                    const items = order.items || [];
                    const profitClr = profit >= 0 ? '#10b981' : '#f43f5e';
                    const date = (order.createdAt||'').slice(0,10);
                    const courierLabel = order.courier === 'sameday' ? '⚡ SD' : order.courier === 'gls' ? '🚚 GLS' : '📦';

                    return (
                      <div key={order.id} style={{
                        background:'#0d1520',
                        border:`1px solid ${profit>=0?'#1a2535':'rgba(244,63,94,.15)'}`,
                        borderRadius:10, marginBottom:6, overflow:'hidden'
                      }}>
                        {/* Header comandă */}
                        <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderBottom:'1px solid #1a2535'}}>
                          <span style={{color:'#f97316',fontWeight:800,fontSize:12,fontFamily:'monospace',minWidth:60}}>{order.name}</span>
                          <span style={{fontSize:10,color:'#475569'}}>{date}</span>
                          <span style={{fontSize:10,color:'#475569',background:'rgba(255,255,255,.04)',padding:'1px 6px',borderRadius:4}}>{courierLabel}</span>
                          <span style={{flex:1}}/>
                          <span style={{fontSize:11,color:'#94a3b8',fontFamily:'monospace'}}>{fmt(revenue)} RON</span>
                          <span style={{fontSize:12,fontWeight:800,color:profitClr,fontFamily:'monospace',minWidth:75,textAlign:'right'}}>
                            {profit>=0?'+':''}{fmt(profit)} RON
                          </span>
                        </div>

                        {/* Produse */}
                        <div style={{padding:'6px 12px'}}>
                          {items.map((item, idx) => {
                            const { cost: costUnit, src } = resolveCost(item);
                            const qty = item.qty || 1;
                            const itemSku = item.sku || '';
                            const srcClr = {standard:'#10b981',shopify:'#3b82f6',smartbill:'#a855f7',manual:'#f59e0b',none:'#f43f5e'};
                            const srcLbl = {standard:'STD',shopify:'SH',smartbill:'SB',manual:'M',none:'?'};
                            const isEditingThis = editingCost[itemSku] !== undefined && itemSku;

                            return (
                              <div key={idx} style={{
                                display:'flex',alignItems:'center',gap:5,
                                padding:'5px 0',
                                borderBottom: idx < items.length-1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                                fontSize:11, flexWrap:'nowrap'
                              }}>
                                {/* SKU badge */}
                                {itemSku && (
                                  <span style={{fontFamily:'monospace',fontSize:9,background:'rgba(249,115,22,.08)',
                                    color:'#f97316',padding:'1px 5px',borderRadius:4,flexShrink:0,whiteSpace:'nowrap'}}>
                                    {itemSku}
                                  </span>
                                )}
                                {/* Nume produs */}
                                <span style={{color:'#94a3b8',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}} title={item.name}>
                                  {item.name}
                                </span>
                                {/* Qty × preț */}
                                <span style={{color:'#475569',whiteSpace:'nowrap',fontSize:10,flexShrink:0}}>
                                  {qty > 1 ? `${qty}×` : ''}{fmt(item.price)} RON
                                </span>
                                {/* Cost achiziție — editabil per SKU */}
                                <div style={{display:'flex',alignItems:'center',gap:3,flexShrink:0}}>
                                  {isEditingThis ? (
                                    <>
                                      <input
                                        type="number" step="0.01"
                                        value={tempCostEdit[itemSku] ?? costUnit}
                                        onChange={e => setTempCostEdit(p=>({...p,[itemSku]:e.target.value}))}
                                        style={{width:65,background:'rgba(16,185,129,.1)',border:'1px solid rgba(16,185,129,.3)',
                                          color:'#10b981',borderRadius:5,padding:'2px 5px',fontSize:11,fontFamily:'monospace',outline:'none'}}
                                        autoFocus
                                      />
                                      <button onClick={()=>{
                                        const newCost = parseFloat(String(tempCostEdit[itemSku]).replace(',','.'));
                                        if (!isNaN(newCost) && newCost >= 0) {
                                          setStdCosts(prev => {
                                            const idx2 = prev.findIndex(s => s.sku === itemSku || s.id === itemSku);
                                            if (idx2 >= 0) {
                                              const updated = [...prev];
                                              updated[idx2] = {...updated[idx2], cost: newCost, updated: new Date().toISOString().slice(0,10)};
                                              localStorage.setItem('glamx_std_costs', JSON.stringify(updated));
                                              return updated;
                                            }
                                            // SKU nou — adaugă în listă
                                            const newEntry = {
                                              id: itemSku, sku: itemSku,
                                              pattern: itemSku.toLowerCase(),
                                              excludes: [], name: item.name, cost: newCost,
                                              updated: new Date().toISOString().slice(0,10)
                                            };
                                            const updated2 = [...prev, newEntry];
                                            localStorage.setItem('glamx_std_costs', JSON.stringify(updated2));
                                            return updated2;
                                          });
                                        }
                                        setEditingCost(p=>{const n={...p};delete n[itemSku];return n;});
                                        setTempCostEdit(p=>{const n={...p};delete n[itemSku];return n;});
                                      }} style={{background:'#10b981',border:'none',color:'white',borderRadius:5,padding:'2px 6px',fontSize:10,cursor:'pointer',fontWeight:700}}>✓</button>
                                      <button onClick={()=>{
                                        setEditingCost(p=>{const n={...p};delete n[itemSku];return n;});
                                        setTempCostEdit(p=>{const n={...p};delete n[itemSku];return n;});
                                      }} style={{background:'transparent',border:'1px solid #334155',color:'#64748b',borderRadius:5,padding:'2px 5px',fontSize:10,cursor:'pointer'}}>✕</button>
                                    </>
                                  ) : (
                                    <>
                                      <span style={{
                                        fontFamily:'monospace',fontSize:10,fontWeight:700,
                                        color: costUnit > 0 ? '#f43f5e' : '#f59e0b',
                                        background: costUnit > 0 ? 'rgba(244,63,94,.08)' : 'rgba(245,158,11,.08)',
                                        padding:'1px 5px',borderRadius:4,whiteSpace:'nowrap'
                                      }}>
                                        -{fmt(costUnit*qty)} RON
                                      </span>
                                      <span style={{fontSize:8,color:srcClr[src]||'#64748b',fontWeight:800,flexShrink:0}}>{srcLbl[src]||'?'}</span>
                                      {itemSku && (
                                        <button
                                          onClick={()=>{
                                            setEditingCost(p=>({...p,[itemSku]:true}));
                                            setTempCostEdit(p=>({...p,[itemSku]:costUnit}));
                                          }}
                                          title={`Editează costul pentru SKU ${itemSku} (se aplică tuturor variantelor)`}
                                          style={{background:'transparent',border:'1px solid #1e2a35',color:'#475569',
                                            borderRadius:4,padding:'1px 4px',fontSize:9,cursor:'pointer',flexShrink:0}}
                                        >✏️</button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Footer profit breakdown */}
                        <div style={{
                          display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',
                          background:'rgba(0,0,0,.25)',
                          borderTop:'1px solid #1a2535',
                          padding:'6px 12px',gap:4
                        }}>
                          {[
                            {label:'Vânzări',  val:fmt(revenue),  clr:'#f97316'},
                            {label:'Cost ach.',val:fmt(cogsPart), clr:'#f43f5e'},
                            {label:'Chelt.',   val:fmt(chelt),    clr:'#f59e0b'},
                            {label:`Profit ${margin.toFixed(0)}%`, val:(profit>=0?'+':'')+fmt(profit), clr:profitClr, bold:true},
                          ].map(({label,val,clr,bold})=>(
                            <div key={label} style={{textAlign:'center'}}>
                              <div style={{fontSize:bold?11:10,fontWeight:bold?800:600,color:clr,fontFamily:'monospace'}}>{val}</div>
                              <div style={{fontSize:9,color:'#475569'}}>{label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {filteredOrders.length === 0 && (
                    <div style={{textAlign:'center',color:'var(--c-text4)',padding:24,fontSize:13}}>
                      Nicio comandă găsită pentru filtrul selectat.
                    </div>
                  )}

                  <div style={{fontSize:10,color:'var(--c-text4)',textAlign:'center',padding:'8px 0',lineHeight:1.7}}>
                    Cheltuieli/comandă: {fmt(transportPerOrder)} transport + {fmt(marketingPerOrder)} marketing + {fmt(fixedPerOrder)} fixe = <strong>{fmt(cheltuieliPerOrder)} RON</strong><br/>
                    STD = standard · SH = Shopify · SB = SmartBill · M = manual · ? = necunoscut<br/>
                    ✏️ Editarea costului unui SKU se aplică automat la toate variantele cu același SKU
                  </div>
                </>
              )}
            </>
          );
        })()}

        {/* ══ PRODUSE ══ */}
        {activeTab === 'products' && (
          <>
            <div className="pf-stitle">Prețuri de achiziție</div>
            <div className="pf-card" style={{marginBottom:10}}>
              <p style={{fontSize:12,color:'var(--c-text3)',marginBottom:12,lineHeight:1.6}}>
                Prețurile tale de achiziție. Au prioritate față de Shopify.
                {costsLastUpdated && <span style={{color:'var(--c-green)',marginLeft:6}}>✓ Actualizat {costsLastUpdated}</span>}
              </p>
              <table className="pf-prod-table">
                <thead><tr><th>SKU</th><th>Produs</th><th style={{width:90,textAlign:'right'}}>Cost RON</th><th style={{width:32}}></th></tr></thead>
                <tbody>
                  {stdCosts.map((s,i) => (
                    <tr key={s.id}>
                      <td style={{color:'var(--c-orange)',fontSize:10,fontFamily:'monospace',whiteSpace:'nowrap'}}>{s.sku||s.id}</td>
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
              <button onClick={()=>setStdCosts(p=>[...p,{id:'new_'+Date.now(),sku:'',pattern:'',excludes:[],name:'Produs nou',cost:0}])} style={{marginTop:8}} className="pf-btn pf-btn-ghost">+ Adaugă produs</button>
            </div>
            <div className="pf-stitle">Import / Export costuri</div>
            <div className="pf-card">
              <div style={{display:'grid',gap:8}}>
                <button className="pf-btn pf-btn-orange" onClick={fetchSmartBillCosts} disabled={sbCostsLoading}
                  style={{background:'linear-gradient(135deg,#10b981,#059669)'}}>
                  {sbCostsLoading ? <><span className="pf-spin">⟳</span> Se sincronizează...</> : '🔄 Sincronizează prețuri din SmartBill (API)'}
                </button>
                <button className="pf-btn pf-btn-ghost" onClick={()=>sbExcelRef.current?.click()}
                  style={{borderColor:'rgba(16,185,129,.4)',color:'#10b981'}}>
                  📊 Import Excel SmartBill (Stoc la zi)
                </button>
                <input ref={sbExcelRef} type="file" accept=".xls,.xlsx" style={{display:'none'}}
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
              <input ref={importCostRef} type="file" accept=".xlsx,.xls" style={{display:'none'}}
                onChange={e=>{
                  const f=e.target.files[0];
                  if(f) parseImportCostXLSX(f, stdCosts,
                    (merged, incoming) => {
                      setStdCosts(merged);
                      localStorage.setItem('glamx_std_costs', JSON.stringify(merged));
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
              <input ref={xlsxImportRef} type="file" accept=".xlsx,.xls" style={{display:'none'}}
                onChange={e=>{const f=e.target.files[0]; if(f) importCostsFromXLSX(f,costs=>{setStdCosts(costs);localStorage.setItem('glamx_std_costs',JSON.stringify(costs));alert(`✅ Importat ${costs.length} produse!`);}); e.target.value='';}} />
            </div>
            {uniqueProducts.length > 0 && (
              <>
                <div className="pf-stitle">Cost rezolvat (din comenzile curente)</div>
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

          // Grupăm pe SKU — dacă SKU e gol, determinăm grupul din stdCosts după pattern pe nume
          // Astfel toate variantele (cu/fără SKU) ajung în același grup
          // resolveGroupKey: aceeasi logica unificata ca resolveCost
          const resolveGroupKey = (item) => {
            const nameRaw = (item.name||'').trim();
            const nameKey = nameRaw.toLowerCase();
            const rawSku  = (item.sku||'').trim();
            const skuKey  = rawSku.toLowerCase();
            const byPatLen = [...stdCosts].sort((a,b)=>(b.pattern||'').length-(a.pattern||'').length);

            // 1. SKU exact
            if (skuKey) {
              const exact = stdCosts.find(s=>(s.sku||s.id||'').toLowerCase()===skuKey);
              if (exact) return { groupKey:(exact.sku||exact.id).toUpperCase(), displayName:exact.name, canonicalSku:exact.sku||exact.id };
            }
            // 2. SKU prefix/suffix
            if (skuKey) {
              const prefix = stdCosts.find(s=>{
                const b=(s.sku||s.id||'').toLowerCase();
                return b.length>=2&&(skuKey===b||skuKey.startsWith(b+'-')||skuKey.startsWith(b+'/')||skuKey.startsWith(b+'_')||skuKey.endsWith('-'+b)||skuKey.endsWith('/'+b));
              });
              if (prefix) return { groupKey:(prefix.sku||prefix.id).toUpperCase(), displayName:prefix.name, canonicalSku:prefix.sku||prefix.id };
            }
            // 3. Pattern match pe nume
            for (const std of byPatLen) {
              const pat=(std.pattern||'').toLowerCase().trim();
              if (!pat||pat.length<3) continue;
              if (nameKey.includes(pat)&&!(std.excludes||[]).some(ex=>nameKey.includes(ex.toLowerCase())))
                return { groupKey:(std.sku||std.id).toUpperCase(), displayName:std.name, canonicalSku:std.sku||std.id };
            }
            // 4. SKU din stdCosts in numele produsului
            for (const std of byPatLen) {
              const sk=(std.sku||std.id||'').toLowerCase();
              if (sk.length>=2&&nameKey.includes(sk))
                return { groupKey:(std.sku||std.id).toUpperCase(), displayName:std.name, canonicalSku:std.sku||std.id };
            }
            // 5. Fuzzy words
            for (const std of byPatLen) {
              const words=(std.pattern||'').toLowerCase().split(/\s+/).filter(w=>w.length>=4);
              if (words.length>=2&&words.every(w=>nameKey.includes(w))&&!(std.excludes||[]).some(ex=>nameKey.includes(ex.toLowerCase())))
                return { groupKey:(std.sku||std.id).toUpperCase(), displayName:std.name, canonicalSku:std.sku||std.id };
            }
            // Fallback
            const fk = rawSku ? rawSku.toUpperCase() : nameRaw.toUpperCase().slice(0,30);
            return { groupKey:fk, displayName:nameRaw||'Necunoscut', canonicalSku:rawSku };
          };

          const skuMap = {};
          deliveredOrders.forEach(order => {
            const itemsInOrder = (order.items || []);
            const totalQtyOrder = itemsInOrder.reduce((s,i) => s + (i.qty||1), 0) || 1;
            itemsInOrder.forEach(item => {
              const { groupKey, displayName, canonicalSku } = resolveGroupKey(item);
              const { cost: costAch } = resolveCost(item);
              const qty  = item.qty || 1;
              const pret = item.price || 0;
              const chelt = (cheltuieliPerOrder / totalQtyOrder) * qty;
              if (!skuMap[groupKey]) skuMap[groupKey] = {
                sku: canonicalSku || groupKey,
                name: displayName,
                costUnit: costAch, hasCost: costAch > 0,
                qty: 0, revenue: 0, cogs: 0, chelt: 0, profit: 0,
                orders: [],
              };
              // Dacă ulterior găsim cost pentru un item care înainte nu avea, actualizăm
              if (!skuMap[groupKey].hasCost && costAch > 0) {
                skuMap[groupKey].hasCost = true;
                skuMap[groupKey].costUnit = costAch;
              }
              skuMap[groupKey].qty     += qty;
              skuMap[groupKey].revenue += pret * qty;
              skuMap[groupKey].cogs    += costAch * qty;
              skuMap[groupKey].chelt   += chelt;
              skuMap[groupKey].profit  += (pret - costAch) * qty - chelt;
              if (!skuMap[groupKey].orders.find(o => o.id === order.id)) {
                skuMap[groupKey].orders.push({ id: order.id, name: order.name||order.id, client: order.client||'', total: order.total||0, date: (order.createdAt||'').slice(0,10) });
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

          const allSkuEntries = Object.values(skuMap).filter(p => p.qty > 0);
          const noCostCount = allSkuEntries.filter(p => !p.hasCost).length;

          const totalRevProd    = sorted.reduce((s,p) => s+p.revenue, 0);
          const totalProfitProd = sorted.reduce((s,p) => s+p.profit, 0);
          const totalQtyProd    = sorted.reduce((s,p) => s+p.qty, 0);
          const uniqueOrderIdsInAnalysis = new Set(sorted.flatMap(p => p.orders.map(o => o.id)));
          const totalOrdersInAnalysis = uniqueOrderIdsInAnalysis.size;

          return (
            <>
              <div className="pf-stitle">Analiză profit per produs (grupat pe SKU)</div>
              {!deliveredOrders.length ? (
                <div className="pf-card" style={{textAlign:'center',color:'var(--c-text4)',padding:24}}>
                  Încarcă comenzile din tab-ul Setări → Shopify mai întâi.
                </div>
              ) : (
                <>
                  <div className="pf-card" style={{marginBottom:8}}>
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
                        Fără cost {noCostCount > 0 && <span style={{color:'#f59e0b',fontWeight:700}}>({noCostCount})</span>}
                      </label>
                    </div>
                    {/* Verificare: comenzile din Analiza = comenzile din Sumar */}
                    {totalOrdersInAnalysis !== totalOrders && (
                      <div style={{background:'rgba(244,63,94,.08)',border:'1px solid rgba(244,63,94,.2)',borderRadius:8,padding:'7px 12px',marginBottom:8,fontSize:11,color:'#f43f5e'}}>
                        ⚠️ Analiză: {totalOrdersInAnalysis} comenzi unice vs {totalOrders} în Sumar — unele comenzi pot lipsi din cauza produselor fără SKU asociat
                      </div>
                    )}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:6}}>
                      {[
                        {label:'Comenzi unice', val:totalOrdersInAnalysis, color:'#f97316', sub:`din ${totalOrders} în sumar`},
                        {label:'Profit total',   val:fmt(totalProfitProd)+' RON', color:'#10b981', sub:`${totalRevProd>0?(totalProfitProd/totalRevProd*100).toFixed(1):0}% marjă`},
                        {label:'Vânzări',        val:fmt(totalRevProd)+' RON', color:'#f97316', sub:'din comenzile livrate'},
                        {label:'Buc vândute',    val:totalQtyProd, color:'#3b82f6', sub:'total produse'},
                      ].map(({label,val,color,sub}) => (
                        <div key={label} style={{background:`rgba(0,0,0,.3)`,borderRadius:8,padding:'8px 10px',textAlign:'center',border:`1px solid ${color}22`}}>
                          <div style={{fontSize:15,fontWeight:800,color}}>{val}</div>
                          <div style={{fontSize:10,color:'var(--c-text4)',marginTop:1}}>{label}</div>
                          <div style={{fontSize:9,color:'#334155',marginTop:1}}>{sub}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {sorted.map((p, idx) => {
                    const isEditingAnalysis = p.sku && editingCost[p.sku] !== undefined;
                    // Costul per unitate curent (din stdCosts dacă a fost editat, altfel p.costUnit)
                    const currentCostUnit = (() => {
                      const entry = stdCosts.find(s => (s.sku||s.id||'').toUpperCase() === (p.sku||'').toUpperCase());
                      return entry ? (typeof entry.cost === 'number' ? entry.cost : parseFloat(entry.cost)||0) : p.costUnit;
                    })();
                    // Recalculăm cu costul curent (poate fi editat)
                    const cogsReal   = currentCostUnit * p.qty;
                    const profitReal = p.revenue - cogsReal - p.chelt;
                    const margin     = p.revenue > 0 ? (profitReal/p.revenue*100) : 0;
                    const profitClr  = profitReal > 0 ? '#10b981' : '#f43f5e';
                    const div        = perUnit ? p.qty : 1;
                    const isOpen     = p.sku && showOrdersSku === p.sku;

                    const saveCostForSku = (skuKey, newCost, itemName) => {
                      setStdCosts(prev => {
                        const idx2 = prev.findIndex(s => (s.sku||s.id||'').toUpperCase() === skuKey.toUpperCase());
                        if (idx2 >= 0) {
                          const updated = [...prev];
                          updated[idx2] = {...updated[idx2], cost: newCost, updated: new Date().toISOString().slice(0,10)};
                          localStorage.setItem('glamx_std_costs', JSON.stringify(updated));
                          return updated;
                        }
                        const newEntry = { id: skuKey, sku: skuKey, pattern: skuKey.toLowerCase(), excludes: [], name: itemName||skuKey, cost: newCost, updated: new Date().toISOString().slice(0,10) };
                        const updated2 = [...prev, newEntry];
                        localStorage.setItem('glamx_std_costs', JSON.stringify(updated2));
                        return updated2;
                      });
                    };

                    return (
                      <div key={p.sku||p.name||idx} style={{background:'#0d1520',border:`1px solid ${isOpen?'rgba(249,115,22,.4)':isEditingAnalysis?'rgba(16,185,129,.35)':'#1e2a35'}`,borderRadius:10,marginBottom:6,overflow:'hidden'}}>
                        <div style={{padding:'12px 14px'}}>
                          {/* Header */}
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                            <span style={{fontSize:10,color:'#334155',minWidth:18}}>#{idx+1}</span>
                            <span style={{fontFamily:'monospace',fontSize:10,background:'rgba(249,115,22,.1)',color:'#f97316',padding:'2px 6px',borderRadius:4,whiteSpace:'nowrap'}}>{p.sku}</span>
                            <span style={{fontSize:12,fontWeight:700,color:'#e8edf2',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</span>
                            <button onClick={()=>setShowOrdersSku(isOpen ? null : p.sku)}
                              style={{background:isOpen?'rgba(249,115,22,.2)':'rgba(255,255,255,.06)',border:`1px solid ${isOpen?'#f97316':'#243040'}`,
                                color:isOpen?'#f97316':'#94a3b8',borderRadius:8,padding:'3px 10px',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
                              {p.qty} buc {isOpen?'▲':'▼'}
                            </button>
                          </div>

                          {/* Bar */}
                          <div style={{height:3,background:'#1e2a35',borderRadius:2,marginBottom:8,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${totalRevProd>0?Math.min(100,p.revenue/totalRevProd*200):0}%`,background:profitReal>0?'#10b981':'#f43f5e',borderRadius:2}}/>
                          </div>

                          {/* Cost achiziție editabil — zona principală */}
                          <div style={{background: isEditingAnalysis?'rgba(16,185,129,.06)':'rgba(255,255,255,.02)', border:`1px solid ${isEditingAnalysis?'rgba(16,185,129,.25)':'rgba(255,255,255,.05)'}`, borderRadius:8, padding:'8px 10px', marginBottom:8}}>
                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                              <div>
                                <div style={{fontSize:9,color:'var(--c-text4)',textTransform:'uppercase',letterSpacing:.5,fontWeight:700,marginBottom:2}}>Cost achiziție / buc</div>
                                {isEditingAnalysis ? (
                                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                                    <input
                                      type="number" step="0.01" autoFocus
                                      value={tempCostEdit[p.sku] ?? currentCostUnit}
                                      onChange={e => setTempCostEdit(prev=>({...prev,[p.sku]:e.target.value}))}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                          const v = parseFloat(String(tempCostEdit[p.sku]).replace(',','.'));
                                          if (!isNaN(v) && v >= 0) saveCostForSku(p.sku, v, p.name);
                                          setEditingCost(prev=>{const n={...prev};delete n[p.sku];return n;});
                                          setTempCostEdit(prev=>{const n={...prev};delete n[p.sku];return n;});
                                        }
                                        if (e.key === 'Escape') {
                                          setEditingCost(prev=>{const n={...prev};delete n[p.sku];return n;});
                                          setTempCostEdit(prev=>{const n={...prev};delete n[p.sku];return n;});
                                        }
                                      }}
                                      style={{width:90,background:'rgba(16,185,129,.12)',border:'1px solid rgba(16,185,129,.4)',color:'#10b981',borderRadius:6,padding:'4px 8px',fontSize:14,fontFamily:'monospace',fontWeight:700,outline:'none'}}
                                    />
                                    <span style={{fontSize:11,color:'#64748b'}}>RON</span>
                                    <button onClick={()=>{
                                      const v = parseFloat(String(tempCostEdit[p.sku]).replace(',','.'));
                                      if (!isNaN(v) && v >= 0) saveCostForSku(p.sku, v, p.name);
                                      setEditingCost(prev=>{const n={...prev};delete n[p.sku];return n;});
                                      setTempCostEdit(prev=>{const n={...prev};delete n[p.sku];return n;});
                                    }} style={{background:'#10b981',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,fontWeight:800,cursor:'pointer'}}>✓ OK</button>
                                    <button onClick={()=>{
                                      setEditingCost(prev=>{const n={...prev};delete n[p.sku];return n;});
                                      setTempCostEdit(prev=>{const n={...prev};delete n[p.sku];return n;});
                                    }} style={{background:'transparent',border:'1px solid #334155',color:'#64748b',borderRadius:6,padding:'4px 8px',fontSize:11,cursor:'pointer'}}>✕</button>
                                  </div>
                                ) : (
                                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                                    <span style={{fontSize:16,fontWeight:800,color: currentCostUnit>0?'#f43f5e':'#f59e0b',fontFamily:'monospace'}}>
                                      {currentCostUnit > 0 ? fmt(currentCostUnit)+' RON' : '— necunoscut'}
                                    </span>
                                    {currentCostUnit > 0 && p.qty > 1 && (
                                      <span style={{fontSize:10,color:'#475569'}}>× {p.qty} = {fmt(cogsReal)} RON total</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {!isEditingAnalysis && (
                                <button
                                  onClick={()=>{
                                    setEditingCost(prev=>({...prev,[p.sku]:true}));
                                    setTempCostEdit(prev=>({...prev,[p.sku]:currentCostUnit}));
                                  }}
                                  style={{background: currentCostUnit>0?'rgba(255,255,255,.06)':'rgba(249,115,22,.15)', border:`1px solid ${currentCostUnit>0?'#243040':'rgba(249,115,22,.4)'}`, color:currentCostUnit>0?'#64748b':'#f97316', borderRadius:8, padding:'6px 12px', fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0}}
                                >
                                  ✏️ {currentCostUnit > 0 ? 'Editează' : 'Adaugă cost'}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* 4 cifre */}
                          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:4}}>
                            {[
                              {lbl:'Vânzări',    val:p.revenue/div,    clr:'#f97316'},
                              {lbl:'Cost ach.',  val:cogsReal/div,     clr:'#f43f5e', hide:currentCostUnit<=0},
                              {lbl:'Cheltuieli', val:p.chelt/div,      clr:'#f59e0b'},
                              {lbl:perUnit?'Profit/buc':`Profit ${margin.toFixed(1)}%`, val:profitReal/div, clr:profitClr, bold:true},
                            ].map(({lbl,val,clr,hide,bold})=>(
                              <div key={lbl} style={{textAlign:'center'}}>
                                <div style={{fontSize:bold?12:11,fontWeight:bold?800:700,color:clr}}>{hide?'—':fmt(val)+' RON'}</div>
                                <div style={{fontSize:9,color:'var(--c-text4)'}}>{lbl}</div>
                              </div>
                            ))}
                          </div>
                          {currentCostUnit <= 0 && <div style={{marginTop:6,fontSize:10,color:'#f59e0b',background:'rgba(245,158,11,.06)',borderRadius:6,padding:'4px 10px'}}>⚠ Apasă "Adaugă cost" pentru a calcula profitul real</div>}
                        </div>

                        {/* Lista comenzilor */}
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
                  📍 Token-ul se găsește în SmartBill → <strong>Contul Meu → Integrări</strong> → secțiunea API.
                </div>
                <button className="pf-btn pf-btn-orange" onClick={saveSbCreds}
                  disabled={!sbEmail||!sbToken||!sbCif}>
                  💾 Salvează credențiale
                </button>
              </div>
            </div>
            <div className="pf-stitle">Shopify</div>
            <div className={`pf-card ${shopifyDone?'done':''}`}>
              <div className="pf-card-header"><span className="pf-card-icon">🛍️</span><span className="pf-card-title">Date comenzi</span><span className={`pf-card-status ${shopifyDone?'ok':''}`}>{shopifyDone?`✓ ${deliveredOrders.length} comenzi livrate`:'Neconectat'}</span></div>
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
                {label:'Colete refuzate (doar transport retur)',val:fmt(totalRefusedCost)+' RON',c:'var(--c-red)'},
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

      {/* ══ MODAL COMENZI ══ */}
      {showOrdersModal && (() => {
        const tpo = totalOrders > 0 ? effectiveTransportCost / totalOrders : 0;
        const mpo = totalOrders > 0 ? totalMarketing / totalOrders : 0;
        const fpo = totalOrders > 0 ? (totalFixed + totalOther) / totalOrders : 0;
        const chelt_po = tpo + mpo + fpo;

        const resolveGroup = (item) => {
          const nameRaw = (item.name||'').trim();
          const nameKey = nameRaw.toLowerCase();
          const rawSku  = (item.sku||'').trim();
          const skuKey  = rawSku.toLowerCase();
          const byPatLen = [...stdCosts].sort((a,b)=>(b.pattern||'').length-(a.pattern||'').length);
          if (skuKey) {
            const exact = stdCosts.find(s => (s.sku||s.id||'').toLowerCase() === skuKey);
            if (exact) return { key:(exact.sku||exact.id).toUpperCase(), name:exact.name, sku:exact.sku||exact.id };
          }
          if (skuKey) {
            const prefix = stdCosts.find(s => {
              const b = (s.sku||s.id||'').toLowerCase();
              return b.length>=2 && (skuKey===b || skuKey.startsWith(b+'-') || skuKey.startsWith(b+'/') || skuKey.startsWith(b+'_') || skuKey.endsWith('-'+b) || skuKey.endsWith('/'+b));
            });
            if (prefix) return { key:(prefix.sku||prefix.id).toUpperCase(), name:prefix.name, sku:prefix.sku||prefix.id };
          }
          for (const s of byPatLen) {
            const p = (s.pattern||'').toLowerCase().trim();
            if (!p || p.length<3) continue;
            if (nameKey.includes(p) && !(s.excludes||[]).some(ex=>nameKey.includes(ex.toLowerCase())))
              return { key:(s.sku||s.id).toUpperCase(), name:s.name, sku:s.sku||s.id };
          }
          for (const s of byPatLen) {
            const sk = (s.sku||s.id||'').toLowerCase();
            if (sk.length>=2 && nameKey.includes(sk))
              return { key:(s.sku||s.id).toUpperCase(), name:s.name, sku:s.sku||s.id };
          }
          for (const s of byPatLen) {
            const words = (s.pattern||'').toLowerCase().split(/\s+/).filter(w=>w.length>=4);
            if (words.length>=2 && words.every(w=>nameKey.includes(w)) && !(s.excludes||[]).some(ex=>nameKey.includes(ex.toLowerCase())))
              return { key:(s.sku||s.id).toUpperCase(), name:s.name, sku:s.sku||s.id };
          }
          const fk = rawSku ? rawSku.toUpperCase() : nameRaw.toUpperCase().slice(0,30);
          return { key:fk||'NECUNOSCUT', name:nameRaw||'Necunoscut', sku:rawSku };
        };

        const resolveModalCost = (item) => {
          const g = resolveGroup(item);
          const skuUp = g.key;
          if (modalEditCost[skuUp] !== undefined) return { cost: parseFloat(modalEditCost[skuUp])||0, src: 'manual' };
          return resolveCost(item);
        };

        const skuMap = {};
        deliveredOrders.forEach(order => {
          const qty_total = (order.items||[]).reduce((s,i)=>s+(i.qty||1),0)||1;
          (order.items||[]).forEach(item => {
            const g = resolveGroup(item);
            const { cost } = resolveModalCost(item);
            const qty = item.qty||1;
            const pret = item.price||0;
            const ch = (chelt_po / qty_total) * qty;
            if (!skuMap[g.key]) skuMap[g.key] = { key:g.key, name:g.name, sku:g.sku, qty:0, revenue:0, cogs:0, chelt:0, profit:0, costUnit:cost, hasCost:cost>0, orders:[] };
            if (!skuMap[g.key].hasCost && cost>0) { skuMap[g.key].hasCost=true; skuMap[g.key].costUnit=cost; }
            skuMap[g.key].qty     += qty;
            skuMap[g.key].revenue += pret*qty;
            skuMap[g.key].cogs    += cost*qty;
            skuMap[g.key].chelt   += ch;
            skuMap[g.key].profit  += (pret-cost)*qty - ch;
            if (!skuMap[g.key].orders.find(o=>o.id===order.id))
              skuMap[g.key].orders.push({ id:order.id, name:order.name||order.id, total:order.total||0, date:(order.createdAt||'').slice(0,10), courier:order.courier||'', items:order.items||[] });
          });
        });

        const skuList = Object.values(skuMap).sort((a,b)=>b.revenue-a.revenue);
        const ordersFiltered = modalSkuFilter
          ? deliveredOrders.filter(o=>(o.items||[]).some(i=>resolveGroup(i).key===modalSkuFilter))
          : deliveredOrders;

        const totalRevM  = skuList.reduce((s,p)=>s+p.revenue,0);
        const totalCogM  = skuList.reduce((s,p)=>s+p.cogs,0);
        const totalChM   = skuList.reduce((s,p)=>s+p.chelt,0);
        const totalProfM = skuList.reduce((s,p)=>s+p.profit,0);
        const noCostSkus = skuList.filter(s=>!s.hasCost).length;

        const saveModalCost = (skuKey, val, name) => {
          const nc = parseFloat(String(val).replace(',','.'));
          if (isNaN(nc)||nc<0) return;
          setModalEditCost(prev=>({...prev,[(skuKey||'').toUpperCase()]:nc}));
          setStdCosts(prev => {
            const idx2 = prev.findIndex(s=>(s.sku||s.id||'').toUpperCase()===(skuKey||'').toUpperCase());
            if (idx2>=0) {
              const u=[...prev]; u[idx2]={...u[idx2],cost:nc,updated:new Date().toISOString().slice(0,10)};
              localStorage.setItem('glamx_std_costs',JSON.stringify(u)); return u;
            }
            const ne={id:skuKey,sku:skuKey,pattern:(skuKey||'').toLowerCase(),excludes:[],name:name||skuKey,cost:nc,updated:new Date().toISOString().slice(0,10)};
            const u2=[...prev,ne]; localStorage.setItem('glamx_std_costs',JSON.stringify(u2)); return u2;
          });
        };

        return (
          <div style={{position:'fixed',inset:0,zIndex:999,display:'flex',flexDirection:'column',background:'#07090e',fontFamily:'system-ui,-apple-system,sans-serif'}}>

            {/* ── HEADER ── */}
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',borderBottom:'1px solid rgba(255,255,255,.07)',background:'rgba(7,9,14,.98)',backdropFilter:'blur(20px)',flexShrink:0}}>
              <button onClick={()=>setShowOrdersModal(false)}
                style={{display:'flex',alignItems:'center',gap:4,background:'rgba(255,255,255,.07)',border:'1px solid rgba(255,255,255,.1)',color:'#94a3b8',borderRadius:8,padding:'7px 11px',fontSize:12,fontWeight:700,cursor:'pointer',flexShrink:0}}>
                ← Înapoi
              </button>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:800,color:'#f1f5f9',letterSpacing:-.3}}>📦 Raport comenzi</div>
                <div style={{fontSize:10,color:'#475569',marginTop:1}}>{totalOrders} livrate · {getRange(preset,customFrom,customTo).from} — {getRange(preset,customFrom,customTo).to}</div>
              </div>
              <div style={{display:'flex',background:'rgba(255,255,255,.06)',borderRadius:8,padding:3,gap:2,flexShrink:0}}>
                {[['sku','SKU'],['orders','Comenzi']].map(([v,l])=>(
                  <button key={v} onClick={()=>{setModalView(v);setModalSkuFilter('');}}
                    style={{padding:'5px 10px',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',border:'none',
                      background:modalView===v?'#f97316':'transparent',
                      color:modalView===v?'white':'#64748b',transition:'all .15s'}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* ── SKU PILLS ── */}
            <div style={{display:'flex',gap:5,padding:'8px 14px',overflowX:'auto',borderBottom:'1px solid rgba(255,255,255,.05)',flexShrink:0,WebkitOverflowScrolling:'touch',scrollbarWidth:'none'}}>
              <button onClick={()=>setModalSkuFilter('')}
                style={{padding:'5px 12px',borderRadius:20,fontSize:10,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',border:'1px solid',flexShrink:0,
                  borderColor:!modalSkuFilter?'#f97316':'rgba(255,255,255,.08)',
                  background:!modalSkuFilter?'rgba(249,115,22,.15)':'rgba(255,255,255,.03)',
                  color:!modalSkuFilter?'#f97316':'#64748b'}}>
                Toate ({totalOrders})
              </button>
              {skuList.map(s=>(
                <button key={s.key} onClick={()=>setModalSkuFilter(modalSkuFilter===s.key?'':s.key)}
                  style={{padding:'5px 12px',borderRadius:20,fontSize:10,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',border:'1px solid',flexShrink:0,
                    borderColor:modalSkuFilter===s.key?'#f97316':'rgba(255,255,255,.08)',
                    background:modalSkuFilter===s.key?'rgba(249,115,22,.15)':'rgba(255,255,255,.03)',
                    color:modalSkuFilter===s.key?'#f97316':'#64748b'}}>
                  {s.sku||s.key} <span style={{opacity:.55}}>({s.orders.length})</span>
                </button>
              ))}
            </div>

            {/* ── CONTENT ── */}
            <div style={{flex:1,overflowY:'auto',WebkitOverflowScrolling:'touch',padding:'10px 14px 100px'}}>

              {/* ════ VIEW SKU ════ */}
              {modalView === 'sku' && (
                <>
                  {/* Sumar 2×2 */}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:10}}>
                    {[
                      {l:'Vânzări',   v:fmt(totalRevM),   c:'#f97316', sub:'RON total'},
                      {l:'Profit net',v:(totalProfM>=0?'+':'')+fmt(totalProfM), c:totalProfM>=0?'#10b981':'#f43f5e', sub:'RON net'},
                      {l:'Cost produse',v:fmt(totalCogM), c:'#f43f5e', sub:'RON achiziție'},
                      {l:'Cheltuieli', v:fmt(totalChM),   c:'#f59e0b', sub:'RON distrib.'},
                    ].map(({l,v,c,sub})=>(
                      <div key={l} style={{background:'#0d1520',border:`1px solid ${c}20`,borderRadius:10,padding:'10px 12px'}}>
                        <div style={{fontSize:11,color:'#475569',marginBottom:3,fontWeight:600}}>{l}</div>
                        <div style={{fontSize:18,fontWeight:800,color:c,fontFamily:'monospace',letterSpacing:-.5,lineHeight:1}}>{v}</div>
                        <div style={{fontSize:9,color:'#334155',marginTop:3}}>{sub}</div>
                      </div>
                    ))}
                  </div>

                  {noCostSkus > 0 && (
                    <div style={{background:'rgba(245,158,11,.07)',border:'1px solid rgba(245,158,11,.2)',borderRadius:8,padding:'8px 12px',marginBottom:8,fontSize:11,color:'#f59e0b',display:'flex',alignItems:'center',gap:6}}>
                      ⚠️ <span><strong>{noCostSkus} SKU</strong> fără cost · tap ✏️ pentru a adăuga</span>
                    </div>
                  )}

                  {/* SKU Cards — mobile optimized */}
                  {(modalSkuFilter ? skuList.filter(s=>s.key===modalSkuFilter) : skuList).map((p, idx) => {
                    const profitClr = p.profit >= 0 ? '#10b981' : '#f43f5e';
                    const margin = p.revenue > 0 ? (p.profit/p.revenue*100) : 0;
                    const isEditingM = modalTempCost[p.key] !== undefined;
                    const currentCost = modalEditCost[(p.key||'').toUpperCase()] ?? p.costUnit;
                    const profitPerCmd = p.orders.length > 0 ? p.profit / p.orders.length : 0;

                    return (
                      <div key={p.key||idx} style={{background:'#0a0f1a',border:`1px solid ${!p.hasCost?'rgba(245,158,11,.25)':'#1a2535'}`,borderRadius:12,marginBottom:8,overflow:'hidden'}}>
                        {/* Card header */}
                        <div style={{display:'flex',alignItems:'center',gap:8,padding:'11px 13px',borderBottom:'1px solid rgba(255,255,255,.04)'}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                              <span style={{fontFamily:'monospace',fontSize:10,background:'rgba(249,115,22,.12)',color:'#f97316',padding:'2px 7px',borderRadius:4,fontWeight:800,flexShrink:0}}>{p.sku||p.key}</span>
                              {!p.hasCost && <span style={{fontSize:8,background:'rgba(245,158,11,.15)',color:'#f59e0b',padding:'1px 5px',borderRadius:3,fontWeight:800,flexShrink:0}}>FĂRĂ COST</span>}
                            </div>
                            <div style={{fontSize:11,color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                          </div>
                          <div style={{textAlign:'right',flexShrink:0}}>
                            <div style={{fontSize:16,fontWeight:900,color:profitClr,fontFamily:'monospace',letterSpacing:-.5}}>{p.profit>=0?'+':''}{fmt(p.profit)}</div>
                            <div style={{fontSize:9,color:'#334155',marginTop:1}}>{margin.toFixed(1)}% marjă</div>
                          </div>
                        </div>

                        {/* Stats row */}
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',borderBottom:'1px solid rgba(255,255,255,.04)'}}>
                          {[
                            {l:'Vânzări',    v:fmt(p.revenue),        c:'#f97316'},
                            {l:'Cost ach.',  v:currentCost>0?fmt(p.cogs):'—', c:'#f43f5e'},
                            {l:'Chelt.',     v:fmt(p.chelt),          c:'#f59e0b'},
                            {l:'Profit/cmd', v:profitPerCmd>=0?'+'+fmt(profitPerCmd):fmt(profitPerCmd), c:profitClr},
                          ].map(({l,v,c})=>(
                            <div key={l} style={{padding:'8px 10px',textAlign:'center',borderRight:'1px solid rgba(255,255,255,.04)'}}>
                              <div style={{fontSize:11,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</div>
                              <div style={{fontSize:8,color:'#334155',marginTop:1,textTransform:'uppercase',letterSpacing:.4}}>{l}</div>
                            </div>
                          ))}
                        </div>

                        {/* Cost edit row */}
                        <div style={{padding:'8px 13px',display:'flex',alignItems:'center',gap:8,justifyContent:'space-between'}}>
                          <div style={{fontSize:10,color:'#475569'}}>
                            {p.orders.length} comenzi · {p.qty} buc
                          </div>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            {isEditingM ? (
                              <>
                                <input type="number" step="0.01" autoFocus
                                  value={modalTempCost[p.key]??currentCost}
                                  onChange={e=>setModalTempCost(prev=>({...prev,[p.key]:e.target.value}))}
                                  onKeyDown={e=>{
                                    if(e.key==='Enter'){saveModalCost(p.sku||p.key,modalTempCost[p.key],p.name);setModalTempCost(prev=>{const n={...prev};delete n[p.key];return n;});}
                                    if(e.key==='Escape'){setModalTempCost(prev=>{const n={...prev};delete n[p.key];return n;});}
                                  }}
                                  style={{width:72,background:'rgba(16,185,129,.12)',border:'1px solid rgba(16,185,129,.4)',color:'#10b981',borderRadius:6,padding:'4px 7px',fontSize:12,fontFamily:'monospace',fontWeight:700,outline:'none',textAlign:'right'}}/>
                                <span style={{fontSize:10,color:'#475569'}}>RON/buc</span>
                                <button onClick={()=>{saveModalCost(p.sku||p.key,modalTempCost[p.key],p.name);setModalTempCost(prev=>{const n={...prev};delete n[p.key];return n;});}}
                                  style={{background:'#10b981',border:'none',color:'white',borderRadius:6,padding:'5px 10px',fontSize:11,fontWeight:800,cursor:'pointer'}}>✓</button>
                                <button onClick={()=>setModalTempCost(prev=>{const n={...prev};delete n[p.key];return n;})}
                                  style={{background:'transparent',border:'1px solid #243040',color:'#475569',borderRadius:6,padding:'5px 8px',fontSize:11,cursor:'pointer'}}>✕</button>
                              </>
                            ) : (
                              <button onClick={()=>setModalTempCost(prev=>({...prev,[p.key]:currentCost}))}
                                style={{display:'flex',alignItems:'center',gap:5,background:currentCost>0?'rgba(255,255,255,.05)':'rgba(245,158,11,.1)',
                                  border:`1px solid ${currentCost>0?'rgba(255,255,255,.08)':'rgba(245,158,11,.3)'}`,
                                  color:currentCost>0?'#64748b':'#f59e0b',borderRadius:7,padding:'5px 10px',fontSize:11,fontWeight:700,cursor:'pointer'}}>
                                ✏️ {currentCost>0?fmt(currentCost)+' RON/buc':'Adaugă cost'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* TOTAL SKU */}
                  <div style={{background:'rgba(16,185,129,.05)',border:'1px solid rgba(16,185,129,.15)',borderRadius:12,padding:'12px 14px',marginTop:4}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                      <div>
                        <div style={{fontSize:10,color:'#475569',marginBottom:2}}>Total vânzări</div>
                        <div style={{fontSize:16,fontWeight:800,color:'#f97316',fontFamily:'monospace'}}>{fmt(totalRevM)} RON</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:10,color:'#475569',marginBottom:2}}>Profit net total</div>
                        <div style={{fontSize:16,fontWeight:800,color:totalProfM>=0?'#10b981':'#f43f5e',fontFamily:'monospace'}}>{totalProfM>=0?'+':''}{fmt(totalProfM)} RON</div>
                      </div>
                      <div>
                        <div style={{fontSize:10,color:'#475569',marginBottom:2}}>Cost produse</div>
                        <div style={{fontSize:14,fontWeight:700,color:'#f43f5e',fontFamily:'monospace'}}>{fmt(totalCogM)} RON</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:10,color:'#475569',marginBottom:2}}>Marjă medie</div>
                        <div style={{fontSize:14,fontWeight:700,color:totalProfM>=0?'#10b981':'#f43f5e'}}>{totalRevM>0?(totalProfM/totalRevM*100).toFixed(1):0}%</div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ════ VIEW COMENZI ════ */}
              {modalView === 'orders' && (
                <>
                  <div style={{fontSize:11,color:'#475569',marginBottom:8,fontWeight:600}}>
                    {ordersFiltered.length} comenzi{modalSkuFilter?` · SKU: ${modalSkuFilter}`:''}
                  </div>

                  {ordersFiltered.map((order) => {
                    const items = order.items||[];
                    const qty_total = items.reduce((s,i)=>s+(i.qty||1),0)||1;
                    const rev   = items.reduce((s,i)=>s+(i.price||0)*(i.qty||1),0);
                    const cg    = items.reduce((s,i)=>s+resolveModalCost(i).cost*(i.qty||1),0);
                    const ch    = chelt_po;
                    const prf   = rev - cg - ch;
                    const prfClr = prf>=0?'#10b981':'#f43f5e';
                    const date  = (order.createdAt||'').slice(0,10).split('-').reverse().join('.');
                    const courierBadge = order.courier==='sameday'?'⚡SD':order.courier==='gls'?'🚚GLS':'📦';

                    return (
                      <div key={order.id} style={{background:'#0a0f1a',border:`1px solid ${prf>=0?'#1a2535':'rgba(244,63,94,.15)'}`,borderRadius:12,marginBottom:6,overflow:'hidden'}}>
                        {/* Order header */}
                        <div style={{display:'flex',alignItems:'center',padding:'9px 12px',borderBottom:'1px solid rgba(255,255,255,.04)'}}>
                          <div style={{flex:1}}>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <span style={{fontSize:12,fontWeight:800,color:'#f97316',fontFamily:'monospace'}}>{order.name}</span>
                              <span style={{fontSize:9,color:'#334155',background:'rgba(255,255,255,.04)',padding:'1px 5px',borderRadius:3}}>{courierBadge}</span>
                              <span style={{fontSize:9,color:'#334155'}}>{date}</span>
                            </div>
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontSize:13,fontWeight:800,color:prfClr,fontFamily:'monospace'}}>{prf>=0?'+':''}{fmt(prf)}</div>
                            <div style={{fontSize:9,color:'#334155'}}>{fmt(rev)} vânzări</div>
                          </div>
                        </div>

                        {/* Products */}
                        <div style={{padding:'6px 12px 4px'}}>
                          {items.map((item,ii) => {
                            const g = resolveGroup(item);
                            const {cost:ic, src} = resolveModalCost(item);
                            const isEditingItem = modalTempCost[g.key] !== undefined;
                            const qty = item.qty||1;
                            return (
                              <div key={ii} style={{display:'flex',alignItems:'center',gap:6,padding:'4px 0',borderBottom:ii<items.length-1?'1px solid rgba(255,255,255,.03)':'none'}}>
                                <span style={{fontFamily:'monospace',fontSize:9,background:'rgba(249,115,22,.08)',color:'#f97316',padding:'1px 4px',borderRadius:3,flexShrink:0}}>{g.sku||g.key.slice(0,8)}</span>
                                <span style={{fontSize:10,color:'#64748b',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={item.name}>{item.name}</span>
                                {qty>1&&<span style={{fontSize:9,color:'#334155',flexShrink:0}}>×{qty}</span>}
                                {isEditingItem ? (
                                  <div style={{display:'flex',alignItems:'center',gap:3,flexShrink:0}}>
                                    <input type="number" step="0.01" autoFocus
                                      value={modalTempCost[g.key]??ic}
                                      onChange={e=>setModalTempCost(prev=>({...prev,[g.key]:e.target.value}))}
                                      onKeyDown={e=>{
                                        if(e.key==='Enter'){saveModalCost(g.sku||g.key,modalTempCost[g.key],g.name);setModalTempCost(prev=>{const n={...prev};delete n[g.key];return n;});}
                                        if(e.key==='Escape'){setModalTempCost(prev=>{const n={...prev};delete n[g.key];return n;});}
                                      }}
                                      style={{width:52,background:'rgba(16,185,129,.12)',border:'1px solid rgba(16,185,129,.4)',color:'#10b981',borderRadius:4,padding:'2px 4px',fontSize:10,fontFamily:'monospace',outline:'none',textAlign:'right'}}/>
                                    <button onClick={()=>{saveModalCost(g.sku||g.key,modalTempCost[g.key],g.name);setModalTempCost(prev=>{const n={...prev};delete n[g.key];return n;});}} style={{background:'#10b981',border:'none',color:'white',borderRadius:4,padding:'2px 6px',fontSize:9,fontWeight:800,cursor:'pointer'}}>✓</button>
                                    <button onClick={()=>setModalTempCost(prev=>{const n={...prev};delete n[g.key];return n;})} style={{background:'transparent',border:'1px solid #243040',color:'#475569',borderRadius:4,padding:'2px 4px',fontSize:9,cursor:'pointer'}}>✕</button>
                                  </div>
                                ) : (
                                  <span onClick={()=>setModalTempCost(prev=>({...prev,[g.key]:ic||''}))}
                                    style={{fontSize:9,fontWeight:800,flexShrink:0,cursor:'pointer',padding:'2px 6px',borderRadius:3,userSelect:'none',
                                      color:ic>0?'#10b981':'white',
                                      background:ic>0?'rgba(16,185,129,.1)':'#ef4444',
                                      border:`1px solid ${ic>0?'rgba(16,185,129,.25)':'#dc2626'}`}}>
                                    {ic>0?fmt(ic):'✏️?'}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Footer P&L */}
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',background:'rgba(0,0,0,.2)',borderTop:'1px solid rgba(255,255,255,.04)',padding:'6px 12px',gap:4}}>
                          {[
                            {l:'Vânzări',  v:fmt(rev),       c:'#f97316'},
                            {l:'Cost',     v:fmt(cg),        c:'#f43f5e'},
                            {l:'Chelt.',   v:fmt(ch),        c:'#f59e0b'},
                            {l:`${rev>0?(prf/rev*100).toFixed(0):0}% profit`, v:(prf>=0?'+':'')+fmt(prf), c:prfClr, bold:true},
                          ].map(({l,v,c,bold})=>(
                            <div key={l} style={{textAlign:'center'}}>
                              <div style={{fontSize:bold?11:10,fontWeight:bold?800:600,color:c,fontFamily:'monospace'}}>{v}</div>
                              <div style={{fontSize:8,color:'#334155',marginTop:1}}>{l}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* Total comenzi */}
                  {(() => {
                    const totR = ordersFiltered.reduce((s,o)=>{return s+(o.items||[]).reduce((ss,i)=>ss+(i.price||0)*(i.qty||1),0);},0);
                    const totC = ordersFiltered.reduce((s,o)=>{return s+(o.items||[]).reduce((ss,i)=>ss+resolveModalCost(i).cost*(i.qty||1),0);},0);
                    const totCh = ordersFiltered.length * chelt_po;
                    const totP = totR - totC - totCh;
                    return (
                      <div style={{background:'rgba(16,185,129,.05)',border:'1px solid rgba(16,185,129,.15)',borderRadius:12,padding:'12px 14px',marginTop:4}}>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                          <div>
                            <div style={{fontSize:10,color:'#475569',marginBottom:2}}>{ordersFiltered.length} comenzi · vânzări</div>
                            <div style={{fontSize:16,fontWeight:800,color:'#f97316',fontFamily:'monospace'}}>{fmt(totR)} RON</div>
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontSize:10,color:'#475569',marginBottom:2}}>Profit net total</div>
                            <div style={{fontSize:16,fontWeight:800,color:totP>=0?'#10b981':'#f43f5e',fontFamily:'monospace'}}>{totP>=0?'+':''}{fmt(totP)} RON</div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        );
      })()}

      <div className="pf-save-bar">
        <button className="pf-save-btn" onClick={saveSettings}>💾 Salvează</button>
      </div>
    </>
  );
}


