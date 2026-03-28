'use client';
import { useState, useEffect, useCallback } from 'react';

// Helper safe pentru localStorage — returnează null pe server (SSR/prerender)
const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { if (typeof window !== 'undefined') localStorage.removeItem(k); } catch {} },
};

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
  const courier = trackingCompany.includes('sameday') ? 'sameday'
                : trackingCompany.includes('gls') ? 'gls'
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
    const t = ls.get('gx_t');
    const d = ls.get('gx_d');
    if (t) setToken(t);
    if (d) setDomain(d);
    setTimeout(loadSbSeries, 500);
    const saved = ls.get('gx_orders_all') || ls.get('gx_orders_60');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setAllOrders(parsed);
        setConnected(true);
        const ts = ls.get('gx_fetch_time');
        if (ts) setLastFetch(new Date(ts));
        const ff = ls.get('gx_fetched_from');
        if (ff) setFetchedFrom(ff);
        applyDateFilter(parsed, 'last_30', '', '');
      } catch {}
    }
  }, []);

  const applyDateFilter = useCallback((ords, p, cf, ct) => {
    const { from, to } = getRange(p, cf, ct);
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');
    const inRange = ords.filter(o => {
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
    const url = `/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&created_at_min=${fromDate}T00:00:00${force?'&force=1':''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.orders) throw new Error(data.error || 'Răspuns invalid');
    return data.orders.map(procOrder);
  };

  const fetchOrders = async (forceMode) => {
    if (!domain || !token) { setError('Completează domeniul și tokenul!'); return; }
    ls.set('gx_d', domain);
    ls.set('gx_t', token);
    setLoading(true); setError('');

    // FAZA 1: Ultimele 30 zile — rapid, eroarea e vizibilă
    let fast = [];
    try {
      const d30 = toISO(new Date(Date.now() - 30*24*60*60*1000));
      fast = await fetchOrdersRange(d30, !!forceMode);
      setAllOrders(fast);
      setConnected(true);
      setFetchedFrom(d30);
      const now = new Date();
      setLastFetch(now);
      ls.set('gx_orders_60', JSON.stringify(fast));
      ls.set('gx_fetch_time', now.toISOString());
      ls.set('gx_fetched_from', d30);
      applyDateFilter(fast, preset, customFrom, customTo);
    } catch (e) {
      setError('Eroare: ' + e.message);
      setLoading(false);
      return; // Oprим dacă faza 1 eșuează
    } finally {
      setLoading(false);
    }

    // FAZA 2 + 3: Background silențios — erorile nu se afișează
    setBgLoading(true);
    try {
      const d60 = toISO(new Date(Date.now() - 60*24*60*60*1000));
      const mid = await fetchOrdersRange(d60, false);
      const fastIds = new Set(fast.map(o => o.id));
      const merged60 = [...fast, ...mid.filter(o => !fastIds.has(o.id))];
      setAllOrders(merged60);
      setFetchedFrom(d60);
      ls.set('gx_orders_all', JSON.stringify(merged60));
      ls.set('gx_fetched_from', d60);
      applyDateFilter(merged60, preset, customFrom, customTo);

      // Faza 3 — 1 an
      try {
        const d365 = toISO(new Date(Date.now() - 365*24*60*60*1000));
        const oldOrders = await fetchOrdersRange(d365, false);
        const ids60 = new Set(merged60.map(o => o.id));
        const merged = [...merged60, ...oldOrders.filter(o => !ids60.has(o.id))];
        setAllOrders(merged);
        setFetchedFrom(d365);
        ls.set('gx_orders_all', JSON.stringify(merged));
        ls.set('gx_fetched_from', d365);
        applyDateFilter(merged, preset, customFrom, customTo);
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
          shopifyDomain: ls.get('gx_d') || '',
          shopifyToken:  ls.get('gx_t') || '',
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

  const disconnect = () => { setOrders([]); setConnected(false); setError(''); ls.del('gx_t'); };
  const handleSort = (col) => { if (sortCol===col) setSortDir(d=>d*-1); else { setSortCol(col); setSortDir(1); } };

  // ── KPI ──
  const n = orders.length;
  const cnt = s => orders.filter(o=>o.ts===s).length;
  const sum = ss => orders.filter(o=>ss.includes(o.ts)).reduce((a,o)=>a+o.total,0);
  const incurs=cnt('incurs'), outfor=cnt('outfor');
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

  // GLS status: prioritizăm Excel din MyGLS > Shopify/xConnector
  const getGlsStatusFinal = (o) => {
    const awb = (o.trackingNo || '').trim();
    if (awb && glsAwbMap[awb]) return glsAwbMap[awb];
    return o.ts;
  };

  const livrateOrders = allOrders.filter(o => {
    // Statusul final: GLS Excel > Shopify
    const finalTs = o.courier === 'gls' ? getGlsStatusFinal(o) : o.ts;
    if (finalTs !== 'livrat') return false;
    const fd = o.fulfilledAt ? new Date(o.fulfilledAt) : new Date(o.createdAt);
    return fd >= rangeFromD && fd <= rangeToD;
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
  const glsOrders  = orders.filter(o => o.courier === 'gls');
  const sdOrders   = orders.filter(o => o.courier === 'sameday');
  const glsLivrate = allOrders.filter(o => {
    if (o.courier !== 'gls') return false;
    const st = getGlsStatusFinal(o);
    if (st !== 'livrat') return false;
    const fd = o.fulfilledAt ? new Date(o.fulfilledAt) : new Date(o.createdAt);
    return fd >= rangeFromD && fd <= rangeToD;
  }).length;
  const glsRetur = glsOrders.filter(o => getGlsStatusFinal(o) === 'retur').length;

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
    {v:livrate,    lbl:'Livrate',       e:'✅',color:'#10b981',p:pct(livrate,n)},
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
                <button className="bsm sync-btn" onClick={() => fetchOrders('force')}>⟳ Sincronizează</button>
                {bgLoading && <span className="bg-loading">⟳</span>}
                <button className="disc-btn" onClick={disconnect}>✕</button>
              </>}
            </div>
          </div>
          {/* ROW 2: Nav links — mobile: sub logo, desktop: în hr */}
          {connected && (
            <div className="header-nav">
              <a href="/profit" className="nav-link" style={{background:'rgba(16,185,129,.12)',color:'#10b981',border:'1px solid rgba(16,185,129,.25)'}}>💹 Profit</a>
              <a href="/stats" className="nav-link" style={{background:'rgba(59,130,246,.12)',color:'#3b82f6',border:'1px solid rgba(59,130,246,.25)'}}>📊 Statistici</a>
              <a href="/import" className="nav-link" style={{background:'rgba(168,85,247,.12)',color:'#a855f7',border:'1px solid rgba(168,85,247,.25)'}}>📦 Import</a>
              <a href="/whatsapp" className="nav-link" style={{background:'rgba(37,211,102,.12)',color:'#25d366',border:'1px solid rgba(37,211,102,.25)'}}>📱 WhatsApp</a>
            </div>
          )}
        </header>

        {!connected && !loading && (
          <div className="setup">
            <h2>🔌 Conectare Shopify</h2>
            <p>Introdu datele magazinului pentru a vedea comenzile live.</p>
            <div className="info">🔒 Tokenul e trimis doar la Shopify prin serverul Next.js — fără CORS.</div>
            <label className="lbl">Domeniu magazin</label>
            <input type="text" value={domain} onChange={e=>setDomain(e.target.value)} placeholder="glamxonline.myshopify.com" />
            <label className="lbl">Admin API Access Token</label>
            <input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="shpat_..." autoComplete="off" />
            <button className="cbtn" onClick={() => fetchOrders()}>🚀 Conectează &amp; Încarcă</button>
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
                <div key={i} className="kpi" style={{'--kc':k.color}}>
                  <span className="ke">{k.e}</span>
                  <div className="kv">{k.v}</div>
                  <div className="kl">{k.lbl}</div>
                  <div className="kbar"><div className="kfill" style={{width:k.p+'%'}}></div></div>
                  <div className="kp">{k.p}%</div>
                </div>
              ))}
            </div>

            <div className="srow">
              {sI>0 && (
                <div className="sc sc1"><div className="si">💰</div><div>
                  <div className="slbl">Încasat total</div>
                  <div className="sv">{fmt(sI)} RON</div>
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
                  <div className="sv">{fmt(sA)} RON</div>
                  <div className="ssub">{incurs+outfor} comenzi în tranzit</div>
                </div></div>
              )}
              <div className="sc" style={{border:'1px solid #a855f7',background:'#0f1419'}}><div className="si">⏰</div><div>
                <div className="slbl">COD de încasat azi</div>
                <div className="sv" style={{color: sumCodIncasatAzi>0?'#a855f7':'#4a5568'}}>{fmt(sumCodIncasatAzi)} RON</div>
                <div className="ssub">
                  GLS livrate pe {twoDaysAgoStr.split('-').reverse().join('.')} · SD pe {yesterdayStr.split('-').reverse().join('.')}<br/>
                  {codIncasatAzi.length > 0 ? `${codIncasatAzi.length} colete` : 'Niciun colet COD'}
                </div>
              </div></div>
              <div className="sc" style={{border:'1px solid #10b981',background:'#0f1419'}}><div className="si">📅</div><div>
                <div className="slbl">COD livrate azi</div>
                <div className="sv" style={{color: sumCodLivrateAzi>0?'#10b981':'#4a5568'}}>{fmt(sumCodLivrateAzi)} RON</div>
                <div className="ssub">
                  {codLivrateAzi.length > 0
                    ? <>{codLivrateAzi.length} COD din {codLivrateAziTotal} livrate · ramburs pe {new Date(now.getTime()+2*86400000).toLocaleDateString('ro-RO',{day:'2-digit',month:'2-digit'})}</>
                    : `Nicio livrare COD pe ${todayStr.split('-').reverse().join('.')}`}
                </div>
              </div></div>
              {sR>0 && (
                <div className="sc sc3"><div className="si">↩️</div><div>
                  <div className="slbl">Pierdut retur/anulat</div>
                  <div className="sv">{fmt(sR)} RON</div>
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
                  {[['Total',glsOrders.length,'#e8edf2'],['✅ Livrate',glsLivrate,'#10b981'],['↩️ Returnate',glsRetur,glsRetur>0?'#f43f5e':'#94a3b8']].map(([lbl,val,col])=>(
                    <div key={lbl} style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                      <span style={{color:'#94a3b8'}}>{lbl}</span>
                      <span style={{color:col,fontFamily:'monospace',fontWeight:val>0&&lbl.includes('Retur')?700:400}}>{val}</span>
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
                  {[['Total SD',sdOrders.length,'#e8edf2'],['✅ Livrate',sdLivrate,'#10b981'],['🚚 Tranzit',sdIncurs,'#3b82f6'],['📬 La curier',sdOutfor,'#a855f7'],['↩️ Refuzate',sdRetur,sdRetur>0?'#f43f5e':'#94a3b8']].map(([lbl,val,col])=>(
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
                            <span className={`mg ${mc}`}>{fmt(o.total)} RON</span>
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
                <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{invoiceModal.order.client} · {fmt(invoiceModal.order.total)} RON</div>
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
                      <div style={{fontSize:9,color:'#4a5568',marginBottom:3,textTransform:'uppercase'}}>Preț (RON)</div>
                      <input type="number" step="0.01" min="0" value={item.price} onChange={e=>setInvoiceModal(prev=>{const items=[...prev.editItems];items[idx]={...items[idx],price:parseFloat(e.target.value)||0};return{...prev,editItems:items};})}
                        style={{width:'100%',background:'#161d24',border:'1px solid #243040',color:'#e8edf2',padding:'6px 9px',borderRadius:6,fontSize:11,outline:'none'}} />
                    </div>
                    <div style={{flex:1,textAlign:'right',fontSize:12,color:'#f97316',fontWeight:700,fontFamily:'monospace',paddingBottom:2}}>{fmt(item.qty*item.price)} RON</div>
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
                <div style={{fontSize:18,fontWeight:800,color:'#f97316',fontFamily:'monospace'}}>{fmt(invoiceModal.editItems.reduce((s,i)=>s+i.qty*i.price,0))} RON</div>
                {Math.abs(invoiceModal.editItems.reduce((s,i)=>s+i.qty*i.price,0)-invoiceModal.order.total)>0.5&&(
                  <div style={{fontSize:9,color:'#f59e0b',marginTop:2}}>⚠ Diferă față de comanda Shopify ({fmt(invoiceModal.order.total)} RON)</div>
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
    </>
  );
}

