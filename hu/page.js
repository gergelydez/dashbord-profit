'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

// Helper safe pentru localStorage — returnează null pe server (SSR/prerender)
const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { if (typeof window !== 'undefined') localStorage.removeItem(k); } catch {} },
};

// ── MULTI-SHOP HELPERS ─────────────────────────────────────────────────────
function getShopKey() { return 'hu'; }
// Per-shop localStorage keys — RO uses legacy keys for backward compat
const ordersKey = (sk) => sk === 'ro' ? 'gx_orders_all'    : `gx_orders_all_${sk}`;
const tokenKey  = (sk) => sk === 'ro' ? 'gx_t'             : `gx_t_${sk}`;
const domainKey = (sk) => sk === 'ro' ? 'gx_d'             : `gx_d_${sk}`;

const PS = 25;
const STATUS_MAP = {
  livrat:  { label: '✅ Livrat' },
  incurs:  { label: '🚚 Tranzit' },
  outfor:  { label: '📬 La curier' },
  retur:   { label: '↩️ Retur' },
  anulat:  { label: '❌ Anulat' },
  pending: { label: '⏳ Neexpediat' },
};

const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

function getRange(preset, customFrom, customTo) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  switch (preset) {
    case 'today':       return { from: toISO(now), to: toISO(now) };
    case 'yesterday':   { const y2 = new Date(y,m,d-1); return { from: toISO(y2), to: toISO(y2) }; }
    case 'week':        return { from: toISO(new Date(y,m,d-6)), to: toISO(now) };
    case 'month':       return { from: `${y}-${pad(m+1)}-01`, to: toISO(now) };
    case 'last_month':  { const lm = new Date(y,m,0); return { from: `${lm.getFullYear()}-${pad(lm.getMonth()+1)}-01`, to: toISO(lm) }; }
    case 'last_7':      return { from: toISO(new Date(y,m,d-6)), to: toISO(now) };
    case 'last_30':     return { from: toISO(new Date(y,m,d-29)), to: toISO(now) };
    case 'last_90':     return { from: toISO(new Date(y,m,d-89)), to: toISO(now) };
    case 'year':        return { from: `${y}-01-01`, to: toISO(now) };
    case 'custom':      return { from: customFrom, to: customTo };
    default:            return { from: toISO(new Date(y,m,d-29)), to: toISO(now) };
  }
}

const PRESETS = [
  { id: 'today',      label: 'Azi' },
  { id: 'yesterday',  label: 'Ieri' },
  { id: 'week',       label: '7 zile' },
  { id: 'last_30',    label: '30 zile' },
  { id: 'month',      label: 'Luna aceasta' },
  { id: 'last_month', label: 'Luna trecută' },
  { id: 'last_90',    label: '90 zile' },
  { id: 'year',       label: 'Anul acesta' },
  { id: 'custom',     label: '📅 Custom' },
];

// ── TRACKING OVERRIDES ── statusuri persistente care supraviețuiesc sync-ului Shopify
const trackingOverrides = {
  get: () => { try { const s = typeof window!=='undefined'?localStorage.getItem('gx_track_ov'):null; return s?JSON.parse(s):{}; } catch { return {}; } },
  set: (map) => { try { if(typeof window!=='undefined') localStorage.setItem('gx_track_ov', JSON.stringify(map)); } catch {} },
  update: (id, data) => { const m=trackingOverrides.get(); m[id]={...data,at:new Date().toISOString()}; trackingOverrides.set(m); },
};

function applyTrackingOverrides(orders) {
  const ov = trackingOverrides.get();
  const now = new Date();

  return orders.map(o => {
    // Dacă e anulată în Shopify → anulat (indiferent de orice override)
    if (o.ts === 'incurs' || o.ts === 'outfor') {
      // Anulată sau în tranzit >30 zile → scoatem din tranzit
      const daysSince = o.createdAt
        ? (now - new Date(o.createdAt)) / (1000 * 60 * 60 * 24)
        : 999;
      if (daysSince > 30) {
        return { ...o, ts: 'anulat' };
      }
    }

    // Prioritate: tracking overrides (din GLS API live)
    const override = ov[o.id];
    if (!override) return o;
    // Nu aplicăm override dacă e anulată
    if (o.fin === 'voided' || o.fin === 'refunded') return { ...o, ts: 'anulat' };
    return { ...o,
      ts: override.ts,
      trackingStatus: override.statusRaw || o.trackingStatus,
      trackingLastUpdate: override.lastUpdate || o.trackingLastUpdate,
      trackingLocation: override.location || o.trackingLocation,
    };
  });
}

function procOrder(o) {
  let ts = 'pending', fulfilledAt = '', trackingNo = '';
  if (o.fulfillments?.length > 0) {
    // Prioritizăm fulfillment-ul cu 'delivered', altfel ultimul
    const deliveredF = o.fulfillments.find(f => (f.shipment_status||'').toLowerCase() === 'delivered');
    const f = deliveredF || o.fulfillments[o.fulfillments.length - 1];
    fulfilledAt = f.updated_at || f.created_at || '';
    trackingNo = f.tracking_number || '';
    const ss = (f.shipment_status || '').toLowerCase();
    if (!ss || ss === 'null') { /* shipment_status gol/null — lăsăm cancelled_at să decidă */ }
    else if (ss === 'delivered') ts = 'livrat';
    else if (['failure','failed_attempt','returned','failed_delivery','return_in_progress'].includes(ss)) ts = 'retur';
    else if (ss === 'out_for_delivery') ts = 'outfor';
    else if (ss === 'label_printed') ts = 'pending'; // AWB printat dar NEPREDAT curierului
    else if (['in_transit','confirmed'].includes(ss)) {
      // Preluat de curier — dacă >10 zile fără update = xConnector blocat = livrat
      if (fulfilledAt) {
        const daysSince = (new Date() - new Date(fulfilledAt)) / (1000 * 60 * 60 * 24);
        ts = daysSince > 10 ? 'livrat' : 'incurs';
      } else { ts = 'incurs'; }
    }
    else if (ss === 'failed_attempt') {
      // Tentativă de livrare eșuată — mai încearcă
      ts = 'outfor'; // afișăm ca "la curier" că va reîncerca
    }
    else if (o.fulfillment_status === 'fulfilled') {
      // fulfillment creat dar fără shipment_status clar
      if (fulfilledAt) {
        const daysSince = (new Date() - new Date(fulfilledAt)) / (1000 * 60 * 60 * 24);
        ts = daysSince > 10 ? 'livrat' : 'incurs';
      } else { ts = 'incurs'; }
    }
  }
  if (o.cancelled_at) ts = 'anulat';
  const addr = o.shipping_address || o.billing_address || {};
  const prods = (o.line_items || []).map(i => i.name || '').join(' + ');
  const fulfillmentData = (o.fulfillments || []).find(f => f.tracking_company || f.tracking_number);
  const trackingCompany = (fulfillmentData?.tracking_company || '').toLowerCase();
  const courier = trackingCompany.includes('sameday') || trackingCompany.includes('same day') ? 'sameday'
                : trackingCompany.includes('gls') || trackingCompany.includes('mygls') ? 'gls'
                : trackingCompany.includes('fan') ? 'fan'
                : trackingCompany.includes('cargus') ? 'cargus'
                : trackingCompany.includes('dpd') ? 'dpd'
                : trackingCompany ? 'other' : 'unknown';
  const notes = o.note_attributes || [];
  const invUrlAttr   = notes.find(a => (a.name||'').toLowerCase().includes('invoice-url') && !(a.name||'').toLowerCase().includes('short'));
  const invShortAttr = notes.find(a => (a.name||'').toLowerCase().includes('invoice-short-url'));
  const invoiceUrl   = invUrlAttr?.value || '';
  const invoiceShort = invShortAttr?.value || '';
  const invNumMatch  = invoiceUrl.match(/[?&]n=(\d+)/);
  const invoiceNumber = invNumMatch ? invNumMatch[1] : '';
  const hasInvoice   = !!(invoiceUrl || invoiceShort);
  return {
    id: o.id, name: o.name || '', fin: o.financial_status || '', ts,
    trackingNo, client: addr.name || '', oras: addr.city || '',
    total: parseFloat(o.total_price) || 0,
    prods, prodShort: prods.length > 45 ? prods.slice(0, 45) + '…' : prods,
    createdAt: o.created_at || '', fulfilledAt, courier, trackingCompany: fulfillmentData?.tracking_company || '',
    invoiceNumber, hasInvoice, invoiceUrl, invoiceShort,
    gateway: o.payment_gateway || '',
    paidAt: o.processed_at || '',
    currency: o.presentment_currency || o.currency || 'RON',
    address: [addr.address1, addr.address2].filter(Boolean).join(', '),
    county: addr.province || '',
    zip: addr.zip || '',
    phone: o.phone || addr.phone || '',
    clientEmail: o.email || '',
    utmSource: o.utmSource || '', utmMedium: o.utmMedium || '',
    utmCampaign: o.utmCampaign || '', referrerUrl: o.referrerUrl || '',
    items: (o.line_items || []).map(i => ({
      name: i.name || i.title || 'Produs',
      sku: i.sku || '',
      qty: i.quantity || 1,
      price: parseFloat(i.price) || 0,
      variantId: String(i.variant_id || ''),
    })),
    // Validare adresă locală (detectare rapidă fără API)
    addrIssues: (() => {
      const issues = [];
      if (!addr.name || addr.name.trim().length < 3) issues.push('Nume lipsă');
      if (!addr.address1 || addr.address1.trim().length < 5) issues.push('Adresă incompletă');
      else if (!/\d/.test(addr.address1)) issues.push('Fără număr stradal');
      if (!addr.city || addr.city.trim().length < 2) issues.push('Oraș lipsă');
      const ph = (o.phone || addr.phone || '').replace(/\D/g,'');
      if (ph.length < 10) issues.push('Telefon invalid');
      return issues;
    })(),
  };
}

const fmt = n => Number(n||0).toLocaleString('hu-HU', { minimumFractionDigits:0, maximumFractionDigits:0 });
const CURRENCY = 'HUF';
const fmtD = d => { if (!d) return '—'; try { const p=d.split('T')[0].split('-'); return `${p[2]}.${p[1]}.${p[0]}`; } catch { return d.slice(0,10); } };
const pct = (a,b) => b ? Math.round(a/b*100) : 0;

