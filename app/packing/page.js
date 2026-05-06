'use client';
import { useState, useEffect, useCallback } from 'react';

// ─── procOrder — IDENTIC cu page.js ──────────────────────────────────────────
function procOrder(o) {
  let ts = 'pending', fulfilledAt = '', trackingNo = '';
  if (o.fulfillments?.length > 0) {
    const deliveredF = o.fulfillments.find(f => (f.shipment_status||'').toLowerCase() === 'delivered');
    const activeF    = o.fulfillments.filter(f => f.status !== 'cancelled')
                                     .sort((a,b) => new Date(b.updated_at||0) - new Date(a.updated_at||0))[0];
    const f = deliveredF || activeF || o.fulfillments[o.fulfillments.length - 1];
    fulfilledAt = f.updated_at || f.created_at || '';
    trackingNo  = f.tracking_number || '';
    const ss = (f.shipment_status || '').toLowerCase();
    if (!ss || ss === 'null') { /* skip */ }
    else if (ss === 'delivered') ts = 'livrat';
    else if (['failure','failed_attempt','returned','failed_delivery','return_in_progress'].includes(ss)) ts = 'retur';
    else if (ss === 'out_for_delivery') ts = 'outfor';
    else if (ss === 'label_printed') ts = 'pending';
    else if (['in_transit','confirmed'].includes(ss)) {
      const days = fulfilledAt ? (Date.now() - new Date(fulfilledAt)) / 86400000 : 999;
      ts = days > 10 ? 'livrat' : 'incurs';
    } else if (ss === 'failed_attempt') {
      ts = 'outfor';
    } else if (o.fulfillment_status === 'fulfilled' || f.status === 'success') {
      const days = fulfilledAt ? (Date.now() - new Date(fulfilledAt)) / 86400000 : 999;
      ts = days > 10 ? 'livrat' : 'incurs';
    }
  }
  if (o.cancelled_at) ts = 'anulat';

  const addr = o.shipping_address || o.billing_address || {};
  const prods = (o.line_items || []).map(i => i.name || '').join(' + ');
  const fulfillmentData = (o.fulfillments || []).find(f => f.tracking_company || f.tracking_number);
  const tc = (fulfillmentData?.tracking_company || '').toLowerCase();
  const courier = tc.includes('sameday') || tc.includes('same day') || tc.includes('easybox') ? 'sameday'
                : tc.includes('gls') || tc.includes('mygls') ? 'gls'
                : tc ? 'other' : 'unknown';

  const notes     = o.note_attributes || [];
  const labelAttr = notes.find(a => {
    const n = (a.name||'').toLowerCase();
    return n.includes('label-url') || n.includes('label_url') || n.includes('awb-url') || n.includes('awb_url') || n.includes('shipping-label');
  });
  const xcLabelUrl = labelAttr?.value || '';

  return {
    id: String(o.id), name: o.name || '', ts, trackingNo, courier,
    client: addr.name || '', oras: addr.city || '',
    address: [addr.address1, addr.address2].filter(Boolean).join(', '),
    phone: o.phone || addr.phone || '',
    total: parseFloat(o.total_price) || 0,
    prods, createdAt: o.created_at || '',
    items: (o.line_items || []).map(i => ({ name: i.name||'', qty: i.quantity||1, sku: i.sku||'' })),
    labelUrl: xcLabelUrl || fulfillmentData?.tracking_url || (trackingNo ? `/api/connector/awb-label?tracking=${trackingNo}` : ''),
  };
}

// ─── classifyTranzitStatus — IDENTIC cu page.js ──────────────────────────────
function classifyStatus(o) {
  if (o.ts === 'pending') return 'inregistrat';
  if (o.ts === 'incurs' || o.ts === 'outfor') return 'inregistrat'; // fără cod live = înregistrat
  return 'inregistrat';
}

