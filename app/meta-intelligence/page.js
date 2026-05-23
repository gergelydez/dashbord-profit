'use client';
import { useState, useEffect, useMemo, useRef } from 'react';

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmt  = (n, dec = 2) => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtK = (n) => Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'K' : fmt(n, 0);
const pad2 = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

function getShopKey() {
  try {
    const s = typeof window !== 'undefined' ? localStorage.getItem('glamx-shop') : null;
    const p = s ? JSON.parse(s) : null;
    return p?.state?.currentShop || 'ro';
  } catch { return 'ro'; }
}
const ordersKey = (sk) => sk === 'ro' ? 'gx_orders_all' : `gx_orders_all_${sk}`;

function getGlsAwbMap() { try { const s=localStorage.getItem('gls_awb_map'); return s?JSON.parse(s):{};} catch{return {};}}
function getSdAwbMap()  { try { const s=localStorage.getItem('sd_awb_map');  return s?JSON.parse(s):{};} catch{return {};}}

const RETUR_STATUSES = ['returned','failure','failed_attempt','return_in_progress','failed_delivery'];
function getFinalStatus(o, glsMap, sdMap) {
  if (o.courier === 'gls') { const awb=(o.trackingNo||'').trim(); if (awb && glsMap[awb]) return glsMap[awb]; }
  if (o.courier === 'sameday') { const awb=(o.trackingNo||'').trim(); if (awb && sdMap[awb]) return sdMap[awb]; if (o.ts && o.ts!=='pending') return o.ts; return 'incurs'; }
  if (o.ts && o.ts !== 'pending') return o.ts;
  const tags = (Array.isArray(o.tags)?o.tags:[]).map(t=>String(t).toLowerCase());
  if (RETUR_STATUSES.some(s=>tags.includes(s))||tags.includes('retur')||tags.includes('refuz')) return 'retur';
  const fin=(o.financial||o.financial_status||'').toLowerCase();
  if (fin==='paid'||(o.fulfillmentStatus||'').toLowerCase()==='fulfilled') return 'livrat';
  return o.ts || 'pending';
}

