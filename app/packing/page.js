'use client';
import { useState, useEffect, useCallback } from 'react';

// ─── Order parsing (same logic as page.js) ───────────────────────────────────

function procOrder(o) {
  let ts = 'pending', fulfilledAt = '', trackingNo = '';
  if (o.fulfillments?.length > 0) {
    const deliveredF = o.fulfillments.find(f => (f.shipment_status||'').toLowerCase() === 'delivered');
    const f = deliveredF || o.fulfillments[o.fulfillments.length - 1];
    fulfilledAt = f.updated_at || f.created_at || '';
    trackingNo  = f.tracking_number || '';
    const ss = (f.shipment_status || '').toLowerCase();
    if (!ss || ss === 'null') { /* skip */ }
    else if (ss === 'delivered') ts = 'livrat';
    else if (['failure','failed_attempt','returned','return_in_progress'].includes(ss)) ts = 'retur';
    else if (ss === 'out_for_delivery') ts = 'outfor';
    else if (ss === 'label_printed') ts = 'pending';
    else if (['in_transit','confirmed'].includes(ss)) {
      const days = fulfilledAt ? (Date.now() - new Date(fulfilledAt)) / 86400000 : 999;
      ts = days > 10 ? 'livrat' : 'incurs';
    } else if (ss === 'failed_attempt') {
      ts = 'outfor';
    } else if (o.fulfillment_status === 'fulfilled') {
      const days = fulfilledAt ? (Date.now() - new Date(fulfilledAt)) / 86400000 : 999;
      ts = days > 10 ? 'livrat' : 'incurs';
    }
  }
  if (o.cancelled_at) ts = 'anulat';

  const addr = o.shipping_address || o.billing_address || {};
  const prods = (o.line_items || []).map(i => i.name || '').join(' + ');
  const fulfillmentData = (o.fulfillments || []).find(f => f.tracking_company || f.tracking_number);
  const tc = (fulfillmentData?.tracking_company || '').toLowerCase();
  const courier = tc.includes('sameday') ? 'sameday' : tc.includes('gls') || tc.includes('mygls') ? 'gls' : tc ? 'other' : 'unknown';

  const notes    = o.note_attributes || [];
  const labelAttr = notes.find(a => {
    const n = (a.name||'').toLowerCase();
    return n.includes('label-url') || n.includes('label_url') || n.includes('awb-url') || n.includes('shipping-label');
  });
  const xcLabelUrl = labelAttr?.value || '';

  return {
    id: String(o.id), name: o.name || '', ts,
    trackingNo, courier,
    client: addr.name || '',
    oras: addr.city || '',
    address: [addr.address1, addr.address2].filter(Boolean).join(', '),
    phone: o.phone || addr.phone || '',
    total: parseFloat(o.total_price) || 0,
    prods,
    createdAt: o.created_at || '',
    items: (o.line_items || []).map(i => ({ name: i.name||'', qty: i.quantity||1, sku: i.sku||'' })),
    labelUrl: xcLabelUrl || fulfillmentData?.tracking_url || (trackingNo ? `/api/connector/awb-label?tracking=${trackingNo}` : ''),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } } };
const PACKED_KEY = () => 'glamx_packed_' + new Date().toISOString().slice(0, 10);

const CAT_COLORS = { inregistrat:'#f59e0b', ridicat:'#8b5cf6', centru:'#0ea5e9', livrare:'#10b981' };
const CAT_LABELS = { inregistrat:'Înregistrat', ridicat:'Ridicat', centru:'Centru/Depozit', livrare:'În livrare' };
const CAT_ICONS  = { inregistrat:'📋', ridicat:'📦', centru:'🏭', livrare:'🚴' };
const CAT_BG     = { inregistrat:'#fffbeb', ridicat:'#f5f3ff', centru:'#f0f9ff', livrare:'#f0fdf4' };

