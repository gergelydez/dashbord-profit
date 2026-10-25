'use client';
/**
 * app/statistici-totale/page.js — Statistici Totale
 *
 * Agregă TOATE magazinele Shopify (ro/hu/glato/glatohu, din DB — vezi
 * /api/stats-totale) + eMAG (din import local, app/emag/page.js) într-un
 * singur tabel lunar/anual, filtrabil pe magazin și interval: nr. comenzi,
 * valoare, încasat COD (ramburs livrat), încasat Card (Shopify Payments/
 * Stripe/PayPal), retururi, facturate/nefacturate.
 *
 * Pentru comenzile eMAG fără factură (eMAG nu trece prin pipeline-ul nostru
 * de facturare) oferă o verificare în SmartBill prin exportul XLS — același
 * mecanism dovedit deja de pe pagina Comenzi (/api/smartbill/search), doar
 * că potrivirea se face după nume client + total, fiindcă numărul comenzii
 * eMAG nu apare în observațiile facturii create manual.
 *
 * Nu amestecă monede diferite într-un singur total — fiecare magazin/bucket
 * își ține propria monedă (RON sau HUF), iar un total "general" e per monedă.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { samedayAwbKind } from '@/lib/couriers/sameday-awb-kind';

const ls = {
  get: k => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') localStorage.setItem(k, v); } catch {} },
};

const fmt = n => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = n => Number(n || 0).toLocaleString('ro-RO');

const SHOP_META = {
  ro:             { label: 'Romania',   flag: '🇷🇴', color: '#f97316' },
  hu:             { label: 'Ungaria',   flag: '🇭🇺', color: '#3b82f6' },
  glato:          { label: 'Glato',     flag: '🛍️', color: '#a855f7' },
  glatohu:        { label: 'Glato HU',  flag: '🛍️', color: '#ec4899' },
  emag:           { label: 'eMAG',      flag: '🛒', color: '#eab308' },
  neatribuit_posibil: { label: 'Posibil dintr-un magazin', flag: '📡', color: '#f59e0b' },
  neatribuit_manual:  { label: 'Manual / telefonic',       flag: '📞', color: '#64748b' },
  necunoscut:     { label: 'Necunoscut', flag: '❓', color: '#64748b' },
};
const SHOP_ORDER = ['ro', 'hu', 'glato', 'glatohu', 'emag', 'neatribuit_posibil', 'neatribuit_manual', 'necunoscut'];

const STATUS_META = {
  delivered: { label: 'Livrată',         color: '#10b981' },
  returned:  { label: 'Refuzată (retur)', color: '#f43f5e' },
  transit:   { label: 'Tranzit',          color: '#f59e0b' },
  cancelled: { label: 'Anulată',          color: '#64748b' },
  no_awb:    { label: 'Fără AWB',         color: '#475569' },
  no_status: { label: 'Fără status (neridicat?)', color: '#475569' },
};
const STATUS_ORDER = ['delivered', 'returned', 'transit', 'cancelled', 'no_awb', 'no_status'];

const COURIER_META = {
  gls:     { label: 'GLS',      color: '#3b82f6' },
  sameday: { label: 'Sameday',  color: '#a855f7' },
  none:    { label: 'Fără AWB', color: '#475569' },
};
const COURIER_ORDER = ['gls', 'sameday', 'none'];
function courierKey(o) { return o.courier || 'none'; }
/** Aceeași regulă deja folosită de <StatusBadge> — ținută separat ca să poată
 * fi filtrată, nu doar afișată. */
function orderStatusKey(o) {
  if (o.cancelled) return 'cancelled';
  if (o.returned) return 'returned';
  if (o.delivered) return 'delivered';
  if (o.courier) return 'transit';
  return 'no_awb';
}
/** Un colet GLS fără NICIUN status la tracking (nu doar "încă în tranzit",
 * zero istoric) e aproape sigur o etichetă tipărită dar anulată/înlocuită cu
 * alta înainte de ridicare — ex. comanda #1046 descoperită anterior, cu 2
 * AWB-uri diferite (primul eșuat/neridicat, al doilea reluat cu succes).
 * GetParcelList (de unde vine lista) întoarce TOATE etichetele tipărite,
 * inclusiv cele niciodată ridicate — contate implicit la "Tranzit" ar umfla
 * artificial totalul. Categorie separată, exclusă din filtrul implicit. */
function glsDetailStatusKey(p) {
  if (p.returned) return 'returned';
  if (p.delivered) return 'delivered';
  if (p.hasStatus === false) return 'no_status';
  return 'transit';
}

/** Numărul de comenzi care chiar trec de filtrele Status/Curier, pentru
 * rândul unui magazin — dar DOAR după ce a fost expandat măcar o dată (până
 * atunci nu avem detaliul per comandă, deci rămânem pe totalul din bază —
 * vezi `b.orders` la locul de apel). Fără asta, numărul afișat pe rândul
 * încă nedesfăcut ("85 comenzi") nu se potrivea cu ce rămânea vizibil după
 * ce dădeai click și vedeai filtrul aplicat (ex. "63 din 85 afișate"). */
function filteredCountFor(exp, statusFilter, courierFilter) {
  if (!exp || exp.loading || exp.error || !exp.rows) return null;
  if (exp.kind === 'order') {
    return exp.rows.filter(o => statusFilter.has(orderStatusKey(o)) && courierFilter.has(courierKey(o))).length;
  }
  if (exp.kind === 'gls_detail') {
    if (!courierFilter.has('gls')) return 0;
    return exp.rows.filter(p => statusFilter.has(glsDetailStatusKey(p))).length;
  }
  // eMAG: numărul de pe rând rămâne cel din Sameday (b.orders) — importul local poate avea mai puține comenzi
  if (exp.kind === 'emag') return null;
  return null;
}

/** Comenzile unui curier (GLS sau Sameday), adunate din TOATE magazinele
 * unei perioade — ce stă în spatele rândurilor "📦 GLS TOTAL"/"🚀 SAMEDAY
 * TOTAL" (vizibile înainte să desfaci vreun magazin, din cache-ul deja
 * pre-încărcat — vezi efectul de prefetch mai sus). Colete GLS neatribuite
 * (posibil/manual) intră și ele la GLS, fiindcă chiar sunt colete GLS. */
function rowsForCourier(period, shopsInPeriod, courier, orderCache, liveGlsDetails, statusFilter, samedayLive) {
  const out = [];
  for (const shopKey of shopsInPeriod) {
    if (shopKey === 'neatribuit_posibil' || shopKey === 'neatribuit_manual') {
      if (courier !== 'gls') continue;
      const rows = liveGlsDetails?.[period]?.[shopKey] || [];
      for (const p of rows) {
        if (!statusFilter.has(glsDetailStatusKey(p))) continue;
        out.push({ _kind: 'gls_detail', _shopKey: shopKey, ...p });
      }
      continue;
    }
    if (shopKey === 'emag' || shopKey === 'necunoscut') continue;
    const exp = orderCache[`${period}|${shopKey}`];
    if (!exp?.rows) continue;
    for (const o of exp.rows) {
      if (!statusFilter.has(orderStatusKey(o))) continue;
      if (courierKey(o) !== courier) continue;
      out.push({ _kind: 'order', _shopKey: shopKey, ...o });
    }
  }
  // Colete Sameday văzute live în cont (vezi fetchEmagSameday): eMAG și
  // retururi de la clienți (1ONBLR). Fără status per colet (status-sync dă
  // doar AWB-ul), deci nu trec prin filtrul de status.
  //
  // "live.shop" (colete cu prefix de magazin, dar nepotrivite cu nicio
  // comandă din bază — "fără comandă") NU se mai afișează deloc: status-sync
  // nu dă nicio dată/referință per AWB, deci pentru astea nu există vreun
  // mod de a confirma dacă sunt cu adevărat dintr-un magazin sau pur și
  // simplu AWB-uri vechi/de test fără nicio legătură — rămâneau agățate la
  // infinit, lună de lună, fără să poată fi asociate vreodată. Sursa
  // corectă pentru numărul real Sameday e exportul AWB importat (vezi
  // panoul "🚀 Sameday — import export AWB" de mai jos), care chiar are
  // referința comenzii.
  const live = courier === 'sameday' ? samedayLive?.[period] : null;
  if (live) {
    for (const awb of live.emag) out.push({ _kind: 'sd_parcel', _shopKey: 'emag', parcelNumber: awb, sdKind: 'emag' });
    for (const awb of live.client_return) out.push({ _kind: 'sd_parcel', _shopKey: 'retur', parcelNumber: awb, sdKind: 'client_return' });
  }
  return out;
}

const SD_KIND_LABEL = { emag: '🛒 eMAG', shop: '📞 Fără comandă', client_return: '↩ Retur client' };
const MONTH_NAMES = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];
const pad2 = n => String(n).padStart(2, '0');

/** Bară de filtrare asemănătoare cu pagina Comenzi: presetări rapide +
 * (separat, în pagină) un dropdown An + Lună pentru o lună calendaristică
 * exactă. */
function getRange(preset, pickYear, pickMonth) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const toISO = dt => dt.toISOString().slice(0, 10);
  switch (preset) {
    case 'last_7':      return { from: toISO(new Date(y, m, d - 6)), to: toISO(now) };
    case 'last_30':     return { from: toISO(new Date(y, m, d - 29)), to: toISO(now) };
    case 'month':       return { from: `${y}-${pad2(m + 1)}-01`, to: toISO(now) };
    case 'last_month':  { const lm = new Date(y, m, 0); return { from: `${lm.getFullYear()}-${pad2(lm.getMonth() + 1)}-01`, to: toISO(lm) }; }
    case 'year_to_date': return { from: `${y}-01-01`, to: toISO(now) };
    case 'exact_month': { const mEnd = new Date(pickYear, pickMonth, 0); return { from: `${pickYear}-${pad2(pickMonth)}-01`, to: toISO(mEnd) }; }
    default:            return { from: toISO(new Date(y, m, d - 29)), to: toISO(now) };
  }
}
const PRESETS = [
  { id: 'last_7', label: '7 zile' },
  { id: 'last_30', label: '30 zile' },
  { id: 'month', label: 'Luna asta' },
  { id: 'last_month', label: 'Luna trecută' },
  { id: 'year_to_date', label: 'Anul acesta' },
];

function periodToRange(periodKey, granularity) {
  if (granularity === 'year') return { from: `${periodKey}-01-01`, to: `${periodKey}-12-31` };
  const [y, m] = periodKey.split('-');
  const mEnd = new Date(Number(y), Number(m), 0);
  return { from: `${periodKey}-01`, to: mEnd.toISOString().slice(0, 10) };
}

function emptyBucket() {
  return { orders: 0, cancelled: 0, valoare: 0, codIncasat: 0, codNeincasat: 0, codFaraAwb: 0, cardIncasat: 0, retururi: 0, facturate: 0, nefacturate: 0, awbCreate: 0 };
}
function addBucket(a, b) {
  for (const k of Object.keys(a)) a[k] += b[k] || 0;
  return a;
}

const stripDiacritics = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** eMAG nu ne spune direct "ramburs vs card" structurat — citim din "Mod plata"
 * (coloana reală din exportul eMAG), best-effort: conține "card"/"online" → card. */
function emagIsOnline(payMode) {
  const p = stripDiacritics(payMode);
  return p.includes('card') || p.includes('online');
}
function emagIsReturned(status) {
  return stripDiacritics(status).includes('retur');
}
function emagIsCancelled(status) {
  const s = stripDiacritics(status);
  return s.includes('anulat') || s.includes('cancel') || s.includes('refuzat');
}

/** eMAG "Data comenzii" vine "2026-09-18 09:57:42" — extragem YYYY-MM / YYYY. */
function emagMonthKey(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function loadXLSXLib() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Nu s-a putut încărca XLSX.'));
    document.head.appendChild(s);
  });
}

/** Rulează fn pe fiecare item, max `limit` în paralel — nu tot deodată (ar
 * supraîncărca API-ul extern), dar nici strict secvențial, unul câte unul
 * (prea lent pentru sute de cereri, ex. statusul de livrare al unui an
 * întreg de AWB-uri). */
async function mapWithConcurrency(items, limit, fn) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Împarte [from,to] în bucăți lunare (sau mai scurte la capete) — MyGLS
 * nu are o limită documentată de interval, dar tragem lună cu lună oricum ca
 * să putem atribui fiecare colet lunii lui reale (din PickupDate). */
function monthRanges(from, to) {
  const ranges = [];
  let cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    const y = cur.getFullYear(), m = cur.getMonth();
    const monthStart = new Date(y, m, 1);
    const monthEnd = new Date(y, m + 1, 0);
    const rangeFrom = monthStart < new Date(`${from}T00:00:00`) ? from : monthStart.toISOString().slice(0, 10);
    const rangeTo = monthEnd > end ? to : monthEnd.toISOString().slice(0, 10);
    ranges.push({ key: `${y}-${String(m + 1).padStart(2, '0')}`, from: rangeFrom, to: rangeTo });
    cur = new Date(y, m + 1, 1);
  }
  return ranges;
}

/** Un AWB GLS neatribuit niciunui magazin conectat: dacă referința arată ca
 * un nume de comandă Shopify ("#1234" sau pur numeric) dar nu s-a potrivit
 * cu nimic din magazinele conectate în interval, comanda cel mai probabil
 * chiar există — "posibil dintr-un magazin" (sincronizare/potrivire ratată).
 * O referință fără acest format (text liber, sau complet goală) e aproape
 * sigur un AWB creat manual din pagina GLS, pentru un client care a
 * comandat telefonic (vezi app/gls/page.js, fluxul „Etichetă manuală" —
 * acolo referința e un text liber introdus de operator, nu un nume Shopify). */