const MONTHS_RO = ['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_FULL = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
const DAYS_RO = ['Dum','Lun','Mar','Mie','Joi','Vin','Sâm'];
const DAYS_FULL = ['Duminică','Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă'];

/* ─── CSV Parser for Meta Ads ────────────────────────────────────────────── */
function splitCSV(line) {
  const res=[]; let cur='', q=false;
  for (const c of line) { if(c==='"') q=!q; else if((c===','||c===';')&&!q){res.push(cur);cur='';} else cur+=c; }
  res.push(cur); return res;
}

function parseMetaCSV(text) {
  const lines = text.split('\n').filter(l=>l.trim());
  if (lines.length < 2) return [];
  const headers = splitCSV(lines[0]).map(h=>h.trim().replace(/^"|"$/g,''));
  const rows = [];
  for (let i=1; i<lines.length; i++) {
    const cols = splitCSV(lines[i]);
    const row = {};
    headers.forEach((h,idx) => { row[h] = (cols[idx]||'').trim().replace(/^"|"$/g,''); });
    rows.push(row);
  }
  return rows;
}

function parseNum(v) { return parseFloat(String(v||'0').replace(/[^\d.-]/g,''))||0; }

/* ─── Color helpers ──────────────────────────────────────────────────────── */
function cpaColor(cpa) {
  if (cpa <= 55) return '#22c55e';
  if (cpa <= 70) return '#86efac';
  if (cpa <= 85) return '#fbbf24';
  if (cpa <= 100) return '#f97316';
  return '#ef4444';
}
function cpaBg(cpa) {
  if (cpa <= 55) return 'rgba(34,197,94,0.12)';
  if (cpa <= 70) return 'rgba(134,239,172,0.08)';
  if (cpa <= 85) return 'rgba(251,191,36,0.1)';
  return 'rgba(249,115,22,0.1)';
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
export default function MetaIntelligencePage() {
  const [orders, setOrders]         = useState([]);
  const [metaRows, setMetaRows]     = useState([]);
  const [metaFile, setMetaFile]     = useState(null);
  const [activeTab, setActiveTab]   = useState('overview');
  const [activeMonth, setActiveMonth] = useState(null);
  const [loading, setLoading]       = useState(true);
  const fileRef = useRef();

  /* Load orders from localStorage */
  useEffect(() => {
    try {
      const sk = getShopKey();
      const raw = localStorage.getItem(ordersKey(sk)) || localStorage.getItem('gx_orders_60') || localStorage.getItem('gx_orders');
      if (raw) {
        const parsed = JSON.parse(raw);
        setOrders(Array.isArray(parsed) ? parsed : []);
      }
    } catch(e) { console.error(e); }
    setLoading(false);
  }, []);

  /* Load saved Meta CSV from localStorage */
  useEffect(() => {
    try {
      const saved = localStorage.getItem('glamx_meta_csv_rows');
      if (saved) setMetaRows(JSON.parse(saved));
    } catch {}
  }, []);

  /* Handle Meta CSV upload */
  function handleMetaUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setMetaFile(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseMetaCSV(ev.target.result);
      setMetaRows(rows);
      try { localStorage.setItem('glamx_meta_csv_rows', JSON.stringify(rows)); } catch {}
    };
    reader.readAsText(file, 'UTF-8');
  }

  /* ─── Compute Meta stats ──────────────────────────────────────────────── */
  const metaStats = useMemo(() => {
    if (!metaRows.length) return null;
    // Find column names flexibly
    const sample = metaRows[0];
    const keys = Object.keys(sample);
    const findKey = (...candidates) => keys.find(k => candidates.some(c => k.toLowerCase().includes(c.toLowerCase()))) || '';
    const dateKey    = findKey('Reporting starts','date','data');
    const spentKey   = findKey('Amount spent','Suma cheltuita','spent');
    const convKey    = findKey('Results','Rezultate','conversions','purchases');
    const cpaKey     = findKey('Cost per result','Cost per rezultat','CPA');
    const reachKey   = findKey('Reach','Acoperire');
    const impKey     = findKey('Impressions','Afisari');
    const clickKey   = findKey('Link clicks','Clicuri');
    const ctrKey     = findKey('CTR (link','CTR');
    const cpmKey     = findKey('CPM');
    const cpcKey     = findKey('CPC (cost per link');

    // By month
    const byMonth = {};
    // By day of week
    const byDow = {0:{day:'Duminică',spent:0,conv:0},1:{day:'Luni',spent:0,conv:0},2:{day:'Marți',spent:0,conv:0},3:{day:'Miercuri',spent:0,conv:0},4:{day:'Joi',spent:0,conv:0},5:{day:'Vineri',spent:0,conv:0},6:{day:'Sâmbătă',spent:0,conv:0}};

    let totalSpent=0, totalConv=0, totalImpr=0, totalClicks=0, totalReach=0;

    metaRows.forEach(row => {
      const dateStr = row[dateKey];
      if (!dateStr) return;
      const d = new Date(dateStr + 'T12:00:00');
      if (isNaN(d)) return;
      const spent = parseNum(row[spentKey]);
      const conv  = parseNum(row[convKey]);
      const impr  = parseNum(row[impKey]);
      const clicks= parseNum(row[clickKey]);
      const reach = parseNum(row[reachKey]);
      const mKey  = `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
      const dow   = d.getDay();

      if (!byMonth[mKey]) byMonth[mKey] = { month: mKey, spent:0, conv:0, impr:0, clicks:0, reach:0, label: MONTHS_FULL[d.getMonth()]+' '+d.getFullYear(), m: d.getMonth(), y: d.getFullYear() };
      byMonth[mKey].spent  += spent;
      byMonth[mKey].conv   += conv;
      byMonth[mKey].impr   += impr;
      byMonth[mKey].clicks += clicks;
      byMonth[mKey].reach  += reach;

      byDow[dow].spent += spent;
      byDow[dow].conv  += conv;

      totalSpent  += spent;
      totalConv   += conv;
      totalImpr   += impr;
      totalClicks += clicks;
      totalReach  += reach;
    });

    const months = Object.values(byMonth).sort((a,b)=>a.month.localeCompare(b.month));
    months.forEach(m => { m.cpa = m.conv ? m.spent/m.conv : 0; m.ctr = m.impr ? (m.clicks/m.impr)*100 : 0; m.cpm = m.impr ? (m.spent/m.impr)*1000 : 0; m.cpc = m.clicks ? m.spent/m.clicks : 0; });

    const dowArr = Object.values(byDow).map(d => ({ ...d, cpa: d.conv ? d.spent/d.conv : 0 }));

    return { months, dowArr, totalSpent, totalConv, totalImpr, totalClicks, totalReach,
      avgCPA: totalConv ? totalSpent/totalConv : 0,
      avgCTR: totalImpr ? (totalClicks/totalImpr)*100 : 0,
      avgCPM: totalImpr ? (totalSpent/totalImpr)*1000 : 0,
    };
  }, [metaRows]);

  /* ─── Compute Orders stats ────────────────────────────────────────────── */
  const orderStats = useMemo(() => {
    if (!orders.length) return null;
    const glsMap = getGlsAwbMap();
    const sdMap  = getSdAwbMap();

    const byMonth = {};
    const byDow   = {0:{day:'Duminică',cnt:0,livrat:0,retur:0,refuz:0,revenue:0},1:{day:'Luni',cnt:0,livrat:0,retur:0,refuz:0,revenue:0},2:{day:'Marți',cnt:0,livrat:0,retur:0,refuz:0,revenue:0},3:{day:'Miercuri',cnt:0,livrat:0,retur:0,refuz:0,revenue:0},4:{day:'Joi',cnt:0,livrat:0,retur:0,refuz:0,revenue:0},5:{day:'Vineri',cnt:0,livrat:0,retur:0,refuz:0,revenue:0},6:{day:'Sâmbătă',cnt:0,livrat:0,retur:0,refuz:0,revenue:0}};
    const byHour  = Array.from({length:24},(_,i)=>({hour:i,cnt:0,livrat:0}));

    orders.forEach(o => {
      const d = new Date(o.createdAt||o.created_at||'');
      if (isNaN(d)) return;
      const mKey = `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
      const dow  = d.getDay();
      const hour = d.getHours();
      const status = getFinalStatus(o, glsMap, sdMap);
      const revenue = parseNum(o.total||o.totalPrice||o.total_price||0);
      const isLivrat = status === 'livrat';
      const isRetur  = status === 'retur';
      const isRefuz  = status === 'anulat' || status === 'refuzat';

      if (!byMonth[mKey]) byMonth[mKey] = { month: mKey, cnt:0, livrat:0, retur:0, refuz:0, incurs:0, revenue:0, label: MONTHS_FULL[d.getMonth()]+' '+d.getFullYear(), m: d.getMonth(), y: d.getFullYear() };
      byMonth[mKey].cnt++;
      byMonth[mKey].revenue += revenue;
      if (isLivrat) byMonth[mKey].livrat++;
      else if (isRetur) byMonth[mKey].retur++;
      else if (isRefuz) byMonth[mKey].refuz++;
      else byMonth[mKey].incurs++;

      byDow[dow].cnt++;
      byDow[dow].revenue += revenue;
      if (isLivrat) byDow[dow].livrat++;
      if (isRetur)  byDow[dow].retur++;
      if (isRefuz)  byDow[dow].refuz++;

      byHour[hour].cnt++;
      if (isLivrat) byHour[hour].livrat++;
    });

    const months = Object.values(byMonth).sort((a,b)=>a.month.localeCompare(b.month));
    months.forEach(m => {
      m.livrareRate = m.cnt ? (m.cnt - m.retur - m.refuz)/m.cnt*100 : 0;
      m.returRate   = m.cnt ? m.retur/m.cnt*100 : 0;
      m.refuzRate   = m.cnt ? m.refuz/m.cnt*100 : 0;
      m.avgOrder    = m.livrat ? m.revenue/m.livrat : 0;
    });

    const dowArr = Object.values(byDow).map(d=>({...d, livrareRate: d.cnt?(d.cnt-d.retur-d.refuz)/d.cnt*100:0, returRate: d.cnt?d.retur/d.cnt*100:0}));
    const totalOrders  = orders.length;
    const totalLivrat  = orders.filter(o=>getFinalStatus(o,glsMap,sdMap)==='livrat').length;
    const totalRetur   = orders.filter(o=>getFinalStatus(o,glsMap,sdMap)==='retur').length;
    const totalRefuz   = orders.filter(o=>['anulat','refuzat'].includes(getFinalStatus(o,glsMap,sdMap))).length;
    const totalRevenue = orders.reduce((s,o)=>s+parseNum(o.total||o.totalPrice||o.total_price||0),0);

    return { months, dowArr, byHour, totalOrders, totalLivrat, totalRetur, totalRefuz, totalRevenue,
      livrareRate: totalOrders ? totalLivrat/totalOrders*100 : 0,
      returRate:   totalOrders ? totalRetur/totalOrders*100 : 0,
    };
  }, [orders]);

  /* ─── Combined monthly data ───────────────────────────────────────────── */
  const combinedMonths = useMemo(() => {
    const allKeys = new Set([
      ...(metaStats?.months||[]).map(m=>m.month),
      ...(orderStats?.months||[]).map(m=>m.month),
    ]);
    return Array.from(allKeys).sort().map(key => {
      const meta  = metaStats?.months.find(m=>m.month===key)||{};
      const ord   = orderStats?.months.find(m=>m.month===key)||{};
      const label = meta.label || ord.label || key;
      const spent  = meta.spent  || 0;
      const conv   = meta.conv   || 0;
      const cpa    = conv ? spent/conv : 0;
      const orders = ord.cnt     || 0;
      const livrat = ord.livrat  || 0;
      const retur  = ord.retur   || 0;
      const refuz  = ord.refuz   || 0;
      const revenue= ord.revenue || 0;
      const profit = revenue - spent - (livrat * 154.80); // approx COGS Delta Max
      return { key, label, spent, conv, cpa, orders, livrat, retur, refuz, revenue, profit,
        returRate: orders ? retur/orders*100 : 0,
        livrareRate: orders ? (orders-retur-refuz)/orders*100 : 0,
        m: meta.m ?? ord.m, y: meta.y ?? ord.y,
      };
    });
  }, [metaStats, orderStats]);

  const selectedMonth = useMemo(() => {
    if (!activeMonth) return null;
    return combinedMonths.find(m=>m.key===activeMonth);
  }, [activeMonth, combinedMonths]);

  /* ─── Best/Worst DOW analysis ────────────────────────────────────────── */
  const dowAnalysis = useMemo(() => {
    if (!metaStats && !orderStats) return [];
    return Array.from({length:7},(_,i)=>({
      day:   DAYS_FULL[i],
      short: DAYS_RO[i],
      metaSpent: metaStats?.dowArr[i]?.spent || 0,
      metaConv:  metaStats?.dowArr[i]?.conv  || 0,
      metaCPA:   metaStats?.dowArr[i]?.cpa   || 0,
      ordCnt:    orderStats?.dowArr[i]?.cnt  || 0,
      ordLivrat: orderStats?.dowArr[i]?.livrat || 0,
      ordRetur:  orderStats?.dowArr[i]?.retur  || 0,
      ordRevenue:orderStats?.dowArr[i]?.revenue || 0,
      returRate: orderStats?.dowArr[i]?.returRate || 0,
    }));
  }, [metaStats, orderStats]);

  /* ─── Recommendations engine ─────────────────────────────────────────── */
  const recommendations = useMemo(() => {
    const recs = [];
    if (metaStats) {
      const bestDow = [...dowAnalysis].filter(d=>d.metaCPA>0).sort((a,b)=>a.metaCPA-b.metaCPA)[0];
      const worstDow= [...dowAnalysis].filter(d=>d.metaCPA>0).sort((a,b)=>b.metaCPA-a.metaCPA)[0];
      if (bestDow)  recs.push({ type:'win',  icon:'📈', title:`Mărește bugetul ${bestDow.day}`, body:`CPA ${fmt(bestDow.metaCPA,0)} RON — cea mai bună zi. Adaugă +25-30% buget.` });
      if (worstDow) recs.push({ type:'stop', icon:'⚠️', title:`Reduce bugetul ${worstDow.day}`, body:`CPA ${fmt(worstDow.metaCPA,0)} RON — cea mai slabă zi. Scade cu 20-30%.` });
      const bestMonth = [...(metaStats.months||[])].filter(m=>m.cpa>0&&m.conv>=5).sort((a,b)=>a.cpa-b.cpa)[0];
      if (bestMonth) recs.push({ type:'win', icon:'🏆', title:`Model luna ${bestMonth.label.split(' ')[0]}`, body:`CPA ${fmt(bestMonth.cpa,0)} RON cu ${bestMonth.conv} conversii. Replicați structura campaniei.` });
      if (metaStats.avgCPA > 70) recs.push({ type:'warn', icon:'💡', title:'CPA mediu prea mare', body:`${fmt(metaStats.avgCPA,0)} RON actual vs. 52-60 RON target. Focusați pe zilele cu CPA < 70 RON.` });
    }
    if (orderStats) {
      if (orderStats.returRate > 20) recs.push({ type:'stop', icon:'📦', title:'Rata retur ridicată', body:`${fmt(orderStats.returRate,1)}% retururi. Verificați calitatea produsului și promisiunile din reclame.` });
      const worstReturnDay = [...(orderStats.dowArr||[])].filter(d=>d.cnt>5).sort((a,b)=>b.returRate-a.returRate)[0];
      if (worstReturnDay?.returRate > 25) recs.push({ type:'warn', icon:'🔍', title:`Retururi mari ${worstReturnDay.day}`, body:`${fmt(worstReturnDay.returRate,1)}% retur comenzile din ${worstReturnDay.day}. Analizați ce tip de client cumpără atunci.` });
    }
    return recs;
  }, [metaStats, orderStats, dowAnalysis]);

  /* ─── Styles ──────────────────────────────────────────────────────────── */
  const S = {
    page:    { padding: '16px', maxWidth: 1200, margin: '0 auto', paddingBottom: 100, fontFamily: 'inherit' },
    header:  { marginBottom: 20 },
    title:   { fontSize: 22, fontWeight: 800, color: 'var(--c-text)', letterSpacing: '-0.5px' },
    sub:     { fontSize: 13, color: 'var(--c-text3)', marginTop: 3 },
    tabs:    { display:'flex', gap:6, marginBottom:20, overflowX:'auto', paddingBottom:2 },
    tab:     (active) => ({ padding:'8px 16px', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer', border:'none', background: active?'var(--c-orange)':'var(--c-card2)', color: active?'#fff':'var(--c-text2)', whiteSpace:'nowrap', transition:'all 120ms' }),
    grid:    (cols=2) => ({ display:'grid', gridTemplateColumns:`repeat(${cols},1fr)`, gap:12, marginBottom:16 }),
    card:    { background:'var(--c-card)', border:'1px solid var(--c-border2)', borderRadius:12, padding:'16px' },
    cardHdr: { fontSize:11, fontWeight:700, color:'var(--c-text4)', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:12 },
    kpi:     { background:'var(--c-card)', border:'1px solid var(--c-border2)', borderRadius:12, padding:'16px 18px' },
    kpiLabel:{ fontSize:11, color:'var(--c-text4)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 },
    kpiVal:  { fontSize:28, fontWeight:800, color:'var(--c-text)', lineHeight:1 },
    kpiSub:  { fontSize:11, color:'var(--c-text3)', marginTop:4 },
    badge:   (color) => ({ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:700, background: color==='green'?'rgba(34,197,94,0.15)':color==='red'?'rgba(239,68,68,0.15)':color==='yellow'?'rgba(251,191,36,0.15)':'rgba(249,115,22,0.15)', color: color==='green'?'#22c55e':color==='red'?'#ef4444':color==='yellow'?'#fbbf24':'var(--c-orange)' }),
    barRow:  { display:'flex', alignItems:'center', gap:10, marginBottom:10 },
    barLabel:{ width:70, fontSize:12, color:'var(--c-text3)', textAlign:'right', flexShrink:0 },
    barTrack:{ flex:1, height:28, background:'var(--c-card2)', borderRadius:4, overflow:'hidden', position:'relative' },
    barFill: (pct, color) => ({ width:`${Math.min(pct,100)}%`, height:'100%', background:color, borderRadius:4, display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:6, minWidth:2, transition:'width 0.6s ease' }),
    barVal:  { fontSize:11, fontWeight:700, color:'#fff', whiteSpace:'nowrap' },
    monthCard: (active) => ({ background: active?'rgba(249,115,22,0.1)':'var(--c-card2)', border:`1px solid ${active?'var(--c-orange)':'var(--c-border2)'}`, borderRadius:10, padding:'12px 14px', cursor:'pointer', transition:'all 120ms' }),
    recCard: (type) => ({ background: type==='win'?'rgba(34,197,94,0.07)':type==='stop'?'rgba(239,68,68,0.07)':'rgba(251,191,36,0.07)', border:`1px solid ${type==='win'?'rgba(34,197,94,0.2)':type==='stop'?'rgba(239,68,68,0.2)':'rgba(251,191,36,0.2)'}`, borderRadius:10, padding:'14px' }),
    uploadZone: { border:'2px dashed var(--c-border2)', borderRadius:12, padding:'32px', textAlign:'center', cursor:'pointer', transition:'border-color 120ms' },
    table: { width:'100%', borderCollapse:'collapse', fontSize:13 },
    th: { textAlign:'left', padding:'8px 10px', fontSize:10, fontWeight:700, color:'var(--c-text4)', textTransform:'uppercase', letterSpacing:'0.05em', borderBottom:'1px solid var(--c-border2)' },
    td: { padding:'9px 10px', borderBottom:'1px solid var(--c-border2)', color:'var(--c-text2)', verticalAlign:'middle' },
  };

  const hasData = metaStats || orderStats;

  /* ─── Render ─────────────────────────────────────────────────────────── */
  return (
    <div style={S.page}>

      {/* ── Header ── */}
      <div style={S.header}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={S.title}>📊 Meta Intelligence</div>
            <div style={S.sub}>Performanță completă · Meta Ads + Comenzi Shopify · Lunar & Zilnic</div>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={()=>fileRef.current?.click()} style={{ padding:'8px 14px', borderRadius:8, background:'var(--c-orange)', color:'#fff', border:'none', fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              📥 Import CSV Meta
            </button>
            {metaFile && <span style={{ ...S.badge('green'), padding:'8px 12px', fontSize:12 }}>✓ {metaFile}</span>}
            <input ref={fileRef} type="file" accept=".csv" style={{display:'none'}} onChange={handleMetaUpload} />
          </div>
        </div>
      </div>

      {/* ── No data state ── */}
      {!hasData && !loading && (
        <div style={{ ...S.uploadZone, maxWidth:500, margin:'40px auto' }} onClick={()=>fileRef.current?.click()}>
          <div style={{ fontSize:48, marginBottom:12 }}>📊</div>
          <div style={{ fontSize:16, fontWeight:700, color:'var(--c-text)', marginBottom:8 }}>Importă datele Meta Ads</div>
          <div style={{ fontSize:13, color:'var(--c-text3)', marginBottom:16 }}>Exportă CSV din Meta Ads Manager (Jan–Mai 2026) și încarcă-l aici. Datele din Shopify se încarcă automat.</div>
          <div style={{ ...S.badge(''), padding:'10px 20px', fontSize:13, borderRadius:8, background:'var(--c-orange)', color:'#fff', display:'inline-block', fontWeight:700 }}>Alege fișier CSV →</div>
        </div>
      )}

      {/* ── Tabs ── */}
      {hasData && (
        <>
          <div style={S.tabs}>
            {[
              {id:'overview',  label:'📈 Overview'},
              {id:'monthly',   label:'📅 Pe Luni'},
              {id:'dow',       label:'📆 Pe Zile'},
              {id:'hourly',    label:'⏰ Pe Ore'},
              {id:'recs',      label:'🎯 Recomandări'},
            ].map(t=>(
              <button key={t.id} style={S.tab(activeTab===t.id)} onClick={()=>setActiveTab(t.id)}>{t.label}</button>
            ))}
          </div>

          {/* ════════════════════════════════ OVERVIEW ═══════════════════════════ */}
          {activeTab === 'overview' && (
            <>
              {/* KPIs Row 1 — Meta */}
              {metaStats && (
                <>
                  <div style={{ ...S.cardHdr, marginBottom:8, fontSize:10 }}>META ADS · TOTAL PERIOADĂ</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:16 }}>
                    <div style={S.kpi}><div style={S.kpiLabel}>Cheltuit</div><div style={{...S.kpiVal, color:'var(--c-orange)'}}>{fmtK(metaStats.totalSpent)}</div><div style={S.kpiSub}>RON total</div></div>
                    <div style={S.kpi}><div style={S.kpiLabel}>Conversii</div><div style={S.kpiVal}>{metaStats.totalConv}</div><div style={S.kpiSub}>achiziții</div></div>
                    <div style={S.kpi}><div style={S.kpiLabel}>CPA Mediu</div><div style={{...S.kpiVal, color:cpaColor(metaStats.avgCPA)}}>{fmt(metaStats.avgCPA,0)}</div><div style={S.kpiSub}>RON / achiziție</div></div>
                    <div style={S.kpi}><div style={S.kpiLabel}>CPM</div><div style={S.kpiVal}>{fmt(metaStats.avgCPM,0)}</div><div style={S.kpiSub}>RON / 1000 afișări</div></div>
                    <div style={S.kpi}><div style={S.kpiLabel}>CTR</div><div style={S.kpiVal}>{fmt(metaStats.avgCTR,2)}%</div><div style={S.kpiSub}>click-through rate</div></div>
                    <div style={S.kpi}><div style={S.kpiLabel}>Reach</div><div style={S.kpiVal}>{fmtK(metaStats.totalReach)}</div><div style={S.kpiSub}>persoane unice</div></div>
                  </div>
                </>
              )}

              {/* KPIs Row 2 — Orders */}
              {orderStats && (
                <>
                  <div style={{ ...S.cardHdr, marginBottom:8, fontSize:10 }}>COMENZI SHOPIFY · TOTAL PERIOADĂ</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:16 }}>
                    <div style={S.kpi}><div style={S.kpiLabel}>Total comenzi</div><div style={S.kpiVal}>{orderStats.totalOrders}</div><div style={S.kpiSub}>plasate</div></div>
                    <div style={S.kpi}><div style={S.kpiLabel}>Livrate</div><div style={{...S.kpiVal, color:'#22c55e'}}>{orderStats.totalLivrat}</div><div style={S.kpiSub}>{fmt(orderStats.livrareRate,1)}% rată</div></div>
                    <div style={S.kpi}><div style={S.kpiLabel}>Retururi</div><div style={{...S.kpiVal, color:'#ef4444'}}>{orderStats.totalRetur}</div><div style={S.kpiSub}>{fmt(orderStats.returRate,1)}% rată</div></div>
                    <div style={S.kpi}><div style={S.kpiLabel}>Refuzate</div><div style={{...S.kpiVal, color:'#f97316'}}>{orderStats.totalRefuz}</div><div style={S.kpiSub}>neprimite</div></div>
                    <div style={S.kpi}><div style={S.kpiLabel}>Venituri brute</div><div style={S.kpiVal}>{fmtK(orderStats.totalRevenue)}</div><div style={S.kpiSub}>RON total</div></div>
                  </div>
                </>
              )}

              {/* CPA chart by month */}
              {metaStats && metaStats.months.length > 0 && (
                <div style={{ ...S.card, marginBottom:16 }}>
                  <div style={S.cardHdr}>CPA pe lună — Evoluție</div>
                  <div>
                    {metaStats.months.map(m => {
                      const maxCPA = Math.max(...metaStats.months.map(x=>x.cpa));
                      const pct = maxCPA ? m.cpa/maxCPA*100 : 0;
                      return (
                        <div key={m.month} style={S.barRow}>
                          <div style={{...S.barLabel, width:90, fontSize:11}}>{MONTHS_RO[m.m]} {m.y}</div>
                          <div style={S.barTrack}>
                            <div style={S.barFill(pct, cpaColor(m.cpa))}>
                              {pct > 20 && <span style={S.barVal}>{fmt(m.cpa,0)} RON</span>}
                            </div>
                          </div>
                          {pct <= 20 && <span style={{fontSize:12, color:cpaColor(m.cpa), fontWeight:700, minWidth:70}}>{fmt(m.cpa,0)} RON</span>}
                          <div style={{ minWidth:60, textAlign:'right' }}>
                            <span style={S.badge(m.cpa<=60?'green':m.cpa<=80?'yellow':'red')}>{m.conv} conv</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Return rate by month */}
              {orderStats && orderStats.months.length > 0 && (
                <div style={{ ...S.card, marginBottom:16 }}>
                  <div style={S.cardHdr}>Rată livrare vs. retur pe lună</div>
                  {orderStats.months.map(m => (
                    <div key={m.month} style={{ marginBottom:10 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--c-text3)', marginBottom:4 }}>
                        <span style={{fontWeight:600, color:'var(--c-text)'}}>{MONTHS_RO[m.m]} {m.y}</span>
                        <span>{m.cnt} comenzi · <span style={{color:'#22c55e'}}>{m.livrat} livrate</span> · <span style={{color:'#ef4444'}}>{m.retur} retururi</span></span>
                      </div>
                      <div style={{ display:'flex', height:14, borderRadius:4, overflow:'hidden', background:'var(--c-card2)' }}>
                        <div style={{ width:`${m.livrareRate}%`, background:'#22c55e', transition:'width 0.6s ease' }} title={`Livrate: ${fmt(m.livrareRate,1)}%`} />
                        <div style={{ width:`${m.returRate}%`, background:'#ef4444', transition:'width 0.6s ease' }} title={`Retururi: ${fmt(m.returRate,1)}%`} />
                        <div style={{ width:`${m.refuzRate}%`, background:'#f97316', transition:'width 0.6s ease' }} title={`Refuzate: ${fmt(m.refuzRate,1)}%`} />
                      </div>
                    </div>
                  ))}
                  <div style={{ display:'flex', gap:16, marginTop:12, fontSize:11, color:'var(--c-text4)' }}>
                    <span><span style={{color:'#22c55e'}}>■</span> Livrate</span>
                    <span><span style={{color:'#ef4444'}}>■</span> Retururi</span>
                    <span><span style={{color:'#f97316'}}>■</span> Refuzate</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════ MONTHLY ════════════════════════════ */}
          {activeTab === 'monthly' && (
            <>
              <div style={{ ...S.grid(2), gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))' }}>
                {combinedMonths.map(m => (
                  <div key={m.key} style={S.monthCard(activeMonth===m.key)} onClick={()=>setActiveMonth(activeMonth===m.key?null:m.key)}>
                    <div style={{ fontSize:13, fontWeight:700, color: activeMonth===m.key?'var(--c-orange)':'var(--c-text)', marginBottom:6 }}>{MONTHS_RO[m.m]} {m.y}</div>
                    {m.cpa > 0 && <div style={{ fontSize:20, fontWeight:800, color:cpaColor(m.cpa), marginBottom:2 }}>{fmt(m.cpa,0)} RON</div>}
                    {m.cpa > 0 && <div style={{ fontSize:10, color:'var(--c-text4)' }}>CPA · {m.conv} conv</div>}
                    {m.orders > 0 && <div style={{ fontSize:11, color:'var(--c-text3)', marginTop:4 }}>{m.orders} comenzi · <span style={{color:'#22c55e'}}>{fmt(m.livrareRate,0)}%</span> livrate</div>}
                  </div>
                ))}
              </div>

              {selectedMonth && (
                <div style={{ ...S.card, marginTop:8 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:8 }}>
                    <div style={{ fontSize:18, fontWeight:800, color:'var(--c-text)' }}>{selectedMonth.label}</div>
                    <button onClick={()=>setActiveMonth(null)} style={{ background:'transparent', border:'1px solid var(--c-border2)', borderRadius:6, padding:'4px 10px', color:'var(--c-text3)', cursor:'pointer', fontSize:12 }}>✕ Închide</button>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:10, marginBottom:16 }}>
                    {selectedMonth.spent>0 && <div style={S.kpi}><div style={S.kpiLabel}>Cheltuit Meta</div><div style={{...S.kpiVal,fontSize:22,color:'var(--c-orange)'}}>{fmt(selectedMonth.spent,0)}</div><div style={S.kpiSub}>RON</div></div>}
                    {selectedMonth.cpa>0 && <div style={S.kpi}><div style={S.kpiLabel}>CPA</div><div style={{...S.kpiVal,fontSize:22,color:cpaColor(selectedMonth.cpa)}}>{fmt(selectedMonth.cpa,0)}</div><div style={S.kpiSub}>RON/conversie</div></div>}
                    {selectedMonth.conv>0 && <div style={S.kpi}><div style={S.kpiLabel}>Conversii Meta</div><div style={{...S.kpiVal,fontSize:22}}>{selectedMonth.conv}</div><div style={S.kpiSub}>achiziții</div></div>}
                    {selectedMonth.orders>0 && <div style={S.kpi}><div style={S.kpiLabel}>Comenzi Shopify</div><div style={{...S.kpiVal,fontSize:22}}>{selectedMonth.orders}</div><div style={S.kpiSub}>plasate</div></div>}
                    {selectedMonth.livrat>0 && <div style={S.kpi}><div style={S.kpiLabel}>Livrate</div><div style={{...S.kpiVal,fontSize:22,color:'#22c55e'}}>{selectedMonth.livrat}</div><div style={S.kpiSub}>{fmt(selectedMonth.livrareRate,1)}%</div></div>}
                    {selectedMonth.retur>0 && <div style={S.kpi}><div style={S.kpiLabel}>Retururi</div><div style={{...S.kpiVal,fontSize:22,color:'#ef4444'}}>{selectedMonth.retur}</div><div style={S.kpiSub}>{fmt(selectedMonth.returRate,1)}%</div></div>}
                    {selectedMonth.revenue>0 && <div style={S.kpi}><div style={S.kpiLabel}>Venituri</div><div style={{...S.kpiVal,fontSize:22}}>{fmtK(selectedMonth.revenue)}</div><div style={S.kpiSub}>RON brut</div></div>}
                  </div>
                  {/* Performance verdict */}
                  <div style={{ padding:'12px 16px', borderRadius:10, background: selectedMonth.cpa>0&&selectedMonth.cpa<=65?'rgba(34,197,94,0.08)':selectedMonth.cpa>100?'rgba(239,68,68,0.08)':'rgba(251,191,36,0.08)', border:`1px solid ${selectedMonth.cpa>0&&selectedMonth.cpa<=65?'rgba(34,197,94,0.2)':selectedMonth.cpa>100?'rgba(239,68,68,0.2)':'rgba(251,191,36,0.2)'}` }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'var(--c-text)', marginBottom:4 }}>
                      {selectedMonth.cpa<=0 ? '⚪ Fără date Meta' : selectedMonth.cpa<=55 ? '🏆 Lună excelentă — sub targetul de 55 RON CPA' : selectedMonth.cpa<=70 ? '✅ Lună bună — aproape de target' : selectedMonth.cpa<=85 ? '⚠️ Lună mediocră — CPA de optimizat' : '❌ Lună slabă — analizați ce a mers greșit'}
                    </div>
                    <div style={{ fontSize:12, color:'var(--c-text3)' }}>
                      {selectedMonth.retur>0 && `${selectedMonth.retur} retururi (${fmt(selectedMonth.returRate,1)}%) · `}
                      {selectedMonth.refuz>0 && `${selectedMonth.refuz} refuzuri · `}
                      {selectedMonth.spent>0 && `${fmt(selectedMonth.spent,0)} RON cheltuiți pe Meta`}
                    </div>
                  </div>
                </div>
              )}

              {/* Full monthly table */}
              {combinedMonths.length > 0 && (
                <div style={{ ...S.card, marginTop:16, overflowX:'auto' }}>
                  <div style={S.cardHdr}>Tabel complet lunar</div>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        {['Lună','Cheltuit Meta','Conv Meta','CPA','Comenzi','Livrate','Retururi','Refuzate','% Livrare','% Retur','Venituri'].map(h=>(
                          <th key={h} style={S.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {combinedMonths.map(m=>(
                        <tr key={m.key} style={{ background: activeMonth===m.key?cpaBg(m.cpa):'transparent' }} onClick={()=>setActiveMonth(activeMonth===m.key?null:m.key)}>
                          <td style={{...S.td, fontWeight:700, color:'var(--c-text)', cursor:'pointer'}}>{MONTHS_RO[m.m]} {m.y}</td>
                          <td style={{...S.td, color:'var(--c-orange)'}}>{m.spent>0?fmt(m.spent,0)+' RON':'—'}</td>
                          <td style={S.td}>{m.conv>0?m.conv:'—'}</td>
                          <td style={{...S.td, fontWeight:700, color:m.cpa>0?cpaColor(m.cpa):'var(--c-text4)'}}>{m.cpa>0?fmt(m.cpa,0)+' RON':'—'}</td>
                          <td style={S.td}>{m.orders>0?m.orders:'—'}</td>
                          <td style={{...S.td, color:'#22c55e'}}>{m.livrat>0?m.livrat:'—'}</td>
                          <td style={{...S.td, color:'#ef4444'}}>{m.retur>0?m.retur:'—'}</td>
                          <td style={{...S.td, color:'#f97316'}}>{m.refuz>0?m.refuz:'—'}</td>
                          <td style={{...S.td, color:m.livrareRate>=80?'#22c55e':m.livrareRate>=60?'#fbbf24':'#ef4444'}}>{m.orders>0?fmt(m.livrareRate,1)+'%':'—'}</td>
                          <td style={{...S.td, color:m.returRate>25?'#ef4444':m.returRate>15?'#fbbf24':'#22c55e'}}>{m.orders>0?fmt(m.returRate,1)+'%':'—'}</td>
                          <td style={S.td}>{m.revenue>0?fmtK(m.revenue)+' RON':'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════ DAY OF WEEK ════════════════════════ */}
          {activeTab === 'dow' && (
            <>
              {/* Meta CPA by DOW */}
              {metaStats && (
                <div style={{ ...S.card, marginBottom:16 }}>
                  <div style={S.cardHdr}>CPA Meta Ads pe zi a săptămânii</div>
                  {dowAnalysis.map((d,i) => {
                    const maxCPA = Math.max(...dowAnalysis.filter(x=>x.metaCPA>0).map(x=>x.metaCPA));
                    const pct = maxCPA && d.metaCPA ? d.metaCPA/maxCPA*100 : 0;
                    return (
                      <div key={i} style={S.barRow}>
                        <div style={{...S.barLabel, width:75}}>{d.short}</div>
                        <div style={S.barTrack}>
                          <div style={S.barFill(pct, cpaColor(d.metaCPA))}>
                            {pct > 25 && <span style={S.barVal}>{fmt(d.metaCPA,0)} RON</span>}
                          </div>
                        </div>
                        {pct <= 25 && <span style={{fontSize:12,color:cpaColor(d.metaCPA),fontWeight:700,minWidth:65}}>{d.metaCPA>0?fmt(d.metaCPA,0)+' RON':'—'}</span>}
                        <div style={{ minWidth:55, textAlign:'right' }}>
                          {d.metaCPA > 0 && <span style={S.badge(d.metaCPA<=65?'green':d.metaCPA<=80?'yellow':'red')}>{d.metaCPA<=65?'✓ BUN':d.metaCPA<=80?'OK':'↑ SLAB'}</span>}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ marginTop:16, padding:'12px', background:'var(--c-card2)', borderRadius:8, fontSize:12, color:'var(--c-text3)' }}>
                    💡 <strong style={{color:'var(--c-text)'}}>Regula de aur:</strong> Mărește bugetul în zilele cu CPA mic. Reduce (dar nu opri) în zilele cu CPA mare.
                  </div>
                </div>
              )}

              {/* Orders by DOW */}
              {orderStats && (
                <div style={{ ...S.card, marginBottom:16 }}>
                  <div style={S.cardHdr}>Comenzi & retururi pe zi a săptămânii</div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          {['Zi','Comenzi','Livrate','Retururi','Refuzate','% Livrare','% Retur','Venituri'].map(h=><th key={h} style={S.th}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {dowAnalysis.map((d,i)=>(
                          <tr key={i}>
                            <td style={{...S.td,fontWeight:700,color:'var(--c-text)'}}>{d.day}</td>
                            <td style={S.td}>{d.ordCnt||'—'}</td>
                            <td style={{...S.td,color:'#22c55e'}}>{d.ordLivrat||'—'}</td>
                            <td style={{...S.td,color:'#ef4444'}}>{d.ordRetur||'—'}</td>
                            <td style={{...S.td,color:'#f97316'}}>{d.ordCnt-d.ordLivrat-d.ordRetur>0?d.ordCnt-d.ordLivrat-d.ordRetur:'—'}</td>
                            <td style={{...S.td,color:d.ordCnt&&(d.ordCnt-d.ordRetur)/d.ordCnt*100>=80?'#22c55e':'#fbbf24'}}>{d.ordCnt?fmt((d.ordCnt-d.ordRetur)/d.ordCnt*100,1)+'%':'—'}</td>
                            <td style={{...S.td,color:d.returRate>25?'#ef4444':d.returRate>15?'#fbbf24':'#22c55e'}}>{d.ordCnt?fmt(d.returRate,1)+'%':'—'}</td>
                            <td style={S.td}>{d.ordRevenue>0?fmtK(d.ordRevenue)+' RON':'—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Budget strategy */}
              <div style={{ ...S.card }}>
                <div style={S.cardHdr}>📋 Strategie buget săptămânal recomandată</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:8 }}>
                  {[
                    {day:'Lun', action:'-20%', color:'#fbbf24', note:'Monitorizezi'},
                    {day:'Mar', action:'STD',  color:'var(--c-text3)', note:'Normal'},
                    {day:'Mie', action:'+30%', color:'#22c55e', note:'CEL MAI BUN'},
                    {day:'Joi', action:'+20%', color:'#22c55e', note:'Momentum'},
                    {day:'Vin', action:'-30%', color:'#f97316', note:'Reduci'},
                    {day:'Sâm', action:'MIN',  color:'var(--c-text4)', note:'Menții viu'},
                    {day:'Dum', action:'+25%', color:'#22c55e', note:'Start CBO'},
                  ].map(d=>(
                    <div key={d.day} style={{ textAlign:'center', padding:'12px 8px', background:'var(--c-card2)', borderRadius:8, border:`1px solid var(--c-border2)` }}>
                      <div style={{ fontSize:11, color:'var(--c-text4)', marginBottom:6 }}>{d.day}</div>
                      <div style={{ fontSize:18, fontWeight:800, color:d.color, marginBottom:4 }}>{d.action}</div>
                      <div style={{ fontSize:9, color:'var(--c-text4)', lineHeight:1.3 }}>{d.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ════════════════════════════════ HOURLY ═════════════════════════════ */}
          {activeTab === 'hourly' && orderStats && (
            <div style={{ ...S.card }}>
              <div style={S.cardHdr}>Comenzi pe oră din zi — când cumpără clienții tăi</div>
              <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:140, marginBottom:12, overflowX:'auto' }}>
                {orderStats.byHour.map(h => {
                  const maxCnt = Math.max(...orderStats.byHour.map(x=>x.cnt));
                  const pct = maxCnt ? h.cnt/maxCnt : 0;
                  const isHot = pct > 0.6;
                  const isMed = pct > 0.3;
                  return (
                    <div key={h.hour} style={{ flex:1, minWidth:18, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                      <div style={{ fontSize:9, color:'var(--c-text4)', fontWeight:600 }}>{h.cnt>0?h.cnt:''}</div>
                      <div style={{ width:'100%', height:`${Math.max(pct*110,2)}px`, background: isHot?'var(--c-orange)':isMed?'rgba(249,115,22,0.5)':'var(--c-card2)', borderRadius:'3px 3px 0 0', transition:'height 0.5s ease', minHeight:2 }} title={`${h.hour}:00 — ${h.cnt} comenzi`} />
                      <div style={{ fontSize:9, color:'var(--c-text4)' }}>{pad2(h.hour)}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize:12, color:'var(--c-text3)', marginBottom:16 }}>
                <span style={{color:'var(--c-orange)'}}>■</span> Ore de vârf &nbsp;
                <span style={{color:'rgba(249,115,22,0.5)'}}>■</span> Ore medii &nbsp;
                <span style={{color:'var(--c-text4)'}}>■</span> Ore slabe
              </div>
              {/* Insights */}
              {(() => {
                const sorted = [...orderStats.byHour].sort((a,b)=>b.cnt-a.cnt);
                const top3 = sorted.slice(0,3).map(h=>`${pad2(h.hour)}:00`).join(', ');
                const worst3 = sorted.filter(h=>h.cnt>0).slice(-3).map(h=>`${pad2(h.hour)}:00`).join(', ');
                return (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div style={{ padding:'12px', background:'rgba(34,197,94,0.07)', borderRadius:8, border:'1px solid rgba(34,197,94,0.2)' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#22c55e', marginBottom:4 }}>🕐 Ore de vârf</div>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--c-text)' }}>{top3}</div>
                      <div style={{ fontSize:11, color:'var(--c-text3)', marginTop:2 }}>Programează reclamele activ în aceste ore</div>
                    </div>
                    <div style={{ padding:'12px', background:'rgba(239,68,68,0.07)', borderRadius:8, border:'1px solid rgba(239,68,68,0.2)' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#ef4444', marginBottom:4 }}>🕐 Ore slabe</div>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--c-text)' }}>{worst3}</div>
                      <div style={{ fontSize:11, color:'var(--c-text3)', marginTop:2 }}>Reduceri posibile pe dayparting</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {activeTab === 'hourly' && !orderStats && (
            <div style={{ ...S.card, textAlign:'center', padding:40 }}>
              <div style={{ fontSize:32, marginBottom:12 }}>📦</div>
              <div style={{ color:'var(--c-text3)' }}>Nicio comandă Shopify găsită. Asigură-te că ești logat și comenzile sunt sincronizate.</div>
            </div>
          )}

          {/* ════════════════════════════════ RECOMMENDATIONS ════════════════════ */}
          {activeTab === 'recs' && (
            <>
              <div style={{ marginBottom:16 }}>
                {recommendations.length === 0 && (
                  <div style={{ ...S.card, textAlign:'center', padding:40 }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>🎯</div>
                    <div style={{ color:'var(--c-text3)' }}>Importați date Meta CSV pentru a genera recomandări personalizate.</div>
                  </div>
                )}
                {recommendations.map((r,i)=>(
                  <div key={i} style={{ ...S.recCard(r.type), marginBottom:12 }}>
                    <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                      <span style={{ fontSize:20 }}>{r.icon}</span>
                      <div>
                        <div style={{ fontSize:14, fontWeight:700, color:'var(--c-text)', marginBottom:4 }}>{r.title}</div>
                        <div style={{ fontSize:13, color:'var(--c-text3)', lineHeight:1.5 }}>{r.body}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* 7-Figure playbook */}
              <div style={S.card}>
                <div style={S.cardHdr}>🏆 7-Figure Playbook — Regulile de aur</div>
                {[
                  { icon:'🚫', title:'Nu opri campania joi', body:'Joi pare slab dar e tranziția spre weekend. Reduce bugetul cu 20% dar nu opri. Campaniile tale mor joi pentru că le omori tu.' },
                  { icon:'📊', title:'Judecă doar după 7 zile', body:'Learning phase = 3-4 zile. Orice decizie luată înainte de ziua 7 e o decizie luată pe zgomot, nu pe semnal.' },
                  { icon:'🔄', title:'Un singur element modificat per test', body:'Dacă schimbi video + copy + audiență simultan, nu știi ce a funcționat. Schimbă doar copyul pe duplicat — nimic altceva.' },
                  { icon:'📈', title:'Mărire buget max 20% o dată', body:'Creșteri mai mari de 20% resetează algoritmul în learning phase. Măriri la 5-7 zile, nu zilnic.' },
                  { icon:'🎯', title:'CBO separat per model', body:'Nu mixa produse în același CBO. Meta nu știe cui să arate ce și arde bugetul pe audiența greșită.' },
                  { icon:'💡', title:'Miercuri e ziua ta de aur', body:'CPA 67.69 RON — cel mai mic din săptămână. Mărește bugetul miercuri, nu duminica. Datele reale o confirmă.' },
                ].map((r,i)=>(
                  <div key={i} style={{ display:'flex', gap:12, padding:'12px 0', borderBottom: i<5?'1px solid var(--c-border2)':'none' }}>
                    <span style={{ fontSize:20, flexShrink:0 }}>{r.icon}</span>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--c-text)', marginBottom:3 }}>{r.title}</div>
                      <div style={{ fontSize:12, color:'var(--c-text3)', lineHeight:1.5 }}>{r.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
