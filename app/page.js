'use client';
import { useState, useEffect, useCallback } from 'react';

const PS = 25;
const STATUS_MAP = {
  livrat:  { label: '✅ Livrat' },
  incurs:  { label: '🚚 Tranzit' },
  outfor:  { label: '📬 La curier' },
  retur:   { label: '↩️ Retur' },
  anulat:  { label: '❌ Anulat' },
  pending: { label: '⏳ Neexpediat' },
};

/* ── date helpers ── */
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
  // Extract invoice number from note_attributes
  const notes = o.note_attributes || [];
  const invAttr = notes.find(a => (a.name||'').toLowerCase().includes('invoice') && !(a.name||'').toLowerCase().includes('url'));
  const invUrl  = notes.find(a => (a.name||'').toLowerCase().includes('invoice-url') || (a.name||'').toLowerCase().includes('invoice_url'));
  const invoiceNumber = invAttr?.value || '';
  const hasInvoice = !!(invoiceNumber || invUrl);
  return {
    id: o.id, name: o.name || '', fin: o.financial_status || '', ts,
    trackingNo, client: addr.name || '', oras: addr.city || '',
    total: parseFloat(o.total_price) || 0,
    prods, prodShort: prods.length > 45 ? prods.slice(0, 45) + '…' : prods,
    createdAt: o.created_at || '', fulfilledAt,
    invoiceNumber, hasInvoice,
    invoiceUrl: invUrl?.value || '',
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

  /* Date range — filtrare LOCALĂ, fără request nou */
  const [preset, setPreset]         = useState('last_30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [rangeLabel, setRangeLabel] = useState('');
  const [allOrders, setAllOrders]   = useState([]); // toate comenzile descărcate o singură dată
  const [lastFetch, setLastFetch]   = useState(null);

  useEffect(() => {
    const t = localStorage.getItem('gx_t');
    const d = localStorage.getItem('gx_d');
    if (t) setToken(t);
    if (d) setDomain(d);
    // Restaurează comenzile salvate din sesiunea anterioară
    const saved = localStorage.getItem('gx_orders_all');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setAllOrders(parsed);
        setConnected(true);
        const ts = localStorage.getItem('gx_fetch_time');
        if (ts) setLastFetch(new Date(ts));
        applyDateFilter(parsed, 'last_30', '', '');
      } catch {}
    }
  }, []);

  /* Filtrare locală după dată */
  const applyDateFilter = useCallback((ords, p, cf, ct) => {
    const { from, to } = getRange(p, cf, ct);
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');
    const inRange = ords.filter(o => {
      const d = new Date(o.createdAt);
      return d >= fromD && d <= toD;
    });
    setOrders(inRange);
    setRangeLabel(`${fmtD(from+'T00:00:00')} — ${fmtD(to+'T00:00:00')}`);
  }, []);

  const applyFilters = useCallback((ords, f, q, sc, sd) => {
    let result = ords.filter(o => {
      if (f !== 'toate' && o.ts !== f) return false;
      if (!q) return true;
      return [o.name,o.client,o.oras,o.prods,o.trackingNo].some(v => (v||'').toLowerCase().includes(q.toLowerCase()));
    });
    if (sc) result = [...result].sort((a,b) => sc==='total' ? (a.total-b.total)*sd : (a[sc]||'').localeCompare(b[sc]||'','ro')*sd);
    setFiltered(result);
    setPg(1);
  }, []);

  useEffect(() => { applyFilters(orders, filter, search, sortCol, sortDir); }, [orders, filter, search, sortCol, sortDir, applyFilters]);

  /* Descarcă TOATE comenzile o singură dată (fără filtru dată) */
  const fetchOrders = async () => {
    if (!domain || !token) { setError('Completează domeniul și tokenul!'); return; }
    localStorage.setItem('gx_d', domain);
    localStorage.setItem('gx_t', token);
    setLoading(true); setError('');
    try {
      const fields = 'id,name,financial_status,fulfillment_status,fulfillments,cancelled_at,created_at,total_price,currency,line_items,shipping_address,billing_address,tags,note_attributes';
      // Descarcă toate comenzile din ultimul an (fără filtru dată — filtrăm local)
      const yearAgo = toISO(new Date(new Date().setFullYear(new Date().getFullYear() - 1)));
      const url = `/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&created_at_min=${yearAgo}T00:00:00&fields=${fields}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.orders) throw new Error(data.error || 'Răspuns invalid');
      const processed = data.orders.map(procOrder);
      setAllOrders(processed);
      setConnected(true);
      const now = new Date();
      setLastFetch(now);
      localStorage.setItem('gx_orders_all', JSON.stringify(processed));
      localStorage.setItem('gx_fetch_time', now.toISOString());
      // Aplică filtrul curent pe datele proaspăt descărcate
      applyDateFilter(processed, preset, customFrom, customTo);
    } catch (e) { setError('Eroare: ' + e.message); }
    finally { setLoading(false); }
  };

  const handlePreset = (id) => {
    setPreset(id);
    if (id !== 'custom') applyDateFilter(allOrders, id, customFrom, customTo); // filtrare LOCALĂ!
  };

  const disconnect = () => { setOrders([]); setConnected(false); setError(''); localStorage.removeItem('gx_t'); };
  const handleSort = (col) => { if (sortCol===col) setSortDir(d=>d*-1); else { setSortCol(col); setSortDir(1); } };

  const n = orders.length;
  const cnt = s => orders.filter(o=>o.ts===s).length;
  const sum = ss => orders.filter(o=>ss.includes(o.ts)).reduce((a,o)=>a+o.total,0);
  const livrate=cnt('livrat'), incurs=cnt('incurs'), outfor=cnt('outfor');
  const retur=cnt('retur'), anulate=cnt('anulat'), pend=cnt('pending');
  const sI=sum(['livrat']), sA=sum(['incurs','outfor']), sR=sum(['retur','anulat']);

  const kpis = [
    {v:n,           lbl:'Total comenzi',  e:'📦',color:'#f97316',p:100},
    {v:livrate,     lbl:'Livrate',        e:'✅',color:'#10b981',p:pct(livrate,n)},
    {v:incurs+outfor,lbl:'În tranzit',    e:'🚚',color:'#3b82f6',p:pct(incurs+outfor,n)},
    {v:retur,       lbl:'Retur',          e:'↩️',color:'#f43f5e',p:pct(retur,n)},
    {v:anulate,     lbl:'Anulate',        e:'❌',color:'#4a5568',p:pct(anulate,n)},
    {v:pend,        lbl:'Neexpediate',    e:'⏳',color:'#f59e0b',p:pct(pend,n)},
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

        /* DATE RANGE BAR */
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
        .apply-btn:hover{background:#fb923c;}
        .range-label{font-size:11px;color:#94a3b8;font-family:monospace;margin-left:auto;}

        /* SETUP */
        .setup{background:#0f1419;border:1px solid #1e2a35;border-radius:14px;padding:24px;max-width:480px;margin:0 auto 20px;}
        .setup h2{font-size:16px;font-weight:700;margin-bottom:6px;}
        .setup p{color:#94a3b8;font-size:12px;margin-bottom:14px;line-height:1.5;}
        .info{background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:7px;padding:9px 11px;font-size:11px;color:#3b82f6;margin-bottom:10px;}
        .lbl{display:block;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;margin-top:8px;}
        input[type=text],input[type=password]{width:100%;background:#161d24;border:1px solid #243040;color:#e8edf2;padding:9px 11px;border-radius:7px;font-size:12px;font-family:monospace;outline:none;}
        input:focus{border-color:#f97316;}
        .cbtn{width:100%;background:#f97316;color:white;border:none;padding:11px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;margin-top:10px;}
        .cbtn:hover{background:#fb923c;}

        /* LOADING */
        .loading{text-align:center;padding:50px;}
        .sp{width:32px;height:32px;border:3px solid #1e2a35;border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px;}
        @keyframes spin{to{transform:rotate(360deg)}}
        .lt{color:#94a3b8;font-size:13px;}

        /* ERR */
        .err{background:rgba(244,63,94,.1);border:1px solid rgba(244,63,94,.3);border-radius:9px;padding:10px 14px;color:#f43f5e;font-size:12px;margin-bottom:12px;max-width:480px;margin:0 auto 12px;}

        /* KPI */
        .kgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:9px;margin-bottom:9px;}
        .kpi{background:#0f1419;border:1px solid #1e2a35;border-radius:11px;padding:13px 11px;position:relative;overflow:hidden;}
        .kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--kc);}
        .ke{font-size:16px;display:block;margin-bottom:5px;}
        .kv{font-size:26px;font-weight:800;line-height:1;color:var(--kc);margin-bottom:2px;}
        .kl{font-size:11px;color:#94a3b8;margin-bottom:6px;}
        .kbar{height:2px;background:#243040;border-radius:1px;overflow:hidden;}
        .kfill{height:100%;border-radius:1px;background:var(--kc);transition:width 1s;}
        .kp{font-size:10px;color:#4a5568;margin-top:2px;}

        /* SUMA */
        .srow{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:9px;margin-bottom:16px;}
        .sc{background:#0f1419;border-radius:11px;padding:16px 18px;display:flex;align-items:center;gap:11px;}
        .sc1{border:1px solid #f97316;}.sc2{border:1px solid #f59e0b;}.sc3{border:1px solid #f43f5e;}
        .si{font-size:24px;flex-shrink:0;}
        .slbl{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;}
        .sv{font-size:20px;font-weight:800;letter-spacing:-.5px;line-height:1;}
        .sc1 .sv{color:#f97316;}.sc2 .sv{color:#f59e0b;}.sc3 .sv{color:#f43f5e;}
        .ssub{font-size:11px;color:#94a3b8;margin-top:2px;}

        /* SECTION TITLE */
        .stitle{font-size:10px;color:#f97316;text-transform:uppercase;letter-spacing:2.5px;margin-bottom:9px;display:flex;align-items:center;gap:8px;}
        .stitle::after{content:'';flex:1;height:1px;background:#1e2a35;}

        /* FILTERS */
        .frow{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:9px;}
        .fb{background:#0f1419;border:1px solid #243040;color:#94a3b8;padding:5px 11px;border-radius:20px;font-size:11px;cursor:pointer;white-space:nowrap;}
        .fb:hover,.fb.active{background:#f97316;border-color:#f97316;color:white;}
        .sw{margin-left:auto;position:relative;}
        .sw input{background:#0f1419;border:1px solid #243040;color:#e8edf2;padding:6px 11px 6px 28px;border-radius:20px;font-size:11px;outline:none;width:180px;}
        .sw input:focus{border-color:#f97316;}
        .sw::before{content:'🔍';position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:11px;pointer-events:none;}

        /* TABLE */
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
        @media(max-width:600px){.kgrid{grid-template-columns:1fr 1fr;}.sw{width:100%;margin-left:0;}.sw input{width:100%;}.frow{flex-direction:column;align-items:flex-start;}}
      `}</style>

      <div className="wrap">
        {/* HEADER */}
        <header>
          <div className="logo">GLAMX</div>
          <div><div className="h1">Dashboard Comenzi</div><div className="hsub">Shopify Live — date în timp real</div></div>
          <div className="hr">
            <div className="live"><div className={`dot ${connected?'on':''}`}></div><span>{connected ? `${orders.length} comenzi · live` : 'Deconectat'}</span></div>
            {connected && <>
              <button className="bsm" onClick={fetchOrders}>⟳ Sincronizează</button>
              <a href="/profit" style={{background:'#10b981',color:'white',border:'none',padding:'5px 12px',borderRadius:'20px',fontSize:'11px',cursor:'pointer',textDecoration:'none',fontWeight:600}}>💹 Profit</a>
              <button className="bsm" style={{borderColor:'rgba(244,63,94,.3)',color:'#f43f5e'}} onClick={disconnect}>✕ Deconectează</button>
            </>}
          </div>
        </header>

        {/* SETUP */}
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

        {/* DATE RANGE BAR */}
        {connected && (
          <div className="date-bar">
            <div className="presets">
              <span style={{fontSize:11,color:'#94a3b8',marginRight:4,whiteSpace:'nowrap'}}>📅</span>
              {PRESETS.map(p => (
                <button key={p.id} className={`preset-btn ${preset===p.id?'active':''}`} onClick={() => handlePreset(p.id)}>
                  {p.label}
                </button>
              ))}
              {rangeLabel && <span className="range-label">{rangeLabel} · <strong style={{color:'#f97316'}}>{orders.length}</strong> comenzi</span>}
            </div>
            {preset === 'custom' && (
              <div className="custom-row">
                <label>De la:</label>
                <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} />
                <label>Până la:</label>
                <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)} />
                <button className="apply-btn" onClick={() => { applyDateFilter(allOrders, 'custom', customFrom, customTo); }}>Aplică</button>
              </div>
            )}
            <div style={{fontSize:10,color:'#4a5568',display:'flex',alignItems:'center',gap:12}}>
              <span>📦 {allOrders.length} comenzi în cache</span>
              {lastFetch && <span>🕐 Ultima sincronizare: {lastFetch.toLocaleTimeString('ro-RO', {hour:'2-digit',minute:'2-digit'})} · {lastFetch.toLocaleDateString('ro-RO')}</span>}
              <button onClick={fetchOrders} style={{background:'transparent',border:'1px solid #243040',color:'#94a3b8',padding:'2px 8px',borderRadius:'6px',fontSize:'10px',cursor:'pointer'}}>⟳ Resincronizează</button>
            </div>
          </div>
        )}

        {/* DASHBOARD */}
        {connected && orders.length >= 0 && !loading && (
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
              {sI>0 && <div className="sc sc1"><div className="si">💰</div><div><div className="slbl">Încasat</div><div className="sv">{fmt(sI)} RON</div><div className="ssub">{livrate} comenzi livrate</div></div></div>}
              {sA>0 && <div className="sc sc2"><div className="si">🚚</div><div><div className="slbl">COD în așteptare</div><div className="sv">{fmt(sA)} RON</div><div className="ssub">{incurs+outfor} comenzi în drum</div></div></div>}
              {sR>0 && <div className="sc sc3"><div className="si">↩️</div><div><div className="slbl">Pierdut retur/anulat</div><div className="sv">{fmt(sR)} RON</div><div className="ssub">{retur+anulate} comenzi</div></div></div>}
            </div>

            {(() => {
              const noInvoice = orders.filter(o => o.fin==='paid' && !o.hasInvoice);
              return noInvoice.length > 0 ? (
                <div style={{background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.25)',borderRadius:10,padding:'10px 14px',marginBottom:10,fontSize:12,color:'#f59e0b',display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:16}}>⚠️</span>
                  <span><strong>{noInvoice.length} comenzi plătite fără factură:</strong> {noInvoice.map(o=>o.name).join(', ')}</span>
                </div>
              ) : null;
            })()}
            <div className="stitle">Comenzi</div>
            <div className="frow">
              {['toate','livrat','incurs','outfor','retur','anulat','pending'].map(f=>(
                <button key={f} className={`fb ${filter===f?'active':''}`} onClick={()=>setFilter(f)}>
                  {f==='toate'?'Toate':STATUS_MAP[f]?.label||f}
                </button>
              ))}
              <div className="sw">
                <input type="text" placeholder="Caută…" value={search} onChange={e=>setSearch(e.target.value)} />
              </div>
            </div>

            <div className="tcard">
              <div className="ttop">
                <h3>Comenzi Shopify</h3>
                <span className="rbadge">{filtered.length} comenzi</span>
              </div>
              <div className="tscroll">
                <table>
                  <thead><tr>
                    {[['name','Comandă'],['ts','Status'],['fin','Plată'],['client','Client'],['oras','Oraș'],['','Produse'],['total','Total'],['','Factură'],['createdAt','Data'],['fulfilledAt','Livrat']].map(([col,lbl])=>(
                      <th key={lbl} onClick={()=>col&&handleSort(col)}>{lbl} {col?'↕':''}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {slice.length===0 ? (
                      <tr><td colSpan={9}><div className="empty">📭 Nicio comandă în perioada selectată.</div></td></tr>
                    ) : slice.map(o => {
                      const st = STATUS_MAP[o.ts]||{label:o.ts};
                      const bcc = bc[o.ts]||'badge-gray';
                      const mc = o.ts==='livrat'&&o.fin==='paid'?'mg-g':o.ts==='retur'||o.ts==='anulat'?'mg-r':o.ts==='pending'?'mg-m':'mg-y';
                      return (
                        <tr key={o.id} style={o.fin==='paid'&&!o.hasInvoice?{background:'rgba(245,158,11,0.05)'}:{}}>
                          <td><span className="ref">{o.name}</span></td>
                          <td><span className={`badge ${bcc}`}>{st.label}</span></td>
                          <td><span className={`badge ${o.fin==='paid'?'badge-green':o.fin==='pending'?'badge-yellow':'badge-gray'}`}>{o.fin}</span></td>
                          <td title={o.client}>{o.client||'—'}</td>
                          <td>{o.oras||'—'}</td>
                          <td title={o.prods} className="pc">{o.prodShort||'—'}</td>
                          <td><span className={`mg ${mc}`}>{fmt(o.total)} RON</span></td>
                          <td>
                            {o.hasInvoice
                              ? <span style={{fontSize:10,color:'#10b981',fontFamily:'monospace'}}>{o.invoiceNumber||'✓ Da'}</span>
                              : o.fin==='paid'
                                ? <span style={{fontSize:10,color:'#f59e0b',fontWeight:700}}>⚠ Lipsă!</span>
                                : <span style={{fontSize:10,color:'#4a5568'}}>—</span>}
                          </td>
                          <td style={{fontSize:'10px',color:'#94a3b8'}}>{fmtD(o.createdAt)}</td>
                          <td style={{fontSize:'10px',color:'#94a3b8'}}>{o.fulfilledAt?fmtD(o.fulfilledAt):<span className="mg mg-m">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pages>1 && (
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
    </>
  );
}