// ─── Barcode generator — IDENTIC cu export din page.js ───────────────────────
function makeBars(awb) {
  const digits = String(awb).replace(/\D/g,'');
  let bars = '';
  bars += '<div style="width:3px;background:#0f172a;border-radius:1px;"></div>';
  bars += '<div style="width:2px;background:transparent;"></div>';
  bars += '<div style="width:1px;background:#0f172a;border-radius:1px;"></div>';
  bars += '<div style="width:2px;background:transparent;"></div>';
  for (let i = 0; i < digits.length; i++) {
    const d = parseInt(digits[i]) || 0;
    bars += `<div style="width:${d%3===0?4:2}px;background:#0f172a;border-radius:1px;"></div>`;
    bars += '<div style="width:1px;background:transparent;"></div>';
    bars += `<div style="width:${d%2===0?2:1}px;background:#0f172a;border-radius:1px;"></div>`;
    bars += `<div style="width:${d>5?2:1}px;background:transparent;"></div>`;
  }
  bars += '<div style="width:1px;background:#0f172a;border-radius:1px;"></div>';
  bars += '<div style="width:2px;background:transparent;"></div>';
  bars += '<div style="width:3px;background:#0f172a;border-radius:1px;"></div>';
  return bars;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } } };
const PACKED_KEY = () => 'glamx_packed_' + new Date().toISOString().slice(0, 10);

