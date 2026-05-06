'use client';
import { useState, useEffect, useCallback } from 'react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

const PACKED_KEY = () => 'glamx_packed_' + new Date().toISOString().slice(0, 10);

const CAT_COLORS  = { inregistrat:'#f59e0b', ridicat:'#8b5cf6', centru:'#0ea5e9', livrare:'#10b981' };
const CAT_LABELS  = { inregistrat:'Înregistrat', ridicat:'Ridicat', centru:'Centru/Depozit', livrare:'În livrare' };
const CAT_ICONS   = { inregistrat:'📋', ridicat:'📦', centru:'🏭', livrare:'🚴' };
const CAT_BG      = { inregistrat:'#fffbeb', ridicat:'#f5f3ff', centru:'#f0f9ff', livrare:'#f0fdf4' };

function classifyStatus(ts, liveCode) {
  const code = liveCode ? parseInt(liveCode) : null;
  if (code) {
    if ([4,29,32,56,58,92,93].includes(code)) return 'livrare';
    if ([3,10,13,22,26,27,41,46,47,53,84,97,99].includes(code)) return 'centru';
    if ([1,2,85,86].includes(code)) return 'ridicat';
    if ([51,52,80,83].includes(code)) return 'inregistrat';
  }
  if (ts === 'outfor') return 'ridicat';
  if (ts === 'incurs') return 'centru';
  return 'inregistrat';
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PackingPage() {
  const [orders, setOrders]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [filter, setFilter]         = useState('toate');
  const [courier, setCourier]       = useState('toate');
  const [packed, setPacked]         = useState({});
  const [labelModal, setLabelModal] = useState(null); // { url, orderNum, awb }
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelError, setLabelError] = useState('');

  // Load packed state from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(ls.get(PACKED_KEY()) || '{}');
      setPacked(saved);
    } catch {}
  }, []);

  const savePacked = useCallback((next) => {
    setPacked(next);
    ls.set(PACKED_KEY(), JSON.stringify(next));
  }, []);

  const togglePacked = useCallback((id) => {
    setPacked(prev => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = Date.now();
      ls.set(PACKED_KEY(), JSON.stringify(next));
      return next;
    });
  }, []);

  // Fetch orders from existing API
  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      try {
        const domain = ls.get('gx_d') || '';
        const token  = ls.get('gx_t') || '';
        if (!domain || !token) {
          setError('Configurează domeniul și tokenul din dashboard.');
          setLoading(false);
          return;
        }

        const today = new Date();
        const from  = new Date(); from.setDate(today.getDate() - 60);
        const fromStr = from.toISOString().slice(0, 10);

        const res  = await fetch(`/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&created_at_min=${fromStr}T00:00:00`);
        const data = await res.json();
        const all  = data.orders || data || [];

        // Filtrăm doar coletele în tranzit
        const transit = all.filter(o => o.ts === 'incurs' || o.ts === 'outfor');
        setOrders(transit);
      } catch (e) {
        setError('Eroare la încărcarea comenzilor: ' + e.message);
      }
      setLoading(false);
    };
    fetchOrders();
  }, []);

  // Filtered orders
  const filtered = orders.filter(o => {
    if (courier !== 'toate' && o.courier !== courier) return false;
    if (filter  === 'toate') return true;
    return classifyStatus(o.ts) === filter;
  });

  const packedCount  = filtered.filter(o => packed[o.id]).length;
  const progPct      = filtered.length ? Math.round(packedCount / filtered.length * 100) : 0;

  // Open label
  const openLabel = async (o) => {
    setLabelError('');
    setLabelModal({ orderNum: o.name, awb: o.trackingNo, url: null });
    setLabelLoading(true);

    try {
      const labelUrl = o.labelUrl || `/api/connector/awb-label?tracking=${o.trackingNo}`;
      const res = await fetch(labelUrl);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      setLabelModal({ orderNum: o.name, awb: o.trackingNo, url });
    } catch (e) {
      setLabelError('Nu s-a putut încărca eticheta: ' + e.message);
      setLabelModal(null);
    }
    setLabelLoading(false);
  };

  const downloadLabel = async (o) => {
    try {
      const labelUrl = o.labelUrl || `/api/connector/awb-label?tracking=${o.trackingNo}`;
      const res  = await fetch(labelUrl);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `AWB_${o.courier?.toUpperCase()}_${o.trackingNo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Eroare download: ' + e.message);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ background:'#0f172a', minHeight:'100vh', fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color:'#f1f5f9' }}>

      {/* Header */}
      <div style={{ background:'#1e293b', borderBottom:'1px solid rgba(255,255,255,.06)', padding:'14px 16px', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div>
            <div style={{ fontSize:18, fontWeight:900, letterSpacing:-.5 }}>GLAM<span style={{ color:'#f97316' }}>X</span> <span style={{ fontSize:13, fontWeight:500, color:'#64748b' }}>Packaging</span></div>
          </div>
          <a href="/" style={{ background:'rgba(255,255,255,.07)', color:'#94a3b8', border:'1px solid rgba(255,255,255,.1)', borderRadius:10, padding:'6px 12px', fontSize:12, fontWeight:600, textDecoration:'none' }}>← Dashboard</a>
        </div>

        {/* Progress */}
        {filtered.length > 0 && (
          <div style={{ marginBottom:10 }}>
            <div style={{ height:6, background:'rgba(255,255,255,.07)', borderRadius:20, overflow:'hidden' }}>
              <div style={{ height:'100%', width:progPct+'%', background:'linear-gradient(90deg,#10b981,#34d399)', borderRadius:20, transition:'width .4s' }}></div>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#64748b', marginTop:4 }}>
              <span style={{ color:'#10b981', fontWeight:700 }}>✅ {packedCount} pregătite</span>
              <span>{filtered.length - packedCount} rămase</span>
            </div>
          </div>
        )}

        {/* Courier filter */}
        <div style={{ display:'flex', gap:6, marginBottom:8, overflowX:'auto', paddingBottom:2 }}>
          {[['toate','🚚 Toți'],['gls','🟠 GLS'],['sameday','🟣 Sameday']].map(([k,l]) => (
            <button key={k} onClick={() => setCourier(k)} style={{
              flexShrink:0, padding:'4px 12px', borderRadius:20, border:'1px solid',
              fontSize:11, fontWeight:700, cursor:'pointer',
              background: courier===k ? (k==='gls'?'rgba(249,115,22,.2)':k==='sameday'?'rgba(139,92,246,.2)':'rgba(59,130,246,.2)') : 'rgba(255,255,255,.04)',
              borderColor: courier===k ? (k==='gls'?'#f97316':k==='sameday'?'#8b5cf6':'#3b82f6') : 'rgba(255,255,255,.1)',
              color: courier===k ? (k==='gls'?'#f97316':k==='sameday'?'#a78bfa':'#93c5fd') : '#64748b',
            }}>{l}</button>
          ))}
        </div>

        {/* Status filter */}
        <div style={{ display:'flex', gap:5, overflowX:'auto', paddingBottom:2 }}>
          {[['toate','Toate',null],...Object.entries(CAT_ICONS).map(([k,icon]) => [k, icon+' '+CAT_LABELS[k], CAT_COLORS[k]])].map(([k,l,c]) => {
            const cnt = k==='toate' ? filtered.length : orders.filter(o => {
              if (courier !== 'toate' && o.courier !== courier) return false;
              return classifyStatus(o.ts) === k;
            }).length;
            return (
              <button key={k} onClick={() => setFilter(k)} style={{
                flexShrink:0, padding:'4px 10px', borderRadius:20, border:'1px solid',
                fontSize:10, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap',
                background: filter===k ? (c||'#3b82f6')+'33' : 'rgba(255,255,255,.04)',
                borderColor: filter===k ? (c||'#3b82f6') : 'rgba(255,255,255,.1)',
                color: filter===k ? (c||'#93c5fd') : '#64748b',
              }}>{l} <span style={{ opacity:.7 }}>({cnt})</span></button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding:'12px 12px 40px', maxWidth:480, margin:'0 auto' }}>

        {loading && (
          <div style={{ textAlign:'center', padding:40, color:'#475569' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>⏳</div>
            <div>Se încarcă comenzile...</div>
          </div>
        )}

        {error && (
          <div style={{ background:'rgba(244,63,94,.1)', border:'1px solid rgba(244,63,94,.3)', borderRadius:12, padding:14, color:'#fb7185', fontSize:13, margin:'12px 0' }}>
            ⚠️ {error}
          </div>
        )}

        {labelError && (
          <div style={{ background:'rgba(244,63,94,.1)', border:'1px solid rgba(244,63,94,.3)', borderRadius:12, padding:14, color:'#fb7185', fontSize:13, margin:'0 0 12px' }}>
            ⚠️ {labelError}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ textAlign:'center', padding:40, color:'#475569' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
            <div>Niciun colet în această categorie</div>
          </div>
        )}

        {filtered.map(o => {
          const cat    = classifyStatus(o.ts);
          const cc     = CAT_COLORS[cat];
          const bg     = CAT_BG[cat];
          const isPacked = !!packed[o.id];
          const isGls  = o.courier !== 'sameday';

          return (
            <div key={o.id} style={{
              background: bg,
              border: `1.5px solid ${cc}44`,
              borderLeft: `5px solid ${cc}`,
              borderRadius: 16,
              marginBottom: 10,
              overflow: 'hidden',
              opacity: isPacked ? .55 : 1,
              transform: isPacked ? 'scale(.99)' : 'scale(1)',
              transition: 'opacity .2s, transform .2s',
            }}>
              <div style={{ padding:'13px 14px 11px' }}>

                {/* Top row */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <div>
                    <div style={{ fontSize:20, fontWeight:900, color:'#0f172a', letterSpacing:-.5 }}>{o.name}</div>
                    <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>{o.createdAt?.slice(0,10)}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                    <span style={{ fontSize:10, fontWeight:800, padding:'2px 8px', borderRadius:20, border:`1.5px solid ${isGls?'#c2410c':'#7c3aed'}44`, background:'white', color:isGls?'#c2410c':'#7c3aed' }}>
                      {isGls?'GLS':'SAMEDAY'}
                    </span>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:cc+'22', border:`1px solid ${cc}55`, color:cc }}>
                      {CAT_ICONS[cat]} {CAT_LABELS[cat]}
                    </span>
                  </div>
                </div>

                {/* Product */}
                {o.prods && (
                  <div style={{ background:'#0f172a', borderRadius:10, padding:'9px 12px', marginBottom:9 }}>
                    <div style={{ fontSize:8, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:1.5, marginBottom:3 }}>PRODUS</div>
                    <div style={{ fontSize:14, fontWeight:700, color:'#f1f5f9', lineHeight:1.3 }}>{o.prods}</div>
                  </div>
                )}

                {/* Client */}
                <div style={{ fontSize:15, fontWeight:700, color:'#1e293b', marginBottom:4 }}>{o.client}</div>
                {o.address && <div style={{ fontSize:11, color:'#475569', marginBottom:2 }}>📍 {o.address}{o.oras?', '+o.oras:''}</div>}
                {o.phone   && <div style={{ fontSize:11, color:'#475569', marginBottom:6 }}>📞 {o.phone}</div>}

                {/* AWB */}
                {o.trackingNo && (
                  <div style={{ background:'#1e293b', borderRadius:11, padding:'9px 12px', marginBottom:8 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                      <span style={{ fontSize:9, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:2 }}>AWB</span>
                      {o.total > 0 && <span style={{ fontSize:11, fontWeight:800, color:'white', background:'#f97316', padding:'2px 8px', borderRadius:6 }}>Ramburs {o.total.toFixed(2)} RON</span>}
                    </div>
                    <div style={{ fontFamily:'Courier New,monospace', fontSize:18, fontWeight:900, color:'#f97316', letterSpacing:2, wordBreak:'break-all' }}>{o.trackingNo}</div>
                  </div>
                )}

                {/* Label buttons */}
                {o.trackingNo && (
                  <div style={{ display:'flex', gap:7, marginBottom:8 }}>
                    <button
                      onClick={() => openLabel(o)}
                      disabled={labelLoading}
                      style={{ flex:1, padding:'10px 8px', borderRadius:10, border:'none', background:'#003087', color:'white', fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                      {labelLoading ? '⏳' : '👁'} Preview etichetă
                    </button>
                    <button
                      onClick={() => downloadLabel(o)}
                      style={{ flex:1, padding:'10px 8px', borderRadius:10, border:'none', background:'#f97316', color:'white', fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                      ⬇ Download
                    </button>
                  </div>
                )}

                {/* Packed toggle */}
                <button
                  onClick={() => togglePacked(o.id)}
                  style={{
                    width:'100%', padding:'9px 12px', borderRadius:11, cursor:'pointer',
                    display:'flex', alignItems:'center', gap:9, border:'2px dashed',
                    borderColor: isPacked ? 'rgba(16,185,129,.4)' : '#cbd5e1',
                    background: isPacked ? 'rgba(16,185,129,.08)' : 'rgba(0,0,0,.02)',
                    transition:'all .2s',
                  }}>
                  <div style={{
                    width:24, height:24, borderRadius:7, border:`2px solid ${isPacked?'#10b981':'#cbd5e1'}`,
                    background: isPacked ? '#10b981' : 'white',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:13, color:'white', flexShrink:0,
                  }}>{isPacked ? '✓' : ''}</div>
                  <span style={{ fontSize:13, fontWeight:700, color: isPacked ? '#059669' : '#94a3b8', flex:1, textAlign:'left' }}>
                    {isPacked ? 'PREGĂTIT ✅' : 'Marchează ca pregătit'}
                  </span>
                  {isPacked && packed[o.id] && (
                    <span style={{ fontSize:10, color:'#10b981', background:'rgba(16,185,129,.1)', padding:'2px 8px', borderRadius:20, fontWeight:700 }}>
                      {new Date(packed[o.id]).toLocaleTimeString('ro-RO', { hour:'2-digit', minute:'2-digit' })}
                    </span>
                  )}
                </button>

              </div>
            </div>
          );
        })}
      </div>

      {/* Label Preview Modal */}
      {labelModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:1000, display:'flex', flexDirection:'column' }}>
          {/* Modal header */}
          <div style={{ background:'#003087', padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
            <div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,.6)', fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>Etichetă AWB · {labelModal.orderNum}</div>
              <div style={{ fontFamily:'monospace', fontSize:17, fontWeight:900, color:'#f59e0b', letterSpacing:2 }}>{labelModal.awb}</div>
            </div>
            <button onClick={() => { setLabelModal(null); setLabelError(''); }} style={{ background:'rgba(255,255,255,.15)', border:'none', color:'white', width:34, height:34, borderRadius:'50%', fontSize:16, cursor:'pointer' }}>✕</button>
          </div>

          {/* PDF viewer */}
          <div style={{ flex:1, overflow:'hidden', position:'relative' }}>
            {labelLoading && (
              <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', color:'#64748b', fontSize:14, fontWeight:600 }}>
                ⏳ Se încarcă eticheta...
              </div>
            )}
            {labelModal.url && (
              <iframe src={labelModal.url} style={{ width:'100%', height:'100%', border:'none', display:'block' }} />
            )}
          </div>

          {/* Modal footer */}
          {labelModal.url && (
            <div style={{ padding:'12px 16px', background:'white', display:'flex', gap:8, flexShrink:0 }}>
              <a href={labelModal.url} download={`AWB_${labelModal.awb}.pdf`}
                style={{ flex:1, padding:13, borderRadius:12, background:'#f97316', color:'white', fontSize:14, fontWeight:800, textAlign:'center', textDecoration:'none', display:'flex', alignItems:'center', justifyContent:'center' }}>
                ⬇ Download PDF
              </a>
              <a href={labelModal.url} target="_blank" rel="noreferrer"
                style={{ padding:'13px 14px', borderRadius:12, background:'#f1f5f9', color:'#475569', fontSize:14, fontWeight:700, textDecoration:'none', display:'flex', alignItems:'center' }}>
                🔗
              </a>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
