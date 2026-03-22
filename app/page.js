'use client';
import { useState, useEffect, useCallback } from 'react';

const PS = 25;

const STATUS_MAP = {
  livrat:  { cls: 'livrat',  label: '✅ Livrat' },
  incurs:  { cls: 'incurs',  label: '🚚 Tranzit' },
  outfor:  { cls: 'outfor',  label: '📬 La curier' },
  retur:   { cls: 'retur',   label: '↩️ Retur' },
  anulat:  { cls: 'anulat',  label: '❌ Anulat' },
  pending: { cls: 'pending', label: '⏳ Neexpediat' },
};

function procOrder(o) {
  let ts = 'pending', fulfilledAt = '', trackingNo = '';
  if (o.fulfillments?.length > 0) {
    const f = o.fulfillments[o.fulfillments.length - 1];
    fulfilledAt = f.updated_at || f.created_at || '';
    trackingNo = f.tracking_number || '';
    const ss = (f.shipment_status || '').toLowerCase();
    if (ss === 'delivered') ts = 'livrat';
    else if (['failure', 'failed_attempt', 'returned'].includes(ss)) ts = 'retur';
    else if (ss === 'out_for_delivery') ts = 'outfor';
    else if (['in_transit', 'confirmed', 'label_printed'].includes(ss)) ts = 'incurs';
    else if (o.fulfillment_status === 'fulfilled') ts = 'incurs';
  }
  if (o.cancelled_at) ts = 'anulat';

  const addr = o.shipping_address || o.billing_address || {};
  const prods = (o.line_items || []).map(i => i.name || '').join(' + ');

  return {
    id: o.id, name: o.name || '', fin: o.financial_status || '', ts,
    trackingNo, client: addr.name || '', oras: addr.city || '',
    total: parseFloat(o.total_price) || 0,
    prods, prodShort: prods.length > 45 ? prods.slice(0, 45) + '…' : prods,
    createdAt: o.created_at || '', fulfilledAt,
  };
}

