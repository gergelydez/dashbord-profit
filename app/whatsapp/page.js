'use client';
import { useState, useEffect, useCallback } from 'react';

const ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
};

// ── Logică program trimitere ──
function getNextSendTime(orderDate) {
  const d = new Date(orderDate);
  const send = new Date(d.getTime() + 2 * 60 * 60 * 1000); // +2 ore
  const day = send.getDay(); // 0=dum, 1=lun, ..., 6=sâm
  const hour = send.getHours();
  const min = send.getMinutes();

  // Duminică → amânăm la luni 08:00
  if (day === 0) {
    const monday = new Date(send);
    monday.setDate(monday.getDate() + 1);
    monday.setHours(8, 0, 0, 0);
    return { time: monday, delayed: 'Luni 08:00 (din duminică)' };
  }

  // Sâmbătă după 15:00 → luni 08:00
  if (day === 6 && hour >= 15) {
    const monday = new Date(send);
    monday.setDate(monday.getDate() + 2);
    monday.setHours(8, 0, 0, 0);
    return { time: monday, delayed: 'Luni 08:00 (din sâmbătă)' };
  }

  // Luni-Vineri după 18:00 → a doua zi 08:00
  if (day >= 1 && day <= 5 && hour >= 18) {
    const next = new Date(send);
    next.setDate(next.getDate() + 1);
    next.setHours(8, 0, 0, 0);
    // Dacă a doua zi e sâmbătă → luni
    if (next.getDay() === 6) next.setDate(next.getDate() + 2);
    if (next.getDay() === 0) next.setDate(next.getDate() + 1);
    return { time: next, delayed: 'Mâine 08:00' };
  }

  // Luni-Vineri înainte de 08:00 → 08:00
  if (day >= 1 && day <= 5 && hour < 8) {
    const today = new Date(send);
    today.setHours(8, 0, 0, 0);
    return { time: today, delayed: 'Azi 08:00' };
  }

  // Sâmbătă înainte de 10:00 → sâmbătă 10:00
  if (day === 6 && hour < 10) {
    const today = new Date(send);
    today.setHours(10, 0, 0, 0);
    return { time: today, delayed: 'Azi 10:00' };
  }

  return { time: send, delayed: null };
}

function canSendNow() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 0) return false; // duminică
  if (day >= 1 && day <= 5) return hour >= 8 && hour < 18;
  if (day === 6) return hour >= 10 && hour < 15;
  return false;
}