export default function Dashboard() {
  const [orders, setOrders]     = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [connected, setConnected] = useState(false);
  const [domain, setDomain]     = useState('glamxonline.myshopify.com');
  const [token, setToken]       = useState('');
  const [filter, setFilter]     = useState('toate');
  const [search, setSearch]     = useState('');
  const [pg, setPg]             = useState(1);
  const [sortCol, setSortCol]   = useState(null);
  const [sortDir, setSortDir]   = useState(1);

  const [sdAwbMap, setSdAwbMap] = useState(() => {
    try { const s = ls.get('sd_awb_map'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [sdDone, setSdDone]     = useState(() => { try { return !!ls.get('sd_awb_map'); } catch { return false; } });
  const [sdError, setSdError]   = useState('');
  const [sdLoading, setSdLoading] = useState(false);
  const [sdFiles, setSdFiles]   = useState(() => { try { return JSON.parse(ls.get('sd_files') || '[]'); } catch { return []; } });

  // GLS AWB Map — import din MyGLS Excel
  const [glsAwbMap, setGlsAwbMap] = useState(() => {
    try { const s = ls.get('gls_awb_map'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [glsDone, setGlsDone]     = useState(() => { try { return !!ls.get('gls_awb_map'); } catch { return false; } });
  const [glsError, setGlsError]   = useState('');
  const [glsLoading, setGlsLoading] = useState(false);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingResults, setTrackingResults] = useState({}); // { orderId: { status, statusRaw, lastUpdate, location } }
  const [lastTrackingCheck, setLastTrackingCheck] = useState(null);
  const [glsFiles, setGlsFiles]   = useState(() => { try { return JSON.parse(ls.get('gls_files') || '[]'); } catch { return []; } });
  const [courierFilter, setCourierFilter] = useState('toate');
  const [showTranzitPanel, setShowTranzitPanel] = useState(false);
  const [showLivrateModal, setShowLivrateModal] = useState(false);
  const [showReturModal, setShowReturModal]   = useState(false);

  // ── ADDRESS CORRECTION (ca XConnector) ────────────────────────────────
  const [addrModal, setAddrModal] = useState(null);
  // { order, editFields: {name,email,phone,address,address2,city,county,zip}, validating, issues, suggestion, saving, updateCustomer }
  const [addrValidating, setAddrValidating] = useState(false);
  const [liveTrackingData, setLiveTrackingData] = useState({}); // { orderId: {statusCode, desc, location, lastUpdate, loading} }

  const fetchLiveTracking = async (orders) => {
    for (const o of orders) {
      if (!o.trackingNo) continue;
      setLiveTrackingData(prev => ({...prev, [o.id]: {...prev[o.id], loading: true}}));
      try {
        const r = await fetch(`/api/tracking?awb=${o.trackingNo}&courier=${o.courier||'gls'}`);
        const d = await r.json();
        setLiveTrackingData(prev => ({...prev, [o.id]: {
          loading: false,
          statusCode: d.statusRaw,
          desc: d.statusDescription || d.statusRaw || '—',
          location: d.location || '',
          lastUpdate: d.lastUpdate ? new Date(d.lastUpdate).toLocaleString('ro-RO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '',
          glsStatus: d.status,
        }}));
      } catch {
        setLiveTrackingData(prev => ({...prev, [o.id]: {loading: false, desc: 'Eroare', statusCode: '?'}}));
      }
    }
  };

  const [sbInvLoading, setSbInvLoading] = useState({});
  const [sbInvResults, setSbInvResults] = useState({});
  const [sbInvSeries, setSbInvSeries]   = useState(() => { try { return ls.get('sb_inv_series') || ''; } catch { return ''; } });
  const [sbInvSeriesList, setSbInvSeriesList] = useState([]);
  const [sbBulkLoading, setSbBulkLoading] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null);
  const [sbEmail, setSbEmail] = useState(() => { try { return ls.get('sb_email') || ''; } catch { return ''; } });
  const [sbToken, setSbToken] = useState(() => { try { return ls.get('sb_token') || ''; } catch { return ''; } });
  const [sbCif, setSbCif]     = useState(() => { try { return ls.get('sb_cif')   || ''; } catch { return ''; } });
  const [sbCredsOpen, setSbCredsOpen] = useState(false);
  const [sbUseStock, setSbUseStock]         = useState(() => { try { return ls.get('sb_use_stock') === 'true'; } catch { return false; } });
  const [sbWarehouse, setSbWarehouse]       = useState(() => { try { return ls.get('sb_warehouse') || ''; } catch { return ''; } });
  const [sbPaySeries, setSbPaySeries]       = useState(() => { try { return ls.get('sb_pay_series') || ''; } catch { return ''; } });
  const [sbWarehouseList, setSbWarehouseList] = useState([]);
  const [onlinePaymentIds, setOnlinePaymentIds] = useState(() => {
    try { return JSON.parse(ls.get('online_payment_ids') || '[]'); } catch { return []; }
  });
  const toggleOnlinePayment = (orderId) => {
    setOnlinePaymentIds(prev => {
      const sid = String(orderId);
      const next = prev.includes(sid) ? prev.filter(id => id !== sid) : [...prev, sid];
      ls.set('online_payment_ids', JSON.stringify(next));
      return next;
    });
  };
  const [deliveryMode, setDeliveryMode] = useState('create');

  const [preset, setPreset]         = useState('last_30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [rangeLabel, setRangeLabel] = useState('');
  const [allOrders, setAllOrders]   = useState([]);
  const [lastFetch, setLastFetch]   = useState(null);
  const [fetchedFrom, setFetchedFrom] = useState(null); // cea mai veche dată încărcată
  const [bgLoading, setBgLoading]   = useState(false);  // loading background

  useEffect(() => {
    setTimeout(loadSbSeries, 500);
    // HU: arătăm cache dacă există, apoi fetch fresh din server
    const saved = ls.get(ordersKey('hu'));
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const parsedWithOv = applyTrackingOverrides(parsed);
        setAllOrders(parsedWithOv);
        setConnected(true);
        const ts = ls.get('gx_fetch_time_hu');
        if (ts) setLastFetch(new Date(ts));
        const ff = ls.get('gx_fetched_from_hu');
        if (ff) setFetchedFrom(ff);
        applyDateFilter(parsedWithOv, 'last_30', '', '');
      } catch {}
    }
    // Fetch fresh întotdeauna la pornire
    fetchOrders();
  }, []);

  // ── Shop switch — reîncarcă credențialele și comenzile când se schimbă magazinul
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== 'glamx-shop') return;
      const sk = getShopKey();
      const t = ls.get(tokenKey(sk))  || (sk !== 'ro' ? null : ls.get('gx_t'));
      const d = ls.get(domainKey(sk)) || (sk !== 'ro' ? null : ls.get('gx_d'));
      if (t) setToken(t); else setToken('');
      if (d) setDomain(d);
      const saved = ls.get(ordersKey(sk));
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const withOv = applyTrackingOverrides(parsed);
          setAllOrders(withOv);
          setOrders(withOv);
          setFiltered(withOv);
          setConnected(true);
          applyDateFilter(withOv, 'last_30', '', '');
        } catch {}
      } else {
        // Magazin nou — fără date încă
        setAllOrders([]); setOrders([]); setFiltered([]);
        setConnected(false);
      }
    };
    const onGlamxShop = () => { window.location.reload(); };
    window.addEventListener('storage', (e) => { if(e.key==='glamx-shop') window.location.reload(); });
    window.addEventListener('glamx:shop', onGlamxShop);
    return () => { window.removeEventListener('glamx:shop', onGlamxShop); };
  }, []); // applyDateFilter is stable (useCallback []) — safe to omit from deps

  const applyDateFilter = useCallback((ords, p, cf, ct) => {
    const { from, to } = getRange(p, cf, ct);
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');
    // Aplicăm ÎNTOTDEAUNA overrides înainte de a seta orders
    const ordsWithOv = applyTrackingOverrides(ords);
    const inRange = ordsWithOv.filter(o => {
      const created = new Date(o.createdAt);
      return created >= fromD && created <= toD;
    });
    setOrders(inRange);
    setRangeLabel(`${fmtD(from+'T00:00:00')} — ${fmtD(to+'T00:00:00')}`);
  }, []);

  const applyFilters = useCallback((ords, f, q, sc, sd, cf) => {
    let result = ords.filter(o => {
      if (f !== 'toate' && o.ts !== f) return false;
      if (cf && cf !== 'toate' && o.courier !== cf) return false;
      if (!q) return true;
      return [o.name,o.client,o.oras,o.prods,o.trackingNo].some(v => (v||'').toLowerCase().includes(q.toLowerCase()));
    });
    if (sc) result = [...result].sort((a,b) => sc==='total' ? (a.total-b.total)*sd : (a[sc]||'').localeCompare(b[sc]||'','ro')*sd);
    setFiltered(result);
    setPg(1);
  }, []);

  const getLivrateInPeriod = useCallback((p, cf, ct) => {
    const { from, to } = getRange(p, cf, ct);
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');
    return allOrders.filter(o => {
      if (o.ts !== 'livrat' || !o.fulfilledAt) return false;
      const f = new Date(o.fulfilledAt);
      return f >= fromD && f <= toD;
    });
  }, [allOrders]);

  useEffect(() => { applyFilters(orders, filter, search, sortCol, sortDir, courierFilter); }, [orders, filter, search, sortCol, sortDir, courierFilter, applyFilters]);

  useEffect(() => {
    if (deliveryMode === 'fulfilled') {
      const livrate = getLivrateInPeriod(preset, customFrom, customTo);
      applyFilters(livrate, 'livrat', search, sortCol, sortDir, courierFilter);
    }
  }, [deliveryMode, preset, customFrom, customTo, getLivrateInPeriod, search, sortCol, sortDir, courierFilter, applyFilters]);

  const fetchOrdersRange = async (fromDate, force=false) => {
    // HU: fetch din DB server (webhooks) — nu necesită credențiale în browser
    const url = `/api/orders-server?shop=hu&created_at_min=${fromDate}${force?'&force=1':''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.orders) throw new Error(data.error || data.warning || 'Răspuns server invalid');
    return data.orders; // deja în formatul dashboard, fără procOrder
  };

  const fetchOrders = async (forceMode) => {
    // HU: fetch toate comenzile din DB server (1 an), fără credențiale browser
    setLoading(true); setError('');
    try {
      const d365 = toISO(new Date(Date.now() - 365*24*60*60*1000));
      const allFromDb = await fetchOrdersRange(d365, !!forceMode);
      const withOv = applyTrackingOverrides(allFromDb);
      setAllOrders(withOv);
      setConnected(true);
      const now = new Date();
      setLastFetch(now);
      setFetchedFrom(d365);
      ls.set(ordersKey('hu'), JSON.stringify(withOv));
      ls.set('gx_fetch_time_hu', now.toISOString());
      ls.set('gx_fetched_from_hu', d365);
      applyDateFilter(withOv, preset, customFrom, customTo);
    } catch (e) {
      setError('Eroare server HU: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePreset = (id) => {
    setPreset(id);
    setDeliveryMode('create');
    if (id !== 'custom') applyDateFilter(allOrders, id, customFrom, customTo);
  };

  const parseSamedayExcel = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setSdLoading(true); setSdError('');
    const normalizeStatus = (raw) => {
      const s = (raw || '').toString().toLowerCase();
      if (s.includes('returnat') || s.includes('retur') || s.includes('refuzat') || s.includes('nepreluat')) return 'retur';
      if (s.includes('transferat') || s.includes('livrat') || s.includes('livr')) return 'livrat';
      if (s.includes('curier') || s.includes('out for')) return 'outfor';
      if (s.includes('tranzit') || s.includes('hub') || s.includes('preluat') || s.includes('expediat')) return 'incurs';
      return null;
    };
    const loadXLSX = () => {
      const newMap = { ...sdAwbMap };
      const newFiles = [...sdFiles];
      let processed = 0;
      const processFile = (file) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const wb = window.XLSX.read(ev.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            const header = (rows[0] || []).map(h => (h||'').toString().toLowerCase());
            const awbIdx    = header.findIndex(h => h.includes('awb'));
            const statusIdx = header.findIndex(h => h.includes('status'));
            if (awbIdx === -1) { setSdError('Coloana AWB negăsită.'); resolve(); return; }
            if (statusIdx === -1) { setSdError('Coloana Status negăsită.'); resolve(); return; }
            rows.slice(1).forEach(row => {
              const awb = (row[awbIdx] || '').toString().trim();
              if (!awb) return;
              const status = normalizeStatus(row[statusIdx]);
              if (status) { newMap[awb] = status; processed++; }
            });
            if (!newFiles.includes(file.name)) newFiles.push(file.name);
            resolve();
          } catch(err) { setSdError('Eroare Excel: ' + err.message); resolve(); }
        };
        reader.readAsArrayBuffer(file);
      });
      Promise.all(files.map(processFile)).then(() => {
        if (processed === 0 && !sdError) { setSdError('Niciun AWB recunoscut.'); setSdLoading(false); return; }
        setSdAwbMap(newMap); setSdFiles(newFiles); setSdDone(true);
        ls.set('sd_awb_map', JSON.stringify(newMap));
        ls.set('sd_files', JSON.stringify(newFiles));
        setSdLoading(false);
      });
    };
    if (window.XLSX) { loadXLSX(); }
    else {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = loadXLSX;
      s.onerror = () => { setSdError('Nu s-a putut încărca XLSX.'); setSdLoading(false); };
      document.head.appendChild(s);
    }
    e.target.value = '';
  };

  const clearSamedayData = () => {
    setSdAwbMap({}); setSdFiles([]); setSdDone(false); setSdError('');
    ls.del('sd_awb_map'); ls.del('sd_files');
  };

  const parseGlsExcel = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setGlsLoading(true); setGlsError('');
    const normalizeGlsStatus = (raw) => {
      const s = (raw || '').toString().toLowerCase();
      if (s.includes('delivered') || s.includes('livrat')) return 'delivered_raw'; // poate fi livrat sau retur
      if (s.includes('return') || s.includes('retur') || s.includes('not delivered') || s.includes('refused')) return 'retur';
      if (s.includes('out for delivery') || s.includes('in delivery')) return 'outfor';
      if (s.includes('in transit') || s.includes('transit') || s.includes('hub')) return 'incurs';
      return null;
    };
    const loadXLSX = () => {
      const newMap = { ...glsAwbMap };
      const newFiles = [...glsFiles];
      let processed = 0;
      const processFile = (file) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const wb = window.XLSX.read(ev.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            const header = (rows[0] || []).map(h => (h||'').toString().toLowerCase());
            // Căutăm coloanele AWB și Status
            const awbIdx = header.findIndex(h => h.includes('parcel') || h.includes('awb') || h.includes('colet') || h.includes('number'));
            const statusIdx = header.findIndex(h => h.includes('status') || h.includes('stare') || h.includes('event'));
            const refIdx = header.findIndex(h => h.includes('reference') || h.includes('referinta') || h.includes('ref'));
            if (awbIdx === -1 && refIdx === -1) { setGlsError('Coloana AWB/Parcel negăsită.'); resolve(); return; }
            if (statusIdx === -1) { setGlsError('Coloana Status negăsită.'); resolve(); return; }
            // Găsim coloana pentru valoarea rambursului
            const rambursIdx = header.findIndex(h => 
              h.includes('ramburs') || h.includes('valoare') || h.includes('cod') || h.includes('cash') || h.includes('amount')
            );
            const servicesIdx = header.findIndex(h => 
              h.includes('servicii') || h.includes('service')
            );
            rows.slice(1).forEach(row => {
              const awb = (row[awbIdx !== -1 ? awbIdx : refIdx] || '').toString().trim();
              if (!awb) return;
              let status = normalizeGlsStatus(row[statusIdx]);
              if (!status) return;
              
              // Dacă statusul e 'delivered_raw', verificăm dacă e livrat sau retur
              if (status === 'delivered_raw') {
                const rambursVal = rambursIdx !== -1 ? (row[rambursIdx] || '').toString().trim() : '';
                const services   = servicesIdx !== -1 ? (row[servicesIdx] || '').toString().toUpperCase() : '';
                // Are valoare ramburs SAU are serviciul COD → livrat la client
                // Nu are ramburs și nu are COD → livrat înapoi (retur)
                if (rambursVal && rambursVal !== '0' && rambursVal !== '-') {
                  status = 'livrat';
                } else if (services.includes('COD')) {
                  status = 'livrat';
                } else {
                  // Fără ramburs și fără COD = livrat înapoi la expeditor = RETUR
                  status = 'retur';
                }
              }
              
              newMap[awb] = status;
              processed++;
            });
            if (!newFiles.includes(file.name)) newFiles.push(file.name);
            resolve();
          } catch(err) { setGlsError('Eroare Excel: ' + err.message); resolve(); }
        };
        reader.readAsArrayBuffer(file);
      });
      Promise.all(files.map(processFile)).then(() => {
        if (processed === 0) { setGlsError('Niciun AWB recunoscut. Verifică formatul fișierului.'); setGlsLoading(false); return; }
        setGlsAwbMap(newMap); setGlsFiles(newFiles); setGlsDone(true);
        ls.set('gls_awb_map', JSON.stringify(newMap));
        ls.set('gls_files', JSON.stringify(newFiles));
        setGlsLoading(false);
      });
    };
    if (window.XLSX) { loadXLSX(); }
    else {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = loadXLSX;
      s.onerror = () => { setGlsError('Nu s-a putut încărca XLSX.'); setGlsLoading(false); };
      document.head.appendChild(s);
    }
    e.target.value = '';
  };

  const clearGlsData = () => {
    setGlsAwbMap({}); setGlsFiles([]); setGlsDone(false); setGlsError('');
    ls.del('gls_awb_map'); ls.del('gls_files');
  };

  const getGlsStatus = (order) => {
    if (!order) return null;
    const awb = (order.trackingNo || '').trim();
    if (awb && glsAwbMap[awb]) return glsAwbMap[awb];
    return null; // null = folosim statusul din Shopify
  };

  const getSdStatus = (order) => {
    if (!order) return null;
    const awb = (order.trackingNo || '').trim();
    if (awb && sdAwbMap[awb]) return sdAwbMap[awb];
    return order.ts !== 'pending' ? order.ts : null;
  };

  const openInvoiceModal = (order) => {
    if (!sbEmail || !sbToken || !sbCif) { setSbCredsOpen(true); return; }
    const editItems = (order.items && order.items.length)
      ? order.items.map(i => ({ ...i }))
      : [{ name: order.prods || 'Produs', sku: '', qty: 1, price: order.total }];
    setInvoiceModal({ order, editItems, seriesInput: sbInvSeries });
  };

  const generateInvoice = async (order, customItems) => {
    if (!sbEmail || !sbToken || !sbCif) { setSbCredsOpen(true); return; }
    setInvoiceModal(null);
    setSbInvLoading(prev => ({ ...prev, [order.id]: true }));
    setSbInvResults(prev => ({ ...prev, [order.id]: null }));
    try {
      const res = await fetch('/api/smartbill-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: sbEmail, token: sbToken, cif: sbCif,
          seriesName: order._seriesOverride || sbInvSeries || undefined,
          paymentSeries: sbPaySeries || undefined,
          shopifyDomain: ls.get(domainKey(getShopKey())) || ls.get('gx_d') || '',
          shopifyToken:  ls.get(tokenKey(getShopKey()))  || ls.get('gx_t') || '',
          order: {
            id: order.id, name: order.name, client: order.client,
            address: order.address || '', city: order.oras || '',
            county: order.county || '', country: 'Romania',
            clientEmail: order.clientEmail || '',
            currency: order.currency || 'RON',
            total: order.total,
            items: customItems || order.items || [],
            isPaid: order.fin === 'paid',
            useStock: sbUseStock,
            warehouseName: sbUseStock ? sbWarehouse : '',
          },
        }),
      });
      const rawText = await res.text();
      let data;
      try { data = JSON.parse(rawText); }
      catch { data = { error: `Server error ${res.status}` }; }
      if (data.ok) {
        setSbInvResults(prev => ({ ...prev, [order.id]: {
          ok: true, number: data.number, series: data.series,
          collected: data.collected, shopifyMarked: data.shopifyMarked,
          invoiceUrl: data.invoiceUrl, stockDecreased: data.stockDecreased, _debug: data._debug,
        }}));
        setAllOrders(prev => prev.map(o => o.id === order.id
          ? { ...o, hasInvoice: true, invoiceNumber: data.number, invoiceSeries: data.series, invoiceUrl: data.invoiceUrl || o.invoiceUrl, invoiceShort: data.invoiceUrl || o.invoiceShort }
          : o
        ));
      } else {
        setSbInvResults(prev => ({ ...prev, [order.id]: { ok: false, error: data.error } }));
      }
    } catch (e) {
      setSbInvResults(prev => ({ ...prev, [order.id]: { ok: false, error: e.message } }));
    } finally {
      setSbInvLoading(prev => ({ ...prev, [order.id]: false }));
    }
  };

  const generateAllInvoices = async () => {
    const pending = noInvoicePaid.filter(o => !sbInvResults[o.id]?.ok);
    if (!pending.length) return;
    setSbBulkLoading(true);
    for (const order of pending) {
      await generateInvoice(order, null);
      await new Promise(r => setTimeout(r, 400));
    }
    setSbBulkLoading(false);
  };

  const loadSbSeries = async () => {
    const email = ls.get('sb_email');
    const token = ls.get('sb_token');
    const cif   = ls.get('sb_cif');
    if (!email || !token || !cif) return;
    setSbEmail(email); setSbToken(token); setSbCif(cif);
    try {
      const res = await fetch(`/api/smartbill-invoice?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&cif=${encodeURIComponent(cif)}`);
      const data = await res.json();
      if (data.series?.length) { setSbInvSeriesList(data.series); if (!sbInvSeries) setSbInvSeries(data.series[0]); }
      if (data.warehouses?.length) { setSbWarehouseList(data.warehouses); if (!sbWarehouse) setSbWarehouse(data.warehouses[0]); }
    } catch {}
  };

  const disconnect = () => { setOrders([]); setConnected(false); setError(''); ls.del(ordersKey('hu')); };

  // ── ADDRESS CORRECTION FUNCTIONS ──────────────────────────────────────
  const openAddrModal = (order) => {
    setAddrModal({
      order,
      editFields: {
        name:     order.client || '',
        email:    order.clientEmail || '',
        phone:    order.phone  || '',
        address:  order.address || '',
        address2: '',
        city:     order.oras || '',
        county:   order.county || '',
        zip:      order.zip || '',
        country:  'Romania',
      },
      issues: [],
      suggestion: null,
      saving: false,
      updateCustomer: false,
    });
  };

  const validateAddressApi = async (fields) => {
    setAddrValidating(true);
    try {
      const res = await fetch('/api/validate-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      setAddrModal(prev => prev ? { ...prev, issues: data.issues || [], suggestion: data.suggestion || null } : null);
    } catch {}
    setAddrValidating(false);
  };

  const applyAddrSuggestion = () => {
    if (!addrModal?.suggestion) return;
    const s = addrModal.suggestion;
    setAddrModal(prev => ({
      ...prev,
      editFields: {
        ...prev.editFields,
        address: s.formattedAddress || prev.editFields.address,
        city:    s.city    || prev.editFields.city,
        county:  s.county  || prev.editFields.county,
        zip:     s.postcode|| prev.editFields.zip,
      },
      suggestion: null, issues: [],
    }));
  };

  const saveAddressToShopify = async () => {
    if (!addrModal) return;
    setAddrModal(prev => ({ ...prev, saving: true }));
    const { order, editFields, updateCustomer } = addrModal;
    try {
      const shopDomain = ls.get(domainKey(getShopKey())) || ls.get('gx_d');
      const shopToken  = ls.get(tokenKey(getShopKey()))  || ls.get('gx_t');
      const res = await fetch(`https://${shopDomain}/admin/api/2024-01/orders/${order.id}.json`, {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': shopToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: { id: order.id, shipping_address: {
          name: editFields.name, phone: editFields.phone,
          address1: editFields.address, address2: editFields.address2,
          city: editFields.city, province: editFields.county,
          zip: editFields.zip, country: editFields.country || 'Romania',
        }}}),
      });
      if (res.ok) {
        setAllOrders(prev => prev.map(o => o.id === order.id ? {
          ...o, client: editFields.name, phone: editFields.phone,
          address: editFields.address, oras: editFields.city,
          county: editFields.county, addrOk: true,
        } : o));
        setAddrModal(null);
      } else {
        setAddrModal(prev => ({ ...prev, saving: false, issues: [{ field:'general', msg:'Eroare Shopify la salvare.' }] }));
      }
    } catch(e) {
      setAddrModal(prev => ({ ...prev, saving: false, issues: [{ field:'general', msg: e.message }] }));
    }
  };

  // ── TRACKING LIVE GLS / Sameday ──
  const refreshTracking = async (silent = false) => {
    const now = new Date();
    const activeOrders = allOrders.filter(o => {
      if (!o.trackingNo) return false;
      if (['incurs','outfor','pending'].includes(o.ts)) return true;
      // Sameday: reverificăm 'retur' din ultimele 30 zile — Shopify poate fi greșit
      if (o.ts === 'retur' && o.courier === 'sameday' && o.createdAt) {
        const daysSince = (now - new Date(o.createdAt)) / (1000 * 60 * 60 * 24);
        return daysSince <= 30;
      }
      return false;
    });
    console.log('[TRACKING] Comenzi active cu AWB:', activeOrders.length,
      activeOrders.slice(0,3).map(o => ({id:o.id, awb:o.trackingNo, ts:o.ts, courier:o.courier}))
    );
    if (!activeOrders.length) {
      // Debug: arătăm comenzile incurs fără AWB
      const faraAWB = allOrders.filter(o => ['incurs','outfor'].includes(o.ts) && !o.trackingNo);
      if (!silent) alert(
        faraAWB.length > 0
          ? `⚠️ ${faraAWB.length} comenzi în tranzit dar FĂRĂ AWB în Shopify!
Exemplu: ${faraAWB[0]?.name} - courier: ${faraAWB[0]?.courier}`
          : 'Nicio comandă activă cu AWB pentru tracking.'
      );
      return;
    }
    setTrackingLoading(true);
    try {
      const res = await fetch('/api/tracking', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          orders: activeOrders.map(o => ({ id: o.id, awb: o.trackingNo, courier: o.courier, createdAt: o.createdAt }))
        })
      });
      const data = await res.json();
      const results = data.results || [];
      const trackMap = {};
      results.forEach(r => { if (r.id && r.status) trackMap[r.id] = r; });

      let changed = 0;
      const newOverrides = {};
      setAllOrders(prev => {
        const updated = prev.map(o => {
          const t = trackMap[o.id];
          if (!t || !t.status) return o;

          const liveTs =
            t.status === 'delivered'         ? 'livrat' :
            t.status === 'out_for_delivery'  ? 'outfor' :
            t.status === 'in_transit'        ? 'incurs' :
            t.status === 'failed_attempt'    ? 'outfor' :
            (t.status === 'returned' || t.status === 'failure') ? 'retur' : o.ts;
          if (liveTs !== o.ts) {
            changed++;
            const ovData = { ts: liveTs, statusRaw: t.statusRaw, lastUpdate: t.lastUpdate, location: t.location };
            trackingOverrides.update(o.id, ovData);
            newOverrides[o.id] = { ...ovData, at: new Date().toISOString() };
          }
          return { ...o, ts: liveTs,
            trackingStatus: t.statusRaw || '',
            trackingLastUpdate: t.lastUpdate || '',
            trackingLocation: t.location || '',
            // Folosim data reală de la GLS (lastUpdate), nu new Date()
            // Altfel comenzi din luni trecute apar în luna curentă
            fulfilledAt: (liveTs === 'livrat' && !o.fulfilledAt)
              ? (t.lastUpdate || o.createdAt || new Date().toISOString())
              : o.fulfilledAt,
          };
        });
        // Salvăm în cache-ul per-shop ca să persiste după refresh
        try {
          ls.set(ordersKey(getShopKey()), JSON.stringify(updated));
        } catch(e) {}
        return updated;
      });

      setLastTrackingCheck(new Date());

      // Salvăm overrides noi în Redis — stats page le va citi de acolo
      if (Object.keys(newOverrides).length > 0) {
        fetch('/api/tracking-overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides: newOverrides }),
        }).catch(e => console.warn('[REDIS] Nu am putut salva overrides:', e.message));
      }

      if (!silent) {
        alert(changed > 0
          ? `✅ ${changed} comenzi actualizate din ${results.length} verificate!`
          : `✅ ${results.length} comenzi verificate — nicio schimbare de status.`
        );
      }
    } catch(e) {
      console.error('[TRACKING]', e);
      if (!silent) alert('Eroare la tracking: ' + e.message);
    }
    setTrackingLoading(false);
  };

  // Auto-tracking: rulează automat la 10s după conectare + la fiecare 30min
  // Silent = fără alert, fără loading indicator vizibil
  const lastAutoTrack = useRef(0);
  useEffect(() => {
    if (!connected) return;
    // Rulăm la 10 secunde după conectare
    const t1 = setTimeout(() => {
      refreshTracking(true);
      lastAutoTrack.current = Date.now();
    }, 2000);
    // Repetăm la fiecare 30 minute
    const t2 = setInterval(() => {
      refreshTracking(true);
      lastAutoTrack.current = Date.now();
    }, 30 * 60 * 1000);
    return () => { clearTimeout(t1); clearInterval(t2); };
  }, [connected]);

  // Tracking se rulează direct din fetchOrders după fiecare fază
  const handleSort = (col) => { if (sortCol===col) setSortDir(d=>d*-1); else { setSortCol(col); setSortDir(1); } };

  // ── KPI ──
  const n = orders.length;
  // Folosim getFinalStatus pentru KPI — nu o.ts direct
  // Dar getFinalStatus e definit mai jos — folosim trackingOverrides direct aici
  // Folosim o.ts direct din allOrders (care include overrides aplicate)
  // Nu mai recalculăm — o.ts e deja corect după applyTrackingOverrides
  // GLS status: prioritizăm Excel din MyGLS > Shopify/xConnector
  const getGlsStatusFinal = (o) => {
    const awb = (o.trackingNo || '').trim();
    if (awb && glsAwbMap[awb]) return glsAwbMap[awb];
    return o.ts;
  };

  const getFinalStatus = (o) => {
    if (o.courier === 'gls') return getGlsStatusFinal(o);
    if (o.courier === 'sameday') return getSdStatus(o) || o.ts;
    return o.ts;
  };

  const cnt = s => orders.filter(o=>getFinalStatus(o)===s).length;
  const sum = ss => orders.filter(o=>ss.includes(getFinalStatus(o))).reduce((a,o)=>a+o.total,0);
  // Tranzit/outfor: din TOATE comenzile (nu doar perioada selectată)
  // allOrders are deja overrides aplicate — getFinalStatus aplică și glsAwbMap
  // Nu re-aplicăm applyTrackingOverrides (ar fi dublu)
  const cntAll = s => allOrders.filter(o=>getFinalStatus(o)===s).length;
  // Lista exactă de comenzi în tranzit — pentru KPI și click-to-filter
  // Excludem comenzile cu ts='incurs' dar care au tracking override 'livrat'
  const tranzitOrders = allOrders.filter(o => ['incurs','outfor'].includes(getFinalStatus(o)));
  const incurs = tranzitOrders.filter(o => getFinalStatus(o) === 'incurs').length;
  const outfor = tranzitOrders.filter(o => getFinalStatus(o) === 'outfor').length;
  const retur=cnt('retur'), anulate=cnt('anulat'), pend=cnt('pending');
  const sA=sum(['incurs','outfor']), sR=sum(['retur','anulat']);

  const { from: rangeFrom, to: rangeTo } = getRange(preset, customFrom, customTo);
  const rangeFromD = new Date(rangeFrom + 'T00:00:00');
  const rangeToD   = new Date(rangeTo   + 'T23:59:59');

  const ONLINE_GW = ['shopify_payments','stripe','paypal'];
  const isOnlinePayment = (o) => {
    if (onlinePaymentIds.includes(String(o.id))) return true;
    const gw = (o.gateway || '').toLowerCase();
    if (gw) return ONLINE_GW.some(g => gw.includes(g));
    if (o.fin === 'pending') return false;
    return false;
  };

  // getGlsStatusFinal și getFinalStatus mutate sus

  // orders = comenzile din perioadă cu overrides aplicate (sursa corectă pentru KPI)
  // KPI Livrate — comenzi cu createdAt în perioadă + status livrat
  // IDENTIC cu profit/page.js care arată 66/67 corect
  // "Azi" = comenzi plasate azi care sunt livrate
  // EXCEPȚIE "Azi": includem și comenzile livrate azi indiferent când au fost plasate
  const { from: kpiFrom, to: kpiTo } = getRange(preset, customFrom, customTo);
  const kpiFromD = new Date(kpiFrom + 'T00:00:00');
  const kpiToD   = new Date(kpiTo   + 'T23:59:59');
  const isToday  = preset === 'today' || preset === 'yesterday';
  const livrateOrders = allOrders.filter(o => {
    if (getFinalStatus(o) !== 'livrat') return false;
    if (isToday && o.fulfilledAt) {
      // Pentru Azi/Ieri: filtrăm după data livrării (fulfilledAt)
      return new Date(o.fulfilledAt) >= kpiFromD && new Date(o.fulfilledAt) <= kpiToD;
    }
    // Pentru toate celelalte: filtrăm după data plasării (createdAt) — consistent cu tabelul
    const created = new Date(o.createdAt);
    return created >= kpiFromD && created <= kpiToD;
  });
  const livrate = livrateOrders.length;
  const sI     = livrateOrders.reduce((a,o) => a+o.total, 0);
  const sICOD  = livrateOrders.filter(o => !isOnlinePayment(o)).reduce((a,o)=>a+o.total,0);
  const sIPaid = livrateOrders.filter(o =>  isOnlinePayment(o)).reduce((a,o)=>a+o.total,0);

  // ── COD calculations ──
  const now = new Date();
  const todayStr = toISO(now);
  const twoDaysAgo = new Date(now); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const twoDaysAgoStr = toISO(twoDaysAgo);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toISO(yesterday);

  // ── COD încasat azi — cu logică weekend ──
  // GLS și Sameday: dacă livrarea a fost sâmbătă sau duminică → banii vin luni
  // Adaugă n zile LUCRĂTOARE (L-V) — sâmbătă/duminică nu contează
  const nextBizDay = (dateStr, plusWorkingDays) => {
    const d = new Date(dateStr + 'T12:00:00');
    let added = 0;
    while (added < plusWorkingDays) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) added++; // numărăm doar L-V
    }
    return d.toISOString().slice(0,10);
  };
  const codIncasatAzi = allOrders.filter(o => {
    if (o.ts !== 'livrat' || !o.fulfilledAt) return false;
    if (isOnlinePayment(o)) return false; // Shopify Payments nu e ramburs COD
    const livStr = o.fulfilledAt.slice(0,10);
    if (o.courier === 'gls')     return nextBizDay(livStr, 2) === todayStr;
    if (o.courier === 'sameday') return nextBizDay(livStr, 1) === todayStr;
    return nextBizDay(livStr, 2) === todayStr;
  });
  const sumCodIncasatAzi = codIncasatAzi.reduce((a,o) => a+o.total, 0);

  const codLivrateAzi = allOrders.filter(o =>
    o.ts === 'livrat' && !isOnlinePayment(o) && (o.fulfilledAt||'').slice(0,10) === todayStr
  );
  const sumCodLivrateAzi = codLivrateAzi.reduce((a,o) => a+o.total, 0);
  const codLivrateAziTotal = allOrders.filter(o =>
    o.ts === 'livrat' && (o.fulfilledAt||'').slice(0,10) === todayStr
  ).length;

  const codInDrum = orders.filter(o => ['incurs','outfor'].includes(o.ts));
  const sumCodInDrum = codInDrum.reduce((a,o) => a+o.total, 0);

  // GLS livrate după fulfilledAt în perioada curentă
  // glsOrders din allOrders filtrat pe perioadă (nu doar orders filtrat pe status)
  // Folosim orders (filtrat pe perioadă + overrides aplicate) — ACELAȘI ca KPI-urile
  const glsOrders = orders.filter(o => o.courier === 'gls');
  const sdOrders  = orders.filter(o => o.courier === 'sameday');
  // Calculele folosesc getFinalStatus — same logic ca KPI livrate de sus
  const glsLivrate   = glsOrders.filter(o => getFinalStatus(o) === 'livrat').length;
  const glsRetur     = glsOrders.filter(o => getFinalStatus(o) === 'retur').length;
  const glsIncurs    = glsOrders.filter(o => getFinalStatus(o) === 'incurs').length;
  const glsOutfor    = glsOrders.filter(o => getFinalStatus(o) === 'outfor').length;
  const glsAnulate   = glsOrders.filter(o => getFinalStatus(o) === 'anulat').length;
  const glsInLivrare = glsOutfor;
  const glsPending   = glsOrders.filter(o => getFinalStatus(o) === 'pending').length;
  const sdAnulate    = sdOrders.filter(o => getSdStatus(o) === 'anulat' || o.ts === 'anulat').length;

  // Retururi suplimentare (din alte perioade, returnate în perioada curentă)
  const retururiExtra = allOrders.filter(o => {
    if (o.ts !== 'retur') return false;
    if (orders.some(x => x.id === o.id)) return false;
    const fd = o.fulfilledAt ? new Date(o.fulfilledAt) : null;
    return fd && fd >= rangeFromD && fd <= rangeToD;
  });
  // Retururi GLS din Excel (comenzi marcate ca retur în MyGLS dar nu în Shopify)
  const glsReturExtra = glsDone ? glsOrders.filter(o => {
    const glsSt = getGlsStatusFinal(o);
    return glsSt === 'retur' && o.ts !== 'retur';
  }).length : 0;
  const returTotal = retur + retururiExtra.length + glsReturExtra;

  const courierBadgeCount = (courierId) => {
    return orders.filter(o => {
      if (o.courier !== courierId) return false;
      if (filter !== 'toate' && o.ts !== filter) return false;
      if (search) return [o.name,o.client,o.oras,o.prods,o.trackingNo].some(v => (v||'').toLowerCase().includes(search.toLowerCase()));
      return true;
    }).length;
  };

  const sdLivrate = sdOrders.filter(o => getSdStatus(o) === 'livrat').length;
  const sdRetur   = sdOrders.filter(o => getSdStatus(o) === 'retur').length;
  const sdOutfor  = sdOrders.filter(o => getSdStatus(o) === 'outfor').length;
  const sdIncurs  = sdOrders.filter(o => { const s = getSdStatus(o); return s === 'incurs' || s === null; }).length;

  const noInvoicePaid = orders.filter(o => o.fin==='paid' && !o.hasInvoice);
  const sdReturDetectat = orders.filter(o => o.courier==='sameday' && getSdStatus(o) === 'retur' && o.ts !== 'retur');

  const kpis = [
    {v:n,          lbl:'Total comenzi', e:'📦',color:'#f97316',p:100},
    {v:livrate,    lbl:'Livrate',       e:'✅',color:'#10b981',p:pct(livrate,n)}, // livrate = orders cu ts=livrat în perioadă
    {v:incurs+outfor, lbl:'În tranzit', e:'🚚',color:'#3b82f6',p:pct(incurs+outfor,n)},
    {v:returTotal, lbl:'Retur',         e:'↩️',color:'#f43f5e',p:pct(returTotal,n)},
    {v:anulate,    lbl:'Anulate',       e:'❌',color:'#4a5568',p:pct(anulate,n)},
    {v:pend,       lbl:'Neexpediate',   e:'⏳',color:'#f59e0b',p:pct(pend,n)},
  ];

  const slice = filtered.slice((pg-1)*PS, pg*PS);
  const pages = Math.ceil(filtered.length/PS);
  const bc = {livrat:'badge-green',incurs:'badge-blue',outfor:'badge-purple',retur:'badge-red',anulat:'badge-gray',pending:'badge-yellow'};

  return (
    <>


      <div className="wrap">
        <header>
          {/* ROW 1: Logo + titlu + status */}
          <div className="header-row1">
            <div className="logo"><img src="/icon-192.png" alt="GLAMX"/></div>
            <div className="header-title">
              <div className="h1">Dashboard Comenzi 🇭🇺</div>
              <div className="hsub">Shopify Live</div>
            </div>
            <div className="header-status">
              <div className="live"><div className={`dot ${connected?'on':''}`}></div><span>{connected ? `${orders.length} comenzi` : 'Deconectat'}</span></div>
              {connected && <>
                <button className="bsm sync-btn" onClick={() => fetchOrders('force')}>⟳ Sync</button>
                <button className="bsm" onClick={() => refreshTracking(false)} disabled={trackingLoading}
                  style={{color:trackingLoading?'#475569':'#3b82f6',borderColor:'rgba(59,130,246,.3)',padding:'4px 8px'}}>
                  {trackingLoading ? '⟳' : `📡${lastTrackingCheck?' ✓':''}`}
                </button>
                {bgLoading && <span className="bg-loading">⟳</span>}
                <button className="disc-btn" onClick={disconnect}>✕</button>
                {process.env.NODE_ENV !== 'production' && (
                  <button className="bsm" style={{fontSize:9,padding:'3px 6px'}} onClick={() => {
                    const ov = trackingOverrides.get();
                    const ovCount = Object.keys(ov).length;
                    const sample = Object.entries(ov).slice(0,3).map(([id,v])=>`${id}→${v.ts}`).join(', ');
                    alert(`Overrides: ${ovCount} comenzi\n${sample || 'gol'}\n\nOrders ts sample:\n${orders.slice(0,5).map(o=>o.name+':'+o.ts).join(', ')}`);
                  }}>🔍</button>
                )}
              </>}
            </div>
          </div>
          {/* ROW 2: Nav links — mobile: sub logo, desktop: în hr */}
          {connected && (
            <div className="header-nav">
              <a href="/profit"       className="nav-link" style={{background:'rgba(16,185,129,.12)', color:'#10b981',border:'1px solid rgba(16,185,129,.25)'}}>💹 Profit</a>
              <a href="/stats"        className="nav-link" style={{background:'rgba(59,130,246,.12)', color:'#3b82f6',border:'1px solid rgba(59,130,246,.25)'}}>📊 Stats</a>
              <a href="/xconnector"   className="nav-link" style={{background:'rgba(249,115,22,.12)', color:'#f97316',border:'1px solid rgba(249,115,22,.25)'}}>⚡ xConn</a>
              <a href="/import"       className="nav-link" style={{background:'rgba(168,85,247,.12)', color:'#a855f7',border:'1px solid rgba(168,85,247,.25)'}}>🚢 Import</a>
              <a href="/fulfillment"  className="nav-link" style={{background:'rgba(249,115,22,.12)', color:'#f97316',border:'1px solid rgba(249,115,22,.25)'}}>📦 Fulfil</a>
              <a href="/whatsapp"     className="nav-link" style={{background:'rgba(37,211,102,.12)', color:'#25d366',border:'1px solid rgba(37,211,102,.25)'}}>📱 Chat</a>
            </div>
          )}
        </header>

        {!connected && !loading && (
          <div className="setup" style={{textAlign:'center'}}>
            <div style={{fontSize:40,marginBottom:8}}>⚡</div>
            <div style={{fontSize:16,fontWeight:700,color:'#f97316',marginBottom:8}}>Conectare automată 🇭🇺 Ungaria</div>
            <div style={{fontSize:13,color:'#94a3b8',marginBottom:16}}>Se încarcă comenzile din server…</div>
            <button className="cbtn" onClick={() => fetchOrders()} style={{marginTop:8}}>🔄 Reîncearcă</button>
          </div>
        )}

        {error && <div className="err">⚠️ {error}</div>}
        {loading && <div className="loading"><div className="sp"></div><div className="lt">Se descarcă comenzile…</div></div>}

        {connected && (
          <div className="date-bar">
            <div className="presets">
              <span style={{fontSize:11,color:'#94a3b8',marginRight:4,whiteSpace:'nowrap'}}>📅</span>
              {PRESETS.map(p => (
                <button key={p.id} className={`preset-btn ${preset===p.id?'active':''}`} onClick={() => handlePreset(p.id)}>
                  {p.label}
                </button>
              ))}
              {rangeLabel && <span className="range-label">{rangeLabel} · <strong style={{color:'#f97316'}}>{orders.length}</strong></span>}
            </div>
            {preset === 'custom' && (
              <div className="custom-row">
                <label>De la:</label>
                <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} />
                <label>Până la:</label>
                <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)} />
                <button className="apply-btn" onClick={() => applyDateFilter(allOrders, 'custom', customFrom, customTo)}>Aplică</button>
              </div>
            )}
            <div style={{fontSize:10,color:'#4a5568',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <span>📦 {allOrders.length} în cache</span>
              {lastFetch && <span>🕐 {lastFetch.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'})} · {lastFetch.toLocaleDateString('ro-RO')}</span>}
              <button onClick={fetchOrders} style={{background:'transparent',border:'1px solid #243040',color:'#94a3b8',padding:'2px 8px',borderRadius:'6px',fontSize:'10px',cursor:'pointer'}}>⟳ Resincronizează</button>
            </div>
          </div>
        )}

        {connected && !loading && (
          <>
            <div className="stitle">Sumar {rangeLabel}</div>
            <div className="kgrid">
              {kpis.map((k,i) => (
                <div key={i} className="kpi" style={{'--kc':k.color,cursor:(i===1||i===2||i===3)?'pointer':'default'}}
                  onClick={i===2?()=>{
                    setShowTranzitPanel(v=>{
                      if(!v) setTimeout(()=>fetchLiveTracking(tranzitOrders),100);
                      return !v;
                    });
                  }:i===1?()=>setShowLivrateModal(true)
                   :i===3?()=>setShowReturModal(true)
                   :undefined}
                  title={i===2?'Click pentru detalii tranzit':i===1?'Click pentru lista livrărilor':i===3?'Click pentru lista retururilor':undefined}>
                  <span className="ke">{k.e}</span>
                  <div className="kv">{k.v}</div>
                  <div className="kl">
                    {k.lbl}
                    {i===2&&<span style={{fontSize:9,marginLeft:4,opacity:.6}}>▼</span>}
                    {(i===1||i===3)&&<span style={{fontSize:8,marginLeft:4,opacity:.5}}>↗</span>}
                  </div>
                  <div className="kbar"><div className="kfill" style={{width:k.p+'%'}}></div></div>
                  <div className="kp">{k.p}%</div>
                </div>
              ))}
            </div>

            {/* Panel tranzit live — fetch GLS API în timp real */}
            {showTranzitPanel && tranzitOrders.length > 0 && (() => {
              const GLS_CODES = {
                1:'Preluat de curier', 2:'Plecat din depozit', 3:'Ajuns în depozit',
                4:'În livrare azi', 5:'Livrat', 6:'Stocat temporar', 7:'Stocat',
                8:'Ridicare proprie', 9:'Reprogramat', 10:'Scanat în depozit',
                11:'Adresă incorectă', 12:'Destinatar absent', 13:'În tranzit hub',
                14:'Refuzat', 15:'Deteriorat', 16:'Pierdut', 17:'Retur inițiat',
                18:'Adresă incompletă', 19:'Cod poștal incorect', 20:'Zonă neacoperită',
                21:'Eroare sortare', 22:'Trimis la sortare', 23:'Retur la expeditor',
                24:'Redirecționat', 25:'Transferat alt depot', 26:'Ajuns depot destinație',
                27:'Confirmat în centru', 29:'Plecat spre livrare', 32:'Ieșit pentru livrare',
                40:'Retur primit', 41:'Redirecționat hub', 46:'Plecat hub',
                47:'Plecat depozit', 51:'Date înregistrate', 52:'Ramburs înregistrat',
                53:'Tranzit depozit', 54:'Livrat (confirmat)', 55:'Livrat la vecin',
                56:'Scanat ieșire', 58:'Livrat la recepție', 80:'Pickup înregistrat',
                83:'Pickup preluat', 84:'Pickup confirmat', 85:'Expediat', 86:'Preluat curier',
                87:'Tentativă eșuată 1', 88:'Tentativă eșuată 2', 89:'Tentativă eșuată 3',
                90:'Returnare inițiată', 92:'Livrat (semnătură)', 93:'Livrat (foto)',
                97:'Procesare', 99:'În tranzit',
              };
              const SD_CODES = {
                1:'Expediere înregistrată', 2:'Preluat de curier', 3:'Ajuns în depozit',
                4:'Preluat de curier', 5:'Livrat', 6:'Tentativă eșuată', 7:'Spre depozit central',
                8:'Retur inițiat', 9:'Livrat (confirmat)', 10:'În livrare azi',
                11:'Retur spre expeditor', 12:'Retur finalizat', 13:'Tentativă eșuată',
                14:'Destinatar absent', 15:'Refuzat', 16:'Adresă incorectă',
                17:'Reprogramat', 18:'Zonă neacoperită', 19:'Avariat',
                20:'Pierdut', 21:'Retur confirmat', 22:'Retur la expeditor',
                23:'Curier alocat ridicare', 24:'Reîncercare livrare', 25:'Redirecționat',
                26:'Ajuns depozit local', 27:'Procesat depozit', 28:'Stocat',
                30:'Livrat la vecin', 33:'În livrare — curier în drum',
                34:'În livrare azi', 35:'Ieșit pentru livrare',
                84:'Ajuns depozit central', 85:'Plecat spre livrare',
              };
              const statusColor = (s) => s==='delivered'?'#10b981':s==='out_for_delivery'?'#a855f7':(s==='returned'||s==='failure')?'#f43f5e':s==='failed_attempt'?'#f59e0b':'#3b82f6';

              return (
                <div style={{background:'rgba(59,130,246,.06)',border:'1px solid rgba(59,130,246,.25)',borderRadius:12,padding:'12px 14px',marginBottom:10}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                    <div style={{fontSize:11,color:'#3b82f6',fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>
                      🚚 Colete în tranzit — {tranzitOrders.length}
                    </div>
                    <button onClick={()=>fetchLiveTracking(tranzitOrders)}
                      style={{background:'rgba(59,130,246,.15)',border:'1px solid rgba(59,130,246,.3)',color:'#3b82f6',borderRadius:8,padding:'4px 12px',fontSize:11,fontWeight:700,cursor:'pointer'}}>
                      🔄 Refresh
                    </button>
                  </div>
                  {tranzitOrders.map(o => {
                    const live = liveTrackingData[o.id];
                    const code = live?.statusCode ? parseInt(live.statusCode) : null;
                    const COURIER_CODES = o.courier === 'sameday' ? SD_CODES : GLS_CODES;
                    const codeDesc = code ? (COURIER_CODES[code] || live?.desc || live?.statusDescription || `Cod ${code}`) : (live?.desc || live?.statusDescription || null);
                    const color = statusColor(live?.glsStatus);
                    return (
                      <div key={o.id} style={{padding:'9px 0',borderBottom:'1px solid rgba(255,255,255,.05)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                          <span style={{color:'#f97316',fontWeight:700,fontSize:12,minWidth:65}}>{o.name}</span>
                          <span style={{color:'#94a3b8',fontSize:11,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.client}</span>
                          <span style={{color:'#475569',fontSize:10}}>{o.createdAt?.slice(0,10)}</span>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                          <span style={{fontFamily:'monospace',fontSize:10,color:'#64748b',background:'rgba(255,255,255,.04)',padding:'2px 6px',borderRadius:4}}>
                            {o.trackingNo||'fără AWB'}
                          </span>
                          {!o.trackingNo ? (
                            <span style={{fontSize:10,color:'#f59e0b'}}>⚠ Fără AWB</span>
                          ) : live?.loading ? (
                            <span style={{fontSize:10,color:'#3b82f6'}}>⟳ Se verifică...</span>
                          ) : live ? (
                            <>
                              {code && <span style={{fontSize:10,fontWeight:800,background:'rgba(59,130,246,.15)',color:'#93c5fd',padding:'2px 6px',borderRadius:4,fontFamily:'monospace'}}>#{code}</span>}
                              <span style={{fontSize:11,fontWeight:600,color}}>{codeDesc||live.desc||'—'}</span>
                              {live.location && <span style={{fontSize:10,color:'#64748b'}}>📍{live.location}</span>}
                              {live.lastUpdate && <span style={{fontSize:10,color:'#475569'}}>{live.lastUpdate}</span>}
                            </>
                          ) : (
                            <span style={{fontSize:10,color:'#334155'}}>— se încarcă...</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{fontSize:9,color:'#334155',marginTop:8,textAlign:'center'}}>
                    GLS: 4=Livrare azi · 5=Livrat · 32=Ieșit livrare · 23/40=Retur &nbsp;|&nbsp; Sameday: 33/34=În livrare · 5/9=Livrat · 84=Depozit central · 21/22=Retur
                  </div>
                </div>
              );
            })()}

            <div className="srow">
              {sI>0 && (
                <div className="sc sc1"><div className="si">💰</div><div>
                  <div className="slbl">Încasat total</div>
                  <div className="sv">{fmt(sI)} HUF</div>
                  <div className="ssub">
                    {livrate} livrate
                    {sICOD>0 && <> · COD: <strong style={{color:'#f97316'}}>{fmt(sICOD)}</strong></>}
                    {sIPaid>0 && <> · Card: <strong style={{color:'#10b981'}}>{fmt(sIPaid)}</strong></>}
                  </div>
                </div></div>
              )}
              {sA>0 && (
                <div className="sc sc2"><div className="si">🚚</div><div>
                  <div className="slbl">COD în drum</div>
                  <div className="sv">{fmt(sA)} HUF</div>
                  <div className="ssub">{incurs+outfor} comenzi în tranzit</div>
                </div></div>
              )}
              <div className="sc" style={{border:'1px solid #a855f7',background:'#0f1419'}}><div className="si">⏰</div><div>
                <div className="slbl">COD de încasat azi</div>
                <div className="sv" style={{color: sumCodIncasatAzi>0?'#a855f7':'#4a5568'}}>{fmt(sumCodIncasatAzi)} HUF</div>
                <div className="ssub">
                  GLS livrate pe {twoDaysAgoStr.split('-').reverse().join('.')} · SD pe {yesterdayStr.split('-').reverse().join('.')}<br/>
                  {codIncasatAzi.length > 0 ? `${codIncasatAzi.length} colete` : 'Niciun colet COD'}
                </div>
              </div></div>
              <div className="sc" style={{border:'1px solid #10b981',background:'#0f1419'}}><div className="si">📅</div><div>
                <div className="slbl">COD livrate azi</div>
                <div className="sv" style={{color: sumCodLivrateAzi>0?'#10b981':'#4a5568'}}>{fmt(sumCodLivrateAzi)} HUF</div>
                <div className="ssub">
                  {codLivrateAzi.length > 0
                    ? <>{codLivrateAzi.length} COD din {codLivrateAziTotal} livrate · ramburs pe {new Date(now.getTime()+2*86400000).toLocaleDateString('ro-RO',{day:'2-digit',month:'2-digit'})}</>
                    : `Nicio livrare COD pe ${todayStr.split('-').reverse().join('.')}`}
                </div>
              </div></div>
              {sR>0 && (
                <div className="sc sc3"><div className="si">↩️</div><div>
                  <div className="slbl">Pierdut retur/anulat</div>
                  <div className="sv">{fmt(sR)} HUF</div>
                  <div className="ssub">{retur+anulate} comenzi</div>
                </div></div>
              )}
            </div>

            {noInvoicePaid.length > 0 && (
              <div style={{background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.25)',borderRadius:10,padding:'10px 14px',marginBottom:10,fontSize:12}}>
                <div style={{display:'flex',alignItems:'flex-start',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                  <span style={{fontSize:16}}>⚠️</span>
                  <span style={{color:'#f59e0b',flex:1,lineHeight:1.6}}>
                    <strong>{noInvoicePaid.length} comenzi plătite fără factură: </strong>
                    {noInvoicePaid.map(o => (
                      <button key={o.id} onClick={() => {
                        setFilter('toate'); setCourierFilter('toate'); setSearch(o.name);
                        setTimeout(() => document.querySelector('.tscroll')?.scrollIntoView({behavior:'smooth',block:'start'}), 100);
                      }} style={{background:'transparent',border:'none',color:'#f97316',fontWeight:700,cursor:'pointer',fontSize:12,padding:'0 2px',textDecoration:'underline'}}>
                        {o.name}
                      </button>
                    ))}
                  </span>
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                  <div style={{display:'flex',alignItems:'center',gap:5}}>
                    <span style={{fontSize:10,color:'#94a3b8'}}>Serie:</span>
                    {sbInvSeriesList.length > 0
                      ? <select value={sbInvSeries} onChange={e=>{setSbInvSeries(e.target.value);ls.set('sb_inv_series',e.target.value);}}
                          style={{background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:11}}>
                          {sbInvSeriesList.map(s=><option key={s} value={s}>{s}</option>)}
                        </select>
                      : <input value={sbInvSeries} placeholder="ex: GLA"
                          onChange={e=>{setSbInvSeries(e.target.value);ls.set('sb_inv_series',e.target.value);}}
                          style={{width:70,background:'#161d24',border:'1px solid #f59e0b',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:11,outline:'none'}} />
                    }
                  </div>
                  <button onClick={generateAllInvoices} disabled={sbBulkLoading||!sbInvSeries}
                    style={{background:'#f59e0b',color:'#000',padding:'5px 14px',borderRadius:7,fontSize:11,fontWeight:700,border:'none',cursor:'pointer',opacity:(sbBulkLoading||!sbInvSeries)?.5:1}}>
                    {sbBulkLoading?'⟳ Generare...':`⚡ Generează toate (${noInvoicePaid.filter(o=>!sbInvResults[o.id]?.ok).length})`}
                  </button>
                  <a href="https://cloud.smartbill.ro/auth/login/?next=/core/integrari/" target="_blank" rel="noopener noreferrer"
                    style={{color:'#f59e0b',padding:'5px 8px',fontSize:11,textDecoration:'none',border:'1px solid rgba(245,158,11,.3)',borderRadius:7}}>
                    📄 SmartBill
                  </a>
                </div>
                {Object.values(sbInvResults).some(r=>r) && (
                  <div style={{marginTop:8,fontSize:10,display:'flex',flexWrap:'wrap',gap:4}}>
                    {noInvoicePaid.map(o=>{
                      const r=sbInvResults[o.id]; if(!r) return null;
                      return <span key={o.id} style={{padding:'2px 7px',borderRadius:10,background:r.ok?'rgba(16,185,129,.15)':'rgba(244,63,94,.15)',color:r.ok?'#10b981':'#f43f5e'}}>
                        {o.name}: {r.ok?`✓ ${r.series}${r.number}`:`✗ ${(r.error||'').slice(0,50)}`}
                      </span>;
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TRACKING LIVE STATUS PANEL */}
            {connected && allOrders.filter(o => ['incurs','outfor'].includes(o.ts) && o.trackingNo).length > 0 && (
              <div style={{background:'rgba(59,130,246,.06)',border:'1px solid rgba(59,130,246,.15)',borderRadius:12,padding:'12px 14px',marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <div style={{fontSize:10,color:'#3b82f6',textTransform:'uppercase',letterSpacing:1,fontWeight:700}}>
                    📡 Tracking Live GLS
                    <span style={{fontSize:9,color:'#475569',marginLeft:6,fontWeight:400,textTransform:'none'}}>
                      {allOrders.filter(o=>['incurs','outfor'].includes(o.ts)&&o.trackingNo).length} comenzi active
                    </span>
                  </div>
                  <button onClick={() => refreshTracking(false)} disabled={trackingLoading}
                    style={{background:'rgba(59,130,246,.12)',border:'1px solid rgba(59,130,246,.25)',color:trackingLoading?'#475569':'#3b82f6',padding:'4px 10px',borderRadius:20,fontSize:10,fontWeight:700,cursor:'pointer'}}>
                    {trackingLoading ? '⟳ Se verifică...' : `🔄 Verifică${lastTrackingCheck?' ✓':''}`}
                  </button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {allOrders.filter(o => ['incurs','outfor','pending'].includes(o.ts) && o.trackingNo).slice(0,10).map(o => {
                    const ts = trackingResults[o.id];
                    const statusColor = o.ts==='livrat'?'#10b981':o.ts==='retur'?'#f43f5e':o.ts==='outfor'?'#a855f7':'#3b82f6';
                    const statusLabel = o.ts==='livrat'?'✅ Livrat':o.ts==='retur'?'↩ Retur':o.ts==='outfor'?'🚚 La curier':'🔄 Tranzit';
                    return (
                      <div key={o.id} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,.04)'}}>
                        <span style={{fontSize:11,color:'#f97316',fontFamily:'monospace',fontWeight:700,flexShrink:0}}>{o.name}</span>
                        <span style={{fontSize:10,color:'#64748b',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.client}</span>
                        <span style={{fontSize:9,color:'#475569',fontFamily:'monospace',flexShrink:0}}>{o.trackingNo}</span>
                        <span style={{fontSize:9,fontWeight:700,color:statusColor,flexShrink:0,padding:'2px 6px',background:`${statusColor}15`,borderRadius:10,border:`1px solid ${statusColor}30`}}>{statusLabel}</span>
                        {o.trackingStatus && <span style={{fontSize:8,color:'#475569',flexShrink:0,maxWidth:80,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={o.trackingStatus}>{o.trackingStatus}</span>}
                      </div>
                    );
                  })}
                </div>
                {lastTrackingCheck && (
                  <div style={{fontSize:9,color:'#334155',marginTop:6,textAlign:'right'}}>
                    Ultima verificare: {lastTrackingCheck.toLocaleTimeString('ro-RO')}
                  </div>
                )}
              </div>
            )}

            {(glsOrders.length > 0 || sdOrders.length > 0) && (
              <div className="courier-grid" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                <div style={{background:'#0f1419',border:`1px solid ${glsError?'#f43f5e':glsDone?'#10b981':'#f97316'}`,borderRadius:10,padding:'12px 14px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                    <span style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:1,fontFamily:'monospace'}}>
                      📦 GLS
                      {glsDone?<span style={{color:'#10b981',marginLeft:4,fontWeight:700,fontSize:8}}>✓ {Object.keys(glsAwbMap).length} AWB</span>
                              :<span style={{color:'#f59e0b',marginLeft:4,fontSize:8}}>⚠ fără export</span>}
                    </span>
                    <div style={{display:'flex',gap:5,alignItems:'center'}}>
                      {glsDone&&<button onClick={clearGlsData} style={{fontSize:9,background:'transparent',border:'1px solid #243040',color:'#4a5568',borderRadius:5,padding:'2px 6px',cursor:'pointer'}}>✕</button>}
                      <label style={{fontSize:9,background:glsDone?'transparent':'rgba(249,115,22,.15)',border:`1px solid ${glsDone?'#243040':'#f97316'}`,color:glsDone?'#94a3b8':'#f97316',borderRadius:5,padding:'2px 8px',cursor:'pointer',whiteSpace:'nowrap'}}>
                        {glsLoading?'⟳':glsDone?'+ Excel':'📊 Import MyGLS'}
                        <input type="file" accept=".xlsx,.xls,.csv" multiple onChange={parseGlsExcel} style={{display:'none'}} />
                      </label>
                    </div>
                  </div>
                  {glsFiles.map((f,i)=><div key={i} style={{fontSize:8,color:'#4a5568',marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={f}>📄 {f}</div>)}
                  {glsError&&<div style={{fontSize:9,color:'#f43f5e',marginBottom:5}}>{glsError}</div>}
                  {!glsDone&&glsOrders.length>0&&!glsError&&(
                    <div style={{fontSize:9,color:'#f59e0b',marginBottom:6,lineHeight:1.5,background:'rgba(245,158,11,.07)',borderRadius:5,padding:'5px 7px'}}>
                      ⚠️ Fără export MyGLS, statusurile vin doar din xConnector.<br/>
                      <strong>MyGLS → Parcels → Export Excel</strong>
                    </div>
                  )}
                  {[
                    ['Total', glsOrders.length, '#e8edf2'],
                    ['✅ Livrate', glsLivrate, '#10b981'],
                    ['🚚 Tranzit', glsIncurs, '#3b82f6'],
                    ['🚛 În livrare', glsInLivrare, '#a855f7'],
                    ['↩️ Refuzate', glsRetur, glsRetur>0?'#f43f5e':'#94a3b8'],
                    ['❌ Anulate', glsAnulate, glsAnulate>0?'#64748b':'#334155'],
                  ].map(([lbl,val,col])=>(
                    <div key={lbl} style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                      <span style={{color:'#94a3b8'}}>{lbl}</span>
                      <span style={{color:col,fontFamily:'monospace',fontWeight:700}}>{val}</span>
                    </div>
                  ))}
                </div>
                <div style={{background:'#0f1419',border:`1px solid ${sdError?'#f43f5e':sdDone?'#10b981':'#3b82f6'}`,borderRadius:10,padding:'12px 14px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                    <span style={{fontSize:10,color:'#3b82f6',textTransform:'uppercase',letterSpacing:1,fontFamily:'monospace'}}>
                      🚀 Sameday
                      {sdDone?<span style={{color:'#10b981',marginLeft:4,fontWeight:700,fontSize:8}}>✓ {Object.keys(sdAwbMap).length} AWB</span>
                              :<span style={{color:'#f59e0b',marginLeft:4,fontSize:8}}>⚠ fără export</span>}
                    </span>
                    <div style={{display:'flex',gap:5,alignItems:'center'}}>
                      {sdDone&&<button onClick={clearSamedayData} style={{fontSize:9,background:'transparent',border:'1px solid #243040',color:'#4a5568',borderRadius:5,padding:'2px 6px',cursor:'pointer'}}>✕</button>}
                      <label style={{fontSize:9,background:sdDone?'transparent':'rgba(59,130,246,.15)',border:`1px solid ${sdDone?'#243040':'#3b82f6'}`,color:sdDone?'#94a3b8':'#3b82f6',borderRadius:5,padding:'2px 8px',cursor:'pointer',whiteSpace:'nowrap'}}>
                        {sdLoading?'⟳':sdDone?'+ Excel':'📊 Import Excel'}
                        <input type="file" accept=".xlsx,.xls" multiple onChange={parseSamedayExcel} style={{display:'none'}} />
                      </label>
                    </div>
                  </div>
                  {sdFiles.map((f,i)=><div key={i} style={{fontSize:8,color:'#4a5568',marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={f}>📄 {f}</div>)}
                  {sdError&&<div style={{fontSize:9,color:'#f43f5e',marginBottom:5}}>{sdError}</div>}
                  {!sdDone&&sdOrders.length>0&&!sdError&&(
                    <div style={{fontSize:9,color:'#f59e0b',marginBottom:6,lineHeight:1.5,background:'rgba(245,158,11,.07)',borderRadius:5,padding:'5px 7px'}}>
                      ⚠️ Fără export, refuzurile nu sunt detectate.<br/><strong>eAWB → Listă AWB → Export Excel</strong>
                    </div>
                  )}
                  {[
                    ['Total SD', sdOrders.length, '#e8edf2'],
                    ['✅ Livrate', sdLivrate, '#10b981'],
                    ['🚚 Tranzit', sdIncurs, '#3b82f6'],
                    ['📬 La curier', sdOutfor, '#a855f7'],
                    ['↩️ Refuzate', sdRetur, sdRetur>0?'#f43f5e':'#94a3b8'],
                    ['❌ Anulate', sdAnulate, sdAnulate>0?'#64748b':'#334155'],
                  ].map(([lbl,val,col])=>(
                    <div key={lbl} style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                      <span style={{color:'#94a3b8'}}>{lbl}</span>
                      <span style={{color:col,fontFamily:'monospace',fontWeight:val>0&&lbl.includes('Refuz')?700:400}}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="stitle">Comenzi</div>
            <div className="frow" style={{marginBottom:5}}>
              <div style={{display:'flex',gap:4,background:'#0a0f14',border:'1px solid #1e2a35',borderRadius:20,padding:'3px 4px',marginRight:4}}>
                <button className={`fb ${deliveryMode==='create'?'active':''}`} style={{padding:'3px 10px',fontSize:10,borderRadius:16}}
                  onClick={()=>{setDeliveryMode('create'); applyFilters(orders,filter,search,sortCol,sortDir,courierFilter);}}>
                  📦 Create
                </button>
                <button className={`fb ${deliveryMode==='fulfilled'?'active':''}`} style={{padding:'3px 10px',fontSize:10,borderRadius:16}}
                  onClick={()=>setDeliveryMode('fulfilled')}>
                  🚚 Livrate
                </button>
              </div>
              {['toate','livrat','incurs','outfor','retur','anulat','pending'].map(f=>(
                <button key={f} className={`fb ${filter===f?'active':''}`}
                  onClick={()=>{setFilter(f); if(deliveryMode==='create') applyFilters(orders,f,search,sortCol,sortDir,courierFilter);}}>
                  {f==='toate'?'Toate':STATUS_MAP[f]?.label||f}
                </button>
              ))}
              <div className="sw">
                <input type="text" placeholder="Caută…" value={search} onChange={e=>setSearch(e.target.value)} />
              </div>
            </div>
            {deliveryMode==='fulfilled' && (
              <div style={{fontSize:10,color:'#f59e0b',marginBottom:7,padding:'4px 10px',background:'rgba(245,158,11,.07)',borderRadius:7}}>
                📬 Afișezi comenzile <strong>livrate</strong> în {rangeLabel} — {filtered.length} comenzi
              </div>
            )}
            <div className="courier-row">
              <span className="courier-lbl">🚚</span>
              {[{id:'toate',label:'Toți'},{id:'sameday',label:'🚀 SD'},{id:'gls',label:'📦 GLS'},{id:'other',label:'Altul'},{id:'unknown',label:'?'}].map(({id,label})=>{
                const c = id==='toate'?null:courierBadgeCount(id);
                return (
                  <button key={id} className={`fb ${courierFilter===id?'active':''}`} onClick={()=>setCourierFilter(id)}>
                    {label}
                    {c!=null&&c>0&&<span style={{marginLeft:4,fontSize:9,background:courierFilter===id?'rgba(255,255,255,.3)':'#1e2a35',color:courierFilter===id?'white':'#94a3b8',borderRadius:10,padding:'1px 6px',fontWeight:700}}>{c}</span>}
                    {c===0&&<span style={{marginLeft:4,fontSize:9,color:'#2a3540'}}>0</span>}
                  </button>
                );
              })}
            </div>

            <div className="tcard">
              <div className="ttop">
                <h3>Comenzi Shopify</h3>
                <span className="rbadge">{filtered.length} comenzi</span>
              </div>
              <div className="tscroll">
                <table>
                  <thead><tr>
                    {[['name','Comandă',false],['ts','Status',false],['fin','Plată',true],['client','Client',false],['oras','Oraș',true],['','Produse',true],['total','Total',false],['','Factură',true],['createdAt','Data',true],['fulfilledAt','Livrat',true],['','Curier',false]].map(([col,lbl,h])=>(
                      <th key={lbl} style={h?{display:'var(--mob-hide,table-cell)'}:{}} onClick={()=>col&&handleSort(col)}>{lbl}{col?' ↕':''}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {slice.length===0?(
                      <tr><td colSpan={11}><div className="empty">📭 Nicio comandă în perioada selectată.</div></td></tr>
                    ):slice.map(o=>{
                      const st=STATUS_MAP[o.ts]||{label:o.ts};
                      const bcc=bc[o.ts]||'badge-gray';
                      const mc=o.ts==='livrat'&&o.fin==='paid'?'mg-g':o.ts==='retur'||o.ts==='anulat'?'mg-r':o.ts==='pending'?'mg-m':'mg-y';
                      const mobH={display:'var(--mob-hide,table-cell)'};
                      return (
                        <tr key={o.id} style={o.fin==='paid'&&!o.hasInvoice?{background:'rgba(245,158,11,0.05)'}:{}}>
                          <td><span className="ref">{o.name}</span></td>
                          <td><span className={`badge ${bcc}`}>{st.label}</span></td>
                          <td style={mobH}><span className={`badge ${o.fin==='paid'?'badge-green':o.fin==='pending'?'badge-yellow':'badge-gray'}`}>{o.fin}</span></td>
                          <td title={o.client}>{o.client||'—'}</td>
                          <td style={mobH}>{o.oras||'—'}</td>
                          <td title={o.prods} className="pc" style={mobH}>{o.prodShort||'—'}</td>
                          <td style={{whiteSpace:'nowrap'}}>
                            <span className={`mg ${mc}`}>{fmt(o.total)} HUF</span>
                            {' '}
                            <button onClick={(e)=>{e.stopPropagation();toggleOnlinePayment(o.id);}}
                              title={isOnlinePayment(o)?'Card online — click = COD':'COD — click = Card online'}
                              style={{background:isOnlinePayment(o)?'rgba(59,130,246,.2)':'rgba(74,85,104,.15)',border:`1px solid ${isOnlinePayment(o)?'#3b82f6':'#4a5568'}`,color:isOnlinePayment(o)?'#3b82f6':'#94a3b8',borderRadius:4,padding:'1px 5px',fontSize:9,cursor:'pointer',lineHeight:1.4}}>
                              {isOnlinePayment(o)?'💳 Card':'💵 COD'}
                            </button>
                          </td>
                          <td style={mobH}>{(()=>{
                            const invRes=sbInvResults[o.id];
                            const invLoading=sbInvLoading[o.id];
                            if(invRes?.ok) return (
                              <div style={{display:'flex',flexDirection:'column',gap:1}}>
                                <a href={invRes.invoiceUrl||'#'} target="_blank" rel="noopener noreferrer"
                                  style={{fontSize:10,color:'#10b981',fontFamily:'monospace',fontWeight:700,textDecoration:'none'}}>
                                  ✓ {invRes.series}{invRes.number} ↗
                                </a>
                                <span style={{fontSize:8,color:'#4a5568',lineHeight:1.3}}>
                                  {invRes.collected&&'💰 '}{invRes.shopifyMarked&&'🔗 '}
                                  {invRes.stockDecreased?<span style={{color:'#10b981'}}>📦 stoc scăzut</span>:<span style={{color:'#f59e0b'}}>⚠ fără gestiune</span>}
                                </span>
                              </div>
                            );
                            if(invRes?.error) return <div style={{display:'flex',flexDirection:'column',gap:2}}>
                              <span style={{fontSize:9,color:'#f43f5e',lineHeight:1.3}}>✗ {invRes.error.slice(0,60)}</span>
                              <button onClick={()=>openInvoiceModal(o)} style={{fontSize:8,background:'transparent',border:'1px solid #f43f5e',color:'#f43f5e',borderRadius:4,padding:'1px 5px',cursor:'pointer'}}>↺ Retry</button>
                            </div>;
                            if(o.hasInvoice) return <a href={o.invoiceShort||o.invoiceUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:'#10b981',fontFamily:'monospace',textDecoration:'none'}}>{o.invoiceNumber?`#${o.invoiceNumber}`:'✓ Vezi'} ↗</a>;
                            if(o.fin==='paid') return <button onClick={()=>openInvoiceModal(o)} disabled={invLoading} style={{fontSize:9,background:'rgba(245,158,11,.15)',border:'1px solid rgba(245,158,11,.4)',color:'#f59e0b',borderRadius:5,padding:'2px 7px',cursor:'pointer',whiteSpace:'nowrap',opacity:invLoading?.5:1}}>{invLoading?'⟳':'+ Factură'}</button>;
                            return <span style={{fontSize:10,color:'#4a5568'}}>—</span>;
                          })()}</td>
                          <td style={{...mobH,fontSize:'10px',color:'#94a3b8'}}>{fmtD(o.createdAt)}</td>
                          <td style={{...mobH,fontSize:'10px',color:'#94a3b8'}}>{o.fulfilledAt?fmtD(o.fulfilledAt):<span className="mg mg-m">—</span>}</td>
                          <td>
                            {o.courier==='gls'&&<span style={{fontSize:9,background:'rgba(249,115,22,.15)',color:'#f97316',border:'1px solid rgba(249,115,22,.2)',padding:'1px 5px',borderRadius:4}}>GLS</span>}
                            {o.courier==='sameday'&&(()=>{
                              const sdS=getSdStatus(o);
                              const sdColor=sdS==='livrat'?'#10b981':sdS==='retur'?'#f43f5e':sdS==='outfor'?'#a855f7':'#3b82f6';
                              const sdLabel=sdS==='livrat'?'Livrat':sdS==='retur'?'Retur':sdS==='outfor'?'La curier':sdS==='incurs'?'Tranzit':'SD';
                              return <span title={o.trackingNo} style={{fontSize:9,background:`${sdColor}22`,color:sdColor,border:`1px solid ${sdColor}44`,padding:'1px 5px',borderRadius:4,fontWeight:sdS==='retur'?700:400}}>
                                SD · {sdLabel}{!sdDone&&<span style={{color:'#4a5568'}}> ?</span>}
                              </span>;
                            })()}
                            {/* ── ICONIȚĂ ROȘIE ADRESĂ — ca XConnector ── */}
                            {o.addrIssues?.length>0&&!o.addrOk&&(
                              <button
                                onClick={e=>{e.stopPropagation();openAddrModal(o);}}
                                title={`⚠ Probleme adresă: ${o.addrIssues.join(', ')}`}
                                style={{
                                  marginLeft:4,background:'rgba(244,63,94,.15)',
                                  border:'1px solid rgba(244,63,94,.4)',
                                  color:'#f43f5e',borderRadius:4,
                                  padding:'1px 5px',fontSize:9,fontWeight:700,
                                  cursor:'pointer',lineHeight:1.5,
                                }}>
                                ⚠ adresă
                              </button>
                            )}
                            {o.trackingStatus&&<div style={{fontSize:9,color:'#64748b',marginTop:2,maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.3}} title={o.trackingStatus+(o.trackingLocation?' · '+o.trackingLocation:'')}>{o.trackingStatus}{o.trackingLocation?<span style={{color:'#334155'}}> · {o.trackingLocation}</span>:''}</div>}
                            {o.trackingLastUpdate&&<div style={{fontSize:8,color:'#334155',marginTop:1}}>{String(o.trackingLastUpdate).slice(0,16).replace('T',' ')}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pages>1&&(
                <div className="pag">
                  <button className={`pb ${pg===1?'dis':''}`} onClick={()=>setPg(p=>Math.max(1,p-1))}>‹</button>
                  {Array.from({length:pages},(_,i)=>i+1).filter(i=>i===1||i===pages||Math.abs(i-pg)<=2).map((i,idx,arr)=>(
                    <span key={i}>
                      {idx>0&&arr[idx-1]!==i-1&&<span className="pi">…</span>}
                      <button className={`pb ${i===pg?'act':''}`} onClick={()=>setPg(i)}>{i}</button>
                    </span>
                  ))}
                  <button className={`pb ${pg===pages?'dis':''}`} onClick={()=>setPg(p=>Math.min(pages,p+1))}>›</button>
                  <span className="pi">{pg}/{pages}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {invoiceModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.75)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'16px'}}
          onClick={e=>{if(e.target===e.currentTarget)setInvoiceModal(null);}}>
          <div style={{background:'#0f1419',border:'1px solid #243040',borderRadius:14,width:'100%',maxWidth:560,maxHeight:'90vh',overflow:'auto',padding:'20px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:'#e8edf2'}}>📄 Factură {invoiceModal.order.name}</div>
                <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{invoiceModal.order.client} · {fmt(invoiceModal.order.total)} HUF</div>
              </div>
              <button onClick={()=>setInvoiceModal(null)} style={{background:'transparent',border:'1px solid #243040',color:'#94a3b8',borderRadius:8,padding:'4px 10px',cursor:'pointer',fontSize:13}}>✕</button>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,padding:'8px 10px',background:'#080c10',borderRadius:8,border:'1px solid #243040'}}>
              <span style={{fontSize:11,color:'#94a3b8',whiteSpace:'nowrap'}}>Serie factură:</span>
              {sbInvSeriesList.length>0
                ?<select value={invoiceModal.seriesInput||sbInvSeries} onChange={e=>setInvoiceModal(prev=>({...prev,seriesInput:e.target.value}))}
                    style={{flex:1,background:'#161d24',border:'1px solid #3b82f6',color:'#e8edf2',padding:'5px 8px',borderRadius:6,fontSize:12}}>
                    {sbInvSeriesList.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                :<input value={invoiceModal.seriesInput||''} onChange={e=>setInvoiceModal(prev=>({...prev,seriesInput:e.target.value}))}
                    placeholder="ex: GLA, FACT..."
                    style={{flex:1,background:'#161d24',border:'1px solid #3b82f6',color:'#e8edf2',padding:'5px 8px',borderRadius:6,fontSize:12,outline:'none'}} />
              }
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,padding:'8px 10px',background:'#080c10',borderRadius:8,border:'1px solid #243040'}}>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',flex:1}}>
                <div onClick={()=>{setSbUseStock(v=>{ls.set('sb_use_stock',String(!v));return !v;})}}
                  style={{width:32,height:18,borderRadius:9,background:sbUseStock?'#10b981':'#243040',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
                  <div style={{width:14,height:14,borderRadius:7,background:'white',position:'absolute',top:2,left:sbUseStock?16:2,transition:'left .2s'}}/>
                </div>
                <span style={{fontSize:11,color:sbUseStock?'#10b981':'#94a3b8'}}>Descarcă stoc din gestiune SmartBill</span>
              </label>
            </div>
            {sbUseStock && (
              <div style={{marginTop:-8,marginBottom:12,display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:'#080c10',borderRadius:8,border:'1px solid #243040'}}>
                <span style={{fontSize:10,color:'#94a3b8',whiteSpace:'nowrap'}}>Gestiune:</span>
                {sbWarehouseList.length > 0
                  ? <select value={sbWarehouse} onChange={e=>{setSbWarehouse(e.target.value);ls.set('sb_warehouse',e.target.value);}}
                      style={{flex:1,background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:11}}>
                      {sbWarehouseList.map(w=><option key={w} value={w}>{w}</option>)}
                    </select>
                  : <input value={sbWarehouse} placeholder="ex: Depozit principal"
                      onChange={e=>{setSbWarehouse(e.target.value);ls.set('sb_warehouse',e.target.value);}}
                      style={{flex:1,background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:11,outline:'none'}} />
                }
              </div>
            )}
            {/* Serie chitanță — pentru încasare automată comenzi plătite */}
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
              <span style={{fontSize:11,color:'#94a3b8',minWidth:90}}>Serie chitanță</span>
              <input value={sbPaySeries} placeholder="ex: CHT (opțional)"
                onChange={e=>{setSbPaySeries(e.target.value);ls.set('sb_pay_series',e.target.value);}}
                style={{flex:1,background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:11,outline:'none'}} />
            </div>
            <div style={{background:'#080c10',borderRadius:8,padding:'10px 12px',marginBottom:16,fontSize:11,color:'#94a3b8',lineHeight:1.7}}>
              <strong style={{color:'#e8edf2'}}>Client:</strong> {invoiceModal.order.client}<br/>
              {invoiceModal.order.oras&&<><strong style={{color:'#e8edf2'}}>Oraș:</strong> {invoiceModal.order.oras}<br/></>}
              {invoiceModal.order.address&&<><strong style={{color:'#e8edf2'}}>Adresă:</strong> {invoiceModal.order.address}</>}
            </div>
            <div style={{fontSize:11,color:'#94a3b8',marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:.5}}>Produse pe factură</div>
            <div style={{marginBottom:12}}>
              {invoiceModal.editItems.map((item,idx)=>(
                <div key={idx} style={{background:'#080c10',borderRadius:8,padding:'10px 12px',marginBottom:8,border:'1px solid #1e2a35'}}>
                  <div style={{display:'flex',gap:8,marginBottom:6}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:9,color:'#4a5568',marginBottom:3,textTransform:'uppercase'}}>Produs</div>
                      <input value={item.name} onChange={e=>setInvoiceModal(prev=>{const items=[...prev.editItems];items[idx]={...items[idx],name:e.target.value};return{...prev,editItems:items};})}
                        style={{width:'100%',background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'6px 9px',borderRadius:6,fontSize:11,outline:'none'}} />
                    </div>
                    <div style={{width:80}}>
                      <div style={{fontSize:9,color:'#4a5568',marginBottom:3,textTransform:'uppercase'}}>SKU</div>
                      <input value={item.sku||''} onChange={e=>setInvoiceModal(prev=>{const items=[...prev.editItems];items[idx]={...items[idx],sku:e.target.value};return{...prev,editItems:items};})}
                        style={{width:'100%',background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'6px 9px',borderRadius:6,fontSize:11,outline:'none'}} />
                    </div>
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
                    <div style={{width:70}}>
                      <div style={{fontSize:9,color:'#4a5568',marginBottom:3,textTransform:'uppercase'}}>Cant.</div>
                      <input type="number" min="1" value={item.qty} onChange={e=>setInvoiceModal(prev=>{const items=[...prev.editItems];items[idx]={...items[idx],qty:parseInt(e.target.value)||1};return{...prev,editItems:items};})}
                        style={{width:'100%',background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'6px 9px',borderRadius:6,fontSize:11,outline:'none'}} />
                    </div>
                    <div style={{width:100}}>
                      <div style={{fontSize:9,color:'#4a5568',marginBottom:3,textTransform:'uppercase'}}>Preț (HUF)</div>
                      <input type="number" step="0.01" min="0" value={item.price} onChange={e=>setInvoiceModal(prev=>{const items=[...prev.editItems];items[idx]={...items[idx],price:parseFloat(e.target.value)||0};return{...prev,editItems:items};})}
                        style={{width:'100%',background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'6px 9px',borderRadius:6,fontSize:11,outline:'none'}} />
                    </div>
                    <div style={{flex:1,textAlign:'right',fontSize:12,color:'#f97316',fontWeight:700,fontFamily:'monospace',paddingBottom:2}}>{fmt(item.qty*item.price)} HUF</div>
                    {invoiceModal.editItems.length>1&&(
                      <button onClick={()=>setInvoiceModal(prev=>({...prev,editItems:prev.editItems.filter((_,i)=>i!==idx)}))}
                        style={{background:'rgba(244,63,94,.1)',border:'1px solid rgba(244,63,94,.3)',color:'#f43f5e',borderRadius:6,padding:'5px 8px',cursor:'pointer',fontSize:12,flexShrink:0}}>✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={()=>setInvoiceModal(prev=>({...prev,editItems:[...prev.editItems,{name:'',sku:'',qty:1,price:0}]}))}
              style={{width:'100%',background:'transparent',border:'1px dashed #243040',color:'#4a5568',borderRadius:8,padding:'8px',cursor:'pointer',fontSize:11,marginBottom:16}}>
              + Adaugă produs
            </button>
            <div style={{borderTop:'1px solid #1e2a35',paddingTop:14,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
              <div>
                <div style={{fontSize:10,color:'#94a3b8'}}>Total factură</div>
                <div style={{fontSize:18,fontWeight:800,color:'#f97316',fontFamily:'monospace'}}>{fmt(invoiceModal.editItems.reduce((s,i)=>s+i.qty*i.price,0))} HUF</div>
                {Math.abs(invoiceModal.editItems.reduce((s,i)=>s+i.qty*i.price,0)-invoiceModal.order.total)>0.5&&(
                  <div style={{fontSize:9,color:'#f59e0b',marginTop:2}}>⚠ Diferă față de comanda Shopify ({fmt(invoiceModal.order.total)} HUF)</div>
                )}
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setInvoiceModal(null)} style={{background:'transparent',border:'1px solid #243040',color:'#94a3b8',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontSize:12}}>Anulează</button>
                <button onClick={()=>{
                    if(invoiceModal.seriesInput){setSbInvSeries(invoiceModal.seriesInput);ls.set('sb_inv_series',invoiceModal.seriesInput);}
                    generateInvoice({...invoiceModal.order,_seriesOverride:invoiceModal.seriesInput||sbInvSeries},invoiceModal.editItems);
                  }}
                  disabled={!(invoiceModal.seriesInput||sbInvSeries)}
                  style={{background:'#f97316',color:'white',border:'none',borderRadius:8,padding:'8px 20px',cursor:'pointer',fontSize:12,fontWeight:700,opacity:!(invoiceModal.seriesInput||sbInvSeries)?.5:1}}>
                  ⚡ Generează Factura
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL ADDRESS CORRECTION — identic XConnector ══ */}
      {addrModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.78)',zIndex:1100,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={e=>{if(e.target===e.currentTarget)setAddrModal(null);}}>
          <div style={{background:'#0f1419',border:'1px solid #243040',borderRadius:14,width:'100%',maxWidth:500,maxHeight:'92vh',overflow:'auto'}}>

            {/* Header */}
            <div style={{padding:'16px 20px 12px',borderBottom:'1px solid #1e2a35',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:'#e8edf2'}}>
                  Order {addrModal.order.name} / {addrModal.order.id}
                  <span style={{fontSize:11,color:'#f43f5e',marginLeft:8,background:'rgba(244,63,94,.1)',padding:'1px 7px',borderRadius:10,border:'1px solid rgba(244,63,94,.2)'}}>⚠ Address correction</span>
                </div>
              </div>
              <button onClick={()=>setAddrModal(null)} style={{background:'transparent',border:'1px solid #243040',color:'#94a3b8',borderRadius:8,padding:'3px 9px',cursor:'pointer',fontSize:13}}>✕</button>
            </div>

            <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:10}}>

              {/* Erori detectate */}
              {addrModal.issues.length>0&&(
                <div style={{background:'rgba(244,63,94,.08)',border:'1px solid rgba(244,63,94,.25)',borderRadius:8,padding:'8px 12px',fontSize:11,color:'#f43f5e',lineHeight:1.7}}>
                  {addrModal.issues.map((iss,i)=>(
                    <div key={i}>⚠ {iss.msg||iss}</div>
                  ))}
                </div>
              )}

              {/* Sugestie adresă — ca XConnector */}
              {addrModal.suggestion&&(
                <div style={{background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:8,padding:'10px 12px',fontSize:12}}>
                  <div style={{fontSize:10,color:'#10b981',fontWeight:700,marginBottom:4}}>
                    The address [{addrModal.editFields.city}, {addrModal.editFields.city}, {addrModal.editFields.address}] matches the ZIP code [{addrModal.suggestion.postcode}]. Internal.
                  </div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{color:'#94a3b8',fontSize:12}}>
                      📍 {addrModal.suggestion.city}, {addrModal.suggestion.county && addrModal.suggestion.county+', '}{addrModal.suggestion.formattedAddress}
                    </div>
                    <button onClick={applyAddrSuggestion}
                      style={{background:'#10b981',color:'white',border:'none',borderRadius:6,padding:'4px 14px',fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0,marginLeft:8}}>
                      fix
                    </button>
                  </div>
                </div>
              )}

              {/* Câmpuri editabile */}
              {[
                {key:'name',    label:'Name',           type:'text'},
                {key:'email',   label:'Email',          type:'email'},
                {key:'phone',   label:'Phone number',   type:'tel'},
                {key:'address', label:'Address',        type:'text'},
                {key:'address2',label:'Address details',type:'text'},
                {key:'city',    label:'City',           type:'text'},
                {key:'county',  label:'County',         type:'text'},
                {key:'zip',     label:'Zip code',       type:'text'},
                {key:'country', label:'Country',        type:'text'},
              ].map(({key,label,type})=>{
                const hasErr = addrModal.issues.some(i=>(i.field||'')===key);
                return (
                  <div key={key}>
                    <div style={{fontSize:11,color:'#64748b',marginBottom:3}}>{label}</div>
                    <input
                      type={type}
                      value={addrModal.editFields[key]||''}
                      onChange={e=>setAddrModal(prev=>({...prev,editFields:{...prev.editFields,[key]:e.target.value}}))}
                      style={{
                        width:'100%',background:'#161d24',
                        border:`1px solid ${hasErr?'#f43f5e':'#243040'}`,
                        color:'#e8edf2',padding:'8px 11px',borderRadius:7,
                        fontSize:13,outline:'none',fontFamily:'inherit',
                      }}
                    />
                  </div>
                );
              })}

              {/* Checkbox Update customer address in Shopify */}
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginTop:2}}>
                <input type="checkbox" checked={addrModal.updateCustomer}
                  onChange={e=>setAddrModal(prev=>({...prev,updateCustomer:e.target.checked}))}
                  style={{width:14,height:14,accentColor:'#f97316'}}/>
                <span style={{fontSize:12,color:'#94a3b8'}}>Update customer's address in Shopify</span>
              </label>

              {/* Acțiuni */}
              <div style={{display:'flex',gap:8,marginTop:4}}>
                <button
                  onClick={()=>validateAddressApi(addrModal.editFields)}
                  disabled={addrValidating}
                  style={{flex:1,background:'rgba(59,130,246,.12)',border:'1px solid rgba(59,130,246,.3)',color:'#3b82f6',borderRadius:8,padding:'9px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',opacity:addrValidating?.6:1}}>
                  {addrValidating?'⟳ Verifică...':'🔍 Verifică adresa'}
                </button>
                <button onClick={()=>setAddrModal(null)}
                  style={{background:'transparent',border:'1px solid #243040',color:'#94a3b8',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>
                  Close
                </button>
                <button onClick={saveAddressToShopify} disabled={addrModal.saving}
                  style={{background:'#f97316',color:'white',border:'none',borderRadius:8,padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',opacity:addrModal.saving?.6:1}}>
                  {addrModal.saving?'⟳ Se salvează...':'Update'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sbCredsOpen&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:1100,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={e=>{if(e.target===e.currentTarget)setSbCredsOpen(false);}}>
          <div style={{background:'#0f1419',border:'1px solid #f97316',borderRadius:14,width:'100%',maxWidth:420,padding:24}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:700,color:'#e8edf2'}}>🔑 Credențiale SmartBill</div>
              <button onClick={()=>setSbCredsOpen(false)} style={{background:'transparent',border:'1px solid #243040',color:'#94a3b8',borderRadius:8,padding:'3px 9px',cursor:'pointer'}}>✕</button>
            </div>
            {[
              {label:'Email cont SmartBill',val:sbEmail,set:setSbEmail,key:'sb_email',type:'text',ph:'email@firma.ro'},
              {label:'Token API SmartBill',val:sbToken,set:setSbToken,key:'sb_token',type:'password',ph:'token din contul SmartBill'},
              {label:'CIF firmă',val:sbCif,set:setSbCif,key:'sb_cif',type:'text',ph:'RO12345678'},
            ].map(({label,val,set,key,type,ph})=>(
              <div key={key} style={{marginBottom:12}}>
                <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:.5,marginBottom:4}}>{label}</div>
                <input type={type} value={val} placeholder={ph} onChange={e=>set(e.target.value)}
                  style={{width:'100%',background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'8px 11px',borderRadius:7,fontSize:12,fontFamily:'monospace',outline:'none',boxSizing:'border-box'}} />
              </div>
            ))}
            <button onClick={()=>{ls.set('sb_email',sbEmail);ls.set('sb_token',sbToken);ls.set('sb_cif',sbCif);setSbCredsOpen(false);loadSbSeries();}}
              disabled={!sbEmail||!sbToken||!sbCif}
              style={{width:'100%',background:'#f97316',color:'white',border:'none',borderRadius:9,padding:'10px',fontWeight:700,fontSize:13,cursor:'pointer',marginTop:4,opacity:(!sbEmail||!sbToken||!sbCif)?.5:1}}>
              💾 Salvează și continuă
            </button>
          </div>
        </div>
      )}

      {/* ══ MODAL LIVRATE ══ */}
      {showLivrateModal && (
        <div style={{position:'fixed',inset:0,zIndex:998,display:'flex',flexDirection:'column',background:'#07090e'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,.07)',background:'rgba(7,9,14,.98)',backdropFilter:'blur(20px)',flexShrink:0}}>
            <button onClick={()=>setShowLivrateModal(false)}
              style={{background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.1)',color:'#94a3b8',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:700,cursor:'pointer'}}>
              ← Înapoi
            </button>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:800,color:'#10b981'}}>✅ Comenzi livrate</div>
              <div style={{fontSize:10,color:'#475569',marginTop:1}}>{livrateOrders.length} comenzi · {rangeLabel}</div>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:'#10b981',fontFamily:'monospace'}}>{fmt(sI)} HUF</div>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'0 0 60px'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,padding:'12px 16px 8px'}}>
              {[
                {l:'Total livrate',v:livrateOrders.length,c:'#10b981'},
                {l:'Valoare COD',v:fmt(sICOD)+' HUF',c:'#f97316'},
                {l:'Valoare card',v:fmt(sIPaid)+' HUF',c:'#3b82f6'},
              ].map(({l,v,c})=>(
                <div key={l} style={{background:'#0d1520',border:`1px solid ${c}22`,borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                  <div style={{fontSize:14,fontWeight:800,color:c}}>{v}</div>
                  <div style={{fontSize:9,color:'#475569',marginTop:2,textTransform:'uppercase',letterSpacing:.5}}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{margin:'0 16px',background:'#0a0f1a',border:'1px solid #1a2535',borderRadius:12,overflow:'hidden'}}>
              <div style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr 80px 70px',gap:0,padding:'7px 14px',borderBottom:'1px solid #1a2535',background:'rgba(255,255,255,.02)'}}>
                {['Comandă','Client','Produse','Total','Livrat'].map(h=>(
                  <div key={h} style={{fontSize:9,color:'#334155',textTransform:'uppercase',letterSpacing:.6,fontWeight:700}}>{h}</div>
                ))}
              </div>
              {livrateOrders.length === 0 ? (
                <div style={{padding:24,textAlign:'center',color:'#334155',fontSize:13}}>Nicio comandă livrată în această perioadă.</div>
              ) : livrateOrders.map(o => (
                <div key={o.id} style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr 80px 70px',gap:0,padding:'10px 14px',borderBottom:'1px solid #0d1520',alignItems:'center'}}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.02)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <div>
                    <div style={{fontSize:11,fontWeight:800,color:'#f97316',fontFamily:'monospace'}}>{o.name}</div>
                    <div style={{fontSize:9,color:'#334155',marginTop:1}}>
                      {o.courier==='gls'?'🚚 GLS':o.courier==='sameday'?'⚡ SD':'📦'}
                      {isOnlinePayment(o)&&<span style={{marginLeft:4,color:'#3b82f6',fontWeight:700}}>CARD</span>}
                    </div>
                  </div>
                  <div style={{fontSize:11,color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:8}}>{o.client}</div>
                  <div style={{fontSize:10,color:'#64748b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:8}}>{o.prodShort}</div>
                  <div style={{fontSize:12,fontWeight:700,color:'#10b981',fontFamily:'monospace'}}>{fmt(o.total)}</div>
                  <div style={{fontSize:10,color:'#475569'}}>{(o.fulfilledAt||'').slice(0,10).split('-').reverse().join('.')}</div>
                </div>
              ))}
              <div style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr 80px 70px',gap:0,padding:'10px 14px',background:'rgba(16,185,129,.04)',borderTop:'2px solid rgba(16,185,129,.15)'}}>
                <div style={{fontSize:11,fontWeight:800,color:'#e2e8f0',gridColumn:'1/4'}}>TOTAL {livrateOrders.length} comenzi</div>
                <div style={{fontSize:13,fontWeight:900,color:'#10b981',fontFamily:'monospace'}}>{fmt(sI)}</div>
                <div/>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL RETUR ══ */}
      {showReturModal && (()=>{
        const returOrders = [
          ...orders.filter(o => getFinalStatus(o) === 'retur'),
          ...retururiExtra,
        ];
        const seen = new Set();
        const returDedup = returOrders.filter(o => { if(seen.has(o.id)) return false; seen.add(o.id); return true; });
        const glsReturOrdersModal = glsDone ? glsOrders.filter(o => {
          const glsSt = getGlsStatusFinal(o);
          return glsSt === 'retur' && !seen.has(o.id);
        }) : [];
        const allRetur = [...returDedup, ...glsReturOrdersModal];
        const totalRetur = allRetur.reduce((s,o)=>s+o.total,0);
        return (
          <div style={{position:'fixed',inset:0,zIndex:998,display:'flex',flexDirection:'column',background:'#07090e'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,.07)',background:'rgba(7,9,14,.98)',backdropFilter:'blur(20px)',flexShrink:0}}>
              <button onClick={()=>setShowReturModal(false)}
                style={{background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.1)',color:'#94a3b8',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                ← Înapoi
              </button>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:800,color:'#f43f5e'}}>↩️ Comenzi returnate</div>
                <div style={{fontSize:10,color:'#475569',marginTop:1}}>{allRetur.length} comenzi · {rangeLabel}</div>
              </div>
              <div style={{fontSize:12,fontWeight:700,color:'#f43f5e',fontFamily:'monospace'}}>-{fmt(totalRetur)} HUF</div>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'0 0 60px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,padding:'12px 16px 8px'}}>
                {[
                  {l:'Total retur',v:allRetur.length,c:'#f43f5e'},
                  {l:'Valoare pierdută',v:fmt(totalRetur)+' HUF',c:'#f43f5e'},
                  {l:'Din GLS Excel',v:glsReturOrdersModal.length,c:'#f59e0b'},
                ].map(({l,v,c})=>(
                  <div key={l} style={{background:'#0d1520',border:`1px solid ${c}22`,borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                    <div style={{fontSize:14,fontWeight:800,color:c}}>{v}</div>
                    <div style={{fontSize:9,color:'#475569',marginTop:2,textTransform:'uppercase',letterSpacing:.5}}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{margin:'0 16px',background:'#0a0f1a',border:'1px solid #1a2535',borderRadius:12,overflow:'hidden'}}>
                <div style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr 80px 90px',gap:0,padding:'7px 14px',borderBottom:'1px solid #1a2535',background:'rgba(255,255,255,.02)'}}>
                  {['Comandă','Client','Produse','Total','Sursă'].map(h=>(
                    <div key={h} style={{fontSize:9,color:'#334155',textTransform:'uppercase',letterSpacing:.6,fontWeight:700}}>{h}</div>
                  ))}
                </div>
                {allRetur.length === 0 ? (
                  <div style={{padding:24,textAlign:'center',color:'#334155',fontSize:13}}>Nicio comandă returnată în această perioadă.</div>
                ) : allRetur.map(o => {
                  const isGlsEx = glsReturOrdersModal.some(g=>g.id===o.id);
                  const isExtraPeriod = retururiExtra.some(r=>r.id===o.id);
                  return (
                    <div key={o.id} style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr 80px 90px',gap:0,padding:'10px 14px',borderBottom:'1px solid #0d1520',alignItems:'center'}}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(244,63,94,.03)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div>
                        <div style={{fontSize:11,fontWeight:800,color:'#f97316',fontFamily:'monospace'}}>{o.name}</div>
                        <div style={{fontSize:9,color:'#334155',marginTop:1}}>{o.courier==='gls'?'🚚 GLS':o.courier==='sameday'?'⚡ SD':'📦'}</div>
                      </div>
                      <div style={{fontSize:11,color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:8}}>{o.client}</div>
                      <div style={{fontSize:10,color:'#64748b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:8}}>{o.prodShort}</div>
                      <div style={{fontSize:12,fontWeight:700,color:'#f43f5e',fontFamily:'monospace'}}>{fmt(o.total)}</div>
                      <div style={{fontSize:10}}>
                        {isGlsEx
                          ? <span style={{color:'#f59e0b',fontWeight:700,fontSize:9,background:'rgba(245,158,11,.1)',padding:'2px 5px',borderRadius:3}}>GLS Excel</span>
                          : isExtraPeriod
                          ? <span style={{color:'#a855f7',fontWeight:700,fontSize:9,background:'rgba(168,85,247,.1)',padding:'2px 5px',borderRadius:3}}>Altă per.</span>
                          : <span style={{color:'#f43f5e',fontWeight:700,fontSize:9,background:'rgba(244,63,94,.1)',padding:'2px 5px',borderRadius:3}}>Retur</span>}
                        <div style={{color:'#334155',fontSize:9,marginTop:2}}>{(o.createdAt||'').slice(0,10).split('-').reverse().join('.')}</div>
                      </div>
                    </div>
                  );
                })}
                <div style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr 80px 90px',gap:0,padding:'10px 14px',background:'rgba(244,63,94,.04)',borderTop:'2px solid rgba(244,63,94,.15)'}}>
                  <div style={{fontSize:11,fontWeight:800,color:'#e2e8f0',gridColumn:'1/4'}}>TOTAL {allRetur.length} retururi</div>
                  <div style={{fontSize:13,fontWeight:900,color:'#f43f5e',fontFamily:'monospace'}}>-{fmt(totalRetur)}</div>
                  <div/>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </>
  );
}
