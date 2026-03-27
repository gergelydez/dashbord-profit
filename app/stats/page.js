'use client';
import { useState, useEffect, useMemo } from 'react';

const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
};

const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fmt = n => Number(n||0).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtInt = n => Number(n||0).toLocaleString('ro-RO');

const ONLINE_GW = ['shopify_payments','stripe','paypal'];
const isOnlinePayment = (o, onlineIds=[]) => {
  if (onlineIds.includes(String(o.id))) return true;
  const gw = (o.gateway||'').toLowerCase();
  if (gw) return ONLINE_GW.some(g => gw.includes(g));
  if (o.fin === 'pending') return false;
  return false;
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
  const [shopifyAnalytics, setShopifyAnalytics] = useState(() => {
    try { return JSON.parse(ls.get('shopify_analytics')||'null'); } catch { return null; }
  });

  useEffect(() => {
    const saved = ls.get('gx_orders_all');
    if (saved) {
      try {
        setAllOrders(JSON.parse(saved));
        const ts = ls.get('gx_fetch_time');
        if (ts) setLastFetch(new Date(ts));
      } catch {}
    }
  }, []);

  const [from, to] = useMemo(() => {
    const p = PRESETS.find(p => p.id === preset);
    return p ? p.from() : PRESETS[3].from();
  }, [preset]);

  const orders = useMemo(() => {
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');
    return allOrders.filter(o => {
      const c = new Date(o.createdAt);
      return c >= fromD && c <= toD;
    });
  }, [allOrders, from, to]);

  const stats = useMemo(() => {
    const total    = orders.length;
    const livrate  = orders.filter(o => o.ts === 'livrat');
    const retururi = orders.filter(o => o.ts === 'retur');
    const anulate  = orders.filter(o => o.ts === 'anulat');
    const tranzit  = orders.filter(o => ['incurs','outfor'].includes(o.ts));
    const pending  = orders.filter(o => o.ts === 'pending');

    const gls      = orders.filter(o => o.courier === 'gls');
    const sameday  = orders.filter(o => o.courier === 'sameday');

    const glsLiv   = gls.filter(o => o.ts === 'livrat');
    const sdLiv    = sameday.filter(o => o.ts === 'livrat');
    const glsRet   = gls.filter(o => o.ts === 'retur');
    const sdRet    = sameday.filter(o => o.ts === 'retur');

    const codOrders    = orders.filter(o => !isOnlinePayment(o, onlineIds));
    const onlineOrders = orders.filter(o =>  isOnlinePayment(o, onlineIds));

    const sumLivrate  = livrate.reduce((a,o)=>a+o.total,0);
    const sumCOD      = codOrders.filter(o=>o.ts==='livrat').reduce((a,o)=>a+o.total,0);
    const sumOnline   = onlineOrders.filter(o=>o.ts==='livrat').reduce((a,o)=>a+o.total,0);
    const sumRetur    = retururi.reduce((a,o)=>a+o.total,0);
    const sumTranzit  = tranzit.reduce((a,o)=>a+o.total,0);
    const totalRevenue= orders.reduce((a,o)=>a+o.total,0);

    // Produse — count qty per SKU/name
    const prodMap = {};
    orders.forEach(o => {
      (o.items||[]).forEach(item => {
        const key = item.sku || item.name;
        if (!key) return;
        if (!prodMap[key]) prodMap[key] = { name: item.name, sku: item.sku, qty: 0, revenue: 0, prices: [] };
        prodMap[key].qty     += item.qty || 1;
        prodMap[key].revenue += (item.price || 0) * (item.qty || 1);
        prodMap[key].prices.push(item.price || 0);
      });
    });

    const prodList = Object.values(prodMap).sort((a,b) => b.qty - a.qty);
    const topProd  = prodList[0] || null;
    const avgPrice = topProd ? topProd.revenue / topProd.qty : 0;

    // Attribution — detectează sursa din UTM sau referrer
    const detectSource = (o) => {
      const utm = (o.utmSource || '').toLowerCase();
      const ref = (o.referrerUrl || '').toLowerCase();
      const med = (o.utmMedium || '').toLowerCase();

      if (utm.includes('facebook') || utm.includes('fb') || ref.includes('facebook.com') || ref.includes('fb.com')) return 'Facebook';
      if (utm.includes('tiktok') || utm.includes('tik_tok') || ref.includes('tiktok.com')) return 'TikTok';
      if (utm.includes('google') || ref.includes('google.com') || med.includes('cpc')) return 'Google';
      if (utm.includes('instagram') || ref.includes('instagram.com')) return 'Instagram';
      if (utm.includes('youtube') || ref.includes('youtube.com')) return 'YouTube';
      if (utm.includes('email') || med.includes('email')) return 'Email';
      if (ref && !ref.includes('glamx') && !ref.includes('myshopify')) return 'Referral';
      if (!utm && !ref) return 'Direct';
      return utm || 'Altul';
    };

    const sourceMap = {};
    orders.forEach(o => {
      const src = detectSource(o);
      sourceMap[src] = (sourceMap[src] || 0) + 1;
    });
    const sourceList = Object.entries(sourceMap).sort((a,b) => b[1]-a[1]);

    const rataLivrare = total ? Math.round(livrate.length / total * 100) : 0;
    const rataRetur   = total ? Math.round(retururi.length / total * 100) : 0;
    const avgOrder    = total ? totalRevenue / total : 0;

    return {
      total, livrate: livrate.length, retururi: retururi.length,
      sourceList,
      anulate: anulate.length, tranzit: tranzit.length, pending: pending.length,
      gls: gls.length, sameday: sameday.length,
      glsLiv: glsLiv.length, sdLiv: sdLiv.length,
      glsRet: glsRet.length, sdRet: sdRet.length,
      codCount: codOrders.length, onlineCount: onlineOrders.length,
      sumLivrate, sumCOD, sumOnline, sumRetur, sumTranzit, totalRevenue,
      rataLivrare, rataRetur, avgOrder,
      topProd, avgPrice, prodList: prodList.slice(0, 10),
    };
  }, [orders, onlineIds]);

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

        {/* HEADER */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20,paddingBottom:16,borderBottom:'1px solid #1e2a35',flexWrap:'wrap'}}>
          <div style={{background:'#f97316',color:'#fff',fontWeight:800,fontSize:14,padding:'6px 10px',borderRadius:8}}>GLAMX</div>
          <div>
            <div style={{fontSize:18,fontWeight:700}}>Statistici</div>
            <div style={{fontSize:11,color:'#94a3b8'}}>{allOrders.length} comenzi în cache · {lastFetch?.toLocaleDateString('ro-RO')}</div>
          </div>
          <a href="/" style={{marginLeft:'auto',background:'#161d24',border:'1px solid #243040',color:'#94a3b8',padding:'5px 12px',borderRadius:20,fontSize:11,textDecoration:'none'}}>← Dashboard</a>
        </div>

        {/* PRESET FILTER */}
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:20}}>
          {PRESETS.map(p => (
            <button key={p.id}
              onClick={() => setPreset(p.id)}
              style={{background:preset===p.id?'#f97316':'#161d24',border:`1px solid ${preset===p.id?'#f97316':'#243040'}`,color:preset===p.id?'white':'#94a3b8',padding:'6px 14px',borderRadius:20,fontSize:11,cursor:'pointer',fontWeight:preset===p.id?600:400}}>
              {p.label}
            </button>
          ))}
          <span style={{marginLeft:'auto',fontSize:11,color:'#4a5568',alignSelf:'center',fontFamily:'monospace'}}>
            {from.split('-').reverse().join('.')} — {to.split('-').reverse().join('.')} · <strong style={{color:'#f97316'}}>{stats.total}</strong> comenzi
          </span>
        </div>

        {/* KPI PRINCIPALE */}
        <Section title="Sumar general"/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:8}}>
          <KPI icon="📦" label="Total comenzi"    value={fmtInt(stats.total)}    color="#f97316" pct={100}/>
          <KPI icon="✅" label="Livrate"           value={fmtInt(stats.livrate)}  color="#10b981" pct={stats.rataLivrare} sub={`${stats.rataLivrare}% din total`}/>
          <KPI icon="🚚" label="În tranzit"        value={fmtInt(stats.tranzit)}  color="#3b82f6" pct={stats.total?stats.tranzit/stats.total*100:0}/>
          <KPI icon="↩️" label="Retururi"          value={fmtInt(stats.retururi)} color="#f43f5e" pct={stats.rataRetur} sub={`${stats.rataRetur}% rată retur`}/>
          <KPI icon="❌" label="Anulate"           value={fmtInt(stats.anulate)}  color="#4a5568" pct={stats.total?stats.anulate/stats.total*100:0}/>
          <KPI icon="⏳" label="Neexpediate"       value={fmtInt(stats.pending)}  color="#f59e0b" pct={stats.total?stats.pending/stats.total*100:0}/>
        </div>

        {/* FINANCIAR */}
        <Section title="Financiar"/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10,marginBottom:8}}>
          <div style={{background:'#0d1520',border:'1px solid #f97316',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Total vânzări</div>
            <div style={{fontSize:26,fontWeight:800,color:'#f97316'}}>{fmt(stats.totalRevenue)} <span style={{fontSize:13}}>RON</span></div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>avg {fmt(stats.avgOrder)} RON / comandă</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #10b981',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Încasat (livrate)</div>
            <div style={{fontSize:26,fontWeight:800,color:'#10b981'}}>{fmt(stats.sumLivrate)} <span style={{fontSize:13}}>RON</span></div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>din {stats.livrate} comenzi livrate</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #f59e0b',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>COD ramburs</div>
            <div style={{fontSize:26,fontWeight:800,color:'#f59e0b'}}>{fmt(stats.sumCOD)} <span style={{fontSize:13}}>RON</span></div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>{stats.codCount} comenzi COD</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #3b82f6',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Shopify Payments</div>
            <div style={{fontSize:26,fontWeight:800,color:'#3b82f6'}}>{fmt(stats.sumOnline)} <span style={{fontSize:13}}>RON</span></div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>{stats.onlineCount} comenzi card</div>
          </div>
          {stats.sumRetur > 0 && (
            <div style={{background:'#0d1520',border:'1px solid #f43f5e',borderRadius:12,padding:'16px 18px'}}>
              <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Pierdut retur</div>
              <div style={{fontSize:26,fontWeight:800,color:'#f43f5e'}}>{fmt(stats.sumRetur)} <span style={{fontSize:13}}>RON</span></div>
              <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>{stats.retururi} retururi</div>
            </div>
          )}
        </div>

        {/* CURIER BREAKDOWN */}
        <Section title="Curier"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8}}>
          {/* GLS */}
          <div style={{background:'#0d1520',border:'1px solid #f97316',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:12,color:'#f97316',fontWeight:700,marginBottom:12,fontFamily:'monospace'}}>📦 GLS</div>
            {[
              ['Total expediate', stats.gls,    '#e8edf2'],
              ['✅ Livrate',       stats.glsLiv, '#10b981'],
              ['↩️ Returnate',    stats.glsRet, '#f43f5e'],
            ].map(([l,v,c])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <span style={{fontSize:12,color:'#94a3b8'}}>{l}</span>
                <span style={{fontSize:13,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</span>
              </div>
            ))}
            {stats.gls > 0 && <Bar pct={stats.glsLiv/stats.gls*100} color="#10b981"/>}
            {stats.gls > 0 && <div style={{fontSize:10,color:'#4a5568',marginTop:4}}>
              {Math.round(stats.glsLiv/stats.gls*100)}% livrare · {Math.round(stats.glsRet/stats.gls*100)}% retur
            </div>}
          </div>

          {/* SAMEDAY */}
          <div style={{background:'#0d1520',border:'1px solid #3b82f6',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:12,color:'#3b82f6',fontWeight:700,marginBottom:12,fontFamily:'monospace'}}>🚀 Sameday</div>
            {[
              ['Total expediate', stats.sameday, '#e8edf2'],
              ['✅ Livrate',       stats.sdLiv,   '#10b981'],
              ['↩️ Returnate',    stats.sdRet,   '#f43f5e'],
            ].map(([l,v,c])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <span style={{fontSize:12,color:'#94a3b8'}}>{l}</span>
                <span style={{fontSize:13,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</span>
              </div>
            ))}
            {stats.sameday > 0 && <Bar pct={stats.sdLiv/stats.sameday*100} color="#10b981"/>}
            {stats.sameday > 0 && <div style={{fontSize:10,color:'#4a5568',marginTop:4}}>
              {Math.round(stats.sdLiv/stats.sameday*100)}% livrare · {Math.round(stats.sdRet/stats.sameday*100)}% retur
            </div>}
          </div>
        </div>

        {/* PLATĂ BREAKDOWN */}
        <Section title="Metode de plată"/>
        <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,padding:'16px 18px',marginBottom:8}}>
          <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:120,background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.3)',borderRadius:8,padding:'10px 14px'}}>
              <div style={{fontSize:10,color:'#f59e0b',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>💵 COD / Ramburs</div>
              <div style={{fontSize:22,fontWeight:800,color:'#f59e0b'}}>{stats.codCount}</div>
              <div style={{fontSize:10,color:'#4a5568'}}>{stats.total?Math.round(stats.codCount/stats.total*100):0}% din comenzi</div>
            </div>
            <div style={{flex:1,minWidth:120,background:'rgba(59,130,246,.1)',border:'1px solid rgba(59,130,246,.3)',borderRadius:8,padding:'10px 14px'}}>
              <div style={{fontSize:10,color:'#3b82f6',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>💳 Shopify Payments</div>
              <div style={{fontSize:22,fontWeight:800,color:'#3b82f6'}}>{stats.onlineCount}</div>
              <div style={{fontSize:10,color:'#4a5568'}}>{stats.total?Math.round(stats.onlineCount/stats.total*100):0}% din comenzi</div>
            </div>
          </div>
          {/* Progress bar COD vs Card */}
          <div style={{height:8,background:'#1e2a35',borderRadius:4,overflow:'hidden',display:'flex'}}>
            <div style={{width:`${stats.total?stats.codCount/stats.total*100:0}%`,background:'#f59e0b',transition:'width 1s'}}/>
            <div style={{flex:1,background:'#3b82f6'}}/>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:10,color:'#4a5568'}}>
            <span>COD {stats.total?Math.round(stats.codCount/stats.total*100):0}%</span>
            <span>Card {stats.total?Math.round(stats.onlineCount/stats.total*100):0}%</span>
          </div>
        </div>

        {/* FUNNEL CONVERSIE */}
        <Section title="Funnel conversie"/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:8}}>
          {[
            { label:'Total comenzi', val: stats.total, icon:'🛍️', color:'#f97316', note:'în perioada selectată' },
            { label:'Livrate', val: stats.livrate, icon:'✅', color:'#10b981', note:`${stats.rataLivrare}% rată livrare` },
            { label:'Retururi', val: stats.retururi, icon:'↩️', color:'#f43f5e', note:`${stats.rataRetur}% rată retur` },
            { label:'COD', val: stats.codCount, icon:'💵', color:'#f59e0b', note:`${stats.total?Math.round(stats.codCount/stats.total*100):0}% din comenzi` },
            { label:'Shopify Payments', val: stats.onlineCount, icon:'💳', color:'#3b82f6', note:`${stats.total?Math.round(stats.onlineCount/stats.total*100):0}% din comenzi` },
          ].map(({label,val,icon,color,note}) => (
            <div key={label} style={{background:'#0d1520',border:`1px solid ${color}44`,borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:color}}/>
              <div style={{fontSize:18,marginBottom:4}}>{icon}</div>
              <div style={{fontSize:22,fontWeight:800,color,lineHeight:1}}>{fmtInt(val)}</div>
              <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{label}</div>
              <div style={{fontSize:10,color:'#4a5568',marginTop:2}}>{note}</div>
            </div>
          ))}
        </div>

        {/* ATTRIBUTION */}
        <Section title="Sursă trafic (UTM)"/>
        <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,padding:'16px 18px',marginBottom:8}}>
          {stats.sourceList.length === 0 ? (
            <div style={{fontSize:12,color:'#4a5568',textAlign:'center',padding:'20px 0'}}>
              Nu există date UTM. Adaugă parametri UTM la link-urile de marketing.
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {stats.sourceList.map(([src, count]) => {
                const icons = {'Facebook':'📘','TikTok':'🎵','Google':'🔍','Instagram':'📸','YouTube':'▶️','Email':'📧','Direct':'🏠','Referral':'🔗'};
                const colors = {'Facebook':'#1877f2','TikTok':'#ff0050','Google':'#ea4335','Instagram':'#e1306c','YouTube':'#ff0000','Email':'#10b981','Direct':'#94a3b8','Referral':'#a855f7'};
                const color = colors[src] || '#f97316';
                const pct   = stats.total ? count/stats.total*100 : 0;
                return (
                  <div key={src}>
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
          )}
        </div>

        {/* TOP PRODUSE */}
        <Section title="Top produse vândute"/>
        {stats.topProd && (
          <div style={{background:'linear-gradient(135deg,#0d1520 0%,#111c2b 100%)',border:'1px solid #f97316',borderRadius:12,padding:'18px 20px',marginBottom:10}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
              <div style={{flex:1,minWidth:200}}>
                <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>🏆 Cel mai vândut produs</div>
                <div style={{fontSize:16,fontWeight:700,color:'#e8edf2',lineHeight:1.3,marginBottom:4}}>{stats.topProd.name}</div>
                {stats.topProd.sku && <div style={{fontSize:11,color:'#4a5568',fontFamily:'monospace'}}>SKU: {stats.topProd.sku}</div>}
              </div>
              <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                <div style={{textAlign:'center'}}>
                  <div style={{fontSize:28,fontWeight:800,color:'#f97316'}}>{fmtInt(stats.topProd.qty)}</div>
                  <div style={{fontSize:10,color:'#94a3b8'}}>buc vândute</div>
                </div>
                <div style={{textAlign:'center'}}>
                  <div style={{fontSize:28,fontWeight:800,color:'#10b981'}}>{fmt(stats.avgPrice)}</div>
                  <div style={{fontSize:10,color:'#94a3b8'}}>RON preț mediu</div>
                </div>
                <div style={{textAlign:'center'}}>
                  <div style={{fontSize:28,fontWeight:800,color:'#f59e0b'}}>{fmt(stats.topProd.revenue)}</div>
                  <div style={{fontSize:10,color:'#94a3b8'}}>RON total</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TABEL TOP 10 PRODUSE */}
        {stats.prodList.length > 1 && (
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

      </div>
    </div>
  );
}

