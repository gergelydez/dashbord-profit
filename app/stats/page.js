'use client';
import { useState, useEffect, useMemo } from 'react';

const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
};

// Overrides din localStorage — sursa de adevăr, actualizată de Dashboard după GLS API
function getLocalOverrides() {
  try { const s = localStorage.getItem('gx_track_ov'); return s ? JSON.parse(s) : {}; } catch { return {}; }
}

// Aplică overrides din localStorage pe comenzi
// o.ts din gx_orders_all e deja corect (Dashboard îl salvează cu ts actualizat)
// dar overrides ne dă și statusRaw, lastUpdate etc.
function applyOverrides(orders) {
  const ov = getLocalOverrides();
  const now = new Date();
  return orders.map(o => {
    // În tranzit >30 zile → anulat (fantasmă, probabil anulată fără AWB)
    if (['incurs','outfor'].includes(o.ts) && o.createdAt) {
      const daysSince = (now - new Date(o.createdAt)) / (1000 * 60 * 60 * 24);
      if (daysSince > 30) return { ...o, ts: 'anulat' };
    }
    // Anulată financiar → anulat
    if (o.fin === 'voided' || o.fin === 'refunded') return { ...o, ts: 'anulat' };
    const override = ov[o.id];
    if (!override) return o;
    return { ...o, ts: override.ts };
  });
}

// Status final: tracking override (GLS API) > Shopify
// Sameday: sdAwbMap > o.ts
function getFinalStatus(o, sdAwbMap) {
  if (o.courier === 'sameday') {
    const awb = (o.trackingNo || '').trim();
    const sdSt = awb && sdAwbMap[awb] ? sdAwbMap[awb] : null;
    return sdSt || o.ts;
  }
  // GLS și altele: o.ts e deja corect (override aplicat)
  return o.ts;
}

const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fmt = n => Number(n||0).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtInt = n => Number(n||0).toLocaleString('ro-RO');

const ONLINE_GW = ['shopify_payments','stripe','paypal'];
const isOnlinePayment = (o, onlineIds=[]) => {
  if (onlineIds.includes(String(o.id))) return true;
  const gw = (o.gateway||'').toLowerCase();
  return ONLINE_GW.some(g => gw.includes(g));
};

const now = new Date();
const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();

const PRESETS = [
  { id: 'today',      label: 'Azi',           from: () => { const d=new Date(); return [toISO(d), toISO(d)]; }},
  { id: 'yesterday',  label: 'Ieri',          from: () => { const d=new Date(y,m,now.getDate()-1); return [toISO(d),toISO(d)]; }},
  { id: 'week',       label: '7 zile',        from: () => [toISO(new Date(y,m,d-6)), toISO(now)]},
  { id: 'month',      label: 'Luna aceasta',  from: () => [`${y}-${pad(m+1)}-01`, toISO(now)]},
  { id: 'last_month', label: 'Luna trecută',  from: () => { const lm=new Date(y,m,0); return [`${lm.getFullYear()}-${pad(lm.getMonth()+1)}-01`, toISO(lm)]; }},
  { id: 'last_30',    label: '30 zile',       from: () => [toISO(new Date(y,m,d-29)), toISO(now)]},
  { id: 'last_90',    label: '90 zile',       from: () => [toISO(new Date(y,m,d-89)), toISO(now)]},
  { id: 'year',       label: 'Anul acesta',   from: () => [`${y}-01-01`, toISO(now)]},
];

