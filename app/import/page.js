'use client';
import { useState, useEffect } from 'react';

const fmt = (n, d=2) => Number(n||0).toLocaleString('ro-RO', {minimumFractionDigits:d,maximumFractionDigits:d});
const fmtRON = n => `${fmt(n)} RON`;

const EMPTY = {name:'', sku:'', qty:'1', unitPriceUSD:'', taxaVamala:'', tvaPercent:'21'};

export default function ImportCalc() {
  const [mounted, setMounted] = useState(false);
  const [products, setProducts] = useState([{...EMPTY}]);
  const [transportUSD, setTransportUSD] = useState('');
  const [transportRON, setTransportRON] = useState('');
  const [cursValutar, setCursValutar] = useState('');
  const [cursTransport, setCursTransport] = useState('');
  const [taxaVamalaGlobal, setTaxaVamalaGlobal] = useState('3.7');
  const [taxaVamalaRON, setTaxaVamalaRON] = useState('');
  const [tvaPercent, setTvaPercent] = useState('21');
  const [tvaRON_dvi, setTvaRON_dvi] = useState('');
  const [totalProduseImport, setTotalProduseImport] = useState(0); // total buc pe DVI
  const [comisionDHL, setComisionDHL] = useState('');       // fără TVA
  const [comisionDHLTVA, setComisionDHLTVA] = useState(''); // TVA pe comision
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState('');
  const [aiLoading, setAiLoading] = useState('');
  const [error, setError] = useState('');
  const [aiMsg, setAiMsg] = useState({});
  const [savedJSON, setSavedJSON] = useState(null);
  const [showBD, setShowBD] = useState(null);
  const [dviSegmente, setDviSegmente] = useState([]); // segmente DVI per tip marfă

  useEffect(() => { setMounted(true); }, []);

  const upd = (idx, field, val) =>
    setProducts(p => p.map((x, i) => i === idx ? {...x, [field]: val} : x));

  const loadXLSX = (cb) => {
    if (typeof window !== 'undefined' && window.XLSX) { cb(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = cb;
    s.onerror = () => setError('Nu s-a putut încărca XLSX.js');
    document.head.appendChild(s);
  };

  const handleProductsFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    setLoading('produse'); setError('');
    loadXLSX(() => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = window.XLSX.read(new Uint8Array(ev.target.result), {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = window.XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
          let hi = -1;
          for (let i = 0; i < rows.length; i++) {
            if (rows[i].join(' ').toLowerCase().includes('unit price')) { hi = i; break; }
          }
          if (hi === -1) { setError('Nu am găsit headerul produselor (Unit Price).'); setLoading(''); return; }
          const hdr = rows[hi].map(h => (h||'').toString().toLowerCase());
          const ni = hdr.findIndex(h => h.includes('product') || h.includes('description') || h.includes('品名'));
          const qi = hdr.findIndex(h => h.includes('quantity') || h.includes('qty'));
          const pi = hdr.findIndex(h => h.includes('unit price'));
          const parsed = [];
          for (let i = hi+1; i < rows.length; i++) {
            const r = rows[i];
            const name = (r[ni]||'').toString().trim();
            if (!name || ['total','seller','signature','date','buyer'].some(k => name.toLowerCase().includes(k))) continue;
            const qty = parseFloat(r[qi]) || 0;
            const price = parseFloat(r[pi]) || 0;
            if (qty === 0 && price === 0) continue;
            const sm = name.match(/\b([A-Z]{1,3}\d{2,4}[A-Z0-9]*)\b/);
            parsed.push({name: name.replace(/\s+/g,' '), sku: sm?sm[1]:'', qty: String(qty), unitPriceUSD: String(price), taxaVamala:'', tvaPercent:'21'});
          }
          if (!parsed.length) { setError('Niciun produs găsit în Excel.'); setLoading(''); return; }
          setProducts(parsed);
        } catch(err) { setError('Eroare Excel: ' + err.message); }
        setLoading('');
      };
      reader.readAsArrayBuffer(file);
    });
    e.target.value = '';
  };

  const handleFreightFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    setLoading('transport'); setError('');
    loadXLSX(() => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = window.XLSX.read(new Uint8Array(ev.target.result), {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = window.XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
          let hi = -1;
          for (let i = 0; i < rows.length; i++) {
            if (rows[i].join(' ').toLowerCase().includes('amount')) { hi = i; break; }
          }
          if (hi === -1) { setLoading(''); return; }
          const hdr = rows[hi].map(h => (h||'').toString().toLowerCase());
          const ai = hdr.findIndex(h => h.includes('amount'));
          // Luăm PRIMA valoare validă — nu suma (rândul total/formula dublează valoarea)
          let transportVal = 0;
          for (let i = hi+1; i < rows.length; i++) {
            const r = rows[i];
            if (!r) continue;
            const firstCell = (r[0]||'').toString().toLowerCase().trim();
            // Sărim rânduri goale, total, formule, seller, date
            if (!firstCell || firstCell.includes('total') || firstCell.includes('seller') || firstCell.includes('payment') || firstCell.includes('date')) continue;
            const cellVal = r[ai];
            if (cellVal === null || cellVal === undefined || cellVal === '') continue;
            const cellStr = cellVal.toString().trim();
            if (cellStr.startsWith('=')) continue; // formulă Excel
            const v = parseFloat(cellStr);
            if (!isNaN(v) && v > 0 && v < 50000) {
              transportVal = v; // prima valoare validă — stop
              break;
            }
          }
          setTransportUSD(String(transportVal));
          setTransportRON('');
        } catch(err) { setError('Eroare Excel freight: ' + err.message); }
        setLoading('');
      };
      reader.readAsArrayBuffer(file);
    });
    e.target.value = '';
  };

  const analyzePDF = async (file, type) => {
    setAiLoading(type); setError('');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const system = type === 'dvi'
        ? 'Ești expert în declarații vamale românești. Răspunde DOAR cu JSON: {"cursSchimb":4.3046,"taxaVamalaPercent":3.7,"taxaVamalaRON":419,"tvaPercent":21,"tvaRON":2488}'
        : 'Ești expert în facturi DHL România. Răspunde DOAR cu JSON: {"comisionProcessare":59,"comisionTVA":12.39,"totalDePlata":2978.39}';

      // API call prin serverul Next.js pentru a evita CORS
      const res = await fetch('/api/parse-import-pdf', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ base64, type })
      });

      const data = await res.json();
      if (data.error && !data.parsed) throw new Error(data.error);
      // API returnează parsed direct sau text brut
      let parsed;
      if (data.parsed) {
        parsed = data.parsed;
      } else {
        const text = data.text || '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Format răspuns invalid');
        parsed = JSON.parse(match[0]);
      }
      // Găsim JSON-ul în răspuns - poate fi înconjurat de text
      // parsed e deja definit mai sus

      if (type === 'dvi') {
        if (parsed.cursSchimb) setCursValutar(String(parsed.cursSchimb));
        if (parsed.totalTaxaVamalaRON) setTaxaVamalaRON(String(parsed.totalTaxaVamalaRON));
        if (parsed.totalTVARON) setTvaRON_dvi(String(parsed.totalTVARON));
        if (parsed.totalProduse) setTotalProduseImport(parsed.totalProduse);
        if (parsed.segmente?.length) {
          setDviSegmente(parsed.segmente);
          // Taxa vamală globală = de la primul segment cu taxă > 0
          const segCuTaxa = parsed.segmente.find(s => s.taxaVamalaPercent > 0);
          if (segCuTaxa) setTaxaVamalaGlobal(String(segCuTaxa.taxaVamalaPercent));
          if (parsed.segmente[0]?.tvaPercent) setTvaPercent(String(parsed.segmente[0].tvaPercent));
        }
        const segInfo = parsed.segmente?.map(s => `${s.cantitate} buc: ${s.taxaVamalaPercent}% (${s.taxaVamalaRON} RON) + TVA ${s.tvaRON} RON`).join(' | ') || '';
        const dviMsg = '✅ Curs: ' + parsed.cursSchimb + ' · ' + (parsed.segmente?.length || 1) + ' segmente · Total vamă: ' + parsed.totalTaxaVamalaRON + ' RON · TVA: ' + parsed.totalTvaRON + ' RON' + (segInfo ? ' | ' + segInfo : '');
        setAiMsg(m => ({...m, dvi: dviMsg}));
      } else {
        if (parsed.comisionProcessare) setComisionDHL(String(parsed.comisionProcessare));
        if (parsed.comisionTVA) setComisionDHLTVA(String(parsed.comisionTVA));
        setAiMsg(m => ({...m, dhl:`✅ Comision: ${parsed.comisionProcessare} RON + TVA ${parsed.comisionTVA} RON = ${((parsed.comisionProcessare||0)+(parsed.comisionTVA||0)).toFixed(2)} RON total · împărțit la nr produse`}));
      }
    } catch(err) { setError(`Eroare AI: ${err.message}`); }
    setAiLoading('');
  };

  // ── CALCULE ──
  const curs = parseFloat(cursValutar) || 0;
  const cursT = parseFloat(cursTransport) || curs;
  const tRON = transportRON ? parseFloat(transportRON)||0 : (parseFloat(transportUSD)||0) * cursT;
  // Comision DHL cu TVA inclus (71.39 = 59 + 12.39) — acesta se împarte la nr produse
  const comisionNetRON = parseFloat(comisionDHL) || 0;
  const comisionTVARON = comisionDHLTVA ? parseFloat(comisionDHLTVA)||0
    : comisionNetRON * (parseFloat(tvaPercent)||21) / 100;
  const comRON = comisionNetRON + comisionTVARON; // total cu TVA

  const totalQty = products.reduce((s,p) => s + (parseFloat(p.qty)||0), 0);
  const totalUSD = products.reduce((s,p) => s + (parseFloat(p.qty)||0)*(parseFloat(p.unitPriceUSD)||0), 0);
  const totalRON_f = totalUSD * curs;

  // Taxe globale din DVI (dacă există valorile exacte)
  // Taxă vamală totală — din câmpul DVI exact sau calculat din %
  const taxaV_RON_global = taxaVamalaRON ? parseFloat(taxaVamalaRON)||0
    : (totalRON_f + tRON) * (parseFloat(taxaVamalaGlobal)||0) / 100;

  // TVA total — ÎNTOTDEAUNA din câmpul DVI exact (tvaRON_dvi) dacă există
  // Nu recalculăm niciodată TVA din procente când avem valoarea din DVI
  const tva_RON_global = tvaRON_dvi
    ? parseFloat(tvaRON_dvi)||0
    : (totalRON_f + tRON + taxaV_RON_global) * (parseFloat(tvaPercent)||21) / 100;

  // Total sumar — folosit în preview și header sumar
  const totalCosturiGlobal = tRON + taxaV_RON_global + comRON + tva_RON_global;
  const totalCostRON = totalRON_f + totalCosturiGlobal;

  // Cost per produs cu taxe din DVI per segment
  // Transport și comision se împart la totalQty (toți produsele)
  const transportPerBuc = totalQty > 0 ? tRON / totalQty : 0;
  const comisionPerBuc  = totalQty > 0 ? comRON / totalQty : 0;

  const prods = products.map((p, idx) => {
    const qty = parseFloat(p.qty) || 0;
    const unitUSD = parseFloat(p.unitPriceUSD) || 0;
    const valUSD = qty * unitUSD;
    const valRON = valUSD * curs;

    // Mapăm fiecare produs la segmentul DVI corect:
    // - Produsele cu taxă vamală setată explicit la 0 → segmentul cu taxă 0% (printer)
    // - Restul → segmentul principal (ceasuri)
    let seg = null;
    if (dviSegmente.length > 0) {
      const isPrinter = p.taxaVamala === '0' || 
        (p.name||'').toLowerCase().includes('printer') || 
        (p.name||'').toLowerCase().includes('server') ||
        (p.sku||'').toLowerCase().includes('server');
      if (isPrinter) {
        // Caută segmentul cu taxă vamală 0
        seg = dviSegmente.find(s => (s.taxaVamalaPercent||0) === 0 || (s.taxaVamalaRON||0) === 0)
           || dviSegmente[dviSegmente.length - 1];
      } else {
        // Caută primul segment cu taxă vamală > 0 (ceasurile)
        seg = dviSegmente.find(s => (s.taxaVamalaRON||0) > 0)
           || dviSegmente[0];
      }
    }

    const tvaPPerc = parseFloat(p.tvaPercent) || 21;

    let taxaVProd, tvaProd;

    if (seg && dviSegmente.length > 0) {
      // Folosim sumele exacte din DVI împărțite la cantitatea segmentului
      const segQty = seg.cantitate || qty;
      taxaVProd = (seg.taxaVamalaRON || 0) / segQty * qty;
      // TVA din DVI per buc × cantitate
      tvaProd = (seg.tvaRON || 0) / segQty * qty;
    } else {
      // Fallback: calcul din procente
      const tvPerc = p.taxaVamala !== '' ? parseFloat(p.taxaVamala)||0 : parseFloat(taxaVamalaGlobal)||0;
      const prop = totalUSD > 0 ? valUSD / totalUSD : 0;
      const transportAl = tRON * prop;
      taxaVProd = (valRON + transportAl) * tvPerc / 100;
      tvaProd = (valRON + transportAl + taxaVProd + comRON * prop) * tvaPPerc / 100;
    }

    // Transport și comision per bucată × cantitate
    const transportAlocat = transportPerBuc * qty;
    const comisionAlocat  = comisionPerBuc * qty;

    const costuri = transportAlocat + taxaVProd + comisionAlocat + tvaProd;
    const totalP = valRON + costuri;
    const costUnit = qty > 0 ? totalP / qty : 0;

    const tvPerc = seg ? seg.taxaVamalaPercent||0 : (p.taxaVamala !== '' ? parseFloat(p.taxaVamala)||0 : parseFloat(taxaVamalaGlobal)||0);

    return {name:p.name, sku:p.sku, qty, unitUSD, valUSD, valRON,
      prop: totalUSD > 0 ? valUSD/totalUSD : 0,
      transportAlocat, taxaVProd, comisionAlocat, tvaProd,
      costuri, totalP, costUnit, tvPerc, tvaPPerc,
      dinDVI: !!seg};
  });

  // Total real = suma tuturor produselor cu taxele corecte din DVI
  const totalCostRON_real = dviSegmente.length > 0
    ? prods.reduce((s,p) => s + p.totalP, 0)
    : totalCostRON;

  const exportJSON = () => {
    const data = {
      meta: {data: new Date().toISOString().slice(0,10), cursValutar:curs,
        taxaVamalaPercent: parseFloat(taxaVamalaGlobal)||0, taxaVamalaRON: taxaV_RON_global,
        tvaPercent: parseFloat(tvaPercent)||21, tvaRON: tva_RON_global,
        comisionDHL: comRON, transportRON: tRON, totalCostRON},
      produse: prods.map(p => ({
        sku: p.sku || p.name.replace(/\s+/g,'_').toUpperCase(),
        name: p.name.trim(), qty: p.qty,
        pretFurnizorUSD: +p.unitUSD.toFixed(4),
        pretFurnizorRON: +(p.unitUSD * curs).toFixed(2),
        costImportUnitarRON: +p.costUnit.toFixed(2),
        taxeAlocateRON: +(p.costuri / p.qty).toFixed(2),
        totalProdusRON: +p.totalP.toFixed(2),
      })),
    };
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `import-${data.meta.data}.json`;
    a.click();
    setSavedJSON(data);
  };

  const exportCSV = () => {
    const rows = [['SKU','Produs','Cant','Pret USD','Pret RON','TaxaVam%','TVA%','Taxe/buc RON','Cost unitar RON (cu TVA)','Total RON']];
    prods.forEach(p => rows.push([
      p.sku, `"${p.name}"`, p.qty, fmt(p.unitUSD), fmt(p.unitUSD*curs),
      p.tvPerc, p.tvaPPerc, fmt(p.costuri/p.qty), fmt(p.costUnit), fmt(p.totalP)
    ]));
    const blob = new Blob(['\uFEFF'+rows.map(r=>r.join(',')).join('\n')], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'import-cost.csv'; a.click();
  };

  const exportXLSX = () => {
    loadXLSX(() => {
      const wb = window.XLSX.utils.book_new();

      // ── Sheet 1: Produse ──
      const dataSheet = [
        ['SKU', 'Produs', 'Cantitate', 'Pret furnizor USD', 'Pret furnizor RON',
         'Taxa vamala %', 'Taxa vamala RON', 'TVA %', 'TVA RON',
         'Transport/buc RON', 'Comision DHL/buc RON',
         'Taxe totale/buc RON', 'Cost unitar RON (cu TVA)', 'Total produs RON'],
      ];
      prods.forEach(p => dataSheet.push([
        p.sku,
        p.name,
        p.qty,
        +p.unitUSD.toFixed(4),
        +(p.unitUSD * curs).toFixed(2),
        p.tvPerc,
        +p.taxaVProd.toFixed(2),
        p.tvaPPerc,
        +p.tvaProd.toFixed(2),
        +(p.transportAlocat / p.qty).toFixed(4),
        +(p.comisionAlocat / p.qty).toFixed(4),
        +(p.costuri / p.qty).toFixed(2),
        +p.costUnit.toFixed(2),
        +p.totalP.toFixed(2),
      ]));
      // Rând TOTAL
      dataSheet.push([
        'TOTAL', '', totalQty, '', +totalRON_f.toFixed(2),
        '', +taxaV_RON_global.toFixed(2), '', +tva_RON_global.toFixed(2),
        '', '', '',
        '',
        +(dviSegmente.length>0?totalCostRON_real:totalCostRON).toFixed(2),
      ]);

      const ws1 = window.XLSX.utils.aoa_to_sheet(dataSheet);

      // Lățimi coloane
      ws1['!cols'] = [
        {wch:10},{wch:30},{wch:10},{wch:16},{wch:16},
        {wch:12},{wch:16},{wch:8},{wch:12},
        {wch:16},{wch:18},
        {wch:18},{wch:22},{wch:18},
      ];

      window.XLSX.utils.book_append_sheet(wb, ws1, 'Produse');

      // ── Sheet 2: Sumar import ──
      const data = new Date().toISOString().slice(0,10);
      const totalFinal = dviSegmente.length>0?totalCostRON_real:totalCostRON;
      const sumarSheet = [
        ['SUMAR IMPORT', ''],
        ['Data', data],
        [''],
        ['Curs valutar (USD/RON)', curs],
        [''],
        ['Valoare marfă furnizor (RON)', +totalRON_f.toFixed(2)],
        ['Transport DHL (RON)', +tRON.toFixed(2)],
        ['Taxă vamală (RON)', +taxaV_RON_global.toFixed(2)],
        ['Comision procesare DHL (RON cu TVA)', +comRON.toFixed(2)],
        ['TVA (RON)', +tva_RON_global.toFixed(2)],
        [''],
        ['TOTAL COST IMPORT (RON)', +totalFinal.toFixed(2)],
        ['Cost mediu / bucată (RON)', +(totalQty>0?totalFinal/totalQty:0).toFixed(2)],
        ['Total bucăți', totalQty],
      ];
      const ws2 = window.XLSX.utils.aoa_to_sheet(sumarSheet);
      ws2['!cols'] = [{wch:35},{wch:20}];
      window.XLSX.utils.book_append_sheet(wb, ws2, 'Sumar');

      // Download
      window.XLSX.writeFile(wb, `import-cost-${data}.xlsx`);
    });
  };

  // ── STYLES ──
  const inp = {background:'#070d12',border:'1px solid #1a2535',color:'#e8edf2',padding:'9px 12px',borderRadius:8,fontSize:13,outline:'none',width:'100%',fontFamily:'monospace'};
  const lbl = {fontSize:10,color:'#64748b',textTransform:'uppercase',letterSpacing:1,marginBottom:5,display:'block'};
  const sec = {background:'#0c1520',border:'1px solid #1a2535',borderRadius:14,padding:'18px 20px',marginBottom:14};
  const stepStyle = (s) => ({
    background: step>=s ? 'linear-gradient(135deg,#f97316,#ea580c)' : '#0c1520',
    color: step>=s ? 'white' : '#475569',
    border: `1px solid ${step>=s?'transparent':'#1a2535'}`,
    borderRadius:22, padding:'6px 18px', fontSize:11, cursor:'pointer', fontWeight:step===s?700:400,
  });

  if (!mounted) return (
    <div style={{minHeight:'100vh',background:'#060b10',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{color:'#f97316',fontSize:14}}>Se încarcă...</div>
    </div>
  );

  return (
    <>
      

      <div className="w">
        {/* HEADER */}
        <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:28,paddingBottom:20,borderBottom:'1px solid #1a2535',flexWrap:'wrap'}}>
          <div style={{background:'linear-gradient(135deg,#f97316,#ea580c)',color:'#fff',fontWeight:800,fontSize:15,padding:'7px 12px',borderRadius:10}}>GLAMX</div>
          <div>
            <div style={{fontSize:20,fontWeight:800}}>Calculator Cost Import</div>
            <div style={{fontSize:11,color:'#64748b',marginTop:2}}>🤖 AI citește DVI + Factură DHL · Export JSON cu SKU</div>
          </div>
          <a href="/" style={{marginLeft:'auto',background:'#0c1520',border:'1px solid #1a2535',color:'#64748b',padding:'6px 14px',borderRadius:22,fontSize:11,textDecoration:'none'}}>← Dashboard</a>
        </div>

        {/* STEPS */}
        <div style={{display:'flex',gap:8,marginBottom:24,flexWrap:'wrap'}}>
          {[['1','📦 Produse'],['2','🛃 DVI & Taxe'],['3','📊 Rezultate']].map(([s,l]) => (
            <button key={s} style={stepStyle(parseInt(s))} onClick={() => parseInt(s) < step && setStep(parseInt(s))}>
              {l} {parseInt(s) < step ? '✓' : ''}
            </button>
          ))}
        </div>

        {error && (
          <div style={{background:'rgba(244,63,94,.08)',border:'1px solid rgba(244,63,94,.25)',borderRadius:10,padding:'10px 16px',color:'#f43f5e',fontSize:12,marginBottom:14}}>
            ⚠️ {error}
          </div>
        )}

        {/* ══ STEP 1 ══ */}
        {step === 1 && (
          <div>
            {/* PRODUSE */}
            <div style={sec}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:8}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700}}>📦 Produse din factură furnizor</div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:2}}>Import Excel sau adaugă manual</div>
                </div>
                <label className="ubtn" style={{background:'rgba(249,115,22,.12)',color:'#f97316',border:'1px solid rgba(249,115,22,.3)'}}>
                  {loading==='produse' ? <span className="pulse">⟳ Se încarcă...</span> : '📂 Import Excel factură'}
                  <input type="file" accept=".xlsx,.xls" onChange={handleProductsFile} style={{display:'none'}}/>
                </label>
              </div>

              {products.map((p, idx) => (
                <div key={idx} style={{background:'#070d12',borderRadius:10,padding:'14px',marginBottom:10,border:'1px solid #1a2535'}}>
                  <div className="g2" style={{marginBottom:10}}>
                    <div>
                      <label style={lbl}>Nume produs</label>
                      <input style={inp} value={p.name} placeholder="ex: Smart watch DM56"
                        onChange={e => upd(idx,'name',e.target.value)}/>
                    </div>
                    <div>
                      <label style={lbl}>SKU <span style={{color:'#3b82f6',fontSize:9}}>★ pentru profit</span></label>
                      <input style={{...inp,borderColor:'rgba(59,130,246,.3)'}} value={p.sku} placeholder="ex: DM56"
                        onChange={e => upd(idx,'sku',e.target.value)}/>
                    </div>
                  </div>
                  <div className="g2" style={{marginBottom:10}}>
                    <div>
                      <label style={lbl}>Cantitate</label>
                      <input type="number" style={inp} value={p.qty} min="1"
                        onChange={e => upd(idx,'qty',e.target.value)}/>
                    </div>
                    <div>
                      <label style={lbl}>Preț unitar (USD)</label>
                      <input type="number" style={inp} value={p.unitPriceUSD} step="0.01"
                        onChange={e => upd(idx,'unitPriceUSD',e.target.value)}/>
                    </div>
                  </div>
                  <div className="g2">
                    <div>
                      <label style={lbl}>Taxă vamală % <span style={{color:'#3b82f6'}}>per produs</span></label>
                      <input type="number" style={{...inp, borderColor: p.taxaVamala!==''?'rgba(245,158,11,.5)':'#1a2535'}} value={p.taxaVamala} step="0.1" min="0"
                        placeholder={`default: ${taxaVamalaGlobal||'0'}%`}
                        onChange={e => upd(idx,'taxaVamala',e.target.value)}/>
                      {p.taxaVamala===''&&<div style={{fontSize:9,color:'#475569',marginTop:2}}>Gol = folosește globala ({taxaVamalaGlobal||'0'}%)</div>}
                      {p.taxaVamala==='0'&&<div style={{fontSize:10,color:'#10b981',marginTop:2}}>✓ Fără taxă vamală (ex: printer server)</div>}
                      {p.taxaVamala!==''&&p.taxaVamala!=='0'&&<div style={{fontSize:10,color:'#f59e0b',marginTop:2}}>Taxă: {p.taxaVamala}%</div>}
                    </div>
                    <div>
                      <label style={lbl}>TVA %</label>
                      <input type="number" style={inp} value={p.tvaPercent} step="0.1" placeholder="21"
                        onChange={e => upd(idx,'tvaPercent',e.target.value)}/>
                    </div>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:10}}>
                    <span style={{fontSize:12,color:'#f97316',fontFamily:'monospace',fontWeight:700}}>
                      ${fmt((parseFloat(p.qty)||0)*(parseFloat(p.unitPriceUSD)||0))}
                    </span>
                    {products.length > 1 && (
                      <button onClick={() => setProducts(prev => prev.filter((_,i) => i!==idx))}
                        style={{background:'rgba(244,63,94,.1)',border:'1px solid rgba(244,63,94,.2)',color:'#f43f5e',borderRadius:7,padding:'3px 9px',cursor:'pointer',fontSize:11}}>
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <button onClick={() => setProducts(p => [...p, {...EMPTY}])}
                style={{background:'transparent',border:'1px dashed #1a2535',color:'#475569',padding:10,borderRadius:9,cursor:'pointer',fontSize:12,width:'100%',marginTop:4}}>
                + Adaugă produs manual
              </button>

              {totalUSD > 0 && (
                <div style={{marginTop:12,padding:'10px 14px',background:'rgba(249,115,22,.06)',borderRadius:9,border:'1px solid rgba(249,115,22,.18)',display:'flex',justifyContent:'space-between'}}>
                  <span style={{color:'#64748b',fontSize:12}}>Total factură furnizor</span>
                  <span style={{color:'#f97316',fontFamily:'monospace',fontWeight:800}}>${fmt(totalUSD)} · {totalQty} buc</span>
                </div>
              )}
            </div>

            {/* TRANSPORT */}
            <div style={sec}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:8}}>
                <div style={{fontSize:14,fontWeight:700}}>✈️ Transport DHL</div>
                <label className="ubtn" style={{background:'rgba(16,185,129,.1)',color:'#10b981',border:'1px solid rgba(16,185,129,.25)'}}>
                  {loading==='transport' ? <span className="pulse">⟳</span> : '📂 Import Excel freight'}
                  <input type="file" accept=".xlsx,.xls" onChange={handleFreightFile} style={{display:'none'}}/>
                </label>
              </div>
              <div className="g2">
                <div>
                  <label style={lbl}>Cost transport (USD)</label>
                  <input type="number" style={inp} value={transportUSD} step="0.01" placeholder="ex: 257.27"
                    onChange={e => { setTransportUSD(e.target.value); setTransportRON(''); }}/>
                  <div style={{fontSize:10,color:'#475569',margin:'6px 0 4px'}}>— sau în RON —</div>
                  <input type="number" style={inp} value={transportRON} step="0.01" placeholder="ex: 1250 RON"
                    onChange={e => { setTransportRON(e.target.value); setTransportUSD(''); }}/>
                </div>
                <div>
                  <label style={lbl}>Curs transport (dacă diferit de DVI)</label>
                  <input type="number" style={inp} value={cursTransport} step="0.0001" placeholder="ex: 4.3046"
                    onChange={e => setCursTransport(e.target.value)}/>
                  <div style={{fontSize:10,color:'#475569',marginTop:8}}>Lasă gol = curs din DVI</div>
                </div>
              </div>
            </div>

            <button className="nbtn" onClick={() => setStep(2)} disabled={products.every(p => !p.name.trim() && !p.unitPriceUSD)}>
              Continuă → DVI & Taxe Vamale
            </button>
          </div>
        )}

        {/* ══ STEP 2 ══ */}
        {step === 2 && (
          <div>
            {/* AI DVI */}
            <div style={{...sec, border:'1px solid rgba(168,85,247,.3)', background:'rgba(168,85,247,.04)'}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>🤖 AI — Citire automată DVI</div>
              <div style={{fontSize:11,color:'#64748b',marginBottom:10}}>Încarcă PDF-ul DVI — AI extrage cursul, taxele vamale, TVA automat</div>
              {aiMsg.dvi && <div style={{marginBottom:10,padding:'8px 12px',background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:8,fontSize:11,color:'#10b981'}}>
                <div style={{fontWeight:700,marginBottom:4}}>{aiMsg.dvi.split('\n')[0]}</div>
                {dviSegmente.length > 0 && dviSegmente.map((s,i) => (
                  <div key={i} style={{fontSize:10,color:'#64748b',marginTop:2}}>
                    📦 {s.descriere?.slice(0,50)} → taxă {s.taxaVamalaPercent}% ({s.taxaVamalaRON} RON) · TVA {s.tvaRON} RON
                  </div>
                ))}
              </div>}
              <label className="aibtn" style={{background:'linear-gradient(135deg,#a855f7,#7c3aed)',color:'white',boxShadow:'0 4px 14px rgba(168,85,247,.3)'}}>
                {aiLoading==='dvi' ? <span className="pulse">🤖 Analizează DVI...</span> : '🤖 Analizează DVI cu AI'}
                <input type="file" accept=".pdf" onChange={e => { const f=e.target.files[0]; if(f) analyzePDF(f,'dvi'); e.target.value=''; }} style={{display:'none'}} disabled={aiLoading==='dvi'}/>
              </label>
            </div>

            {/* AI DHL */}
            <div style={{...sec, border:'1px solid rgba(59,130,246,.25)', background:'rgba(59,130,246,.03)'}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>🤖 AI — Citire automată Factură DHL</div>
              <div style={{fontSize:11,color:'#64748b',marginBottom:10}}>AI extrage comisionul de procesare automat</div>
              {aiMsg.dhl && <div style={{marginBottom:10,padding:'8px 12px',background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:8,fontSize:11,color:'#10b981'}}>{aiMsg.dhl}</div>}
              <label className="aibtn" style={{background:'linear-gradient(135deg,#3b82f6,#1d4ed8)',color:'white',boxShadow:'0 4px 14px rgba(59,130,246,.3)'}}>
                {aiLoading==='dhl' ? <span className="pulse">🤖 Analizează factura...</span> : '🤖 Analizează Factură DHL'}
                <input type="file" accept=".pdf" onChange={e => { const f=e.target.files[0]; if(f) analyzePDF(f,'dhl'); e.target.value=''; }} style={{display:'none'}} disabled={aiLoading==='dhl'}/>
              </label>
            </div>

            {/* CÂMPURI MANUALE */}
            <div style={sec}>
              <div style={{fontSize:11,color:'#64748b',marginBottom:14,padding:'8px 12px',background:'rgba(245,158,11,.06)',borderRadius:8}}>
                ✏️ Completate automat după AI — verifică și ajustează dacă e necesar
              </div>
              <div className="g2" style={{marginBottom:12}}>
                <div>
                  <label style={lbl}>Curs valutar DVI (USD→RON)</label>
                  <input type="number" style={{...inp,borderColor:cursValutar?'rgba(16,185,129,.4)':'#1a2535'}} value={cursValutar} step="0.0001" placeholder="ex: 4.3046" onChange={e => setCursValutar(e.target.value)}/>
                  {cursValutar && curs > 0 && (
                    <div style={{fontSize:10,color:'#10b981',marginTop:5}}>${fmt(totalUSD)} × {cursValutar} = {fmtRON(totalRON_f)}</div>
                  )}
                </div>
                <div>
                  <label style={lbl}>Total bucăți pe DVI (pentru împărțit transport/comision)</label>
                  <input type="number" style={{...inp,borderColor:totalProduseImport?'rgba(16,185,129,.4)':'#1a2535'}} value={totalProduseImport||''} step="1" min="1" placeholder={`ex: ${totalQty} (auto)`}
                    onChange={e => setTotalProduseImport(parseFloat(e.target.value)||0)}/>
                  <div style={{fontSize:10,color:'#475569',marginTop:4}}>
                    Transport {fmtRON(tRON)} ÷ {totalProduseImport||totalQty} buc = {fmtRON(tRON/(totalProduseImport||totalQty||1))}/buc
                  </div>
                </div>
                <div>
                  <label style={lbl}>Taxă vamală globală (%)</label>
                  <input type="number" style={{...inp,borderColor:taxaVamalaGlobal?'rgba(16,185,129,.4)':'#1a2535'}} value={taxaVamalaGlobal} step="0.1" min="0" placeholder="ex: 3.7" onChange={e => setTaxaVamalaGlobal(e.target.value)}/>
                </div>
              </div>
              <div className="g2" style={{marginBottom:12}}>
                <div>
                  <label style={lbl}>Taxă vamală plătită din DVI (RON)</label>
                  <input type="number" style={{...inp,borderColor:taxaVamalaRON?'rgba(245,158,11,.4)':'#1a2535'}} value={taxaVamalaRON} step="0.01" placeholder="ex: 419" onChange={e => setTaxaVamalaRON(e.target.value)}/>
                  <div style={{fontSize:10,color:'#475569',marginTop:4}}>Suma exactă din DVI — prioritară față de %</div>
                </div>
                <div>
                  <label style={lbl}>TVA plătit din DVI (RON)</label>
                  <input type="number" style={{...inp,borderColor:tvaRON_dvi?'rgba(168,85,247,.4)':'#1a2535'}} value={tvaRON_dvi} step="0.01" placeholder="ex: 2488" onChange={e => setTvaRON_dvi(e.target.value)}/>
                </div>
              </div>
              <div className="g2">
                <div>
                  <label style={lbl}>TVA %</label>
                  <input type="number" style={inp} value={tvaPercent} step="0.1" placeholder="21" onChange={e => setTvaPercent(e.target.value)}/>
                </div>
                <div>
                  <label style={lbl}>Comision procesare DHL (RON, cu TVA inclus)</label>
                  <input type="number" style={{...inp,borderColor:comisionDHL?'rgba(59,130,246,.4)':'#1a2535'}} value={comisionDHL} step="0.01" placeholder="ex: 71.39" onChange={e => setComisionDHL(e.target.value)}/>
                  {comisionDHL && <div style={{fontSize:10,color:'#3b82f6',marginTop:4}}>
                    Fără TVA: <strong>{((parseFloat(comisionDHL)||0)/1.21).toFixed(2)} RON</strong> · TVA: <strong>{((parseFloat(comisionDHL)||0) - (parseFloat(comisionDHL)||0)/1.21).toFixed(2)} RON</strong>
                  </div>}
                </div>
              </div>
            </div>

            {/* PREVIEW */}
            {curs > 0 && (
              <div style={sec}>
                <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:1,marginBottom:10}}>Preview calcul</div>
                {[
                  ['📄 Valoare marfă', fmtRON(totalRON_f), '#e8edf2'],
                  ['✈️ Transport', fmtRON(tRON), '#3b82f6'],
                  [`🛃 Taxe vamale${taxaVamalaRON?' (DVI)':' per produs'}`, fmtRON(taxaV_RON_global), '#f59e0b'],
                  [`🏢 Comision DHL (cu TVA: ${comRON.toFixed(2)} RON)`, fmtRON(comRON), '#94a3b8'],
                  [`💰 TVA${tvaRON_dvi?' (DVI)':` ${tvaPercent}%`}`, fmtRON(tva_RON_global), '#a855f7'],
                  ['📦 TOTAL (cu TVA)', fmtRON(dviSegmente.length>0?totalCostRON_real:totalCostRON), '#f97316'],
                ].map(([l,v,c], i) => (
                  <div key={l} className="bdr" style={{fontWeight:i===5?800:400}}>
                    <span style={{color:i===5?'#f97316':'#64748b'}}>{l}</span>
                    <span style={{color:c,fontFamily:'monospace',fontSize:i===5?15:12}}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{display:'flex',gap:10,marginTop:12}}>
              <button className="bbtn" onClick={() => setStep(1)}>← Înapoi</button>
              <button className="nbtn" style={{flex:2,marginTop:0}} onClick={() => setStep(3)} disabled={!cursValutar}>
                Calculează Rezultatele →
              </button>
            </div>
          </div>
        )}

        {/* ══ STEP 3 ══ */}
        {step === 3 && (
          <div>
            {/* SUMAR */}
            <div style={{...sec, border:'1px solid rgba(249,115,22,.3)', background:'linear-gradient(135deg,#0c1520,#111d2b)'}}>
              <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>Sumar total import</div>
              {[
                ['📄 Valoare marfă furnizor', `$${fmt(totalUSD)} × ${cursValutar}`, fmtRON(totalRON_f), '#e8edf2'],
                ['✈️ Transport DHL', '', fmtRON(tRON), '#3b82f6'],
                [`🛃 Taxă vamală${taxaVamalaRON?' (DVI)':` ${taxaVamalaGlobal}%`}`, '', fmtRON(taxaV_RON_global), '#f59e0b'],
                ['🏢 Comision procesare DHL', '', fmtRON(comRON), '#94a3b8'],
                [`💰 TVA${tvaRON_dvi?' (DVI)':` ${tvaPercent}%`}`, '', fmtRON(tva_RON_global), '#a855f7'],
              ].map(([l,sub,v,c]) => (
                <div key={l} className="bdr">
                  <div>
                    <div style={{color:'#64748b',fontSize:12}}>{l}</div>
                    {sub && <div style={{fontSize:10,color:'#334155'}}>{sub}</div>}
                  </div>
                  <span style={{color:c,fontFamily:'monospace',fontWeight:600}}>{v}</span>
                </div>
              ))}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:12,marginTop:6,borderTop:'2px solid rgba(249,115,22,.2)'}}>
                <span style={{fontSize:16,fontWeight:800}}>TOTAL (cu TVA inclus)</span>
                <span style={{fontSize:22,fontWeight:900,color:'#f97316',fontFamily:'monospace'}}>{fmtRON(dviSegmente.length>0?totalCostRON_real:totalCostRON)}</span>
              </div>
              <div style={{textAlign:'right',marginTop:6,fontSize:11,color:'#475569'}}>
                {totalQty} buc · cost mediu <strong style={{color:'#f97316'}}>{fmtRON(totalQty>0?totalCostRON/totalQty:0)}</strong> / buc
              </div>
            </div>

            {/* PRODUSE CARDS */}
            <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:2,margin:'16px 0 12px'}}>
              Cost per produs (TVA inclus)
            </div>
            {prods.map((p, idx) => (
              <div key={idx} style={{...sec, border:`1px solid ${showBD===idx?'rgba(249,115,22,.4)':'#1a2535'}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12,flexWrap:'wrap',gap:8}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:700}}>{p.name}</div>
                    <div style={{display:'flex',gap:6,marginTop:4,flexWrap:'wrap'}}>
                      <span style={{background:'rgba(59,130,246,.12)',color:'#3b82f6',border:'1px solid rgba(59,130,246,.2)',padding:'2px 8px',borderRadius:20,fontSize:10,fontWeight:600}}>
                        SKU: {p.sku||'—'}
                      </span>
                      <span style={{background:'rgba(100,116,139,.08)',color:'#64748b',border:'1px solid #1a2535',padding:'2px 8px',borderRadius:20,fontSize:10}}>
                        {p.qty} buc × ${fmt(p.unitUSD)} · taxă {p.tvPerc}% · TVA {p.tvaPPerc}%
                      </span>
                      {p.dinDVI && <span style={{background:'rgba(168,85,247,.1)',color:'#a855f7',border:'1px solid rgba(168,85,247,.2)',padding:'2px 8px',borderRadius:20,fontSize:10}}>🤖 taxe din DVI</span>}
                    </div>
                  </div>
                  <button onClick={() => setShowBD(showBD===idx?null:idx)}
                    style={{background:'transparent',border:'1px solid #1a2535',color:'#64748b',borderRadius:8,padding:'4px 12px',cursor:'pointer',fontSize:11}}>
                    {showBD===idx?'▲':'▼'}
                  </button>
                </div>

                <div className="g3">
                  {[
                    {l:'Preț furnizor', sub:`$${fmt(p.unitUSD)}`, v:fmtRON(p.unitUSD*curs), c:'#e8edf2', bg:'#070d12'},
                    {l:'Taxe/buc', sub:'transport+vamă+comision+TVA', v:fmtRON(p.qty>0?p.costuri/p.qty:0), c:'#f59e0b', bg:'rgba(245,158,11,.04)'},
                    {l:'COST UNITAR', sub:'cu TVA inclus', v:fmtRON(p.costUnit), c:'#f97316', bg:'rgba(249,115,22,.08)', bold:true},
                  ].map(({l,sub,v,c,bg,bold}) => (
                    <div key={l} style={{background:bg,border:`1px solid ${bold?'rgba(249,115,22,.25)':'#1a2535'}`,borderRadius:9,padding:'10px 12px',textAlign:'center'}}>
                      <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',marginBottom:3}}>{l}</div>
                      <div style={{fontSize:9,color:'#334155',marginBottom:4}}>{sub}</div>
                      <div style={{fontSize:bold?17:14,fontWeight:bold?900:700,color:c,fontFamily:'monospace'}}>{v}</div>
                    </div>
                  ))}
                </div>

                {showBD === idx && (
                  <div style={{marginTop:12,background:'#070d12',borderRadius:9,padding:'12px 14px',border:'1px solid #1a2535'}}>
                    {[
                      ['Valoare marfă RON', fmtRON(p.valRON), false],
                      [`Transport (${fmtRON(p.transportPerBuc||0)}/buc × ${p.qty})`, fmtRON(p.transportAlocat), false],
                      [`Taxă vamală ${p.tvPerc}% din DVI`, fmtRON(p.taxaVProd), false],
                      [`Comision DHL cu TVA (${fmtRON(p.comisionPerBuc||0)}/buc × ${p.qty})`, fmtRON(p.comisionAlocat), false],
                      [`TVA ${p.tvaPPerc}% din DVI`, fmtRON(p.tvaProd), false],
                      [`Total ${p.qty} buc (cu TVA inclus)`, fmtRON(p.totalP), true],
                      ['Cost unitar RON (cu TVA)', fmtRON(p.costUnit), true],
                    ].map(([l,v,bold]) => (
                      <div key={l} className="bdr" style={{fontWeight:bold?700:400}}>
                        <span style={{color:bold?'#f97316':'#64748b'}}>{l}</span>
                        <span style={{fontFamily:'monospace',color:bold?'#f97316':'#e8edf2'}}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* TABEL FINAL */}
            <div style={{...sec, padding:0, overflow:'hidden'}}>
              <div style={{padding:'12px 16px',borderBottom:'1px solid #1a2535',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontSize:13,fontWeight:700}}>📋 Lista produse — costuri finale cu TVA</div>
              </div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                  <thead>
                    <tr style={{background:'#070d12'}}>
                      {['SKU','Produs','Cant','Preț USD','Preț RON','TV%','TVA%','Taxe/buc','Cost unitar (cu TVA)'].map(h => (
                        <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:9,color:'#64748b',textTransform:'uppercase',letterSpacing:1,borderBottom:'1px solid #1a2535',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {prods.map((p,i) => (
                      <tr key={i} style={{borderBottom:'1px solid #1a2535'}}>
                        <td style={{padding:'9px 12px',fontFamily:'monospace',color:'#3b82f6',fontWeight:700}}>{p.sku||'—'}</td>
                        <td style={{padding:'9px 12px',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={p.name}>{p.name}</td>
                        <td style={{padding:'9px 12px',color:'#94a3b8',textAlign:'center'}}>{p.qty}</td>
                        <td style={{padding:'9px 12px',fontFamily:'monospace',color:'#94a3b8'}}>${fmt(p.unitUSD)}</td>
                        <td style={{padding:'9px 12px',fontFamily:'monospace',color:'#94a3b8'}}>{fmtRON(p.unitUSD*curs)}</td>
                        <td style={{padding:'9px 12px',color:p.tvPerc===0?'#10b981':'#f59e0b',fontWeight:700}}>{p.tvPerc}%</td>
                        <td style={{padding:'9px 12px',color:'#a855f7'}}>{p.tvaPPerc}%</td>
                        <td style={{padding:'9px 12px',fontFamily:'monospace',color:'#f59e0b'}}>{fmtRON(p.qty>0?p.costuri/p.qty:0)}</td>
                        <td style={{padding:'9px 12px',fontFamily:'monospace',color:'#f97316',fontWeight:900,fontSize:14}}>{fmtRON(p.costUnit)}</td>
                      </tr>
                    ))}
                    <tr style={{background:'rgba(249,115,22,.05)',borderTop:'2px solid rgba(249,115,22,.2)'}}>
                      <td colSpan={2} style={{padding:'10px 12px',fontWeight:800,color:'#f97316'}}>TOTAL</td>
                      <td style={{padding:'10px 12px',color:'#f97316',fontWeight:700,textAlign:'center'}}>{totalQty}</td>
                      <td style={{padding:'10px 12px',fontFamily:'monospace',color:'#f97316',fontWeight:700}}>${fmt(totalUSD)}</td>
                      <td style={{padding:'10px 12px',fontFamily:'monospace',color:'#f97316',fontWeight:700}}>{fmtRON(totalRON_f)}</td>
                      <td colSpan={3}></td>
                      <td style={{padding:'10px 12px',fontFamily:'monospace',color:'#f97316',fontWeight:900,fontSize:15}}>{fmtRON(dviSegmente.length>0?totalCostRON_real:totalCostRON)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* EXPORT */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginTop:16}}>
              <button onClick={exportJSON}
                style={{background:'linear-gradient(135deg,#10b981,#059669)',color:'white',border:'none',padding:'14px',borderRadius:12,fontWeight:700,fontSize:13,cursor:'pointer'}}>
                💾 JSON
              </button>
              <button onClick={exportCSV}
                style={{background:'linear-gradient(135deg,#3b82f6,#1d4ed8)',color:'white',border:'none',padding:'14px',borderRadius:12,fontWeight:700,fontSize:13,cursor:'pointer'}}>
                📊 CSV
              </button>
              <button onClick={exportXLSX}
                style={{background:'linear-gradient(135deg,#16a34a,#15803d)',color:'white',border:'none',padding:'14px',borderRadius:12,fontWeight:700,fontSize:13,cursor:'pointer'}}>
                📗 Excel (.xlsx)
              </button>
            </div>

            {savedJSON && (
              <div style={{marginTop:12,background:'rgba(16,185,129,.06)',border:'1px solid rgba(16,185,129,.2)',borderRadius:12,padding:'14px 16px'}}>
                <div style={{fontSize:13,color:'#10b981',fontWeight:700,marginBottom:6}}>✅ JSON salvat — {savedJSON.produse.length} produse</div>
                <div style={{fontSize:11,color:'#475569',marginBottom:10}}>Conține SKU + costImportUnitarRON (cu TVA) — gata pentru calculatorul de profit</div>
                <details>
                  <summary style={{fontSize:11,color:'#64748b',cursor:'pointer'}}>👁 Preview JSON</summary>
                  <pre style={{background:'#070d12',border:'1px solid #1a2535',borderRadius:8,padding:12,fontSize:9,color:'#64748b',overflowX:'auto',marginTop:8,maxHeight:260,overflow:'auto'}}>
                    {JSON.stringify(savedJSON,null,2)}
                  </pre>
                </details>
              </div>
            )}

            <div style={{display:'flex',gap:10,marginTop:12}}>
              <button className="bbtn" onClick={() => setStep(2)}>← Înapoi</button>
              <button className="bbtn" onClick={() => { setStep(1); setSavedJSON(null); setAiMsg({}); }}>🔄 Import nou</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

