'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

// Helper safe pentru localStorage — returnează null pe server (SSR/prerender)
const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { if (typeof window !== 'undefined') localStorage.removeItem(k); } catch {} },
};

// ── MULTI-SHOP HELPERS ─────────────────────────────────────────────────────
function getShopKey() {
  try {
    const s = typeof window !== 'undefined' ? localStorage.getItem('glamx-shop') : null;
    const p = s ? JSON.parse(s) : null;
    return p?.state?.currentShop || 'ro';
  } catch { return 'ro'; }
}
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
    // Prioritizăm: 1) delivered, 2) cel cu tracking number valid și status activ, 3) ultimul
    const deliveredF = o.fulfillments.find(f => (f.shipment_status||'').toLowerCase() === 'delivered');
    const activeF    = o.fulfillments.filter(f => f.status !== 'cancelled')
                                     .sort((a,b) => new Date(b.updated_at||0) - new Date(a.updated_at||0))[0];
    const f = deliveredF || activeF || o.fulfillments[o.fulfillments.length - 1];
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
    else if (o.fulfillment_status === 'fulfilled' || f.status === 'success') {
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
  const xcFulfillment  = (o.fulfillments || []).find(f => f.tracking_url?.includes('xconnector.app'));
  const trackingCompany = (fulfillmentData?.tracking_company || '').toLowerCase();
  const courier = trackingCompany.includes('sameday') || trackingCompany.includes('same day') || trackingCompany.includes('easybox') ? 'sameday'
                : trackingCompany.includes('gls') || trackingCompany.includes('mygls') ? 'gls'
                : trackingCompany.includes('fan') ? 'fan'
                : trackingCompany.includes('cargus') ? 'cargus'
                : trackingCompany.includes('dpd') ? 'dpd'
                : trackingCompany ? 'other' : 'unknown';
  const notes = o.note_attributes || [];
  const tags  = (o.tags || '').toLowerCase().split(',').map(t => t.trim());

  const invUrlAttr   = notes.find(a => { const n=(a.name||'').toLowerCase(); return (n.includes('invoice-url')||n.includes('invoice_url')) && !n.includes('short'); });
  const invShortAttr = notes.find(a => { const n=(a.name||'').toLowerCase(); return n.includes('invoice-short')||n.includes('invoice_short'); });
  const invNumAttr   = notes.find(a => { const n=(a.name||'').toLowerCase(); return n==='invoice-number'||n==='invoice_number'||n==='invoicenumber'; });
  const invSerAttr   = notes.find(a => { const n=(a.name||'').toLowerCase(); return n==='invoice-series'||n==='invoice_series'||n==='invoiceseries'; });

  // Label AWB — xConnector stochează URL-ul în note_attributes
  const labelAttr = notes.find(a => {
    const n = (a.name||'').toLowerCase();
    return n.includes('label-url') || n.includes('label_url') || n.includes('awb-url') || n.includes('awb_url') || n.includes('shipping-label');
  });
  const xcLabelUrl = labelAttr?.value || '';

  const invoiceUrl    = invUrlAttr?.value || '';
  const invoiceShort  = invShortAttr?.value || '';
  const invNumMatch   = invoiceUrl.match(/[?&]n=(\d+)/);

  // Citește din note_attributes (REST) sau din tag inv-SERIE-NUMAR (GraphQL)
  const invTagMatch   = tags.find(t => t.startsWith('inv-'));
  const invTagParts   = invTagMatch ? invTagMatch.split('-') : []; // ['inv','GLA','2657']
  const invTagSeries  = invTagParts.length >= 3 ? invTagParts[1].toUpperCase() : '';
  const invTagNumber  = invTagParts.length >= 3 ? invTagParts[2] : '';

  const invoiceNumber = (invNumAttr?.value || '').trim() || invTagNumber || (invNumMatch ? invNumMatch[1] : '');
  const invoiceSeries = (invSerAttr?.value || '').trim() || invTagSeries;

  // hasInvoice: URL, număr factură SAU tag invoiced
  const hasInvoice = !!(invoiceUrl || invoiceShort || invoiceNumber || tags.includes('invoiced'));
  return {
    id: o.id, name: o.name || '', fin: o.financial_status || '', ts,
    trackingNo, client: addr.name || '', oras: addr.city || '',
    total: parseFloat(o.total_price) || 0,
    prods, prodShort: prods.length > 45 ? prods.slice(0, 45) + '…' : prods,
    createdAt: o.created_at || '', fulfilledAt, courier, trackingCompany: fulfillmentData?.tracking_company || '',
    invoiceNumber, invoiceSeries, hasInvoice, invoiceUrl, invoiceShort,
    gateway: o.payment_gateway || '',
    paidAt: o.processed_at || '',
    currency: o.presentment_currency || o.currency || 'RON',
    address: [addr.address1, addr.address2].filter(Boolean).join(', '),
    county: addr.province || '',
    zip: addr.zip || '',
    phone: o.phone || addr.phone || '',
    clientEmail: o.email || '',
    labelUrl: xcLabelUrl || xcFulfillment?.tracking_url || fulfillmentData?.tracking_url || (trackingNo ? `/api/connector/awb-label?tracking=${trackingNo}` : ''),
    utmSource: o.utmSource || '', utmMedium: o.utmMedium || '',
    utmCampaign: o.utmCampaign || '', referrerUrl: o.referrerUrl || '',
    items: (o.line_items || []).map(i => ({
      name: i.name || i.title || 'Produs',
      sku: i.sku || '',
      qty: i.quantity || 1,
      price: parseFloat(i.price) || 0,
      variantId: String(i.variant_id || ''),
      productHandle: i.product_handle || i.handle || '',
      productId: String(i.product_id || ''),
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

const fmt = n => Number(n||0).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtD = d => { if (!d) return '—'; try { const p=d.split('T')[0].split('-'); return `${p[2]}.${p[1]}.${p[0]}`; } catch { return d.slice(0,10); } };
const pct = (a,b) => b ? Math.round(a/b*100) : 0;

export default function Dashboard() {
  const [orders, setOrders]     = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [connected, setConnected] = useState(false);
  const [domain, setDomain]     = useState(() => { try { const sk=getShopKey(); return ls.get(domainKey(sk))||(sk==='ro'?ls.get('gx_d'):null)||'glamxonline.myshopify.com'; } catch { return 'glamxonline.myshopify.com'; } });
  const [token, setToken]       = useState(() => { try { const sk=getShopKey(); return ls.get(tokenKey(sk))||(sk==='ro'?ls.get('gx_t'):null)||''; } catch { return ''; } });
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
  const [tranzitFilter, setTranzitFilter] = useState('toate'); // 'toate'|'inregistrat'|'ridicat'|'centru'|'livrare'
  const [tranzitCourier, setTranzitCourier] = useState('toate'); // 'toate'|'gls'|'sameday'
  const [showExportModal, setShowExportModal] = useState(false);
  const [packedOrders, setPackedOrders] = useState(() => { try { return JSON.parse(localStorage.getItem('glamx_packed')||'{}'); } catch { return {}; } });
  const togglePacked = (id) => setPackedOrders(prev => { const n={...prev}; if(n[id]) delete n[id]; else n[id]=Date.now(); try{localStorage.setItem('glamx_packed',JSON.stringify(n));}catch{} return n; });

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
        setLiveTrackingData(prev => {
          const next = {...prev, [o.id]: {
            loading: false,
            statusCode: d.statusRaw,
            desc: d.statusDescription || d.statusRaw || '—',
            location: d.location || '',
            lastUpdate: d.lastUpdate ? new Date(d.lastUpdate).toLocaleString('ro-RO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '',
            glsStatus: d.status,
          }};
          try { localStorage.setItem('glamx_live_tracking', JSON.stringify(next)); } catch {}
          return next;
        });
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
  const [sbCheckLoading, setSbCheckLoading] = useState(false);
  const [sbCheckResults, setSbCheckResults] = useState(null); // { found: {}, notFound: [] }
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
    const sk = getShopKey();
    const t = ls.get(tokenKey(sk))  || (sk !== 'ro' ? null : ls.get('gx_t'));
    const d = ls.get(domainKey(sk)) || (sk !== 'ro' ? null : ls.get('gx_d'));
    if (t) setToken(t);
    if (d) setDomain(d);
    setTimeout(loadSbSeries, 500);
    const saved = ls.get(ordersKey(sk)) || (sk === 'ro' ? ls.get('gx_orders_60') : null);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const parsedWithOv = applyTrackingOverrides(parsed);
        setAllOrders(parsedWithOv);
        setConnected(true);
        const ts = ls.get('gx_fetch_time');
        if (ts) setLastFetch(new Date(ts));
        const ff = ls.get('gx_fetched_from');
        if (ff) setFetchedFrom(ff);
        applyDateFilter(parsedWithOv, 'last_30', '', '');
      } catch {}
    } else {
      // Nu are cache — auto-fetch (pentru RO cu credentiale, sau non-RO din server)
      const sk2 = getShopKey();
      const hasRoCreds = sk2 === 'ro' && (ls.get('gx_t') || ls.get(tokenKey('ro')));
      const isNonRo = sk2 !== 'ro';
      if (hasRoCreds || isNonRo) {
        setTimeout(() => fetchOrders(), 300);
      }
    }
  }, []);

  // ── Shop switch — reload la schimbare magazin
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== 'glamx-shop') return;
      window.location.reload();
    };
    const onGlamxShop = () => {
      window.location.reload();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('glamx:shop', onGlamxShop);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('glamx:shop', onGlamxShop);
    };
  }, []);

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

  const fetchOrdersRange = async (fromDate, force=false, _domain=null, _token=null) => {
    const sk = getShopKey();
    // Magazinele non-RO fetchează din DB server (fără credențiale browser)
    if (sk !== 'ro') {
      const url = `/api/orders-server?shop=${sk}&created_at_min=${fromDate}${force?'&force=1':''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.warning) console.warn('[orders-server]', data.warning);
      if (!res.ok || !data.orders) throw new Error(data.error || 'Răspuns server invalid');
      return data.orders;
    }
    const d = _domain || ls.get(domainKey(sk)) || ls.get('gx_d') || domain;
    const t = _token  || ls.get(tokenKey(sk))  || ls.get('gx_t') || token;
    const url = `/api/orders?domain=${encodeURIComponent(d)}&token=${encodeURIComponent(t)}&created_at_min=${fromDate}T00:00:00${force?'&force=1':''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.orders) throw new Error(data.error || 'Răspuns invalid');
    return data.orders.map(procOrder);
  };

  const fetchOrders = async (forceMode) => {
    const sk = getShopKey();
    if (sk === 'ro') {
      // RO: necesita credentiale browser
      const _domain = ls.get(domainKey(sk)) || ls.get('gx_d') || domain;
      const _token  = ls.get(tokenKey(sk))  || ls.get('gx_t') || token;
      if (!_domain || !_token) { setError('Completează domeniul și tokenul!'); return; }
      setDomain(_domain); setToken(_token);
      ls.set('gx_d', _domain); ls.set('gx_t', _token);
    }
    // Non-RO: fetchOrdersRange se ocupa singur de API server
    setLoading(true); setError('');

    // FAZA 1: Ultimele 30 zile — rapid, eroarea e vizibilă
    let fast = [];
    try {
      const d30 = toISO(new Date(Date.now() - 30*24*60*60*1000));
      fast = await fetchOrdersRange(d30, !!forceMode);
      const fastWithOverrides = applyTrackingOverrides(fast);
      setAllOrders(fastWithOverrides);
      setConnected(true);
      setFetchedFrom(d30);
      const now = new Date();
      setLastFetch(now);
      ls.set('gx_orders_60', JSON.stringify(fastWithOverrides));
      ls.set('gx_fetch_time', now.toISOString());
      ls.set('gx_fetched_from', d30);
      applyDateFilter(fastWithOverrides, preset, customFrom, customTo);
    } catch (e) {
      setError('Eroare: ' + e.message);
      setLoading(false);
      return; // Oprим dacă faza 1 eșuează
    } finally {
      setLoading(false);
    }

    // FAZA 2 + 3: Background silențios — erorile nu se afișează
    // IMPORTANT: mergem comenzile noi cu ts-urile DIN STATE (nu din Shopify raw)
    // ca să nu pierdem rezultatele de tracking GLS
    setBgLoading(true);
    try {
      const d60 = toISO(new Date(Date.now() - 60*24*60*60*1000));
      const mid = await fetchOrdersRange(d60, false);
      const fastIds = new Set(fast.map(o => o.id));
      const midNew = mid.filter(o => !fastIds.has(o.id));
      // Adăugăm doar comenzile NOI (nu suprascrim cele existente din state)
      setAllOrders(prev => {
        const prevIds = new Set(prev.map(o => o.id));
        const toAdd = applyTrackingOverrides(midNew.filter(o => !prevIds.has(o.id)));
        if (!toAdd.length) return prev;
        const merged60 = [...prev, ...toAdd];
        ls.set(ordersKey(getShopKey()), JSON.stringify(merged60));
        ls.set('gx_fetched_from', d60);
        return merged60;
      });
      setFetchedFrom(d60);

      // Faza 3 — 1 an
      try {
        const d365 = toISO(new Date(Date.now() - 365*24*60*60*1000));
        const oldOrders = await fetchOrdersRange(d365, false);
        // Adăugăm doar comenzile NOI — nu atingem cele existente cu ts corect
        setAllOrders(prev => {
          const prevIds = new Set(prev.map(o => o.id));
          const toAdd = applyTrackingOverrides(oldOrders.filter(o => !prevIds.has(o.id)));
          if (!toAdd.length) return prev;
          const merged = [...prev, ...toAdd];
          ls.set(ordersKey(getShopKey()), JSON.stringify(merged));
          ls.set('gx_fetched_from', d365);
          return merged;
        });
        setFetchedFrom(d365);
      } catch { /* ignorăm erorile din faza 3 */ }

    } catch { /* ignorăm erorile din background */ }
    finally { setBgLoading(false); }
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

  const checkSmartBillInvoices = async () => {
    const email = ls.get('sb_email');
    const token = ls.get('sb_token');
    const cif   = ls.get('sb_cif');
    if (!email || !token || !cif) { setSbCredsOpen(true); return; }

    const pending = noInvoicePaid.filter(o => !sbInvResults[o.id]?.ok);
    if (!pending.length) return;

    setSbCheckLoading(true);
    setSbCheckResults(null);
    try {
      const shopifyDomain = ls.get(domainKey(getShopKey())) || ls.get('gx_d') || '';
      const shopifyToken  = ls.get(tokenKey(getShopKey()))  || ls.get('gx_t') || '';

      const res = await fetch('/api/smartbill/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, token, cif,
          seriesName: sbInvSeries || undefined,
          shopifyDomain,
          shopifyToken,
          orders: pending.map(o => ({
            id:     o.id,
            name:   o.name,
            client: o.client,
            oras:   o.oras,
            total:  o.total,
          })),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setSbCheckResults(data);

      if (data.found && Object.keys(data.found).length > 0) {
        setAllOrders(prev => prev.map(o => {
          const f = data.found[o.name];
          if (!f) return o;
          return {
            ...o,
            hasInvoice:     true,
            invoiceNumber:  f.number,
            invoiceSeries:  f.series,
            invoiceUrl:     f.url || o.invoiceUrl,
            invoiceShort:   f.url || o.invoiceShort,
          };
        }));
        pending.forEach(o => {
          const f = data.found[o.name];
          if (f) {
            setSbInvResults(prev => ({
              ...prev,
              [o.id]: { ok: true, series: f.series, number: f.number, foundInSB: true, matchType: f.matchType },
            }));
          }
        });
      }
    } catch (e) {
      setSbCheckResults({ error: e.message });
    }
    setSbCheckLoading(false);
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

  const disconnect = () => { setOrders([]); setConnected(false); setError(''); const sk=getShopKey(); ls.del(tokenKey(sk)); if(sk==='ro') ls.del('gx_t'); };

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
              <div className="h1">Dashboard Comenzi</div>
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
              <a href="/profit"            className="nav-link" style={{background:'rgba(16,185,129,.12)', color:'#10b981',border:'1px solid rgba(16,185,129,.25)'}}>💹 Profit</a>
              <a href="/stats"             className="nav-link" style={{background:'rgba(59,130,246,.12)', color:'#3b82f6',border:'1px solid rgba(59,130,246,.25)'}}>📊 Stats</a>
              <a href="/xconnector"        className="nav-link" style={{background:'rgba(249,115,22,.12)', color:'#f97316',border:'1px solid rgba(249,115,22,.25)'}}>⚡ xConn</a>
              <a href="/sales-engine-pro"  className="nav-link" style={{background:'rgba(234,179,8,.12)',   color:'#eab308',border:'1px solid rgba(234,179,8,.25)'}}>💰 Sales</a>
              <a href="/import"            className="nav-link" style={{background:'rgba(168,85,247,.12)', color:'#a855f7',border:'1px solid rgba(168,85,247,.25)'}}>🚢 Import</a>
              <a href="/whatsapp"          className="nav-link" style={{background:'rgba(37,211,102,.12)', color:'#25d366',border:'1px solid rgba(37,211,102,.25)'}}>📱 Chat</a>
            </div>
          )}
        </header>

        {!connected && !loading && getShopKey() === 'ro' && !(ls.get('gx_t') || ls.get(tokenKey('ro'))) && (
          <div className="setup">
            <h2>🔌 Conectare Shopify</h2>
            {(() => {
              try {
                const s = localStorage.getItem('glamx-shop');
                const p = s ? JSON.parse(s) : null;
                const sk = p?.state?.currentShop || 'ro';
                const label = sk === 'ro' ? '🇷🇴 Romania' : sk === 'hu' ? '🇭🇺 Ungaria' : sk.toUpperCase();
                if (sk !== 'ro') return <p style={{background:'rgba(249,115,22,.1)',border:'1px solid rgba(249,115,22,.3)',borderRadius:8,padding:'8px 12px',fontSize:13,color:'#f97316',marginBottom:8}}>Magazin activ: <strong>{label}</strong> — introdu credențialele pentru acest magazin.</p>;
              } catch {}
              return <p>Introdu datele magazinului pentru a vedea comenzile live.</p>;
            })()}
            <div className="info">🔒 Tokenul e trimis doar la Shopify prin serverul Next.js — fără CORS.</div>
            <label className="lbl">Domeniu magazin</label>
            <input type="text" value={domain} onChange={e=>setDomain(e.target.value)} placeholder="glamxonline.myshopify.com" />
            <label className="lbl">Admin API Access Token</label>
            <input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="shpat_..." autoComplete="off" />
            <button className="cbtn" onClick={() => fetchOrders()}>🚀 Conectează &amp; Încarcă</button>
          </div>
        )}

        {!connected && !loading && getShopKey() !== 'ro' && (
          <div className="setup" style={{textAlign:'center'}}>
            <div style={{fontSize:40,marginBottom:8}}>⚡</div>
            <div style={{fontSize:16,fontWeight:700,color:'#f97316',marginBottom:8}}>
              Conectare automată {getShopKey() === 'hu' ? '🇭🇺 Ungaria' : getShopKey().toUpperCase()}
            </div>
            <div style={{fontSize:13,color:'#94a3b8',marginBottom:16}}>Se încarcă comenzile din server…</div>
            {error && <div style={{color:'#f43f5e',fontSize:13,marginBottom:12}}>{error}</div>}
            <button className="cbtn" onClick={() => fetchOrders()} style={{marginTop:8}}>🔄 Reîncearcă</button>
          </div>
        )}
        {error && getShopKey() === 'ro' && <div className="err">⚠️ {error}</div>}
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

            {/* Panel tranzit live — cu filtrare pe status și curier + export */}
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

              // Clasificare status în categorii de filtrare
              // Prioritate: 1) cod live numeric (cel mai precis) 2) status din Excel/Shopify
              const classifyTranzitStatus = (o, live) => {
                const isGls = o.courier !== 'sameday';
                const code = live?.statusCode ? parseInt(live.statusCode) : null;

                // Dacă avem cod live numeric — cel mai precis
                if (code) {
                  if (isGls) {
                    if ([4,29,32,56,58,92,93].includes(code)) return 'livrare';
                    if ([3,10,13,22,26,27,41,46,47,53,84,97,99].includes(code)) return 'centru';
                    if ([1,2,85,86].includes(code)) return 'ridicat';
                    // 51=Date înregistrate, 52=Ramburs înregistrat, 80=Pickup înregistrat
                    if ([51,52,80,83].includes(code)) return 'inregistrat';
                    // orice alt cod — fallthrough la status cunoscut
                  } else {
                    if ([10,33,34,35].includes(code)) return 'livrare';
                    if ([3,7,26,27,28,84].includes(code)) return 'centru';
                    if ([2,4,23].includes(code)) return 'ridicat';
                    if ([1].includes(code)) return 'inregistrat';
                  }
                }

                // Fallback: status rezolvat din Excel/Shopify/xConnector
                const finalStatus = getFinalStatus(o);
                // outfor = la curier (ridicat + în drum spre livrare)
                if (finalStatus === 'outfor') return 'ridicat';
                // incurs = în tranzit general — sub-clasificăm după ts intern
                // pending = AWB generat, nepredat încă
                if (o.ts === 'pending') return 'inregistrat';
                // incurs fără cod live = cel mai probabil la centru/hub
                return 'centru';
              };

              // Contoare pentru filtre
              const countByFilter = (f) => tranzitOrders.filter(o => {
                const live = liveTrackingData[o.id];
                if (tranzitCourier !== 'toate' && o.courier !== tranzitCourier) return false;
                if (f === 'toate') return true;
                return classifyTranzitStatus(o, live) === f;
              }).length;

              // Lista filtrată
              const filteredTranzit = tranzitOrders.filter(o => {
                const live = liveTrackingData[o.id];
                if (tranzitCourier !== 'toate' && o.courier !== tranzitCourier) return false;
                if (tranzitFilter === 'toate') return true;
                return classifyTranzitStatus(o, live) === tranzitFilter;
              });

              const filterBtns = [
                { key:'toate', label:'Toate', color:'#3b82f6' },
                { key:'inregistrat', label:'📋 Înregistrat', color:'#f59e0b' },
                { key:'ridicat', label:'📦 Ridicat', color:'#8b5cf6' },
                { key:'centru', label:'🏭 Centru/Depozit', color:'#06b6d4' },
                { key:'livrare', label:'🚴 În livrare', color:'#10b981' },
              ];

              // Export — pagină web interactivă: bifă, produs glamx.ro, AWB tracking
              const handleExport = () => {
                const CAT_COLORS  = {inregistrat:'#d97706',ridicat:'#7c3aed',centru:'#1d4ed8',livrare:'#059669'};
                const CAT_LABELS  = {inregistrat:'Înregistrat',ridicat:'Ridicat curier',centru:'Centru / Depozit',livrare:'În livrare'};
                const CAT_ICONS   = {inregistrat:'📋',ridicat:'📦',centru:'🏭',livrare:'🚴'};
                const CAT_STRIPE  = {inregistrat:'#f59e0b',ridicat:'#8b5cf6',centru:'#3b82f6',livrare:'#10b981'};
                const CAT_BG      = {inregistrat:'#fffbeb',ridicat:'#f5f3ff',centru:'#eff6ff',livrare:'#f0fdf4'};
                const now = new Date();
                const dateStr = now.toLocaleDateString('ro-RO',{day:'2-digit',month:'2-digit',year:'numeric'});
                const timeStr = now.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'});
                const shopDomain = domain || 'glamxonline.myshopify.com';
                const fmtDate = (d) => { if(!d) return ''; try { const p=d.split('T')[0].split('-'); return p[2]+'.'+p[1]+'.'+p[0]; } catch(e) { return d.slice(0,10); } };
                const courierLabel = tranzitCourier==='toate'?'Toți curieri':tranzitCourier==='gls'?'GLS':'Sameday';

                const ordersData = filteredTranzit.map((o) => {
                  const live = liveTrackingData[o.id];
                  const code = live?.statusCode ? parseInt(live.statusCode) : null;
                  const COURIER_CODES = o.courier === 'sameday' ? SD_CODES : GLS_CODES;
                  const statusDesc = code ? (COURIER_CODES[code] || live?.desc || ('Cod '+code)) : (live?.desc || '');
                  const cat = classifyTranzitStatus(o, live);
                  const orderNum = o.name ? (o.name.startsWith('#') ? o.name : '#'+o.name) : '#—';
                  const firstItem = o.items && o.items[0];
                  const handle = (firstItem && firstItem.productHandle)
                    || (firstItem && firstItem.name || o.prods || '')
                        .toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                        .replace(/[^a-z0-9]+/g,'-')
                        .replace(/^-+|-+$/g,'');
                  const shopifyProductUrl = handle ? ('https://glamx.ro/products/'+handle) : null;
                  const trackingUrl = o.trackingNo
                    ? (o.courier === 'sameday'
                        ? ('https://sameday.ro/awb/'+o.trackingNo)
                        : ('https://gls-group.eu/RO/ro/urmarire-colete?match='+o.trackingNo))
                    : null;
                  return {
                    id: o.id, orderNum,
                    client: o.client||'—',
                    prods: o.prods||'',
                    items: o.items||[],
                    awb: o.trackingNo||'',
                    phone: o.phone||'',
                    addr: [o.address, o.oras].filter(Boolean).join(', '),
                    total: o.total||0,
                    createdAt: fmtDate(o.createdAt),
                    courier: o.courier||'gls',
                    cat, statusDesc,
                    lastUpdate: live?.lastUpdate||'',
                    shopifyProductUrl,
                    trackingUrl,
                    labelUrl: o.labelUrl || '',
                    shopAdminUrl: 'https://'+shopDomain+'/admin/orders/'+o.id,
                  };
                });

                // Generăm bara cod vizuală pentru un AWB
                const makeBars = (awb) => {
                  const digits = awb.replace(/\s/g,'');
                  let bars = '';
                  // start
                  bars += '<div style="width:3px;background:#0f172a;border-radius:1px;"></div>';
                  bars += '<div style="width:2px;background:transparent;"></div>';
                  bars += '<div style="width:1px;background:#0f172a;border-radius:1px;"></div>';
                  bars += '<div style="width:2px;background:transparent;"></div>';
                  for(let i=0;i<digits.length;i++){
                    const d = parseInt(digits[i])||0;
                    bars += '<div style="width:'+(d%3===0?4:2)+'px;background:#0f172a;border-radius:1px;"></div>';
                    bars += '<div style="width:1px;background:transparent;"></div>';
                    bars += '<div style="width:'+(d%2===0?2:1)+'px;background:#0f172a;border-radius:1px;"></div>';
                    bars += '<div style="width:'+(d>5?2:1)+'px;background:transparent;"></div>';
                  }
                  // end
                  bars += '<div style="width:1px;background:#0f172a;border-radius:1px;"></div>';
                  bars += '<div style="width:2px;background:transparent;"></div>';
                  bars += '<div style="width:3px;background:#0f172a;border-radius:1px;"></div>';
                  return bars;
                };

                // Build summary HTML
                let summaryHtml = '';
                ['inregistrat','ridicat','centru','livrare'].forEach((cat) => {
                  const n = ordersData.filter((o) => o.cat===cat).length;
                  if(!n) return;
                  summaryHtml += '<div style="background:'+CAT_BG[cat]+';border:2px solid '+CAT_STRIPE[cat]+'55;border-radius:14px;padding:12px 10px;text-align:center;">'
                    + '<div style="font-size:18px;margin-bottom:3px;">'+CAT_ICONS[cat]+'</div>'
                    + '<div style="font-size:28px;font-weight:900;color:'+CAT_COLORS[cat]+';line-height:1;">'+n+'</div>'
                    + '<div style="font-size:9px;color:#64748b;margin-top:3px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;">'+CAT_LABELS[cat]+'</div>'
                    + '</div>';
                });

                // Build cards HTML
                let cardsHtml = '';
                ordersData.forEach((o, idx) => {
                  const s = CAT_STRIPE[o.cat]||'#64748b';
                  const bg = CAT_BG[o.cat]||'#f8fafc';
                  const cc = CAT_COLORS[o.cat]||'#334155';
                  const isGls = o.courier !== 'sameday';
                  const courierColor = isGls ? '#c2410c' : '#7c3aed';
                  const courierLabel2 = isGls ? 'GLS' : 'SAMEDAY';

                  // Product block
                  let prodHtml = '';
                  if(o.prods) {
                    let itemsHtml = '';
                    if(o.items && o.items.length > 1) {
                      o.items.forEach((item) => {
                        itemsHtml += '<div style="font-size:11px;color:#64748b;display:flex;gap:6px;margin-top:3px;">'
                          + '<span style="color:#f97316;font-weight:800;">×'+item.qty+'</span>'
                          + item.name
                          + '</div>';
                      });
                    }
                    prodHtml = '<div onclick="openProd('+idx+')" style="background:#0f172a;border-radius:12px;padding:11px 13px;margin-bottom:10px;cursor:pointer;">'
                      + '<div style="font-size:9px;font-weight:800;color:#334155;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px;">PRODUS <span style="background:rgba(59,130,246,.2);color:#93c5fd;border-radius:4px;padding:1px 5px;font-size:8px;">tap detalii</span></div>'
                      + '<div style="font-size:15px;font-weight:700;color:#f1f5f9;line-height:1.35;">'+o.prods+'</div>'
                      + itemsHtml
                      + '</div>';
                  }

                  // AWB block — stil etichetă
                  let awbHtml = '';
                  if(o.awb) {
                    var barsHtml = makeBars(o.awb);
                    var barcodeCol = '<div style="flex-shrink:0;width:48px;display:flex;align-items:center;justify-content:center;background:#fff;border-right:2px solid #e2e8f0;padding:6px 2px;overflow:hidden;">'
                      + '<div style="display:flex;gap:1.5px;height:120px;align-items:stretch;transform:rotate(-90deg) translateX(-36px);width:130px;">'
                      + barsHtml
                      + '</div></div>';
                    var rightCol = '<div style="flex:1;padding:10px 12px;display:flex;flex-direction:column;gap:3px;">'
                      + '<div style="font-size:22px;font-weight:900;color:#0f172a;letter-spacing:-.5px;line-height:1;">' + o.orderNum + '</div>'
                      + '<div style="font-size:12px;font-weight:700;color:#1e293b;line-height:1.3;font-style:italic;">' + (o.prods||'') + '</div>'
                      + '<div style="height:1px;background:#e2e8f0;margin:3px 0;"></div>'
                      + '<div style="font-family:Courier New,monospace;font-size:16px;font-weight:900;color:#0f172a;letter-spacing:2px;word-break:break-all;line-height:1.2;">' + o.awb + '</div>'
                      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;">'
                      + '<span style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">' + (isGls?'GLS Romania':'Sameday') + '</span>'
                      + (o.total>0 ? '<span style="font-size:11px;font-weight:900;color:#0f172a;background:#fef3c7;border:1.5px solid #f59e0b;padding:2px 8px;border-radius:6px;">Ramburs ' + o.total.toFixed(2) + ' RON</span>' : '')
                      + '</div></div>';
                    var labelBtns = '<div style="display:flex;gap:7px;margin-top:6px;">'
                      + '<button onclick="previewLabel('+idx+')" style="flex:1;padding:10px 8px;border-radius:10px;border:none;background:#003087;color:white;font-size:12px;font-weight:700;cursor:pointer;">👁 Preview etichetă</button>'
                      + '<button onclick="fetchAndDownload('+idx+')" id="dlbtn-'+idx+'" style="flex:1;padding:10px 8px;border-radius:10px;border:none;background:#f97316;color:white;font-size:12px;font-weight:700;cursor:pointer;">⬇ Download PDF</button>'
                      + '</div>';
                    awbHtml = '<div style="background:#fff;border:2.5px solid #1e293b;border-radius:14px;margin:10px 0 8px;overflow:hidden;box-shadow:0 3px 12px rgba(0,0,0,.15);">'
                      + '<div style="display:flex;min-height:100px;">' + barcodeCol + rightCol + '</div>'
                      + labelBtns + '</div>';
                  } else {
                    awbHtml = '<div style="background:#f8fafc;border:2px dashed #e2e8f0;border-radius:14px;padding:12px 14px;margin:10px 0 8px;">'
                      + '<span style="font-size:13px;color:#94a3b8;font-style:italic;">Fără AWB generat</span>'
                      + '</div>';
                  }

                  // Status pill
                  let statusHtml = '';
                  if(o.statusDesc) {
                    statusHtml = '<div style="display:inline-flex;align-items:center;gap:5px;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;margin-bottom:8px;background:'+s+'15;color:'+cc+';border:1px solid '+s+'44;">⚡ '+o.statusDesc+(o.lastUpdate?' · '+o.lastUpdate:'')+'</div>';
                  }

                  cardsHtml += '<div id="card-'+idx+'" style="border-radius:18px;margin-bottom:12px;display:flex;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);transition:opacity .3s,transform .2s;">'
                    + '<div style="width:7px;flex-shrink:0;background:'+s+';"></div>'
                    + '<div style="flex:1;padding:15px 15px 13px;background:'+bg+';">'
                    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'
                    + '<div><a href="'+o.shopAdminUrl+'" target="_blank" style="font-size:22px;font-weight:900;letter-spacing:-.5px;color:'+cc+';text-decoration:none;">'+o.orderNum+'</a>'
                    + '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">'+o.createdAt+'</div></div>'
                    + '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">'
                    + '<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;border:1.5px solid '+courierColor+'44;background:white;letter-spacing:.5px;color:'+courierColor+';">'+courierLabel2+'</span>'
                    + '<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;border:1px solid '+s+'55;background:'+s+'22;color:'+cc+';">'+CAT_ICONS[o.cat]+' '+CAT_LABELS[o.cat]+'</span>'
                    + '</div></div>'
                    + prodHtml
                    + '<div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:5px;">'+o.client+'</div>'
                    + (o.addr ? '<div style="font-size:12px;color:#475569;margin-bottom:3px;">📍 '+o.addr+'</div>' : '')
                    + (o.phone ? '<div style="font-size:12px;color:#475569;margin-bottom:3px;">📞 '+o.phone+'</div>' : '')
                    + awbHtml
                    + statusHtml
                    + '<div id="chk-'+idx+'" onclick="toggleCheck('+idx+')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;cursor:pointer;user-select:none;border:2px dashed #cbd5e1;background:rgba(0,0,0,.02);margin-top:4px;-webkit-tap-highlight-color:transparent;">'
                    + '<div id="box-'+idx+'" style="width:26px;height:26px;border-radius:8px;border:2px solid #cbd5e1;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;background:white;"></div>'
                    + '<span id="lbl-'+idx+'" style="font-size:13px;font-weight:700;color:#94a3b8;flex:1;">Marchează ca pregătit</span>'
                    + '<span id="time-'+idx+'" style="display:none;font-size:10px;font-weight:700;color:#10b981;background:rgba(16,185,129,.1);padding:2px 8px;border-radius:20px;"></span>'
                    + '</div>'
                    + '</div></div>';
                });

                // Modal HTML
                const modalHtml = '<div id="prod-modal" onclick="if(event.target===this)closeModal()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px);">'
                  + '<div style="background:white;border-radius:24px 24px 0 0;padding:20px;width:100%;max-width:480px;max-height:85vh;overflow-y:auto;">'
                  + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
                  + '<span id="modal-title" style="font-size:16px;font-weight:800;color:#0f172a;"></span>'
                  + '<button onclick="closeModal()" style="width:32px;height:32px;border-radius:50%;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;">✕</button>'
                  + '</div>'
                  + '<div id="modal-prod-name" style="font-size:17px;font-weight:800;color:#0f172a;margin-bottom:8px;line-height:1.3;"></div>'
                  + '<div id="modal-items" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;"></div>'
                  + '<div id="modal-actions" style="display:flex;gap:8px;"></div>'
                  + '</div></div>';

                // Label preview modal
                const labelModalHtml = '<div id="label-modal" onclick="if(event.target===this)closeLabel()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2000;align-items:flex-end;justify-content:center;backdrop-filter:blur(6px);">'
                  + '<div style="background:white;border-radius:24px 24px 0 0;width:100%;max-width:480px;overflow:hidden;max-height:92vh;display:flex;flex-direction:column;">'
                  + '<div style="background:#003087;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">'
                  + '<div>'
                  + '<div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:1px;">Etichetă AWB · <span id="lm-order"></span></div>'
                  + '<div style="font-family:monospace;font-size:18px;font-weight:900;color:#f59e0b;letter-spacing:2px;" id="lm-awb"></div>'
                  + '<div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:1px;" id="lm-client"></div>'
                  + '</div>'
                  + '<button onclick="closeLabel()" style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.15);border:none;color:white;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>'
                  + '</div>'
                  + '<div style="flex:1;overflow:hidden;position:relative;min-height:300px;background:#f8fafc;">'
                  + '<div id="lm-status" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#64748b;font-weight:600;"></div>'
                  + '<iframe id="lm-frame" style="width:100%;height:100%;min-height:400px;border:none;display:block;"></iframe>'
                  + '<input type="hidden" id="lm-bloburl" value="">'
                  + '</div>'
                  + '<div style="padding:12px 16px;background:white;flex-shrink:0;display:flex;gap:8px;">'
                  + '<button id="lm-download" style="flex:1;padding:13px;border-radius:12px;border:none;background:#f97316;color:white;font-size:14px;font-weight:800;cursor:pointer;">⬇ Download PDF</button>'
                  + '<a id="lm-open" onclick="var u=document.getElementById(\"lm-bloburl\").value;if(u)window.open(u,\"_blank\");" style="padding:13px 14px;border-radius:12px;background:#f1f5f9;color:#475569;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none;display:flex;align-items:center;">🔗</a>'
                  + '</div>'
                  + '</div></div>';

                const packedCount = filteredTranzit.filter((o) => packedOrders[o.id]).length;
                const progPct = ordersData.length > 0 ? Math.round(packedCount/ordersData.length*100) : 0;

                const html = '<!DOCTYPE html><html lang="ro"><head>'
                  + '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                  + '<title>Packaging GLAMX ' + dateStr + '</title>'
                  + '<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#e2e8f0;padding:14px;max-width:480px;margin:0 auto;}</style>'
                  + '</head><body>'
                  + '<div style="background:#0f172a;border-radius:20px;padding:18px 20px 16px;margin-bottom:14px;">'
                  + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">'
                  + '<div><div style="font-size:26px;font-weight:900;letter-spacing:-1px;color:white;">GLAM<em style="color:#f97316;font-style:normal;">X</em></div>'
                  + '<div style="font-size:11px;color:#475569;margin-top:2px;">Lista Packaging · '+dateStr+' '+timeStr+'</div></div>'
                  + '<div style="background:#f97316;color:white;font-size:20px;font-weight:900;width:50px;height:50px;border-radius:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(249,115,22,.4);">'+ordersData.length+'</div>'
                  + '</div>'
                  + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">'
                  + '<span style="background:rgba(249,115,22,.2);border:1px solid rgba(249,115,22,.4);color:#fdba74;border-radius:20px;padding:4px 11px;font-size:11px;font-weight:600;">📦 '+ordersData.length+' colete</span>'
                  + '<span style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#cbd5e1;border-radius:20px;padding:4px 11px;font-size:11px;font-weight:600;">🚚 '+courierLabel+'</span>'
                  + '</div>'
                  + '<div style="background:rgba(255,255,255,.08);border-radius:20px;height:8px;overflow:hidden;">'
                  + '<div id="prog" style="height:100%;background:linear-gradient(90deg,#10b981,#34d399);border-radius:20px;transition:width .4s;width:'+progPct+'%;"></div>'
                  + '</div>'
                  + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-top:5px;">'
                  + '<strong id="prog-done" style="color:#10b981;">'+packedCount+' pregătite</strong>'
                  + '<span id="prog-left">'+(ordersData.length-packedCount)+' rămase</span>'
                  + '</div></div>'
                  + '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px;">'+summaryHtml+'</div>'
                  + cardsHtml
                  + modalHtml
                  + labelModalHtml
                  + '<div style="text-align:center;font-size:10px;color:#94a3b8;margin-top:20px;padding:14px;border-top:1px solid #e2e8f0;">GLAMX Dashboard · '+dateStr+' '+timeStr+'</div>'
                  + '<script>'
                  + 'var APP_ORIGIN='+JSON.stringify(appOrigin)+';'
                  + 'const ORDERS='+JSON.stringify(ordersData)+';'
                  + 'const SAVED_KEY="glamx_pack_'+now.toISOString().slice(0,10)+'";'
                  + 'let packed={};try{packed=JSON.parse(localStorage.getItem(SAVED_KEY)||"{}");}catch(e){}'
                  + 'function save(){try{localStorage.setItem(SAVED_KEY,JSON.stringify(packed));}catch(e){}}'
                  + 'function updateProgress(){'
                  + '  var done=Object.keys(packed).length,total=ORDERS.length,pct=total>0?Math.round(done/total*100):0;'
                  + '  document.getElementById("prog").style.width=pct+"%";'
                  + '  document.getElementById("prog-done").textContent=done+" pregătite ✅";'
                  + '  document.getElementById("prog-left").textContent=(total-done)+" rămase";'
                  + '}'
                  + 'function toggleCheck(idx){'
                  + '  var o=ORDERS[idx],id=o.id,card=document.getElementById("card-"+idx);'
                  + '  var row=document.getElementById("chk-"+idx),box=document.getElementById("box-"+idx);'
                  + '  var lbl=document.getElementById("lbl-"+idx),tim=document.getElementById("time-"+idx);'
                  + '  if(packed[id]){'
                  + '    delete packed[id];card.style.opacity="1";card.style.transform="";'
                  + '    row.style.border="2px dashed #cbd5e1";row.style.background="rgba(0,0,0,.02)";'
                  + '    box.innerHTML="";box.style.background="white";box.style.border="2px solid #cbd5e1";box.style.color="";'
                  + '    lbl.textContent="Marchează ca pregătit";lbl.style.color="#94a3b8";'
                  + '    tim.style.display="none";'
                  + '  }else{'
                  + '    packed[id]=Date.now();card.style.opacity=".55";card.style.transform="scale(.98)";'
                  + '    row.style.border="2px solid rgba(16,185,129,.35)";row.style.background="rgba(16,185,129,.06)";'
                  + '    box.innerHTML="✓";box.style.background="#10b981";box.style.border="2px solid #10b981";box.style.color="white";'
                  + '    lbl.textContent="PREGĂTIT ✅";lbl.style.color="#059669";'
                  + '    var t=new Date(packed[id]);tim.textContent=t.toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"});tim.style.display="";'
                  + '  }'
                  + '  save();updateProgress();'
                  + '}'
                  + 'function openProd(idx){'
                  + '  var o=ORDERS[idx];'
                  + '  document.getElementById("modal-title").textContent=o.orderNum+" · Produs";'
                  + '  document.getElementById("modal-prod-name").textContent=o.prods||"—";'
                  + '  var itemsHtml="";'
                  + '  (o.items||[]).forEach(function(i){itemsHtml+=\'<div style="background:#f8fafc;border-radius:10px;padding:10px 12px;font-size:13px;color:#334155;"><strong style="color:#f97316;">×\'+i.qty+\'</strong> \'+i.name+(i.sku?\' · <em>\'+i.sku+\'</em>\':\'\')+\'</div>\';});'
                  + '  document.getElementById("modal-items").innerHTML=itemsHtml||\'<div style="background:#f8fafc;border-radius:10px;padding:10px 12px;font-size:13px;color:#334155;">\'+o.prods+\'</div>\';'
                  + '  var actHtml=o.shopifyProductUrl'
                  + '    ? \'<a href="\'+o.shopifyProductUrl+\'" target="_blank" style="flex:1;padding:12px;border-radius:12px;background:#0f172a;color:white;font-size:13px;font-weight:700;text-align:center;text-decoration:none;">🛍️ Vezi pe GLAMX.ro</a>\''
                  + '      +\'<a href="\'+o.shopAdminUrl+\'" target="_blank" style="flex:1;padding:12px;border-radius:12px;background:#f1f5f9;color:#475569;font-size:13px;font-weight:700;text-align:center;text-decoration:none;">📋 Admin</a>\''
                  + '    : \'<a href="\'+o.shopAdminUrl+\'" target="_blank" style="flex:1;padding:12px;border-radius:12px;background:#f1f5f9;color:#475569;font-size:13px;font-weight:700;text-align:center;text-decoration:none;">📋 Comandă Admin</a>\';'
                  + '  document.getElementById("modal-actions").innerHTML=actHtml;'
                  + '  document.getElementById("modal-actions").style.display="flex";'
                  + '  document.getElementById("modal-actions").style.gap="8px";'
                  + '  document.getElementById("prod-modal").style.display="flex";'
                  + '}'
                  + 'function previewLabel(idx){'
                  + '  var o=ORDERS[idx];if(!o.awb)return;'
                  + '  var m=document.getElementById("label-modal");'
                  + '  document.getElementById("lm-awb").textContent=o.awb;'
                  + '  document.getElementById("lm-order").textContent=o.orderNum;'
                  + '  document.getElementById("lm-client").textContent=o.client;'
                  + '  document.getElementById("lm-frame").src="";'
                  + '  document.getElementById("lm-status").textContent="Se încarcă eticheta...";'
                  + '  document.getElementById("lm-download").onclick=function(){fetchAndDownload(idx);};'
                  + '  m.style.display="flex";'
                  + '  var rawUrl=o.labelUrl||"/api/connector/awb-label?tracking="+o.awb;'
                  + '  var labelUrl=rawUrl.startsWith("http://")||rawUrl.startsWith("https://")'
                  + '    ?(rawUrl.includes("xconnector.app")?APP_ORIGIN+"/api/connector/label-proxy?url="+encodeURIComponent(rawUrl):rawUrl)'
                  + '    :APP_ORIGIN+rawUrl;'
                  + '  fetch(labelUrl).then(function(r){'
     