function classifyStatus(ts) {
  if (ts === 'outfor') return 'ridicat';
  if (ts === 'incurs') return 'centru';
  return 'inregistrat';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function PackingPage() {
  const [orders,       setOrders]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [filter,       setFilter]       = useState('toate');
  const [courier,      setCourier]      = useState('toate');
  const [packed,       setPacked]       = useState({});
  const [labelModal,   setLabelModal]   = useState(null);
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelError,   setLabelError]   = useState('');
  const [dlState,      setDlState]      = useState({});

  useEffect(() => {
    try { setPacked(JSON.parse(ls.get(PACKED_KEY()) || '{}')); } catch {}
  }, []);

  const togglePacked = useCallback(id => {
    setPacked(prev => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = Date.now();
      try { localStorage.setItem(PACKED_KEY(), JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Fetch & parse orders
  useEffect(() => {
    const run = async () => {
      setLoading(true); setError('');
      try {
        const domain = ls.get('gx_d') || '';
        const token  = ls.get('gx_t') || '';
        if (!domain || !token) { setError('Configurează credențialele din Dashboard → setări.'); setLoading(false); return; }

        const from = new Date(); from.setDate(from.getDate() - 60);
        const fromStr = from.toISOString().slice(0, 10);

        const res  = await fetch(`/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&created_at_min=${fromStr}T00:00:00`);
        if (!res.ok) throw new Error('API error ' + res.status);
        const data = await res.json();

        const raw    = data.orders || data || [];
        const parsed = raw.map(procOrder).filter(o => o.ts === 'incurs' || o.ts === 'outfor');
        setOrders(parsed);
      } catch (e) { setError('Eroare: ' + e.message); }
      setLoading(false);
    };
    run();
  }, []);

  const filtered = orders.filter(o => {
    if (courier !== 'toate' && o.courier !== courier) return false;
    if (filter  === 'toate') return true;
    return classifyStatus(o.ts) === filter;
  });

  const packedCount = filtered.filter(o => packed[o.id]).length;
  const progPct     = filtered.length ? Math.round(packedCount / filtered.length * 100) : 0;

  const fetchLabel = async (o) => {
    const labelUrl = o.labelUrl;
    if (!labelUrl) throw new Error('Fără URL etichetă');
    const res = await fetch(labelUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.blob();
  };

  const openLabel = async o => {
    setLabelError(''); setLabelLoading(true);
    setLabelModal({ orderNum: o.name, awb: o.trackingNo, url: null });
    try {
      const blob = await fetchLabel(o);
      setLabelModal({ orderNum: o.name, awb: o.trackingNo, url: URL.createObjectURL(blob) });
    } catch (e) { setLabelError('Nu s-a putut încărca: ' + e.message); setLabelModal(null); }
    setLabelLoading(false);
  };

  const downloadLabel = async o => {
    setDlState(p => ({ ...p, [o.id]: 'loading' }));
    try {
      const blob = await fetchLabel(o);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `AWB_${o.courier?.toUpperCase()}_${o.trackingNo}.pdf`;
      a.click();
      setDlState(p => ({ ...p, [o.id]: 'done' }));
      setTimeout(() => setDlState(p => { const n={...p}; delete n[o.id]; return n; }), 3000);
    } catch (e) {
      setDlState(p => ({ ...p, [o.id]: 'error' }));
      setTimeout(() => setDlState(p => { const n={...p}; delete n[o.id]; return n; }), 3000);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ background:'#0f172a', minHeight:'100vh', fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color:'#f1f5f9' }}>

      {/* Sticky header */}
      <div style={{ background:'#1e293b', borderBottom:'1px solid rgba(255,255,255,.07)', padding:'12px 14px', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div style={{ fontSize:18, fontWeight:900 }}>GLAM<span style={{ color:'#f97316' }}>X</span> <span style={{ fontSize:12, fontWeight:500, color:'#64748b' }}>Packaging</span></div>
          <a href="/" style={{ background:'rgba(255,255,255,.07)', color:'#94a3b8', border:'1px solid rgba(255,255,255,.1)', borderRadius:10, padding:'5px 11px', fontSize:12, fontWeight:600, textDecoration:'none' }}>← Dashboard</a>
        </div>

        {/* Progress */}
        {filtered.length > 0 && (
          <div style={{ marginBottom:9 }}>
            <div style={{ height:5, background:'rgba(255,255,255,.07)', borderRadius:20, overflow:'hidden' }}>
              <div style={{ height:'100%', width:progPct+'%', background:'linear-gradient(90deg,#10b981,#34d399)', borderRadius:20, transition:'width .4s' }} />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#64748b', marginTop:3 }}>
              <strong style={{ color:'#10b981' }}>✅ {packedCount} pregătite</strong>
              <span>{filtered.length - packedCount} rămase</span>
            </div>
          </div>
        )}

        {/* Courier tabs */}
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

        {/* Status filter */}
        <div style={{ display:'flex', gap:5, overflowX:'auto' }}>
          {[['toate','Toate',null], ...Object.entries(CAT_ICONS).map(([k,icon]) => [k, icon+' '+CAT_LABELS[k], CAT_COLORS[k]])].map(([k,l,c]) => {
            const cnt = orders.filter(o => {
              if (courier !== 'toate' && o.courier !== courier) return false;
              return k === 'toate' ? (o.ts==='incurs'||o.ts==='outfor') : classifyStatus(o.ts) === k;
            }).length;
            return (
              <button key={k} onClick={() => setFilter(k)} style={{
                flexShrink:0, padding:'3px 9px', borderRadius:20, border:'1px solid', fontSize:10, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap',
                background: filter===k ? (c||'#3b82f6')+'33' : 'rgba(255,255,255,.04)',
                borderColor: filter===k ? (c||'#3b82f6') : 'rgba(255,255,255,.1)',
                color: filter===k ? (c||'#93c5fd') : '#64748b',
              }}>{l} ({cnt})</button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding:'10px 12px 60px', maxWidth:480, margin:'0 auto' }}>

        {loading && <div style={{ textAlign:'center', padding:40, color:'#475569' }}>⏳ Se încarcă...</div>}
        {error   && <div style={{ background:'rgba(244,63,94,.1)', border:'1px solid rgba(244,63,94,.3)', borderRadius:12, padding:14, color:'#fb7185', fontSize:13, margin:'10px 0' }}>⚠️ {error}</div>}
        {labelError && <div style={{ background:'rgba(244,63,94,.1)', border:'1px solid rgba(244,63,94,.3)', borderRadius:12, padding:12, color:'#fb7185', fontSize:12, marginBottom:8 }}>⚠️ {labelError}</div>}
        {!loading && !error && filtered.length === 0 && <div style={{ textAlign:'center', padding:40, color:'#475569' }}>📭 Niciun colet</div>}

        {filtered.map(o => {
          const cat      = classifyStatus(o.ts);
          const cc       = CAT_COLORS[cat];
          const bg       = CAT_BG[cat];
          const isPacked = !!packed[o.id];
          const isGls    = o.courier !== 'sameday';
          const dl       = dlState[o.id];

          return (
            <div key={o.id} style={{
              background: bg, border:`1.5px solid ${cc}44`, borderLeft:`5px solid ${cc}`,
              borderRadius:16, marginBottom:10, overflow:'hidden',
              opacity: isPacked ? .55 : 1, transition:'opacity .2s',
            }}>
              <div style={{ padding:'12px 13px 11px' }}>

                {/* Top */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:7 }}>
                  <div>
                    <div style={{ fontSize:20, fontWeight:900, color:'#0f172a', letterSpacing:-.5 }}>{o.name}</div>
                    <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>{o.createdAt?.slice(0,10)}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
                    <span style={{ fontSize:10, fontWeight:800, padding:'2px 8px', borderRadius:20, border:`1.5px solid ${isGls?'#c2410c':'#7c3aed'}44`, background:'white', color:isGls?'#c2410c':'#7c3aed' }}>{isGls?'GLS':'SAMEDAY'}</span>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:cc+'22', border:`1px solid ${cc}55`, color:cc }}>{CAT_ICONS[cat]} {CAT_LABELS[cat]}</span>
                  </div>
                </div>

                {/* Product */}
                {o.prods && (
                  <div style={{ background:'#0f172a', borderRadius:10, padding:'8px 11px', marginBottom:8 }}>
                    <div style={{ fontSize:8, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:1.5, marginBottom:3 }}>PRODUS</div>
                    <div style={{ fontSize:14, fontWeight:700, color:'#f1f5f9', lineHeight:1.3 }}>{o.prods}</div>
                  </div>
                )}

                {/* Client */}
                <div style={{ fontSize:14, fontWeight:700, color:'#1e293b', marginBottom:3 }}>{o.client}</div>
                {o.address && <div style={{ fontSize:11, color:'#475569', marginBottom:2 }}>📍 {o.address}{o.oras?', '+o.oras:''}</div>}
                {o.phone   && <div style={{ fontSize:11, color:'#475569', marginBottom:7 }}>📞 {o.phone}</div>}

                {/* AWB */}
                {o.trackingNo && (
                  <div style={{ background:'#1e293b', borderRadius:10, padding:'8px 12px', marginBottom:8 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                      <span style={{ fontSize:9, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:2 }}>AWB</span>
                      {o.total > 0 && <span style={{ fontSize:11, fontWeight:800, color:'white', background:'#f97316', padding:'2px 8px', borderRadius:6 }}>Ramburs {o.total.toFixed(2)} RON</span>}
                    </div>
                    <div style={{ fontFamily:'Courier New,monospace', fontSize:17, fontWeight:900, color:'#f97316', letterSpacing:2 }}>{o.trackingNo}</div>
                  </div>
                )}

                {/* Label buttons */}
                {o.trackingNo && (
                  <div style={{ display:'flex', gap:6, marginBottom:7 }}>
                    <button onClick={() => openLabel(o)} disabled={labelLoading}
                      style={{ flex:1, padding:'9px 8px', borderRadius:10, border:'none', background:'#003087', color:'white', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                      {labelLoading ? '⏳' : '👁'} Preview
                    </button>
                    <button onClick={() => downloadLabel(o)}
                      style={{ flex:1, padding:'9px 8px', borderRadius:10, border:'none', fontSize:12, fontWeight:700, cursor:'pointer',
                        background: dl==='done'?'#10b981':dl==='error'?'#ef4444':'#f97316', color:'white' }}>
                      {dl==='loading'?'⏳ ...' : dl==='done'?'✅ OK' : dl==='error'?'⚠ Eroare' : '⬇ Download'}
                    </button>
                  </div>
                )}

                {/* Packed */}
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
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.9)', zIndex:1000, display:'flex', flexDirection:'column' }}>
          <div style={{ background:'#003087', padding:'11px 15px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
            <div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,.6)', fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>Etichetă · {labelModal?.orderNum}</div>
              <div style={{ fontFamily:'monospace', fontSize:16, fontWeight:900, color:'#f59e0b', letterSpacing:2 }}>{labelModal?.awb}</div>
            </div>
            <button onClick={() => { setLabelModal(null); setLabelError(''); }} style={{ background:'rgba(255,255,255,.15)', border:'none', color:'white', width:32, height:32, borderRadius:'50%', fontSize:15, cursor:'pointer' }}>✕</button>
          </div>

          <div style={{ flex:1, position:'relative', background:'#f8fafc' }}>
            {labelLoading && <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#64748b', fontSize:13, fontWeight:600 }}>⏳ Se încarcă eticheta...</div>}
            {labelModal?.url && <iframe src={labelModal.url} style={{ width:'100%', height:'100%', border:'none', display:'block' }} />}
          </div>

          {labelModal?.url && (
            <div style={{ padding:'11px 14px', background:'white', display:'flex', gap:8, flexShrink:0 }}>
              <a href={labelModal.url} download={`AWB_${labelModal.awb}.pdf`}
                style={{ flex:1, padding:12, borderRadius:11, background:'#f97316', color:'white', fontSize:13, fontWeight:800, textAlign:'center', textDecoration:'none' }}>
                ⬇ Download PDF
              </a>
              <a href={labelModal.url} target="_blank" rel="noreferrer"
                style={{ padding:'12px 13px', borderRadius:11, background:'#f1f5f9', color:'#475569', fontSize:13, fontWeight:700, textDecoration:'none' }}>
                🔗
              </a>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
