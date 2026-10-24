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
import { useState, useEffect, useMemo, useCallback } from 'react';

const ls = {
  get: k => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') localStorage.setItem(k, v); } catch {} },
};

const fmt = n => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = n => Number(n || 0).toLocaleString('ro-RO');

const SHOP_META = {
  ro:         { label: 'Romania',   flag: '🇷🇴', color: '#f97316' },
  hu:         { label: 'Ungaria',   flag: '🇭🇺', color: '#3b82f6' },
  glato:      { label: 'Glato',     flag: '🛍️', color: '#a855f7' },
  glatohu:    { label: 'Glato HU',  flag: '🛍️', color: '#ec4899' },
  emag:       { label: 'eMAG',      flag: '🛒', color: '#eab308' },
  necunoscut: { label: 'Necunoscut', flag: '❓', color: '#64748b' },
};
const SHOP_ORDER = ['ro', 'hu', 'glato', 'glatohu', 'emag', 'necunoscut'];

function emptyBucket() {
  return { orders: 0, cancelled: 0, valoare: 0, codIncasat: 0, codNeincasat: 0, cardIncasat: 0, retururi: 0, facturate: 0, nefacturate: 0, awbCreate: 0 };
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

  const [from, setFrom] = useState(() => new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10));
  const [to, setTo]     = useState(() => new Date().toISOString().slice(0, 10));
  const [granularity, setGranularity] = useState('month'); // 'month' | 'year'
  const [activeShops, setActiveShops] = useState(() => new Set(SHOP_ORDER));

  const [emagOrders, setEmagOrders] = useState([]);
  const [sbChecking, setSbChecking] = useState(false);
  const [sbResults, setSbResults] = useState(null); // { found: n, notFound: n }

  const load = useCallback(() => {
    setLoading(true); setError('');
    fetch(`/api/stats-totale?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setServerData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    try { setEmagOrders(JSON.parse(ls.get('emag_orders') || '[]')); } catch { setEmagOrders([]); }
  }, []);

  const toggleShop = (key) => setActiveShops(prev => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

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

    const shopTotals = {};
    for (const byShop of Object.values(periods)) {
      for (const [shopKey, bucket] of Object.entries(byShop)) {
        if (!shopTotals[shopKey]) shopTotals[shopKey] = emptyBucket();
        addBucket(shopTotals[shopKey], bucket);
      }
    }

    const periodKeysSorted = Object.keys(periods).sort().reverse();
    return { periods, shopCurrency, shopTotals, periodKeysSorted };
  }, [serverData, emagOrders, granularity, from, to]);

  const visibleShops = SHOP_ORDER.filter(k => activeShops.has(k) && (shopTotals[k] || k === 'emag'));

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
    const rows = [['Perioadă', 'Magazin', 'Monedă', 'Comenzi', 'Anulate', 'Valoare', 'Încasat COD', 'Neîncasat COD', 'Încasat Card', 'Retururi', 'AWB create', 'Facturate', 'Nefacturate']];
    for (const period of periodKeysSorted) {
      for (const shopKey of visibleShops) {
        const b = periods[period]?.[shopKey];
        if (!b) continue;
        rows.push([periodLabel(period), SHOP_META[shopKey]?.label || shopKey, shopCurrency[shopKey] || '', b.orders, b.cancelled, fmt(b.valoare), fmt(b.codIncasat), fmt(b.codNeincasat), fmt(b.cardIncasat), b.retururi, b.awbCreate, b.facturate, b.nefacturate]);
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

        {/* ── Filtre ── */}
        <div style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 16px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 11, color: '#94a3b8' }}>De la</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inpStyle} />
            <label style={{ fontSize: 11, color: '#94a3b8' }}>Până la</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inpStyle} />
            <button onClick={load} disabled={loading} style={btnPrimary}>{loading ? '⟳' : '🔄'} Reîncarcă</button>

            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
              {['month', 'year'].map(g => (
                <button key={g} onClick={() => setGranularity(g)} style={{ ...btnTab, ...(granularity === g ? btnTabActive : {}) }}>
                  {g === 'month' ? '📅 Lunar' : '🗓️ Anual'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SHOP_ORDER.filter(k => k !== 'necunoscut').map(k => {
              const meta = SHOP_META[k];
              const active = activeShops.has(k);
              return (
                <button key={k} onClick={() => toggleShop(k)}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
                    background: active ? `${meta.color}22` : 'transparent',
                    border: `1px solid ${active ? meta.color : 'rgba(255,255,255,.1)'}`,
                    color: active ? meta.color : '#64748b',
                  }}>
                  {meta.flag} {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {error && <div style={errBox}>⚠️ {error}</div>}

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
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: '#94a3b8' }}>⏳ COD neîncasat</span><span style={{ fontFamily: 'monospace', color: '#f59e0b' }}>{fmt(b.codNeincasat)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabel ── */}
        <div style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 16px', marginBottom: 20, overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{granularity === 'month' ? 'Pe luni' : 'Pe ani'}</div>
            <button onClick={exportCsv} style={btnGhost}>⬇ Export CSV</button>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#475569', padding: 24 }}>Se încarcă...</div>
          ) : periodKeysSorted.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#475569', padding: 24 }}>Nicio comandă în intervalul selectat.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 820 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)' }}>
                  {['Perioadă', 'Magazin', 'Comenzi', 'Anulate', 'Valoare', 'COD încasat', 'COD neîncasat', 'Card încasat', 'Retururi', 'AWB create', 'Facturate', 'Nefacturate'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#64748b', whiteSpace: 'nowrap', fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodKeysSorted.map(period => (
                  visibleShops.filter(k => periods[period]?.[k]).map((shopKey, i) => {
                    const b = periods[period][shopKey];
                    const meta = SHOP_META[shopKey];
                    const cur = shopCurrency[shopKey] || '';
                    return (
                      <tr key={`${period}-${shopKey}`} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        <td style={{ padding: '5px 8px', color: '#cbd5e1', fontWeight: i === 0 ? 700 : 400 }}>{i === 0 ? periodLabel(period) : ''}</td>
                        <td style={{ padding: '5px 8px', color: meta.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{meta.flag} {meta.label}</td>
                        <td style={{ padding: '5px 8px' }}>{fmtInt(b.orders)}</td>
                        <td style={{ padding: '5px 8px', color: '#64748b' }}>{fmtInt(b.cancelled)}</td>
                        <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>{fmt(b.valoare)} {cur}</td>
                        <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: '#10b981' }}>{fmt(b.codIncasat)}</td>
                        <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: '#f59e0b' }}>{fmt(b.codNeincasat)}</td>
                        <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: '#3b82f6' }}>{fmt(b.cardIncasat)}</td>
                        <td style={{ padding: '5px 8px', color: b.retururi ? '#f43f5e' : '#475569' }}>{fmtInt(b.retururi)}</td>
                        <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{fmtInt(b.awbCreate)}</td>
                        <td style={{ padding: '5px 8px', color: '#10b981' }}>{fmtInt(b.facturate)}</td>
                        <td style={{ padding: '5px 8px', color: b.nefacturate ? '#f59e0b' : '#475569' }}>{fmtInt(b.nefacturate)}</td>
                      </tr>
                    );
                  })
                ))}
              </tbody>
            </table>
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

const inpStyle = { background: '#161d24', border: '1px solid #243040', color: '#e8edf2', padding: '6px 10px', borderRadius: 7, fontSize: 12, outline: 'none' };
const btnPrimary = { background: '#f97316', color: 'white', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'transparent', border: '1px solid rgba(255,255,255,.1)', color: '#94a3b8', borderRadius: 8, padding: '6px 12px', fontSize: 11, cursor: 'pointer' };
const btnTab = { background: 'transparent', border: '1px solid rgba(255,255,255,.1)', color: '#64748b', borderRadius: 7, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' };
const btnTabActive = { background: 'rgba(249,115,22,.15)', borderColor: '#f97316', color: '#f97316' };
const errBox = { background: 'rgba(244,63,94,.08)', border: '1px solid rgba(244,63,94,.25)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f43f5e', marginBottom: 14 };
