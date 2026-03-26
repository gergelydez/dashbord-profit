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
    const f = o.fulfillments[o.fulfillments.length - 1];
    fulfilledAt = f.updated_at || f.created_at || '';
    trackingNo = f.tracking_number || '';
    const ss = (f.shipment_status || '').toLowerCase();
    if (ss === 'delivered') ts = 'livrat';
    else if (['failure','failed_attempt','returned'].includes(ss)) ts = 'retur';
    else if (ss === 'out_for_delivery') ts = 'outfor';
    else if (['in_transit','confirmed','label_printed'].includes(ss)) ts = 'incurs';
    else if (o.fulfillment_status === 'fulfilled') ts = 'incurs';
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
    gateway: o.payment_gateway || '',  // 'shopify_payments' = card online
    paidAt: o.processed_at || '',     // data când a fost plătită comanda
    currency: o.presentment_currency || o.currency || 'RON',
    address: [addr.address1, addr.address2].filter(Boolean).join(', '),
    county: addr.province || '',
    clientEmail: o.email || '',
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
  const [courierFilter, setCourierFilter] = useState('toate');

  const [sbInvLoading, setSbInvLoading] = useState({});
  const [sbInvResults, setSbInvResults] = useState({});
  const [sbInvSeries, setSbInvSeries]   = useState(() => ls.get('sb_inv_series') || '');
  const [sbInvSeriesList, setSbInvSeriesList] = useState([]);
  const [sbBulkLoading, setSbBulkLoading] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null);
  const [sbEmail, setSbEmail] = useState(() => ls.get('sb_email') || '');
  const [sbToken, setSbToken] = useState(() => ls.get('sb_token') || '');
  const [sbCif, setSbCif]     = useState(() => ls.get('sb_cif')   || '');
  const [sbCredsOpen, setSbCredsOpen] = useState(false);
  const [sbUseStock, setSbUseStock]         = useState(() => ls.get('sb_use_stock') === 'true');
  const [sbWarehouse, setSbWarehouse]       = useState(() => ls.get('sb_warehouse') || '');
  const [sbWarehouseList, setSbWarehouseList] = useState([]);
  // livreazaMode: 'create' (implicit) | 'fulfilled' (livrate în perioadă)
  const [deliveryMode, setDeliveryMode] = useState('create');

  const [preset, setPreset]         = useState('last_30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [rangeLabel, setRangeLabel] = useState('');
  const [allOrders, setAllOrders]   = useState([]);
  const [lastFetch, setLastFetch]   = useState(null);

  useEffect(() => {
    const t = ls.get('gx_t');
    const d = ls.get('gx_d');
    if (t) setToken(t);
    if (d) setDomain(d);
    setTimeout(loadSbSeries, 500);
    const saved = ls.get('gx_orders_all');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setAllOrders(parsed);
        setConnected(true);
        const ts = ls.get('gx_fetch_time');
        if (ts) setLastFetch(new Date(ts));
        applyDateFilter(parsed, 'last_30', '', '');
        // Verifică dacă datele vechi au câmpul gateway
        // Dacă nu → arată avertisment să resincronizeze
        const hasGateway = parsed.some(o => o.gateway !== undefined);
        if (!hasGateway) setError('⚠️ Date vechi în cache — apasă Resincronizează pentru detecție corectă COD vs card online.');
      } catch {}
    }
  }, []);

  // Filtrare DOAR după createdAt — sumarul arată comenzile create în perioadă
  // Cardurile COD (azi/livrate) se calculează separat din allOrders
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

  // Filtrare specială după fulfilledAt — pentru butonul "Livrate azi/ieri"
  // orders = comenzile create în perioadă
  // livrateInPeriod = toate comenzile livrate în perioada selectată (din allOrders)
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

  // Când modul e 'fulfilled', recalculează tabelul după fulfilledAt
  useEffect(() => {
    if (deliveryMode === 'fulfilled') {
      const livrate = getLivrateInPeriod(preset, customFrom, customTo);
      applyFilters(livrate, 'livrat', search, sortCol, sortDir, courierFilter);
    }
  }, [deliveryMode, preset, customFrom, customTo, getLivrateInPeriod, search, sortCol, sortDir, courierFilter, applyFilters]);

  const fetchOrders = async () => {
    if (!domain || !token) { setError('Completează domeniul și tokenul!'); return; }
    ls.set('gx_d', domain);
    ls.set('gx_t', token);
    setLoading(true); setError('');
    try {
      const fields = 'id,name,financial_status,fulfillment_status,fulfillments,cancelled_at,created_at,total_price,currency,line_items,shipping_address,billing_address,tags,note_attributes,payment_gateway,processed_at';
      const yearAgo = toISO(new Date(new Date().setFullYear(new Date().getFullYear() - 1)));
      const url = `/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&created_at_min=${yearAgo}T00:00:00&fields=${fields}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.orders) throw new Error(data.error || 'Răspuns invalid');
      const processed = data.orders.map(procOrder);
      setAllOrders(processed);
      setConnected(true);
      setError(''); // șterge avertismentul de cache vechi
      const now = new Date();
      setLastFetch(now);
      ls.set('gx_orders_all', JSON.stringify(processed));
      ls.set('gx_fetch_time', now.toISOString());
      applyDateFilter(processed, preset, customFrom, customTo);
    } catch (e) { setError('Eroare: ' + e.message); }
    finally { setLoading(false); }
  };

  const handlePreset = (id) => {
    setPreset(id);
    setDeliveryMode('create'); // resetează modul la schimbarea perioadei
    if (id !== 'custom') applyDateFilter(allOrders, id, customFrom, customTo);
  };

  const parseSamedayExcel = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setSdLoading(true);
    setSdError('');
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
          // Date Shopify pentru marcare automată post-generare
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
            // isPaid: dacă e paid cu card online, încasăm automat în SmartBill
            isPaid: order.fin === 'paid',
            useStock: sbUseStock,
            warehouseName: sbUseStock ? sbWarehouse : '',
          },
        }),
      });
      const rawText = await res.text();
      let data;
      try { data = JSON.parse(rawText); }
      catch {
        data = res.status === 404
          ? { error: 'Ruta /api/smartbill-invoice lipsește din repo.' }
          : { error: `Server error ${res.status}` };
      }
      if (data.ok) {
        setSbInvResults(prev => ({ ...prev, [order.id]: {
          ok: true, number: data.number, series: data.series,
          collected: data.collected, shopifyMarked: data.shopifyMarked,
          invoiceUrl: data.invoiceUrl,
          stockDecreased: data.stockDecreased,
          _debug: data._debug,
        }}));
        setAllOrders(prev => prev.map(o => o.id === order.id
          ? {
              ...o,
              hasInvoice: true,
              invoiceNumber: data.number,
              invoiceSeries: data.series,
              invoiceUrl: data.invoiceUrl || o.invoiceUrl,
              invoiceShort: data.invoiceUrl || o.invoiceShort,
            }
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
      if (data.series?.length) {
        setSbInvSeriesList(data.series);
        if (!sbInvSeries) setSbInvSeries(data.series[0]);
      }
      if (data.warehouses?.length) {
        setSbWarehouseList(data.warehouses);
        if (!sbWarehouse) setSbWarehouse(data.warehouses[0]);
      }
    } catch {}
  };

  const disconnect = () => { setOrders([]); setConnected(false); setError(''); ls.del('gx_t'); };
  const handleSort = (col) => { if (sortCol===col) setSortDir(d=>d*-1); else { setSortCol(col); setSortDir(1); } };

  // ── KPI ──
  // orders = comenzi CREATE în intervalul selectat (pentru Total, Tranzit, Retur, Neexpediate)
  const n = orders.length;
  const cnt = s => orders.filter(o=>o.ts===s).length;
  const sum = ss => orders.filter(o=>ss.includes(o.ts)).reduce((a,o)=>a+o.total,0);
  const incurs=cnt('incurs'), outfor=cnt('outfor');
  const retur=cnt('retur'), anulate=cnt('anulat'), pend=cnt('pending');
  const sA=sum(['incurs','outfor']), sR=sum(['retur','anulat']);

  // "Livrate" = comenzi cu fulfilledAt în intervalul selectat (nu createdAt!)
  // Astfel "Azi" arată 8 colete livrate azi, "Ieri" arată 5 livrate ieri
  const { from: rangeFrom, to: rangeTo } = getRange(preset, customFrom, customTo);
  const rangeFromD = new Date(rangeFrom + 'T00:00:00');
  const rangeToD   = new Date(rangeTo   + 'T23:59:59');
  // isOnlinePayment — detectează comenzile plătite cu card online (Shopify Payments)
  // Logică finală confirmată:
  // - gateway='shopify_payments' → Card (dacă disponibil)
  // - fin='pending' → COD mereu
  // - tag 'dispatched' (xConnector) → COD mereu (xConnector adaugă DOAR pe COD)
  // - fin='paid' fără tag 'dispatched' → Shopify Payments
  const ONLINE_GW = ['shopify_payments','stripe','paypal'];
  const isOnlinePayment = (o) => {
    // 1. Gateway explicit
    const gw = (o.gateway || '').toLowerCase();
    if (gw) return ONLINE_GW.some(g => gw.includes(g));

    // 2. pending → mereu COD
    if (o.fin === 'pending') return false;

    // 3. Tag 'dispatched' → COD (xConnector îl pune DOAR pe comenzile COD)
    const tags = (o.tags || '').toLowerCase();
    if (tags.includes('dispatched')) return false;

    // 4. paid fără 'dispatched' → Shopify Payments
    if (o.fin === 'paid') return true;

    return false;
  };

  const livrateOrders = allOrders.filter(o =>
    o.ts === 'livrat' && o.fulfilledAt &&
    new Date(o.fulfilledAt) >= rangeFromD &&
    new Date(o.fulfilledAt) <= rangeToD
  );
  const livrate = livrateOrders.length;
  const sI     = livrateOrders.reduce((a,o) => a+o.total, 0);
  const sICOD  = livrateOrders.filter(o => !isOnlinePayment(o)).reduce((a,o)=>a+o.total,0);
  const sIPaid = livrateOrders.filter(o =>  isOnlinePayment(o)).reduce((a,o)=>a+o.total,0);

  // ── COD calculations ──
  const now = new Date();
  const todayStr = toISO(now);

  // Ziua de acum 2 zile (ex: dacă azi e 26 → data = 24)
  const twoDaysAgo = new Date(now); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const twoDaysAgoStr = toISO(twoDaysAgo);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toISO(yesterday);

  // isCOD: exclude comenzi plătite cu card online la checkout
  // COD = xConnector captured → gateway: 'cash', 'cod', 'manual', sau altele non-Shopify
  // Card online = gateway: 'shopify_payments'

  // COD de încasat azi:
  // GLS: livrate pe data de 2 zile în urmă (ex: azi 26 → livrate pe 24)
  // Sameday: livrate ieri (ex: azi 26 → livrate pe 25)
  const codIncasatAzi = allOrders.filter(o => {
    if (o.ts !== 'livrat' || !o.fulfilledAt) return false;
    if (isOnlinePayment(o)) return false;
    const livrareStr = (o.fulfilledAt||'').slice(0,10);
    if (o.courier === 'gls')     return livrareStr === twoDaysAgoStr;
    if (o.courier === 'sameday') return livrareStr === yesterdayStr;
    return livrareStr === twoDaysAgoStr;
  });
  const sumCodIncasatAzi = codIncasatAzi.reduce((a,o) => a+o.total, 0);

  // COD livrate azi = colete cu fulfilledAt = azi, exclude plătite online
  const codLivrateAzi = allOrders.filter(o =>
    o.ts === 'livrat' &&
    !isOnlinePayment(o) &&
    (o.fulfilledAt||'').slice(0,10) === todayStr
  );
  const sumCodLivrateAzi = codLivrateAzi.reduce((a,o) => a+o.total, 0);
  // Și pentru cardul "Livrate azi" COD (folosit în cardul verde din srow)
  const codLivrateAziTotal = allOrders.filter(o =>
    o.ts === 'livrat' &&
    (o.fulfilledAt||'').slice(0,10) === todayStr
  ).length;

  // COD total în drum (din perioada selectată)
  const codInDrum = orders.filter(o => ['incurs','outfor'].includes(o.ts));
  const sumCodInDrum = codInDrum.reduce((a,o) => a+o.total, 0);

  // Courier breakdown
  const glsOrders  = orders.filter(o => o.courier === 'gls');
  const sdOrders   = orders.filter(o => o.courier === 'sameday');
  const glsLivrate = glsOrders.filter(o => o.ts === 'livrat').length;
  const glsRetur   = glsOrders.filter(o => o.ts === 'retur').length;

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
  const returTotal = retur + sdReturDetectat.length;

  const kpis = [
    {v:n,             lbl:'Total comenzi', e:'📦',color:'#f97316',p:100},
    {v:livrate,       lbl:'Livrate',       e:'✅',color:'#10b981',p:pct(livrate,n)},
    {v:incurs+outfor, lbl:'În tranzit',    e:'🚚',color:'#3b82f6',p:pct(incurs+outfor,n)},
    {v:returTotal,    lbl:'Retur',         e:'↩️',color:'#f43f5e',p:pct(returTotal,n)},
    {v:anulate,       lbl:'Anulate',       e:'❌',color:'#4a5568',p:pct(anulate,n)},
    {v:pend,          lbl:'Neexpediate',   e:'⏳',color:'#f59e0b',p:pct(pend,n)},
  ];

  const slice = filtered.slice((pg-1)*PS, pg*PS);
  const pages = Math.ceil(filtered.length/PS);
  const bc = {livrat:'badge-green',incurs:'badge-blue',outfor:'badge-purple',retur:'badge-red',anulat:'badge-gray',pending:'badge-yellow'};

  return (
    <>
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box;}
        body{background:#080c10;color:#e8edf2;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;}
        .wrap{max-width:1340px;margin:0 auto;padding:20px 14px 60px;}
        header{display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid #1e2a35;flex-wrap:wrap;}
        .logo{background:#f97316;color:#fff;font-weight:800;font-size:14px;padding:6px 10px;border-radius:8px;}
        .h1{font-size:18px;font-weight:700;}.hsub{font-size:11px;color:#94a3b8;}
        .hr{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
        .live{display:flex;align-items:center;gap:6px;background:#161d24;border:1px solid #243040;padding:5px 11px;border-radius:20px;font-size:11px;color:#94a3b8;}
        .dot{width:6px;height:6px;border-radius:50%;background:#4a5568;}
        .dot.on{background:#10b981;box-shadow:0 0 6px #10b981;animation:blink 2s infinite;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
        .bsm{background:#161d24;border:1px solid #243040;color:#94a3b8;padding:5px 11px;border-radius:20px;font-size:11px;cursor:pointer;}
        .bsm:hover{border-color:#f97316;color:#f97316;}
        .date-bar{background:#0f1419;border:1px solid #1e2a35;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;flex-direction:column;gap:10px;}
        .presets{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
        .preset-btn{background:#161d24;border:1px solid #243040;color:#94a3b8;padding:6px 12px;border-radius:20px;font-size:11px;cursor:pointer;transition:all .2s;white-space:nowrap;}
        .preset-btn:hover{border-color:#f97316;color:#f97316;}
        .preset-btn.active{background:#f97316;border-color:#f97316;color:white;font-weight:600;}
        .custom-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
        .custom-row label{font-size:11px;color:#94a3b8;}
        .custom-row input[type=date]{background:#161d24;border:1px solid #243040;color:#e8edf2;padding:6px 10px;border-radius:8px;font-size:12px;outline:none;}
        .custom-row input[type=date]:focus{border-color:#f97316;}
        .apply-btn{background:#f97316;color:white;border:none;padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;}
        .range-label{font-size:11px;color:#94a3b8;font-family:monospace;margin-left:auto;}
        .setup{background:#0f1419;border:1px solid #1e2a35;border-radius:14px;padding:24px;max-width:480px;margin:0 auto 20px;}
        .setup h2{font-size:16px;font-weight:700;margin-bottom:6px;}
        .setup p{color:#94a3b8;font-size:12px;margin-bottom:14px;line-height:1.5;}
        .info{background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:7px;padding:9px 11px;font-size:11px;color:#3b82f6;margin-bottom:10px;}
        .lbl{display:block;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;margin-top:8px;}
        input[type=text],input[type=password]{width:100%;background:#161d24;border:1px solid #243040;color:#e8edf2;padding:9px 11px;border-radius:7px;font-size:12px;font-family:monospace;outline:none;}
        input:focus{border-color:#f97316;}
        .cbtn{width:100%;background:#f97316;color:white;border:none;padding:11px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;margin-top:10px;}
        .loading{text-align:center;padding:50px;}
        .sp{width:32px;height:32px;border:3px solid #1e2a35;border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px;}
        @keyframes spin{to{transform:rotate(360deg)}}
        .lt{color:#94a3b8;font-size:13px;}
        .err{background:rgba(244,63,94,.1);border:1px solid rgba(244,63,94,.3);border-radius:9px;padding:10px 14px;color:#f43f5e;font-size:12px;margin-bottom:12px;max-width:480px;margin:0 auto 12px;}
        .kgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:9px;margin-bottom:9px;}
        .kpi{background:#0f1419;border:1px solid #1e2a35;border-radius:11px;padding:13px 11px;position:relative;overflow:hidden;}
        .kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--kc);}
        .ke{font-size:16px;display:block;margin-bottom:5px;}
        .kv{font-size:26px;font-weight:800;line-height:1;color:var(--kc);margin-bottom:2px;}
        .kl{font-size:11px;color:#94a3b8;margin-bottom:6px;}
        .kbar{height:2px;background:#243040;border-radius:1px;overflow:hidden;}
        .kfill{height:100%;border-radius:1px;background:var(--kc);transition:width 1s;}
        .kp{font-size:10px;color:#4a5568;margin-top:2px;}
        .srow{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:9px;margin-bottom:16px;}
        .sc{background:#0f1419;border-radius:11px;padding:14px 16px;display:flex;align-items:center;gap:11px;}
        .sc1{border:1px solid #f97316;}.sc2{border:1px solid #f59e0b;}.sc3{border:1px solid #f43f5e;}
        .si{font-size:22px;flex-shrink:0;}
        .slbl{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;}
        .sv{font-size:18px;font-weight:800;letter-spacing:-.5px;line-height:1;}
        .sc1 .sv{color:#f97316;}.sc2 .sv{color:#f59e0b;}.sc3 .sv{color:#f43f5e;}
        .ssub{font-size:10px;color:#94a3b8;margin-top:3px;line-height:1.4;}
        .stitle{font-size:10px;color:#f97316;text-transform:uppercase;letter-spacing:2.5px;margin-bottom:9px;display:flex;align-items:center;gap:8px;}
        .stitle::after{content:'';flex:1;height:1px;background:#1e2a35;}
        .frow{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:7px;}
        .frow .fb{font-size:11px;padding:5px 11px;}
        .courier-row{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:9px;padding:6px 10px;background:#0a0f14;border-radius:9px;border:1px solid #1e2a35;}
        .courier-row .fb{font-size:10px;padding:4px 9px;}
        .courier-lbl{font-size:10px;color:#4a5568;margin-right:2px;white-space:nowrap;}
        .fb{background:#0f1419;border:1px solid #243040;color:#94a3b8;padding:5px 11px;border-radius:20px;font-size:11px;cursor:pointer;white-space:nowrap;}
        .fb:hover,.fb.active{background:#f97316;border-color:#f97316;color:white;}
        .sw{margin-left:auto;position:relative;}
        .sw input{background:#0f1419;border:1px solid #243040;color:#e8edf2;padding:6px 11px 6px 28px;border-radius:20px;font-size:11px;outline:none;width:180px;}
        .sw input:focus{border-color:#f97316;}
        .sw::before{content:'🔍';position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:11px;pointer-events:none;}
        .tcard{background:#0f1419;border:1px solid #1e2a35;border-radius:11px;overflow:hidden;}
        .ttop{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;border-bottom:1px solid #1e2a35;flex-wrap:wrap;gap:8px;}
        .ttop h3{font-size:13px;font-weight:700;}
        .rbadge{background:#161d24;border:1px solid #243040;padding:2px 7px;border-radius:20px;font-size:11px;color:#94a3b8;}
        .tscroll{overflow-x:auto;}
        table{width:100%;border-collapse:collapse;font-size:11px;}
        th{background:#161d24;padding:7px 10px;text-align:left;font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e2a35;white-space:nowrap;cursor:pointer;user-select:none;}
        th:hover{color:#f97316;}
        tr{border-bottom:1px solid #1e2a35;}
        tr:last-child{border-bottom:none;}
        tr:hover td{background:rgba(249,115,22,.03);}
        td{padding:8px 10px;vertical-align:middle;max-width:155px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .badge{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:20px;font-size:10px;white-space:nowrap;}
        .badge-green{background:rgba(16,185,129,.11);color:#10b981;border:1px solid rgba(16,185,129,.2);}
        .badge-red{background:rgba(244,63,94,.11);color:#f43f5e;border:1px solid rgba(244,63,94,.2);}
        .badge-blue{background:rgba(59,130,246,.11);color:#3b82f6;border:1px solid rgba(59,130,246,.2);}
        .badge-purple{background:rgba(168,85,247,.11);color:#a855f7;border:1px solid rgba(168,85,247,.2);}
        .badge-gray{background:rgba(100,116,139,.1);color:#4a5568;border:1px solid rgba(100,116,139,.2);}
        .badge-yellow{background:rgba(245,158,11,.11);color:#f59e0b;border:1px solid rgba(245,158,11,.2);}
        .ref{font-family:monospace;font-size:11px;color:#f97316;}
        .mg{font-family:monospace;font-weight:500;}
        .mg-g{color:#10b981;}.mg-r{color:#f43f5e;}.mg-y{color:#f59e0b;}.mg-m{color:#4a5568;font-style:italic;font-weight:400;}
        .pc{color:#94a3b8;font-size:10px;}
        .pag{display:flex;align-items:center;justify-content:center;gap:4px;padding:11px;border-top:1px solid #1e2a35;flex-wrap:wrap;}
        .pb{background:#161d24;border:1px solid #243040;color:#94a3b8;width:27px;height:27px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;}
        .pb:hover,.pb.act{background:#f97316;border-color:#f97316;color:white;}
        .pb.dis{opacity:.3;pointer-events:none;}
        .pi{font-size:10px;color:#4a5568;padding:0 4px;}
        .empty{text-align:center;padding:40px;color:#4a5568;}
        @media(max-width:640px){
          :root{--mob-hide:none;}
          .wrap{padding:12px 10px 60px;}
          header{gap:7px;margin-bottom:14px;padding-bottom:12px;}
          .h1{font-size:15px;}.hsub{font-size:10px;}
          .hr{gap:5px;}
          .live,.bsm{padding:4px 8px;font-size:10px;}
          .kgrid{grid-template-columns:1fr 1fr;gap:7px;}
          .kv{font-size:22px;}.kpi{padding:10px 9px;}
          .srow{grid-template-columns:1fr 1fr;}
          .sc{padding:10px 12px;}.sv{font-size:16px;}
          .date-bar{padding:10px;}
          .presets{gap:4px;}
          .preset-btn{padding:5px 9px;font-size:10px;}
          .frow{gap:4px;}.fb{padding:4px 9px;font-size:10px;}
          .sw{width:100%;margin-left:0;margin-top:2px;}
          .sw input{width:100%;}
          .tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}
          table{min-width:520px;}
          td,th{padding:6px 7px;}
          .courier-grid{grid-template-columns:1fr 1fr !important;}
        }
        @media(max-width:400px){
          .kgrid{grid-template-columns:1fr 1fr;}
          .srow{grid-template-columns:1fr;}
          .kv{font-size:20px;}
          .preset-btn{padding:4px 7px;font-size:9px;}
          table{min-width:460px;}
        }
      `}</style>

      <div className="wrap">
        <header>
          <div className="logo">GLAMX</div>
          <div><div className="h1">Dashboard Comenzi</div><div className="hsub">Shopify Live</div></div>
          <div className="hr">
            <div className="live"><div className={`dot ${connected?'on':''}`}></div><span>{connected ? `${orders.length} comenzi` : 'Deconectat'}</span></div>
            {connected && <>
              <button className="bsm" onClick={fetchOrders}>⟳ Sincronizează</button>
              <a href="/profit" style={{background:'#10b981',color:'white',border:'none',padding:'5px 12px',borderRadius:'20px',fontSize:'11px',cursor:'pointer',textDecoration:'none',fontWeight:600}}>💹 Profit</a>
              <button className="bsm" style={{borderColor:'rgba(244,63,94,.3)',color:'#f43f5e'}} onClick={disconnect}>✕</button>
            </>}
          </div>
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
                {/* Debug temporar — arată fiecare comandă livrată azi */}
                {allOrders.filter(o => o.ts==='livrat' && (o.fulfilledAt||'').slice(0,10)===todayStr).map(o => (
                  <div key={o.id} style={{fontSize:8,color:'#4a5568',marginTop:2,lineHeight:1.4}}>
                    {o.name} · {isOnlinePayment(o)?'🔴 Card':'🟢 COD'} · {(o.tags||'').toLowerCase().includes('dispatched')?'🏷dispatched':'no-tag'} · fin:{o.fin}
                  </div>
                ))}
              </div></div>
              {sR>0 && (
                <div className="sc sc3"><div className="si">↩️</div><div>
                  <div className="slbl">Pierdut retur/anulat</div>
                  <div className="sv">{fmt(sR)} RON</div>
                  <div className="ssub">{retur+anulate} comenzi</div>
                </div></div>
              )}
            </div>

            {/* INVOICE WARNING */}
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

            {/* COURIER BREAKDOWN */}
            {(glsOrders.length > 0 || sdOrders.length > 0) && (
              <div className="courier-grid" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                <div style={{background:'#0f1419',border:'1px solid #f97316',borderRadius:10,padding:'12px 14px'}}>
                  <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:1,marginBottom:8,fontFamily:'monospace'}}>📦 GLS</div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                    <span style={{color:'#94a3b8'}}>Total</span><span style={{color:'#e8edf2',fontFamily:'monospace'}}>{glsOrders.length}</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                    <span style={{color:'#94a3b8'}}>Livrate</span><span style={{color:'#10b981',fontFamily:'monospace'}}>{glsLivrate}</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                    <span style={{color:'#94a3b8'}}>Returnate</span><span style={{color:'#f43f5e',fontFamily:'monospace'}}>{glsRetur}</span>
                  </div>
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
              {/* Toggle mod: comenzi create vs livrate în perioadă */}
              <div style={{display:'flex',gap:4,background:'#0a0f14',border:'1px solid #1e2a35',borderRadius:20,padding:'3px 4px',marginRight:4}}>
                <button
                  className={`fb ${deliveryMode==='create'?'active':''}`}
                  style={{padding:'3px 10px',fontSize:10,borderRadius:16}}
                  onClick={()=>{setDeliveryMode('create'); applyFilters(orders,filter,search,sortCol,sortDir,courierFilter);}}>
                  📦 Create
                </button>
                <button
                  className={`fb ${deliveryMode==='fulfilled'?'active':''}`}
                  style={{padding:'3px 10px',fontSize:10,borderRadius:16}}
                  onClick={()=>setDeliveryMode('fulfilled')}>
                  🚚 Livrate
                </button>
              </div>
              {['toate','livrat','incurs','outfor','retur','anulat','pending'].map(f=>(
                <button key={f} className={`fb ${filter===f?'active':''}`}
                  onClick={()=>{
                    setFilter(f);
                    if(deliveryMode==='create') applyFilters(orders,f,search,sortCol,sortDir,courierFilter);
                  }}>
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
                          <td><span className={`mg ${mc}`} title={`fin:${o.fin} | paidAt:${(o.paidAt||'').slice(0,10)} | created:${(o.createdAt||'').slice(0,10)} | fulfilled:${(o.fulfilledAt||'').slice(0,10)} | gw:${o.gateway||'?'} | COD:${!isOnlinePayment(o)}`}>{fmt(o.total)} RON</span></td>
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
                                  {invRes.stockDecreased
                                    ? <span style={{color:'#10b981'}}>📦 stoc scăzut</span>
                                    : <span style={{color:'#f59e0b'}}>⚠ fără gestiune</span>}
                                </span>
                                {invRes._debug&&!invRes.stockDecreased&&(
                                  <span style={{fontSize:7,color:'#4a5568',lineHeight:1.2}}>
                                    gest: {invRes._debug.warehouseName||'lipsă'} | SKU: {invRes._debug.productsWithCode}/{invRes._debug.totalProducts}
                                  </span>
                                )}
                              </div>
                            );
                            if(invRes?.error) return <div style={{display:'flex',flexDirection:'column',gap:2}}>
                              <span style={{fontSize:9,color:'#f43f5e',lineHeight:1.3}}>✗ {invRes.error.slice(0,60)}{invRes.error.length>60?'…':''}</span>
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

      {/* MODAL EDITARE PRODUSE FACTURĂ */}
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
              {!(invoiceModal.seriesInput||sbInvSeries)&&<span style={{fontSize:9,color:'#f43f5e'}}>⚠ obligatoriu</span>}
            </div>
            {/* Toggle descărcare stoc */}
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,padding:'8px 10px',background:'#080c10',borderRadius:8,border:'1px solid #243040'}}>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',flex:1}}>
                <div onClick={()=>{setSbUseStock(v=>{ls.set('sb_use_stock',String(!v));return !v;})}}
                  style={{width:32,height:18,borderRadius:9,background:sbUseStock?'#10b981':'#243040',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
                  <div style={{width:14,height:14,borderRadius:7,background:'white',position:'absolute',top:2,left:sbUseStock?16:2,transition:'left .2s'}}/>
                </div>
                <span style={{fontSize:11,color:sbUseStock?'#10b981':'#94a3b8'}}>
                  Descarcă stoc din gestiune SmartBill
                </span>
              </label>
              {sbUseStock && <span style={{fontSize:9,color:'#f59e0b'}}>⚠ necesită gestiune configurată</span>}
            </div>
            {sbUseStock && (
              <div style={{marginTop:-8,marginBottom:12,display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:'#080c10',borderRadius:8,border:'1px solid #243040'}}>
                <span style={{fontSize:10,color:'#94a3b8',whiteSpace:'nowrap'}}>Gestiune:</span>
                {sbWarehouseList.length > 0
                  ? <select value={sbWarehouse}
                      onChange={e=>{setSbWarehouse(e.target.value);ls.set('sb_warehouse',e.target.value);}}
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

      {/* MODAL CREDENȚIALE SMARTBILL */}
      {sbCredsOpen&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:1100,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={e=>{if(e.target===e.currentTarget)setSbCredsOpen(false);}}>
          <div style={{background:'#0f1419',border:'1px solid #f97316',borderRadius:14,width:'100%',maxWidth:420,padding:24}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:700,color:'#e8edf2'}}>🔑 Credențiale SmartBill</div>
              <button onClick={()=>setSbCredsOpen(false)} style={{background:'transparent',border:'1px solid #243040',color:'#94a3b8',borderRadius:8,padding:'3px 9px',cursor:'pointer'}}>✕</button>
            </div>
            <div style={{fontSize:11,color:'#94a3b8',marginBottom:14,lineHeight:1.6,background:'rgba(59,130,246,.07)',borderRadius:7,padding:'8px 11px'}}>
              Aceleași credențiale ca în pagina <strong style={{color:'#3b82f6'}}>Profit → SmartBill</strong>.<br/>Se salvează automat.
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