export default function Stats() {
  const [allOrders, setAllOrders] = useState([]);
  const [lastFetch, setLastFetch] = useState(null);
  const [preset, setPreset] = useState('month');
  const [onlineIds] = useState(() => { try { return JSON.parse(ls.get('online_payment_ids')||'[]'); } catch { return []; }});
  const [sdAwbMap]  = useState(() => { try { return JSON.parse(ls.get('sd_awb_map')||'{}'); } catch { return {}; }});
  const [shopifyFeePercent, setShopifyFeePercent] = useState(() => parseFloat(ls.get('sp_fee_pct') || '1.9'));
  const [shopifyFeeFixed, setShopifyFeeFixed]     = useState(() => parseFloat(ls.get('sp_fee_fix') || '1.25'));

  useEffect(() => {
    const load = () => {
      const saved = ls.get('gx_orders_all');
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved);
        const ts = ls.get('gx_fetch_time');
        if (ts) setLastFetch(new Date(ts));
        setAllOrders(applyOverrides(parsed));
      } catch {}
    };

    load();

    // Re-încarcă când Dashboard actualizează localStorage după tracking
    const onStorage = (e) => {
      if (e.key === 'gx_orders_all' || e.key === 'gx_track_ov') load();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const [from, to] = useMemo(() => {
    const p = PRESETS.find(p => p.id === preset);
    return p ? p.from() : PRESETS[3].from();
  }, [preset]);

  // Comenzile din perioada selectată
  const orders = useMemo(() => {
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');
    return allOrders.filter(o => {
      const c = new Date(o.createdAt);
      return c >= fromD && c <= toD;
    });
  }, [allOrders, from, to]);

  // Livrate în perioadă — IDENTIC cu profit/page.js:
  // createdAt în perioadă + getFinalStatus === 'livrat'
  // (nu fulfilledAt — asta e diferența față de ce era înainte)
  const livrateInPeriod = useMemo(() => {
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');
    return allOrders.filter(o => {
      const created = new Date(o.createdAt);
      if (created < fromD || created > toD) return false;
      return getFinalStatus(o, sdAwbMap) === 'livrat';
    });
  }, [allOrders, from, to, sdAwbMap]);

  const stats = useMemo(() => {
    const total   = orders.length;
    const livrate = livrateInPeriod; // deja filtrate corect

    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');

    const retururi = allOrders.filter(o => {
      if (getFinalStatus(o, sdAwbMap) !== 'retur') return false;
      const created = new Date(o.createdAt);
      return created >= fromD && created <= toD;
    });

    const anulate = orders.filter(o => getFinalStatus(o, sdAwbMap) === 'anulat');

    // Tranzit: din TOATE comenzile indiferent de perioadă
    const tranzit = allOrders.filter(o => ['incurs','outfor'].includes(getFinalStatus(o, sdAwbMap)));
    const pending = allOrders.filter(o => getFinalStatus(o, sdAwbMap) === 'pending');

    const onlineOrders = orders.filter(o => isOnlinePayment(o, onlineIds));
    const codOrders    = orders.filter(o => !isOnlinePayment(o, onlineIds));

    const sumLivrate = livrate.reduce((a,o)=>a+o.total,0);
    const sumCOD     = livrate.filter(o=>!isOnlinePayment(o,onlineIds)).reduce((a,o)=>a+o.total,0);
    const sumOnline  = onlineOrders.reduce((a,o)=>a+o.total,0); // toate card din perioadă
    const sumRetur   = retururi.reduce((a,o)=>a+o.total,0);

    const glsAll    = orders.filter(o=>o.courier==='gls');
    const sdAll     = orders.filter(o=>o.courier==='sameday');
    const glsLiv    = livrateInPeriod.filter(o=>o.courier==='gls').length;
    const sdLiv     = livrateInPeriod.filter(o=>o.courier==='sameday').length;
    const glsRet    = retururi.filter(o=>o.courier==='gls').length;
    const sdRet     = retururi.filter(o=>o.courier==='sameday').length;

    const totalGLS     = livrate.filter(o=>o.courier==='gls'&&!isOnlinePayment(o,onlineIds)).reduce((a,o)=>a+o.total,0);
    const totalSameday = livrate.filter(o=>o.courier==='sameday'&&!isOnlinePayment(o,onlineIds)).reduce((a,o)=>a+o.total,0);
    const totalShopifyBrut = onlineOrders.reduce((a,o)=>a+o.total,0);
    const totalShopify = onlineOrders.reduce((a,o)=>a+o.total*(1-shopifyFeePercent/100)-shopifyFeeFixed,0);

    const rataLivrare = total ? Math.round(livrate.length/total*100) : 0;
    const rataRetur   = livrate.length ? Math.round(retururi.length/(livrate.length+retururi.length)*100) : 0;
    const avgOrder    = livrate.length ? sumLivrate/livrate.length : 0;

    // Produse din livrate
    const prodMap = {};
    livrate.forEach(o => {
      const items = o.items || [];
      if (!items.length) return;
      const totalItems = items.reduce((s,i)=>s+(i.qty||1),0);
      items.forEach(item => {
        const key = item.sku || item.name;
        if (!key) return;
        if (!prodMap[key]) prodMap[key] = { name: item.name, sku: item.sku||'', qty:0, revenue:0 };
        const qty = item.qty||1;
        const unitPrice = (item.price&&item.price>0) ? item.price : (o.total/totalItems);
        prodMap[key].qty     += qty;
        prodMap[key].revenue += unitPrice*qty;
      });
    });
    const prodList = Object.values(prodMap).sort((a,b)=>b.qty-a.qty);
    const topProd  = prodList[0] || null;

    // Surse trafic
    const sourceMap = {};
    orders.forEach(o => {
      const utm = (o.utmSource||'').toLowerCase();
      const ref = (o.referrerUrl||'').toLowerCase();
      const med = (o.utmMedium||'').toLowerCase();
      const lp  = (o.landingPage||'').toLowerCase();
      const cam = (o.utmCampaign||'').toLowerCase();
      let src = 'Direct';
      if (utm.includes('facebook')||utm.includes('fb')||ref.includes('facebook.com')||lp.includes('fbclid')) src='Facebook';
      else if (utm.includes('tiktok')||ref.includes('tiktok.com')||lp.includes('ttclid')) src='TikTok';
      else if (utm.includes('google')||ref.includes('google.com')||lp.includes('gclid')||med.includes('cpc')) src='Google';
      else if (utm.includes('instagram')||ref.includes('instagram.com')) src='Instagram';
      else if (utm.includes('email')||med.includes('email')) src='Email';
      else if (ref&&!ref.includes('myshopify')&&!ref.includes('glamxonline')) src='Referral';
      else if (utm) src=utm.charAt(0).toUpperCase()+utm.slice(1);
      sourceMap[src]=(sourceMap[src]||0)+1;
    });
    const sourceList = Object.entries(sourceMap).sort((a,b)=>b[1]-a[1]);

    // Încasări pe zile
    const addWorkDays = (str, n) => {
      if (!str) return '';
      const d = new Date(str + 'T12:00:00');
      let added = 0;
      while (added < n) { d.setDate(d.getDate()+1); const day=d.getDay(); if(day!==0&&day!==6) added++; }
      const p = x=>String(x).padStart(2,'0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
    };

    const incasariPerZi = {};
    const addToZi = (str, field, brut, net) => {
      if (!str) return;
      if (!incasariPerZi[str]) incasariPerZi[str]={gls:0,sameday:0,shopify:0,total:0,count:0};
      incasariPerZi[str][field] += net !== undefined ? net : brut;
      incasariPerZi[str].total  += net !== undefined ? net : brut;
      incasariPerZi[str].count++;
    };

    livrate.forEach(o => {
      const isOnline = isOnlinePayment(o, onlineIds);
      if (isOnline) return;
      if (o.courier==='sameday'&&getFinalStatus(o,sdAwbMap)!=='livrat') return;
      const livStr = (o.fulfilledAt||o.createdAt||'').slice(0,10);
      if (!livStr) return;
      if (o.courier==='gls')     addToZi(addWorkDays(livStr,2),'gls',o.total);
      else if (o.courier==='sameday') addToZi(addWorkDays(livStr,1),'sameday',o.total);
      else addToZi(addWorkDays(livStr,2),'gls',o.total);
    });
    onlineOrders.forEach(o => {
      const base = (o.createdAt||'').slice(0,10);
      if (!base) return;
      const net = o.total*(1-shopifyFeePercent/100)-shopifyFeeFixed;
      addToZi(addWorkDays(base,2),'shopify',o.total,net);
    });

    const incasariList = Object.entries(incasariPerZi).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,60);

    // Previziuni
    const todayStr = new Date().toISOString().slice(0,10);
    const pad2 = n=>String(n).padStart(2,'0');
    const nextBD = (str,n) => {
      const d=new Date(str+'T12:00:00'); let added=0;
      while(added<n){d.setDate(d.getDate()+1);if(d.getDay()!==0&&d.getDay()!==6)added++;}
      return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    };
    const nextWD = (n) => {
      const d=new Date(todayStr+'T12:00:00'); let added=0;
      while(added<n){d.setDate(d.getDate()+1);if(d.getDay()!==0&&d.getDay()!==6)added++;}
      return d.toISOString().slice(0,10);
    };
    const workDays = [0,1,2,3,4].map(n=>n===0?todayStr:nextWD(n));
    const workDayLabels = workDays.map(str=>{
      const d=new Date(str+'T12:00:00');
      const days=['Dum','Lun','Mar','Mie','Joi','Vin','Sâm'];
      const months=['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','nov','dec'];
      return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    });
    const previziuni = {};
    workDays.forEach(str=>{previziuni[str]={gls:0,sameday:0,shopify:0,total:0};});

    const addByDate=(dateStr,courier,val)=>{
      if(previziuni[dateStr]){previziuni[dateStr][courier]+=val;previziuni[dateStr].total+=val;}
    };

    livrate.forEach(o=>{
      if(isOnlinePayment(o,onlineIds)) return;
      if(o.courier==='sameday'&&getFinalStatus(o,sdAwbMap)!=='livrat') return;
      if(!o.fulfilledAt) return;
      const livStr=o.fulfilledAt.slice(0,10);
      if(o.courier==='gls') addByDate(nextBD(livStr,2),'gls',o.total);
      else if(o.courier==='sameday') addByDate(nextBD(livStr,1),'sameday',o.total);
    });
    onlineOrders.forEach(o=>{
      const base=(o.createdAt||'').slice(0,10);
      if(!base) return;
      const net=o.total*(1-shopifyFeePercent/100)-shopifyFeeFixed;
      addByDate(nextBD(base,2),'shopify',net);
    });

    return {
      total, livrate: livrate.length, retururi: retururi.length,
      anulate: anulate.length, tranzit: tranzit.length, pending: pending.length,
      sumLivrate, sumCOD, sumOnline, sumRetur, totalRevenue: sumCOD+sumOnline,
      gls: glsAll.length, sameday: sdAll.length, glsLiv, sdLiv, glsRet, sdRet,
      codCount: codOrders.length, onlineCount: onlineOrders.length,
      totalGLS, totalSameday, totalShopify, totalShopifyBrut,
      rataLivrare, rataRetur, avgOrder, topProd, prodList: prodList.slice(0,10),
      avgPrice: topProd ? topProd.revenue/topProd.qty : 0,
      sourceList, incasariList, previziuni, workDays, workDayLabels,
    };
  }, [orders, livrateInPeriod, allOrders, onlineIds, sdAwbMap, shopifyFeePercent, shopifyFeeFixed, from, to]);

  const Bar = ({ pct, color }) => (
    <div style={{height:4,background:'#1e2a35',borderRadius:2,overflow:'hidden',marginTop:4}}>
      <div style={{height:'100%',width:`${Math.min(100,pct)}%`,background:color,borderRadius:2,transition:'width 1s'}}/>
    </div>
  );

  const KPI = ({ icon, label, value, sub, color, pct }) => (
    <div style={{background:'#0d1520',border:`1px solid ${color}33`,borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:color}}/>
      <div style={{fontSize:20,marginBottom:6}}>{icon}</div>
      <div style={{fontSize:24,fontWeight:800,color,lineHeight:1,marginBottom:4}}>{value}</div>
      <div style={{fontSize:11,color:'#94a3b8',marginBottom:sub?4:0}}>{label}</div>
      {sub && <div style={{fontSize:10,color:'#4a5568'}}>{sub}</div>}
      {pct !== undefined && <Bar pct={pct} color={color}/>}
    </div>
  );

  const Section = ({ title }) => (
    <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:3,margin:'24px 0 12px',display:'flex',alignItems:'center',gap:8}}>
      {title}<div style={{flex:1,height:1,background:'#1e2a35'}}/>
    </div>
  );

  if (allOrders.length === 0) {
    return (
      <div style={{minHeight:'100vh',background:'#080c10',color:'#e8edf2',fontFamily:'DM Sans,system-ui,sans-serif',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}}>
        <div style={{fontSize:40}}>📊</div>
        <div style={{fontSize:16,fontWeight:700}}>Nu există date în cache</div>
        <div style={{fontSize:12,color:'#94a3b8'}}>Mergi la <a href="/" style={{color:'#f97316'}}>Dashboard</a> și sincronizează mai întâi</div>
      </div>
    );
  }

  return (
    <div style={{minHeight:'100vh',background:'#080c10',color:'#e8edf2',fontFamily:'DM Sans,system-ui,sans-serif'}}>
      <div style={{maxWidth:1200,margin:'0 auto',padding:'20px 14px 60px'}}>

        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20,paddingBottom:16,borderBottom:'1px solid #1e2a35',flexWrap:'wrap'}}>
          <div style={{background:'#f97316',color:'#fff',fontWeight:800,fontSize:14,padding:'6px 10px',borderRadius:8}}>GLAMX</div>
          <div>
            <div style={{fontSize:18,fontWeight:700}}>Statistici</div>
            <div style={{fontSize:11,color:'#94a3b8'}}>{allOrders.length} comenzi în cache · {lastFetch?.toLocaleDateString('ro-RO')}</div>
          </div>
          <a href="/" style={{marginLeft:'auto',background:'#161d24',border:'1px solid #243040',color:'#94a3b8',padding:'5px 12px',borderRadius:20,fontSize:11,textDecoration:'none'}}>← Dashboard</a>
        </div>

        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:20}}>
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => setPreset(p.id)}
              style={{background:preset===p.id?'#f97316':'#161d24',border:`1px solid ${preset===p.id?'#f97316':'#243040'}`,color:preset===p.id?'white':'#94a3b8',padding:'6px 14px',borderRadius:20,fontSize:11,cursor:'pointer',fontWeight:preset===p.id?600:400}}>
              {p.label}
            </button>
          ))}
          <span style={{marginLeft:'auto',fontSize:11,color:'#4a5568',alignSelf:'center',fontFamily:'monospace'}}>
            {from.split('-').reverse().join('.')} — {to.split('-').reverse().join('.')} · <strong style={{color:'#f97316'}}>{stats.total}</strong> comenzi
          </span>
        </div>

        <Section title="Sumar general"/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:8}}>
          <KPI icon="📦" label="Total comenzi"    value={fmtInt(stats.total)}    color="#f97316" pct={100}/>
          <KPI icon="✅" label="Livrate"           value={fmtInt(stats.livrate)}  color="#10b981" pct={stats.rataLivrare} sub={`după data livrării · ${stats.rataLivrare}%`}/>
          <KPI icon="🚚" label="În tranzit"        value={fmtInt(stats.tranzit)}  color="#3b82f6" pct={stats.total?stats.tranzit/stats.total*100:0}/>
          <KPI icon="↩️" label="Retururi"          value={fmtInt(stats.retururi)} color="#f43f5e" pct={stats.rataRetur} sub={`${stats.rataRetur}% rată retur`}/>
          <KPI icon="❌" label="Anulate"           value={fmtInt(stats.anulate)}  color="#4a5568" pct={stats.total?stats.anulate/stats.total*100:0}/>
          <KPI icon="⏳" label="Neexpediate"       value={fmtInt(stats.pending)}  color="#f59e0b" pct={stats.total?stats.pending/stats.total*100:0}/>
        </div>

        <Section title="Financiar"/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10,marginBottom:8}}>
          <div style={{background:'#0d1520',border:'1px solid #10b981',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Încasat (livrate)</div>
            <div style={{fontSize:26,fontWeight:800,color:'#10b981'}}>{fmt(stats.sumLivrate)} <span style={{fontSize:13}}>RON</span></div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>din {stats.livrate} comenzi livrate · avg {fmt(stats.avgOrder)} RON</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #f59e0b',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>COD ramburs</div>
            <div style={{fontSize:26,fontWeight:800,color:'#f59e0b'}}>{fmt(stats.sumCOD)} <span style={{fontSize:13}}>RON</span></div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>{stats.codCount} comenzi COD</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #3b82f6',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Shopify Payments</div>
            <div style={{fontSize:26,fontWeight:800,color:'#3b82f6'}}>{fmt(stats.sumOnline)} <span style={{fontSize:13}}>RON</span></div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>{stats.onlineCount} comenzi card · toate din perioadă</div>
          </div>
          {stats.sumRetur > 0 && (
            <div style={{background:'#0d1520',border:'1px solid #f43f5e',borderRadius:12,padding:'16px 18px'}}>
              <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Pierdut retur</div>
              <div style={{fontSize:26,fontWeight:800,color:'#f43f5e'}}>{fmt(stats.sumRetur)} <span style={{fontSize:13}}>RON</span></div>
              <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>{stats.retururi} retururi</div>
            </div>
          )}
        </div>

        <div style={{background:'rgba(59,130,246,.06)',border:'1px solid rgba(59,130,246,.2)',borderRadius:10,padding:'10px 14px',marginBottom:10,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'#3b82f6'}}>💳 Comision Shopify Payments:</span>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <input type="number" step="0.01" min="0" max="10" value={shopifyFeePercent}
              onChange={e=>{const v=parseFloat(e.target.value)||0;setShopifyFeePercent(v);try{localStorage.setItem('sp_fee_pct',String(v));}catch{}}}
              style={{width:60,background:'#161d24',border:'1px solid #3b82f6',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:12,outline:'none',textAlign:'center'}}/>
            <span style={{fontSize:11,color:'#94a3b8'}}>%</span>
            <span style={{fontSize:11,color:'#4a5568'}}>+</span>
            <input type="number" step="0.01" min="0" value={shopifyFeeFixed}
              onChange={e=>{const v=parseFloat(e.target.value)||0;setShopifyFeeFixed(v);try{localStorage.setItem('sp_fee_fix',String(v));}catch{}}}
              style={{width:60,background:'#161d24',border:'1px solid #3b82f6',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:12,outline:'none',textAlign:'center'}}/>
            <span style={{fontSize:11,color:'#94a3b8'}}>RON fix</span>
          </div>
          <span style={{fontSize:10,color:'#4a5568'}}>ex: 399 × (1-{shopifyFeePercent}%) = {fmt(399*(1-shopifyFeePercent/100)-shopifyFeeFixed)} RON net</span>
        </div>

        <Section title="De încasat"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
          {(stats.workDays||[]).slice(0,2).map((dateStr, idx) => {
            const p = stats.previziuni?.[dateStr] || {gls:0,sameday:0,shopify:0,total:0};
            const dayLabel = (stats.workDayLabels||[])[idx] || dateStr;
            const label = idx===0 ? '⏰ De încasat AZI' : `📅 ${dayLabel}`;
            const color = idx===0 ? '#a855f7' : '#10b981';
            return (
              <div key={dateStr} style={{background:'#0d1520',border:`1px solid ${color}`,borderRadius:12,padding:'14px 16px'}}>
                <div style={{fontSize:10,color,textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>{label}</div>
                <div style={{fontSize:24,fontWeight:800,color,marginBottom:8}}>{fmt(p.total)} <span style={{fontSize:12}}>RON</span></div>
                {p.gls>0     && <div style={{fontSize:11,color:'#94a3b8',marginBottom:3}}>📦 GLS: <strong style={{color:'#f97316'}}>{fmt(p.gls)} RON</strong></div>}
                {p.sameday>0 && <div style={{fontSize:11,color:'#94a3b8',marginBottom:3}}>🚀 SD: <strong style={{color:'#3b82f6'}}>{fmt(p.sameday)} RON</strong></div>}
                {p.shopify>0 && <div style={{fontSize:11,color:'#94a3b8',marginBottom:3}}>💳 Card: <strong style={{color:'#a855f7'}}>{fmt(p.shopify)} RON</strong></div>}
                {p.total===0 && <div style={{fontSize:11,color:'#4a5568'}}>Nimic programat</div>}
              </div>
            );
          })}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:10}}>
          <div style={{background:'#0d1520',border:'1px solid #f97316',borderRadius:12,padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>📦 GLS Total</div>
            <div style={{fontSize:22,fontWeight:800,color:'#f97316'}}>{fmt(stats.totalGLS||0)} <span style={{fontSize:11}}>RON</span></div>
            <div style={{fontSize:10,color:'#4a5568',marginTop:3}}>ramburs COD livrate</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #3b82f6',borderRadius:12,padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#3b82f6',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>🚀 Sameday Total</div>
            <div style={{fontSize:22,fontWeight:800,color:'#3b82f6'}}>{fmt(stats.totalSameday||0)} <span style={{fontSize:11}}>RON</span></div>
            <div style={{fontSize:10,color:'#4a5568',marginTop:3}}>ramburs COD livrate</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #a855f7',borderRadius:12,padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#a855f7',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>💳 Shopify Payments</div>
            <div style={{fontSize:22,fontWeight:800,color:'#a855f7'}}>{fmt(stats.totalShopify||0)} <span style={{fontSize:11}}>RON</span></div>
            <div style={{fontSize:10,color:'#4a5568',marginTop:3}}>brut: {fmt(stats.totalShopifyBrut||0)} · comision: {fmt((stats.totalShopifyBrut||0)-(stats.totalShopify||0))} RON</div>
          </div>
          {(stats.workDays||[]).slice(2).some(d=>(stats.previziuni?.[d]?.total||0)>0) && (
            <div style={{background:'#0d1520',border:'1px solid #f59e0b',borderRadius:12,padding:'14px 16px'}}>
              <div style={{fontSize:10,color:'#f59e0b',textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>📆 Următoarele zile</div>
              {(stats.workDays||[]).slice(2).map((dateStr,idx)=>{
                const p=stats.previziuni?.[dateStr]||{gls:0,sameday:0,shopify:0,total:0};
                const label=(stats.workDayLabels||[])[idx+2]||dateStr;
                if(p.total===0) return null;
                return (
                  <div key={dateStr} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid #1a2535'}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:600,color:'#e2e8f0'}}>{label}</div>
                      <div style={{fontSize:10,color:'#475569',display:'flex',gap:8,marginTop:1}}>
                        {p.gls>0&&<span>📦 {fmt(p.gls)}</span>}
                        {p.sameday>0&&<span>🚀 {fmt(p.sameday)}</span>}
                        {p.shopify>0&&<span>💳 {fmt(p.shopify)}</span>}
                      </div>
                    </div>
                    <div style={{fontSize:15,fontWeight:800,color:'#f59e0b'}}>{fmt(p.total)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Section title="Istoric încasări pe zile"/>
        <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,overflow:'hidden',marginBottom:10}}>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'#161d24'}}>
                  {['Data încasare','Colete','📦 GLS','🚀 Sameday','💳 Shopify','Total'].map(h=>(
                    <th key={h} style={{padding:'8px 12px',textAlign:'right',fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(stats.incasariList||[]).length===0 ? (
                  <tr><td colSpan={6} style={{padding:20,textAlign:'center',color:'#4a5568'}}>Nicio livrare în perioada selectată</td></tr>
                ) : (stats.incasariList||[]).map(([zi,v])=>(
                  <tr key={zi} style={{borderTop:'1px solid #1e2a35'}}>
                    <td style={{padding:'8px 12px',color:'#e8edf2',fontFamily:'monospace',fontWeight:500}}>{zi.split('-').reverse().join('.')}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:'#94a3b8'}}>{v.count}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:v.gls>0?'#f97316':'#4a5568',fontFamily:'monospace'}}>{v.gls>0?fmt(v.gls)+' RON':'—'}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:v.sameday>0?'#3b82f6':'#4a5568',fontFamily:'monospace'}}>{v.sameday>0?fmt(v.sameday)+' RON':'—'}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:v.shopify>0?'#a855f7':'#4a5568',fontFamily:'monospace'}}>{v.shopify>0?fmt(v.shopify)+' RON':'—'}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:'#10b981',fontFamily:'monospace',fontWeight:700}}>{fmt(v.total)} RON</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <Section title="Curier"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8}}>
          {[{id:'gls',label:'📦 GLS',color:'#f97316',liv:stats.glsLiv,ret:stats.glsRet},{id:'sameday',label:'🚀 Sameday',color:'#3b82f6',liv:stats.sdLiv,ret:stats.sdRet}].map(({id,label,color,liv,ret})=>(
            <div key={id} style={{background:'#0d1520',border:`1px solid ${color}`,borderRadius:12,padding:'16px 18px'}}>
              <div style={{fontSize:12,color,fontWeight:700,marginBottom:12,fontFamily:'monospace'}}>{label}</div>
              {[['Livrate în perioadă',liv,'#e8edf2'],['✅ Livrate',liv,'#10b981'],['↩️ Returnate',ret,'#f43f5e']].map(([l,v,c])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                  <span style={{fontSize:12,color:'#94a3b8'}}>{l}</span>
                  <span style={{fontSize:13,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <Section title="Metode de plată"/>
        <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,padding:'16px 18px',marginBottom:8}}>
          <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
            {[{label:'💵 COD / Ramburs',count:stats.codCount,color:'#f59e0b'},{label:'💳 Shopify Payments',count:stats.onlineCount,color:'#3b82f6'}].map(({label,count,color})=>(
              <div key={label} style={{flex:1,minWidth:120,background:`rgba(${color==='#f59e0b'?'245,158,11':'59,130,246'},.1)`,border:`1px solid rgba(${color==='#f59e0b'?'245,158,11':'59,130,246'},.3)`,borderRadius:8,padding:'10px 14px'}}>
                <div style={{fontSize:10,color,textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>{label}</div>
                <div style={{fontSize:22,fontWeight:800,color}}>{count}</div>
                <div style={{fontSize:10,color:'#4a5568'}}>{stats.total?Math.round(count/stats.total*100):0}% din comenzi</div>
              </div>
            ))}
          </div>
          <div style={{height:8,background:'#1e2a35',borderRadius:4,overflow:'hidden',display:'flex'}}>
            <div style={{width:`${stats.total?stats.codCount/stats.total*100:0}%`,background:'#f59e0b'}}/>
            <div style={{flex:1,background:'#3b82f6'}}/>
          </div>
        </div>

        <Section title="Sursă trafic (UTM)"/>
        <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,padding:'16px 18px',marginBottom:8}}>
          {stats.sourceList.length===0 ? (
            <div style={{fontSize:12,color:'#4a5568',textAlign:'center',padding:'20px 0'}}>Nu există date UTM.</div>
          ) : stats.sourceList.map(([src,count])=>{
            const icons={'Facebook':'📘','TikTok':'🎵','Google':'🔍','Instagram':'📸','Email':'📧','Direct':'🏠','Referral':'🔗'};
            const colors={'Facebook':'#1877f2','TikTok':'#ff0050','Google':'#ea4335','Instagram':'#e1306c','Email':'#10b981','Direct':'#94a3b8','Referral':'#a855f7'};
            const color=colors[src]||'#f97316';
            const pct=stats.total?count/stats.total*100:0;
            return (
              <div key={src} style={{marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                  <span style={{fontSize:14}}>{icons[src]||'🌐'}</span>
                  <span style={{fontSize:12,color:'#e8edf2',flex:1,fontWeight:500}}>{src}</span>
                  <span style={{fontSize:12,fontFamily:'monospace',color,fontWeight:700}}>{count}</span>
                  <span style={{fontSize:10,color:'#4a5568',width:36,textAlign:'right'}}>{Math.round(pct)}%</span>
                </div>
                <div style={{height:4,background:'#1e2a35',borderRadius:2,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${pct}%`,background:color,borderRadius:2,transition:'width 1s'}}/>
                </div>
              </div>
            );
          })}
        </div>

        {stats.topProd && (
          <>
            <Section title="Top produse vândute"/>
            <div style={{background:'linear-gradient(135deg,#0d1520 0%,#111c2b 100%)',border:'1px solid #f97316',borderRadius:12,padding:'18px 20px',marginBottom:10}}>
              <div style={{display:'flex',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>🏆 Cel mai vândut</div>
                  <div style={{fontSize:16,fontWeight:700,color:'#e8edf2',lineHeight:1.3,marginBottom:4}}>{stats.topProd.name}</div>
                  {stats.topProd.sku&&<div style={{fontSize:11,color:'#4a5568',fontFamily:'monospace'}}>SKU: {stats.topProd.sku}</div>}
                </div>
                <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                  {[{v:fmtInt(stats.topProd.qty),l:'buc vândute',c:'#f97316'},{v:fmt(stats.avgPrice),l:'RON preț mediu',c:'#10b981'},{v:fmt(stats.topProd.revenue),l:'RON total',c:'#f59e0b'}].map(({v,l,c})=>(
                    <div key={l} style={{textAlign:'center'}}>
                      <div style={{fontSize:28,fontWeight:800,color:c}}>{v}</div>
                      <div style={{fontSize:10,color:'#94a3b8'}}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {stats.prodList.length>1&&(
              <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,overflow:'hidden'}}>
                <div style={{padding:'10px 16px',borderBottom:'1px solid #1e2a35',fontSize:12,fontWeight:700}}>Top 10 produse</div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#161d24'}}>
                        {['#','Produs','SKU','Buc','Preț mediu','Total'].map(h=>(
                          <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.prodList.map((p,i)=>(
                        <tr key={i} style={{borderTop:'1px solid #1e2a35'}}>
                          <td style={{padding:'8px 12px',color:i===0?'#f97316':'#4a5568',fontWeight:700}}>{i+1}</td>
                          <td style={{padding:'8px 12px',color:'#e8edf2',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={p.name}>{p.name}</td>
                          <td style={{padding:'8px 12px',color:'#4a5568',fontFamily:'monospace',fontSize:11}}>{p.sku||'—'}</td>
                          <td style={{padding:'8px 12px',color:i===0?'#f97316':'#10b981',fontWeight:700,fontFamily:'monospace'}}>{fmtInt(p.qty)}</td>
                          <td style={{padding:'8px 12px',color:'#94a3b8',fontFamily:'monospace'}}>{fmt(p.revenue/p.qty)} RON</td>
                          <td style={{padding:'8px 12px',color:'#f59e0b',fontFamily:'monospace',fontWeight:600}}>{fmt(p.revenue)} RON</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

