'use client';
import { useState } from 'react';

const fmt = (n, d=2) => Number(n||0).toLocaleString('ro-RO', {minimumFractionDigits:d,maximumFractionDigits:d});
const fmtRON = n => `${fmt(n)} RON`;
const fmtUSD = n => `$${fmt(n)}`;

// ── Parse Excel produse ──
function parseProductsExcel(data) {
  const wb = window.XLSX.read(data, {type:'array'});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  let hi = -1;
  for (let i=0; i<rows.length; i++) {
    const j = rows[i].join(' ').toLowerCase();
    if (j.includes('quantity') || j.includes('unit price')) { hi=i; break; }
  }
  if (hi===-1) return {products:[], error:'Nu am găsit headerul produselor.'};
  const hdr = rows[hi].map(h=>(h||'').toString().toLowerCase());
  const ni = hdr.findIndex(h=>h.includes('product')||h.includes('description')||h.includes('品名'));
  const qi = hdr.findIndex(h=>h.includes('quantity')||h.includes('qty'));
  const pi = hdr.findIndex(h=>h.includes('unit price')||h.includes('unit_price'));
  const products = [];
  for (let i=hi+1; i<rows.length; i++) {
    const r = rows[i];
    const name = (r[ni]||'').toString().trim();
    if (!name || ['total','seller','signature','date','buyer'].some(k=>name.toLowerCase().includes(k))) continue;
    const qty = parseFloat(r[qi])||0;
    const price = parseFloat(r[pi])||0;
    if (qty===0 && price===0) continue;
    const sm = name.match(/\b([A-Z]{1,3}\d{2,4}[A-Z0-9]*)\b/);
    products.push({name:name.replace(/\s+/g,' '), sku:sm?sm[1]:'', qty, unitPriceUSD:price});
  }
  return {products};
}

function parseFreightExcel(data) {
  const wb = window.XLSX.read(data, {type:'array'});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  let hi = -1;
  for (let i=0; i<rows.length; i++) {
    if (rows[i].join(' ').toLowerCase().includes('amount')) { hi=i; break; }
  }
  if (hi===-1) return {totalUSD:0};
  const hdr = rows[hi].map(h=>(h||'').toString().toLowerCase());
  const ai = hdr.findIndex(h=>h.includes('amount'));
  let total = 0;
  for (let i=hi+1; i<rows.length; i++) {
    const v = parseFloat(rows[i][ai]);
    if (!isNaN(v) && v>0) total += v;
  }
  return {totalUSD:total};
}

const EMPTY = {name:'', sku:'', qty:1, unitPriceUSD:0, taxaVamala:'', tvaPercent:'21'};