function classifyUnmatchedGlsRef(ref) {
  const r = (ref || '').trim();
  if (!r) return 'neatribuit_manual';
  return /^#?\d+$/.test(r) ? 'neatribuit_posibil' : 'neatribuit_manual';
}

function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(c => {
    const s = String(c ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function StatisticiTotalePage() {
  const [serverData, setServerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [preset, setPreset] = useState('last_30');
  const [pickYear, setPickYear] = useState(() => new Date().getFullYear());
  const [pickMonth, setPickMonth] = useState(() => new Date().getMonth() + 1);
  const [from, setFrom] = useState(() => getRange('last_30').from);
  const [to, setTo]     = useState(() => getRange('last_30').to);
  const [granularity, setGranularity] = useState('month'); // 'month' | 'year'
  const [activeShops, setActiveShops] = useState(() => new Set(SHOP_ORDER));
  const [shopDropdownOpen, setShopDropdownOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState(() => new Set(['delivered', 'returned', 'transit']));
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [courierFilter, setCourierFilter] = useState(() => new Set(COURIER_ORDER));
  const [courierDropdownOpen, setCourierDropdownOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null); // fereastra de detaliu comandă (vezi OrderDetailModal)
  const [orderCache, setOrderCache] = useState({}); // `${period}|${shopKey}` -> { loading, kind, rows, error } — cache INDEPENDENT de UI (vezi loadRow), ca totalurile GLS/Sameday pe lună să poată fi calculate chiar înainte să dai click pe un magazin
  const [openRows, setOpenRows] = useState(() => new Set()); // care rânduri magazin sunt desfăcute vizual
  const loadingKeysRef = useRef(new Set()); // deduplichează fetch-urile pentru aceeași cheie (prefetch + click simultan)

  const [emagOrders, setEmagOrders] = useState([]);
  const [sbChecking, setSbChecking] = useState(false);
  const [sbResults, setSbResults] = useState(null); // { found: n, notFound: n }

  // ── Volum real MyGLS (live) — vezi fetchLiveGls mai jos ──
  const [liveGls, setLiveGls] = useState(null); // periods[monthKey][shopKey|'neatribuit_posibil'|'neatribuit_manual'] = bucket
  const [liveGlsLoading, setLiveGlsLoading] = useState(false);
  const [liveGlsProgress, setLiveGlsProgress] = useState(null); // { done, total }
  const [liveGlsError, setLiveGlsError] = useState('');
  const [liveGlsSummary, setLiveGlsSummary] = useState(null); // { totalParcels, matched, unmatched }
  const [liveGlsDetails, setLiveGlsDetails] = useState({}); // [period][neatribuit_*] -> [{ref,parcelNumber,name,city,cod,...}]

  // ── eMAG — numărul EXACT de comenzi pe lună, citit din Sameday (nu din
  // importul local) — vezi fetchEmagSameday mai jos ──
  const [emagSameday, setEmagSameday] = useState(null); // { [periodKey]: count }
  const [samedayLive, setSamedayLive] = useState(null); // { [periodKey]: { emag: [], client_return: [], shop: [] } } — AWB-uri din contul Sameday
  const [emagSamedayLoading, setEmagSamedayLoading] = useState(false);
  const [emagSamedayProgress, setEmagSamedayProgress] = useState(null);
  const [emagSamedayError, setEmagSamedayError] = useState('');

  // ── Sincronizare completă în DB (Shopify live → Order + Shipment, GLS+Sameday) ──
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null); // { done, total }
  const [syncError, setSyncError] = useState('');
  const [syncSummary, setSyncSummary] = useState(null);

  // ── Import export AWB Sameday (persistat în DB — vezi SamedayAwbImport) ──
  const [samedayImportRows, setSamedayImportRows] = useState([]);
  const [samedayImportMonthsCovered, setSamedayImportMonthsCovered] = useState([]);
  const [samedayImportLoading, setSamedayImportLoading] = useState(false);
  const [samedayImportUploading, setSamedayImportUploading] = useState(false);
  const [samedayImportError, setSamedayImportError] = useState('');
  const [samedayImportResult, setSamedayImportResult] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError('');
    fetch(`/api/stats-totale?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setServerData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  // Datele live MyGLS sunt legate de intervalul [from,to] cerut la acel
  // moment — dacă utilizatorul schimbă intervalul fără să le re-tragă,
  // le ștergem ca să nu rămână suprapuse peste o perioadă greșită.
  useEffect(() => { setLiveGls(null); setLiveGlsSummary(null); setLiveGlsDetails({}); setEmagSameday(null); setSamedayLive(null); setEmagSamedayError(''); }, [from, to]);
  useEffect(() => { setOrderCache({}); setOpenRows(new Set()); loadingKeysRef.current = new Set(); }, [from, to, granularity]);
  // Coletele "neatribuit_*" cache-uite vin din liveGlsDetails (în memorie, nu
  // din rețea) — când se termină o nouă tragere live MyGLS, cache-ul vechi
  // (eventual gol, dacă nu rulase încă pull-ul) trebuie invalidat ca
  // totalurile GLS/Sameday și rândurile neatribuite să se recalculeze.
  useEffect(() => {
    setOrderCache(prev => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.endsWith('|neatribuit_posibil') || key.endsWith('|neatribuit_manual')) { delete next[key]; changed = true; }
      }
      return changed ? next : prev;
    });
    for (const key of Array.from(loadingKeysRef.current)) {
      if (key.endsWith('|neatribuit_posibil') || key.endsWith('|neatribuit_manual')) loadingKeysRef.current.delete(key);
    }
  }, [liveGlsDetails]);

  useEffect(() => {
    try { setEmagOrders(JSON.parse(ls.get('emag_orders') || '[]')); } catch { setEmagOrders([]); }
  }, []);

  const toggleShop = (key) => setActiveShops(prev => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const applyPreset = (id) => {
    setPreset(id);
    const r = getRange(id, pickYear, pickMonth);
    setFrom(r.from); setTo(r.to);
  };
  const applyExactMonth = (year, month) => {
    setPickYear(year); setPickMonth(month); setPreset('exact_month');
    const r = getRange('exact_month', year, month);
    setFrom(r.from); setTo(r.to);
  };

  // Încarcă (o singură dată, cache-uit) comenzile pentru un rând magazin —
  // SEPARAT de deschiderea vizuală a rândului (vezi toggleExpand), ca să
  // putem pre-încărca datele pentru toate magazinele dintr-o lună (pentru
  // totalurile "GLS TOTAL"/"SAMEDAY TOTAL" de mai jos) fără să fim nevoiți
  // să le afișăm desfăcute.
  const loadRow = useCallback(async (period, shopKey) => {
    const key = `${period}|${shopKey}`;
    if (loadingKeysRef.current.has(key)) return;
    loadingKeysRef.current.add(key);
    setOrderCache(prev => ({ ...prev, [key]: { loading: true } }));

    if (shopKey === 'emag') {
      const rows = emagOrders.filter(o => {
        const mk = emagMonthKey(o.date);
        return granularity === 'year' ? mk?.startsWith(period) : mk === period;
      });
      setOrderCache(prev => ({ ...prev, [key]: { loading: false, kind: 'emag', rows } }));
      return;
    }
    if (shopKey === 'neatribuit_posibil' || shopKey === 'neatribuit_manual') {
      const rows = liveGlsDetails?.[period]?.[shopKey] || [];
      setOrderCache(prev => ({ ...prev, [key]: { loading: false, kind: 'gls_detail', rows } }));
      return;
    }
    if (shopKey === 'necunoscut') {
      setOrderCache(prev => ({ ...prev, [key]: { loading: false, kind: 'order', rows: [] } }));
      return;
    }
    // magazin real (ro/hu/glato/glatohu) — comenzi din baza noastră, vezi /api/stats-totale/order-list
    try {
      const range = periodToRange(period, granularity);
      const res = await fetch('/api/stats-totale/order-list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: shopKey, from: range.from, to: range.to }),
      }).then(r => r.json());
      if (res.ok) setOrderCache(prev => ({ ...prev, [key]: { loading: false, kind: 'order', rows: res.orders } }));
      else setOrderCache(prev => ({ ...prev, [key]: { loading: false, error: res.error || 'Eroare necunoscută' } }));
    } catch (e) {
      setOrderCache(prev => ({ ...prev, [key]: { loading: false, error: e.message } }));
    }
  }, [emagOrders, granularity, liveGlsDetails]);

  const toggleExpand = (period, shopKey) => {
    const key = `${period}|${shopKey}`;
    setOpenRows(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
    if (!orderCache[key]) loadRow(period, shopKey);
  };

  // ── Combină serverData (ro/hu/glato/glatohu) + emagOrders (local) într-o
  // singură structură: periods[periodKey][shopKey] = bucket. periodKey e
  // lunar (YYYY-MM) sau anual (YYYY), în funcție de `granularity`.
  const { periods, shopCurrency, shopTotals, periodKeysSorted } = useMemo(() => {
    const periods = {};
    const shopCurrency = { ...(serverData?.shopCurrency || {}) };
    const bump = (periodKey, shopKey, partial) => {
      if (!periods[periodKey]) periods[periodKey] = {};
      if (!periods[periodKey][shopKey]) periods[periodKey][shopKey] = emptyBucket();
      addBucket(periods[periodKey][shopKey], partial);
    };
    const toPeriodKey = (monthKey) => granularity === 'year' ? monthKey.slice(0, 4) : monthKey;

    if (serverData?.months) {
      for (const [monthKey, byShop] of Object.entries(serverData.months)) {
        for (const [shopKey, bucket] of Object.entries(byShop)) {
          bump(toPeriodKey(monthKey), shopKey, bucket);
        }
      }
    }

    // eMAG — agregăm din localStorage, cu aceeași formă de bucket.
    shopCurrency.emag = 'RON';
    for (const o of emagOrders) {
      const monthKey = emagMonthKey(o.date);
      if (!monthKey) continue;
      if (monthKey < from.slice(0, 7) || monthKey > to.slice(0, 7)) continue;
      const total = (o.products || []).reduce((s, p) => s + (p.price || 0) * (p.qty || 1), 0);
      const cancelled = emagIsCancelled(o.status);
      const returned = emagIsReturned(o.status);
      const online = emagIsOnline(o.payMode);
      const hasInvoice = !!o.invoiceNumber;
      const b = emptyBucket();
      b.orders = 1;
      if (cancelled) { b.cancelled = 1; bump(toPeriodKey(monthKey), 'emag', b); continue; }
      b.valoare = total;
      if (returned) b.retururi = 1;
      if (o.awb) b.awbCreate = 1;
      if (hasInvoice) b.facturate = 1; else b.nefacturate = 1;
      if (online) b.cardIncasat = total;
      else if (!returned) b.codIncasat = total; // eMAG predă AWB-ul fulfilled de ei — considerăm încasat dacă nu-i retur
      bump(toPeriodKey(monthKey), 'emag', b);
    }

    // Volum real MyGLS (live, din fetchLiveGls) — folosit DOAR pentru
    // rândurile pseudo-magazin ("neatribuit_posibil"/"neatribuit_manual"),
    // care n-au niciun echivalent în DB. Pentru magazinele REALE (ro/hu/
    // glato/glatohu), NU mai suprascriem bucket-ul din DB cu subsetul
    // GLS-matched — o comandă poate fi expediată și prin Sameday, iar
    // suprascrierea cu "doar ce a găsit GLS" ascundea silențios acele
    // comenzi (ex. "63 comenzi (din 48)" — numărul "complet" afișat ieșea
    // mai mic decât numărul filtrat, vizibil absurd). Acum că sync-orders +
    // arhiva GLS/Sameday țin DB-ul complet pentru ambii curieri, DB-ul e
    // sursa corectă pentru magazinele reale.
    const REAL_SHOP_KEYS = new Set(['ro', 'hu', 'glato', 'glatohu']);
    if (liveGls) {
      for (const [period, byShop] of Object.entries(liveGls)) {
        for (const [shopKey, liveBucket] of Object.entries(byShop)) {
          if (REAL_SHOP_KEYS.has(shopKey)) continue;
          if (!periods[period]) periods[period] = {};
          if (!periods[period][shopKey]) periods[period][shopKey] = emptyBucket();
          const target = periods[period][shopKey];
          target.orders = liveBucket.orders;
          target.awbCreate = liveBucket.awbCreate;
          target.codIncasat = liveBucket.codIncasat;
          target.codNeincasat = liveBucket.codNeincasat;
          target.retururi = liveBucket.retururi;
          // Odată ce avem confirmare live pentru acest magazin+lună, "fără
          // AWB (necunoscut)" calculat doar din DB nu mai e de încredere —
          // MyGLS a lămurit deja ce s-a întâmplat cu coletele din bucket-ul ăsta.
          target.codFaraAwb = 0;
        }
      }
    }

    // Numărul exact de comenzi eMAG pe lună, citit din Sameday (vezi
    // fetchEmagSameday) — SUPRASCRIE doar `orders` (Sameday nu ne dă nicio
    // altă informație structurată), restul (valoare/card/facturat) rămâne
    // din importul local.
    if (emagSameday) {
      for (const [period, count] of Object.entries(emagSameday)) {
        if (!periods[period]) periods[period] = {};
        if (!periods[period].emag) periods[period].emag = emptyBucket();
        // Un 0 găsit în Sameday pentru o lună unde importul local chiar are
        // comenzi e semn de scanare eșuată/trunchiată (lună mai veche, cu
        // multe mișcări de status-sync), NU dovadă că n-au existat comenzi —
        // păstrăm numărul local în loc să-l ascundem cu un 0 nereal.
        if (count > 0 || periods[period].emag.orders === 0) periods[period].emag.orders = count;
      }
    }

    const shopTotals = {};
    for (const byShop of Object.values(periods)) {
      for (const [shopKey, bucket] of Object.entries(byShop)) {
        if (!shopTotals[shopKey]) shopTotals[shopKey] = emptyBucket();
        addBucket(shopTotals[shopKey], bucket);
      }
    }

    const periodKeysSorted = Object.keys(periods).sort().reverse();
    return { periods, shopCurrency, shopTotals, periodKeysSorted };
  }, [serverData, emagOrders, granularity, from, to, liveGls, emagSameday]);

  const visibleShops = SHOP_ORDER.filter(k => activeShops.has(k) && (shopTotals[k] || k === 'emag'));

  // Pre-încarcă (în fundal, cache-uit) comenzile fiecărui magazin real pentru
  // toate lunile/anii afișați curent — ca rândurile "📦 GLS TOTAL" / "🚀
  // SAMEDAY TOTAL" de la fiecare perioadă să aibă deja numărul calculat
  // ÎNAINTE ca utilizatorul să deschidă vreun magazin, nu doar după click.
  useEffect(() => {
    const realShops = ['ro', 'hu', 'glato', 'glatohu'];
    const jobs = [];
    for (const period of periodKeysSorted) {
      for (const shopKey of realShops) {
        if (!periods[period]?.[shopKey]) continue;
        const key = `${period}|${shopKey}`;
        if (orderCache[key] || loadingKeysRef.current.has(key)) continue;
        jobs.push({ period, shopKey });
      }
    }
    if (jobs.length) mapWithConcurrency(jobs, 3, job => loadRow(job.period, job.shopKey));
  }, [periodKeysSorted, periods, orderCache, loadRow]);

  // Totale globale per monedă (nu amestecăm RON cu HUF)
  const grandByCurrency = useMemo(() => {
    const out = {}; // currency -> bucket
    for (const [shopKey, bucket] of Object.entries(shopTotals)) {
      if (!activeShops.has(shopKey)) continue;
      const cur = shopCurrency[shopKey] || 'RON';
      if (!out[cur]) out[cur] = emptyBucket();
      addBucket(out[cur], bucket);
    }
    return out;
  }, [shopTotals, shopCurrency, activeShops]);

  const periodLabel = (key) => granularity === 'year' ? key : (() => {
    const [y, m] = key.split('-');
    const MN = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];
    return `${MN[parseInt(m, 10) - 1]} ${y}`;
  })();

  const exportCsv = () => {
    const rows = [['Perioadă', 'Magazin', 'Monedă', 'Comenzi', 'Anulate', 'Valoare', 'Încasat COD', 'Neîncasat COD (AWB activ)', 'COD fără AWB (necunoscut)', 'Încasat Card', 'Retururi', 'AWB create', 'Facturate', 'Nefacturate']];
    for (const period of periodKeysSorted) {
      for (const shopKey of visibleShops) {
        const b = periods[period]?.[shopKey];
        if (!b) continue;
        rows.push([periodLabel(period), SHOP_META[shopKey]?.label || shopKey, shopCurrency[shopKey] || '', b.orders, b.cancelled, fmt(b.valoare), fmt(b.codIncasat), fmt(b.codNeincasat), fmt(b.codFaraAwb), fmt(b.cardIncasat), b.retururi, b.awbCreate, b.facturate, b.nefacturate]);
      }
    }
    downloadCsv(`statistici-totale_${from}_${to}.csv`, rows);
  };

  // ── Verificare facturi eMAG în SmartBill (XLS export) ──────────────────
  const checkEmagInvoices = async (file) => {
    setSbChecking(true); setSbResults(null); setError('');
    try {
      await loadXLSXLib();
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      let hi = -1;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i].join('').toLowerCase().includes('factura') && raw[i].join('').toLowerCase().includes('client')) { hi = i; break; }
      }
      if (hi === -1) throw new Error('Nu am găsit header-ul în XLS. Asigură-te că e exportul SmartBill.');
      const hdr = raw[hi].map(h => (h || '').toString().toLowerCase());
      const ci = hdr.findIndex(h => h.includes('client'));
      const fi = hdr.findIndex(h => h.includes('factura') || h.includes('factură'));
      const oi = hdr.findIndex(h => h.includes('observ'));
      const ti = hdr.findIndex(h => h.includes('valoare totala') || h.includes('total'));
      const rows = [];
      for (let i = hi + 1; i < raw.length; i++) {
        const r = raw[i];
        const inv = (r[fi] || '').toString().trim();
        if (!inv || !inv.match(/^[A-Z]+\d+$/)) continue;
        rows.push({ invoiceCode: inv, client: (r[ci] || '').toString().trim(), observations: (r[oi] || '').toString().trim(), total: parseFloat((r[ti] || '').toString().replace(',', '.')) || 0 });
      }
      if (!rows.length) throw new Error('Nicio factură găsită în XLS.');

      const cif = ls.get('sb_cif') || '';
      const pending = emagOrders.filter(o => !o.invoiceNumber);
      if (!pending.length) { setSbResults({ found: 0, notFound: 0, message: 'Toate comenzile eMAG au deja factură asociată.' }); return; }

      const res = await fetch('/api/smartbill/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cif, shopifyDomain: '', shopifyToken: '',
          xlsData: rows,
          orders: pending.map(o => ({ id: o.id, name: o.orderId || o.id, client: o.name, total: (o.products || []).reduce((s, p) => s + (p.price || 0) * (p.qty || 1), 0) })),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const foundNames = Object.keys(data.found || {});
      if (foundNames.length) {
        setEmagOrders(prev => {
          const next = prev.map(o => {
            const key = o.orderId || o.id;
            const f = data.found[key];
            if (!f) return o;
            return { ...o, invoiceSeries: f.series, invoiceNumber: f.number, invoiceUrl: f.url };
          });
          ls.set('emag_orders', JSON.stringify(next));
          return next;
        });
      }
      setSbResults({ found: foundNames.length, notFound: pending.length - foundNames.length });
    } catch (e) {
      setError(e.message);
    } finally {
      setSbChecking(false);
    }
  };

  // ── Import export AWB Sameday — sursă exactă, persistată permanent ──────
  // Exportul AWB din panoul Sameday (descărcat manual de utilizator) conține
  // ce API-ul live Sameday nu poate da: dată REALĂ de creare, status REAL în
  // text, referința comenzii (în "Observatii"). O dată încărcat, se salvează
  // definitiv (SamedayAwbImport, cheie unică pe AWB) — reîncărcarea aceluiași
  // fișier sau a unuia mai nou doar actualizează, nu duplichează.
  const loadSamedayImport = useCallback(() => {
    if (!from || !to) return;
    setSamedayImportLoading(true);
    fetch(`/api/stats-totale/sameday-import?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setSamedayImportRows(d.rows || []); setSamedayImportMonthsCovered(d.monthsCovered || []); } })
      .catch(() => {})
      .finally(() => setSamedayImportLoading(false));
  }, [from, to]);
  useEffect(() => { loadSamedayImport(); }, [loadSamedayImport]);

  const parseSamedayXls = async (file) => {
    await loadXLSXLib();
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!raw.length) throw new Error('Fișier gol.');
    const hdr = raw[0].map(h => (h || '').toString().trim().toLowerCase());
    const idx = name => hdr.findIndex(h => h === name);
    const ci = {
      awb: idx('awb'), marketplace: idx('marketplace'), created: idx('data crearii'),
      delivered: idx('data livrare'), status: idx('status'), cod: idx('ramburs'),
      observations: idx('observatii'), cost: idx('cost'),
    };
    if (ci.awb < 0) throw new Error('Nu am găsit coloana AWB — asigură-te că e exportul AWB din Sameday.');
    const rows = [];
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i];
      const awb = (r[ci.awb] || '').toString().trim();
      if (!awb) continue;
      rows.push({
        awb,
        marketplace: ci.marketplace >= 0 ? ((r[ci.marketplace] || '').toString().trim() || null) : null,
        createdDate: ci.created >= 0 ? ((r[ci.created] || '').toString().trim() || null) : null,
        deliveredAt: ci.delivered >= 0 ? ((r[ci.delivered] || '').toString().trim() || null) : null,
        statusText: ci.status >= 0 ? (r[ci.status] || '').toString().trim() : '',
        codAmount: ci.cod >= 0 ? (parseFloat((r[ci.cod] || '').toString().replace(',', '.')) || null) : null,
        observations: ci.observations >= 0 ? ((r[ci.observations] || '').toString().trim() || null) : null,
        cost: ci.cost >= 0 ? (parseFloat((r[ci.cost] || '').toString().replace(',', '.')) || null) : null,
      });
    }
    return rows;
  };

  const handleSamedayImport = async (file) => {
    setSamedayImportUploading(true); setSamedayImportError(''); setSamedayImportResult(null);
    try {
      const rows = await parseSamedayXls(file);
      if (!rows.length) throw new Error('Niciun rând valid găsit în fișier.');
      const totals = { imported: 0, updated: 0, skipped: 0 };
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const res = await fetch('/api/stats-totale/sameday-import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        }).then(r => r.json());
        if (res.error) throw new Error(res.error);
        totals.imported += res.imported || 0; totals.updated += res.updated || 0; totals.skipped += res.skipped || 0;
      }
      setSamedayImportResult({ ...totals, total: rows.length });
      loadSamedayImport();
    } catch (e) {
      setSamedayImportError(e.message);
    } finally {
      setSamedayImportUploading(false);
    }
  };

  const samedayImportByMonth = useMemo(() => {
    const out = {};
    for (const r of samedayImportRows) {
      const mk = r.createdDate ? r.createdDate.slice(0, 7) : null;
      if (!mk) continue;
      if (!out[mk]) out[mk] = { total: 0, emag: 0, delivered: 0, returned: 0, cancelled: 0, transit: 0 };
      const b = out[mk];
      b.total++;
      const isEmag = (r.marketplace || '').toLowerCase().includes('emag') || (r.awb || '').toUpperCase().includes('EMG');
      if (isEmag) b.emag++;
      const s = stripDiacritics(r.statusText);
      if (s.includes('anulat')) b.cancelled++;
      else if (s.includes('livrat cu succes') || s.includes('rambursul a fost transferat')) b.delivered++;
      else if (s.includes('ti-am returnat') || s.includes('retur')) b.returned++;
      else b.transit++;
    }
    return out;
  }, [samedayImportRows]);

  // ── Sincronizare completă în DB ──────────────────────────────────────────
  // Soluția definitivă la golul din DB: pentru fiecare magazin + lună din
  // interval, aduce comenzile live din Shopify (sursa de adevăr, nu DB-ul
  // nostru parțial) și le salvează prin upsertOrderFromWebhook — același cod
  // folosit de webhook-uri, deci sigur. Pentru fiecare comandă cu fulfillment
  // (tracking_company + tracking_number — GLS SAU Sameday, Shopify le ține
  // la fel pe amândouă), creează/actualizează rândul Shipment și îi ia
  // statusul live din /api/tracking. După asta tabelul principal de mai jos
  // devine corect direct din DB, fără să mai fie nevoie să tragi date live
  // de fiecare dată — și acoperă Sameday la fel ca GLS, nu doar GLS.
  const syncToDb = async () => {
    setSyncLoading(true); setSyncError(''); setSyncSummary(null);
    try {
      const months = monthRanges(from, to);
      const jobs = [];
      for (const shopKey of ['ro', 'hu', 'glato', 'glatohu']) {
        for (const m of months) jobs.push({ shopKey, ...m });
      }
      setSyncProgress({ done: 0, total: jobs.length });

      const totals = { ordersCreated: 0, ordersUpdated: 0, shipmentsCreated: 0, statusUpdated: 0 };
      const errors = [];
      await mapWithConcurrency(jobs, 3, async (job) => {
        const res = await fetch('/api/stats-totale/sync-orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop: job.shopKey, from: job.from, to: job.to }),
        }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));
        if (res.ok) {
          totals.ordersCreated += res.ordersCreated || 0;
          totals.ordersUpdated += res.ordersUpdated || 0;
          totals.shipmentsCreated += res.shipmentsCreated || 0;
          totals.statusUpdated += res.statusUpdated || 0;
        } else {
          errors.push(`${job.shopKey} ${job.key}: ${res.error || 'eroare necunoscută'}`);
        }
        setSyncProgress(p => ({ ...p, done: p.done + 1 }));
      });

      if (errors.length) console.error('[Statistici Totale] Erori sincronizare:', errors);
      setSyncSummary({ ...totals, errors });
      load(); // reîncarcă tabelul principal din DB, acum actualizat
    } catch (e) {
      setSyncError(e.message);
    } finally {
      setSyncLoading(false);
    }
  };

  // ── Volum real MyGLS (live, read-only — nu salvează nimic) ──────────────
  // Variantă rapidă, DOAR pentru GLS, DOAR pentru o privire imediată, fără
  // să scrie în DB — pentru sincronizare definitivă (ambii curieri, salvată
  // permanent), vezi syncToDb mai sus.
  // Tragem GetParcelList lună cu lună (owner: /api/gls-parcellist, folosește
  // deja credențialele server din env), atribuim fiecare colet unui magazin
  // după ClientReference (căutat LIVE în Shopify, nu în DB — vezi
  // /api/stats-totale/shopify-order-names), și luăm statusul de livrare din
  // /api/tracking — care deja disambiguează corect codul GLS ambiguu (5).
  const fetchLiveGls = async () => {
    setLiveGlsLoading(true); setLiveGlsError(''); setLiveGlsSummary(null);
    const months = monthRanges(from, to);
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    try {
      // O lună ÎNCHEIATĂ (nu luna curentă) nu se mai schimbă niciodată — dacă
      // am mai tras-o și salvat-o cândva (vezi GlsParcelSnapshot, persistat
      // mai jos), n-are niciun rost să tragem din nou din MyGLS de fiecare
      // dată când cineva se uită pe ea. Doar luna curentă + lunile încheiate
      // NEACOPERITE încă trec prin pull-ul live.
      const closedMonths = months.filter(m => m.key < currentMonthKey);
      const openMonths = months.filter(m => m.key >= currentMonthKey);
      let covered = new Set();
      if (closedMonths.length) {
        const cov = await fetch(`/api/stats-totale/gls-snapshot?from=${closedMonths[0].from}&to=${closedMonths[closedMonths.length - 1].to}&coverage=1`)
          .then(r => r.json()).catch(() => ({ months: [] }));
        covered = new Set(cov.months || []);
      }
      const snapshotMonths = closedMonths.filter(m => covered.has(m.key));
      const liveMonths = [...openMonths, ...closedMonths.filter(m => !covered.has(m.key))];

      // Colete deja salvate (lunile încheiate acoperite) — vin deja complet
      // clasificate (magazin/livrat/retur), fără niciun apel MyGLS.
      const snapshotParcels = [];
      if (snapshotMonths.length) {
        setLiveGlsProgress({ phase: 'Citire din arhivă (luni încheiate)', done: 0, total: snapshotMonths.length });
        await mapWithConcurrency(snapshotMonths, 3, async (m) => {
          const res = await fetch(`/api/stats-totale/gls-snapshot?from=${m.from}&to=${m.to}`).then(r => r.json()).catch(() => ({ ok: false }));
          if (res.ok) for (const p of (res.parcels || [])) snapshotParcels.push({ ...p, monthKey: m.key, fromSnapshot: true });
          setLiveGlsProgress(p => ({ ...p, done: p.done + 1 }));
        });
      }

      // Faza 1: colete pe lună (doar lunile care chiar trebuie trase live) —
      // 3 cereri MyGLS simultane. Pur secvențial, pe un interval de un an
      // (12-13 luni), dura inutil de mult pentru doar atâtea cereri rapide.
      let allParcels = [];
      if (liveMonths.length) {
        setLiveGlsProgress({ phase: 'Colete MyGLS (live)', done: 0, total: liveMonths.length });
        await mapWithConcurrency(liveMonths, 3, async (m) => {
          const res = await fetch('/api/gls-parcellist', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: m.from, to: m.to }),
          }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));
          if (res.ok) {
            for (const p of (res.parcels || [])) allParcels.push({ ...p, monthKey: m.key });
          }
          setLiveGlsProgress(p => ({ ...p, done: p.done + 1 }));
        });
      }

      if (!allParcels.length && !snapshotParcels.length) {
        setLiveGls({});
        setLiveGlsSummary({ totalParcels: 0, matched: 0, unmatched: 0 });
        return;
      }

      let shopMatches = {};
      let statusMap = new Map();
      if (allParcels.length) {
        // Faza 2: atribuire magazin după ClientReference (numele comenzii
        // Shopify, ex "#1042") — direct din Shopify LIVE (toate magazinele
        // conectate), nu din DB-ul nostru. DB-ul e exact ce lipsește (de-aia
        // facem tot pull-ul ăsta live) — a căuta un colet neatribuit tot în
        // DB dădea mereu "neatribuit", chiar dacă comanda chiar există în
        // Shopify.
        setLiveGlsProgress({ phase: 'Atribuire magazine (Shopify live)', done: 0, total: 1 });
        const mr = await fetch('/api/stats-totale/shopify-order-names', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to }),
        }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));
        if (mr.ok) shopMatches = mr.nameToShop || {};
        else setLiveGlsError(`Atribuire magazine eșuată: ${mr.error || 'eroare necunoscută'} — coletele rămân neatribuite.`);
        setLiveGlsProgress({ phase: 'Atribuire magazine (Shopify live)', done: 1, total: 1 });

        // Faza 3: status livrare per AWB — loturi de 15 (mărime dovedită pe
        // pagina Comenzi, ca fiecare cerere serverless să rămână scurtă), dar
        // 4 loturi simultan — cu sute/mii de AWB-uri pe un an întreg,
        // secvențial pur lua multe minute, fără niciun semn vizibil de
        // progres (exact motivul pentru care părea "nu s-a actualizat" deși
        // chiar lucra).
        const awbs = allParcels.map(p => String(p.parcelNumber || '').trim()).filter(Boolean);
        const chunks = [];
        for (let i = 0; i < awbs.length; i += 15) chunks.push(awbs.slice(i, i + 15));
        setLiveGlsProgress({ phase: 'Status livrare', done: 0, total: chunks.length });
        await mapWithConcurrency(chunks, 4, async (chunk) => {
          const r = await fetch('/api/tracking', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orders: chunk.map(awb => ({ id: awb, awb, courier: 'gls' })) }),
          }).then(r => r.json()).catch(() => ({ results: [] }));
          for (const res of (r.results || [])) statusMap.set(res.id, res);
          setLiveGlsProgress(p => ({ ...p, done: p.done + 1 }));
        });
      }

      const live = {};
      const liveDetails = {}; // doar pentru neatribuit_* — detaliu per colet, pentru drill-down în listă
      const toSnapshot = []; // coletele proaspăt trase live — de salvat în GlsParcelSnapshot mai jos
      let matched = 0, unmatched = 0, unmatchedBlankRef = 0;
      const unmatchedSample = [];
      const toPeriod = (mk) => granularity === 'year' ? mk.slice(0, 4) : mk;

      const classified = [];
      for (const p of allParcels) {
        const ref = (p.clientRef || '').trim();
        const matchedShop = shopMatches[ref];
        const shopKey = matchedShop || classifyUnmatchedGlsRef(ref);
        if (matchedShop) matched++;
        else {
          unmatched++;
          if (!ref) unmatchedBlankRef++;
          if (unmatchedSample.length < 20) unmatchedSample.push({ ref, name: p.deliveryName || '', city: p.deliveryCity || '', month: p.monthKey, category: shopKey });
        }
        const t = statusMap.get(String(p.parcelNumber || '').trim());
        let delivered = false, returned = false;
        // hasReturnCode vine deja din /api/tracking cu disambiguarea corectă
        // (scanează tot istoricul DOAR pentru codul 5, ambiguu la GLS — vezi
        // app/api/tracking/route.js) — un "delivered" care a trecut de acel
        // filtru e o livrare confirmată, indiferent dacă are sau nu ramburs.
        if (t?.hasReturnCode) returned = true;
        else if (t?.status === 'delivered') delivered = true;
        else if (['failure', 'failed_attempt', 'returned', 'failed_delivery', 'return_in_progress'].includes(t?.status)) returned = true;
        const hasStatus = !!t?.status;
        const parcel = { parcelNumber: p.parcelNumber, clientRef: ref, pickupDate: p.pickupDate || null, deliveryName: p.deliveryName || '', deliveryCity: p.deliveryCity || '', cod: Number(p.cod) || 0, codCurrency: p.codCurrency || '', shopKey, delivered, returned, hasStatus, monthKey: p.monthKey };
        classified.push(parcel);
        toSnapshot.push(parcel);
      }
      // Coletele din arhivă (deja clasificate) intră direct, fără recalcul.
      for (const p of snapshotParcels) {
        classified.push(p);
        if (p.shopKey.startsWith('neatribuit')) unmatched++; else matched++;
      }

      for (const p of classified) {
        const period = toPeriod(p.monthKey);
        if (!live[period]) live[period] = {};
        if (!live[period][p.shopKey]) live[period][p.shopKey] = emptyBucket();
        const b = live[period][p.shopKey];
        b.orders++; b.awbCreate++;
        if (p.returned) b.retururi++;
        if (p.cod > 0) {
          if (p.delivered) b.codIncasat += p.cod;
          else if (!p.returned) b.codNeincasat += p.cod;
        }
        if (p.shopKey === 'neatribuit_posibil' || p.shopKey === 'neatribuit_manual') {
          if (!liveDetails[period]) liveDetails[period] = {};
          if (!liveDetails[period][p.shopKey]) liveDetails[period][p.shopKey] = [];
          liveDetails[period][p.shopKey].push({ ref: p.clientRef, parcelNumber: p.parcelNumber, name: p.deliveryName, city: p.deliveryCity, cod: p.cod, codCurrency: p.codCurrency, delivered: p.delivered, returned: p.returned, hasStatus: p.hasStatus });
        }
      }

      setLiveGls(live);
      setLiveGlsDetails(liveDetails);
      setLiveGlsSummary({ totalParcels: classified.length, matched, unmatched, unmatchedBlankRef, unmatchedSample });

      // Salvează definitiv coletele proaspăt trase — lunile încheiate nu vor
      // mai fi retrase din MyGLS data viitoare (vezi coverage mai sus).
      if (toSnapshot.length) {
        for (let i = 0; i < toSnapshot.length; i += 500) {
          const chunk = toSnapshot.slice(i, i + 500);
          await fetch('/api/stats-totale/gls-snapshot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parcels: chunk }),
          }).catch(() => {});
        }
      }
    } catch (e) {
      setLiveGlsError(e.message);
    } finally {
      setLiveGlsLoading(false);
    }
  };

  // ── eMAG — numărul EXACT de comenzi pe lună, citit din Sameday ─────────
  // eMAG nu e un magazin Shopify conectat — expediază totul prin Sameday,
  // iar AWB-urile lor conțin mereu substringul "EMG" (regulă deja dovedită
  // pe pagina Comenzi, vezi acolo emagLiveAwbs). Status-sync Sameday nu ne
  // dă dată per AWB, dar tras lună cu lună (monthRanges) numărul rezultat
  // e deja corect atribuit lunii respective.
  const fetchEmagSameday = async () => {
    setEmagSamedayLoading(true); setEmagSamedayError('');
    try {
      const months = monthRanges(from, to);
      setEmagSamedayProgress({ done: 0, total: months.length });
      const toPeriod = (mk) => granularity === 'year' ? mk.slice(0, 4) : mk;
      const counts = {};
      const live = {};
      let anyTruncated = false;
      await mapWithConcurrency(months, 2, async (m) => {
        const res = await fetch('/api/sameday-parcellist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: m.from, to: m.to }),
        }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));
        if (res.ok) {
          const period = toPeriod(m.key);
          const bucket = live[period] || (live[period] = { emag: [], client_return: [], shop: [] });
          for (const awb of res.awbs || []) bucket[samedayAwbKind(awb)].push(awb);
          counts[period] = bucket.emag.length;
          if (res.debug?.truncated) anyTruncated = true;
        } else {
          setEmagSamedayError(res.error || 'Eroare Sameday');
        }
        setEmagSamedayProgress(p => ({ ...p, done: p.done + 1 }));
      });
      if (anyTruncated) {
        setEmagSamedayError(prev => prev || '⚠️ Unele luni au prea multe mișcări pentru fereastra Sameday (limită ~45s/cerere) — numărul poate fi sub cel real pentru lunile foarte încărcate.');
      }
      setEmagSameday(counts);
      setSamedayLive(live);
    } catch (e) {
      setEmagSamedayError(e.message);
    } finally {
      setEmagSamedayLoading(false);
    }
  };

  // Sincronizare AUTOMATĂ pentru intervale scurte (≤2 luni, ex. "Luna asta"
  // sau o lună exactă aleasă din dropdown) — Shopify→DB, volum live MyGLS și
  // Sameday, toate fără niciun click, ca numerele să fie corecte direct la
  // deschiderea paginii. Intervale mai lungi rămân pe butonul manual din
  // „🔄 Sincronizare" (altfel ar dura prea mult/ar lovi rate-limit-uri la
  // fiecare simplă schimbare de filtru).
  const autoSyncKeyRef = useRef('');
  const runFullSync = useCallback(() => {
    syncToDb();
    fetchLiveGls();
    fetchEmagSameday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, granularity]);
  useEffect(() => {
    if (!from || !to) return;
    const key = `${from}|${to}|${granularity}`;
    if (autoSyncKeyRef.current === key || monthRanges(from, to).length > 2) return;
    autoSyncKeyRef.current = key;
    runFullSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, granularity]);

  // Sincronizare de fundal, O DATĂ PE ZI (indiferent ce interval se vede pe
  // ecran), pentru ultimele 3 luni — de ce: „SAMEDAY TOTAL" exclude un AWB de
  // la „fără comandă" doar dacă există deja ca Shipment la noi (vezi
  // known-awbs mai sus), iar sincronizarea automată de mai sus acoperă DOAR
  // luna vizibilă acum. O comandă din septembrie, livrată abia în octombrie,
  // nu ajungea niciodată în bază dacă nimeni nu se uita special pe
  // septembrie — rămânea numărată greșit drept "fără comandă" la infinit.
  // Asta rulează pe fundal, nu blochează nimic vizual.
  useEffect(() => {
    const dayKey = new Date().toISOString().slice(0, 10);
    if (ls.get('stats_backfill_day') === dayKey) return;
    ls.set('stats_backfill_day', dayKey);
    const today = new Date();
    const wideFrom = new Date(today.getFullYear(), today.getMonth() - 2, 1).toISOString().slice(0, 10);
    const wideTo = today.toISOString().slice(0, 10);
    const months = monthRanges(wideFrom, wideTo);
    const jobs = [];
    for (const shopKey of ['ro', 'hu', 'glato', 'glatohu']) for (const m of months) jobs.push({ shopKey, ...m });
    mapWithConcurrency(jobs, 2, job =>
      fetch('/api/stats-totale/sync-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: job.shopKey, from: job.from, to: job.to }),
      }).catch(() => {})
    );
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e2e8f0', padding: '16px 16px 100px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#f97316' }}>📈 Statistici Totale</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Toate magazinele + eMAG, într-un singur loc</div>
          </div>
          <a href="/" style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '6px 12px' }}>← Comenzi</a>
        </div>

        {/* ── Filtre (aceeași bară ca pe pagina Comenzi) ── */}
        <div className="date-bar">
          <div className="presets">
            <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 4, whiteSpace: 'nowrap' }}>📅</span>
            {PRESETS.map(p => (
              <button key={p.id} className={`preset-btn ${preset === p.id ? 'active' : ''}`} onClick={() => applyPreset(p.id)}>
                {p.label}
              </button>
            ))}
            <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,.1)', margin: '0 2px', flexShrink: 0 }} />
            <select value={pickYear} onChange={e => applyExactMonth(Number(e.target.value), pickMonth)} style={selStyle}>
              {Array.from({ length: new Date().getFullYear() - 2022 + 1 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select value={pickMonth} onChange={e => applyExactMonth(pickYear, Number(e.target.value))} style={selStyle}>
              {MONTH_NAMES.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
            </select>
            <div style={{ position: 'relative', marginLeft: 'auto' }}>
              <button onClick={() => setShopDropdownOpen(v => !v)} style={btnGhost}>
                🏬 Magazine ({activeShops.size === SHOP_ORDER.length ? 'toate' : activeShops.size})
              </button>
              {shopDropdownOpen && <div onClick={() => setShopDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />}
              {shopDropdownOpen && (
                <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: '#161d24', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: 10, zIndex: 20, minWidth: 210, maxWidth: '80vw', boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e2e8f0', padding: '4px 2px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,.08)', marginBottom: 4 }}>
                    <input type="checkbox" checked={activeShops.size === SHOP_ORDER.length} onChange={() => setActiveShops(activeShops.size === SHOP_ORDER.length ? new Set() : new Set(SHOP_ORDER))} />
                    Toate
                  </label>
                  {SHOP_ORDER.map(k => (
                    <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SHOP_META[k].color, padding: '4px 2px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={activeShops.has(k)} onChange={() => toggleShop(k)} />
                      {SHOP_META[k].flag} {SHOP_META[k].label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {['month', 'year'].map(g => (
                <button key={g} onClick={() => setGranularity(g)} style={{ ...btnTab, ...(granularity === g ? btnTabActive : {}) }}>
                  {g === 'month' ? '📅 Lunar' : '🗓️ Anual'}
                </button>
              ))}
            </div>
          </div>
          <div className="custom-row">
            <label>De la:</label>
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset('custom'); }} />
            <label>Până la:</label>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset('custom'); }} />
            <button className="apply-btn" onClick={load} disabled={loading}>{loading ? '⟳' : '🔄'} Reîncarcă</button>
            <span className="range-label">{from} → {to}</span>
          </div>
        </div>

        {error && <div style={errBox}>⚠️ {error}</div>}

        {/* ── Sincronizare, compact — detalii la cerere ── */}
        <SyncStatusBar
          isLongRange={monthRanges(from, to).length > 2}
          onRefresh={runFullSync}
          syncLoading={syncLoading} syncProgress={syncProgress} syncError={syncError} syncSummary={syncSummary}
          liveGlsLoading={liveGlsLoading} liveGlsProgress={liveGlsProgress} liveGlsError={liveGlsError} liveGlsSummary={liveGlsSummary}
          emagSamedayLoading={emagSamedayLoading} emagSamedayProgress={emagSamedayProgress} emagSamedayError={emagSamedayError} emagSameday={emagSameday}
        />

        {/* ── Sameday — import export AWB (sursă exactă, salvată permanent) ── */}
        <div style={{ background: '#0f1419', border: '1px solid rgba(168,85,247,.3)', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#a855f7' }}>🚀 Sameday — import export AWB (sursă exactă, salvată permanent)</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, maxWidth: 600 }}>
                Descarcă din contul Sameday exportul AWB (XLS) și încarcă-l aici — se salvează definitiv în bază, nu mai trebuie reîncărcat data viitoare. Conține dată reală de creare + status real + referința comenzii, mai precis decât volumul live de mai sus.
                {!!samedayImportMonthsCovered.length && <> Acoperă deja: <b style={{ color: '#e2e8f0' }}>{samedayImportMonthsCovered.join(', ')}</b>.</>}
              </div>
            </div>
            <label style={{ ...btnPrimary, background: '#a855f7', display: 'inline-flex', cursor: 'pointer' }}>
              {samedayImportUploading ? '⟳ Se încarcă...' : '📥 Încarcă export AWB'}
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={samedayImportUploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleSamedayImport(f); e.target.value = ''; }} />
            </label>
          </div>
          {samedayImportError && <div style={errBox}>⚠️ {samedayImportError}</div>}
          {samedayImportResult && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
              ✅ <b style={{ color: '#10b981' }}>{fmtInt(samedayImportResult.imported)}</b> noi, <b style={{ color: '#e2e8f0' }}>{fmtInt(samedayImportResult.updated)}</b> actualizate din {fmtInt(samedayImportResult.total)} rânduri.
            </div>
          )}
          {samedayImportLoading ? (
            <div style={{ fontSize: 11, color: '#64748b' }}>Se încarcă...</div>
          ) : Object.keys(samedayImportByMonth).length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 520 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)' }}>
                  {['Lună', 'Total AWB', 'eMAG', 'Livrate', 'Refuzate/retur', 'Anulate', 'Altele'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(samedayImportByMonth).sort().reverse().map(mk => {
                  const b = samedayImportByMonth[mk];
                  return (
                    <tr key={mk} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                      <td style={{ padding: '5px 8px', color: '#cbd5e1', fontWeight: 700 }}>{mk}</td>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>{fmtInt(b.total)}</td>
                      <td style={{ padding: '5px 8px', color: '#eab308' }}>{fmtInt(b.emag)}</td>
                      <td style={{ padding: '5px 8px', color: '#10b981' }}>{fmtInt(b.delivered)}</td>
                      <td style={{ padding: '5px 8px', color: '#f43f5e' }}>{fmtInt(b.returned)}</td>
                      <td style={{ padding: '5px 8px', color: '#64748b' }}>{fmtInt(b.cancelled)}</td>
                      <td style={{ padding: '5px 8px', color: '#f59e0b' }}>{fmtInt(b.transit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ fontSize: 11, color: '#475569' }}>Niciun export încărcat încă pentru intervalul selectat.</div>
          )}
        </div>

        {/* ── KPI cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
          <Kpi label="Total comenzi" value={fmtInt(visibleShops.reduce((s, k) => s + (shopTotals[k]?.orders || 0), 0))} color="#60a5fa" />
          <Kpi label="Anulate" value={fmtInt(visibleShops.reduce((s, k) => s + (shopTotals[k]?.cancelled || 0), 0))} color="#64748b" />
          <Kpi label="Retururi" value={fmtInt(visibleShops.reduce((s, k) => s + (shopTotals[k]?.retururi || 0), 0))} color="#f43f5e" />
          <Kpi label="Nefacturate" value={fmtInt(visibleShops.reduce((s, k) => s + (shopTotals[k]?.nefacturate || 0), 0))} color="#f59e0b" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginBottom: 20 }}>
          {Object.entries(grandByCurrency).map(([cur, b]) => (
            <div key={cur} style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, marginBottom: 6 }}>💰 Încasări — {cur}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: '#94a3b8' }}>💵 COD încasat</span><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#10b981' }}>{fmt(b.codIncasat)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: '#94a3b8' }}>💳 Card încasat</span><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#3b82f6' }}>{fmt(b.cardIncasat)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: b.codFaraAwb ? 3 : 0 }}>
                <span style={{ color: '#94a3b8' }}>⏳ COD neîncasat (AWB activ)</span><span style={{ fontFamily: 'monospace', color: '#f59e0b' }}>{fmt(b.codNeincasat)}</span>
              </div>
              {!!b.codFaraAwb && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }} title="Comenzi COD fără niciun AWB urmărit la noi — nu știm dacă au fost livrate și încasate, sau abandonate. NU e bani garantat 'pe drum' — verifică manual.">
                  <span style={{ color: '#64748b' }}>❓ COD fără AWB (necunoscut)</span><span style={{ fontFamily: 'monospace', color: '#64748b' }}>{fmt(b.codFaraAwb)}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Listă: comenzi pe perioadă + magazin, click pentru detalii ── */}
        <div style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{granularity === 'month' ? 'Comenzi pe lună și magazin' : 'Comenzi pe an și magazin'}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative' }}>
                <button onClick={() => { setStatusDropdownOpen(v => !v); setCourierDropdownOpen(false); }} style={btnGhost}>
                  📦 Status ({statusFilter.size === STATUS_ORDER.length ? 'toate' : statusFilter.size})
                </button>
                {statusDropdownOpen && <div onClick={() => setStatusDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />}
                {statusDropdownOpen && (
                  <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', background: '#161d24', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: 10, zIndex: 20, minWidth: 180, maxWidth: '75vw', boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                    {STATUS_ORDER.map(k => (
                      <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: STATUS_META[k].color, padding: '4px 2px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={statusFilter.has(k)} onChange={() => setStatusFilter(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                        {STATUS_META[k].label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <button onClick={() => { setCourierDropdownOpen(v => !v); setStatusDropdownOpen(false); }} style={btnGhost}>
                  🚚 Curier ({courierFilter.size === COURIER_ORDER.length ? 'toate' : courierFilter.size})
                </button>
                {courierDropdownOpen && <div onClick={() => setCourierDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />}
                {courierDropdownOpen && (
                  <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', background: '#161d24', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: 10, zIndex: 20, minWidth: 150, maxWidth: '75vw', boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                    {COURIER_ORDER.map(k => (
                      <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: COURIER_META[k].color, padding: '4px 2px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={courierFilter.has(k)} onChange={() => setCourierFilter(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                        {COURIER_META[k].label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={exportCsv} style={btnGhost}>⬇ Export CSV</button>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 10, marginTop: -4 }}>
            Lista de comenzi (după click pe un magazin) arată implicit doar <b style={{ color: '#e2e8f0' }}>livrate / refuzate / în tranzit</b>, toți curierii — schimbă din „📦 Status" / „🚚 Curier" după nevoie. Fiecare magazin expandat arată și câte comenzi au fost GLS vs Sameday.
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#475569', padding: 24 }}>Se încarcă...</div>
          ) : periodKeysSorted.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#475569', padding: 24 }}>Nicio comandă în intervalul selectat.</div>
          ) : (
            periodKeysSorted.map(period => {
              const shopsInPeriod = visibleShops.filter(k => periods[period]?.[k]);
              const periodTotal = shopsInPeriod.reduce((s, k) => {
                const fc = filteredCountFor(orderCache[`${period}|${k}`], statusFilter, courierFilter);
                return s + (fc != null ? fc : (periods[period][k].orders || 0));
              }, 0);
              const glsTotalRows = rowsForCourier(period, shopsInPeriod, 'gls', orderCache, liveGlsDetails, statusFilter);
              const samedayTotalRows = rowsForCourier(period, shopsInPeriod, 'sameday', orderCache, liveGlsDetails, statusFilter, samedayLive);
              const totalsPending = shopsInPeriod.some(k => {
                if (k === 'emag' || k === 'necunoscut') return false;
                if (k === 'neatribuit_posibil' || k === 'neatribuit_manual') return false;
                const exp = orderCache[`${period}|${k}`];
                return !exp || exp.loading;
              });
              return (
                <div key={period} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f97316', padding: '6px 4px', borderBottom: '1px solid rgba(249,115,22,.25)', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
                    <span>📅 {periodLabel(period)}</span>
                    <span style={{ color: '#94a3b8', fontWeight: 400 }}>{fmtInt(periodTotal)} comenzi</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, margin: '6px 0 2px', flexWrap: 'wrap' }}>
                    <CourierTotalTile label="GLS TOTAL" icon="📦" color="#3b82f6" rows={glsTotalRows} pending={totalsPending} onOpen={setDetailTarget} />
                    <CourierTotalTile label="SAMEDAY TOTAL" icon="🚀" color="#a855f7" rows={samedayTotalRows} pending={totalsPending} onOpen={setDetailTarget} />
                  </div>
                  {!liveGls && (
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>
                      ⚠️ GLS TOTAL nu include încă coletele GLS neatribuite unui magazin (manuale/necunoscute, ex. accesorii trimise separat) — apasă „📡 Trage volum live MyGLS" mai jos ca să fie incluse și ele.
                    </div>
                  )}
                  {shopsInPeriod.map(shopKey => {
                    const b = periods[period][shopKey];
                    const meta = SHOP_META[shopKey];
                    const isGlsLive = (shopKey === 'neatribuit_posibil' || shopKey === 'neatribuit_manual') && !!liveGls?.[period]?.[shopKey];
                    const isEmagLive = shopKey === 'emag' && !!emagSameday?.[period];
                    const rowKey = `${period}|${shopKey}`;
                    const exp = orderCache[rowKey];
                    const isOpen = openRows.has(rowKey);
                    const filteredCount = filteredCountFor(exp, statusFilter, courierFilter);
                    const displayCount = filteredCount != null ? filteredCount : b.orders;
                    return (
                      <div key={rowKey} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        <div onClick={() => toggleExpand(period, shopKey)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 6px', cursor: 'pointer' }}>
                          <span style={{ fontSize: 10, color: '#475569', width: 12 }}>{isOpen ? '▾' : '▸'}</span>
                          <span style={{ color: meta.color, fontWeight: 700, fontSize: 12, flex: 1 }}>{meta.flag} {meta.label}</span>
                          <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{fmtInt(displayCount)}</span>
                          <span style={{ fontSize: 10, color: '#64748b' }}>
                            comenzi{filteredCount != null && filteredCount !== b.orders ? ` (din ${fmtInt(b.orders)})` : ''}
                          </span>
                          {(isGlsLive || isEmagLive) && <span title="Date live, nu din baza de date" style={{ fontSize: 10, color: '#f97316' }}>📡</span>}
                          {!!b.retururi && <span style={{ fontSize: 10, color: '#f43f5e' }}>↩ {fmtInt(b.retururi)}</span>}
                        </div>
                        {isOpen && (
                          <div style={{ padding: '2px 6px 10px 22px' }}>
                            {!exp || exp.loading ? (
                              <div style={{ fontSize: 11, color: '#64748b' }}>Se încarcă...</div>
                            ) : exp.error ? (
                              <div style={{ fontSize: 11, color: '#f43f5e' }}>⚠️ {exp.error}</div>
                            ) : !exp.rows?.length && !(exp.kind === 'emag' && samedayLive?.[period]?.emag?.length) ? (
                              <div style={{ fontSize: 11, color: '#475569' }}>Nicio comandă găsită aici — pentru magazinele Shopify, dacă nu ai sincronizat încă intervalul, apasă „💾 Sincronizează tot în bază" mai sus.</div>
                            ) : exp.kind === 'order' ? (
                              <OrderRows rows={exp.rows} statusFilter={statusFilter} courierFilter={courierFilter} onOpen={setDetailTarget} />
                            ) : exp.kind === 'gls_detail' ? (
                              <GlsDetailRows rows={exp.rows} statusFilter={statusFilter} courierFilter={courierFilter} onOpen={setDetailTarget} />
                            ) : exp.kind === 'emag' ? (
                              <EmagRows rows={exp.rows} onOpen={setDetailTarget} liveAwbs={samedayLive?.[period]?.emag || []} />
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* ── Top produse (toate magazinele Shopify, nu include eMAG — acolo
             numele e un titlu SEO lung, nu un SKU unificat) ── */}
        {!!(serverData?.topProducts?.length) && (
          <div style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 16px', marginBottom: 20, overflowX: 'auto' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>📦 Top produse vândute (interval selectat)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 420 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)' }}>
                  {['#', 'Produs', 'SKU', 'Cantitate', 'Valoare'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#64748b', fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {serverData.topProducts.slice(0, 25).map((p, i) => (
                  <tr key={p.sku || p.name} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                    <td style={{ padding: '5px 8px', color: '#475569' }}>{i + 1}</td>
                    <td style={{ padding: '5px 8px', color: '#cbd5e1' }} title={p.name}>{p.name}</td>
                    <td style={{ padding: '5px 8px', color: '#64748b', fontFamily: 'monospace' }}>{p.sku || '—'}</td>
                    <td style={{ padding: '5px 8px', fontWeight: 700 }}>{fmtInt(p.qty)}</td>
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: '#10b981' }}>
                      {Object.entries(p.revenue || {}).map(([cur, v]) => `${fmt(v)} ${cur}`).join(' + ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── eMAG: verificare facturi în SmartBill ── */}
        <div style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#eab308', marginBottom: 6 }}>🛒 eMAG — verifică facturi în SmartBill</div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.6 }}>
            Comenzile eMAG nu au factură legată automat (nu trec prin pipeline-ul nostru de facturare — tu le faci manual în SmartBill).
            Exportă lista de facturi din SmartBill Cloud (XLS) și o încarci aici — potrivim după numele clientului + total, și salvăm legătura găsită.
            {emagOrders.length > 0 && <> În acest moment: <b style={{ color: '#e2e8f0' }}>{emagOrders.filter(o => !o.invoiceNumber).length}</b> din <b style={{ color: '#e2e8f0' }}>{emagOrders.length}</b> comenzi eMAG importate local nu au încă o factură asociată.</>}
          </div>
          <label style={{ ...btnPrimary, display: 'inline-flex', cursor: 'pointer' }}>
            {sbChecking ? '⟳ Se verifică...' : '📥 Încarcă XLS SmartBill'}
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={sbChecking || !emagOrders.length}
              onChange={e => { const f = e.target.files?.[0]; if (f) checkEmagInvoices(f); e.target.value = ''; }} />
          </label>
          {!emagOrders.length && <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Nu ai nicio comandă eMAG importată încă — <a href="/emag" style={{ color: '#f97316' }}>importă din pagina eMAG</a> mai întâi.</div>}
          {sbResults && (
            <div style={{ marginTop: 10, fontSize: 12, color: sbResults.found ? '#10b981' : '#94a3b8' }}>
              {sbResults.message || `✅ ${sbResults.found} facturi găsite și salvate, ${sbResults.notFound} comenzi fără potrivire.`}
            </div>
          )}
        </div>
      </div>
      {detailTarget && <OrderDetailModal target={detailTarget} onClose={() => setDetailTarget(null)} />}
    </div>
  );
}

/** O singură bară, compactă — nu 3 panouri mari cu paragrafe — pentru
 * sincronizarea Shopify/MyGLS/Sameday. Rulează automat pentru intervale
 * scurte (vezi runFullSync), deci de cele mai multe ori arată doar un
 * „✓ Date la zi" liniștit; detaliile (câte comenzi/AWB-uri, eșantionul de
 * referințe neatribuite) rămân disponibile sub „Detalii", nu ocupă ecranul
 * implicit. */
function SyncStatusBar({
  isLongRange, onRefresh,
  syncLoading, syncProgress, syncError, syncSummary,
  liveGlsLoading, liveGlsProgress, liveGlsError, liveGlsSummary,
  emagSamedayLoading, emagSamedayProgress, emagSamedayError, emagSameday,
}) {
  const [open, setOpen] = useState(false);
  const anyLoading = syncLoading || liveGlsLoading || emagSamedayLoading;
  const anyError = syncError || liveGlsError || emagSamedayError;
  const hasRun = syncSummary || liveGlsSummary || emagSameday;

  let statusText = 'Date la zi';
  if (anyLoading) {
    if (liveGlsLoading && liveGlsProgress) statusText = `Se sincronizează — MyGLS: ${liveGlsProgress.phase} (${liveGlsProgress.done}/${liveGlsProgress.total})`;
    else if (syncLoading && syncProgress) statusText = `Se sincronizează — Shopify (${syncProgress.done}/${syncProgress.total})`;
    else if (emagSamedayLoading && emagSamedayProgress) statusText = `Se sincronizează — Sameday (${emagSamedayProgress.done}/${emagSamedayProgress.total})`;
    else statusText = 'Se sincronizează...';
  } else if (anyError) {
    statusText = 'Eroare la sincronizare';
  } else if (!hasRun) {
    statusText = isLongRange ? 'Interval lung — sincronizare manuală' : 'Se pregătește...';
  }

  return (
    <div style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: '8px 12px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14 }}>{anyLoading ? '⟳' : anyError ? '⚠️' : '✓'}</span>
        <span style={{ fontSize: 12, color: anyError ? '#f59e0b' : '#94a3b8', flex: 1, minWidth: 160 }}>{statusText}</span>
        <button onClick={() => setOpen(v => !v)} style={btnGhostSmall}>{open ? 'Ascunde' : 'Detalii'}</button>
        <button onClick={onRefresh} disabled={anyLoading} style={btnGhostSmall} title="Resincronizează Shopify + MyGLS + Sameday">⟳ Resincronizează</button>
      </div>
      {open && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.06)', fontSize: 11, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {isLongRange && <div>Interval mai lung de 2 luni — sincronizarea automată e dezactivată (ar dura prea mult); folosește „⟳ Resincronizează" manual.</div>}
          {syncSummary && (
            <div>💾 Shopify: <b style={{ color: '#10b981' }}>{fmtInt(syncSummary.ordersCreated)}</b> comenzi noi, <b style={{ color: '#e2e8f0' }}>{fmtInt(syncSummary.ordersUpdated)}</b> actualizate, <b style={{ color: '#10b981' }}>{fmtInt(syncSummary.shipmentsCreated)}</b> AWB-uri noi legate, <b style={{ color: '#e2e8f0' }}>{fmtInt(syncSummary.statusUpdated)}</b> statusuri actualizate
              {!!syncSummary.errors?.length && <span style={{ color: '#f59e0b' }}> · ⚠ {syncSummary.errors.length} erori parțiale</span>}
            </div>
          )}
          {liveGlsSummary && (
            <div>
              📦 MyGLS: <b style={{ color: '#e2e8f0' }}>{fmtInt(liveGlsSummary.totalParcels)}</b> colete găsite · <b style={{ color: '#10b981' }}>{fmtInt(liveGlsSummary.matched)}</b> atribuite unui magazin · <b style={{ color: '#f59e0b' }}>{fmtInt(liveGlsSummary.unmatched)}</b> neatribuite
              {!!liveGlsSummary.unmatchedSample?.length && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer' }}>🔍 Eșantion referințe neatribuite</summary>
                  <div style={{ marginTop: 4, maxHeight: 160, overflowY: 'auto', fontFamily: 'monospace', fontSize: 10, background: '#080d12', borderRadius: 8, padding: 8 }}>
                    {liveGlsSummary.unmatchedSample.map((s, i) => (
                      <div key={i} style={{ padding: '2px 0', borderBottom: i < liveGlsSummary.unmatchedSample.length - 1 ? '1px solid #1a2535' : 'none' }}>
                        <span style={{ color: '#f97316' }}>{s.ref}</span> — {s.name || '(fără nume)'}, {s.city || '—'} <span style={{ color: '#475569' }}>({s.month})</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          {emagSameday && (
            <div>🚀 Sameday: <b style={{ color: '#eab308' }}>{fmtInt(Object.values(emagSameday).reduce((s, n) => s + n, 0))}</b> comenzi eMAG găsite pe interval</div>
          )}
          {anyError && (
            <div style={{ color: '#f43f5e' }}>
              {syncError && <div>⚠️ Shopify: {syncError}</div>}
              {liveGlsError && <div>⚠️ MyGLS: {liveGlsError}</div>}
              {emagSamedayError && <div>⚠️ Sameday: {emagSamedayError}</div>}
            </div>
          )}
          {!hasRun && !anyLoading && <div>Numerele de mai jos (GLS TOTAL/SAMEDAY TOTAL, pe magazin) se calculează din baza de date și, pentru intervale scurte, din MyGLS/Sameday live — click „⟳ Resincronizează" dacă nu s-au actualizat încă.</div>}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, textTransform: 'uppercase', letterSpacing: .4 }}>{label}</div>
    </div>
  );
}

function CourierBadge({ courier }) {
  if (!courier) return <span style={{ fontSize: 9, color: '#334155', border: '1px solid #334155', borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }}>— fără AWB</span>;
  const isGls = courier === 'gls';
  const isSameday = courier === 'sameday';
  return (
    <span style={{ fontSize: 9, fontWeight: 700, color: isGls ? '#3b82f6' : isSameday ? '#a855f7' : '#94a3b8', border: `1px solid ${isGls ? '#3b82f6' : isSameday ? '#a855f7' : '#334155'}`, borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }}>
      {isGls ? '📦 GLS' : isSameday ? '🚀 Sameday' : courier}
    </span>
  );
}

function StatusBadge({ o }) {
  if (o.cancelled) return <span style={{ fontSize: 9, color: '#64748b' }}>Anulată</span>;
  if (o.returned) return <span style={{ fontSize: 9, color: '#f43f5e' }}>Retur</span>;
  if (o.delivered) return <span style={{ fontSize: 9, color: '#10b981' }}>Livrată</span>;
  if (o.courier) return <span style={{ fontSize: 9, color: '#f59e0b' }}>Tranzit</span>;
  return <span style={{ fontSize: 9, color: '#475569' }}>—</span>;
}

/** Listă de comenzi reale (dintr-un magazin Shopify), cu curierul GLS/Sameday
 * și statusul de livrare per comandă — rezultatul /api/stats-totale/order-list.
 * Filtrată după statusFilter (implicit: doar livrate/refuzate/tranzit — vezi
 * STATUS_META mai sus). */
/** Rândul "📦 GLS TOTAL" / "🚀 SAMEDAY TOTAL" de la începutul fiecărei luni —
 * vizibil ÎNAINTE de a desface vreun magazin (numărul vine din cache-ul
 * pre-încărcat), cu propriul lui expand/collapse, ca un mic KPI clicabil. */
function CourierTotalTile({ label, icon, color, rows, pending, onOpen }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ flex: '1 1 150px', minWidth: 150 }}>
      <div onClick={() => setOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0b0f14', border: `1px solid ${color}55`, borderRadius: 8, padding: '8px 10px', cursor: 'pointer' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color }}>{icon} {label}</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 15, color: '#e2e8f0' }}>{pending ? '…' : fmtInt(rows.length)}</span>
      </div>
      {!pending && rows.some(r => r._kind === 'sd_parcel') && (() => {
        const c = { order: 0, emag: 0, shop: 0, client_return: 0 };
        for (const r of rows) c[r._kind === 'sd_parcel' ? r.sdKind : 'order']++;
        return (
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span>{c.order} magazin</span>
            {!!c.emag && <span style={{ color: '#eab308' }}>{c.emag} eMAG</span>}
            {!!c.client_return && <span style={{ color: '#38bdf8' }}>{c.client_return} retur client</span>}
          </div>
        );
      })()}
      {open && (
        <div style={{ marginTop: 4, padding: '6px 8px', background: '#0b0f14', border: `1px solid ${color}22`, borderRadius: 8 }}>
          {pending ? (
            <div style={{ fontSize: 11, color: '#64748b' }}>Se încarcă încă unele magazine...</div>
          ) : !rows.length ? (
            <div style={{ fontSize: 11, color: '#475569' }}>Nimic de afișat.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
              {rows.map((o, i) => (
                <div key={i} onClick={() => onOpen(o._kind === 'order' ? { kind: 'order', id: o.id }
                  : o._kind === 'sd_parcel' ? { kind: 'parcel', awb: o.parcelNumber, courier: 'sameday', sdKind: o.sdKind }
                  : { kind: 'parcel', awb: o.parcelNumber, courier: 'gls', name: o.name, city: o.city, cod: o.cod, codCurrency: o.codCurrency, ref: o.ref })}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0', cursor: 'pointer', borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,.03)' : 'none' }}>
                  {o._kind !== 'sd_parcel' && <span style={{ color: SHOP_META[o._shopKey]?.color || '#94a3b8', fontWeight: 700, width: 72, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {SHOP_META[o._shopKey]?.flag} {SHOP_META[o._shopKey]?.label}
                  </span>}
                  {o._kind === 'sd_parcel' ? (
                    <>
                      <span style={{ color: o.sdKind === 'client_return' ? '#38bdf8' : o.sdKind === 'emag' ? '#eab308' : '#94a3b8', fontWeight: 700, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{SD_KIND_LABEL[o.sdKind]}</span>
                      <span style={{ color: '#a855f7', fontFamily: 'monospace', flexShrink: 0 }}>{o.parcelNumber}</span>
                    </>
                  ) : o._kind === 'order' ? (
                    <>
                      <span style={{ color: '#cbd5e1', fontWeight: 700, width: 60, flexShrink: 0 }}>{o.name}</span>
                      <span style={{ color: '#64748b', width: 78, flexShrink: 0 }}>{new Date(o.date).toLocaleDateString('ro-RO')}</span>
                      <span style={{ fontFamily: 'monospace', color: '#e2e8f0', flex: 1, textAlign: 'right' }}>{fmt(o.total)} {o.currency}</span>
                      <StatusBadge o={o} />
                    </>
                  ) : (
                    <>
                      <span style={{ color: '#f97316', fontFamily: 'monospace', width: 90, flexShrink: 0 }}>{o.parcelNumber}</span>
                      <span style={{ color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name || '(fără nume)'}, {o.city || '—'}</span>
                      {o.returned && <span style={{ color: '#f43f5e', flexShrink: 0 }}>Retur</span>}
                      {o.delivered && <span style={{ color: '#10b981', flexShrink: 0 }}>Livrat</span>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CourierBreakdown({ counts }) {
  const present = COURIER_ORDER.filter(k => counts[k]);
  if (!present.length) return null;
  return (
    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {present.map(k => (
        <span key={k}><span style={{ color: COURIER_META[k].color, fontWeight: 700 }}>{COURIER_META[k].label}</span>: {counts[k]}</span>
      ))}
    </div>
  );
}

function OrderRows({ rows, statusFilter, courierFilter, onOpen }) {
  const statusFiltered = rows.filter(o => statusFilter.has(orderStatusKey(o)));
  const filtered = statusFiltered.filter(o => courierFilter.has(courierKey(o)));
  const courierCounts = statusFiltered.reduce((acc, o) => { const k = courierKey(o); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  if (!filtered.length) {
    return (
      <>
        <CourierBreakdown counts={courierCounts} />
        <div style={{ fontSize: 11, color: '#475569' }}>Nicio comandă cu filtrele selectate ({rows.length - filtered.length} ascunse de filtru).</div>
      </>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
      <CourierBreakdown counts={courierCounts} />
      {filtered.length < rows.length && <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>{filtered.length} din {rows.length} afișate (filtru status/curier)</div>}
      {filtered.map((o, i) => (
        <div key={i} onClick={() => o.id && onOpen({ kind: 'order', id: o.id })} title="Detalii comandă"
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0', cursor: o.id ? 'pointer' : 'default', borderBottom: i < filtered.length - 1 ? '1px solid rgba(255,255,255,.03)' : 'none' }}>
          <span style={{ color: '#cbd5e1', fontWeight: 700, width: 70, flexShrink: 0 }}>{o.name}</span>
          <span style={{ color: '#64748b', width: 80, flexShrink: 0 }}>{new Date(o.date).toLocaleDateString('ro-RO')}</span>
          <span style={{ color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{o.customer}</span>
          <span style={{ fontFamily: 'monospace', color: '#e2e8f0', flexShrink: 0 }}>{fmt(o.total)} {o.currency}</span>
          <CourierBadge courier={o.courier} />
          <StatusBadge o={o} />
        </div>
      ))}
    </div>
  );
}

/** Colete GLS neatribuite niciunui magazin — doar un eșantion de detaliu
 * (ref/nume/oraș), fiindcă nu există un Order la noi pentru ele. Nu au
 * statusurile "Anulată"/"Fără AWB" (orice colet din MyGLS are, prin
 * definiție, un AWB) — filtrul se aplică doar pe livrat/refuzat/tranzit. */
function GlsDetailRows({ rows, statusFilter, courierFilter, onOpen }) {
  if (!courierFilter.has('gls')) return <div style={{ fontSize: 11, color: '#475569' }}>Filtrul de curier exclude GLS — toate coletele neatribuite sunt GLS.</div>;
  const filtered = rows.filter(p => statusFilter.has(glsDetailStatusKey(p)));
  if (!filtered.length) return <div style={{ fontSize: 11, color: '#475569' }}>Niciun colet cu statusul selectat ({rows.length} ascunse de filtru).</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto', fontFamily: 'monospace' }}>
      {filtered.length < rows.length && <div style={{ fontSize: 10, color: '#475569', marginBottom: 2, fontFamily: 'system-ui, sans-serif' }}>{filtered.length} din {rows.length} afișate (filtru status)</div>}
      {filtered.map((p, i) => (
        <div key={i} onClick={() => onOpen({ kind: 'parcel', awb: p.parcelNumber, courier: 'gls', name: p.name, city: p.city, cod: p.cod, codCurrency: p.codCurrency, ref: p.ref })}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, padding: '3px 0', cursor: 'pointer', borderBottom: i < filtered.length - 1 ? '1px solid rgba(255,255,255,.03)' : 'none' }}>
          <span style={{ color: '#f97316', width: 95, flexShrink: 0 }}>{p.parcelNumber}</span>
          <span style={{ color: '#64748b', width: 70, flexShrink: 0 }} title="ClientReference de pe AWB">ref: {p.ref || '—'}</span>
          <span style={{ color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{p.name || '(fără nume)'}, {p.city || '—'}</span>
          {!!p.cod && <span style={{ color: '#10b981', flexShrink: 0 }}>{fmt(p.cod)} {p.codCurrency || ''}</span>}
          {p.returned && <span style={{ color: '#f43f5e', flexShrink: 0 }}>Retur</span>}
          {p.delivered && <span style={{ color: '#10b981', flexShrink: 0 }}>Livrat</span>}
        </div>
      ))}
    </div>
  );
}

/** Comenzi eMAG din importul local (localStorage) — disponibile doar dacă
 * au fost importate pe pagina /emag; numărul exact pe lună e cel de pe rândul
 * eMAG (din Sameday), nu neapărat egal cu nr. de rânduri de aici. */
function EmagRows({ rows, onOpen, liveAwbs = [] }) {
  const localAwbs = new Set(rows.map(o => (o.awb || '').trim()).filter(Boolean));
  const onlyLive = liveAwbs.filter(a => !localAwbs.has(a));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
      {onlyLive.map(awb => (
        <div key={awb} onClick={() => onOpen({ kind: 'parcel', awb, courier: 'sameday', sdKind: 'emag' })}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
          <span style={{ color: '#eab308', fontFamily: 'monospace', flex: 1 }}>AWB {awb}</span>
          <span style={{ color: '#64748b', fontSize: 10 }}>📡 din Sameday, neimportat local</span>
        </div>
      ))}
      {rows.map((o, i) => (
        <div key={i} onClick={() => onOpen({ kind: 'emag', order: o })}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0', cursor: 'pointer', borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,.03)' : 'none' }}>
          <span style={{ color: '#cbd5e1', width: 90, flexShrink: 0 }}>{o.orderId || o.id}</span>
          <span style={{ color: '#94a3b8', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
          <span style={{ color: '#64748b', flexShrink: 0 }}>{o.date}</span>
          <span style={{ color: '#eab308', flexShrink: 0 }}>{o.awb ? `AWB ${o.awb}` : '—'}</span>
        </div>
      ))}
    </div>
  );
}

const inpStyle = { background: '#161d24', border: '1px solid #243040', color: '#e8edf2', padding: '6px 10px', borderRadius: 7, fontSize: 12, outline: 'none' };
const selStyle = { ...inpStyle, cursor: 'pointer' };
const btnPrimary = { background: '#f97316', color: 'white', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'transparent', border: '1px solid rgba(255,255,255,.1)', color: '#94a3b8', borderRadius: 8, padding: '6px 12px', fontSize: 11, cursor: 'pointer' };
const btnGhostSmall = { ...btnGhost, padding: '4px 10px', fontSize: 10 };
const btnTab = { background: 'transparent', border: '1px solid rgba(255,255,255,.1)', color: '#64748b', borderRadius: 7, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' };
const btnTabActive = { background: 'rgba(249,115,22,.15)', borderColor: '#f97316', color: '#f97316' };
const errBox = { background: 'rgba(244,63,94,.08)', border: '1px solid rgba(244,63,94,.25)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f43f5e', marginBottom: 14 };

// ─── Fereastra de detaliu comandă ─────────────────────────────────────────────
// Se deschide la click pe orice rând din drill-down. `target` e unul din:
//   { kind: 'order', id }            — comandă Shopify din baza noastră
//   { kind: 'emag', order }          — comandă eMAG din importul local
//   { kind: 'parcel', awb, courier, name, city, cod, codCurrency, ref } — colet GLS fără comandă la noi
// Istoricul AWB vine live din /api/tracking (GET, cache 30 min per AWB).

const SHIPMENT_STATUS_RO = {
  PENDING: 'În așteptare', CREATED: 'AWB creat', IN_TRANSIT: 'În tranzit', OUT_FOR_DELIVERY: 'În livrare',
  DELIVERED: 'Livrat', FAILED_ATTEMPT: 'Livrare eșuată', RETURNED: 'Retur', FAILED: 'Eroare', CANCELLED: 'Anulat',
};
const LIVE_STATUS_RO = {
  delivered: 'Livrat', out_for_delivery: 'În livrare azi', returned: 'Retur', failed_attempt: 'Tentativă eșuată',
  in_transit: 'În tranzit', easybox: 'În easybox',
};

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0') && d.length === 10) return '40' + d.slice(1);
  if (d.startsWith('06') && d.length === 11) return '36' + d.slice(2);
  return d;
}

function copyText(t) { try { navigator.clipboard.writeText(t); } catch {} }

function DetailSection({ title, children, right }) {
  return (
    <div style={{ background: '#0b0f14', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
        <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function DetailLine({ label, value, mono, copy, href }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0', alignItems: 'baseline' }}>
      <span style={{ color: '#64748b', width: 72, flexShrink: 0, fontSize: 11 }}>{label}</span>
      {href
        ? <a href={href} target="_blank" rel="noreferrer" style={{ color: '#93c5fd', flex: 1, minWidth: 0, wordBreak: 'break-word', fontFamily: mono ? 'monospace' : undefined, textDecoration: 'none' }}>{value}</a>
        : <span style={{ color: '#e2e8f0', flex: 1, minWidth: 0, wordBreak: 'break-word', fontFamily: mono ? 'monospace' : undefined }}>{value}</span>}
      {copy && <button onClick={() => copyText(String(value))} title="Copiază" style={{ ...btnGhost, padding: '2px 7px', fontSize: 10 }}>📋</button>}
    </div>
  );
}

function AwbHistory({ awb, courier }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    fetch(`/api/tracking?awb=${encodeURIComponent(awb)}&courier=${encodeURIComponent(courier || 'gls')}`)
      .then(r => r.json())
      .then(d => { if (alive) setState({ loading: false, data: d }); })
      .catch(e => { if (alive) setState({ loading: false, error: e.message }); });
    return () => { alive = false; };
  }, [awb, courier]);

  if (state.loading) return <div style={{ fontSize: 11, color: '#64748b' }}>Se încarcă istoricul AWB...</div>;
  if (state.error || state.data?.error) return <div style={{ fontSize: 11, color: '#f43f5e' }}>⚠️ {state.error || state.data.error}</div>;
  const d = state.data || {};
  const history = d.history || [];
  if (!d.status && !history.length) return <div style={{ fontSize: 11, color: '#475569' }}>Curierul nu a returnat încă niciun status pentru acest AWB.</div>;
  return (
    <div>
      <div style={{ fontSize: 12, color: '#e2e8f0', marginBottom: 8 }}>
        Acum: <b style={{ color: d.status === 'delivered' ? '#10b981' : d.status === 'returned' ? '#f43f5e' : '#f59e0b' }}>{LIVE_STATUS_RO[d.status] || d.status || '—'}</b>
        {d.statusDescription && <span style={{ color: '#94a3b8' }}> · {d.statusDescription}</span>}
        {d.hasReturnCode && d.status !== 'returned' && <span style={{ color: '#f43f5e' }}> · are cod de refuz/retur în istoric</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {history.map((h, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, position: 'relative', paddingBottom: i < history.length - 1 ? 10 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 10, flexShrink: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: 9, background: i === 0 ? '#f97316' : '#334155', marginTop: 4 }} />
              {i < history.length - 1 && <span style={{ flex: 1, width: 1, background: '#1e293b', marginTop: 2 }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: i === 0 ? '#e2e8f0' : '#cbd5e1' }}>{h.description || `Cod ${h.code}`}</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>{fmtDateTime(h.date)}{h.location ? ` · ${h.location}` : ''}{h.code != null ? ` · cod ${h.code}` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContactButtons({ phone, email, name }) {
  const wa = waNumber(phone);
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      {phone && <a href={`tel:${String(phone).replace(/\s/g, '')}`} style={{ ...btnGhost, textDecoration: 'none', color: '#e2e8f0' }}>📞 Sună</a>}
      {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" style={{ ...btnGhost, textDecoration: 'none', color: '#25D366' }}>💬 WhatsApp</a>}
      {email && <a href={`mailto:${email}`} style={{ ...btnGhost, textDecoration: 'none', color: '#93c5fd' }}>✉️ Email</a>}
      {name && <button onClick={() => copyText([name, phone, email].filter(Boolean).join('\n'))} style={btnGhost}>📋 Copiază contact</button>}
    </div>
  );
}

function OrderDetailModal({ target, onClose }) {
  const [state, setState] = useState({ loading: target.kind === 'order' });

  useEffect(() => {
    if (target.kind !== 'order') return;
    let alive = true;
    fetch(`/api/stats-totale/order-detail?id=${encodeURIComponent(target.id)}`)
      .then(r => r.json())
      .then(d => { if (alive) setState(d.ok ? { loading: false, order: d.order } : { loading: false, error: d.error || 'Eroare' }); })
      .catch(e => { if (alive) setState({ loading: false, error: e.message }); });
    return () => { alive = false; };
  }, [target]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const o = state.order;
  let body = null;

  if (target.kind === 'order') {
    if (state.loading) body = <div style={{ color: '#64748b', fontSize: 13, padding: 20, textAlign: 'center' }}>Se încarcă comanda...</div>;
    else if (state.error) body = <div style={errBox}>⚠️ {state.error}</div>;
    else if (o) {
      const items = Array.isArray(o.lineItems) ? o.lineItems : [];
      const products = items.filter(i => !i.isShipping && !i.isDiscount);
      const shippingItems = items.filter(i => i.isShipping);
      const discountItems = items.filter(i => i.isDiscount);
      const addr = [o.shipping.address1, o.shipping.address2].filter(Boolean).join(', ');
      const cityLine = [o.shipping.zip, o.shipping.city, o.shipping.province, o.shipping.country].filter(Boolean).join(', ');
      const fullAddr = [addr, cityLine].filter(Boolean).join(', ');
      const cod = !o.payment.online;
      body = (
        <>
          <DetailSection title="Comandă">
            <DetailLine label="Nr." value={o.name} copy />
            <DetailLine label="Data" value={fmtDateTime(o.date)} />
            <DetailLine label="Total" value={`${fmt(o.total)} ${o.currency}`} />
            <DetailLine label="Status" value={[o.status === 'CANCELLED' ? 'Anulată' : null, o.cancelReason, o.financialStatus && `plată: ${o.financialStatus}`, o.fulfillmentStatus && `expediere: ${o.fulfillmentStatus}`].filter(Boolean).join(' · ')} />
            {o.invoices.map(inv => <DetailLine key={inv.number} label="Factură" value={`${inv.number}${inv.collected ? ' · încasată' : ''}`} href={inv.url || undefined} />)}
            <DetailLine label="Shopify" value={o.shopifyAdminUrl ? 'Deschide în Shopify Admin' : ''} href={o.shopifyAdminUrl || undefined} />
          </DetailSection>

          <DetailSection title="Plată">
            <div style={{ fontSize: 15, fontWeight: 800, color: cod ? '#f59e0b' : '#10b981' }}>
              {cod ? '💵 Ramburs (cash la livrare)' : '💳 Card online'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {o.payment.gateway || 'fără gateway'} · {o.payment.isPaid ? 'plătită' : 'neplătită încă'}
              {o.shipments.some(s => s.cod) && ` · ramburs pe AWB: ${o.shipments.filter(s => s.cod).map(s => `${fmt(s.cod)} ${o.currency}`).join(', ')}`}
            </div>
          </DetailSection>

          <DetailSection title="Client">
            <DetailLine label="Nume" value={o.customer.name} copy />
            <DetailLine label="Telefon" value={o.customer.phone} mono copy />
            <DetailLine label="Email" value={o.customer.email} copy />
            <DetailLine label="Comenzi" value={o.customer.ordersCount != null ? `${o.customer.ordersCount} în total la acest client` : ''} />
            <ContactButtons phone={o.customer.phone} email={o.customer.email} name={o.customer.name} />
          </DetailSection>

          <DetailSection title="Adresă de livrare">
            <DetailLine label="Adresă" value={addr} copy />
            <DetailLine label="Localitate" value={cityLine} />
            <DetailLine label="Metodă" value={o.shipping.method} />
            {fullAddr && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddr)}`} target="_blank" rel="noreferrer" style={{ ...btnGhost, textDecoration: 'none', color: '#e2e8f0' }}>🗺️ Hartă</a>
                <button onClick={() => copyText(`${o.customer.name}\n${fullAddr}\n${o.customer.phone}`)} style={btnGhost}>📋 Copiază adresa</button>
              </div>
            )}
            {o.billing && (o.billing.company || o.billing.address1 !== o.shipping.address1) && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                Facturare: {[o.billing.company, o.billing.name, o.billing.address1, o.billing.address2, o.billing.zip, o.billing.city, o.billing.province].filter(Boolean).join(', ')}
              </div>
            )}
          </DetailSection>

          <DetailSection title={`Produse (${products.reduce((s, i) => s + (Number(i.qty) || 1), 0)})`}>
            {products.map((i, k) => (
              <div key={k} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                <span style={{ color: '#f97316', fontWeight: 800, width: 28, flexShrink: 0 }}>{i.qty}×</span>
                <span style={{ color: '#e2e8f0', flex: 1, minWidth: 0 }}>{i.name}{i.sku && <span style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}> · {i.sku}</span>}</span>
                <span style={{ color: '#cbd5e1', fontFamily: 'monospace', flexShrink: 0 }}>{fmt(i.price * (Number(i.qty) || 1))}</span>
              </div>
            ))}
            {shippingItems.map((i, k) => <div key={`s${k}`} style={{ display: 'flex', fontSize: 12, padding: '3px 0', color: '#94a3b8' }}><span style={{ flex: 1 }}>🚚 {i.name}</span><span style={{ fontFamily: 'monospace' }}>{fmt(i.price)}</span></div>)}
            {discountItems.map((i, k) => <div key={`d${k}`} style={{ display: 'flex', fontSize: 12, padding: '3px 0', color: '#10b981' }}><span style={{ flex: 1 }}>🏷️ {i.name}</span><span style={{ fontFamily: 'monospace' }}>−{fmt(i.price)}</span></div>)}
            <div style={{ display: 'flex', fontSize: 14, fontWeight: 800, paddingTop: 6, color: '#e2e8f0' }}><span style={{ flex: 1 }}>Total</span><span style={{ fontFamily: 'monospace' }}>{fmt(o.total)} {o.currency}</span></div>
            {o.note && <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 8 }}>📝 Notă client: {o.note}</div>}
            {o.tags && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Tag-uri: {o.tags}</div>}
          </DetailSection>

          {o.shipments.length === 0 && <DetailSection title="AWB"><div style={{ fontSize: 12, color: '#475569' }}>Nu există AWB pentru această comandă.</div></DetailSection>}
          {o.shipments.map(s => (
            <DetailSection key={s.awb} title={`AWB ${s.courier === 'sameday' ? 'Sameday' : s.courier === 'gls' ? 'GLS' : s.courier}`}
              right={<CourierBadge courier={s.courier} />}>
              <DetailLine label="AWB" value={s.awb} mono copy href={s.trackingUrl || undefined} />
              <DetailLine label="Status" value={`${SHIPMENT_STATUS_RO[s.status] || s.status}${s.deliveredAt ? ` · ${fmtDateTime(s.deliveredAt)}` : ''}`} />
              <DetailLine label="Creat" value={fmtDateTime(s.createdAt)} />
              <DetailLine label="Colet" value={[s.parcels ? `${s.parcels} colet(e)` : '', s.weight ? `${s.weight} kg` : '', s.cod ? `ramburs ${fmt(s.cod)} ${o.currency}` : ''].filter(Boolean).join(' · ')} />
              <div style={{ borderTop: '1px solid rgba(255,255,255,.05)', marginTop: 8, paddingTop: 8 }}>
                <AwbHistory awb={s.awb} courier={s.courier} />
              </div>
            </DetailSection>
          ))}
        </>
      );
    }
  } else if (target.kind === 'emag') {
    const e = target.order;
    const online = emagIsOnline(e.payMode);
    const total = (e.products || []).reduce((s, p) => s + (p.price || 0) * (p.qty || 1), 0);
    body = (
      <>
        <DetailSection title="Comandă eMAG">
          <DetailLine label="Nr." value={e.orderId || e.id} copy />
          <DetailLine label="Data" value={e.date} />
          <DetailLine label="Status" value={e.status} />
          <DetailLine label="Livrare" value={[e.delivMode, e.delivPoint].filter(Boolean).join(' · ')} />
        </DetailSection>
        <DetailSection title="Plată">
          <div style={{ fontSize: 15, fontWeight: 800, color: online ? '#10b981' : '#f59e0b' }}>{online ? '💳 Card online' : '💵 Ramburs (cash la livrare)'}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{e.payMode || '—'}</div>
        </DetailSection>
        <DetailSection title="Client">
          <DetailLine label="Nume" value={e.name} copy />
          <DetailLine label="Telefon" value={e.phone} mono copy />
          <DetailLine label="Adresă" value={[e.address, e.zip].filter(Boolean).join(', ')} copy />
          <ContactButtons phone={e.phone} name={e.name} />
        </DetailSection>
        <DetailSection title={`Produse (${(e.products || []).length})`}>
          {(e.products || []).map((p, k) => (
            <div key={k} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
              <span style={{ color: '#f97316', fontWeight: 800, width: 28, flexShrink: 0 }}>{p.qty}×</span>
              <span style={{ color: '#e2e8f0', flex: 1, minWidth: 0 }} title={p.fullName}>{p.name || p.fullName}</span>
              <span style={{ color: '#cbd5e1', fontFamily: 'monospace', flexShrink: 0 }}>{fmt((p.price || 0) * (p.qty || 1))}</span>
            </div>
          ))}
          {total > 0 && <div style={{ display: 'flex', fontSize: 14, fontWeight: 800, paddingTop: 6, color: '#e2e8f0' }}><span style={{ flex: 1 }}>Total</span><span style={{ fontFamily: 'monospace' }}>{fmt(total)} RON</span></div>}
        </DetailSection>
        <DetailSection title="AWB">
          {e.awb ? <><DetailLine label="AWB" value={e.awb} mono copy /><div style={{ borderTop: '1px solid rgba(255,255,255,.05)', marginTop: 8, paddingTop: 8 }}><AwbHistory awb={e.awb} courier="sameday" /></div></>
            : <div style={{ fontSize: 12, color: '#475569' }}>Fără AWB în import.</div>}
        </DetailSection>
      </>
    );
  } else {
    body = (
      <>
        <DetailSection title={target.courier === 'sameday'
          ? (target.sdKind === 'client_return' ? 'Retur de la client (Sameday)' : target.sdKind === 'emag' ? 'Colet eMAG (Sameday)' : 'Colet Sameday fără comandă în baza noastră')
          : 'Colet GLS (fără comandă în baza noastră)'}>
          <DetailLine label="AWB" value={target.awb} mono copy />
          <DetailLine label="Ref." value={target.ref} copy />
          <DetailLine label="Destinatar" value={target.name} copy />
          <DetailLine label="Oraș" value={target.city} />
          <DetailLine label="Ramburs" value={target.cod ? `${fmt(target.cod)} ${target.codCurrency || ''}` : ''} />
          {target.sdKind === 'client_return' && <div style={{ fontSize: 12, color: '#38bdf8', marginTop: 4 }}>↩ Clientul trimite produsul înapoi către noi. Nu e un refuz și nu e o comandă nouă: „Livrat” înseamnă că a ajuns la noi.</div>}
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{target.sdKind === 'emag' ? 'Detaliile complete (client, produse) apar dacă imporți comenzile eMAG pe pagina /emag.' : 'Telefonul, emailul și produsele nu sunt disponibile: coletul nu e legat de nicio comandă Shopify sincronizată.'}</div>
        </DetailSection>
        <DetailSection title="Istoric AWB"><AwbHistory awb={target.awb} courier={target.courier || 'gls'} /></DetailSection>
      </>
    );
  }

  const title = target.kind === 'order' ? (o?.name || 'Comandă') : target.kind === 'emag' ? `eMAG ${target.order.orderId || ''}` : `AWB ${target.awb}`;
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.75)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '16px 10px', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 620, background: '#0f1419', border: '1px solid rgba(255,255,255,.1)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, background: '#0f1419', paddingBottom: 4, zIndex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0', flex: 1 }}>{title}</div>
          <button onClick={onClose} style={{ ...btnGhost, fontSize: 14, padding: '4px 10px' }}>✕</button>
        </div>
        {body}
      </div>
    </div>
  );
}
