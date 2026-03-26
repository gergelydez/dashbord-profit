'use client';
import { useState, useEffect, useCallback } from 'react';

// Helper safe pentru localStorage
const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { if (typeof window !== 'undefined') localStorage.removeItem(k); } catch {} },
};

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
    case 'last_30':     return { from: toISO(new Date(y,m,d-29)), to: toISO(now) };
    case 'custom':      return { from: customFrom, to: customTo };
    default:            return { from: toISO(now), to: toISO(now) };
  }
}

const PRESETS = [
  { id: 'today',      label: 'Azi' },
  { id: 'yesterday',  label: 'Ieri' },
  { id: 'week',       label: '7 zile' },
  { id: 'last_30',    label: '30 zile' },
  { id: 'custom',     label: '📅 Custom' },
];

function procOrder(o) {
  let ts = 'pending', fulfilledAt = '', trackingNo = '';
  if (o.fulfillments?.length > 0) {
    const f = o.fulfillments[o.fulfillments.length - 1];
    // Folosim updated_at pentru livrare ca fiind data cea mai sigură pentru status change
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
  return {
    id: o.id, name: o.name || '', fin: o.financial_status || '', ts,
    trackingNo, client: addr.name || '', oras: addr.city || '',
    total: parseFloat(o.total_price) || 0,
    createdAt: o.created_at || '', fulfilledAt,
    prods: (o.line_items || []).map(i => i.name || '').join(' + '),
  };
}

const fmt = n => Number(n||0).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtD = d => { if (!d) return '—'; try { const p=d.split('T')[0].split('-'); return `${p[2]}.${p[1]}.${p[0]}`; } catch { return d.slice(0,10); } };

export default function Dashboard() {
  const [allOrders, setAllOrders] = useState([]);
  const [orders, setOrders]       = useState([]);
  const [filtered, setFiltered]   = useState([]);
  const [loading, setLoading]     = useState(false);
  const [connected, setConnected] = useState(false);
  const [domain, setDomain]       = useState('glamxonline.myshopify.com');
  const [token, setToken]         = useState('');
  const [filter, setFilter]       = useState('toate');
  const [search, setSearch]       = useState('');
  const [preset, setPreset]       = useState('today');
  const [rangeLabel, setRangeLabel] = useState('');

  // 1. Inițializare date
  useEffect(() => {
    const t = ls.get('gx_t'); const d = ls.get('gx_d');
    if (t) setToken(t); if (d) setDomain(d);
    const saved = ls.get('gx_orders_all');
    if (saved) {
      const parsed = JSON.parse(saved);
      setAllOrders(parsed);
      setConnected(true);
      applyDateFilter(parsed, 'today');
    }
  }, []);

  // 2. Filtru de dată (reparat pentru "Azi")
  const applyDateFilter = useCallback((ords, p, cf, ct) => {
    const { from, to } = getRange(p, cf, ct);
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T23:59:59");
    
    const inRange = ords.filter(o => {
      const d = new Date(o.createdAt);
      return d >= start && d <= end;
    });
    setOrders(inRange);
    setRangeLabel(p === 'today' ? "Comenzi primite Azi" : `${fmtD(from)} — ${fmtD(to)}`);
  }, []);

  // 3. Filtrare tabel (Search & Status)
  useEffect(() => {
    let res = orders.filter(o => {
      if (filter !== 'toate' && o.ts !== filter) return false;
      if (!search) return true;
      return [o.name, o.client, o.oras].some(v => (v||'').toLowerCase().includes(search.toLowerCase()));
    });
    setFiltered(res);
  }, [orders, filter, search]);

  // 4. Fetch date Shopify
  const fetchOrders = async () => {
    if (!domain || !token) return;
    setLoading(true);
    try {
      const yearAgo = toISO(new Date(new Date().setFullYear(new Date().getFullYear() - 1)));
      const url = `/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&created_at_min=${yearAgo}T00:00:00`;
      const res = await fetch(url);
      const data = await res.json();
      const processed = data.orders.map(procOrder);
      setAllOrders(processed);
      setConnected(true);
      ls.set('gx_t', token); ls.set('gx_d', domain);
      ls.set('gx_orders_all', JSON.stringify(processed));
      applyDateFilter(processed, preset);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  /* ── LOGICA COD (CASH ON DELIVERY) ── */
  const getJustDate = (d) => d ? d.split('T')[0] : '';
  const aziStr = getJustDate(new Date().toISOString());

  // Calculăm data de acum 2 zile
  const d2 = new Date(); d2.setDate(d2.getDate() - 2);
  const data2ZileInUrma = getJustDate(d2.toISOString());

  // Suma încasată Azi (de la GLS) = Livrate acum 2 zile
  const sumaIncasataAzi = allOrders.filter(o => 
    o.ts === 'livrat' && getJustDate(o.fulfilledAt) === data2ZileInUrma
  ).reduce((a, o) => a + o.total, 0);

  // Suma Livrată Azi = Banii care vin peste 2 zile
  const sumaLivrataAzi = allOrders.filter(o => 
    o.ts === 'livrat' && getJustDate(o.fulfilledAt) === aziStr
  ).reduce((a, o) => a + o.total, 0);

  return (
    <div style={{ background: '#080c10', color: '#e8edf2', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <style>{`
        .wrap { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; margin-bottom: 30px; }
        .card { background: #0f1419; border: 1px solid #1e2a35; border-radius: 12px; padding: 20px; border-top: 3px solid #f97316; }
        .card-blue { border-top-color: #3b82f6; }
        .card-green { border-top-color: #10b981; }
        .label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .value { font-size: 28px; font-weight: 800; margin: 5px 0; }
        .sub { font-size: 11px; color: #4a5568; }
        .btn { background: #161d24; border: 1px solid #243040; color: #94a3b8; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-size: 12px; transition: 0.2s; }
        .btn.active { background: #f97316; color: white; border-color: #f97316; }
        table { width: 100%; border-collapse: collapse; background: #0f1419; border-radius: 12px; overflow: hidden; margin-top: 20px; }
        th { text-align: left; padding: 12px; background: #161d24; color: #94a3b8; font-size: 11px; text-transform: uppercase; }
        td { padding: 12px; border-bottom: 1px solid #1e2a35; font-size: 13px; }
        .badge { padding: 4px 8px; border-radius: 12px; font-size: 10px; font-weight: bold; }
        .badge-livrat { background: rgba(16,185,129,0.1); color: #10b981; }
        .badge-tranzit { background: rgba(59,130,246,0.1); color: #3b82f6; }
      `}</style>

      <div className="wrap">
        <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', margin: 0 }}>📊 Dashboard Financiar GLS</h1>
            <p className="sub">Sincronizare Shopify & Urmărire Cash-flow</p>
          </div>
          {!connected ? (
            <button onClick={fetchOrders} className="btn active">Conectează Cont</button>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={fetchOrders} className="btn">{loading ? 'Se încarcă...' : '⟳ Refresh'}</button>
            </div>
          )}
        </header>

        {/* CARDURI FINANCIARE */}
        <div className="card-grid">
          <div className="card card-blue">
            <div className="label">💰 COD de încasat Azi (Banca)</div>
            <div className="value" style={{ color: '#3b82f6' }}>{fmt(sumaIncasataAzi)} RON</div>
            <div className="sub">Din livrările de acum 2 zile ({fmtD(data2ZileInUrma)})</div>
          </div>

          <div className="card card-green">
            <div className="label">🚚 COD Colete Livrate Azi</div>
            <div className="value" style={{ color: '#10b981' }}>{fmt(sumaLivrataAzi)} RON</div>
            <div className="sub">Bani de primit peste 2 zile lucrătoare</div>
          </div>

          <div className="card">
            <div className="label">📦 Comenzi Noi (Perioada)</div>
            <div className="value">{orders.length}</div>
            <div className="sub">{rangeLabel}</div>
          </div>
        </div>

        {/* FILTRE PERIOADA */}
        <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.id} className={`btn ${preset === p.id ? 'active' : ''}`} onClick={() => { setPreset(p.id); applyDateFilter(allOrders, p.id); }}>
              {p.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', position: 'relative' }}>
            <input 
              type="text" 
              placeholder="Caută client, oraș..." 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              style={{ background: '#0f1419', border: '1px solid #243040', color: 'white', padding: '8px 15px', borderRadius: '20px', fontSize: '12px', outline: 'none', width: '220px' }}
            />
          </div>
        </div>

        {/* TABEL COMENZI */}
        <div style={{ marginBottom: '10px', display: 'flex', gap: '8px' }}>
          {['toate', 'livrat', 'incurs', 'outfor', 'retur'].map(f => (
            <button key={f} className={`btn ${filter === f ? 'active' : ''}`} style={{ fontSize: '10px', padding: '5px 12px' }} onClick={() => setFilter(f)}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        <table>
          <thead>
            <tr>
              <th>Comandă</th>
              <th>Client / Oraș</th>
              <th>Status Livrare</th>
              <th>Data Creării</th>
              <th>Data Livrării</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: '#4a5568' }}>Nicio comandă găsită.</td></tr>
            ) : (
              filtered.map(o => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 'bold', color: '#f97316' }}>{o.name}</td>
                  <td>
                    <div>{o.client}</div>
                    <div className="sub">{o.oras}</div>
                  </td>
                  <td>
                    <span className={`badge ${o.ts === 'livrat' ? 'badge-livrat' : 'badge-tranzit'}`}>
                      {STATUS_MAP[o.ts]?.label || o.ts}
                    </span>
                  </td>
                  <td>{fmtD(o.createdAt)}</td>
                  <td>{o.fulfilledAt ? fmtD(o.fulfilledAt) : <span className="sub">In curs...</span>}</td>
                  <td style={{ fontWeight: '800' }}>{fmt(o.total)} RON</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