const CAT_STRIPE = { inregistrat:'#f59e0b', ridicat:'#8b5cf6', centru:'#0ea5e9', livrare:'#10b981' };
const CAT_BG     = { inregistrat:'#fffbeb', ridicat:'#f5f3ff', centru:'#f0f9ff', livrare:'#f0fdf4' };
const CAT_LABELS = { inregistrat:'Înregistrat', ridicat:'Ridicat', centru:'Centru/Depozit', livrare:'În livrare' };
const CAT_ICONS  = { inregistrat:'📋', ridicat:'📦', centru:'🏭', livrare:'🚴' };

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function PackingPage() {
  const [orders,       setOrders]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [courier,      setCourier]      = useState('toate');
  const [packed,       setPacked]       = useState({});
  const [labelModal,   setLabelModal]   = useState(null);
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelError,   setLabelError]   = useState('');
  const [dlState,      setDlState]      = useState({});

  useEffect(() => {
    try { setPacked(JSON.parse(ls.get(PACKED_KEY()) || '{}')); } catch {}
    // Preia filtrul setat în dashboard via URL params
    const params = new URLSearchParams(window.location.search);
    const c = params.get('courier');
    if (c) setCourier(c);
  }, []);

  const togglePacked = useCallback(id => {
    setPacked(prev => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = Date.now();
      try { localStorage.setItem(PACKED_KEY(), JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Fetch orders — aceleași date ca dashboard
  useEffect(() => {
    const run = async () => {
      setLoading(true); setError('');
      try {
        const domain = ls.get('gx_d') || '';
        const token  = ls.get('gx_t') || '';
        if (!domain || !token) {
          setError('Lipsesc credențialele. Deschide din Dashboard.');
          setLoading(false); return;
        }
        const from = new Date(); from.setDate(from.getDate() - 60);
        const res  = await fetch(`/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&created_at_min=${from.toISOString().slice(0,10)}T00:00:00`);
        if (!res.ok) throw new Error('API ' + res.status);
        const data = await res.json();
        const raw  = data.orders || data || [];
        const allTransit = raw.map(procOrder).filter(o =>
          (o.ts === 'pending' || o.ts === 'incurs' || o.ts === 'outfor') && o.trackingNo
        );

        // Citim statusurile live salvate de dashboard
        let liveData = {};
        try { liveData = JSON.parse(localStorage.getItem('glamx_live_tracking') || '{}'); } catch {}

        // Clasificăm exact ca dashboard-ul și păstrăm DOAR înregistrate
        const inregistrate = allTransit.filter(o => {
          const live = liveData[o.id];
          const code = live?.statusCode ? parseInt(live.statusCode) : null;
          const isGls = o.courier !== 'sameday';
          if (code) {
            if (isGls) {
              if ([51,52,80,83].includes(code)) return true;   // înregistrat
              return false; // orice alt cod = predat/în drum
            } else {
              if ([1].includes(code)) return true;  // SD înregistrat
              return false;
            }
          }
          // Fără cod live: doar pending = nepredat sigur
          return o.ts === 'pending';
        });

        setOrders(inregistrate);
      } catch (e) { setError('Eroare: ' + e.message); }
      setLoading(false);
    };
    run();
  }, []);

  // Filtrare identică cu dashboard
  const filtered = orders.filter(o =>
    courier === 'toate' || o.courier === courier
  );

  const packedCount = filtered.filter(o => packed[o.id]).length;
  const progPct     = filtered.length ? Math.round(packedCount / filtered.length * 100) : 0;

  const fetchLabelBlob = async o => {
    if (!o.labelUrl && !o.trackingNo) throw new Error('Fără URL etichetă');

    const rawUrl = o.labelUrl || `/api/connector/awb-label?tracking=${o.trackingNo}`;

    // URL-urile xConnector trebuie proxiate (CORS)
    // URL-urile relative trebuie făcute absolute (packing e pe același origin)
    let fetchUrl;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      if (rawUrl.includes('xconnector.app')) {
        fetchUrl = `/api/connector/label-proxy?url=${encodeURIComponent(rawUrl)}`;
      } else {
        fetchUrl = rawUrl;
      }
    } else {
      fetchUrl = rawUrl; // URL relativ — funcționează direct
    }

    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} pentru ${o.trackingNo}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('pdf') && !ct.includes('octet')) {
      const text = await res.text();
      throw new Error(text.includes('error') ? JSON.parse(text).error || 'Eroare server' : `Răspuns invalid (${ct})`);
    }
    return res.blob();
  };

  const openLabel = async o => {
    setLabelError(''); setLabelLoading(true);
    setLabelModal({ orderNum: o.name, awb: o.trackingNo, url: null });
    try {
      const blob = await fetchLabelBlob(o);
      setLabelModal({ orderNum: o.name, awb: o.trackingNo, url: URL.createObjectURL(blob) });
    } catch (e) {
      setLabelError('Nu s-a putut încărca: ' + e.message);
      setLabelModal(null);
    }
    setLabelLoading(false);
  };

  const downloadLabel = async o => {
    setDlState(p => ({ ...p, [o.id]: 'loading' }));
    try {
      const blob = await fetchLabelBlob(o);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `AWB_${o.courier?.toUpperCase()}_${o.trackingNo}.pdf`;
      a.click();
      setDlState(p => ({ ...p, [o.id]: 'done' }));
      setTimeout(() => setDlState(p => { const n={...p}; delete n[o.id]; return n; }), 3000);
    } catch (e) {
      setDlState(p => ({ ...p, [o.id]: 'error' }));
      alert('Eroare download: ' + e.message);
      setTimeout(() => setDlState(p => { const n={...p}; delete n[o.id]; return n; }), 3000);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ background:'#0f172a', minHeight:'100vh', fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color:'#f1f5f9' }}>

      {/* Header sticky */}
      <div style={{ background:'#1e293b', borderBottom:'1px solid rgba(255,255,255,.07)', padding:'12px 14px', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div style={{ fontSize:18, fontWeight:900 }}>GLAM<span style={{color:'#f97316'}}>X</span> <span style={{fontSize:12,fontWeight:500,color:'#64748b'}}>Packaging</span></div>
          <a href="/" style={{ background:'rgba(255,255,255,.07)', color:'#94a3b8', border:'1px solid rgba(255,255,255,.1)', borderRadius:10, padding:'5px 11px', fontSize:12, fontWeight:600, textDecoration:'none' }}>← Dashboard</a>
        </div>

        {/* Progress bar */}
        {filtered.length > 0 && (
          <div style={{ marginBottom:9 }}>
            <div style={{ height:5, background:'rgba(255,255,255,.07)', borderRadius:20, overflow:'hidden' }}>
              <div style={{ height:'100%', width:progPct+'%', background:'linear-gradient(90deg,#10b981,#34d399)', borderRadius:20, transition:'width .4s' }} />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#64748b', marginTop:3 }}>
              <strong style={{color:'#10b981'}}>✅ {packedCount} pregătite</strong>
              <span>{filtered.length - packedCount} rămase din {filtered.length}</span>
            </div>
          </div>
        )}

        {/* Courier filter */}
        <div style={{ display:'flex', gap:6, marginBottom:7, overflowX:'auto' }}>
          {[['toate','🚚 Toți'],['gls','🟠 GLS'],['sameday','🟣 Sameday']].map(([k,l]) => (
            <button key={k} onClick={() => setCourier(k)} style={{
              flexShrink:0, padding:'4px 12px', borderRadius:20, border:'1px solid', fontSize:11, fontWeight:700, cursor:'pointer',
              background: courier===k ? 'rgba(249,115,22,.2)' : 'rgba(255,255,255,.04)',
              borderColor: courier===k ? '#f97316' : 'rgba(255,255,255,.1)',
              color: courier===k ? '#f97316' : '#64748b',
            }}>{l}</button>
          ))}
        </div>


      </div>

      {/* Body */}
      <div style={{ padding:'10px 12px 60px', maxWidth:480, margin:'0 auto' }}>

        {loading && <div style={{ textAlign:'center', padding:40, color:'#475569' }}>⏳ Se încarcă comenzile...</div>}
        {error   && <div style={{ background:'rgba(244,63,94,.1)', border:'1px solid rgba(244,63,94,.3)', borderRadius:12, padding:14, color:'#fb7185', fontSize:13, margin:'10px 0' }}>⚠️ {error}</div>}
        {labelError && <div style={{ background:'rgba(244,63,94,.1)', border:'1px solid rgba(244,63,94,.3)', borderRadius:12, padding:12, color:'#fb7185', fontSize:12, marginBottom:8 }}>⚠️ {labelError}</div>}
        {!loading && !error && filtered.length === 0 && <div style={{ textAlign:'center', padding:40, color:'#475569' }}>📭 Niciun colet în această categorie</div>}

        {filtered.map(o => {
          const cat      = 'inregistrat'; // pe packing page toate sunt înregistrate (nepredate)
          const stripe   = CAT_STRIPE[cat];
          const bg       = CAT_BG[cat];
          const isPacked = !!packed[o.id];
          const isGls    = o.courier !== 'sameday';
          const dl       = dlState[o.id];
          const barsHtml = o.trackingNo ? makeBars(o.trackingNo) : '';

          return (
            <div key={o.id} style={{
              background: bg, border:`1.5px solid ${stripe}44`, borderLeft:`5px solid ${stripe}`,
              borderRadius:16, marginBottom:10, overflow:'hidden',
              opacity: isPacked ? .55 : 1, transition:'opacity .2s',
            }}>
              <div style={{ padding:'12px 13px 11px' }}>

                {/* Top row */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:7 }}>
                  <div>
                    <div style={{ fontSize:20, fontWeight:900, color:'#0f172a', letterSpacing:-.5 }}>{o.name}</div>
                    <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>{o.createdAt?.slice(0,10)}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
                    <span style={{ fontSize:10, fontWeight:800, padding:'2px 8px', borderRadius:20, border:`1.5px solid ${isGls?'#c2410c':'#7c3aed'}44`, background:'white', color:isGls?'#c2410c':'#7c3aed' }}>{isGls?'GLS':'SAMEDAY'}</span>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:'#f59e0b22', border:'1px solid #f59e0b55', color:'#f59e0b' }}>📋 AWB Înregistrat</span>
                  </div>
                </div>

                {/* Product */}
                {o.prods && (
                  <div style={{ background:'#0f172a', borderRadius:10, padding:'9px 12px', marginBottom:9 }}>
                    <div style={{ fontSize:8, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:1.5, marginBottom:4 }}>
                      PRODUS
                    </div>
                    <div style={{ fontSize:14, fontWeight:700, color:'#f1f5f9', lineHeight:1.3 }}>{o.prods}</div>
                    {o.items?.length > 1 && o.items.map((item,i) => (
                      <div key={i} style={{ fontSize:11, color:'#64748b', display:'flex', gap:6, marginTop:3 }}>
                        <span style={{color:'#f97316',fontWeight:800}}>×{item.qty}</span>{item.name}
                      </div>
                    ))}
                  </div>
                )}

                {/* Client */}
                <div style={{ fontSize:14, fontWeight:700, color:'#1e293b', marginBottom:3 }}>{o.client}</div>
                {o.address && <div style={{ fontSize:11, color:'#475569', marginBottom:2 }}>📍 {o.address}{o.oras?', '+o.oras:''}</div>}
                {o.phone   && <div style={{ fontSize:11, color:'#475569', marginBottom:8 }}>📞 {o.phone}</div>}

                {/* AWB card — GLS style vs Sameday style */}
                {o.trackingNo ? (
                  isGls ? (
                    /* ── GLS card — bara cod verticală, stil etichetă GLS ── */
                    <div style={{ background:'#fff', border:'2.5px solid #1e293b', borderRadius:14, margin:'4px 0 8px', overflow:'hidden', boxShadow:'0 3px 12px rgba(0,0,0,.15)' }}>
                      <div style={{ display:'flex', minHeight:100 }}>
                        <div style={{ flexShrink:0, width:48, display:'flex', alignItems:'center', justifyContent:'center', background:'#fff', borderRight:'2px solid #e2e8f0', padding:'6px 2px', overflow:'hidden' }}>
                          <div style={{ display:'flex', gap:'1.5px', height:120, alignItems:'stretch', transform:'rotate(-90deg) translateX(-36px)', width:130 }}
                            dangerouslySetInnerHTML={{ __html: barsHtml }} />
                        </div>
                        <div style={{ flex:1, padding:'10px 12px', display:'flex', flexDirection:'column', gap:3 }}>
                          <div style={{ fontSize:22, fontWeight:900, color:'#0f172a', letterSpacing:-.5, lineHeight:1 }}>{o.name}</div>
                          <div style={{ fontSize:12, fontWeight:700, color:'#1e293b', lineHeight:1.3, fontStyle:'italic' }}>{o.prods}</div>
                          <div style={{ height:1, background:'#e2e8f0', margin:'3px 0' }} />
                          <div style={{ fontFamily:'Courier New,monospace', fontSize:16, fontWeight:900, color:'#0f172a', letterSpacing:2, wordBreak:'break-all', lineHeight:1.2 }}>{o.trackingNo}</div>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:3 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                            <div style={{ background:'#003087', borderRadius:4, padding:'2px 6px', display:'flex', alignItems:'center', gap:3 }}>
                              <span style={{ color:'white', fontWeight:900, fontSize:11, letterSpacing:.5 }}>GLS</span>
                              <div style={{ width:6, height:6, background:'#f59e0b', borderRadius:'50%' }}></div>
                            </div>
                            <span style={{ fontSize:9, color:'#94a3b8', fontWeight:600 }}>Romania</span>
                          </div>
                            {o.total > 0 && <span style={{ fontSize:11, fontWeight:900, color:'#0f172a', background:'#fef3c7', border:'1.5px solid #f59e0b', padding:'2px 8px', borderRadius:6 }}>Ramburs {o.total.toFixed(2)} RON</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:7, padding:'8px 10px', borderTop:'1px solid #e2e8f0' }}>
                        <button onClick={() => openLabel(o)} disabled={labelLoading}
                          style={{ flex:1, padding:'10px 8px', borderRadius:10, border:'none', background:'#003087', color:'white', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                          {labelLoading ? '⏳' : '👁'} Preview
                        </button>
                        <button onClick={() => downloadLabel(o)}
                          style={{ flex:1, padding:'10px 8px', borderRadius:10, border:'none', fontSize:12, fontWeight:700, cursor:'pointer',
                            background: dl==='done'?'#10b981':dl==='error'?'#ef4444':'#f97316', color:'white' }}>
                          {dl==='loading'?'⏳':dl==='done'?'✅ OK':dl==='error'?'⚠ Err':'⬇ PDF'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── SAMEDAY card — stil etichetă Sameday ── */
                    <div style={{ background:'#fff', border:'2.5px solid #1a1a2e', borderRadius:14, margin:'4px 0 8px', overflow:'hidden', boxShadow:'0 3px 16px rgba(0,0,0,.2)' }}>
                      {/* Header Sameday */}
                      <div style={{ background:'#1a1a2e', padding:'8px 12px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <div style={{ background:'white', borderRadius:6, padding:'2px 8px', display:'flex', alignItems:'center' }}>
                            <span style={{ color:'#1a1a2e', fontWeight:900, fontSize:12, letterSpacing:.5 }}>same</span>
                            <span style={{ color:'#f97316', fontWeight:900, fontSize:12, letterSpacing:.5 }}>day</span>
                          </div>
                          <span style={{ fontSize:9, color:'rgba(255,255,255,.4)', fontWeight:600 }}>#theopenway</span>
                        </div>
                        </div>
                        {o.total > 0 && (
                          <div style={{ textAlign:'right' }}>
                            <div style={{ fontSize:9, color:'rgba(255,255,255,.5)', fontWeight:600 }}>RAMBURS</div>
                            <div style={{ fontSize:15, fontWeight:900, color:'#fbbf24' }}>{o.total.toFixed(2)} RON</div>
                          </div>
                        )}
                      </div>

                      {/* Barcode orizontal — ca pe eticheta Sameday */}
                      <div style={{ background:'white', padding:'10px 12px 4px', borderBottom:'1px solid #f1f5f9' }}>
                        <div style={{ display:'flex', gap:'1.5px', height:50, alignItems:'stretch', justifyContent:'center', width:'100%', overflow:'hidden' }}
                          dangerouslySetInnerHTML={{ __html: barsHtml }} />
                        <div style={{ fontFamily:'Courier New,monospace', fontSize:13, fontWeight:900, color:'#0f172a', letterSpacing:2, textAlign:'center', marginTop:4 }}>
                          {o.trackingNo}
                        </div>
                      </div>

                      {/* Body — două coloane Expeditor / Destinatar */}
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:0, borderBottom:'1px solid #f1f5f9' }}>
                        <div style={{ padding:'8px 10px', borderRight:'1px solid #f1f5f9' }}>
                          <div style={{ fontSize:8, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:1.5, marginBottom:4 }}>Expeditor</div>
                          <div style={{ fontSize:12, fontWeight:800, color:'#0f172a' }}>GLAMX SRL</div>
                          <div style={{ fontSize:10, color:'#475569', marginTop:2 }}>Maramureș</div>
                        </div>
                        <div style={{ padding:'8px 10px' }}>
                          <div style={{ fontSize:8, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:1.5, marginBottom:4 }}>Destinatar</div>
                          <div style={{ fontSize:12, fontWeight:800, color:'#0f172a', lineHeight:1.3 }}>{o.client}</div>
                          <div style={{ fontSize:10, color:'#475569', marginTop:2, lineHeight:1.3 }}>{o.oras}</div>
                        </div>
                      </div>

                      {/* Observatii */}
                      <div style={{ padding:'6px 12px', borderBottom:'1px solid #f1f5f9', background:'#fafafa' }}>
                        <span style={{ fontSize:9, color:'#64748b', fontWeight:600 }}>Obs: </span>
                        <span style={{ fontSize:10, color:'#334155', fontWeight:700 }}>{o.name} · {o.prods}</span>
                      </div>

                      {/* Buttons */}
                      <div style={{ display:'flex', gap:7, padding:'8px 10px' }}>
                        <button onClick={() => openLabel(o)} disabled={labelLoading}
                          style={{ flex:1, padding:'10px 8px', borderRadius:10, border:'none', background:'#1a1a2e', color:'white', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                          {labelLoading ? '⏳' : '👁'} Preview
                        </button>
                        <button onClick={() => downloadLabel(o)}
                          style={{ flex:1, padding:'10px 8px', borderRadius:10, border:'none', fontSize:12, fontWeight:700, cursor:'pointer',
                            background: dl==='done'?'#10b981':dl==='error'?'#ef4444':'#f97316', color:'white' }}>
                          {dl==='loading'?'⏳':dl==='done'?'✅ OK':dl==='error'?'⚠ Err':'⬇ PDF'}
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <div style={{ background:'#f8fafc', border:'2px dashed #e2e8f0', borderRadius:14, padding:'12px 14px', margin:'4px 0 8px' }}>
                    <span style={{ fontSize:13, color:'#94a3b8', fontStyle:'italic' }}>Fără AWB generat</span>
                  </div>
                )}

                {/* Packed toggle */}
                <button onClick={() => togglePacked(o.id)} style={{
                  width:'100%', padding:'8px 12px', borderRadius:10, cursor:'pointer',
                  display:'flex', alignItems:'center', gap:8, border:'2px dashed',
                  borderColor: isPacked ? 'rgba(16,185,129,.4)' : '#cbd5e1',
                  background: isPacked ? 'rgba(16,185,129,.06)' : 'rgba(0,0,0,.02)',
                }}>
                  <div style={{ width:22, height:22, borderRadius:6, border:`2px solid ${isPacked?'#10b981':'#cbd5e1'}`, background:isPacked?'#10b981':'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'white', flexShrink:0 }}>{isPacked?'✓':''}</div>
                  <span style={{ fontSize:12, fontWeight:700, color:isPacked?'#059669':'#94a3b8', flex:1, textAlign:'left' }}>{isPacked?'PREGĂTIT ✅':'Marchează ca pregătit'}</span>
                  {isPacked && packed[o.id] && <span style={{ fontSize:10, color:'#10b981', background:'rgba(16,185,129,.1)', padding:'2px 7px', borderRadius:20, fontWeight:700 }}>{new Date(packed[o.id]).toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'})}</span>}
                </button>

              </div>
            </div>
          );
        })}
      </div>

      {/* Label modal */}
      {(labelModal || labelLoading) && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.92)', zIndex:1000, display:'flex', flexDirection:'column' }}>
          <div style={{ background:'#003087', padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
            <div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,.6)', fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>Etichetă · {labelModal?.orderNum}</div>
              <div style={{ fontFamily:'monospace', fontSize:17, fontWeight:900, color:'#f59e0b', letterSpacing:2 }}>{labelModal?.awb}</div>
            </div>
            <button onClick={() => { setLabelModal(null); setLabelError(''); }} style={{ background:'rgba(255,255,255,.15)', border:'none', color:'white', width:34, height:34, borderRadius:'50%', fontSize:16, cursor:'pointer' }}>✕</button>
          </div>

          <div style={{ flex:1, position:'relative', background:'#f8fafc', overflow:'hidden' }}>
            {labelLoading && <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#64748b', fontSize:14, fontWeight:600 }}>⏳ Se încarcă eticheta...</div>}
            {labelModal?.url && <iframe src={labelModal.url} style={{ width:'100%', height:'100%', border:'none', display:'block' }} />}
          </div>

          {labelModal?.url && (
            <div style={{ padding:'12px 16px', background:'white', display:'flex', gap:8, flexShrink:0 }}>
              <a href={labelModal.url} download={`AWB_${labelModal.awb}.pdf`}
                style={{ flex:1, padding:13, borderRadius:12, background:'#f97316', color:'white', fontSize:14, fontWeight:800, textAlign:'center', textDecoration:'none', display:'block' }}>
                ⬇ Download PDF
              </a>
              <a href={labelModal.url} target="_blank" rel="noreferrer"
                style={{ padding:'13px 14px', borderRadius:12, background:'#f1f5f9', color:'#475569', fontSize:14, textDecoration:'none' }}>
                🔗
              </a>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
