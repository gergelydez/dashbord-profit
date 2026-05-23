'use client';
import { useState, useEffect, useMemo } from 'react';

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const fmt  = (n, dec=2) => Number(n||0).toLocaleString('ro-RO',{minimumFractionDigits:dec,maximumFractionDigits:dec});
const fmtK = (n) => Math.abs(n)>=1000?(n/1000).toFixed(1)+'K':fmt(n,0);
const pad2 = (n) => String(n).padStart(2,'0');
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const pn = (v) => parseFloat(String(v||'0').replace(/[^\d.-]/g,''))||0;

function getShopKey(){try{const s=typeof window!=='undefined'?localStorage.getItem('glamx-shop'):null;const p=s?JSON.parse(s):null;return p?.state?.currentShop||'ro';}catch{return'ro';}}
const ordersKey=(sk)=>sk==='ro'?'gx_orders_all':`gx_orders_all_${sk}`;
function getGlsMap(){try{const s=localStorage.getItem('gls_awb_map');return s?JSON.parse(s):{};}catch{return{};}}
function getSdMap(){try{const s=localStorage.getItem('sd_awb_map');return s?JSON.parse(s):{};}catch{return{};}}

const RETUR_ST=['returned','failure','failed_attempt','return_in_progress','failed_delivery'];
function getFinalStatus(o,gls,sd){
  if(o.courier==='gls'){const a=(o.trackingNo||'').trim();if(a&&gls[a])return gls[a];}
  if(o.courier==='sameday'){const a=(o.trackingNo||'').trim();if(a&&sd[a])return sd[a];if(o.ts&&o.ts!=='pending')return o.ts;return'incurs';}
  if(o.ts&&o.ts!=='pending')return o.ts;
  const tags=(Array.isArray(o.tags)?o.tags:[]).map(t=>String(t).toLowerCase());
  if(RETUR_ST.some(s=>tags.includes(s))||tags.includes('retur')||tags.includes('refuz'))return'retur';
  const fin=(o.financial||o.financial_status||'').toLowerCase();
  if(fin==='paid'||(o.fulfillmentStatus||'').toLowerCase()==='fulfilled')return'livrat';
  return o.ts||'pending';
}