function fmt(n) { return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtD(d) {
  if (!d) return '—';
  try { const p = d.split('T')[0].split('-'); return `${p[2]}.${p[1]}.${p[0]}`; } catch { return d.slice(0, 10); }
}
function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

export default function Dashboard() {
  const [orders, setOrders] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [domain, setDomain] = useState('glamxonline.myshopify.com');
  const [token, setToken] = useState('');
  const [filter, setFilter] = useState('toate');
  const [search, setSearch] = useState('');
  const [pg, setPg] = useState(1);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState(1);
  const [liveText, setLiveText] = useState('');

  // Load saved token
  useEffect(() => {
    const savedToken = localStorage.getItem('gx_t');
    const savedDomain = localStorage.getItem('gx_d');
    if (savedToken) setToken(savedToken);
    if (savedDomain) setDomain(savedDomain);
  }, []);

  const applyFilters = useCallback((ords, f, q, sc, sd) => {
    let result = ords.filter(o => {
      if (f !== 'toate' && o.ts !== f) return false;
      if (!q) return true;
      return [o.name, o.client, o.oras, o.prods, o.trackingNo].some(v => (v || '').toLowerCase().includes(q.toLowerCase()));
    });
    if (sc) {
      result = [...result].sort((a, b) => {
        if (sc === 'total') return (a.total - b.total) * sd;
        return (a[sc] || '').localeCompare(b[sc] || '', 'ro') * sd;
      });
    }
    setFiltered(result);
    setPg(1);
  }, []);

  useEffect(() => {
    applyFilters(orders, filter, search, sortCol, sortDir);
  }, [orders, filter, search, sortCol, sortDir, applyFilters]);

  const fetchOrders = async () => {
    if (!domain || !token) { setError('Completează domeniul și tokenul!'); return; }
    localStorage.setItem('gx_d', domain);
    localStorage.setItem('gx_t', token);
    setLoading(true); setError('');
    try {
      // Call our own Next.js API route — no CORS issues!
      const res = await fetch(`/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok || !data.orders) throw new Error(data.error || 'Răspuns invalid');
      const processed = data.orders.map(procOrder);
      setOrders(processed);
      setConnected(true);
      setLiveText(`${processed.length} comenzi · live`);
    } catch (e) {
      setError('Eroare: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const disconnect = () => {
    setOrders([]); setConnected(false); setError('');
    localStorage.removeItem('gx_t');
  };

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d * -1);
    else { setSortCol(col); setSortDir(1); }
  };

  // Stats
  const n = orders.length;
  const cnt = s => orders.filter(o => o.ts === s).length;
  const sum = ss => orders.filter(o => ss.includes(o.ts)).reduce((a, o) => a + o.total, 0);
  const livrate = cnt('livrat'), incurs = cnt('incurs'), outfor = cnt('outfor');
  const retur = cnt('retur'), anulate = cnt('anulat'), pend = cnt('pending');
  const sI = sum(['livrat']), sA = sum(['incurs', 'outfor']), sR = sum(['retur', 'anulat']);

  const kpis = [
    { v: n, lbl: 'Total comenzi', e: '📦', color: '#f97316', pct: 100 },
    { v: livrate, lbl: 'Livrate', e: '✅', color: '#10b981', pct: pct(livrate, n) },
    { v: incurs + outfor, lbl: 'În tranzit', e: '🚚', color: '#3b82f6', pct: pct(incurs + outfor, n) },
    { v: retur, lbl: 'Retur', e: '↩️', color: '#f43f5e', pct: pct(retur, n) },
    { v: anulate, lbl: 'Anulate', e: '❌', color: '#4a5568', pct: pct(anulate, n) },
    { v: pend, lbl: 'Neexpediate', e: '⏳', color: '#f59e0b', pct: pct(pend, n) },
  ];

  const slice = filtered.slice((pg - 1) * PS, pg * PS);
  const pages = Math.ceil(filtered.length / PS);

  const badgeClass = { livrat: 'badge-green', incurs: 'badge-blue', outfor: 'badge-purple', retur: 'badge-red', anulat: 'badge-gray', pending: 'badge-yellow' };

  return (
    <>
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box;}
        body{background:#080c10;color:#e8edf2;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;}
        .wrap{max-width:1340px;margin:0 auto;padding:20px 14px 60px;}
        header{display:flex;align-items:center;gap:10px;margin-bottom:24px;padding-bottom:18px;border-bottom:1px solid #1e2a35;flex-wrap:wrap;}
        .logo{background:#f97316;color:#fff;font-weight:800;font-size:14px;padding:6px 10px;border-radius:8px;font-family:system-ui;}
        .h1{font-size:18px;font-weight:700;}
        .hsub{font-size:11px;color:#94a3b8;}
        .hr{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
        .live{display:flex;align-items:center;gap:6px;background:#161d24;border:1px solid #243040;padding:5px 11px;border-radius:20px;font-size:11px;color:#94a3b8;}
        .dot{width:6px;height:6px;border-radius:50%;background:#4a5568;}
        .dot.on{background:#10b981;box-shadow:0 0 6px #10b981;}
        .bsm{background:#161d24;border:1px solid #243040;color:#94a3b8;padding:5px 11px;border-radius:20px;font-size:11px;cursor:pointer;}
        .bsm:hover{border-color:#f97316;color:#f97316;}

        /* SETUP */
        .setup{background:#0f1419;border:1px solid #1e2a35;border-radius:14px;padding:24px;max-width:500px;margin:0 auto 20px;}
        .setup h2{font-size:16px;font-weight:700;margin-bottom:6px;}
        .setup p{color:#94a3b8;font-size:12px;margin-bottom:14px;line-height:1.5;}
        .lbl{display:block;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;margin-top:10px;}
        input[type=text],input[type=password]{width:100%;background:#161d24;border:1px solid #243040;color:#e8edf2;padding:9px 11px;border-radius:8px;font-size:12px;font-family:monospace;outline:none;}
        input:focus{border-color:#f97316;}
        .cbtn{width:100%;background:#f97316;color:white;border:none;padding:11px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;margin-top:12px;}
        .cbtn:hover{background:#fb923c;}
        .info{background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:7px;padding:9px 11px;font-size:11px;color:#3b82f6;margin-bottom:10px;line-height:1.5;}

        /* LOADING */
        .loading{text-align:center;padding:50px;}
        .sp{width:32px;height:32px;border:3px solid #1e2a35;border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px;}
        @keyframes spin{to{transform:rotate(360deg)}}
        .lt{color:#94a3b8;font-size:13px;}

        /* ERROR */
        .err{background:rgba(244,63,94,.1);border:1px solid rgba(244,63,94,.3);border-radius:9px;padding:10px 14px;color:#f43f5e;font-size:12px;margin-bottom:12px;max-width:500px;margin:0 auto 12px;}

        /* KPI */
        .kgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:9px;margin-bottom:9px;}
        .kpi{background:#0f1419;border:1px solid #1e2a35;border-radius:11px;padding:13px 11px;position:relative;overflow:hidden;}
        .kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--kc);}
        .ke{font-size:15px;display:block;margin-bottom:5px;}
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
        .sv{font-size:22px;font-weight:800;letter-spacing:-.5px;line-height:1;}
        .sc1 .sv{color:#f97316;}.sc2 .sv{color:#f59e0b;}.sc3 .sv{color:#f43f5e;}
        .ssub{font-size:11px;color:#94a3b8;margin-top:2px;}

        /* SEC TITLE */
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

        /* PAG */
        .pag{display:flex;align-items:center;justify-content:center;gap:4px;padding:11px;border-top:1px solid #1e2a35;flex-wrap:wrap;}
        .pb{background:#161d24;border:1px solid #243040;color:#94a3b8;width:27px;height:27px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;}
        .pb:hover,.pb.act{background:#f97316;border-color:#f97316;color:white;}
        .pb.dis{opacity:.3;pointer-events:none;}
        .pi{font-size:10px;color:#4a5568;padding:0 4px;}

        .empty{text-align:center;padding:40px;color:#4a5568;}
        @media(max-width:600px){.kgrid{grid-template-columns:1fr 1fr;}.sw{width:100%;margin-left:0;}.sw input{width:100%;}.frow{flex-direction:column;align-items:flex-start;}}
      `}</style>

      <div className="wrap">
        <header>
          <div className="logo">GLAMX</div>
          <div>
            <div className="h1">Dashboard Comenzi</div>
            <div className="hsub">Shopify Live — date în timp real</div>
          </div>
          <div className="hr">
            <div className="live">
              <div className={`dot ${connected ? 'on' : ''}`}></div>
              <span>{connected ? liveText : 'Deconectat'}</span>
            </div>
            {connected && (
              <>
                <button className="bsm" onClick={fetchOrders}>⟳ Refresh</button>
                <a href="/profit" style={{background:'#10b981',color:'white',border:'none',padding:'6px 12px',borderRadius:'20px',fontSize:'11px',cursor:'pointer',textDecoration:'none',fontWeight:600}}>💹 Profit</a>
                <button className="bsm" onClick={disconnect}>✕ Deconectează</button>
              </>
            )}
          </div>
        </header>

        {!connected && !loading && (
          <div className="setup">
            <h2>🔌 Conectare Shopify</h2>
            <p>Introdu datele magazinului. Cererea se face prin serverul Next.js — fără probleme CORS!</p>
            <div className="info">🔒 Tokenul este trimis doar la Shopify prin serverul tău Next.js. Nu este expus public.</div>
            <label className="lbl">Domeniu magazin</label>
            <input type="text" value={domain} onChange={e => setDomain(e.target.value)} placeholder="glamxonline.myshopify.com" />
            <label className="lbl">Admin API Access Token</label>
            <input type="text" value={token} onChange={e => setToken(e.target.value)} placeholder="shpat_..." autoComplete="off" spellCheck="false" />
            <button className="cbtn" onClick={fetchOrders}>🚀 Conectează &amp; Încarcă comenzile</button>
          </div>
        )}

        {error && <div className="err">⚠️ {error}</div>}

        {loading && (
          <div className="loading">
            <div className="sp"></div>
            <div className="lt">Se descarcă comenzile din Shopify…</div>
          </div>
        )}

        {connected && orders.length > 0 && (
          <>
            <div className="stitle">Sumar live</div>
            <div className="kgrid">
              {kpis.map((k, i) => (
                <div key={i} className="kpi" style={{ '--kc': k.color }}>
                  <span className="ke">{k.e}</span>
                  <div className="kv">{k.v}</div>
                  <div className="kl">{k.lbl}</div>
                  <div className="kbar"><div className="kfill" style={{ width: k.pct + '%' }}></div></div>
                  <div className="kp">{k.pct}%</div>
                </div>
              ))}
            </div>

            <div className="srow">
              {sI > 0 && <div className="sc sc1"><div className="si">💰</div><div><div className="slbl">Încasat</div><div className="sv">{fmt(sI)} RON</div><div className="ssub">{livrate} comenzi livrate</div></div></div>}
              {sA > 0 && <div className="sc sc2"><div className="si">🚚</div><div><div className="slbl">COD în așteptare</div><div className="sv">{fmt(sA)} RON</div><div className="ssub">{incurs + outfor} comenzi în drum</div></div></div>}
              {sR > 0 && <div className="sc sc3"><div className="si">↩️</div><div><div className="slbl">Pierdut retur/anulat</div><div className="sv">{fmt(sR)} RON</div><div className="ssub">{retur + anulate} comenzi</div></div></div>}
            </div>

            <div className="stitle">Comenzi</div>
            <div className="frow">
              {['toate', 'livrat', 'incurs', 'outfor', 'retur', 'anulat', 'pending'].map(f => (
                <button key={f} className={`fb ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'toate' ? 'Toate' : STATUS_MAP[f]?.label || f}
                </button>
              ))}
              <div className="sw">
                <input type="text" placeholder="Caută…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>

            <div className="tcard">
              <div className="ttop">
                <h3>Comenzi Shopify</h3>
                <span className="rbadge">{filtered.length} comenzi</span>
              </div>
              <div className="tscroll">
                <table>
                  <thead>
                    <tr>
                      {[['name','Comandă'],['ts','Status'],['fin','Plată'],['client','Client'],['oras','Oraș'],['','Produse'],['total','Total'],['createdAt','Data'],['fulfilledAt','Livrat']].map(([col, lbl]) => (
                        <th key={lbl} onClick={() => col && handleSort(col)}>{lbl} {col ? '↕' : ''}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {slice.length === 0 ? (
                      <tr><td colSpan={9}><div className="empty">📭 Nicio comandă.</div></td></tr>
                    ) : slice.map(o => {
                      const st = STATUS_MAP[o.ts] || { label: o.ts, cls: 'pending' };
                      const bc = badgeClass[o.ts] || 'badge-gray';
                      const mc = o.ts === 'livrat' && o.fin === 'paid' ? 'mg-g' : o.ts === 'retur' || o.ts === 'anulat' ? 'mg-r' : o.ts === 'pending' ? 'mg-m' : 'mg-y';
                      return (
                        <tr key={o.id}>
                          <td><span className="ref">{o.name}</span></td>
                          <td><span className={`badge ${bc}`}>{st.label}</span></td>
                          <td><span className={`badge ${o.fin === 'paid' ? 'badge-green' : o.fin === 'pending' ? 'badge-yellow' : 'badge-gray'}`}>{o.fin}</span></td>
                          <td title={o.client}>{o.client || '—'}</td>
                          <td>{o.oras || '—'}</td>
                          <td title={o.prods} className="pc">{o.prodShort || '—'}</td>
                          <td><span className={`mg ${mc}`}>{fmt(o.total)} RON</span></td>
                          <td style={{ fontSize: '10px', color: '#94a3b8' }}>{fmtD(o.createdAt)}</td>
                          <td style={{ fontSize: '10px', color: '#94a3b8' }}>{o.fulfilledAt ? fmtD(o.fulfilledAt) : <span className="mg mg-m">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="pag">
                  <button className={`pb ${pg === 1 ? 'dis' : ''}`} onClick={() => setPg(p => Math.max(1, p - 1))}>‹</button>
                  {Array.from({ length: pages }, (_, i) => i + 1).filter(i => i === 1 || i === pages || Math.abs(i - pg) <= 2).map((i, idx, arr) => (
                    <span key={i}>
                      {idx > 0 && arr[idx - 1] !== i - 1 && <span className="pi">…</span>}
                      <button className={`pb ${i === pg ? 'act' : ''}`} onClick={() => setPg(i)}>{i}</button>
                    </span>
                  ))}
                  <button className={`pb ${pg === pages ? 'dis' : ''}`} onClick={() => setPg(p => Math.min(pages, p + 1))}>›</button>
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