const STATUS_CONFIG = {
  pending:     { label: 'În așteptare', color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
  scheduled:   { label: 'Programat', color: '#3b82f6', bg: 'rgba(59,130,246,.12)' },
  sent:        { label: 'Trimis', color: '#a855f7', bg: 'rgba(168,85,247,.12)' },
  confirmed:   { label: 'Confirmat ✓', color: '#10b981', bg: 'rgba(16,185,129,.12)' },
  declined:    { label: 'Refuzat', color: '#f43f5e', bg: 'rgba(244,63,94,.12)' },
  no_response: { label: 'Fără răspuns', color: '#64748b', bg: 'rgba(100,116,139,.12)' },
};

export default function WhatsAppPage() {
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState({ twilioSid: '', twilioToken: '', twilioFrom: '', shopDomain: '', shopToken: '' });
  const [orders, setOrders] = useState([]);
  const [waOrders, setWaOrders] = useState({}); // { orderId: { status, sentAt, confirmedAt, ... } }
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [msgTemplate, setMsgTemplate] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [autoCheck, setAutoCheck] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    setMounted(true);
    const savedCfg = ls.get('wa_config');
    if (savedCfg) {
      try { setConfig(JSON.parse(savedCfg)); } catch {}
    }
    const savedOrders = ls.get('wa_orders');
    if (savedOrders) {
      try { setWaOrders(JSON.parse(savedOrders)); } catch {}
    }
    const savedTpl = ls.get('wa_template');
    setMsgTemplate(savedTpl || 'Bună {{client}}, comanda ta #{{nr}} de {{total}} RON a fost plasată cu succes! Confirmi comanda? Răspunde cu DA sau NU. Mulțumim! 🙏 GLAMX');
  }, []);

  const saveConfig = () => {
    ls.set('wa_config', JSON.stringify(config));
    setSuccess('Configurație salvată!');
    setTimeout(() => setSuccess(''), 2000);
  };

  const saveWaOrders = (data) => {
    setWaOrders(data);
    ls.set('wa_orders', JSON.stringify(data));
  };

  const loadShopifyOrders = async () => {
    if (!config.shopDomain || !config.shopToken) {
      setError('Completează datele Shopify în configurație!'); return;
    }
    setLoading('orders'); setError('');
    try {
      const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const url = `/api/orders?domain=${encodeURIComponent(config.shopDomain)}&token=${encodeURIComponent(config.shopToken)}&created_at_min=${d7}T00:00:00`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.orders) throw new Error(data.error || 'Eroare');
      // Doar comenzile UNFULFILLED
      const unfulfilled = data.orders.filter(o =>
        o.fulfillment_status === null || o.fulfillment_status === 'unfulfilled' || !o.fulfillment_status
      );
      setOrders(unfulfilled);
    } catch (e) { setError('Eroare: ' + e.message); }
    setLoading('');
  };

  const buildMessage = (order) => {
    const client = order.shipping_address?.name || order.name || 'client';
    const firstName = client.split(' ')[0];
    return msgTemplate
      .replace('{{client}}', firstName)
      .replace('{{nr}}', order.name || order.id)
      .replace('{{total}}', parseFloat(order.total_price || 0).toFixed(2))
      .replace('{{produse}}', (order.line_items || []).map(i => i.name).join(', ').slice(0, 60));
  };

  const getPhone = (order) => {
    const addr = order.shipping_address || order.billing_address || {};
    // Încearcă toate sursele posibile de telefon
    let phone = order.phone || addr.phone || '';
    if (!phone) {
      const note = (order.note_attributes || []).find(a =>
        a.name?.toLowerCase().includes('phone') ||
        a.name?.toLowerCase().includes('telefon') ||
        a.name?.toLowerCase().includes('tel')
      );
      phone = note?.value || '';
    }
    if (!phone) return '';
    // Normalizăm: scoatem spații și caractere speciale
    phone = phone.replace(/[\s\-().+]/g, '');
    // România: 07xx sau 02xx → +407xx
    if (phone.startsWith('07') || phone.startsWith('02') || phone.startsWith('03')) {
      phone = '+4' + phone;
    } else if (phone.startsWith('40') && !phone.startsWith('+')) {
      phone = '+' + phone;
    } else if (!phone.startsWith('+')) {
      phone = '+4' + phone; // asumăm RO
    }
    return phone;
  };

  const sendWhatsApp = async (order, isManual = false) => {
    const phone = getPhone(order);
    if (!phone) {
      setError(`Comanda ${order.name}: nu am găsit numărul de telefon!`);
      return false;
    }
    if (!config.twilioSid || !config.twilioToken || !config.twilioFrom) {
      setError('Completează datele Twilio în configurație!');
      return false;
    }

    const message = buildMessage(order);
    setLoading('send_' + order.id);

    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phone, message,
          twilioSid: config.twilioSid,
          twilioToken: config.twilioToken,
          twilioFrom: config.twilioFrom,
          orderId: order.id,
          orderName: order.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare trimitere');

      const updated = {
        ...waOrders,
        [order.id]: {
          status: 'sent',
          phone,
          sentAt: new Date().toISOString(),
          message,
          isManual,
          messageSid: data.sid,
        },
      };
      saveWaOrders(updated);
      setSuccess(`Mesaj trimis la ${phone}!`);
      setTimeout(() => setSuccess(''), 3000);
      return true;
    } catch (e) {
      setError('Eroare: ' + e.message);
      return false;
    } finally {
      setLoading('');
    }
  };

  const markConfirmed = (orderId) => {
    const updated = {
      ...waOrders,
      [orderId]: { ...waOrders[orderId], status: 'confirmed', confirmedAt: new Date().toISOString(), manual: true },
    };
    saveWaOrders(updated);
  };

  const markDeclined = (orderId) => {
    const updated = {
      ...waOrders,
      [orderId]: { ...waOrders[orderId], status: 'declined', declinedAt: new Date().toISOString(), manual: true },
    };
    saveWaOrders(updated);
  };

  const resetOrder = (orderId) => {
    const updated = { ...waOrders };
    delete updated[orderId];
    saveWaOrders(updated);
  };

  // Auto-check: verifică comenzile care trebuie trimise acum
  const autoSendCheck = useCallback(async () => {
    if (!canSendNow()) return;
    const toSend = orders.filter(o => {
      const wa = waOrders[o.id];
      if (wa) return false; // deja procesată
      const { time } = getNextSendTime(o.created_at);
      return new Date() >= time;
    });
    for (const order of toSend) {
      await sendWhatsApp(order, false);
      await new Promise(r => setTimeout(r, 1000)); // pauză 1s între mesaje
    }
  }, [orders, waOrders, config]);

  useEffect(() => {
    if (!autoCheck || !mounted) return;
    const interval = setInterval(autoSendCheck, 60 * 1000); // verifică la fiecare minut
    autoSendCheck(); // verifică imediat
    return () => clearInterval(interval);
  }, [autoCheck, autoSendCheck, mounted]);

  const filteredOrders = orders.filter(o => {
    const wa = waOrders[o.id];
    const status = wa?.status || 'pending';
    if (filter === 'all') return true;
    return status === filter;
  });

  if (!mounted) return null;

  const statCounts = {
    all: orders.length,
    pending: orders.filter(o => !waOrders[o.id]).length,
    sent: orders.filter(o => waOrders[o.id]?.status === 'sent').length,
    confirmed: orders.filter(o => waOrders[o.id]?.status === 'confirmed').length,
    declined: orders.filter(o => waOrders[o.id]?.status === 'declined').length,
  };

  return (
    <>
      <style>{`
        * { margin:0; padding:0; box-sizing:border-box; }
        body { background:#060a0f; color:#e2e8f0; font-family:'DM Sans',system-ui,sans-serif; min-height:100vh; }
        .wrap { max-width:900px; margin:0 auto; padding:20px 14px 80px; }
        .card { background:#0d1520; border:1px solid #1a2535; border-radius:14px; padding:16px 18px; margin-bottom:12px; }
        .inp { background:#070d12; border:1px solid #1a2535; color:#e2e8f0; padding:9px 12px; border-radius:8px; font-size:13px; outline:none; width:100%; font-family:monospace; }
        .inp:focus { border-color:#25d366; }
        .lbl { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; display:block; }
        .g2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .btn-green { background:linear-gradient(135deg,#25d366,#128c7e); color:white; border:none; padding:10px 20px; border-radius:10px; font-weight:700; font-size:13px; cursor:pointer; }
        .btn-green:disabled { opacity:.4; cursor:not-allowed; }
        .btn-sm { padding:5px 12px; border-radius:7px; font-size:11px; font-weight:600; cursor:pointer; border:none; }
        .tag { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:20px; font-size:10px; font-weight:600; }
        .order-card { background:#070d12; border:1px solid #1a2535; border-radius:10px; padding:14px; margin-bottom:8px; transition:border .2s; }
        .order-card:hover { border-color:#25d366; }
        .filter-btn { background:#0d1520; border:1px solid #1a2535; color:#64748b; padding:5px 14px; border-radius:20px; font-size:11px; cursor:pointer; }
        .filter-btn.active { background:#25d366; border-color:#25d366; color:white; font-weight:700; }
        .toggle { width:40px; height:22px; background:#1a2535; border-radius:11px; position:relative; cursor:pointer; transition:background .2s; }
        .toggle.on { background:#25d366; }
        .toggle::after { content:''; position:absolute; width:18px; height:18px; background:white; border-radius:50%; top:2px; left:2px; transition:left .2s; }
        .toggle.on::after { left:20px; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.4} }
        .pulse { animation:pulse 1.5s ease-in-out infinite; }
        @media(max-width:600px) { .g2 { grid-template-columns:1fr; } .wrap { padding:14px 10px 60px; } }
      `}</style>

      <div className="wrap">
        {/* HEADER */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20,paddingBottom:16,borderBottom:'1px solid #1a2535',flexWrap:'wrap'}}>
          <div style={{background:'#25d366',color:'white',fontWeight:800,fontSize:22,padding:'6px 12px',borderRadius:12}}>📱</div>
          <div>
            <div style={{fontSize:20,fontWeight:800,letterSpacing:-.3}}>WhatsApp Confirmare Comenzi</div>
            <div style={{fontSize:11,color:'#64748b',marginTop:2}}>Trimitere automată + manuală · Twilio · GLAMX</div>
          </div>
          <div style={{marginLeft:'auto',display:'flex',gap:8,flexWrap:'wrap'}}>
            <a href="/" style={{background:'#0d1520',border:'1px solid #1a2535',color:'#64748b',padding:'6px 14px',borderRadius:20,fontSize:11,textDecoration:'none'}}>← Dashboard</a>
            <button onClick={() => setShowConfig(!showConfig)}
              style={{background:showConfig?'#25d366':'#0d1520',border:'1px solid #1a2535',color:showConfig?'white':'#64748b',padding:'6px 14px',borderRadius:20,fontSize:11,cursor:'pointer'}}>
              ⚙️ Configurație
            </button>
          </div>
        </div>

        {/* ALERTS */}
        {error && <div style={{background:'rgba(244,63,94,.1)',border:'1px solid rgba(244,63,94,.25)',borderRadius:10,padding:'10px 14px',color:'#f43f5e',fontSize:12,marginBottom:12}}>{error} <button onClick={()=>setError('')} style={{float:'right',background:'none',border:'none',color:'#f43f5e',cursor:'pointer'}}>✕</button></div>}
        {success && <div style={{background:'rgba(37,211,102,.1)',border:'1px solid rgba(37,211,102,.25)',borderRadius:10,padding:'10px 14px',color:'#25d366',fontSize:12,marginBottom:12}}>✅ {success}</div>}

        {/* CONFIG */}
        {showConfig && (
          <div className="card" style={{marginBottom:16,border:'1px solid rgba(37,211,102,.3)'}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:14,color:'#25d366'}}>⚙️ Configurație</div>
            <div style={{fontSize:10,color:'#f59e0b',padding:'7px 10px',background:'rgba(245,158,11,.07)',borderRadius:8,marginBottom:12}}>
              🔐 Credențialele sunt salvate local în browser, nu pe server.
            </div>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:8}}>Twilio</div>
              <div className="g2" style={{marginBottom:8}}>
                <div><label className="lbl">Account SID</label><input className="inp" value={config.twilioSid} placeholder="ACxxxx..." onChange={e=>setConfig(c=>({...c,twilioSid:e.target.value}))}/></div>
                <div><label className="lbl">Auth Token</label><input className="inp" type="password" value={config.twilioToken} onChange={e=>setConfig(c=>({...c,twilioToken:e.target.value}))}/></div>
              </div>
              <div>
                <label className="lbl">Număr WhatsApp Twilio</label>
                <input className="inp" value={config.twilioFrom} placeholder="+14155238886 sau whatsapp:+14155238886"
                  onChange={e=>{
                    let v = e.target.value.trim();
                    // Auto-adaugă prefixul whatsapp: dacă lipsește
                    if (v && !v.startsWith('whatsapp:')) v = 'whatsapp:' + v;
                    setConfig(c=>({...c,twilioFrom:v}));
                  }}/>
                <div style={{fontSize:10,color:'#25d366',marginTop:3}}>
                  Sandbox: whatsapp:+14155238886 · Se salvează automat cu prefix
                </div>
              </div>
            </div>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:8}}>Shopify</div>
              <div className="g2">
                <div><label className="lbl">Domeniu magazin</label><input className="inp" value={config.shopDomain} placeholder="magazin.myshopify.com" onChange={e=>setConfig(c=>({...c,shopDomain:e.target.value}))}/></div>
                <div><label className="lbl">Admin API Token</label><input className="inp" type="password" value={config.shopToken} onChange={e=>setConfig(c=>({...c,shopToken:e.target.value}))}/></div>
              </div>
            </div>
            <div style={{marginBottom:12}}>
              <label className="lbl">Template mesaj</label>
              <textarea className="inp" rows={3} value={msgTemplate} onChange={e=>{setMsgTemplate(e.target.value);ls.set('wa_template',e.target.value);}}
                style={{resize:'vertical',lineHeight:1.5}}/>
              <div style={{fontSize:10,color:'#475569',marginTop:4}}>Variabile: {'{{client}}'} {'{{nr}}'} {'{{total}}'} {'{{produse}}'}</div>
            </div>
            <button className="btn-green" onClick={saveConfig}>💾 Salvează configurație</button>
          </div>
        )}

        {/* PROGRAM */}
        <div className="card" style={{marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>⏰ Program trimitere automată</div>
              <div style={{fontSize:11,color:'#64748b'}}>
                L-V: 08:00–18:00 · Sâmbătă: 10:00–15:00 · Duminică: <span style={{color:'#f43f5e'}}>NU se trimite</span>
                <span style={{marginLeft:8,color:'#f59e0b'}}>· Comenzile de duminică → luni 08:00</span>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:11,color:canSendNow()?'#25d366':'#64748b'}}>
                {canSendNow() ? '🟢 În program' : '🔴 În afara programului'}
              </span>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:11,color:'#94a3b8'}}>Auto</span>
                <div className={`toggle ${autoCheck?'on':''}`} onClick={()=>setAutoCheck(!autoCheck)}/>
              </div>
            </div>
          </div>
        </div>

        {/* STATS */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,marginBottom:16}}>
          {[['all','Toate',orders.length,'#94a3b8'],['pending','Așteptare',statCounts.pending,'#f59e0b'],
            ['sent','Trimise',statCounts.sent,'#a855f7'],['confirmed','Confirmate',statCounts.confirmed,'#25d366'],
            ['declined','Refuzate',statCounts.declined,'#f43f5e']].map(([f,l,c,col])=>(
            <div key={f} onClick={()=>setFilter(f)} style={{background:filter===f?`${col}18`:'#0d1520',border:`1px solid ${filter===f?col:'#1a2535'}`,borderRadius:10,padding:'10px',textAlign:'center',cursor:'pointer'}}>
              <div style={{fontSize:18,fontWeight:800,color:col}}>{c}</div>
              <div style={{fontSize:9,color:'#64748b',textTransform:'uppercase',letterSpacing:1}}>{l}</div>
            </div>
          ))}
        </div>

        {/* ACȚIUNI */}
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          <button className="btn-green" onClick={loadShopifyOrders} disabled={loading==='orders'}>
            {loading==='orders'?<span className="pulse">⟳ Se încarcă...</span>:'🔄 Încarcă comenzi noi (7 zile)'}
          </button>
          {orders.length > 0 && canSendNow() && (
            <button onClick={autoSendCheck}
              style={{background:'rgba(37,211,102,.12)',border:'1px solid rgba(37,211,102,.3)',color:'#25d366',padding:'10px 20px',borderRadius:10,fontWeight:700,fontSize:13,cursor:'pointer'}}>
              📤 Trimite acum cele programate ({orders.filter(o=>!waOrders[o.id]&&new Date()>=getNextSendTime(o.created_at).time).length})
            </button>
          )}
        </div>

        {/* COMENZI */}
        {filteredOrders.length === 0 && (
          <div style={{textAlign:'center',padding:'40px',color:'#334155',fontSize:13}}>
            {orders.length === 0 ? 'Apasă "Încarcă comenzi" pentru a vedea comenzile UNFULFILLED' : 'Nicio comandă în această categorie'}
          </div>
        )}

        {filteredOrders.map(order => {
          const wa = waOrders[order.id] || {};
          const status = wa.status || 'pending';
          const sc = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
          const phone = getPhone(order);
          const { time: sendTime, delayed } = getNextSendTime(order.created_at);
          const isSending = loading === 'send_' + order.id;
          const readyToSend = new Date() >= sendTime && !wa.status;
          const msg = buildMessage(order);

          return (
            <div key={order.id} className="order-card">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10,flexWrap:'wrap',gap:8}}>
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                    <span style={{fontSize:14,fontWeight:800,color:'#e2e8f0'}}>{order.name}</span>
                    <span className="tag" style={{background:sc.bg,color:sc.color}}>{sc.label}</span>
                    {wa.isManual===false&&wa.status==='sent'&&<span className="tag" style={{background:'rgba(100,116,139,.1)',color:'#64748b'}}>auto</span>}
                    {wa.manual&&<span className="tag" style={{background:'rgba(100,116,139,.1)',color:'#64748b'}}>manual</span>}
                  </div>
                  <div style={{fontSize:11,color:'#64748b'}}>
                    {order.shipping_address?.name} · {order.shipping_address?.city} ·{' '}
                    <span style={{color:phone?'#25d366':'#f43f5e',fontFamily:'monospace'}}>{phone||'⚠️ Fără telefon'}</span>
                  </div>
                  <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>
                    {(order.line_items||[]).map(i=>i.name).join(' + ').slice(0,60)} ·{' '}
                    <span style={{color:'#f97316',fontWeight:700}}>{parseFloat(order.total_price||0).toFixed(2)} RON</span>
                  </div>
                </div>
                <div style={{textAlign:'right',fontSize:10,color:'#475569'}}>
                  <div>Plasat: {fmtTime(order.created_at)}</div>
                  {!wa.status && <div style={{color:readyToSend?'#25d366':'#f59e0b',marginTop:2}}>
                    {readyToSend?'✅ Gata de trimis':delayed?`⏳ ${delayed}`:`Trimitere: ${fmtTime(sendTime.toISOString())}`}
                  </div>}
                  {wa.sentAt && <div style={{marginTop:2}}>Trimis: {fmtTime(wa.sentAt)}</div>}
                  {wa.confirmedAt && <div style={{color:'#25d366',marginTop:2}}>Confirmat: {fmtTime(wa.confirmedAt)}</div>}
                </div>
              </div>

              {/* Preview mesaj */}
              {!wa.status && (
                <div style={{background:'rgba(37,211,102,.05)',border:'1px solid rgba(37,211,102,.1)',borderRadius:8,padding:'8px 10px',marginBottom:10,fontSize:11,color:'#94a3b8',fontStyle:'italic'}}>
                  💬 "{msg}"
                </div>
              )}

              {/* Acțiuni */}
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {/* Trimitere manuală */}
                {(!wa.status || wa.status === 'no_response') && phone && (
                  <button className="btn-sm btn-green" onClick={()=>sendWhatsApp(order,true)} disabled={isSending}>
                    {isSending?<span className="pulse">⟳</span>:'📤 Trimite acum'}
                  </button>
                )}

                {/* Retrimite */}
                {wa.status === 'sent' && (
                  <button className="btn-sm" onClick={()=>sendWhatsApp(order,true)} disabled={isSending}
                    style={{background:'rgba(168,85,247,.12)',color:'#a855f7',border:'1px solid rgba(168,85,247,.2)'}}>
                    🔄 Retrimite
                  </button>
                )}

                {/* Confirmare manuală */}
                {(wa.status === 'sent' || wa.status === 'pending') && (
                  <button className="btn-sm" onClick={()=>markConfirmed(order.id)}
                    style={{background:'rgba(37,211,102,.12)',color:'#25d366',border:'1px solid rgba(37,211,102,.2)'}}>
                    ✓ Marchează confirmat
                  </button>
                )}

                {/* Refuz manual */}
                {(wa.status === 'sent' || wa.status === 'pending') && (
                  <button className="btn-sm" onClick={()=>markDeclined(order.id)}
                    style={{background:'rgba(244,63,94,.1)',color:'#f43f5e',border:'1px solid rgba(244,63,94,.2)'}}>
                    ✕ Marchează refuzat
                  </button>
                )}

                {/* Reset */}
                {wa.status && (
                  <button className="btn-sm" onClick={()=>resetOrder(order.id)}
                    style={{background:'rgba(100,116,139,.1)',color:'#64748b',border:'1px solid #1a2535',marginLeft:'auto'}}>
                    ↩ Reset
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* INFO TWILIO */}
        <div className="card" style={{marginTop:16,background:'rgba(37,211,102,.03)',border:'1px solid rgba(37,211,102,.1)'}}>
          <div style={{fontSize:11,fontWeight:700,color:'#25d366',marginBottom:8}}>📋 Cum configurezi Twilio WhatsApp</div>
          <div style={{fontSize:11,color:'#64748b',lineHeight:1.7}}>
            1. Creează cont pe <strong style={{color:'#94a3b8'}}>twilio.com</strong> → Console → Account SID + Auth Token<br/>
            2. Activează <strong style={{color:'#94a3b8'}}>WhatsApp Sandbox</strong> sau cumpără un număr WhatsApp Business<br/>
            3. Numărul sandbox e: <strong style={{color:'#25d366',fontFamily:'monospace'}}>whatsapp:+14155238886</strong><br/>
            4. Clienții trebuie să trimită mai întâi un mesaj de join (<em>join [cuvânt]</em>) pentru sandbox<br/>
            5. Pentru producție: aprobă template-ul mesajului la Meta Business<br/>
            6. Webhook pentru răspunsuri automate: <strong style={{color:'#94a3b8',fontFamily:'monospace'}}>{typeof window!=='undefined'?window.location.origin:''}/api/whatsapp/webhook</strong>
          </div>
        </div>
      </div>
    </>
  );
}