export default function ImportCalc() {
  const [products, setProducts] = useState([{...EMPTY}]);
  const [transportUSD, setTransportUSD] = useState('');
  const [transportRON, setTransportRON] = useState('');
  const [cursValutar, setCursValutar] = useState('');
  const [cursTransport, setCursTransport] = useState('');
  const [taxaVamala, setTaxaVamala] = useState('');
  const [taxaVamalaRON, setTaxaVamalaRON] = useState('');
  const [tvaPercent, setTvaPercent] = useState('21');
  const [tvaRON_dvi, setTvaRON_dvi] = useState('');
  const [comisionDHL, setComisionDHL] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState('');
  const [aiLoading, setAiLoading] = useState('');
  const [error, setError] = useState('');
  const [savedResults, setSavedResults] = useState(null);
  const [showBD, setShowBD] = useState(null);
  const [aiMessages, setAiMessages] = useState({});
  const [dviData, setDviData] = useState(null);
  const [dhlData, setDhlData] = useState(null);

  const loadXLSX = cb => {
    if (window.XLSX) { cb(); return; }
    const s = document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload=cb; s.onerror=()=>setError('Nu s-a putut încărca XLSX.js');
    document.head.appendChild(s);
  };

  const handleProductsFile = e => {
    const file = e.target.files[0]; if (!file) return;
    setLoading('produse'); setError('');
    loadXLSX(()=>{
      const reader = new FileReader();
      reader.onload = ev => {
        const {products:p, error:err} = parseProductsExcel(new Uint8Array(ev.target.result));
        if (err) { setError(err); setLoading(''); return; }
        if (!p.length) { setError('Niciun produs găsit.'); setLoading(''); return; }
        setProducts(p); setLoading('');
      };
      reader.readAsArrayBuffer(file);
    });
    e.target.value='';
  };

  const handleFreightFile = e => {
    const file = e.target.files[0]; if (!file) return;
    setLoading('transport'); setError('');
    loadXLSX(()=>{
      const reader = new FileReader();
      reader.onload = ev => {
        const {totalUSD} = parseFreightExcel(new Uint8Array(ev.target.result));
        setTransportUSD(String(totalUSD)); setTransportRON(''); setLoading('');
      };
      reader.readAsArrayBuffer(file);
    });
    e.target.value='';
  };

  // ── AI PDF parsing ──
  const analyzePDF = async (file, type) => {
    setAiLoading(type); setError('');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      const systemPrompt = type === 'dvi'
        ? `Ești un expert în declarații vamale românești (DVI). Extrage din documentul PDF următoarele câmpuri și răspunde DOAR cu JSON valid:
{
  "cursSchimb": <număr, ex: 4.3046>,
  "taxaVamalaPercent": <număr procent, ex: 3.7>,
  "taxaVamalaRON": <suma RON plătită, ex: 419>,
  "tvaPercent": <număr, ex: 21>,
  "tvaRON": <suma TVA RON, ex: 2488>,
  "valoareVama": <valoarea totală în vamă RON>,
  "monedaFactura": <"USD" sau alta>,
  "dataLiberVama": <"DD/MM/YYYY">,
  "numarMRN": <string>,
  "descriereMarfa": <string scurt>
}`
        : `Ești un expert în facturi DHL România. Extrage din documentul PDF:
{
  "comisionProcessare": <suma RON fără TVA, ex: 59>,
  "comisionTVA": <TVA pe comision RON, ex: 12.39>,
  "dreptVamalComision": <suma RON, ex: 419>,
  "dreptVamalTVA": <suma RON TVA, ex: 2488>,
  "totalDePlata": <suma totală RON, ex: 2978.39>,
  "numarFactura": <string>,
  "numarAWB": <string>,
  "dataFactura": <"DD/MM/YYYY">
}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: [{
              type: 'document',
              source: {type:'base64', media_type:'application/pdf', data:base64}
            }, {
              type: 'text',
              text: type==='dvi'
                ? 'Extrage datele din această Declarație Vamală de Import și returnează JSON.'
                : 'Extrage datele din această factură DHL și returnează JSON.'
            }]
          }]
        })
      });

      const data = await response.json();
      const text = data.content?.map(c=>c.text||'').join('');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Nu am putut extrage datele din PDF');
      const parsed = JSON.parse(jsonMatch[0]);

      if (type === 'dvi') {
        setDviData(parsed);
        if (parsed.cursSchimb) setCursValutar(String(parsed.cursSchimb));
        if (parsed.taxaVamalaPercent) setTaxaVamala(String(parsed.taxaVamalaPercent));
        if (parsed.taxaVamalaRON) setTaxaVamalaRON(String(parsed.taxaVamalaRON));
        if (parsed.tvaPercent) setTvaPercent(String(parsed.tvaPercent));
        if (parsed.tvaRON) setTvaRON_dvi(String(parsed.tvaRON));
        setAiMessages(prev=>({...prev, dvi:`✅ DVI analizat: curs ${parsed.cursSchimb} USD/RON, taxă vamală ${parsed.taxaVamalaPercent}% (${parsed.taxaVamalaRON} RON), TVA ${parsed.tvaRON} RON`}));
      } else {
        setDhlData(parsed);
        if (parsed.comisionProcessare) setComisionDHL(String(parsed.comisionProcessare));
        setAiMessages(prev=>({...prev, dhl:`✅ Factură DHL: comision ${parsed.comisionProcessare} RON, taxe vamale achitate ${parsed.dreptVamalComision} RON, total ${parsed.totalDePlata} RON`}));
      }
    } catch (e) {
      setError(`Eroare AI (${type}): ${e.message}`);
    }
    setAiLoading('');
  };

  const handleDVIPdf = e => {
    const file = e.target.files[0]; if (!file) return;
    analyzePDF(file, 'dvi');
    e.target.value='';
  };

  const handleDHLPdf = e => {
    const file = e.target.files[0]; if (!file) return;
    analyzePDF(file, 'dhl');
    e.target.value='';
  };

  const upd = (idx,field,val) => setProducts(p=>p.map((x,i)=>i===idx?{...x,[field]:val}:x));

  // CALCULE
  const curs = parseFloat(cursValutar)||0;
  const cursT = parseFloat(cursTransport)||curs;
  const totalQty = products.reduce((s,p)=>s+(parseFloat(p.qty)||0),0);
  const totalUSD_val = products.reduce((s,p)=>s+(parseFloat(p.qty)||0)*(parseFloat(p.unitPriceUSD)||0),0);
  const totalRON_f = totalUSD_val*curs;
  const tRON = transportRON ? parseFloat(transportRON)||0 : (parseFloat(transportUSD)||0)*cursT;

  // Taxe — folosim valorile reale din DVI dacă sunt disponibile
  const taxaV_RON_real = taxaVamalaRON ? parseFloat(taxaVamalaRON)||0 : 0;
  const tva_RON_real = tvaRON_dvi ? parseFloat(tvaRON_dvi)||0 : 0;
  const comRON = parseFloat(comisionDHL)||0;

  // Calculăm din procente dacă nu avem valorile reale din DVI
  const bazaV = totalRON_f + tRON;
  const taxaV_RON_calc = bazaV*(parseFloat(taxaVamala)||0)/100;
  const taxaV_RON_final = taxaVamalaRON ? taxaV_RON_real : taxaV_RON_calc;

  const bazaTVA = bazaV + taxaV_RON_final + comRON;
  const tva_RON_calc = bazaTVA*(parseFloat(tvaPercent)||0)/100;
  const tva_RON_final = tvaRON_dvi ? tva_RON_real : tva_RON_calc;

  const totalCosturi = tRON + taxaV_RON_final + comRON + tva_RON_final;
  const totalCostRON = totalRON_f + totalCosturi;

  const prods = products.map(p=>{
    const qty=parseFloat(p.qty)||0, unitUSD=parseFloat(p.unitPriceUSD)||0;
    const valUSD=qty*unitUSD, valRON=valUSD*curs;
    const prop = totalUSD_val>0 ? valUSD/totalUSD_val : 0;

    // Taxă vamală per produs (poate fi 0% pentru unele produse)
    const tvPerc = p.taxaVamala !== '' ? parseFloat(p.taxaVamala)||0 : parseFloat(taxaVamala)||0;
    const tvaPPerc = p.tvaPercent !== '' ? parseFloat(p.tvaPercent)||21 : parseFloat(tvaPercent)||21;

    // Transport alocat proporțional
    const transportAlocat = tRON * prop;

    // Taxă vamală pe acest produs (bazată pe valoare + transport alocat)
    const bazaVamalaProd = valRON + transportAlocat;
    const taxaVamalaProd = bazaVamalaProd * tvPerc / 100;

    // Comision DHL alocat proporțional
    const comisionAlocat = comRON * prop;

    // TVA pe (valoare + transport + taxă vamală + comision)
    const bazaTVAProd = bazaVamalaProd + taxaVamalaProd + comisionAlocat;
    const tvaProd = bazaTVAProd * tvaPPerc / 100;

    const costuri = transportAlocat + taxaVamalaProd + comisionAlocat + tvaProd;
    const totalP = valRON + costuri; // total cu TVA inclus
    const costUnit = qty>0 ? totalP/qty : 0; // preț unitar cu toate taxele + TVA

    return {
      ...p, qty, unitUSD, valUSD, valRON, prop,
      costuri: costuri||0, totalP: totalP||0, costUnit: costUnit||0,
      transportAlocat: transportAlocat||0,
      taxaVamalaProd: taxaVamalaProd||0,
      comisionAlocat: comisionAlocat||0,
      tvaProd: tvaProd||0,
      tvPerc: tvPerc||0,
      tvaPPerc: tvaPPerc||21,
    };
  });

  const exportJSON = () => {
    const data = {
      meta:{
        data:new Date().toISOString().slice(0,10),
        cursValutar:curs, taxaVamalaPercent:parseFloat(taxaVamala)||0,
        taxaVamalaRON:taxaV_RON_final, tvaPercent:parseFloat(tvaPercent)||0,
        tvaRON:tva_RON_final, comisionDHL:comRON, transportRON:tRON,
        totalCostRON,
        sursa: dviData ? 'DVI analizat cu AI' : 'introducere manuală',
      },
      produse: prods.map(p=>({
        sku: p.sku || p.name.replace(/\s+/g,'_').toUpperCase(),
        name: p.name.trim(),
        qty: p.qty,
        pretFurnizorUSD: +p.unitUSD.toFixed(4),
        pretFurnizorRON: +(p.unitUSD*curs).toFixed(2),
        costImportUnitarRON: +p.costUnit.toFixed(2),
        taxeAlocateRON: +(p.costuri/p.qty).toFixed(2),
        totalProdusRON: +p.totalP.toFixed(2),
      })),
    };
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`import-cost-${data.meta.data}.json`; a.click();
    setSavedResults(data);
  };

  const exportCSV = () => {
    const rows=[['SKU','Produs','Cant','Pret USD','Pret RON','Taxe/buc RON','Cost unitar RON','Total RON']];
    prods.forEach(p=>rows.push([p.sku,`"${p.name}"`,p.qty,fmt(p.unitUSD),fmt(p.unitUSD*curs),fmt(p.costuri/p.qty),fmt(p.costUnit),fmt(p.totalP)]));
    const blob=new Blob(['\uFEFF'+rows.map(r=>r.join(',')).join('\n')],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='import-cost.csv'; a.click();
  };

  // STYLES
  const inp={background:'#070d12',border:'1px solid #1a2535',color:'#e8edf2',padding:'9px 12px',borderRadius:8,fontSize:13,outline:'none',width:'100%',fontFamily:'monospace',transition:'border .2s'};
  const lbl={fontSize:10,color:'#64748b',textTransform:'uppercase',letterSpacing:1.2,marginBottom:5,display:'block'};
  const sec={background:'#0c1520',border:'1px solid #1a2535',borderRadius:14,padding:'18px 20px',marginBottom:14};
  const stepBtn=(s)=>({
    background:step>=s?'linear-gradient(135deg,#f97316,#ea580c)':'#0c1520',
    color:step>=s?'white':'#475569',
    border:`1px solid ${step>=s?'transparent':'#1a2535'}`,
    borderRadius:22,padding:'6px 18px',fontSize:11,cursor:step<=s||step>s?'pointer':'default',
    fontWeight:step===s?700:400,boxShadow:step>=s?'0 2px 12px rgba(249,115,22,.3)':'none',
    transition:'all .2s',
  });

  return (
    <>
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box;}
        body{background:#060b10;color:#e8edf2;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;}
        .w{max-width:860px;margin:0 auto;padding:24px 16px 80px;}
        input:focus{border-color:#f97316!important;box-shadow:0 0 0 2px rgba(249,115,22,.15)!important;}
        input[type=number]{-moz-appearance:textfield;}
        input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;}
        .g2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
        .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
        .ai-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:700;border:none;transition:all .2s;}
        .ai-btn:hover{transform:translateY(-1px);}
        .upload-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:9px;cursor:pointer;font-size:12px;font-weight:600;border:none;}
        .nbtn{background:linear-gradient(135deg,#f97316,#ea580c);color:white;border:none;padding:12px 28px;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;width:100%;margin-top:14px;box-shadow:0 4px 16px rgba(249,115,22,.35);transition:all .2s;}
        .nbtn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(249,115,22,.45);}
        .nbtn:disabled{opacity:.4;transform:none;cursor:not-allowed;}
        .bbtn{background:#0c1520;border:1px solid #1a2535;color:#64748b;padding:12px 24px;border-radius:12px;font-weight:600;font-size:13px;cursor:pointer;flex:1;margin-top:14px;}
        .prod-card{background:#070d12;border-radius:10px;padding:14px;margin-bottom:10px;border:1px solid #1a2535;transition:border .2s;}
        .prod-card:hover{border-color:#2a3a50;}
        .bdr{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1a2535;font-size:12px;}
        .bdr:last-child{border-bottom:none;}
        .pulse{animation:pulse 1.5s ease-in-out infinite;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        .glow-orange{box-shadow:0 0 20px rgba(249,115,22,.15);}
        .glow-green{box-shadow:0 0 20px rgba(16,185,129,.1);}
        .tag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;}
        @media(max-width:600px){.g2,.g3{grid-template-columns:1fr!important;} .w{padding:14px 12px 60px;}}
      `}</style>

      <div className="w">
        {/* HEADER */}
        <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:28,paddingBottom:20,borderBottom:'1px solid #1a2535',flexWrap:'wrap'}}>
          <div style={{background:'linear-gradient(135deg,#f97316,#ea580c)',color:'#fff',fontWeight:800,fontSize:15,padding:'7px 12px',borderRadius:10,boxShadow:'0 4px 14px rgba(249,115,22,.4)'}}>GLAMX</div>
          <div>
            <div style={{fontSize:20,fontWeight:800,letterSpacing:-.3}}>Calculator Cost Import</div>
            <div style={{fontSize:11,color:'#64748b',marginTop:2}}>
              🤖 AI citește automat DVI + Factura DHL · Export JSON cu SKU pentru calculatorul de profit
            </div>
          </div>
          <a href="/" style={{marginLeft:'auto',background:'#0c1520',border:'1px solid #1a2535',color:'#64748b',padding:'6px 14px',borderRadius:22,fontSize:11,textDecoration:'none'}}>← Dashboard</a>
        </div>

        {/* STEPS */}
        <div style={{display:'flex',gap:8,marginBottom:24,flexWrap:'wrap'}}>
          {[['1','📦 Produse'],['2','📄 DVI & Taxe'],['3','📊 Rezultate']].map(([s,l])=>(
            <button key={s} style={stepBtn(parseInt(s))} onClick={()=>parseInt(s)<step&&setStep(parseInt(s))}>{l} {parseInt(s)<step?'✓':''}</button>
          ))}
        </div>

        {error&&<div style={{background:'rgba(244,63,94,.08)',border:'1px solid rgba(244,63,94,.25)',borderRadius:10,padding:'10px 16px',color:'#f43f5e',fontSize:12,marginBottom:14}}>⚠️ {error}</div>}

        {/* ══ STEP 1 ══ */}
        {step===1&&(
          <div>
            <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:3,marginBottom:14}}>Pasul 1 — Produse & Transport</div>

            {/* PRODUSE */}
            <div style={sec} className="glow-orange">
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:10}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700}}>📦 Produse din factură furnizor</div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:2}}>Importă Excel sau adaugă manual</div>
                </div>
                <label className="upload-btn" style={{background:'rgba(249,115,22,.12)',color:'#f97316',border:'1px solid rgba(249,115,22,.3)'}}>
                  {loading==='produse'?<span className="pulse">⟳ Se încarcă...</span>:'📂 Import Excel factură'}
                  <input type="file" accept=".xlsx,.xls" onChange={handleProductsFile} style={{display:'none'}}/>
                </label>
              </div>

              {products.map((p,idx)=>(
                <div key={idx} className="prod-card">
                  <div className="g2" style={{marginBottom:10}}>
                    <div>
                      <label style={lbl}>Nume produs</label>
                      <input style={inp} value={p.name} placeholder="ex: Smart watch DM56" onChange={e=>upd(idx,'name',e.target.value)}/>
                    </div>
                    <div>
                      <label style={lbl}>SKU <span style={{color:'#3b82f6',fontWeight:700}}>*important pentru profit</span></label>
                      <input style={{...inp,border:'1px solid rgba(59,130,246,.35)'}} value={p.sku} placeholder="ex: DM56" onChange={e=>upd(idx,'sku',e.target.value)}/>
                    </div>
                  </div>
                  <div className="g2">
                    <div>
                      <label style={lbl}>Cantitate (buc)</label>
                      <input type="number" style={inp} value={p.qty} min="1" onChange={e=>upd(idx,'qty',e.target.value)}/>
                    </div>
                    <div>
                      <label style={lbl}>Preț unitar (USD)</label>
                      <input type="number" style={inp} value={p.unitPriceUSD} step="0.01" placeholder="0.00" onChange={e=>upd(idx,'unitPriceUSD',e.target.value)}/>
                    </div>
                  </div>
                  <div className="g2" style={{marginTop:8}}>
                    <div>
                      <label style={lbl}>Taxă vamală % <span style={{color:'#475569'}}>(gol = folosește globala)</span></label>
                      <input type="number" style={inp} value={p.taxaVamala} step="0.1" min="0"
                        placeholder={`default: ${taxaVamala||'0'}%`}
                        onChange={e=>upd(idx,'taxaVamala',e.target.value)}/>
                      {p.taxaVamala==='0'&&<div style={{fontSize:10,color:'#10b981',marginTop:3}}>✓ Fără taxă vamală (ex: printer server)</div>}
                    </div>
                    <div>
                      <label style={lbl}>TVA % <span style={{color:'#475569'}}>(gol = 21%)</span></label>
                      <input type="number" style={inp} value={p.tvaPercent} step="0.1" min="0" placeholder="21"
                        onChange={e=>upd(idx,'tvaPercent',e.target.value)}/>
                    </div>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:10}}>
                    <span style={{fontSize:12,color:'#f97316',fontFamily:'monospace',fontWeight:700}}>${fmt((parseFloat(p.qty)||0)*(parseFloat(p.unitPriceUSD)||0))}</span>
                    {products.length>1&&<button onClick={()=>setProducts(p=>p.filter((_,i)=>i!==idx))}
                      style={{background:'rgba(244,63,94,.1)',border:'1px solid rgba(244,63,94,.2)',color:'#f43f5e',borderRadius:7,padding:'3px 9px',cursor:'pointer',fontSize:11}}>✕</button>}
                  </div>
                </div>
              ))}
              <button onClick={()=>setProducts(p=>[...p,{...EMPTY}])}
                style={{background:'transparent',border:'1px dashed #1a2535',color:'#475569',padding:10,borderRadius:9,cursor:'pointer',fontSize:12,width:'100%',marginTop:4}}>
                + Adaugă produs manual
              </button>
              {totalUSD_val>0&&(
                <div style={{marginTop:12,padding:'10px 14px',background:'rgba(249,115,22,.06)',borderRadius:9,border:'1px solid rgba(249,115,22,.18)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{color:'#64748b',fontSize:12}}>Total factură furnizor</span>
                  <span style={{color:'#f97316',fontFamily:'monospace',fontWeight:800,fontSize:15}}>{fmtUSD(totalUSD_val)} <span style={{fontSize:11,fontWeight:400}}>({totalQty} buc)</span></span>
                </div>
              )}
            </div>

            {/* TRANSPORT */}
            <div style={sec}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:10}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700}}>✈️ Transport DHL</div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:2}}>Importă Excel freight invoice</div>
                </div>
                <label className="upload-btn" style={{background:'rgba(16,185,129,.1)',color:'#10b981',border:'1px solid rgba(16,185,129,.25)'}}>
                  {loading==='transport'?<span className="pulse">⟳ Se încarcă...</span>:'📂 Import Excel freight'}
                  <input type="file" accept=".xlsx,.xls" onChange={handleFreightFile} style={{display:'none'}}/>
                </label>
              </div>
              <div className="g2">
                <div>
                  <label style={lbl}>Cost transport (USD)</label>
                  <input type="number" style={inp} value={transportUSD} step="0.01" placeholder="ex: 257.27"
                    onChange={e=>{setTransportUSD(e.target.value);setTransportRON('');}}/>
                  <div style={{fontSize:10,color:'#475569',margin:'6px 0 4px'}}>— sau direct în RON —</div>
                  <input type="number" style={inp} value={transportRON} step="0.01" placeholder="ex: 1250.00 RON"
                    onChange={e=>{setTransportRON(e.target.value);setTransportUSD('');}}/>
                </div>
                <div>
                  <label style={lbl}>Curs transport (dacă diferit de DVI)</label>
                  <input type="number" style={inp} value={cursTransport} step="0.0001" placeholder="ex: 4.3046"
                    onChange={e=>setCursTransport(e.target.value)}/>
                  <div style={{fontSize:10,color:'#475569',marginTop:8}}>Lasă gol = se folosește cursul din DVI</div>
                  {transportUSD && cursT>0 && (
                    <div style={{marginTop:8,fontSize:11,color:'#10b981'}}>
                      {fmtUSD(parseFloat(transportUSD))} × {cursT} = <strong>{fmtRON(parseFloat(transportUSD)*cursT)}</strong>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <button className="nbtn" onClick={()=>setStep(2)} disabled={totalUSD_val===0}>
              Continuă → DVI & Taxe Vamale →
            </button>
          </div>
        )}

        {/* ══ STEP 2 ══ */}
        {step===2&&(
          <div>
            <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:3,marginBottom:14}}>Pasul 2 — DVI & Taxe Vamale</div>

            {/* AI DVI */}
            <div style={{...sec,border:'1px solid rgba(168,85,247,.3)',background:'rgba(168,85,247,.04)'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,flexWrap:'wrap'}}>
                <div style={{background:'linear-gradient(135deg,#a855f7,#7c3aed)',borderRadius:10,padding:'6px 10px',fontSize:18}}>🤖</div>
                <div>
                  <div style={{fontSize:14,fontWeight:700}}>AI — Citire automată DVI</div>
                  <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>Încarcă PDF-ul DVI și AI extrage automat cursul, taxele vamale, TVA</div>
                </div>
              </div>
              {aiMessages.dvi && (
                <div style={{marginBottom:12,padding:'8px 12px',background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:8,fontSize:11,color:'#10b981'}}>
                  {aiMessages.dvi}
                </div>
              )}
              <label className="ai-btn" style={{background:'linear-gradient(135deg,#a855f7,#7c3aed)',color:'white',boxShadow:'0 4px 14px rgba(168,85,247,.4)'}}>
                {aiLoading==='dvi'?<span className="pulse">🤖 AI analizează DVI...</span>:'🤖 Analizează DVI cu AI'}
                <input type="file" accept=".pdf" onChange={handleDVIPdf} style={{display:'none'}} disabled={aiLoading==='dvi'}/>
              </label>
              <span style={{fontSize:10,color:'#475569',marginLeft:10}}>sau completează manual mai jos</span>
            </div>

            {/* AI DHL */}
            <div style={{...sec,border:'1px solid rgba(59,130,246,.25)',background:'rgba(59,130,246,.03)'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,flexWrap:'wrap'}}>
                <div style={{background:'linear-gradient(135deg,#3b82f6,#1d4ed8)',borderRadius:10,padding:'6px 10px',fontSize:18}}>🤖</div>
                <div>
                  <div style={{fontSize:14,fontWeight:700}}>AI — Citire automată Factură DHL</div>
                  <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>AI extrage comisionul de procesare, taxele plătite în numele tău</div>
                </div>
              </div>
              {aiMessages.dhl && (
                <div style={{marginBottom:12,padding:'8px 12px',background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:8,fontSize:11,color:'#10b981'}}>
                  {aiMessages.dhl}
                </div>
              )}
              <label className="ai-btn" style={{background:'linear-gradient(135deg,#3b82f6,#1d4ed8)',color:'white',boxShadow:'0 4px 14px rgba(59,130,246,.35)'}}>
                {aiLoading==='dhl'?<span className="pulse">🤖 AI analizează factura...</span>:'🤖 Analizează Factură DHL cu AI'}
                <input type="file" accept=".pdf" onChange={handleDHLPdf} style={{display:'none'}} disabled={aiLoading==='dhl'}/>
              </label>
            </div>

            {/* CÂMPURI MANUALE */}
            <div style={sec}>
              <div style={{fontSize:12,color:'#64748b',marginBottom:14,padding:'8px 12px',background:'rgba(245,158,11,.06)',borderRadius:8,border:'1px solid rgba(245,158,11,.2)'}}>
                ✏️ Verifică și ajustează dacă e necesar — câmpurile se completează automat după analiza AI
              </div>
              <div className="g2" style={{marginBottom:14}}>
                <div>
                  <label style={lbl}>Curs valutar DVI (USD→RON)</label>
                  <input type="number" style={{...inp,borderColor:cursValutar?'rgba(16,185,129,.4)':'#1a2535'}} value={cursValutar} step="0.0001" placeholder="ex: 4.3046"
                    onChange={e=>setCursValutar(e.target.value)}/>
                  {cursValutar&&<div style={{fontSize:10,color:'#10b981',marginTop:5}}>
                    {fmtUSD(totalUSD_val)} × {cursValutar} = <strong>{fmtRON(totalRON_f)}</strong>
                  </div>}
                </div>
                <div>
                  <label style={lbl}>Taxă vamală (%)</label>
                  <input type="number" style={{...inp,borderColor:taxaVamala?'rgba(16,185,129,.4)':'#1a2535'}} value={taxaVamala} step="0.1" min="0" placeholder="ex: 3.7"
                    onChange={e=>setTaxaVamala(e.target.value)}/>
                </div>
              </div>
              <div className="g2" style={{marginBottom:14}}>
                <div>
                  <label style={lbl}>Taxă vamală plătită — din DVI (RON)</label>
                  <input type="number" style={{...inp,borderColor:taxaVamalaRON?'rgba(245,158,11,.4)':'#1a2535'}} value={taxaVamalaRON} step="0.01" placeholder="ex: 419"
                    onChange={e=>setTaxaVamalaRON(e.target.value)}/>
                  <div style={{fontSize:10,color:'#475569',marginTop:4}}>Dacă ai suma exactă din DVI, o ia pe aceasta</div>
                </div>
                <div>
                  <label style={lbl}>TVA plătit — din DVI (RON)</label>
                  <input type="number" style={{...inp,borderColor:tvaRON_dvi?'rgba(168,85,247,.4)':'#1a2535'}} value={tvaRON_dvi} step="0.01" placeholder="ex: 2488"
                    onChange={e=>setTvaRON_dvi(e.target.value)}/>
                </div>
              </div>
              <div className="g2">
                <div>
                  <label style={lbl}>TVA %</label>
                  <input type="number" style={inp} value={tvaPercent} step="0.1" placeholder="21" onChange={e=>setTvaPercent(e.target.value)}/>
                </div>
                <div>
                  <label style={lbl}>Comision procesare DHL (RON, fără TVA)</label>
                  <input type="number" style={{...inp,borderColor:comisionDHL?'rgba(59,130,246,.4)':'#1a2535'}} value={comisionDHL} step="0.01" placeholder="ex: 59"
                    onChange={e=>setComisionDHL(e.target.value)}/>
                </div>
              </div>
            </div>

            {/* PREVIEW */}
            {curs>0&&(
              <div style={{...sec,border:'1px solid rgba(249,115,22,.25)'}}>
                <div style={{fontSize:11,color:'#f97316',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>📊 Preview calcul complet</div>
                <div style={{display:'flex',flexDirection:'column',gap:2}}>
                  {[
                    ['📄 Valoare marfă furnizor',fmtRON(totalRON_f),'#e8edf2',false],
                    ['✈️ Transport DHL',fmtRON(tRON),'#3b82f6',false],
                    [`🛃 Taxă vamală${taxaVamala?` ${taxaVamala}%`:''}${taxaVamalaRON?' (din DVI)':' (calculat)'}`,fmtRON(taxaV_RON_final),'#f59e0b',false],
                    ['🏢 Comision procesare DHL',fmtRON(comRON),'#94a3b8',false],
                    [`💰 TVA${tvaPercent?` ${tvaPercent}%`:''}${tvaRON_dvi?' (din DVI)':' (calculat)'}`,fmtRON(tva_RON_final),'#a855f7',false],
                    ['📦 TOTAL COST IMPORT',fmtRON(totalCostRON),'#f97316',true],
                  ].map(([l,v,c,bold])=>(
                    <div key={l} className="bdr" style={{fontWeight:bold?800:400,paddingTop:bold?10:6,marginTop:bold?6:0,borderTop:bold?'1px solid #1a2535':'none'}}>
                      <span style={{color:bold?'#f97316':'#64748b',fontSize:bold?13:12}}>{l}</span>
                      <span style={{color:c,fontFamily:'monospace',fontSize:bold?16:12}}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{textAlign:'right',marginTop:8,fontSize:11,color:'#475569'}}>
                  Cost mediu / buc: <strong style={{color:'#f97316'}}>{fmtRON(totalQty>0?totalCostRON/totalQty:0)}</strong>
                </div>
              </div>
            )}

            <div style={{display:'flex',gap:10}}>
              <button className="bbtn" onClick={()=>setStep(1)}>← Înapoi</button>
              <button className="nbtn" style={{flex:2}} onClick={()=>setStep(3)} disabled={!cursValutar}>
                Calculează & Vezi Rezultatele →
              </button>
            </div>
          </div>
        )}

        {/* ══ STEP 3 ══ */}
        {step===3&&(
          <div>
            <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:3,marginBottom:14}}>Pasul 3 — Rezultate & Export</div>

            {/* SUMAR */}
            <div style={{...sec,border:'1px solid rgba(249,115,22,.35)',background:'linear-gradient(135deg,#0c1520 0%,#111d2b 100%)',marginBottom:18}} className="glow-orange">
              <div style={{fontSize:11,color:'#f97316',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>Sumar cost total import</div>
              {[
                ['📄 Valoare marfă furnizor',`${fmtUSD(totalUSD_val)} × ${cursValutar}`,fmtRON(totalRON_f),'#e8edf2'],
                ['✈️ Transport DHL','',fmtRON(tRON),'#3b82f6'],
                [`🛃 Taxă vamală${taxaVamala?` ${taxaVamala}%`:''}`,taxaVamalaRON?'din DVI':'calculat',fmtRON(taxaV_RON_final),'#f59e0b'],
                ['🏢 Comision procesare DHL','',fmtRON(comRON),'#94a3b8'],
                [`💰 TVA ${tvaPercent}%`,tvaRON_dvi?'din DVI':'calculat',fmtRON(tva_RON_final),'#a855f7'],
              ].map(([l,sub,v,c])=>(
                <div key={l} className="bdr">
                  <div>
                    <div style={{color:'#64748b',fontSize:12}}>{l}</div>
                    {sub&&<div style={{fontSize:10,color:'#334155'}}>{sub}</div>}
                  </div>
                  <span style={{color:c,fontFamily:'monospace',fontWeight:600,fontSize:13}}>{v}</span>
                </div>
              ))}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:14,marginTop:8,borderTop:'2px solid rgba(249,115,22,.2)'}}>
                <span style={{fontSize:16,fontWeight:800}}>TOTAL COST IMPORT</span>
                <span style={{fontSize:24,fontWeight:900,color:'#f97316',fontFamily:'monospace'}}>{fmtRON(totalCostRON)}</span>
              </div>
              <div style={{textAlign:'right',marginTop:6,fontSize:11,color:'#475569'}}>
                {totalQty} bucăți · cost mediu <strong style={{color:'#f97316'}}>{fmtRON(totalQty>0?totalCostRON/totalQty:0)}</strong> / buc
              </div>
            </div>

            {/* PRODUSE */}
            <div style={{fontSize:11,color:'#f97316',textTransform:'uppercase',letterSpacing:2,marginBottom:12}}>Cost per produs — taxe alocate proporțional</div>
            {prods.map((p,idx)=>(
              <div key={idx} style={{...sec,border:`1px solid ${showBD===idx?'rgba(249,115,22,.4)':'#1a2535'}`,transition:'border .2s'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12,flexWrap:'wrap',gap:8}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:700}}>{p.name}</div>
                    <div style={{display:'flex',gap:6,marginTop:4,flexWrap:'wrap'}}>
                      <span className="tag" style={{background:'rgba(59,130,246,.12)',color:'#3b82f6',border:'1px solid rgba(59,130,246,.25)'}}>
                        SKU: {p.sku||'—'}
                      </span>
                      <span className="tag" style={{background:'rgba(100,116,139,.1)',color:'#64748b',border:'1px solid #1a2535'}}>
                        {p.qty} buc × ${fmt(p.unitUSD)}
                      </span>
                      <span className="tag" style={{background:'rgba(249,115,22,.08)',color:'#f97316',border:'1px solid rgba(249,115,22,.2)'}}>
                        {fmt(p.prop*100,1)}% din factură
                      </span>
                    </div>
                  </div>
                  <button onClick={()=>setShowBD(showBD===idx?null:idx)}
                    style={{background:'transparent',border:'1px solid #1a2535',color:'#64748b',borderRadius:8,padding:'4px 12px',cursor:'pointer',fontSize:11}}>
                    {showBD===idx?'▲ ascunde':'▼ detalii'}
                  </button>
                </div>

                <div className="g3">
                  {[
                    {lbl:'Preț furnizor',sub:`$${fmt(p.unitUSD)}`,val:fmtRON(p.unitUSD*curs),col:'#e8edf2',bg:'#070d12'},
                    {lbl:'Taxe alocate/buc',sub:'',val:fmtRON(p.qty>0?p.costuri/p.qty:0),col:'#f59e0b',bg:'rgba(245,158,11,.05)'},
                    {lbl:'COST UNITAR',sub:'',val:fmtRON(p.costUnit),col:'#f97316',bg:'rgba(249,115,22,.08)',bold:true},
                  ].map(({lbl:l,sub,val,col,bg,bold})=>(
                    <div key={l} style={{background:bg,border:`1px solid ${bold?'rgba(249,115,22,.25)':'#1a2535'}`,borderRadius:9,padding:'10px 12px',textAlign:'center'}}>
                      <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:.8,marginBottom:3}}>{l}</div>
                      {sub&&<div style={{fontSize:10,color:'#64748b',marginBottom:3}}>{sub}</div>}
                      <div style={{fontSize:bold?17:14,fontWeight:bold?900:700,color:col,fontFamily:'monospace'}}>{val}</div>
                    </div>
                  ))}
                </div>

                {showBD===idx&&(
                  <div style={{marginTop:12,background:'#070d12',borderRadius:9,padding:'12px 14px',border:'1px solid #1a2535'}}>
                    <div style={{fontSize:10,color:'#64748b',marginBottom:8,textTransform:'uppercase',letterSpacing:1}}>Breakdown detaliat</div>
                    {[
                      ['Valoare marfă (RON)',fmtRON(p.valRON),false],
                      ['Transport alocat',fmtRON(p.transportAlocat||0),false],
                      [`Taxă vamală ${p.tvPerc||0}%`,fmtRON(p.taxaVamalaProd||0),false],
                      ['Comision procesare DHL',fmtRON(p.comisionAlocat||0),false],
                      [`TVA ${p.tvaPPerc||21}% (cu TVA inclus)`,fmtRON(p.tvaProd||0),false],
                      [`Total ${p.qty} buc (cu TVA)`,fmtRON(p.totalP),true],
                      ['Cost unitar RON (cu TVA)',fmtRON(p.costUnit),true],
                    ].map(([l,v,bold])=>(
                      <div key={l} className="bdr" style={{fontWeight:bold?700:400}}>
                        <span style={{color:bold?'#f97316':'#64748b',fontSize:12}}>{l}</span>
                        <span style={{fontFamily:'monospace',color:bold?'#f97316':'#e8edf2',fontSize:12}}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* EXPORT */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:18}}>
              <button onClick={exportJSON} style={{background:'linear-gradient(135deg,#10b981,#059669)',color:'white',border:'none',padding:'14px',borderRadius:12,fontWeight:700,fontSize:13,cursor:'pointer',boxShadow:'0 4px 14px rgba(16,185,129,.3)'}}>
                💾 Export JSON cu SKU
              </button>
              <button onClick={exportCSV} style={{background:'linear-gradient(135deg,#3b82f6,#1d4ed8)',color:'white',border:'none',padding:'14px',borderRadius:12,fontWeight:700,fontSize:13,cursor:'pointer',boxShadow:'0 4px 14px rgba(59,130,246,.3)'}}>
                📊 Export CSV
              </button>
            </div>

            {savedResults&&(
              <div style={{marginTop:12,background:'rgba(16,185,129,.06)',border:'1px solid rgba(16,185,129,.2)',borderRadius:12,padding:'14px 16px'}} className="glow-green">
                <div style={{fontSize:13,color:'#10b981',fontWeight:700,marginBottom:6}}>✅ JSON salvat — {savedResults.produse.length} produse cu cost de import</div>
                <div style={{fontSize:11,color:'#475569',marginBottom:10}}>
                  Structura JSON conține SKU, name, costImportUnitarRON — poate fi importat în calculatorul de profit
                </div>
                <details>
                  <summary style={{fontSize:11,color:'#64748b',cursor:'pointer',userSelect:'none'}}>👁 Previzualizare JSON</summary>
                  <pre style={{background:'#070d12',border:'1px solid #1a2535',borderRadius:8,padding:12,fontSize:9,color:'#64748b',overflowX:'auto',marginTop:8,maxHeight:280,overflow:'auto',lineHeight:1.6}}>
                    {JSON.stringify(savedResults,null,2)}
                  </pre>
                </details>
              </div>
            )}

            <div style={{display:'flex',gap:10,marginTop:12}}>
              <button className="bbtn" onClick={()=>setStep(2)}>← Înapoi</button>
              <button className="bbtn" onClick={()=>{setStep(1);setSavedResults(null);setDviData(null);setDhlData(null);setAiMessages({});}}>🔄 Import nou</button>
            </div>

            {/* TABEL FINAL PRODUSE */}
            <div style={{marginTop:24,background:'#0c1520',border:'1px solid #1a2535',borderRadius:14,overflow:'hidden'}}>
              <div style={{padding:'12px 16px',borderBottom:'1px solid #1a2535',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontSize:13,fontWeight:700}}>📋 Lista produse cu prețuri finale (TVA inclus)</div>
                <div style={{fontSize:10,color:'#475569'}}>cost de achiziție per unitate</div>
              </div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                  <thead>
                    <tr style={{background:'#070d12'}}>
                      {['SKU','Produs','Cant','Preț USD','Preț RON','Taxă %','TVA %','Taxe/buc','Cost unitar (cu TVA)'].map(h=>(
                        <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:9,color:'#64748b',textTransform:'uppercase',letterSpacing:1,borderBottom:'1px solid #1a2535',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {prods.map((p,i)=>(
                      <tr key={i} style={{borderBottom:'1px solid #1a2535'}}>
                        <td style={{padding:'9px 12px',fontFamily:'monospace',color:'#3b82f6',fontWeight:700}}>{p.sku||'—'}</td>
                        <td style={{padding:'9px 12px',color:'#e8edf2',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={p.name}>{p.name}</td>
                        <td style={{padding:'9px 12px',color:'#94a3b8',textAlign:'center'}}>{p.qty}</td>
                        <td style={{padding:'9px 12px',fontFamily:'monospace',color:'#94a3b8'}}>${fmt(p.unitUSD)}</td>
                        <td style={{padding:'9px 12px',fontFamily:'monospace',color:'#94a3b8'}}>{fmtRON(p.unitUSD*curs)}</td>
                        <td style={{padding:'9px 12px',color:p.tvPerc===0?'#10b981':'#f59e0b',fontWeight:600}}>{p.tvPerc}%{p.tvPerc===0?<span style={{fontSize:9}}> ✓</span>:''}</td>
                        <td style={{padding:'9px 12px',color:'#a855f7'}}>{p.tvaPPerc}%</td>
                        <td style={{padding:'9px 12px',fontFamily:'monospace',color:'#f59e0b'}}>{fmtRON(p.qty>0?p.costuri/p.qty:0)}</td>
                        <td style={{padding:'9px 12px',fontFamily:'monospace',color:'#f97316',fontWeight:800,fontSize:13}}>{fmtRON(p.costUnit)}</td>
                      </tr>
                    ))}
                    <tr style={{background:'rgba(249,115,22,.05)',borderTop:'2px solid rgba(249,115,22,.2)'}}>
                      <td colSpan={2} style={{padding:'10px 12px',fontWeight:700,color:'#f97316'}}>TOTAL</td>
                      <td style={{padding:'10px 12px',color:'#f97316',fontWeight:700,textAlign:'center'}}>{totalQty}</td>
                      <td style={{padding:'10px 12px',fontFamily:'monospace',color:'#f97316',fontWeight:700}}>${fmt(totalUSD_val)}</td>
                      <td style={{padding:'10px 12px',fontFamily:'monospace',color:'#f97316',fontWeight:700}}>{fmtRON(totalRON_f)}</td>
                      <td colSpan={3}></td>
                      <td style={{padding:'10px 12px',fontFamily:'monospace',color:'#f97316',fontWeight:900,fontSize:14}}>{fmtRON(totalCostRON)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

