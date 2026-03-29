'use client';
import { useState, useEffect, useMemo } from 'react';

const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
};

// Tracking overrides — statusuri confirmate de GLS API (localStorage fallback)
const trackingOverridesLocal = {
  get: () => { try { const s = typeof window!=='undefined'?localStorage.getItem('gx_track_ov'):null; return s?JSON.parse(s):{}; } catch { return {}; } },
};

function applyTrackingOverrides(orders, serverOverrides = null) {
  // Prioritate: server (Redis) > localStorage
  const localOv = trackingOverridesLocal.get();
  const ov = serverOverrides ? { ...localOv, ...serverOverrides } : localOv;
  if (!Object.keys(ov).length) return orders;
  return orders.map(o => {
    const override = ov[o.id];
    if (!override) return o;
    return { ...o, ts: override.ts,
      trackingStatus: override.statusRaw || o.trackingStatus,
      trackingLastUpdate: override.lastUpdate || o.trackingLastUpdate,
    };
  });
}

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

// getFinalStatus — identic cu Dashboard: GLS Excel > tracking overrides (în o.ts) > Shopify
function getGlsStatusFinal(o, glsAwbMap) {
  const awb = (o.trackingNo || '').trim();
  if (awb && glsAwbMap[awb]) return glsAwbMap[awb];
  return o.ts;
}
function getSdStatusFn(o, sdAwbMap) {
  const awb = (o.trackingNo || '').trim();
  if (awb && sdAwbMap[awb]) return sdAwbMap[awb];
  return o.ts !== 'pending' ? o.ts : null;
}
function getFinalStatus(o, glsAwbMap, sdAwbMap) {
  if (o.courier === 'gls')     return getGlsStatusFinal(o, glsAwbMap);
  if (o.courier === 'sameday') return getSdStatusFn(o, sdAwbMap) || o.ts;
  return o.ts;
}

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
  const [serverOverrides, setServerOverrides] = useState(null); // Redis overrides
  const [onlineIds] = useState(() => { try { return JSON.parse(ls.get('online_payment_ids')||'[]'); } catch { return []; }});
  const [sdAwbMap]  = useState(() => { try { return JSON.parse(ls.get('sd_awb_map')||'{}'); } catch { return {}; }});
  const [glsAwbMap] = useState(() => { try { return JSON.parse(ls.get('gls_awb_map')||'{}'); } catch { return {}; }});
  // Comision Shopify Payments: procent + sumă fixă per tranzacție
  const [shopifyFeePercent, setShopifyFeePercent] = useState(() => parseFloat(ls.get('sp_fee_pct') || '1.9'));
  const [shopifyFeeFixed, setShopifyFeeFixed]     = useState(() => parseFloat(ls.get('sp_fee_fix') || '1.25'));
  const [shopifyAnalytics, setShopifyAnalytics] = useState(() => {
    try { return JSON.parse(ls.get('shopify_analytics')||'null'); } catch { return null; }
  });

  // Fetch overrides din Redis la load, apoi aplică pe comenzi
  useEffect(() => {
    const loadData = async () => {
      const saved = ls.get('gx_orders_all');
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved);
        const ts = ls.get('gx_fetch_time');
        if (ts) setLastFetch(new Date(ts));

        // Fetch overrides din server (Redis) — mai fiabile decât localStorage
        let srvOv = null;
        try {
          const r = await fetch('/api/tracking-overrides');
          if (r.ok) {
            const d = await r.json();
            srvOv = d.overrides || null;
            if (srvOv) {
              setServerOverrides(srvOv);
              // Sincronizăm și în localStorage pentru offline
              try { localStorage.setItem('gx_track_ov', JSON.stringify({
                ...trackingOverridesLocal.get(), ...srvOv
              })); } catch {}
            }
          }
        } catch (e) { console.warn('[Stats] Nu pot fetcha overrides din server:', e.message); }

        setAllOrders(applyTrackingOverrides(parsed, srvOv));
      } catch {}
    };
    loadData();
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

  // getFinalStatus și getSdStatus — definite sus ca funcții pure (primesc map-urile ca parametri)

  const livrateInPeriod = useMemo(() => {
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');
    // allOrders are overrides aplicate deja
    // getFinalStatus aplică glsAwbMap/sdAwbMap — prioritate corectă
    return allOrders.filter(o => {
      if (getFinalStatus(o, glsAwbMap, sdAwbMap) !== 'livrat') return false;
      const livDate = o.fulfilledAt ? new Date(o.fulfilledAt) : new Date(o.createdAt);
      return livDate >= fromD && livDate <= toD;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOrders, serverOverrides, from, to, glsAwbMap, sdAwbMap]);

  const stats = useMemo(() => {
    const total    = orders.length;
    // livrate = folosim getFinalStatus — identic cu Dashboard (GLS Excel > overrides > Shopify)
    const livrate = livrateInPeriod.filter(o => getFinalStatus(o, glsAwbMap, sdAwbMap) === 'livrat');

    const fromD2 = new Date(from + 'T00:00:00');
    const toD2   = new Date(to   + 'T23:59:59');
    const retururi = allOrders.filter(o => {
      const isRetur = getFinalStatus(o, glsAwbMap, sdAwbMap) === 'retur';
      if (!isRetur) return false;
      const refDate = new Date(o.fulfilledAt || o.createdAt);
      return refDate >= fromD2 && refDate <= toD2;
    });
    const anulate  = orders.filter(o => getFinalStatus(o, glsAwbMap, sdAwbMap) === 'anulat');
    // allOrders are deja overrides aplicate — getFinalStatus aplică și glsAwbMap/sdAwbMap
    const tranzit  = allOrders.filter(o => ['incurs','outfor'].includes(getFinalStatus(o, glsAwbMap, sdAwbMap)));
    const pending  = allOrders.filter(o => getFinalStatus(o, glsAwbMap, sdAwbMap) === 'pending');

    // Courier breakdown din livrateInPeriod
    const gls      = livrateInPeriod.filter(o => o.courier === 'gls');
    const sameday  = livrateInPeriod.filter(o => o.courier === 'sameday');
    const glsAll   = orders.filter(o => o.courier === 'gls');
    const sdAll    = orders.filter(o => o.courier === 'sameday');

    const glsLiv   = gls.filter(o => getFinalStatus(o, glsAwbMap, sdAwbMap) === 'livrat').length;
    const sdLiv    = sameday.filter(o => getFinalStatus(o, glsAwbMap, sdAwbMap) === 'livrat').length;
    const glsRet   = retururi.filter(o => o.courier === 'gls').length;
    const sdRet    = retururi.filter(o => o.courier === 'sameday').length;

    const codOrders    = orders.filter(o => !isOnlinePayment(o, onlineIds));
    const onlineOrders = orders.filter(o =>  isOnlinePayment(o, onlineIds));

    // Financiar — calculat DOAR pe comenzile livrate
    const sumLivrate  = livrate.reduce((a,o)=>a+o.total,0);
    const sumCOD      = livrate.filter(o=>!isOnlinePayment(o,onlineIds)).reduce((a,o)=>a+o.total,0);
    // sumOnline = total brut din TOATE comenzile online din perioadă (livrate + nelivrate)
    // Card se încasează imediat la plasare, nu la livrare
    const sumOnlineAll = onlineOrders.reduce((a,o)=>a+o.total,0);
    const sumOnline   = sumOnlineAll; // afișăm toate comenzile card din perioadă
    const sumRetur    = retururi.reduce((a,o)=>a+o.total,0);
    const sumTranzit  = tranzit.reduce((a,o)=>a+o.total,0);
    const totalRevenue= sumCOD + sumOnline; // COD livrate + toate card-urile

    // Produse — doar din comenzile LIVRATE
    // Dacă prețul per item e 0 (nu e în cache), folosim totalul comenzii împărțit la nr. produse
    const prodMap = {};
    livrate.forEach(o => {
      const items = o.items || [];
      if (!items.length) return;
      const totalItems = items.reduce((s, i) => s + (i.qty || 1), 0);
      items.forEach(item => {
        const key = item.sku || item.name;
        if (!key) return;
        if (!prodMap[key]) prodMap[key] = { name: item.name, sku: item.sku || '', qty: 0, revenue: 0 };
        const qty = item.qty || 1;
        // Dacă avem preț real folosim acel, altfel împărțim totalul comenzii proporțional
        const unitPrice = (item.price && item.price > 0)
          ? item.price
          : (o.total / totalItems);
        prodMap[key].qty     += qty;
        prodMap[key].revenue += unitPrice * qty;
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
      const lp  = (o.landingPage || '').toLowerCase();
      const cam = (o.utmCampaign || '').toLowerCase();

      // Facebook: utm_source=facebook, referrer facebook.com, sau fbclid în landing page
      if (utm.includes('facebook') || utm.includes('fb') ||
          ref.includes('facebook.com') || ref.includes('fb.com') || ref.includes('l.facebook') ||
          lp.includes('fbclid') || cam.includes('facebook') || cam.includes('fb_')) return 'Facebook';

      // TikTok: utm_source=tiktok, referrer tiktok.com, sau ttclid
      if (utm.includes('tiktok') || utm.includes('tik_tok') ||
          ref.includes('tiktok.com') || lp.includes('ttclid') || cam.includes('tiktok')) return 'TikTok';

      // Google: utm_source=google, referrer google.com, gclid, sau cpc medium
      if (utm.includes('google') || ref.includes('google.com') ||
          lp.includes('gclid') || med.includes('cpc') || med.includes('ppc') ||
          cam.includes('google')) return 'Google';

      // Instagram: utm_source=instagram, referrer instagram.com
      if (utm.includes('instagram') || ref.includes('instagram.com')) return 'Instagram';

      // YouTube
      if (utm.includes('youtube') || ref.includes('youtube.com') || ref.includes('youtu.be')) return 'YouTube';

      // Email
      if (utm.includes('email') || med.includes('email') || med.includes('newsletter')) return 'Email';

      // SMS
      if (utm.includes('sms') || med.includes('sms')) return 'SMS';

      // Organic search (referrer google dar fără gclid)
      if (ref.includes('google.') || ref.includes('bing.com') || ref.includes('yahoo.com')) return 'Organic Search';

      // Direct sau fără date
      if (!utm && !ref && !lp) return 'Direct';

      // Alte referrals
      if (ref && !ref.includes('myshopify') && !ref.includes('glamxonline')) return 'Referral';

      return utm ? utm.charAt(0).toUpperCase() + utm.slice(1) : 'Direct';
    };

    const sourceMap = {};
    orders.forEach(o => {
      const src = detectSource(o);
      sourceMap[src] = (sourceMap[src] || 0) + 1;
    });
    const sourceList = Object.entries(sourceMap).sort((a,b) => b[1]-a[1]);

    const rataLivrare = total ? Math.round(livrate.length / total * 100) : 0;
    const rataRetur   = livrate.length ? Math.round(retururi.length / (livrate.length + retururi.length) * 100) : 0;
    const avgOrder    = livrate.length ? sumLivrate / livrate.length : 0;

    // ── Încasări pe zile ──
    // Calculează data REALĂ a încasării (nu data livrării):
    // GLS COD: livrare + 2 zile → banii intră în cont
    // Sameday COD: livrare + 1 zi
    // Shopify Payments: livrare + 2 zile (payout)
    // Adaugă N zile LUCRĂTOARE (L-V) — sâmbătă/duminică nu contează
    const addWorkDays = (str, n) => {
      if (!str) return '';
      const d = new Date(str + 'T12:00:00');
      let added = 0;
      while (added < n) {
        d.setDate(d.getDate() + 1);
        const day = d.getDay();
        if (day !== 0 && day !== 6) added++; // 0=dum, 6=sâm
      }
      const p = x => String(x).padStart(2,'0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
    };

    const incasariPerZi = {};
    const addToZi = (str, field, val, net) => {
      if (!str) return;
      if (!incasariPerZi[str]) incasariPerZi[str] = { gls:0, sameday:0, shopify:0, total:0, count:0 };
      incasariPerZi[str][field] += val;
      incasariPerZi[str].total  += net !== undefined ? net : val;
      incasariPerZi[str].count++;
    };

    // COD curierat — bazat pe data livrării
    livrateInPeriod.forEach(o => {
      const isOnline = isOnlinePayment(o, onlineIds);
      if (isOnline) return; // Shopify Payments separat
      if (o.courier === 'sameday' && getSdStatusFn(o, sdAwbMap) !== 'livrat') return;
      const livStr = (o.fulfilledAt || o.createdAt || '').slice(0,10);
      if (!livStr) return;
      if (o.courier === 'gls') {
        addToZi(addWorkDays(livStr, 2), 'gls', o.total);
      } else if (o.courier === 'sameday') {
        addToZi(addWorkDays(livStr, 1), 'sameday', o.total);
      } else {
        addToZi(addWorkDays(livStr, 2), 'gls', o.total);
      }
    });

    // Shopify Payments — bazat pe data PLASĂRII (createdAt) — toate comenzile card din perioadă
    onlineOrders.forEach(o => {
      const baseStr = (o.createdAt || '').slice(0,10);
      if (!baseStr) return;
      const net = o.total*(1-shopifyFeePercent/100)-shopifyFeeFixed;
      addToZi(addWorkDays(baseStr, 2), 'shopify', o.total, net);
    });
    const incasariList = Object.entries(incasariPerZi)
      .sort((a,b) => b[0].localeCompare(a[0]))
      .slice(0, 60);

    // ── Previziuni încasări azi și mâine ──
    const nowDate  = new Date();
    const todayStr = nowDate.toISOString().slice(0,10);
    const pad2 = n => String(n).padStart(2,'0');
    const addDays = (str, n) => {
      const d = new Date(str); d.setDate(d.getDate()+n);
      return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    };
    // ── Logică zile LUCRĂTOARE pentru încasări ──
    // Adaugă n zile lucrătoare (L-V) — sâmbătă/duminică nu se livrează, nu se numără
    // Joi +2 zile lucrătoare = Luni | Vineri +2 = Marți
    const nextBusinessDay = (str, plusWorkingDays) => {
      const d = new Date(str + 'T12:00:00');
      let added = 0;
      while (added < plusWorkingDays) {
        d.setDate(d.getDate() + 1);
        const day = d.getDay();
        if (day !== 0 && day !== 6) added++; // numărăm doar L-V
      }
      return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    };

    // Calculăm pentru azi + 4 zile lucrătoare viitoare
    const nextWorkDayStr = (n) => {
      const d = new Date(todayStr + 'T12:00:00');
      let added = 0;
      while (added < n) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) added++;
      }
      return d.toISOString().slice(0,10);
    };
    const workDays = [0,1,2,3,4].map(n => n === 0 ? todayStr : nextWorkDayStr(n));
    const workDayLabels = workDays.map(str => {
      const d = new Date(str + 'T12:00:00');
      const days = ['Dum','Lun','Mar','Mie','Joi','Vin','Sâm'];
      const months = ['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','nov','dec'];
      return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    });
    const previziuni = {};
    workDays.forEach(str => {
      previziuni[str] = {gls:0, sameday:0, shopify:0, total:0};
    });
    // Backward compat
    previziuni['azi'] = previziuni[workDays[0]];
    previziuni['maine'] = previziuni[workDays[1]];

    const addByDate = (dateStr, courier, val) => {
      if (previziuni[dateStr]) {
        previziuni[dateStr][courier] += val;
        previziuni[dateStr].total    += val;
      }
    };

    // COD (GLS + Sameday) — bazat pe data livrării
    livrateInPeriod.forEach(o => {
      const isOnline = isOnlinePayment(o, onlineIds);
      if (isOnline) return; // Shopify Payments se tratează separat mai jos
      if (o.courier === 'sameday' && getSdStatusFn(o, sdAwbMap) !== 'livrat') return;
      if (!o.fulfilledAt) return;
      const livStr = o.fulfilledAt.slice(0,10);

      if (o.courier === 'gls') {
        addByDate(nextBusinessDay(livStr, 2), 'gls', o.total);
      } else if (o.courier === 'sameday') {
        addByDate(nextBusinessDay(livStr, 1), 'sameday', o.total);
      }
    });

    // Shopify Payments — bazat pe data PLASĂRII comenzii (createdAt), nu livrare
    // Banii intră în cont după 2 zile lucrătoare de la plasare
    onlineOrders.forEach(o => {
      const baseStr = (o.createdAt || '').slice(0, 10);
      if (!baseStr) return;
      const net = o.total * (1 - shopifyFeePercent / 100) - shopifyFeeFixed;
      addByDate(nextBusinessDay(baseStr, 2), 'shopify', net);
    });

    // Total încasat GLS, Sameday, Shopify din livrate
    // Totaluri COD per curier (excludem Shopify Payments - nu sunt ramburs)
    // Total COD GLS = doar comenzi GLS plătite ramburs (excludem Shopify Payments/Card)
    const totalGLS     = livrate.filter(o=>o.courier==='gls' && !isOnlinePayment(o,onlineIds)).reduce((a,o)=>a+o.total,0);
    const totalSameday = livrate.filter(o=>o.courier==='sameday' && !isOnlinePayment(o,onlineIds)).reduce((a,o)=>a+o.total,0);
    // Card se încasează la plasare — includem TOATE comenzile card din perioadă (nu doar livrate)
    const totalShopify = onlineOrders.reduce((a,o)=>a+o.total*(1-shopifyFeePercent/100)-shopifyFeeFixed,0);
    const totalShopifyBrut = onlineOrders.reduce((a,o)=>a+o.total,0);

    return {
      total, livrate: livrate.length, retururi: retururi.length,
      sourceList,
      incasariList, previziuni, workDays, workDayLabels,
      totalGLS, totalSameday, totalShopify, totalShopifyBrut,
      anulate: anulate.length, tranzit: tranzit.length, pending: pending.length,
      gls: glsAll.length, sameday: sdAll.length,
      glsLiv, sdLiv, glsRet, sdRet,
      codCount: codOrders.length, onlineCount: onlineOrders.length,
      sumLivrate, sumCOD, sumOnline, sumRetur, sumTranzit, totalRevenue,
      rataLivrare, rataRetur, avgOrder,
      topProd, avgPrice, prodList: prodList.slice(0, 10),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, livrateInPeriod, onlineIds, sdAwbMap, glsAwbMap, shopifyFeePercent, shopifyFeeFixed, serverOverrides]);

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
          <KPI icon="✅" label="Livrate (după data livrării)" value={fmtInt(stats.livrate)} color="#10b981" pct={stats.rataLivrare} sub={`din care ${stats.total} plasate în perioadă`}/>
          <KPI icon="🚚" label="În tranzit"        value={fmtInt(stats.tranzit)}  color="#3b82f6" pct={stats.total?stats.tranzit/stats.total*100:0}/>
          <KPI icon="↩️" label="Retururi"          value={fmtInt(stats.retururi)} color="#f43f5e" pct={stats.rataRetur} sub={`${stats.rataRetur}% rată retur`}/>
          <KPI icon="❌" label="Anulate"           value={fmtInt(stats.anulate)}  color="#4a5568" pct={stats.total?stats.anulate/stats.total*100:0}/>
          <KPI icon="⏳" label="Neexpediate"       value={fmtInt(stats.pending)}  color="#f59e0b" pct={stats.total?stats.pending/stats.total*100:0}/>
        </div>

        {/* FINANCIAR */}
        <Section title="Financiar"/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10,marginBottom:8}}>
          <div style={{background:'#0d1520',border:'1px solid #f97316',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Încasat (livrate)</div>
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

        {/* SETARE COMISION SHOPIFY */}
        <div style={{background:'rgba(59,130,246,.06)',border:'1px solid rgba(59,130,246,.2)',borderRadius:10,padding:'10px 14px',marginBottom:10,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'#3b82f6'}}>💳 Comision Shopify Payments:</span>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <input type="number" step="0.01" min="0" max="10" value={shopifyFeePercent}
              onChange={e=>{const v=parseFloat(e.target.value)||0;setShopifyFeePercent(v);ls.set&&typeof ls.set==='function'&&ls.set('sp_fee_pct',String(v));}}
              style={{width:60,background:'#161d24',border:'1px solid #3b82f6',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:12,outline:'none',textAlign:'center'}}/>
            <span style={{fontSize:11,color:'#94a3b8'}}>%</span>
            <span style={{fontSize:11,color:'#4a5568'}}>+</span>
            <input type="number" step="0.01" min="0" value={shopifyFeeFixed}
              onChange={e=>{const v=parseFloat(e.target.value)||0;setShopifyFeeFixed(v);ls.set&&typeof ls.set==='function'&&ls.set('sp_fee_fix',String(v));}}
              style={{width:60,background:'#161d24',border:'1px solid #3b82f6',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:12,outline:'none',textAlign:'center'}}/>
            <span style={{fontSize:11,color:'#94a3b8'}}>RON fix</span>
          </div>
          <span style={{fontSize:10,color:'#4a5568'}}>ex: 399 × (1-{shopifyFeePercent}%) = {fmt(399*(1-shopifyFeePercent/100)-shopifyFeeFixed)} RON net</span>
        </div>

        {/* PREVIZIUNI ÎNCASĂRI — AZI + MÂINE + URMĂTOARELE ZILE */}
        <Section title="De încasat"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
          {(stats.workDays||[]).slice(0,2).map((dateStr, idx) => {
            const p = stats.previziuni?.[dateStr] || {gls:0,sameday:0,shopify:0,total:0};
            const dayLabel = (stats.workDayLabels||[])[idx] || dateStr;
            // Dacă idx=1 și e mai mult de 1 zi distanță față de azi (weekend între) → arătăm data reală
            const isNextWorkday = idx === 1;
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


        {/* TOTAL ÎNCASAT PE COURIER */}
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
          {/* Card Următoarele zile - lângă Shopify */}
          {(stats.workDays||[]).slice(2).some(d => (stats.previziuni?.[d]?.total||0) > 0) && (
            <div style={{background:'#0d1520',border:'1px solid #f59e0b',borderRadius:12,padding:'14px 16px'}}>
              <div style={{fontSize:10,color:'#f59e0b',textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>📆 Următoarele zile</div>
              {(stats.workDays||[]).slice(2).map((dateStr, idx) => {
                const p = stats.previziuni?.[dateStr] || {gls:0,sameday:0,shopify:0,total:0};
                const label = (stats.workDayLabels||[])[idx+2] || dateStr;
                if (p.total === 0) return null;
                return (
                  <div key={dateStr} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid #1a2535'}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:600,color:'#e2e8f0'}}>{label}</div>
                      <div style={{fontSize:10,color:'#475569',display:'flex',gap:8,marginTop:1}}>
                        {p.gls>0     && <span>📦 {fmt(p.gls)}</span>}
                        {p.sameday>0 && <span>🚀 {fmt(p.sameday)}</span>}
                        {p.shopify>0 && <span>💳 {fmt(p.shopify)}</span>}
                      </div>
                    </div>
                    <div style={{fontSize:15,fontWeight:800,color:'#f59e0b'}}>{fmt(p.total)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ÎNCASĂRI PE ZILE */}
        <Section title="Istoric încasări pe zile"/>
        <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,overflow:'hidden',marginBottom:10}}>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'#161d24'}}>
                  {['Data încasare','Colete','📦 GLS','🚀 Sameday','💳 Shopify','Total'].map(h=>(
                    <th key={h} style={{padding:'8px 12px',textAlign:h==='Data livrare'?'left':'right',fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(stats.incasariList||[]).length === 0 ? (
                  <tr><td colSpan={6} style={{padding:20,textAlign:'center',color:'#4a5568'}}>Nicio livrare în perioada selectată</td></tr>
                ) : (stats.incasariList||[]).map(([zi, v]) => (
                  <tr key={zi} style={{borderTop:'1px solid #1e2a35'}}>
                    <td style={{padding:'8px 12px',color:'#e8edf2',fontFamily:'monospace',fontWeight:500}}>
                      {zi.split('-').reverse().join('.')}
                    </td>
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

        {/* CURIER BREAKDOWN */}
        <Section title="Curier"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8}}>
          {/* GLS */}
          <div style={{background:'#0d1520',border:'1px solid #f97316',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:12,color:'#f97316',fontWeight:700,marginBottom:12,fontFamily:'monospace'}}>📦 GLS</div>
            {[
              ['Livrate în perioadă', stats.glsLiv, '#e8edf2'],
              ['✅ Livrate',       stats.glsLiv, '#10b981'],
              ['↩️ Returnate',    stats.glsRet, '#f43f5e'],
            ].map(([l,v,c])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <span style={{fontSize:12,color:'#94a3b8'}}>{l}</span>
                <span style={{fontSize:13,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</span>
              </div>
            ))}
            {stats.glsLiv > 0 && <Bar pct={100} color="#10b981"/>}
            {stats.glsLiv > 0 && <div style={{fontSize:10,color:'#4a5568',marginTop:4}}>
              {stats.glsLiv} livrate în perioadă · {stats.glsRet} retururi
            </div>}
          </div>

          {/* SAMEDAY */}
          <div style={{background:'#0d1520',border:'1px solid #3b82f6',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:12,color:'#3b82f6',fontWeight:700,marginBottom:12,fontFamily:'monospace'}}>🚀 Sameday</div>
            {[
              ['Livrate în perioadă', stats.sdLiv, '#e8edf2'],
              ['✅ Livrate',       stats.sdLiv,   '#10b981'],
              ['↩️ Returnate',    stats.sdRet,   '#f43f5e'],
            ].map(([l,v,c])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <span style={{fontSize:12,color:'#94a3b8'}}>{l}</span>
                <span style={{fontSize:13,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</span>
              </div>
            ))}
            {stats.sdLiv > 0 && <Bar pct={100} color="#10b981"/>}
            {stats.sdLiv > 0 && <div style={{fontSize:10,color:'#4a5568',marginTop:4}}>
              {stats.sdLiv} livrate în perioadă · {stats.sdRet} retururi
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