const MONTHS_RO=['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_FULL=['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
const DAYS_FULL=['Duminică','Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă'];
const DAYS_SHORT=['Dum','Lun','Mar','Mie','Joi','Vin','Sâm'];

/* ─── CSV Parser ─────────────────────────────────────────────────────────── */
function splitCSV(line){const res=[];let cur='',q=false;for(const c of line){if(c==='"')q=!q;else if((c===','||c===';')&&!q){res.push(cur);cur='';}else cur+=c;}res.push(cur);return res;}
function parseMetaCSV(text){
  const lines=text.split('\n').filter(l=>l.trim());
  if(lines.length<2)return[];
  const headers=splitCSV(lines[0]).map(h=>h.trim().replace(/^"|"$/g,''));
  return lines.slice(1).map(line=>{
    const cols=splitCSV(line);
    const row={};
    headers.forEach((h,i)=>{row[h]=(cols[i]||'').trim().replace(/^"|"$/g,'');});
    return row;
  }).filter(r=>Object.values(r).some(v=>v));
}

/* ─── Color scale ────────────────────────────────────────────────────────── */
const cpaColor=(v)=>v<=52?'#22c55e':v<=65?'#86efac':v<=80?'#fbbf24':v<=100?'#f97316':'#ef4444';
const cpaBg=(v)=>v<=52?'rgba(34,197,94,0.1)':v<=65?'rgba(134,239,172,0.06)':v<=80?'rgba(251,191,36,0.08)':'rgba(239,68,68,0.08)';
const ctrColor=(v)=>v>=3.5?'#22c55e':v>=2.5?'#fbbf24':'#ef4444';
const cvrColor=(v)=>v>=1.3?'#22c55e':v>=1.0?'#fbbf24':'#ef4444';

/* ─── Grade helper ───────────────────────────────────────────────────────── */
function grade(cpa){
  if(cpa<=0)return{label:'—',color:'var(--c-text4)'};
  if(cpa<=52)return{label:'A+',color:'#22c55e'};
  if(cpa<=65)return{label:'A',color:'#86efac'};
  if(cpa<=80)return{label:'B',color:'#fbbf24'};
  if(cpa<=100)return{label:'C',color:'#f97316'};
  return{label:'D',color:'#ef4444'};
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function MetaIntelligencePage(){
  const [orders,setOrders]=useState([]);
  const [metaRows,setMetaRows]=useState([]);
  const [metaFileName,setMetaFileName]=useState('');
  const [tab,setTab]=useState('overview');
  const [selMonth,setSelMonth]=useState(null);
  const [loading,setLoading]=useState(true);
  const [stockMap,setStockMap]=useState({});   // cod -> {produs,stoc,cost,sold}
  const [stockFile,setStockFile]=useState('');
  // Profit settings — mirrors profit/page.js defaults
  const [transportGLS,setTransportGLS]=useState(21.37);
  const [transportSD,setTransportSD]=useState(18.00);
  const [metaAdSpend,setMetaAdSpend]=useState('');
  const [fixedCosts,setFixedCosts]=useState(890);  // Shopify 290 + Conta 600
  const [shopifyFee,setShopifyFee]=useState(300);  // Shopify fee lunar (TVA 21%)
  const TVA_RATE=0.21;

  /* Load orders */
  useEffect(()=>{
    try{
      const sk=getShopKey();
      const raw=localStorage.getItem(ordersKey(sk))||localStorage.getItem('gx_orders_60')||localStorage.getItem('gx_orders');
      if(raw)setOrders(JSON.parse(raw)||[]);
    }catch(e){console.error(e);}
    setLoading(false);
  },[]);

  /* Load saved Meta rows */
  useEffect(()=>{
    try{
      const saved=localStorage.getItem('glamx_meta_csv_rows');
      if(saved)setMetaRows(JSON.parse(saved));
      const fn=localStorage.getItem('glamx_meta_csv_name');
      if(fn)setMetaFileName(fn);
    }catch{}
  },[]);

  /* Load saved stock */
  useEffect(()=>{
    try{
      const s=localStorage.getItem('glamx_stock_map');
      if(s)setStockMap(JSON.parse(s));
      const fn=localStorage.getItem('glamx_stock_file');
      if(fn)setStockFile(fn);
      const tr=localStorage.getItem('glamx_transport_per_parcel');
      if(tr)setTransportGLS(parseFloat(tr)||21.37);
      const mc=localStorage.getItem('glamx_meta_cost');
      if(mc)setMetaAdSpend(mc);
      const fc=localStorage.getItem('glamx_fixed_manual');
      if(fc)setFixedCosts(parseFloat(fc)||890);
      const sf=localStorage.getItem('glamx_shopify_fee_manual');
      if(sf)setShopifyFee(parseFloat(sf)||300);
    }catch{}
  },[]);

  function openFilePicker(){
    const input=document.createElement('input');
    input.type='file';
    // accept omitted - Android blocks .csv filter
    input.accept='.csv';
    input.style.position='fixed';
    input.style.top='-1000px';
    input.style.left='-1000px';
    input.style.opacity='0';
    document.body.appendChild(input);
    input.onchange=(e)=>{
      const file=e.target.files[0];
      if(!file){document.body.removeChild(input);return;}
      setMetaFileName(file.name);
      const reader=new FileReader();
      reader.onload=(ev)=>{
        const rows=parseMetaCSV(ev.target.result);
        setMetaRows(rows);
        try{localStorage.setItem('glamx_meta_csv_rows',JSON.stringify(rows));localStorage.setItem('glamx_meta_csv_name',file.name);}catch{}
        document.body.removeChild(input);
      };
      reader.readAsText(file,'UTF-8');
    };
    input.click();
  }

  /* ── Parse SmartBill XLS stoc ──────────────────────────────────────── */
  function openStockPicker(){
    const input=document.createElement('input');
    input.type='file';
    // accept intentionally omitted for Android compatibility
    input.style.cssText='position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(input);
    input.onchange=(e)=>{
      const file=e.target.files[0];
      if(!file){document.body.removeChild(input);return;}
      setStockFile(file.name);
      const reader=new FileReader();
      reader.onload=(ev)=>{
        const loadXLS=()=>{
          try{
            const wb=window.XLSX.read(ev.target.result,{type:'array'});
            const ws=wb.Sheets[wb.SheetNames[0]];
            const rows=window.XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
            let hdrIdx=rows.findIndex(r=>String(r[0]||'').toLowerCase().includes('gestiune'));
            if(hdrIdx<0)hdrIdx=8;
            const map={};
            for(let i=hdrIdx+1;i<rows.length;i++){
              const r=rows[i];
              const cod=String(r[2]||'').trim();
              const produs=String(r[1]||'').trim();
              const stoc=parseFloat(r[4])||0;
              const cost=parseFloat(r[5])||0;
              const sold=parseFloat(r[6])||0;
              if(!cod||stoc<=0)continue;
              if(!map[cod]){map[cod]={produs,stoc:0,sold:0,cost};}
              map[cod].stoc+=stoc;
              map[cod].sold+=sold;
              map[cod].cost=map[cod].stoc>0?map[cod].sold/map[cod].stoc:cost;
            }
            setStockMap(map);
            try{localStorage.setItem('glamx_stock_map',JSON.stringify(map));localStorage.setItem('glamx_stock_file',file.name);}catch{}
          }catch(err){alert('Eroare XLS: '+err.message);}
        };
        if(window.XLSX)loadXLS();
        else{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=loadXLS;document.head.appendChild(s);}
        document.body.removeChild(input);
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  }

  /* ── Parse Meta CSV into structured stats ─────────────────────────────── */
  const meta=useMemo(()=>{
    if(!metaRows.length)return null;
    const k=metaRows[0];const keys=Object.keys(k);
    const fk=(...cands)=>keys.find(k2=>cands.some(c=>k2.toLowerCase().includes(c.toLowerCase())))||'';
    const DATE=fk('Reporting starts','date');
    const SPENT=fk('Amount spent','Suma cheltuita');
    const CONV=fk('Results','Rezultate');
    const REACH=fk('Reach','Acoperire');
    const FREQ=fk('Frequency','Frecventa');
    const IMPR=fk('Impressions','Afisari');
    const CLICKS=fk('Link clicks','Clicuri link');
    const CTR=fk('CTR (link','CTR');
    const CPM=fk('CPM');
    const CPC=fk('CPC (cost per link');
    const LPV=fk('Landing page views');
    const ATC=fk('Adds to cart');
    const CATC=fk('Cost per add to cart');
    const CAMP=fk('Campaign name','Campanie');
    const AGE=fk('Age','Varsta');
    const BUDGET=fk('Ad set budget');
    const DELIVERY=fk('Campaign delivery');

    // Accumulators
    const byMonth={};
    const byDow=Object.fromEntries(Array.from({length:7},(_,i)=>[i,{dow:i,spent:0,conv:0,impr:0,clicks:0,atc:0,lpv:0}]));
    const byAge={};
    const byCamp={};
    const byHour=Array.from({length:24},(_,i)=>({hour:i,spent:0,conv:0}));
    let tot={spent:0,conv:0,impr:0,clicks:0,atc:0,lpv:0,reach:0};

    metaRows.forEach(row=>{
      const ds=row[DATE];if(!ds)return;
      const d=new Date(ds+'T12:00:00');if(isNaN(d))return;
      const spent=pn(row[SPENT]),conv=pn(row[CONV]),impr=pn(row[IMPR]),
            clicks=pn(row[CLICKS]),atc=pn(row[ATC]),lpv=pn(row[LPV]),
            reach=pn(row[REACH]),freq=pn(row[FREQ]),budget=pn(row[BUDGET]);
      const mKey=`${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
      const dow=d.getDay();
      const age=row[AGE]||'Unknown';
      const camp=row[CAMP]||'Unknown';

      // by month
      if(!byMonth[mKey])byMonth[mKey]={key:mKey,label:MONTHS_FULL[d.getMonth()]+' '+d.getFullYear(),
        short:MONTHS_RO[d.getMonth()]+' '+d.getFullYear().toString().slice(2),
        m:d.getMonth(),y:d.getFullYear(),spent:0,conv:0,impr:0,clicks:0,atc:0,lpv:0,reach:0,freqSum:0,freqCnt:0,budgetSum:0,budgetCnt:0};
      byMonth[mKey].spent+=spent;byMonth[mKey].conv+=conv;byMonth[mKey].impr+=impr;
      byMonth[mKey].clicks+=clicks;byMonth[mKey].atc+=atc;byMonth[mKey].lpv+=lpv;byMonth[mKey].reach+=reach;
      if(freq>0){byMonth[mKey].freqSum+=freq;byMonth[mKey].freqCnt++;}
      if(budget>0){byMonth[mKey].budgetSum+=budget;byMonth[mKey].budgetCnt++;}

      // by dow
      byDow[dow].spent+=spent;byDow[dow].conv+=conv;byDow[dow].impr+=impr;byDow[dow].clicks+=clicks;byDow[dow].atc+=atc;byDow[dow].lpv+=lpv;

      // by age
      if(!byAge[age])byAge[age]={age,spent:0,conv:0,impr:0,clicks:0};
      byAge[age].spent+=spent;byAge[age].conv+=conv;byAge[age].impr+=impr;byAge[age].clicks+=clicks;

      // by campaign
      if(!byCamp[camp])byCamp[camp]={camp,spent:0,conv:0,impr:0,clicks:0,atc:0,lpv:0,reach:0};
      byCamp[camp].spent+=spent;byCamp[camp].conv+=conv;byCamp[camp].impr+=impr;
      byCamp[camp].clicks+=clicks;byCamp[camp].atc+=atc;byCamp[camp].lpv+=lpv;byCamp[camp].reach+=reach;

      tot.spent+=spent;tot.conv+=conv;tot.impr+=impr;tot.clicks+=clicks;tot.atc+=atc;tot.lpv+=lpv;tot.reach+=reach;
    });

    // Compute derived metrics
    const months=Object.values(byMonth).sort((a,b)=>a.key.localeCompare(b.key)).map(m=>({
      ...m,
      cpa:m.conv?m.spent/m.conv:0,
      ctr:m.impr?m.clicks/m.impr*100:0,
      cpm:m.impr?m.spent/m.impr*1000:0,
      cpc:m.clicks?m.spent/m.clicks:0,
      cvr:m.lpv?m.conv/m.lpv*100:0,
      atcRate:m.lpv?m.atc/m.lpv*100:0,
      lpvRate:m.clicks?m.lpv/m.clicks*100:0,
      freq:m.freqCnt?m.freqSum/m.freqCnt:0,
      avgBudget:m.budgetCnt?m.budgetSum/m.budgetCnt:0,
    }));
    const dowArr=Object.values(byDow).map(d=>({...d,
      cpa:d.conv?d.spent/d.conv:0,ctr:d.impr?d.clicks/d.impr*100:0,
      cvr:d.lpv?d.conv/d.lpv*100:0,atcRate:d.lpv?d.atc/d.lpv*100:0,
    }));
    const ageArr=Object.values(byAge).map(a=>({...a,
      cpa:a.conv?a.spent/a.conv:0,ctr:a.impr?a.clicks/a.impr*100:0,
      pct:tot.spent?a.spent/tot.spent*100:0,
    })).sort((a,b)=>b.spent-a.spent);
    const campArr=Object.values(byCamp).map(c=>({...c,
      cpa:c.conv?c.spent/c.conv:0,ctr:c.impr?c.clicks/c.impr*100:0,
      cvr:c.lpv?c.conv/c.lpv*100:0,atcRate:c.lpv?c.atc/c.lpv*100:0,
      cpc:c.clicks?c.spent/c.clicks:0,cpm:c.impr?c.spent/c.impr*1000:0,
      lpvRate:c.clicks?c.lpv/c.clicks*100:0,
    })).filter(c=>c.spent>100).sort((a,b)=>a.cpa-b.cpa);

    const avgCPA=tot.conv?tot.spent/tot.conv:0;
    const avgCTR=tot.impr?tot.clicks/tot.impr*100:0;
    const avgCPM=tot.impr?tot.spent/tot.impr*1000:0;
    const avgCVR=tot.lpv?tot.conv/tot.lpv*100:0;
    const avgCPC=tot.clicks?tot.spent/tot.clicks:0;
    const avgATC=tot.lpv?tot.atc/tot.lpv*100:0;

    return{months,dowArr,ageArr,campArr,tot,avgCPA,avgCTR,avgCPM,avgCVR,avgCPC,avgATC};
  },[metaRows]);

  /* ── Parse Orders ─────────────────────────────────────────────────────── */
  const ord=useMemo(()=>{
    if(!orders.length)return null;
    const gls=getGlsMap(),sd=getSdMap();
    const byMonth={},byDow=Object.fromEntries(Array.from({length:7},(_,i)=>[i,{dow:i,cnt:0,livrat:0,retur:0,refuz:0,rev:0}]));
    const byHour=Array.from({length:24},(_,i)=>({hour:i,cnt:0,livrat:0}));
    let tot={cnt:0,livrat:0,retur:0,refuz:0,rev:0};

    orders.forEach(o=>{
      const d=new Date(o.createdAt||o.created_at||'');if(isNaN(d))return;
      const mKey=`${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
      const dow=d.getDay(),hour=d.getHours();
      const st=getFinalStatus(o,gls,sd);
      const rev=pn(o.total||o.totalPrice||o.total_price||0);
      const isL=st==='livrat',isR=st==='retur',isF=['anulat','refuzat'].includes(st);

      if(!byMonth[mKey])byMonth[mKey]={key:mKey,m:d.getMonth(),y:d.getFullYear(),cnt:0,livrat:0,retur:0,refuz:0,rev:0};
      byMonth[mKey].cnt++;byMonth[mKey].rev+=rev;
      if(isL)byMonth[mKey].livrat++;else if(isR)byMonth[mKey].retur++;else if(isF)byMonth[mKey].refuz++;

      byDow[dow].cnt++;byDow[dow].rev+=rev;
      if(isL)byDow[dow].livrat++;if(isR)byDow[dow].retur++;if(isF)byDow[dow].refuz++;

      byHour[hour].cnt++;if(isL)byHour[hour].livrat++;

      tot.cnt++;tot.rev+=rev;if(isL)tot.livrat++;else if(isR)tot.retur++;else if(isF)tot.refuz++;
    });

    const months=Object.values(byMonth).sort((a,b)=>a.key.localeCompare(b.key)).map(m=>({
      ...m,livrareRate:m.cnt?(m.livrat/m.cnt*100):0,returRate:m.cnt?(m.retur/m.cnt*100):0,
      refuzRate:m.cnt?(m.refuz/m.cnt*100):0,avgOrder:m.livrat?(m.rev/m.livrat):0,
    }));
    const dowArr=Object.values(byDow).map(d=>({...d,livrareRate:d.cnt?d.livrat/d.cnt*100:0,returRate:d.cnt?d.retur/d.cnt*100:0}));

    return{months,dowArr,byHour,tot,
      livrareRate:tot.cnt?tot.livrat/tot.cnt*100:0,
      returRate:tot.cnt?tot.retur/tot.cnt*100:0,
    };
  },[orders]);

  /* ── Combined monthly ─────────────────────────────────────────────────── */
  const combined=useMemo(()=>{
    const allKeys=new Set([...(meta?.months||[]).map(m=>m.key),...(ord?.months||[]).map(m=>m.key)]);
    return Array.from(allKeys).sort().map(key=>{
      const m=meta?.months.find(x=>x.key===key)||{};
      const o=ord?.months.find(x=>x.key===key)||{};
      const label=m.label||(o.m!==undefined?MONTHS_FULL[o.m]+' '+o.y:'');
      const short=m.short||(o.m!==undefined?MONTHS_RO[o.m]+' '+String(o.y).slice(2):'');
      const cpa=m.cpa||0;
      const realCPA=(m.spent&&o.livrat)?m.spent/o.livrat:0;
      return{key,label,short,m:m.m??o.m,y:m.y??o.y,
        spent:m.spent||0,conv:m.conv||0,cpa,ctr:m.ctr||0,cpm:m.cpm||0,
        cpc:m.cpc||0,cvr:m.cvr||0,atcRate:m.atcRate||0,freq:m.freq||0,
        impr:m.impr||0,clicks:m.clicks||0,atc:m.atc||0,lpv:m.lpv||0,reach:m.reach||0,
        orders:o.cnt||0,livrat:o.livrat||0,retur:o.retur||0,refuz:o.refuz||0,rev:o.rev||0,
        livrareRate:o.livrareRate||0,returRate:o.returRate||0,avgOrder:o.avgOrder||0,
        realCPA,
      };
    });
  },[meta,ord]);

  const selMonthData=useMemo(()=>selMonth?combined.find(m=>m.key===selMonth):null,[selMonth,combined]);

  /* ── Insights engine ─────────────────────────────────────────────────── */
  const insights=useMemo(()=>{
    const list=[];
    if(!meta&&!ord)return list;

    // Best/worst campaign
    if(meta?.campArr.length){
      const best=meta.campArr.filter(c=>c.conv>=5)[0];
      const worst=[...meta.campArr].filter(c=>c.conv>=5).sort((a,b)=>b.cpa-a.cpa)[0];
      if(best)list.push({type:'win',icon:'🏆',title:`Cea mai bună campanie: ${best.camp.replace('CBO ','').replace('cbo ','')}`,body:`CPA ${fmt(best.cpa,0)} RON · CTR ${fmt(best.ctr,2)}% · CVR ${fmt(best.cvr,2)}% · ${best.conv} conversii`});
      if(worst&&worst.camp!==best?.camp)list.push({type:'stop',icon:'🔴',title:`Cea mai slabă: ${worst.camp.replace('CBO ','').replace('cbo ','')}`,body:`CPA ${fmt(worst.cpa,0)} RON · CVR ${fmt(worst.cvr,2)}% — Problema e pe landing page sau audiență greșită`});
    }

    // Age insight
    if(meta?.ageArr.length){
      const bestAge=meta.ageArr.filter(a=>a.conv>=5).sort((a,b)=>a.cpa-b.cpa)[0];
      const worstAge=meta.ageArr.filter(a=>a.conv>=5).sort((a,b)=>b.cpa-a.cpa)[0];
      if(bestAge)list.push({type:'win',icon:'👤',title:`Audiența câștigătoare: ${bestAge.age} ani`,body:`CPA ${fmt(bestAge.cpa,0)} RON · ${fmt(bestAge.pct,1)}% din buget · ${bestAge.conv} conversii. Mărește bugetul pe acest segment.`});
      if(worstAge&&worstAge.age!==bestAge?.age)list.push({type:'warn',icon:'⚠️',title:`Audiența risipitoare: ${worstAge.age} ani`,body:`CPA ${fmt(worstAge.cpa,0)} RON — de ${fmt(worstAge.cpa/bestAge.cpa,1)}x mai scump decât ${bestAge.age} ani. Reduce sau exclude.`});
    }

    // CTR insight
    if(meta){
      if(meta.avgCTR<2.5)list.push({type:'stop',icon:'📉',title:'CTR prea mic — creativele nu opresc scroll-ul',body:`CTR mediu ${fmt(meta.avgCTR,2)}% vs. benchmark 3%+. Hook-ul primelor 3 secunde e problema. Testează 3-4 hooks noi.`});
      else if(meta.avgCTR>=3)list.push({type:'win',icon:'✅',title:'CTR excelent — creativele performează',body:`CTR ${fmt(meta.avgCTR,2)}% — ești deasupra mediei Meta pentru e-commerce. Scalează bugetul.`});
    }

    // CVR insight
    if(meta){
      if(meta.avgCVR<1)list.push({type:'stop',icon:'🛒',title:'CVR sub 1% — problema e pe landing page',body:`Rata de conversie ${fmt(meta.avgCVR,2)}% — oamenii vin pe site dar nu cumpără. Optimizează pagina produsului: viteza, recenzii, CTA clar.`});
      else if(meta.avgCVR>=1.3)list.push({type:'win',icon:'🛒',title:`CVR ${fmt(meta.avgCVR,2)}% — landing page convertește bine`,body:`Benchmark pentru smartwatch e-commerce: 1-1.5%. Ești în zona bună. Focusează pe CPA și creative.`});
    }

    // DOW insight
    if(meta?.dowArr){
      const best=meta.dowArr.filter(d=>d.conv>=3).sort((a,b)=>a.cpa-b.cpa)[0];
      const worst=meta.dowArr.filter(d=>d.conv>=3).sort((a,b)=>b.cpa-a.cpa)[0];
      if(best)list.push({type:'win',icon:'📅',title:`${DAYS_FULL[best.dow]} — ziua ta de aur`,body:`CPA ${fmt(best.cpa,0)} RON. Mărește bugetul cu +30% ${DAYS_FULL[best.dow]}. Nu opri niciodată campania în acea zi.`});
      if(worst&&worst.dow!==best?.dow)list.push({type:'warn',icon:'📅',title:`${DAYS_FULL[worst.dow]} — ziua costisitoare`,body:`CPA ${fmt(worst.cpa,0)} RON. Reduce bugetul cu 20-30% dar nu opri total — algoritmul pierde date.`});
    }

    // Return rate
    if(ord){
      if(ord.returRate>20)list.push({type:'stop',icon:'📦',title:`Rată retur ${fmt(ord.returRate,1)}% — alarmant`,body:`Benchmark sănătos: sub 10%. Verifică calitatea produsului și concordanța cu promisiunile din reclame.`});
      else if(ord.returRate<8)list.push({type:'win',icon:'📦',title:`Rată retur excelentă: ${fmt(ord.returRate,1)}%`,body:`Sub 8% e excelent pentru smartwatch COD România. Clienții sunt mulțumiți de ce primesc.`});
    }

    // Frecvency
    if(meta){
      const avgFreq=meta.months.reduce((s,m)=>s+(m.freq||0),0)/meta.months.filter(m=>m.freq>0).length;
      if(avgFreq>2.5)list.push({type:'warn',icon:'🔁',title:`Frecvența ${fmt(avgFreq,2)} — audiență obosită`,body:`Peste 2.5 înseamnă că arăți reclamele aceleiași persoane de prea multe ori. Extinde audiența sau schimbă creativele.`});
    }

    return list;
  },[meta,ord]);

  /* ── Top vs Bottom campaign analysis ─────────────────────────────────── */
  const campAnalysis=useMemo(()=>{
    if(!meta?.campArr)return{top:[],bottom:[],avgCTR:0,avgCVR:0};
    const withConv=meta.campArr.filter(c=>c.conv>=5);
    const top=withConv.filter(c=>c.cpa<=65).sort((a,b)=>a.cpa-b.cpa);
    const bottom=withConv.filter(c=>c.cpa>=100).sort((a,b)=>b.cpa-a.cpa);
    const avgCTR=withConv.length?withConv.reduce((s,c)=>s+c.ctr,0)/withConv.length:0;
    const avgCVR=withConv.length?withConv.reduce((s,c)=>s+c.cvr,0)/withConv.length:0;
    return{top,bottom,all:meta.campArr,avgCTR,avgCVR};
  },[meta]);

  /* ── Styles ───────────────────────────────────────────────────────────── */
  const c={
    page:{padding:'12px',maxWidth:1100,margin:'0 auto',paddingBottom:100},
    hdr:{fontSize:20,fontWeight:800,color:'var(--c-text)',letterSpacing:'-0.4px'},
    sub:{fontSize:12,color:'var(--c-text3)',marginTop:3},
    tabs:{display:'flex',gap:6,marginBottom:16,overflowX:'auto',paddingBottom:2,WebkitOverflowScrolling:'touch'},
    tab:(a)=>({padding:'7px 14px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',border:'none',
      background:a?'var(--c-orange)':'var(--c-card2)',color:a?'#fff':'var(--c-text2)',whiteSpace:'nowrap',flexShrink:0}),
    card:{background:'var(--c-card)',border:'1px solid var(--c-border2)',borderRadius:12,padding:'14px'},
    cardHdr:{fontSize:10,fontWeight:800,color:'var(--c-text4)',letterSpacing:'0.07em',textTransform:'uppercase',marginBottom:12},
    kpi:{background:'var(--c-card)',border:'1px solid var(--c-border2)',borderRadius:10,padding:'14px 16px'},
    kL:{fontSize:10,color:'var(--c-text4)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:5},
    kV:{fontSize:26,fontWeight:800,color:'var(--c-text)',lineHeight:1},
    kS:{fontSize:11,color:'var(--c-text3)',marginTop:4},
    grid:(n)=>({display:'grid',gridTemplateColumns:`repeat(${n},1fr)`,gap:10,marginBottom:12}),
    badge:(color)=>({display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700,
      background:color==='green'?'rgba(34,197,94,0.15)':color==='red'?'rgba(239,68,68,0.15)':color==='yellow'?'rgba(251,191,36,0.15)':'rgba(249,115,22,0.15)',
      color:color==='green'?'#22c55e':color==='red'?'#ef4444':color==='yellow'?'#fbbf24':'var(--c-orange)'}),
    th:{textAlign:'left',padding:'7px 10px',fontSize:10,fontWeight:800,color:'var(--c-text4)',textTransform:'uppercase',letterSpacing:'0.05em',borderBottom:'1px solid var(--c-border2)',whiteSpace:'nowrap'},
    td:(bold,color)=>({padding:'8px 10px',borderBottom:'1px solid var(--c-border2)',color:color||'var(--c-text2)',fontWeight:bold?700:400,fontSize:12,whiteSpace:'nowrap'}),
    row:(active)=>({background:active?'rgba(249,115,22,0.05)':'transparent',cursor:'pointer'}),
    insight:(t)=>({background:t==='win'?'rgba(34,197,94,0.07)':t==='stop'?'rgba(239,68,68,0.07)':'rgba(251,191,36,0.07)',
      border:`1px solid ${t==='win'?'rgba(34,197,94,0.2)':t==='stop'?'rgba(239,68,68,0.2)':'rgba(251,191,36,0.2)'}`,
      borderRadius:10,padding:'12px 14px',marginBottom:10}),
    bar:{display:'flex',alignItems:'center',gap:8,marginBottom:10},
    barLbl:{width:65,fontSize:11,color:'var(--c-text3)',textAlign:'right',flexShrink:0},
    barTrk:{flex:1,height:26,background:'var(--c-card2)',borderRadius:4,overflow:'hidden',position:'relative'},
    barFl:(pct,col)=>({width:`${Math.min(pct,100)}%`,height:'100%',background:col,borderRadius:4,display:'flex',alignItems:'center',justifyContent:'flex-end',paddingRight:6,minWidth:2,transition:'width 0.7s ease'}),
    barV:{fontSize:11,fontWeight:700,color:'#fff',whiteSpace:'nowrap'},
    sep:{borderTop:'1px solid var(--c-border2)',margin:'12px 0'},
  };

  const hasData=!!(meta||ord);

  /* ── Month card click ─────────────────────────────────────────────────── */
  const toggleMonth=(key)=>setSelMonth(prev=>prev===key?null:key);

  return(
    <div style={c.page}>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10,marginBottom:16}}>
        <div>
          <div style={c.hdr}>🎯 Meta Intelligence</div>
          <div style={c.sub}>Analiză completă · Funnel · Audiențe · Campanii · Comenzi · Insight-uri experte</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          {metaFileName&&<span style={{...c.badge('green'),fontSize:11,padding:'6px 10px'}}>✓ {metaFileName}</span>}
          <button onClick={openFilePicker} style={{padding:'8px 14px',borderRadius:8,background:'var(--c-orange)',color:'#fff',border:'none',fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
            📥 Import CSV Meta
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!hasData&&!loading&&(
        <div style={{border:'2px dashed var(--c-border2)',borderRadius:12,padding:'40px 24px',textAlign:'center',maxWidth:480,margin:'40px auto'}}>
          <div style={{fontSize:40,marginBottom:10}}>📊</div>
          <div style={{fontSize:15,fontWeight:700,color:'var(--c-text)',marginBottom:8}}>Importă datele Meta Ads</div>
          <div style={{fontSize:12,color:'var(--c-text3)',marginBottom:16,lineHeight:1.6}}>Exportă CSV din Ads Manager cu breakdown pe Age și zi. Datele Shopify se încarcă automat din cache.</div>
          <button onClick={openFilePicker} style={{padding:'10px 24px',background:'var(--c-orange)',color:'#fff',borderRadius:8,display:'inline-block',fontWeight:700,fontSize:13,border:'none',cursor:'pointer'}}>Alege fișier CSV →</button>
        </div>
      )}

      {hasData&&(
        <>
          {/* Tabs */}
          <div style={c.tabs}>
            {[
              {id:'overview',label:'📈 Overview'},
              {id:'funnel',label:'🔽 Funnel'},
              {id:'monthly',label:'📅 Pe Luni'},
              {id:'campaigns',label:'🏹 Campanii'},
              {id:'audience',label:'👥 Audiențe'},
              {id:'dow',label:'📆 Zile & Ore'},
              {id:'profit',label:'💰 Profit Lunar'},
              {id:'insights',label:'💡 Insights'},
            ].map(t=><button key={t.id} style={c.tab(tab===t.id)} onClick={()=>setTab(t.id)}>{t.label}</button>)}
          </div>

          {/* ══ OVERVIEW ══ */}
          {tab==='overview'&&(
            <>
              {/* Meta KPIs */}
              {meta&&(
                <>
                  <div style={{...c.cardHdr,marginBottom:8}}>META ADS · PERFORMANȚĂ TOTALĂ</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:8,marginBottom:12}}>
                    <div style={c.kpi}><div style={c.kL}>Cheltuit</div><div style={{...c.kV,color:'var(--c-orange)'}}>{fmtK(meta.tot.spent)}</div><div style={c.kS}>RON total</div></div>
                    <div style={c.kpi}><div style={c.kL}>Conversii Meta</div><div style={c.kV}>{meta.tot.conv}</div><div style={c.kS}>pixel purchases</div></div>
                    <div style={c.kpi}><div style={c.kL}>CPA Meta</div><div style={{...c.kV,color:cpaColor(meta.avgCPA)}}>{fmt(meta.avgCPA,0)}</div><div style={c.kS}>RON / conv</div></div>
                    <div style={c.kpi}><div style={c.kL}>CTR</div><div style={{...c.kV,color:ctrColor(meta.avgCTR)}}>{fmt(meta.avgCTR,2)}%</div><div style={c.kS}>click-through</div></div>
                    <div style={c.kpi}><div style={c.kL}>CVR</div><div style={{...c.kV,color:cvrColor(meta.avgCVR)}}>{fmt(meta.avgCVR,2)}%</div><div style={c.kS}>conv rate</div></div>
                    <div style={c.kpi}><div style={c.kL}>CPM</div><div style={c.kV}>{fmt(meta.avgCPM,0)}</div><div style={c.kS}>RON / 1K imp</div></div>
                    <div style={c.kpi}><div style={c.kL}>CPC</div><div style={c.kV}>{fmt(meta.avgCPC,2)}</div><div style={c.kS}>RON / click</div></div>
                    <div style={c.kpi}><div style={c.kL}>Reach</div><div style={c.kV}>{fmtK(meta.tot.reach)}</div><div style={c.kS}>persoane unice</div></div>
                    <div style={c.kpi}><div style={c.kL}>Add to Cart</div><div style={c.kV}>{meta.tot.atc}</div><div style={c.kS}>{fmt(meta.avgATC,2)}% din LPV</div></div>
                  </div>
                </>
              )}

              {/* Orders KPIs */}
              {ord&&(
                <>
                  <div style={{...c.cardHdr,marginBottom:8}}>SHOPIFY · REALITATEA</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:8,marginBottom:12}}>
                    <div style={c.kpi}><div style={c.kL}>Total comenzi</div><div style={c.kV}>{ord.tot.cnt}</div><div style={c.kS}>plasate</div></div>
                    <div style={c.kpi}><div style={c.kL}>Livrate real</div><div style={{...c.kV,color:'#22c55e'}}>{ord.tot.livrat}</div><div style={c.kS}>{fmt(ord.livrareRate,1)}% rată</div></div>
                    <div style={c.kpi}><div style={c.kL}>Retururi</div><div style={{...c.kV,color:'#ef4444'}}>{ord.tot.retur}</div><div style={c.kS}>{fmt(ord.returRate,1)}% rată</div></div>
                    <div style={c.kpi}><div style={c.kL}>Refuzate</div><div style={{...c.kV,color:'#f97316'}}>{ord.tot.refuz}</div><div style={c.kS}>neprimite</div></div>
                    <div style={c.kpi}><div style={c.kL}>Venituri brute</div><div style={c.kV}>{fmtK(ord.tot.rev)}</div><div style={c.kS}>RON</div></div>
                  </div>
                </>
              )}

              {/* CPA real vs Meta */}
              {meta&&ord&&(
                <div style={{...c.card,marginBottom:12}}>
                  <div style={c.cardHdr}>CPA META vs. CPA REAL (bazat pe livrări)</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                    <div style={{textAlign:'center',padding:'16px 8px'}}>
                      <div style={{fontSize:11,color:'var(--c-text4)',marginBottom:6}}>CPA RAPORTAT META</div>
                      <div style={{fontSize:36,fontWeight:800,color:'#f97316'}}>{fmt(meta.avgCPA,0)}</div>
                      <div style={{fontSize:11,color:'var(--c-text3)'}}>RON (pixel)</div>
                    </div>
                    <div style={{textAlign:'center',padding:'16px 8px',borderLeft:'1px solid var(--c-border2)',borderRight:'1px solid var(--c-border2)'}}>
                      <div style={{fontSize:11,color:'var(--c-text4)',marginBottom:6}}>CPA REAL (livrate)</div>
                      <div style={{fontSize:36,fontWeight:800,color:cpaColor(meta.tot.spent/ord.tot.livrat)}}>{fmt(meta.tot.spent/ord.tot.livrat,0)}</div>
                      <div style={{fontSize:11,color:'var(--c-text3)'}}>RON (Shopify)</div>
                    </div>
                    <div style={{textAlign:'center',padding:'16px 8px'}}>
                      <div style={{fontSize:11,color:'var(--c-text4)',marginBottom:6}}>DIFERENȚĂ</div>
                      <div style={{fontSize:36,fontWeight:800,color:'#ef4444'}}>+{fmt((meta.tot.spent/ord.tot.livrat)-meta.avgCPA,0)}</div>
                      <div style={{fontSize:11,color:'var(--c-text3)'}}>RON neatribuite</div>
                    </div>
                  </div>
                  <div style={{marginTop:10,padding:'10px 12px',background:'rgba(249,115,22,0.07)',borderRadius:8,fontSize:12,color:'var(--c-text3)',lineHeight:1.6}}>
                    ⚠️ <strong style={{color:'var(--c-text)'}}>Meta raportează {meta.tot.conv} conversii</strong>, dar Shopify arată {ord.tot.livrat} livrate reale. Diferența de {meta.tot.conv-ord.tot.livrat} e formată din: retururi, refuzuri, comenzi false și atribuire dublă a pixelului. <strong style={{color:'var(--c-text)'}}>CPA real este {fmt(meta.tot.spent/ord.tot.livrat,0)} RON</strong>, nu {fmt(meta.avgCPA,0)} RON.
                  </div>
                </div>
              )}

              {/* Monthly CPA chart */}
              {combined.length>0&&(
                <div style={{...c.card,marginBottom:12}}>
                  <div style={c.cardHdr}>CPA pe lună — evoluție comparată</div>
                  {combined.map(m=>{
                    const maxCPA=Math.max(...combined.filter(x=>x.cpa>0).map(x=>x.cpa),1);
                    const pct=m.cpa?m.cpa/maxCPA*100:0;
                    const g=grade(m.cpa);
                    return(
                      <div key={m.key} style={{...c.bar,cursor:'pointer'}} onClick={()=>{toggleMonth(m.key);setTab('monthly');}}>
                        <div style={{...c.barLbl,width:55}}>{m.short}</div>
                        <div style={c.barTrk}>
                          <div style={c.barFl(pct,cpaColor(m.cpa))}>
                            {pct>22&&<span style={c.barV}>{fmt(m.cpa,0)} RON</span>}
                          </div>
                        </div>
                        {pct<=22&&<span style={{fontSize:11,color:cpaColor(m.cpa),fontWeight:700,minWidth:60}}>{m.cpa>0?fmt(m.cpa,0)+' RON':'—'}</span>}
                        <span style={{fontSize:16,fontWeight:900,color:g.color,minWidth:28,textAlign:'right'}}>{g.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ══ FUNNEL ══ */}
          {tab==='funnel'&&meta&&(
            <>
              <div style={{...c.card,marginBottom:12}}>
                <div style={c.cardHdr}>FUNNEL COMPLET · Impression → Conversie</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8,marginBottom:16}}>
                  {[
                    {label:'Impressions',val:fmtK(meta.tot.impr),sub:'afișări totale',color:'var(--c-text)'},
                    {label:'Reach',val:fmtK(meta.tot.reach),sub:'persoane unice',color:'var(--c-text)'},
                    {label:'Link Clicks',val:fmtK(meta.tot.clicks),sub:`CTR ${fmt(meta.avgCTR,2)}%`,color:ctrColor(meta.avgCTR)},
                    {label:'Landing Page',val:fmtK(meta.tot.lpv),sub:`${fmt(meta.tot.lpv/meta.tot.clicks*100,1)}% din clicks`,color:'var(--c-text)'},
                    {label:'Add to Cart',val:meta.tot.atc,sub:`${fmt(meta.avgATC,2)}% din LPV`,color:'#fbbf24'},
                    {label:'Conversii',val:meta.tot.conv,sub:`CVR ${fmt(meta.avgCVR,2)}%`,color:cvrColor(meta.avgCVR)},
                  ].map((f,i)=>(
                    <div key={i} style={c.kpi}>
                      <div style={c.kL}>{f.label}</div>
                      <div style={{...c.kV,fontSize:22,color:f.color}}>{f.val}</div>
                      <div style={c.kS}>{f.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Funnel visual */}
                <div style={c.cardHdr}>PIERDERI PE FUNNEL</div>
                {[
                  {label:'Impr → Clicks',drop:meta.tot.impr>0?(1-meta.tot.clicks/meta.tot.impr)*100:0,note:'CTR scăzut = creativ slab sau audiență greșită'},
                  {label:'Clicks → LPV',drop:meta.tot.clicks>0?(1-meta.tot.lpv/meta.tot.clicks)*100:0,note:'Drop mare = pagina se încarcă greu sau bounce rapid'},
                  {label:'LPV → ATC',drop:meta.tot.lpv>0?(1-meta.tot.atc/meta.tot.lpv)*100:0,note:'Drop mare = prețul e prea mare sau descrierea convinge prost'},
                  {label:'ATC → Conversie',drop:meta.tot.atc>0?(1-meta.tot.conv/meta.tot.atc)*100:0,note:'Drop mare = checkout complicat sau lipsă încredere'},
                ].map((f,i)=>(
                  <div key={i} style={{marginBottom:12}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                      <span style={{fontWeight:700,color:'var(--c-text)'}}>{f.label}</span>
                      <span style={{color:f.drop>70?'#ef4444':f.drop>50?'#f97316':'#22c55e',fontWeight:700}}>{fmt(f.drop,1)}% pierdere</span>
                    </div>
                    <div style={{height:10,background:'var(--c-card2)',borderRadius:5,overflow:'hidden'}}>
                      <div style={{width:`${100-f.drop}%`,height:'100%',background:f.drop>70?'#ef4444':f.drop>50?'#f97316':'#22c55e',transition:'width 0.7s ease'}}/>
                    </div>
                    <div style={{fontSize:11,color:'var(--c-text4)',marginTop:3}}>{f.note}</div>
                  </div>
                ))}
              </div>

              {/* Monthly funnel table */}
              <div style={{...c.card,overflowX:'auto'}}>
                <div style={c.cardHdr}>FUNNEL PE LUNI</div>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr>{['Lună','Cheltuit','Conv','CPA','CTR','CVR','ATC%','CPC','CPM','Frecv','LPV'].map(h=><th key={h} style={c.th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {meta.months.map(m=>(
                      <tr key={m.key}>
                        <td style={c.td(true,'var(--c-text)')}>{m.short}</td>
                        <td style={c.td(false,'var(--c-orange)')}>{fmt(m.spent,0)}</td>
                        <td style={c.td()}>{m.conv}</td>
                        <td style={c.td(true,cpaColor(m.cpa))}>{m.cpa>0?fmt(m.cpa,0):'-'}</td>
                        <td style={c.td(false,ctrColor(m.ctr))}>{fmt(m.ctr,2)}%</td>
                        <td style={c.td(false,cvrColor(m.cvr))}>{fmt(m.cvr,2)}%</td>
                        <td style={c.td()}>{fmt(m.atcRate,2)}%</td>
                        <td style={c.td()}>{fmt(m.cpc,2)}</td>
                        <td style={c.td()}>{fmt(m.cpm,0)}</td>
                        <td style={c.td(false,m.freq>2.5?'#ef4444':m.freq>1.8?'#fbbf24':'#22c55e')}>{fmt(m.freq,2)}</td>
                        <td style={c.td()}>{fmtK(m.lpv)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ══ MONTHLY ══ */}
          {tab==='monthly'&&(
            <>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:8,marginBottom:12}}>
                {combined.map(m=>{
                  const g=grade(m.cpa);
                  return(
                    <div key={m.key} onClick={()=>toggleMonth(m.key)}
                      style={{background:selMonth===m.key?'rgba(249,115,22,0.1)':'var(--c-card2)',
                        border:`1px solid ${selMonth===m.key?'var(--c-orange)':'var(--c-border2)'}`,
                        borderRadius:10,padding:'12px',cursor:'pointer',transition:'all 120ms'}}>
                      <div style={{fontSize:12,fontWeight:700,color:selMonth===m.key?'var(--c-orange)':'var(--c-text)',marginBottom:4}}>{m.short}</div>
                      <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:2}}>
                        <span style={{fontSize:22,fontWeight:800,color:m.cpa>0?cpaColor(m.cpa):'var(--c-text4)'}}>{m.cpa>0?fmt(m.cpa,0):'—'}</span>
                        {m.cpa>0&&<span style={{fontSize:10,color:'var(--c-text4)'}}>RON CPA</span>}
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <span style={{fontSize:10,color:'var(--c-text4)'}}>{m.conv} conv · {m.orders} ord</span>
                        <span style={{fontSize:18,fontWeight:900,color:g.color}}>{g.label}</span>
                      </div>
                      {m.orders>0&&(
                        <div style={{marginTop:6,height:6,borderRadius:3,overflow:'hidden',background:'var(--c-border2)',display:'flex'}}>
                          <div style={{width:`${m.livrareRate}%`,background:'#22c55e'}}/>
                          <div style={{width:`${m.returRate}%`,background:'#ef4444'}}/>
                          <div style={{width:`${m.refuzRate}%`,background:'#f97316'}}/>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {selMonthData&&(
                <div style={{...c.card,marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:8}}>
                    <div style={{fontSize:17,fontWeight:800,color:'var(--c-text)'}}>{selMonthData.label}</div>
                    <button onClick={()=>setSelMonth(null)} style={{background:'transparent',border:'1px solid var(--c-border2)',borderRadius:6,padding:'4px 10px',color:'var(--c-text3)',cursor:'pointer',fontSize:12}}>✕</button>
                  </div>

                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(100px,1fr))',gap:8,marginBottom:14}}>
                    {selMonthData.spent>0&&<div style={c.kpi}><div style={c.kL}>Cheltuit Meta</div><div style={{...c.kV,fontSize:20,color:'var(--c-orange)'}}>{fmt(selMonthData.spent,0)}</div><div style={c.kS}>RON</div></div>}
                    {selMonthData.cpa>0&&<div style={c.kpi}><div style={c.kL}>CPA Meta</div><div style={{...c.kV,fontSize:20,color:cpaColor(selMonthData.cpa)}}>{fmt(selMonthData.cpa,0)}</div><div style={c.kS}>RON/conv</div></div>}
                    {selMonthData.realCPA>0&&<div style={c.kpi}><div style={c.kL}>CPA Real</div><div style={{...c.kV,fontSize:20,color:cpaColor(selMonthData.realCPA)}}>{fmt(selMonthData.realCPA,0)}</div><div style={c.kS}>RON/livrat</div></div>}
                    {selMonthData.ctr>0&&<div style={c.kpi}><div style={c.kL}>CTR</div><div style={{...c.kV,fontSize:20,color:ctrColor(selMonthData.ctr)}}>{fmt(selMonthData.ctr,2)}%</div><div style={c.kS}>click-through</div></div>}
                    {selMonthData.cvr>0&&<div style={c.kpi}><div style={c.kL}>CVR</div><div style={{...c.kV,fontSize:20,color:cvrColor(selMonthData.cvr)}}>{fmt(selMonthData.cvr,2)}%</div><div style={c.kS}>conv rate</div></div>}
                    {selMonthData.cpm>0&&<div style={c.kpi}><div style={c.kL}>CPM</div><div style={{...c.kV,fontSize:20}}>{fmt(selMonthData.cpm,0)}</div><div style={c.kS}>RON/1K</div></div>}
                    {selMonthData.orders>0&&<div style={c.kpi}><div style={c.kL}>Comenzi</div><div style={{...c.kV,fontSize:20}}>{selMonthData.orders}</div><div style={c.kS}>Shopify</div></div>}
                    {selMonthData.livrat>0&&<div style={c.kpi}><div style={c.kL}>Livrate</div><div style={{...c.kV,fontSize:20,color:'#22c55e'}}>{selMonthData.livrat}</div><div style={c.kS}>{fmt(selMonthData.livrareRate,1)}%</div></div>}
                    {selMonthData.retur>0&&<div style={c.kpi}><div style={c.kL}>Retururi</div><div style={{...c.kV,fontSize:20,color:'#ef4444'}}>{selMonthData.retur}</div><div style={c.kS}>{fmt(selMonthData.returRate,1)}%</div></div>}
                  </div>

                  {/* Concluzia lunii */}
                  <div style={{padding:'12px 14px',borderRadius:10,background:cpaBg(selMonthData.cpa),border:`1px solid ${selMonthData.cpa<=65?'rgba(34,197,94,0.2)':selMonthData.cpa<=85?'rgba(251,191,36,0.2)':'rgba(239,68,68,0.2)'}`,marginBottom:10}}>
                    <div style={{fontSize:13,fontWeight:700,color:'var(--c-text)',marginBottom:6}}>
                      {selMonthData.cpa<=0?'📊 Date Meta indisponibile pentru această lună':
                       selMonthData.cpa<=52?'🏆 Lună excepțională — sub recordul de 52 RON CPA':
                       selMonthData.cpa<=65?'✅ Lună foarte bună — aproape de target optim':
                       selMonthData.cpa<=80?'⚠️ Lună medie — potențial de optimizare':
                       '❌ Lună slabă — analizați ce a mers greșit'}
                    </div>
                    <div style={{fontSize:12,color:'var(--c-text3)',lineHeight:1.7}}>
                      {selMonthData.ctr>0&&`CTR: ${fmt(selMonthData.ctr,2)}% ${selMonthData.ctr>=3?'✓ bun':'✗ sub 3% benchmark'} · `}
                      {selMonthData.cvr>0&&`CVR: ${fmt(selMonthData.cvr,2)}% ${selMonthData.cvr>=1.2?'✓':'✗ sub 1.2%'} · `}
                      {selMonthData.freq>0&&`Frecvență: ${fmt(selMonthData.freq,2)} ${selMonthData.freq>2.5?'⚠️ audiență obosită':''} · `}
                      {selMonthData.returRate>0&&`Retur: ${fmt(selMonthData.returRate,1)}% ${selMonthData.returRate>20?'🔴 ridicat':'✓'}`}
                    </div>
                  </div>

                  {/* Ce să faci diferit */}
                  {selMonthData.cpa>65&&(
                    <div style={{fontSize:12,color:'var(--c-text3)',lineHeight:1.8}}>
                      <div style={{fontWeight:700,color:'var(--c-text)',marginBottom:6}}>📋 Ce să faci diferit:</div>
                      {selMonthData.ctr<2.5&&<div>• CTR {fmt(selMonthData.ctr,2)}% → Schimbă hook-ul video. Primele 3 secunde nu opresc scroll-ul.</div>}
                      {selMonthData.cvr<1&&<div>• CVR {fmt(selMonthData.cvr,2)}% → Problema e pe landing page. Verifică viteza, recenzii, CTA.</div>}
                      {selMonthData.freq>2.5&&<div>• Frecvență {fmt(selMonthData.freq,2)} → Audiența e obosită. Extinde sau schimbă creativele.</div>}
                      {selMonthData.cpm>22&&<div>• CPM {fmt(selMonthData.cpm,0)} RON → Competiție mare. Testează audiențe mai largi sau broad.</div>}
                      {selMonthData.returRate>20&&<div>• Retur {fmt(selMonthData.returRate,1)}% → Verifică concordanța reclame vs. produs real.</div>}
                    </div>
                  )}
                </div>
              )}

              {/* Full table */}
              <div style={{...c.card,overflowX:'auto'}}>
                <div style={c.cardHdr}>TABEL COMPLET</div>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                  <thead><tr>{['Lună','Cheltuit','Conv','CPA Meta','CPA Real','CTR','CVR','Comenzi','Livrate','Retururi','% Livr','% Retur','Venituri','Grade'].map(h=><th key={h} style={c.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {combined.map(m=>{
                      const g=grade(m.cpa);
                      return(
                        <tr key={m.key} style={c.row(selMonth===m.key)} onClick={()=>toggleMonth(m.key)}>
                          <td style={c.td(true,'var(--c-text)')}>{m.short}</td>
                          <td style={c.td(false,'var(--c-orange)')}>{m.spent>0?fmt(m.spent,0):'-'}</td>
                          <td style={c.td()}>{m.conv||'-'}</td>
                          <td style={c.td(true,m.cpa>0?cpaColor(m.cpa):'var(--c-text4)')}>{m.cpa>0?fmt(m.cpa,0)+' RON':'-'}</td>
                          <td style={c.td(true,m.realCPA>0?cpaColor(m.realCPA):'var(--c-text4)')}>{m.realCPA>0?fmt(m.realCPA,0)+' RON':'-'}</td>
                          <td style={c.td(false,m.ctr>0?ctrColor(m.ctr):'var(--c-text4)')}>{m.ctr>0?fmt(m.ctr,2)+'%':'-'}</td>
                          <td style={c.td(false,m.cvr>0?cvrColor(m.cvr):'var(--c-text4)')}>{m.cvr>0?fmt(m.cvr,2)+'%':'-'}</td>
                          <td style={c.td()}>{m.orders||'-'}</td>
                          <td style={c.td(false,'#22c55e')}>{m.livrat||'-'}</td>
                          <td style={c.td(false,'#ef4444')}>{m.retur||'-'}</td>
                          <td style={c.td(false,m.livrareRate>=80?'#22c55e':m.livrareRate>=60?'#fbbf24':'#ef4444')}>{m.orders>0?fmt(m.livrareRate,1)+'%':'-'}</td>
                          <td style={c.td(false,m.returRate>20?'#ef4444':m.returRate>10?'#fbbf24':'#22c55e')}>{m.orders>0?fmt(m.returRate,1)+'%':'-'}</td>
                          <td style={c.td()}>{m.rev>0?fmtK(m.rev)+' RON':'-'}</td>
                          <td style={{...c.td(true,g.color),fontSize:14}}>{g.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ══ CAMPAIGNS ══ */}
          {tab==='campaigns'&&meta&&(
            <>
              {/* Top vs Bottom */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                <div style={c.card}>
                  <div style={c.cardHdr}>🏆 TOP campanii (CPA ≤ 65 RON)</div>
                  <div style={{fontSize:11,color:'var(--c-text4)',marginBottom:10}}>Ce au în comun: CTR ~3%+ și CVR ~1.3%+</div>
                  {campAnalysis.top.slice(0,6).map((camp,i)=>(
                    <div key={i} style={{marginBottom:12,paddingBottom:12,borderBottom:'1px solid var(--c-border2)'}}>
                      <div style={{fontSize:11,fontWeight:700,color:'var(--c-text)',marginBottom:4,wordBreak:'break-word'}}>{camp.camp.replace(/CBO |cbo /gi,'')}</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                        <span style={{...c.badge('green'),fontSize:10}}>CPA {fmt(camp.cpa,0)} RON</span>
                        <span style={{...c.badge(camp.ctr>=3?'green':'yellow'),fontSize:10}}>CTR {fmt(camp.ctr,2)}%</span>
                        <span style={{...c.badge(camp.cvr>=1.2?'green':'yellow'),fontSize:10}}>CVR {fmt(camp.cvr,2)}%</span>
                        <span style={{fontSize:10,color:'var(--c-text4)'}}>{camp.conv} conv · {fmt(camp.spent,0)} RON</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={c.card}>
                  <div style={c.cardHdr}>❌ CAMPANII SLABE (CPA ≥ 100 RON)</div>
                  <div style={{fontSize:11,color:'var(--c-text4)',marginBottom:10}}>Problema comună: CVR sub 0.8% — landing page sau audiență</div>
                  {campAnalysis.bottom.slice(0,6).map((camp,i)=>(
                    <div key={i} style={{marginBottom:12,paddingBottom:12,borderBottom:'1px solid var(--c-border2)'}}>
                      <div style={{fontSize:11,fontWeight:700,color:'var(--c-text)',marginBottom:4,wordBreak:'break-word'}}>{camp.camp.replace(/CBO |cbo /gi,'')}</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                        <span style={{...c.badge('red'),fontSize:10}}>CPA {fmt(camp.cpa,0)} RON</span>
                        <span style={{...c.badge(camp.ctr>=3?'green':'yellow'),fontSize:10}}>CTR {fmt(camp.ctr,2)}%</span>
                        <span style={{...c.badge('red'),fontSize:10}}>CVR {fmt(camp.cvr,2)}%</span>
                        <span style={{fontSize:10,color:'var(--c-text4)'}}>{camp.conv} conv · {fmt(camp.spent,0)} RON</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pattern insight */}
              <div style={{...c.card,marginBottom:12,background:'rgba(249,115,22,0.05)',border:'1px solid rgba(249,115,22,0.2)'}}>
                <div style={c.cardHdr}>🔍 PATTERN — Ce diferențiază TOP de BOTTOM</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                  {[
                    {metric:'CTR mediu TOP',val:`${fmt(campAnalysis.top.reduce((s,c)=>s+c.ctr,0)/(campAnalysis.top.length||1),2)}%`,
                     vs:`${fmt(campAnalysis.bottom.reduce((s,c)=>s+c.ctr,0)/(campAnalysis.bottom.length||1),2)}%`,label:'BOTTOM'},
                    {metric:'CVR mediu TOP',val:`${fmt(campAnalysis.top.reduce((s,c)=>s+c.cvr,0)/(campAnalysis.top.length||1),2)}%`,
                     vs:`${fmt(campAnalysis.bottom.reduce((s,c)=>s+c.cvr,0)/(campAnalysis.bottom.length||1),2)}%`,label:'BOTTOM'},
                    {metric:'CPM mediu TOP',val:`${fmt(campAnalysis.top.reduce((s,c)=>s+c.cpm,0)/(campAnalysis.top.length||1),0)} RON`,
                     vs:`${fmt(campAnalysis.bottom.reduce((s,c)=>s+c.cpm,0)/(campAnalysis.bottom.length||1),0)} RON`,label:'BOTTOM'},
                    {metric:'CPC mediu TOP',val:`${fmt(campAnalysis.top.reduce((s,c)=>s+c.cpc,0)/(campAnalysis.top.length||1),2)} RON`,
                     vs:`${fmt(campAnalysis.bottom.reduce((s,c)=>s+c.cpc,0)/(campAnalysis.bottom.length||1),2)} RON`,label:'BOTTOM'},
                  ].map((p,i)=>(
                    <div key={i}>
                      <div style={{fontSize:10,color:'var(--c-text4)',marginBottom:4}}>{p.metric}</div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:16,fontWeight:800,color:'#22c55e'}}>{p.val}</span>
                        <span style={{fontSize:11,color:'var(--c-text4)'}}>vs.</span>
                        <span style={{fontSize:16,fontWeight:800,color:'#ef4444'}}>{p.vs}</span>
                        <span style={{fontSize:10,color:'var(--c-text4)'}}>{p.label}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Full campaign table */}
              <div style={{...c.card,overflowX:'auto'}}>
                <div style={c.cardHdr}>TOATE CAMPANIILE</div>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                  <thead><tr>{['Campanie','Cheltuit','Conv','CPA','CTR','CVR','ATC%','CPC','CPM','Reach'].map(h=><th key={h} style={c.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {campAnalysis.all.map((camp,i)=>(
                      <tr key={i}>
                        <td style={{...c.td(false,'var(--c-text)'),maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',fontWeight:600}}>{camp.camp.replace(/CBO |cbo /gi,'')}</td>
                        <td style={c.td(false,'var(--c-orange)')}>{fmt(camp.spent,0)}</td>
                        <td style={c.td()}>{camp.conv}</td>
                        <td style={c.td(true,cpaColor(camp.cpa))}>{camp.cpa>0?fmt(camp.cpa,0):'-'}</td>
                        <td style={c.td(false,ctrColor(camp.ctr))}>{fmt(camp.ctr,2)}%</td>
                        <td style={c.td(false,cvrColor(camp.cvr))}>{fmt(camp.cvr,2)}%</td>
                        <td style={c.td()}>{fmt(camp.atcRate,2)}%</td>
                        <td style={c.td()}>{fmt(camp.cpc,2)}</td>
                        <td style={c.td()}>{fmt(camp.cpm,0)}</td>
                        <td style={c.td()}>{fmtK(camp.reach)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ══ AUDIENCE ══ */}
          {tab==='audience'&&meta&&(
            <>
              <div style={{...c.card,marginBottom:12}}>
                <div style={c.cardHdr}>BREAKDOWN PE VÂRSTĂ — Cine cumpără și la ce cost</div>
                {meta.ageArr.filter(a=>a.spent>50).map((a,i)=>{
                  const maxSpent=Math.max(...meta.ageArr.map(x=>x.spent));
                  const pct=a.spent/maxSpent*100;
                  return(
                    <div key={i} style={{marginBottom:16}}>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:5}}>
                        <span style={{fontWeight:700,color:'var(--c-text)',fontSize:14}}>{a.age} ani</span>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                          <span style={{...c.badge(a.cpa<=70?'green':a.cpa<=90?'yellow':'red'),fontSize:11}}>CPA {a.cpa>0?fmt(a.cpa,0)+' RON':'—'}</span>
                          <span style={{...c.badge(''),fontSize:10,color:'var(--c-text4)'}}>{fmt(a.pct,1)}% din buget</span>
                        </div>
                      </div>
                      <div style={c.barTrk}>
                        <div style={c.barFl(pct,a.cpa<=65?'#22c55e':a.cpa<=80?'#fbbf24':'#ef4444')}>
                          {pct>30&&<span style={c.barV}>{fmt(a.spent,0)} RON · {a.conv} conv</span>}
                        </div>
                      </div>
                      {pct<=30&&<div style={{fontSize:11,color:'var(--c-text3)',marginTop:3}}>{fmt(a.spent,0)} RON · {a.conv} conversii · CTR {fmt(a.ctr,2)}%</div>}
                    </div>
                  );
                })}

                <div style={{marginTop:12,padding:'12px 14px',background:'rgba(249,115,22,0.07)',borderRadius:8}}>
                  <div style={{fontSize:12,fontWeight:700,color:'var(--c-text)',marginBottom:8}}>📊 Concluzie audiențe</div>
                  <div style={{fontSize:12,color:'var(--c-text3)',lineHeight:1.8}}>
                    {(() => {
                      const best=meta.ageArr.filter(a=>a.conv>=5).sort((a,b)=>a.cpa-b.cpa)[0];
                      const worst=meta.ageArr.filter(a=>a.conv>=5).sort((a,b)=>b.cpa-a.cpa)[0];
                      const biggest=meta.ageArr.sort((a,b)=>b.spent-a.spent)[0];
                      return(<>
                        <div>✅ <strong style={{color:'var(--c-text)'}}>{best?.age} ani</strong> — cel mai ieftin CPA ({best?fmt(best.cpa,0):'-'} RON). Mărește bugetul pe acest segment.</div>
                        <div>⚠️ <strong style={{color:'var(--c-text)'}}>{worst?.age} ani</strong> — cel mai scump CPA ({worst?fmt(worst.cpa,0):'-'} RON). Reduce-l sau exclude-l.</div>
                        <div>💰 <strong style={{color:'var(--c-text)'}}>{biggest?.age} ani</strong> — {fmt(biggest?.pct||0,1)}% din bugetul total cheltuit pe ei. Verifică dacă e proporțional cu performanța.</div>
                      </>);
                    })()}
                  </div>
                </div>
              </div>

              {/* Age per month */}
              <div style={{...c.card,overflowX:'auto'}}>
                <div style={c.cardHdr}>STRATEGIA DE BUGET PE AUDIENȚE — Recomandată</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:8}}>
                  {[
                    {age:'25-34',rec:'5-8% buget',why:'CPA variabil. Potential viitor.',action:'Menții',color:'var(--c-text4)'},
                    {age:'35-44',rec:'15-20% buget',why:'CPA mediu, volum bun.',action:'Stabil',color:'#fbbf24'},
                    {age:'45-54',rec:'35-40% buget',why:'Cel mai mare volum + CPA decent.',action:'Scalează',color:'#22c55e'},
                    {age:'55-64',rec:'25-30% buget',why:'Al doilea ca volum.',action:'Optimizează',color:'#fbbf24'},
                    {age:'65+',rec:'10-12% buget',why:'CPA variabil, volum mic.',action:'Testează',color:'var(--c-text4)'},
                  ].map((a,i)=>(
                    <div key={i} style={{...c.kpi,borderColor:a.color==='#22c55e'?'rgba(34,197,94,0.3)':'var(--c-border2)'}}>
                      <div style={{fontSize:16,fontWeight:800,color:'var(--c-text)',marginBottom:4}}>{a.age} ani</div>
                      <div style={{fontSize:13,fontWeight:700,color:a.color,marginBottom:4}}>{a.rec}</div>
                      <div style={{fontSize:11,color:'var(--c-text4)',marginBottom:6}}>{a.why}</div>
                      <span style={{...c.badge(a.color==='#22c55e'?'green':a.color==='#ef4444'?'red':'yellow'),fontSize:10}}>{a.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ══ DOW & HOURLY ══ */}
          {tab==='dow'&&(
            <>
              {/* Meta CPA by DOW */}
              {meta&&(
                <div style={{...c.card,marginBottom:12}}>
                  <div style={c.cardHdr}>CPA META PE ZI — unde câștigi vs. unde pierzi bani</div>
                  {meta.dowArr.map((d,i)=>{
                    const maxCPA=Math.max(...meta.dowArr.filter(x=>x.cpa>0).map(x=>x.cpa),1);
                    const pct=d.cpa?d.cpa/maxCPA*100:0;
                    return(
                      <div key={i} style={c.bar}>
                        <div style={{...c.barLbl,width:58}}>{DAYS_SHORT[i]}</div>
                        <div style={c.barTrk}>
                          <div style={c.barFl(pct,cpaColor(d.cpa))}>
                            {pct>28&&<span style={c.barV}>{fmt(d.cpa,0)} RON</span>}
                          </div>
                        </div>
                        {pct<=28&&<span style={{fontSize:11,color:d.cpa>0?cpaColor(d.cpa):'var(--c-text4)',fontWeight:700,minWidth:60}}>{d.cpa>0?fmt(d.cpa,0)+' RON':'—'}</span>}
                        <div style={{display:'flex',gap:6,minWidth:90,justifyContent:'flex-end'}}>
                          <span style={{fontSize:10,color:'var(--c-text4)'}}>{d.conv} conv</span>
                          <span style={{...c.badge(d.cpa<=65?'green':d.cpa<=85?'yellow':'red'),fontSize:10}}>{fmt(d.ctr,2)}% CTR</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Orders by DOW */}
              {ord&&(
                <div style={{...c.card,marginBottom:12,overflowX:'auto'}}>
                  <div style={c.cardHdr}>COMENZI SHOPIFY PE ZI</div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead><tr>{['Zi','Comenzi','Livrate','Retururi','% Livr','% Retur','Venituri'].map(h=><th key={h} style={c.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {ord.dowArr.map((d,i)=>(
                        <tr key={i}>
                          <td style={c.td(true,'var(--c-text)')}>{DAYS_FULL[i]}</td>
                          <td style={c.td()}>{d.cnt||'-'}</td>
                          <td style={c.td(false,'#22c55e')}>{d.livrat||'-'}</td>
                          <td style={c.td(false,'#ef4444')}>{d.retur||'-'}</td>
                          <td style={c.td(false,d.livrareRate>=80?'#22c55e':'#fbbf24')}>{d.cnt?fmt(d.livrareRate,1)+'%':'-'}</td>
                          <td style={c.td(false,d.returRate>20?'#ef4444':d.returRate>10?'#fbbf24':'#22c55e')}>{d.cnt?fmt(d.returRate,1)+'%':'-'}</td>
                          <td style={c.td()}>{d.rev>0?fmtK(d.rev)+' RON':'-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Hourly */}
              {ord&&(
                <div style={c.card}>
                  <div style={c.cardHdr}>CÂND CUMPĂRĂ CLIENȚII TĂI — pe oră</div>
                  <div style={{display:'flex',alignItems:'flex-end',gap:3,height:120,marginBottom:8,overflowX:'auto'}}>
                    {ord.byHour.map(h=>{
                      const maxCnt=Math.max(...ord.byHour.map(x=>x.cnt),1);
                      const pct=h.cnt/maxCnt;
                      return(
                        <div key={h.hour} style={{flex:1,minWidth:14,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                          {h.cnt>0&&<div style={{fontSize:8,color:'var(--c-text4)',fontWeight:600}}>{h.cnt}</div>}
                          <div style={{width:'100%',height:`${Math.max(pct*100,2)}px`,background:pct>0.6?'var(--c-orange)':pct>0.3?'rgba(249,115,22,0.5)':'var(--c-card2)',borderRadius:'2px 2px 0 0',minHeight:2}}/>
                          <div style={{fontSize:8,color:'var(--c-text4)'}}>{pad2(h.hour)}</div>
                        </div>
                      );
                    })}
                  </div>
                  {(() => {
                    const sorted=[...ord.byHour].sort((a,b)=>b.cnt-a.cnt);
                    const top3=sorted.slice(0,3).map(h=>`${pad2(h.hour)}:00`).join(' · ');
                    return <div style={{fontSize:12,color:'var(--c-text3)'}}>🕐 Ore de vârf: <strong style={{color:'var(--c-text)'}}>{top3}</strong> — programează reclamele activ în aceste intervale</div>;
                  })()}
                </div>
              )}

              {/* Budget strategy */}
              <div style={{...c.card,marginTop:10}}>
                <div style={c.cardHdr}>📋 CALENDARUL OPTIM DE BUGET</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:6}}>
                  {[
                    {d:'Lun',b:'-20%',c:'#fbbf24',n:'Monitorizezi'},
                    {d:'Mar',b:'STD', c:'var(--c-text3)',n:'Normal'},
                    {d:'Mie',b:'+30%',c:'#22c55e',n:'MAXIM'},
                    {d:'Joi',b:'+20%',c:'#22c55e',n:'Momentum'},
                    {d:'Vin',b:'-30%',c:'#f97316',n:'Reduci'},
                    {d:'Sâm',b:'MIN', c:'var(--c-text4)',n:'Menții'},
                    {d:'Dum',b:'+25%',c:'#22c55e',n:'Start CBO'},
                  ].map((x,i)=>(
                    <div key={i} style={{textAlign:'center',padding:'10px 4px',background:'var(--c-card2)',borderRadius:8,border:'1px solid var(--c-border2)'}}>
                      <div style={{fontSize:10,color:'var(--c-text4)',marginBottom:4}}>{x.d}</div>
                      <div style={{fontSize:15,fontWeight:800,color:x.c,marginBottom:3}}>{x.b}</div>
                      <div style={{fontSize:8,color:'var(--c-text4)',lineHeight:1.3}}>{x.n}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ══ PROFIT LUNAR ══ */}
          {tab==='profit'&&(
            <ProfitTab
              combined={combined}
              ord={ord}
              meta={meta}
              stockMap={stockMap}
              stockFile={stockFile}
              openStockPicker={openStockPicker}
              transportGLS={transportGLS} setTransportGLS={setTransportGLS}
              transportSD={transportSD} setTransportSD={setTransportSD}
              metaAdSpend={metaAdSpend} setMetaAdSpend={setMetaAdSpend}
              fixedCosts={fixedCosts} setFixedCosts={setFixedCosts}
              shopifyFee={shopifyFee} setShopifyFee={setShopifyFee}
              TVA_RATE={TVA_RATE}
            />
          )}

          {/* ══ INSIGHTS ══ */}
          {tab==='insights'&&(
            <>
              {insights.length===0&&(
                <div style={{...c.card,textAlign:'center',padding:40}}>
                  <div style={{fontSize:32,marginBottom:10}}>💡</div>
                  <div style={{color:'var(--c-text3)'}}>Importează CSV Meta pentru insight-uri personalizate.</div>
                </div>
              )}
              {insights.map((ins,i)=>(
                <div key={i} style={c.insight(ins.type)}>
                  <div style={{display:'flex',gap:10}}>
                    <span style={{fontSize:18,flexShrink:0}}>{ins.icon}</span>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:'var(--c-text)',marginBottom:3}}>{ins.title}</div>
                      <div style={{fontSize:12,color:'var(--c-text3)',lineHeight:1.6}}>{ins.body}</div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Playbook */}
              <div style={c.card}>
                <div style={c.cardHdr}>🏆 PLAYBOOK EXPERT — Top 10% Meta Advertisers</div>
                {[
                  {t:'Structura campaniei corecte',b:'1 CBO per produs. 1 Ad Set broad (fără interese). 3-5 aduri cu creative diferite. Lași Meta să decidă. Nu forța audiențe manuale.'},
                  {t:'Regula celor 50 de conversii',b:'Meta are nevoie de minim 50 conversii per ad set per săptămână ca să iasă din learning. Sub 50 = nu optimizezi, arunci bani.'},
                  {t:'CTR benchmark pentru smartwatch',b:'CTR sub 2.5% = hook slab. 2.5-3.5% = decent. Peste 3.5% = excelent. Dacă CTR e mare dar CVR e mic, problema e pe landing page, nu pe reclame.'},
                  {t:'CVR benchmark pentru COD România',b:'1%+ e decent. 1.3%+ e bun. 1.5%+ e excelent. Sub 0.8% = ceva nu funcționează pe pagina produsului sau există discrepanță produs-reclame.'},
                  {t:'Frecvența ideală',b:'1.5-2.0 e zona optimă. Sub 1.5 = audiență prea mare sau reach limitat. Peste 2.5 = audiență obosită, schimbă creativele sau extinde audiența.'},
                  {t:'Când să scalezi',b:'CPA stabil sub 70 RON timp de 7 zile consecutive. Mărire buget max 20% odată. Aștepți 3-5 zile între măriri. Nu mărești și nu editezi simultan.'},
                  {t:'Semnalul că o campanie trebuie oprită',b:'CPA de 2x+ față de target după 7 zile și minim 3000 RON cheltuit. Înainte de asta, nu tragi concluzii — algoritmul e în learning.'},
                  {t:'Testarea creativelor ca un expert',b:'Testezi un element odată: hook diferit, nu video nou complet. Rezultat valid după minim 5 conversii per variantă. Câștigătorul se scalează, losserul se oprește.'},
                ].map((p,i)=>(
                  <div key={i} style={{display:'flex',gap:10,padding:'11px 0',borderBottom:i<7?'1px solid var(--c-border2)':'none'}}>
                    <div style={{width:20,height:20,borderRadius:'50%',background:'var(--c-orange)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:800,flexShrink:0,marginTop:1}}>{i+1}</div>
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:'var(--c-text)',marginBottom:3}}>{p.t}</div>
                      <div style={{fontSize:11,color:'var(--c-text3)',lineHeight:1.6}}>{p.b}</div>
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

/* ══════════════════════════════════════════════════════════════════════════
   PROFIT TAB COMPONENT
   Formula exactă din profit/page.js:
   Net = Revenue(livrate) - COGS - Transport(GLS+SD+retur) - Marketing - Fixe
══════════════════════════════════════════════════════════════════════════ */
function ProfitTab({combined,ord,meta,stockMap,stockFile,openStockPicker,
  transportGLS,setTransportGLS,transportSD,setTransportSD,
  metaAdSpend,setMetaAdSpend,fixedCosts,setFixedCosts,
  shopifyFee,setShopifyFee,TVA_RATE}){

  const fmt=(n,d=2)=>Number(n||0).toLocaleString('ro-RO',{minimumFractionDigits:d,maximumFractionDigits:d});
  const fmtK=(n)=>Math.abs(n)>=1000?(n/1000).toFixed(1)+'K':fmt(n,0);
  const pn=(v)=>parseFloat(String(v||'0').replace(/[^\d.-]/g,''))||0;

  const hasStock=Object.keys(stockMap).length>0;

  /* ── resolveCost: identic cu profit/page.js ──────────────────────────
     Prioritate: stockMap(XLS) > glamx_std_costs(localStorage) > DEFAULT  */
  const stdCosts = useMemo(()=>{
    try{
      const s=localStorage.getItem('glamx_std_costs');
      return s?JSON.parse(s):[];
    }catch{return[];}
  },[stockMap]); // re-read when stock imported

  function resolveCost(itemName, itemSku){
    const nameKey=(itemName||'').toLowerCase().trim();
    const skuKey=(itemSku||'').toLowerCase().trim();

    // 1. stockMap din XLS SmartBill (cel mai precis — CMP real)
    if(hasStock){
      // exact SKU
      if(skuKey&&stockMap[itemSku]) return stockMap[itemSku].cost;
      // case-insensitive SKU
      if(skuKey){
        const found=Object.keys(stockMap).find(k=>k.toLowerCase()===skuKey);
        if(found) return stockMap[found].cost;
      }
      // SKU prefix (DM56-NEGRU → DM56)
      if(skuKey){
        const found=Object.keys(stockMap).find(k=>{
          const b=k.toLowerCase();
          return b.length>=2&&(skuKey===b||skuKey.startsWith(b+'-')||skuKey.startsWith(b+'/'));
        });
        if(found) return stockMap[found].cost;
      }
    }

    // 2. glamx_std_costs din localStorage (setat de profit/page.js)
    if(stdCosts.length){
      const getCVal=(s)=>typeof s.cost==='number'?s.cost:parseFloat(s.cost)||0;
      // exact SKU
      if(skuKey){
        const ex=stdCosts.find(s=>(s.sku||s.id||'').toLowerCase()===skuKey);
        if(ex) return getCVal(ex);
      }
      // SKU prefix
      if(skuKey){
        const pr=stdCosts.find(s=>{
          const b=(s.sku||s.id||'').toLowerCase();
          return b.length>=2&&(skuKey===b||skuKey.startsWith(b+'-')||skuKey.startsWith(b+'/'));
        });
        if(pr) return getCVal(pr);
      }
      // pattern match pe nume (sortat desc dupa lungime)
      const byLen=[...stdCosts].sort((a,b)=>(b.pattern||'').length-(a.pattern||'').length);
      for(const s of byLen){
        const pat=(s.pattern||'').toLowerCase().trim();
        if(!pat||pat.length<3) continue;
        if(nameKey.includes(pat)){
          const excl=(s.excludes||[]).some(ex=>nameKey.includes(ex.toLowerCase()));
          if(!excl) return getCVal(s);
        }
      }
      // SKU apare în nume
      for(const s of byLen){
        const sk=(s.sku||s.id||'').toLowerCase();
        if(sk.length>=2&&nameKey.includes(sk)) return getCVal(s);
      }
    }

    // 3. DEFAULT hardcodat (ultimul fallback)
    const DEF={
      DM56:158.95,DM58:164.16,DM59:184.96,DM76:162.05,M99:319.06,
      'BW-2GRI':203.15,'BW-2NEGRU':203.15,HD300PRO:181.00,SK41:112.73,
      WATCHX:115.27,Z85BLACK:72.30,'WS-1-B':63.76,U8:207.89,
      EARBUDS1:20.83,EARBUDS2:20.79,G69:93.77,TG19:88.83,VITRO:104.68,
      WBAND:16.91,'WBAND-M':10.55,'WBAND-P':10.55,FAN1:31.17,
      XPERTCHEMY:23.45,X122:87.67,SET1:72.96,SET2:23.77,
      CP1:32.84,HUSA1:42.54,LED3IN1:47.13,SMC2:42.84,
      SMSWV4:62.26,SMSWCSV1:70.21,DM56b:158.95,DM56c:158.95,
    };
    if(skuKey){
      const k=itemSku||'';
      if(DEF[k]) return DEF[k];
      // prefix match in DEF
      const found=Object.keys(DEF).find(d=>skuKey===d.toLowerCase()||skuKey.startsWith(d.toLowerCase()+'-'));
      if(found) return DEF[found];
    }
    // name contains default key
    for(const [k,v] of Object.entries(DEF)){
      if(nameKey.includes(k.toLowerCase())) return v;
    }
    return 0;
  }

  /* ── Calculate COGS per order ─────────────────────────────────────── */
  function calcOrderCOGS(order){
    const items=order.items||order.line_items||[];
    if(items.length>0){
      return items.reduce((s,item)=>{
        const name=item.name||item.title||item.product_title||'';
        const sku=item.sku||item.variant_sku||'';
        const qty=item.quantity||item.qty||1;
        return s+resolveCost(name,sku)*qty;
      },0);
    }
    // fallback: no items — resolve from order title/name
    const name=order.title||order.name||order.product_title||'';
    const sku=order.sku||order.variant_sku||'';
    return resolveCost(name,sku);
  }

  /* ── Per-month profit calc ──────────────────────────────────────────── */
  const profitMonths=useMemo(()=>{
    if(!combined.length) return[];
    const glsMap=getGlsMap(),sdMap=getSdMap();
    const pad2=n=>String(n).padStart(2,'0');
    const allOrders=(()=>{
      try{
        const sk=getShopKey();
        const raw=localStorage.getItem(ordersKey(sk))||localStorage.getItem('gx_orders_60')||localStorage.getItem('gx_orders');
        return raw?JSON.parse(raw):[];
      }catch{return[];}
    })();

    return combined.map(m=>{
      const mKey=m.key;
      const mOrders=allOrders.filter(o=>{
        const d=new Date(o.createdAt||o.created_at||'');
        if(isNaN(d)) return false;
        return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`===mKey;
      });

      const mLivrate=mOrders.filter(o=>getFinalStatus(o,glsMap,sdMap)==='livrat');
      const mRetur  =mOrders.filter(o=>getFinalStatus(o,glsMap,sdMap)==='retur');

      // REVENUE = suma comenzilor livrate (ce a intrat în cont)
      const revenue=mLivrate.reduce((s,o)=>s+pn(o.total||o.totalPrice||o.total_price||0),0);

      // COGS = cost produse pentru comenzile livrate
      const cogs=mLivrate.reduce((s,o)=>s+calcOrderCOGS(o),0);

      // TRANSPORT = GLS + SameDay + transport retururi
      const glsCount=mLivrate.filter(o=>o.courier!=='sameday').length;
      const sdCount =mLivrate.filter(o=>o.courier==='sameday').length;
      const returCount=mRetur.length;
      const transport=(glsCount*pn(transportGLS))+(sdCount*pn(transportSD))+(returCount*pn(transportGLS));

      // MARKETING = din CSV Meta (prioritate) sau manual
      const marketing=m.spent>0?m.spent:pn(metaAdSpend);

      // CHELTUIELI FIXE
      const fixe=pn(fixedCosts);

      // NET PROFIT
      const totalCosts=cogs+transport+marketing+fixe;
      const netProfit=revenue-totalCosts;
      const margin=revenue>0?netProfit/revenue*100:0;
      const roas=marketing>0?revenue/marketing:0;
      const cogsResolved=mLivrate.filter(o=>calcOrderCOGS(o)>0).length;

      // TVA — 21% pe Meta Ads + 21% pe Shopify fee lunar
      const tvaMarketing=marketing*TVA_RATE;
      const tvaShopify=pn(shopifyFee)*TVA_RATE;
      const totalTVA=tvaMarketing+tvaShopify;
      const netProfitAfterTVA=netProfit-totalTVA;
      const marginAfterTVA=revenue>0?netProfitAfterTVA/revenue*100:0;

      return{...m,revenue,cogs,transport,marketing,fixe,totalCosts,netProfit,margin,roas,
        totalTVA,tvaMarketing,tvaShopify,netProfitAfterTVA,marginAfterTVA,
        ordersLivrate:mLivrate.length,ordersRetur:mRetur.length,
        cogsResolved,cogsMissing:mLivrate.length-cogsResolved,
        cogsPct:revenue>0?cogs/revenue*100:0,
        transportPct:revenue>0?transport/revenue*100:0,
        marketingPct:revenue>0?marketing/revenue*100:0,
      };
    }).filter(m=>m.revenue>0||m.spent>0);
  },[combined,stockMap,stdCosts,transportGLS,transportSD,metaAdSpend,fixedCosts]);

  const totalRev      =profitMonths.reduce((s,m)=>s+m.revenue,0);
  const totalNet      =profitMonths.reduce((s,m)=>s+m.netProfit,0);
  const totalCOGS     =profitMonths.reduce((s,m)=>s+m.cogs,0);
  const totalTrans    =profitMonths.reduce((s,m)=>s+m.transport,0);
  const totalMkt      =profitMonths.reduce((s,m)=>s+m.marketing,0);
  const totalFixe     =profitMonths.reduce((s,m)=>s+m.fixe,0);
  const totalTVA      =profitMonths.reduce((s,m)=>s+m.totalTVA,0);
  const totalTVAMkt   =profitMonths.reduce((s,m)=>s+m.tvaMarketing,0);
  const totalTVAShop  =profitMonths.reduce((s,m)=>s+m.tvaShopify,0);
  const totalNetTVA   =profitMonths.reduce((s,m)=>s+m.netProfitAfterTVA,0);
  const avgMargin     =totalRev>0?totalNet/totalRev*100:0;
  const avgMarginTVA  =totalRev>0?totalNetTVA/totalRev*100:0;
  const cogsCoverage=profitMonths.length>0?profitMonths.reduce((s,m)=>s+m.cogsResolved,0)/Math.max(profitMonths.reduce((s,m)=>s+m.ordersLivrate,0),1)*100:0;

  function saveS(k,v){try{localStorage.setItem(k,String(v));}catch{}}

  const S={
    card:{background:'var(--c-card)',border:'1px solid var(--c-border2)',borderRadius:12,padding:'14px',marginBottom:12},
    hdr:{fontSize:10,fontWeight:800,color:'var(--c-text4)',letterSpacing:'0.07em',textTransform:'uppercase',marginBottom:12},
    kpi:{background:'var(--c-card)',border:'1px solid var(--c-border2)',borderRadius:10,padding:'12px 14px'},
    kL:{fontSize:10,color:'var(--c-text4)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:5},
    kV:{fontSize:22,fontWeight:800,color:'var(--c-text)',lineHeight:1},
    kS:{fontSize:11,color:'var(--c-text3)',marginTop:4},
    th:{textAlign:'left',padding:'7px 10px',fontSize:10,fontWeight:800,color:'var(--c-text4)',textTransform:'uppercase',letterSpacing:'0.05em',borderBottom:'1px solid var(--c-border2)',whiteSpace:'nowrap'},
    td:(bold,color)=>({padding:'8px 10px',borderBottom:'1px solid var(--c-border2)',color:color||'var(--c-text2)',fontWeight:bold?700:400,fontSize:12,whiteSpace:'nowrap'}),
    inp:{background:'var(--c-card2)',border:'1px solid var(--c-border2)',borderRadius:8,padding:'8px 12px',color:'var(--c-text)',fontSize:13,width:'100%',outline:'none'},
    pC:(n)=>n>0?'#22c55e':n>-500?'#fbbf24':'#ef4444',
    mC:(n)=>n>=20?'#22c55e':n>=10?'#fbbf24':n>=0?'#f97316':'#ef4444',
  };

  const srcInfo = stdCosts.length>0
    ? `✓ ${stdCosts.length} produse din glamx_std_costs`
    : 'Fără costuri — importează XLS sau setează în Profit page';

  return(
    <div>
      {/* ── Settings ── */}
      <div style={S.card}>
        <div style={S.hdr}>⚙️ SETĂRI CALCUL</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:14}}>
          <div>
            <div style={{fontSize:11,color:'var(--c-text3)',marginBottom:4}}>Transport GLS / colet (RON)</div>
            <input style={S.inp} type="number" value={transportGLS}
              onChange={e=>{setTransportGLS(pn(e.target.value));saveS('glamx_transport_per_parcel',e.target.value);}} step="0.5"/>
          </div>
          <div>
            <div style={{fontSize:11,color:'var(--c-text3)',marginBottom:4}}>Transport SameDay / colet (RON)</div>
            <input style={S.inp} type="number" value={transportSD}
              onChange={e=>{setTransportSD(pn(e.target.value));saveS('glamx_sd_transport',e.target.value);}} step="0.5"/>
          </div>
          <div>
            <div style={{fontSize:11,color:'var(--c-text3)',marginBottom:4}}>Cheltuieli fixe / lună (RON)</div>
            <input style={S.inp} type="number" value={fixedCosts}
              onChange={e=>{setFixedCosts(pn(e.target.value));saveS('glamx_fixed_manual',e.target.value);}} step="10"/>
          </div>
          <div>
            <div style={{fontSize:11,color:'var(--c-text3)',marginBottom:4}}>Meta spend manual (fără CSV)</div>
            <input style={S.inp} type="number" value={metaAdSpend} placeholder="Ex: 11433"
              onChange={e=>{setMetaAdSpend(e.target.value);saveS('glamx_meta_cost',e.target.value);}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:'var(--c-text3)',marginBottom:4}}>Shopify fee / lună (TVA 21%)</div>
            <input style={S.inp} type="number" value={shopifyFee} placeholder="300"
              onChange={e=>{setShopifyFee(pn(e.target.value));saveS('glamx_shopify_fee_manual',e.target.value);}}/>
          </div>
        </div>

        {/* Stock import */}
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',paddingTop:10,borderTop:'1px solid var(--c-border2)'}}>
          <button onClick={openStockPicker} style={{padding:'8px 14px',borderRadius:8,background:'#22c55e',color:'#000',border:'none',fontSize:12,fontWeight:700,cursor:'pointer'}}>
            📊 Import Stoc XLS (SmartBill)
          </button>
          {stockFile
            ?<span style={{fontSize:11,color:'#22c55e',fontWeight:700}}>✓ {stockFile} · {Object.keys(stockMap).length} SKU-uri</span>
            :<span style={{fontSize:11,color:'var(--c-text4)'}}>{srcInfo}</span>
          }
        </div>

        {/* Coverage warning */}
        {profitMonths.length>0&&cogsCoverage<80&&(
          <div style={{marginTop:10,padding:'10px 12px',background:'rgba(251,191,36,0.08)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:8,fontSize:12,color:'#fbbf24'}}>
            ⚠️ COGS rezolvat pentru {fmt(cogsCoverage,1)}% din comenzi. Importează XLS SmartBill sau verifică că ai setat costurile în pagina Profit pentru acoperire completă.
          </div>
        )}
        {profitMonths.length>0&&cogsCoverage>=80&&(
          <div style={{marginTop:10,padding:'10px 12px',background:'rgba(34,197,94,0.07)',border:'1px solid rgba(34,197,94,0.2)',borderRadius:8,fontSize:12,color:'#22c55e'}}>
            ✅ COGS rezolvat pentru {fmt(cogsCoverage,1)}% din comenzi — calcul profit precis.
          </div>
        )}
      </div>

      {/* ── Formula vizuală ── */}
      <div style={{...S.card,background:'rgba(249,115,22,0.04)',border:'1px solid rgba(249,115,22,0.15)'}}>
        <div style={S.hdr}>📐 FORMULA DE CALCUL</div>
        <div style={{fontSize:13,color:'var(--c-text2)',lineHeight:2,fontFamily:'monospace'}}>
          <span style={{color:'#22c55e'}}>Profit Net (înainte TVA)</span> = Încasări livrate<br/>
          &nbsp;&nbsp;&nbsp;&nbsp;− <span style={{color:'#6366f1'}}>COGS</span> (cost produs × cantitate)<br/>
          &nbsp;&nbsp;&nbsp;&nbsp;− <span style={{color:'#fbbf24'}}>Transport</span> (GLS + SameDay + retururi)<br/>
          &nbsp;&nbsp;&nbsp;&nbsp;− <span style={{color:'#f97316'}}>Marketing</span> (Meta Ads)<br/>
          &nbsp;&nbsp;&nbsp;&nbsp;− <span style={{color:'#06b6d4'}}>Fixe</span> (Shopify abonament + Conta)<br/>
          <span style={{color:'#f59e0b'}}>Profit Net (după TVA)</span> = Profit Net<br/>
          &nbsp;&nbsp;&nbsp;&nbsp;− <span style={{color:'#f59e0b'}}>TVA Meta</span> (21% × cheltuieli Meta)<br/>
          &nbsp;&nbsp;&nbsp;&nbsp;− <span style={{color:'#f59e0b'}}>TVA Shopify</span> (21% × {pn(shopifyFee)} RON)
        </div>
      </div>

      {profitMonths.length>0&&(
        <>
          {/* ── KPI totale ── */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:8,marginBottom:12}}>
            <div style={S.kpi}><div style={S.kL}>Venituri</div><div style={{...S.kV,color:'var(--c-orange)'}}>{fmtK(totalRev)}</div><div style={S.kS}>RON livrate</div></div>
            <div style={S.kpi}><div style={S.kL}>COGS</div><div style={{...S.kV,color:'#6366f1'}}>{fmtK(totalCOGS)}</div><div style={S.kS}>RON marfă</div></div>
            <div style={S.kpi}><div style={S.kL}>Transport</div><div style={{...S.kV,color:'#fbbf24'}}>{fmtK(totalTrans)}</div><div style={S.kS}>RON curier</div></div>
            <div style={S.kpi}><div style={S.kL}>Marketing</div><div style={{...S.kV,color:'#f97316'}}>{fmtK(totalMkt)}</div><div style={S.kS}>RON ads</div></div>
            <div style={S.kpi}><div style={S.kL}>Fixe</div><div style={{...S.kV,color:'#06b6d4'}}>{fmtK(totalFixe)}</div><div style={S.kS}>RON/lună</div></div>
            <div style={{...S.kpi,borderColor:'rgba(34,197,94,0.3)'}}><div style={S.kL}>Profit înainte TVA</div><div style={{...S.kV,color:S.pC(totalNet)}}>{fmtK(totalNet)}</div><div style={S.kS}>{fmt(avgMargin,1)}% marjă</div></div>
            <div style={{...S.kpi,borderColor:'rgba(245,158,11,0.4)',background:'rgba(245,158,11,0.05)'}}><div style={S.kL}>TVA de plată</div><div style={{...S.kV,color:'#f59e0b'}}>{fmtK(totalTVA)}</div><div style={S.kS}>Meta + Shopify 21%</div></div>
            <div style={{...S.kpi,borderColor:'rgba(34,197,94,0.5)',background:'rgba(34,197,94,0.06)'}}><div style={S.kL}>🏆 Profit NET după TVA</div><div style={{...S.kV,fontSize:24,color:S.pC(totalNetTVA)}}>{fmtK(totalNetTVA)}</div><div style={S.kS}>{fmt(avgMarginTVA,1)}% marjă reală</div></div>
          </div>

          {/* ── TVA Breakdown ── */}
          <div style={{...S.card,background:'rgba(245,158,11,0.05)',border:'1px solid rgba(245,158,11,0.25)',marginBottom:12}}>
            <div style={S.hdr}>🧾 TVA DE PLATĂ — DETALIU COMPLET</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
              <div style={{textAlign:'center',padding:'12px 8px'}}>
                <div style={{fontSize:11,color:'var(--c-text4)',marginBottom:6}}>TVA Meta Ads (21%)</div>
                <div style={{fontSize:28,fontWeight:800,color:'#f59e0b'}}>{fmtK(totalTVAMkt)}</div>
                <div style={{fontSize:11,color:'var(--c-text3)'}}>RON · {profitMonths.length} luni</div>
                <div style={{fontSize:10,color:'var(--c-text4)',marginTop:4}}>~{fmtK(totalTVAMkt/Math.max(profitMonths.length,1))} RON/lună</div>
              </div>
              <div style={{textAlign:'center',padding:'12px 8px',borderLeft:'1px solid var(--c-border2)',borderRight:'1px solid var(--c-border2)'}}>
                <div style={{fontSize:11,color:'var(--c-text4)',marginBottom:6}}>TVA Shopify ({fmt(pn(shopifyFee),0)} RON × 21%)</div>
                <div style={{fontSize:28,fontWeight:800,color:'#f59e0b'}}>{fmtK(totalTVAShop)}</div>
                <div style={{fontSize:11,color:'var(--c-text3)'}}>RON · {profitMonths.length} luni</div>
                <div style={{fontSize:10,color:'var(--c-text4)',marginTop:4}}>{fmt(pn(shopifyFee)*TVA_RATE,2)} RON/lună</div>
              </div>
              <div style={{textAlign:'center',padding:'12px 8px'}}>
                <div style={{fontSize:11,color:'var(--c-text4)',marginBottom:6}}>TOTAL TVA DE PLATĂ</div>
                <div style={{fontSize:28,fontWeight:800,color:'#f59e0b'}}>{fmtK(totalTVA)}</div>
                <div style={{fontSize:11,color:'var(--c-text3)'}}>RON total perioadă</div>
                <div style={{fontSize:10,color:'var(--c-text4)',marginTop:4}}>~{fmtK(totalTVA/Math.max(profitMonths.length,1))} RON/lună</div>
              </div>
            </div>
            <div style={{padding:'10px 12px',background:'rgba(0,0,0,0.2)',borderRadius:8,fontSize:12,color:'var(--c-text3)',lineHeight:1.7}}>
              💡 <strong style={{color:'var(--c-text)'}}>Cum se calculează:</strong> TVA Meta = cheltuieli Meta × 21% (Facebook emite factură cu TVA din Irlanda, deductibil dacă ești plătitor TVA).
              TVA Shopify = abonament {fmt(pn(shopifyFee),0)} RON × 21% = {fmt(pn(shopifyFee)*TVA_RATE,2)} RON/lună (Shopify Ireland, același mecanism).
            </div>
          </div>

          {/* ── Grafic profit net ── */}
          <div style={S.card}>
            <div style={S.hdr}>PROFIT NET PE LUNĂ</div>
            {profitMonths.map(m=>{
              const maxA=Math.max(...profitMonths.map(x=>Math.abs(x.netProfit)),1);
              const pct=Math.abs(m.netProfit)/maxA*100;
              const col=S.pC(m.netProfit);
              return(
                <div key={m.key} style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                  <div style={{width:55,fontSize:11,color:'var(--c-text3)',textAlign:'right',flexShrink:0}}>{m.short}</div>
                  <div style={{flex:1,height:28,background:'var(--c-card2)',borderRadius:4,overflow:'hidden'}}>
                    <div style={{width:`${pct}%`,height:'100%',background:col,borderRadius:4,display:'flex',alignItems:'center',justifyContent:'flex-end',paddingRight:8,minWidth:2,transition:'width 0.7s'}}>
                      {pct>22&&<span style={{fontSize:11,fontWeight:700,color:'#fff'}}>{fmtK(m.netProfit)} RON</span>}
                    </div>
                  </div>
                  {pct<=22&&<span style={{fontSize:11,fontWeight:700,color:col,minWidth:80}}>{fmtK(m.netProfit)} RON</span>}
                  <span style={{fontSize:12,fontWeight:700,color:S.mC(m.margin),minWidth:48,textAlign:'right'}}>{fmt(m.margin,1)}%</span>
                </div>
              );
            })}
          </div>

          {/* ── P&L tabel detaliat ── */}
          <div style={{...S.card,overflowX:'auto'}}>
            <div style={S.hdr}>P&L DETALIAT PE LUNI</div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
              <thead>
                <tr>
                  {['Lună','Venituri','COGS','Transport','Marketing','Fixe','Profit brut','TVA 21%','Profit NET','Marjă NET','ROAS','Livrate','Retur'].map(h=>(
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profitMonths.map(m=>(
                  <tr key={m.key} style={{background:m.netProfitAfterTVA<0?'rgba(239,68,68,0.04)':'transparent'}}>
                    <td style={S.td(true,'var(--c-text)')}>{m.short}</td>
                    <td style={S.td(false,'var(--c-orange)')}>{fmtK(m.revenue)}</td>
                    <td style={S.td(false,'#6366f1')}>{fmtK(m.cogs)}</td>
                    <td style={S.td(false,'#fbbf24')}>{fmtK(m.transport)}</td>
                    <td style={S.td(false,'#f97316')}>{fmtK(m.marketing)}</td>
                    <td style={S.td(false,'#06b6d4')}>{fmtK(m.fixe)}</td>
                    <td style={S.td(true,S.pC(m.netProfit))}>{fmtK(m.netProfit)}</td>
                    <td style={S.td(false,'#f59e0b')}>{fmtK(m.totalTVA)}</td>
                    <td style={S.td(true,S.pC(m.netProfitAfterTVA))}>{fmtK(m.netProfitAfterTVA)}</td>
                    <td style={S.td(true,S.mC(m.marginAfterTVA))}>{fmt(m.marginAfterTVA,1)}%</td>
                    <td style={S.td(false,m.roas>=3?'#22c55e':m.roas>=2?'#fbbf24':'#ef4444')}>{m.marketing>0?fmt(m.roas,2)+'x':'-'}</td>
                    <td style={S.td(false,'#22c55e')}>{m.ordersLivrate||'-'}</td>
                    <td style={S.td(false,'#ef4444')}>{m.ordersRetur||'-'}</td>
                  </tr>
                ))}
                <tr style={{background:'rgba(249,115,22,0.05)',fontWeight:700}}>
                  <td style={S.td(true,'var(--c-text)')}>TOTAL</td>
                  <td style={S.td(true,'var(--c-orange)')}>{fmtK(totalRev)}</td>
                  <td style={S.td(true,'#6366f1')}>{fmtK(totalCOGS)}</td>
                  <td style={S.td(true,'#fbbf24')}>{fmtK(totalTrans)}</td>
                  <td style={S.td(true,'#f97316')}>{fmtK(totalMkt)}</td>
                  <td style={S.td(true,'#06b6d4')}>{fmtK(totalFixe)}</td>
                  <td style={S.td(true,S.pC(totalNet))}>{fmtK(totalNet)}</td>
                  <td style={S.td(true,'#f59e0b')}>{fmtK(totalTVA)}</td>
                  <td style={S.td(true,S.pC(totalNetTVA))}>{fmtK(totalNetTVA)}</td>
                  <td style={S.td(true,S.mC(avgMarginTVA))}>{fmt(avgMarginTVA,1)}%</td>
                  <td style={S.td()}>—</td>
                  <td style={S.td(false,'#22c55e')}>{profitMonths.reduce((s,m)=>s+m.ordersLivrate,0)}</td>
                  <td style={S.td(false,'#ef4444')}>{profitMonths.reduce((s,m)=>s+m.ordersRetur,0)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Structura costuri ── */}
          <div style={S.card}>
            <div style={S.hdr}>STRUCTURA COSTURILOR — TOTAL</div>
            {[
              {label:'COGS (marfă)',val:totalCOGS,color:'#6366f1'},
              {label:'Marketing (Meta Ads)',val:totalMkt,color:'#f97316'},
              {label:'Transport',val:totalTrans,color:'#fbbf24'},
              {label:'Cheltuieli fixe',val:totalFixe,color:'#06b6d4'},
            ].map((c,i)=>{
              const tot=totalCOGS+totalMkt+totalTrans+totalFixe;
              const pct=tot>0?c.val/tot*100:0;
              return(
                <div key={i} style={{marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                    <span style={{color:'var(--c-text)',fontWeight:600}}>{c.label}</span>
                    <span style={{color:c.color,fontWeight:700}}>{fmtK(c.val)} RON · {fmt(pct,1)}%</span>
                  </div>
                  <div style={{height:10,background:'var(--c-card2)',borderRadius:5,overflow:'hidden'}}>
                    <div style={{width:`${pct}%`,height:'100%',background:c.color,transition:'width 0.7s'}}/>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Stoc din XLS ── */}
          {hasStock&&(
            <div style={{...S.card,background:'rgba(34,197,94,0.04)',border:'1px solid rgba(34,197,94,0.15)'}}>
              <div style={S.hdr}>📦 STOC LA ZI DIN XLS</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:8,marginBottom:12}}>
                <div style={S.kpi}><div style={S.kL}>Valoare stoc</div><div style={{...S.kV,color:'#22c55e',fontSize:20}}>{fmtK(Object.values(stockMap).reduce((s,v)=>s+v.sold,0))}</div><div style={S.kS}>RON</div></div>
                <div style={S.kpi}><div style={S.kL}>SKU-uri</div><div style={{...S.kV,fontSize:20}}>{Object.keys(stockMap).length}</div><div style={S.kS}>produse</div></div>
                <div style={S.kpi}><div style={S.kL}>Unități</div><div style={{...S.kV,fontSize:20}}>{Object.values(stockMap).reduce((s,v)=>s+v.stoc,0)}</div><div style={S.kS}>buc în stoc</div></div>
              </div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                  <thead><tr>{['SKU','Produs','Stoc buc','Cost CMP','Valoare'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {Object.entries(stockMap).sort((a,b)=>b[1].sold-a[1].sold).slice(0,20).map(([cod,v])=>(
                      <tr key={cod}>
                        <td style={S.td(true,'var(--c-orange)')}>{cod}</td>
                        <td style={{...S.td(),maxWidth:180,overflow:'hidden',textOverflow:'ellipsis'}}>{v.produs.slice(0,35)}{v.produs.length>35?'…':''}</td>
                        <td style={S.td()}>{v.stoc}</td>
                        <td style={S.td()}>{fmt(v.cost,2)} RON</td>
                        <td style={S.td(true,'#22c55e')}>{fmt(v.sold,2)} RON</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {profitMonths.length===0&&(
        <div style={{...S.card,textAlign:'center',padding:40}}>
          <div style={{fontSize:32,marginBottom:10}}>💰</div>
          <div style={{fontSize:14,fontWeight:700,color:'var(--c-text)',marginBottom:8}}>Nicio dată disponibilă</div>
          <div style={{fontSize:12,color:'var(--c-text3)'}}>Sincronizează comenzile Shopify și importează CSV Meta.</div>
        </div>
      )}
    </div>
  );
}
