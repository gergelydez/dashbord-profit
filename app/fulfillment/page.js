'use client';
/**
 * app/fulfillment/page.js — Fulfillment: procesare & ambalare comenzi
 *
 * Rescriere completă. Reutilizează explicit logica deja funcțională din:
 *  - app/gls/page.js       → creare AWB GLS (./awb-flow.js)
 *  - app/xconnector/page.tsx / /api/connector/invoice → facturare (./invoice-flow.js)
 *  - app/api/orders-server → status AWB/factură din DB (sursă de adevăr)
 *  - lib/address/ro-postal-codes.ts (prin /api/validate-address) → validare adresă locală
 *
 * NU mai folosește /api/smartbill-invoice sau statusul din note Shopify/localStorage.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useShopStore } from '@/lib/store/shop-store';
import { AwbModal } from './awb-flow';
import { InvoiceModal } from './invoice-flow';
import { useProductImages } from './product-images';
import { buildWaLink } from './whatsapp-template';

const fmt = n => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useToast() {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  }, []);
  return { toasts, toast };
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
  .ff-page{max-width:1400px;margin:0 auto;padding:12px 12px 120px;font-family:'DM Sans',system-ui,sans-serif;}

  .ff-hdr{position:sticky;top:0;z-index:200;background:rgba(7,9,14,.97);backdrop-filter:blur(24px) saturate(180%);border-bottom:1px solid rgba(255,255,255,.06);padding:0 16px;margin-bottom:16px;}
  .ff-hdr-inner{display:flex;align-items:center;gap:10px;padding:12px 0;flex-wrap:wrap;}
  .ff-logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#f97316,#dc2626);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;box-shadow:0 4px 16px rgba(249,115,22,.35);}
  .ff-title h1{font-size:16px;font-weight:800;letter-spacing:-.5px;color:#f1f5f9;}
  .ff-title p{font-size:10px;color:#475569;margin-top:1px;}

  .ff-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px;}
  @media(min-width:600px){.ff-kpis{grid-template-columns:repeat(4,1fr);}}
  .ff-kpi{background:#0c1018;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:14px 16px;cursor:pointer;transition:border-color .15s,transform .1s;}
  .ff-kpi:hover{border-color:rgba(249,115,22,.3);transform:translateY(-1px);}
  .ff-kpi-v{font-size:26px;font-weight:800;letter-spacing:-1.5px;font-family:'Space Grotesk',monospace;color:var(--kc,#e2e8f0);}
  .ff-kpi-l{font-size:10px;color:#475569;margin-top:3px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;}

  .ff-tabs{display:flex;gap:4px;margin-bottom:14px;background:#0a0e14;padding:4px;border-radius:12px;border:1px solid rgba(255,255,255,.05);overflow-x:auto;}
  .ff-tab{flex:1;padding:9px 6px;border-radius:8px;border:none;background:transparent;color:#475569;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;}
  .ff-tab.active{background:linear-gradient(135deg,rgba(249,115,22,.15),rgba(220,38,38,.1));color:#f97316;border:1px solid rgba(249,115,22,.25);}

  .ff-search{width:100%;background:#080d12;border:1px solid #1a2535;color:#e2e8f0;padding:9px 13px;border-radius:10px;font-size:13px;outline:none;margin-bottom:14px;font-family:inherit;}
  .ff-search:focus{border-color:#f97316;}

  .ff-empty{text-align:center;padding:48px 20px;color:#334155;}
  .ff-warn-banner{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:12px;padding:14px 16px;font-size:12px;color:#f59e0b;margin-bottom:14px;}

  .ff-card{background:#0c1018;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px 16px;margin-bottom:10px;}
  .ff-card.ready{border-color:rgba(16,185,129,.25);background:rgba(16,185,129,.02);}
  .ff-card.issue{border-color:rgba(245,158,11,.2);}
  .ff-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;flex-wrap:wrap;}
  .ff-card-client{font-size:14px;font-weight:700;color:#e2e8f0;}
  .ff-card-addr{font-size:11px;color:#64748b;margin-top:2px;line-height:1.5;}
  .ff-card-name{font-family:'Space Grotesk',monospace;font-size:13px;font-weight:700;color:#f97316;}
  .ff-card-date{font-size:10px;color:#334155;}

  .ff-badges{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0;}
  .ff-badge{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap;}
  .ff-badge-ok{background:rgba(16,185,129,.1);color:#10b981;border:1px solid rgba(16,185,129,.2);}
  .ff-badge-warn{background:rgba(245,158,11,.1);color:#f59e0b;border:1px solid rgba(245,158,11,.2);}
  .ff-badge-err{background:rgba(244,63,94,.1);color:#f43f5e;border:1px solid rgba(244,63,94,.2);}
  .ff-badge-blue{background:rgba(59,130,246,.1);color:#60a5fa;border:1px solid rgba(59,130,246,.2);}
  .ff-badge-gray{background:rgba(255,255,255,.05);color:#64748b;border:1px solid rgba(255,255,255,.08);}

  .ff-items{display:flex;flex-direction:column;gap:6px;margin:10px 0;padding:10px;background:#080d12;border-radius:10px;}
  .ff-item{display:flex;align-items:center;gap:10px;}
  .ff-item-img{width:38px;height:38px;border-radius:8px;object-fit:cover;background:#131a24;flex-shrink:0;}
  .ff-item-placeholder{width:38px;height:38px;border-radius:8px;background:#131a24;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px;}
  .ff-item-name{font-size:12px;color:#cbd5e1;font-weight:600;}
  .ff-item-meta{font-size:10px;color:#475569;}

  .ff-addr-issues{background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:8px 10px;font-size:11px;color:#f59e0b;margin:8px 0;line-height:1.6;}

  .ff-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;}
  .ff-btn{display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:8px;border:none;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;text-decoration:none;}
  .ff-btn-primary{background:linear-gradient(135deg,#f97316,#ea580c);color:white;}
  .ff-btn-ghost{background:rgba(255,255,255,.05);color:#94a3b8;border:1px solid rgba(255,255,255,.1);}
  .ff-btn-green{background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.25);}
  .ff-btn-blue{background:rgba(59,130,246,.15);color:#60a5fa;border:1px solid rgba(59,130,246,.25);}
  .ff-btn:disabled{opacity:.4;cursor:not-allowed;}

  .ff-overlay{position:fixed;inset:0;background:rgba(0,0,0,.87);z-index:500;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(6px);}
  @media(min-width:640px){.ff-overlay{align-items:center;padding:16px;}}
  .ff-modal{background:#0d1219;border:1px solid rgba(255,255,255,.1);width:100%;max-height:95dvh;overflow-y:auto;max-width:640px;}
  @media(min-width:640px){.ff-modal{border-radius:16px;}}
  .ff-modal-hdr{padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:flex-start;justify-content:space-between;position:sticky;top:0;background:#0d1219;z-index:10;}
  .ff-modal-title{font-size:15px;font-weight:800;}
  .ff-modal-sub{font-size:11px;color:#475569;margin-top:3px;}
  .ff-modal-close{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:#64748b;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:13px;}
  .ff-modal-body{padding:18px 20px;display:flex;flex-direction:column;gap:14px;}
  .ff-modal-ftr{padding:14px 20px;border-top:1px solid rgba(255,255,255,.07);display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:0;background:#0d1219;}

  .ff-okbox{background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:10px;padding:16px;text-align:center;}
  .ff-okbox-big{font-family:'Space Grotesk',monospace;font-size:26px;font-weight:800;color:#10b981;letter-spacing:1px;margin:6px 0;}
  .ff-errbox{background:rgba(244,63,94,.07);border:1px solid rgba(244,63,94,.25);border-radius:8px;padding:10px 14px;font-size:12px;color:#f43f5e;}
  .ff-warnbox{background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:10px 14px;font-size:12px;color:#f59e0b;}
  .ff-infobox{background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:10px 14px;font-size:12px;color:#93c5fd;}

  .ff-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  @media(max-width:480px){.ff-grid2{grid-template-columns:1fr;}}
  .ff-field{display:flex;flex-direction:column;gap:5px;}
  .ff-lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:700;}
  .ff-inp{background:#080d12;border:1px solid #1a2535;color:#e2e8f0;padding:9px 12px;border-radius:8px;font-size:13px;outline:none;font-family:inherit;}
  .ff-inp:focus{border-color:#f97316;}
  .ff-section-title{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;}

  .ff-courier-tabs{display:flex;gap:6px;}
  .ff-courier-tab{flex:1;padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#080d12;color:#94a3b8;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;}
  .ff-courier-tab.active{border-color:#f97316;background:rgba(249,115,22,.08);color:#f97316;}

  .ff-svc-group{font-size:9px;font-weight:800;color:#334155;text-transform:uppercase;letter-spacing:1px;padding:8px 0 5px;}
  .ff-svc-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;}
  @media(min-width:560px){.ff-svc-grid{grid-template-columns:repeat(3,1fr);}}
  .ff-svc-card{background:#080d12;border:1.5px solid rgba(255,255,255,.05);border-radius:10px;padding:9px 11px;cursor:pointer;display:flex;gap:8px;align-items:flex-start;}
  .ff-svc-card.active{border-color:#f97316;background:rgba(249,115,22,.07);}
  .ff-svc-chk{width:16px;height:16px;border-radius:5px;border:2px solid #243040;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px;}
  .ff-svc-card.active .ff-svc-chk{background:#f97316;border-color:#f97316;color:white;}
  .ff-svc-name{font-size:11px;font-weight:700;color:#e2e8f0;}
  .ff-svc-desc{font-size:9px;color:#475569;margin-top:2px;}

  .ff-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}
  .ff-toggle-title{font-size:13px;font-weight:600;}
  .ff-toggle-sub{font-size:11px;color:#64748b;margin-top:2px;}
  .ff-toggle{width:38px;height:21px;background:#1a2535;border-radius:99px;position:relative;cursor:pointer;border:none;flex-shrink:0;}
  .ff-toggle.on{background:#f97316;}
  .ff-toggle::after{content:'';position:absolute;width:15px;height:15px;background:white;border-radius:50%;top:3px;left:3px;transition:left .2s;}
  .ff-toggle.on::after{left:20px;}
  .ff-paytype{flex:1;padding:7px 4px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;border:none;background:rgba(255,255,255,.06);color:#94a3b8;}
  .ff-paytype.active{background:#f59e0b;color:#000;}

  @keyframes ffspin{to{transform:rotate(360deg)}}
  .ff-spin{display:inline-block;animation:ffspin .7s linear infinite;}

  .ff-toasts{position:fixed;bottom:calc(var(--nav-h,62px) + env(safe-area-inset-bottom,0px) + 12px);right:12px;z-index:9999;display:flex;flex-direction:column;gap:6px;}
  .ff-toast{background:#131c28;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 16px;font-size:12px;font-weight:600;color:#e2e8f0;max-width:320px;}
  .ff-toast.success{border-color:rgba(16,185,129,.3);background:rgba(16,185,129,.08);color:#10b981;}
  .ff-toast.error{border-color:rgba(244,63,94,.3);background:rgba(244,63,94,.08);color:#f43f5e;}
`;

function badgeForCourier(courier) {
  if (courier === 'gls') return <span className="ff-badge ff-badge-blue">🚚 GLS</span>;
  if (courier === 'sameday') return <span className="ff-badge ff-badge-blue">🚀 Sameday</span>;
  if (courier && courier !== 'unknown') return <span className="ff-badge ff-badge-gray">{courier}</span>;
  return null;
}

function OrderCard({ order, addrCheck, catalog, onOpenAwb, onOpenInvoice, waTemplate }) {
  const ready = order.hasInvoice && !!order.trackingNo;
  const hasAddrIssues = !!(addrCheck && addrCheck.valid === false);
  const waLink = buildWaLink({ name: order.name, client: order.client, total: order.total, prods: order.prods, phone: order.phone }, waTemplate);

  return (
    <div className={`ff-card${ready ? ' ready' : ''}${hasAddrIssues ? ' issue' : ''}`}>
      <div className="ff-card-top">
        <div>
          <div className="ff-card-client">{order.client || 'Fără nume'}</div>
          <div className="ff-card-addr">{order.address}, {order.oras} {order.zip && `(${order.zip})`}{order.county ? `, ${order.county}` : ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="ff-card-name">{order.name}</div>
          <div className="ff-card-date">{(order.createdAt || '').slice(0, 10)}</div>
        </div>
      </div>

      <div className="ff-badges">
        {ready
          ? <span className="ff-badge ff-badge-ok">✓ Gata de ambalat</span>
          : <span className="ff-badge ff-badge-gray">⏳ De procesat</span>}
        {order.fin === 'paid'
          ? <span className="ff-badge ff-badge-blue">💳 Plătit</span>
          : <span className="ff-badge ff-badge-warn">💵 Ramburs {fmt(order.total)} {order.currency}</span>}
        {order.hasInvoice && <span className="ff-badge ff-badge-ok">🧾 {order.invoiceNumber}</span>}
        {order.trackingNo && <span className="ff-badge ff-badge-ok">📦 {order.trackingNo}</span>}
        {badgeForCourier(order.courier)}
        {hasAddrIssues && <span className="ff-badge ff-badge-warn">⚠ Adresă</span>}
      </div>

      {hasAddrIssues && (
        <div className="ff-addr-issues">
          {(addrCheck.issues || []).map((iss, i) => <div key={i}>⚠ {iss.msg || iss}</div>)}
          {addrCheck.suggestion?.zipMessage && <div>{addrCheck.suggestion.zipMessage}</div>}
        </div>
      )}

      <div className="ff-items">
        {(order.items || []).map((it, i) => {
          const img = catalog.getImage(it);
          return (
            <div className="ff-item" key={i}>
              {img?.image
                ? <img className="ff-item-img" src={img.image} alt="" />
                : <div className="ff-item-placeholder">📦</div>}
              <div>
                <div className="ff-item-name">{it.name}</div>
                <div className="ff-item-meta">×{it.qty} {it.sku && `· SKU ${it.sku}`} {it.price ? `· ${fmt(it.price)} RON` : ''}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="ff-actions">
        {order.hasInvoice
          ? <a className="ff-btn ff-btn-green" href={order.invoiceUrl} target="_blank" rel="noopener noreferrer">🧾 Vezi factură</a>
          : <button className="ff-btn ff-btn-primary" onClick={() => onOpenInvoice(order)}>🧾 Creează factură</button>}

        {order.trackingNo
          ? (order.courier === 'gls'
              ? <button className="ff-btn ff-btn-green" onClick={() => onOpenAwb(order)}>📦 AWB ({order.trackingNo})</button>
              : <a className="ff-btn ff-btn-green" href={`https://gls-group.eu/RO/ro/urmarire-colet?match=${order.trackingNo}`} target="_blank" rel="noopener noreferrer">📍 Track {order.trackingNo}</a>)
          : <button className="ff-btn ff-btn-primary" onClick={() => onOpenAwb(order)}>🚚 Creează AWB</button>}

        {order.phone && <a className="ff-btn ff-btn-ghost" href={`tel:${order.phone}`}>📞 Sună</a>}
        {order.phone && <a className="ff-btn ff-btn-ghost" href={`sms:${order.phone}`}>💬 SMS</a>}
        {waLink && <a className="ff-btn ff-btn-ghost" href={waLink} target="_blank" rel="noopener noreferrer">🟢 WhatsApp</a>}
      </div>
    </div>
  );
}

export default function FulfillmentPage() {
  const { currentShop } = useShopStore();
  const { toasts, toast } = useToast();
  const catalog = useProductImages(currentShop);

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [tab, setTab] = useState('todo');
  const [search, setSearch] = useState('');
  const [addrChecks, setAddrChecks] = useState({}); // orderId -> validation result
  const [awbOrder, setAwbOrder] = useState(null);
  const [invoiceOrder, setInvoiceOrder] = useState(null);

  const load = useCallback(() => {
    if (!currentShop) return;
    setLoading(true); setError(''); setWarning('');
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    fetch(`/api/orders-server?shop=${currentShop}&created_at_min=${from}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        if (data.warning) setWarning(data.warning);
        setOrders(data.orders || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentShop]);

  useEffect(() => { load(); }, [load]);

  // Validare adresă în fundal, în loturi mici, ca să nu blocheze UI-ul.
  useEffect(() => {
    if (!orders.length) return;
    let cancelled = false;
    const toCheck = orders.filter(o => o.ts !== 'anulat' && !addrChecks[o.id]);

    (async () => {
      for (let i = 0; i < toCheck.length; i += 3) {
        if (cancelled) return;
        const batch = toCheck.slice(i, i + 3);
        const results = await Promise.all(batch.map(o =>
          fetch('/api/validate-address', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: o.client, address: o.address, city: o.oras, county: o.county, zip: o.zip, phone: o.phone, email: o.clientEmail, skipEmpty: true }),
          }).then(r => r.json()).catch(() => null)
        ));
        if (cancelled) return;
        setAddrChecks(prev => {
          const next = { ...prev };
          batch.forEach((o, idx) => {
            if (results[idx] && typeof results[idx].valid === 'boolean') next[o.id] = results[idx];
          });
          return next;
        });
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const withStatus = useMemo(() => orders.map(o => ({
    ...o,
    _ready: o.hasInvoice && !!o.trackingNo,
    _cancelled: o.ts === 'anulat',
  })), [orders]);

  const filtered = useMemo(() => {
    let list = withStatus;
    if (tab === 'todo') list = list.filter(o => !o._cancelled && !o._ready);
    else if (tab === 'ready') list = list.filter(o => o._ready);
    else if (tab === 'address') list = list.filter(o => !o._cancelled && addrChecks[o.id] && !addrChecks[o.id].valid);
    // 'all' — fără filtrare

    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(o =>
        (o.name || '').toLowerCase().includes(s) ||
        (o.client || '').toLowerCase().includes(s) ||
        (o.phone || '').includes(s) ||
        (o.oras || '').toLowerCase().includes(s) ||
        (o.trackingNo || '').includes(s));
    }
    return list;
  }, [withStatus, tab, addrChecks, search]);

  const kpis = useMemo(() => ({
    todo: withStatus.filter(o => !o._cancelled && !o._ready).length,
    ready: withStatus.filter(o => o._ready).length,
    address: withStatus.filter(o => !o._cancelled && addrChecks[o.id] && !addrChecks[o.id].valid).length,
    total: withStatus.length,
  }), [withStatus, addrChecks]);

  const handleAwbSuccess = (order, data) => {
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, trackingNo: data.awb, courier: data.courier || 'gls' } : o));
    setAwbOrder(null);
  };

  const handleInvoiceSuccess = (order, data) => {
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, hasInvoice: true, invoiceNumber: `${data.series}${data.number}`, invoiceUrl: data.downloadUrl } : o));
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ff-page">
        <div className="ff-hdr">
          <div className="ff-hdr-inner">
            <div className="ff-logo">📦</div>
            <div className="ff-title">
              <h1>Fulfillment</h1>
              <p>Procesare & ambalare comenzi</p>
            </div>
          </div>
        </div>

        <div className="ff-kpis">
          <div className="ff-kpi" style={{ '--kc': '#f59e0b' }} onClick={() => setTab('todo')}>
            <div className="ff-kpi-v">{kpis.todo}</div>
            <div className="ff-kpi-l">De procesat</div>
          </div>
          <div className="ff-kpi" style={{ '--kc': '#10b981' }} onClick={() => setTab('ready')}>
            <div className="ff-kpi-v">{kpis.ready}</div>
            <div className="ff-kpi-l">Gata de ambalat</div>
          </div>
          <div className="ff-kpi" style={{ '--kc': '#f43f5e' }} onClick={() => setTab('address')}>
            <div className="ff-kpi-v">{kpis.address}</div>
            <div className="ff-kpi-l">Probleme adresă</div>
          </div>
          <div className="ff-kpi" style={{ '--kc': '#60a5fa' }} onClick={() => setTab('all')}>
            <div className="ff-kpi-v">{kpis.total}</div>
            <div className="ff-kpi-l">Total (30 zile)</div>
          </div>
        </div>

        {warning && <div className="ff-warn-banner">⚠️ {warning}</div>}
        {error && <div className="ff-errbox" style={{ marginBottom: 14 }}>❌ {error}</div>}

        <div className="ff-tabs">
          {[
            { id: 'todo', label: `⏳ De procesat (${kpis.todo})` },
            { id: 'ready', label: `✅ Gata de ambalat (${kpis.ready})` },
            { id: 'address', label: `⚠️ Probleme adresă (${kpis.address})` },
            { id: 'all', label: `📋 Toate (${kpis.total})` },
          ].map(t => (
            <button key={t.id} className={`ff-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        <input className="ff-search" placeholder="🔍 Caută #comandă, client, telefon, AWB..." value={search} onChange={e => setSearch(e.target.value)} />

        {loading ? (
          <div className="ff-empty">Se încarcă...</div>
        ) : filtered.length === 0 ? (
          <div className="ff-empty">
            <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
            <div>Nicio comandă în această categorie.</div>
          </div>
        ) : (
          filtered.map(o => (
            <OrderCard
              key={o.id}
              order={o}
              addrCheck={addrChecks[o.id]}
              catalog={catalog}
              onOpenAwb={setAwbOrder}
              onOpenInvoice={setInvoiceOrder}
            />
          ))
        )}
      </div>

      {awbOrder && (
        <AwbModal
          order={awbOrder}
          onClose={() => setAwbOrder(null)}
          onSuccess={data => handleAwbSuccess(awbOrder, data)}
          toast={toast}
        />
      )}

      {invoiceOrder && (
        <InvoiceModal
          order={invoiceOrder}
          shopKey={currentShop}
          onClose={() => setInvoiceOrder(null)}
          onSuccess={data => { handleInvoiceSuccess(invoiceOrder, data); }}
          toast={toast}
        />
      )}

      <div className="ff-toasts">
        {toasts.map(t => <div key={t.id} className={`ff-toast ${t.type}`}>{t.msg}</div>)}
      </div>
    </>
  );
}
