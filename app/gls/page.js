'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

/* ══════════════════════════════════════════════════════════════
   GLS AWB Manager — GLAMX Dashboard
   Full-featured: Generate, Manage, Download, Track, Bulk print
══════════════════════════════════════════════════════════════ */

const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { if (typeof window !== 'undefined') localStorage.removeItem(k); } catch {} },
};

function getShopKey() {
  try {
    const s = typeof window !== 'undefined' ? localStorage.getItem('glamx-shop') : null;
    const p = s ? JSON.parse(s) : null;
    return p?.state?.currentShop || 'ro';
  } catch { return 'ro'; }
}
const ordersKey = (sk) => sk === 'ro' ? 'gx_orders_all' : `gx_orders_all_${sk}`;

const pad = n => String(n).padStart(2, '0');
const fmtD = d => { if (!d) return '—'; try { const p = (d.split('T')[0]).split('-'); return `${p[2]}.${p[1]}.${p[0]}`; } catch { return d.slice(0, 10); } };
const fmt = n => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── GLS Services catalog ─────────────────────────────────────────────────────
const GLS_SERVICES = {
  SM1: { code: 'SM1', label: '📱 SMS Livrare',       desc: 'SMS trimis destinatarului la livrare',      param: 'phone',  group: 'Notificări' },
  SM2: { code: 'SM2', label: '📧 SMS + Email',        desc: 'Notificare SMS și email la livrare',        param: 'email',  group: 'Notificări' },
  FDS: { code: 'FDS', label: '🕐 FlexDelivery Email', desc: 'Destinatarul alege ora/locul via email',    param: 'email',  group: 'Flex' },
  FSS: { code: 'FSS', label: '💬 FlexDelivery SMS',  desc: 'Destinatarul alege ora/locul via SMS',      param: 'phone',  group: 'Flex' },
  SAT: { code: 'SAT', label: '📅 Livrare Sâmbătă',   desc: 'Garantat livrat sâmbătă',                   param: null,     group: 'Livrare' },
  T12: { code: 'T12', label: '⏰ Până 12:00',         desc: 'Garantat livrat înainte de prânz',          param: null,     group: 'Livrare' },
  AOS: { code: 'AOS', label: '✍️ Semnătură',          desc: 'Confirmare livrare prin semnătură',         param: null,     group: 'Livrare' },
  DPV: { code: 'DPV', label: '🏠 Adresă privată',    desc: 'Livrare numai la adresa destinatarului',    param: null,     group: 'Livrare' },
  INS: { code: 'INS', label: '🛡️ Asigurare',          desc: 'Asigurare pentru valoarea declarată',       param: 'value',  group: 'Extra' },
  SDS: { code: 'SDS', label: '↩️ Shop Return',        desc: 'Return facilitat prin shop GLS',            param: null,     group: 'Extra' },
};

const SERVICE_GROUPS = ['Notificări', 'Flex', 'Livrare', 'Extra'];

function validateAddr(a) {
  const issues = [];
  if (!a.name || a.name.trim().length < 3) issues.push('Nume destinatar lipsă');
  if (!a.address || a.address.trim().length < 5) issues.push('Adresa stradală incompletă');
  if (!a.city || a.city.trim().length < 2) issues.push('Orașul lipsește');
  if (!a.zip || !/^\d{6}$/.test((a.zip || '').replace(/\s/g, ''))) issues.push('Cod poștal invalid (6 cifre)');
  const digits = (a.phone || '').replace(/\D/g, '');
  if (!digits || digits.length < 9) issues.push('Telefon invalid');
  return issues;
}

function procOrder(o) {
  // ── Support BOTH raw Shopify orders AND pre-processed glamx orders ──────────
  // Pre-processed orders (from main dashboard localStorage) already have flat fields
  const isProcessed = !!(o.client !== undefined && o.fin !== undefined && !o.financial_status);

  if (isProcessed) {
    // Already processed by main dashboard — just enrich with GLS detection
    const tc = (o.courier || o.trackingCompany || '').toLowerCase();
    const trackingNo = o.trackingNo || o.tracking_number || '';
    const isGLS = tc.includes('gls') || tc.includes('mygls') ||
      (o.trackingNo && !tc) || // has tracking but courier unknown = likely GLS
      false;
    return {
      ...o,
      id: String(o.id || ''),
      trackingNo,
      isGLS,
      addrIssues: validateAddr({
        name: o.client, address: o.address,
        city: o.city, zip: o.zip, phone: o.phone,
      }),
    };
  }

  // ── Raw Shopify order ────────────────────────────────────────────────────────
  const addr = o.shipping_address || o.billing_address || {};

  // Find best fulfillment — prefer GLS, then last
  const fulfillments = o.fulfillments || [];
  const glsFulfillment = fulfillments.find(f => {
    const tc = (f.tracking_company || '').toLowerCase();
    return tc.includes('gls') || tc.includes('mygls');
  });
  const fulfillmentData = glsFulfillment || fulfillments[fulfillments.length - 1] || null;

  const trackingNo = fulfillmentData?.tracking_number || '';
  const tc = (fulfillmentData?.tracking_company || '').toLowerCase();
  const isGLS = tc.includes('gls') || tc.includes('mygls') ||
    (trackingNo && /^\d{10,13}$/.test(trackingNo.replace(/\s/g, '')));

  const isFulfilled = (o.fulfillment_status || '').toLowerCase() === 'fulfilled';

  const isOnlinePay = ['shopify_payments','stripe','paypal','card'].some(g =>
    (o.payment_gateway || '').toLowerCase().includes(g)
  );
  const isCOD = !isOnlinePay && (
    (o.financial_status || '') === 'pending' ||
    (o.payment_gateway || '').toLowerCase().includes('cod') ||
    (o.payment_gateway || '').toLowerCase().includes('cash') ||
    (o.payment_gateway || '').toLowerCase().includes('ramburs')
  );

  const lineItems = o.line_items || [];
  const notes = o.note_attributes || [];

  // Total: try total_price, then subtotal, then sum line items
  let total = parseFloat(o.total_price || 0);
  if (!total) total = parseFloat(o.subtotal_price || 0);
  if (!total) total = lineItems.reduce((s, i) => s + parseFloat(i.price || 0) * (i.quantity || 1), 0);

  const clientName = addr.name ||
    [addr.first_name, addr.last_name].filter(Boolean).join(' ') ||
    o.customer?.first_name && (o.customer.first_name + ' ' + (o.customer.last_name || '')).trim() ||
    '';

  const phone = (o.phone || addr.phone || o.customer?.phone || '').replace(/\s/g, '');

  return {
    id: String(o.id || ''),
    name: o.name || '',
    client: clientName,
    phone,
    email: o.email || o.customer?.email || '',
    address: addr.address1 || '',
    address2: addr.address2 || '',
    city: addr.city || '',
    county: addr.province || addr.province_code || '',
    zip: (addr.zip || '').replace(/\s/g, ''),
    fin: (o.financial_status || '').toLowerCase(),
    fulfillmentStatus: (o.fulfillment_status || '').toLowerCase(),
    isFulfilled,
    createdAt: o.created_at || '',
    total,
    currency: o.currency || 'RON',
    gateway: o.payment_gateway || '',
    trackingNo,
    isGLS,
    isCOD,
    items: lineItems.map(i => ({ name: i.name || '', sku: i.sku || '', qty: i.quantity || 1, price: parseFloat(i.price || 0) })),
    prods: lineItems.map(i => i.name).join(', '),
    addrIssues: validateAddr({ name: clientName, address: addr.address1, city: addr.city, zip: addr.zip, phone }),
  };
}

function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  }, []);
  return { toasts, add };
}

// ── Saved AWBs local storage ──────────────────────────────────────────────────
const awbStore = {
  key: 'gx_gls_awbs',
  get: () => { try { const s = ls.get('gx_gls_awbs'); return s ? JSON.parse(s) : {}; } catch { return {}; } },
  set: (map) => { try { ls.set('gx_gls_awbs', JSON.stringify(map)); } catch {} },
  save: (orderId, data) => { const m = awbStore.get(); m[orderId] = { ...data, savedAt: new Date().toISOString() }; awbStore.set(m); },
  remove: (orderId) => { const m = awbStore.get(); delete m[orderId]; awbStore.set(m); },
};

// ── GLS Config — loaded from server ENV, never stored client-side ─────────────
// No credential storage on client. All auth happens server-side via ENV vars.

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap');

  .gls-page{max-width:1400px;margin:0 auto;padding:12px 12px 120px;font-family:'DM Sans',system-ui,sans-serif;}
  
  /* ─── Header ─── */
  .gls-hdr{position:sticky;top:0;z-index:200;background:rgba(7,9,14,.97);backdrop-filter:blur(24px) saturate(180%);border-bottom:1px solid rgba(255,255,255,.06);padding:0 16px;margin-bottom:16px;}
  .gls-hdr-inner{display:flex;align-items:center;gap:10px;padding:12px 0;flex-wrap:wrap;}
  .gls-logo-badge{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#f97316,#dc2626);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;box-shadow:0 4px 16px rgba(249,115,22,.35);}
  .gls-title{flex:1;min-width:0;}
  .gls-title h1{font-size:16px;font-weight:800;letter-spacing:-.5px;color:#f1f5f9;}
  .gls-title p{font-size:10px;color:#475569;margin-top:1px;}
  
  /* ─── KPI Strip ─── */
  .gls-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px;}
  @media(min-width:600px){.gls-kpis{grid-template-columns:repeat(4,1fr);}}
  .gls-kpi{background:#0c1018;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:14px 16px;position:relative;overflow:hidden;cursor:pointer;transition:border-color .15s,transform .1s;}
  .gls-kpi:hover{border-color:rgba(249,115,22,.3);transform:translateY(-1px);}
  .gls-kpi::before{content:'';position:absolute;inset:0;background:var(--kpi-glow,transparent);opacity:.04;pointer-events:none;}
  .gls-kpi-v{font-size:28px;font-weight:800;letter-spacing:-1.5px;font-family:'Space Grotesk',monospace;color:var(--kpi-color,#e2e8f0);}
  .gls-kpi-l{font-size:10px;color:#475569;margin-top:3px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;}
  .gls-kpi-icon{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:24px;opacity:.15;}
  
  /* ─── Tab Bar ─── */
  .gls-tabs{display:flex;gap:4px;margin-bottom:14px;background:#0a0e14;padding:4px;border-radius:12px;border:1px solid rgba(255,255,255,.05);}
  .gls-tab{flex:1;padding:8px 4px;border-radius:8px;border:none;background:transparent;color:#475569;font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:inherit;}
  .gls-tab.active{background:linear-gradient(135deg,rgba(249,115,22,.15),rgba(220,38,38,.1));color:#f97316;border:1px solid rgba(249,115,22,.25);}
  .gls-tab:hover:not(.active){color:#94a3b8;}
  
  /* ─── Panels / Cards ─── */
  .gls-panel{background:#0c1018;border:1px solid rgba(255,255,255,.06);border-radius:14px;overflow:hidden;margin-bottom:12px;}
  .gls-panel-hdr{padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.05);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}
  .gls-panel-title{font-size:13px;font-weight:700;color:#e2e8f0;display:flex;align-items:center;gap:6px;}
  .gls-panel-sub{font-size:10px;color:#475569;margin-top:1px;}
  
  /* ─── Settings / Credentials ─── */
  .gls-cred-grid{display:grid;grid-template-columns:1fr;gap:10px;padding:16px 18px;}
  @media(min-width:600px){.gls-cred-grid{grid-template-columns:1fr 1fr;}}
  .gls-field{display:flex;flex-direction:column;gap:5px;}
  .gls-field.full{grid-column:1/-1;}
  .gls-lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:700;}
  .gls-inp{background:#080d12;border:1px solid #1a2535;color:#e2e8f0;padding:10px 13px;border-radius:8px;font-size:13px;font-family:'Space Grotesk',monospace;outline:none;width:100%;transition:border-color .15s,box-shadow .15s;}
  .gls-inp:focus{border-color:#f97316;box-shadow:0 0 0 3px rgba(249,115,22,.12);}
  .gls-inp.ok{border-color:#10b981;}
  .gls-inp.err{border-color:#f43f5e;}
  .gls-hint{font-size:10px;color:#334155;margin-top:3px;line-height:1.5;}
  
  /* ─── Services Selector ─── */
  .gls-svc-group-title{font-size:9px;font-weight:800;color:#334155;text-transform:uppercase;letter-spacing:1px;padding:8px 0 5px;}
  .gls-svc-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;}
  @media(min-width:700px){.gls-svc-grid{grid-template-columns:repeat(3,1fr);}}
  .gls-svc-card{background:#080d12;border:1.5px solid rgba(255,255,255,.05);border-radius:10px;padding:10px 12px;cursor:pointer;transition:all .15s;display:flex;gap:9px;align-items:flex-start;}
  .gls-svc-card:hover{border-color:rgba(255,255,255,.15);}
  .gls-svc-card.active{border-color:#f97316;background:rgba(249,115,22,.07);}
  .gls-svc-chk{width:17px;height:17px;border-radius:5px;border:2px solid #243040;flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;transition:all .15s;font-size:9px;}
  .gls-svc-card.active .gls-svc-chk{background:#f97316;border-color:#f97316;color:white;}
  .gls-svc-body{flex:1;min-width:0;}
  .gls-svc-name{font-size:11px;font-weight:700;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .gls-svc-desc{font-size:9px;color:#475569;margin-top:2px;line-height:1.4;}
  .gls-svc-input{margin-top:7px;}
  
  /* ─── Filters ─── */
  .gls-filters{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.04);display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
  .gls-fb{background:#080d12;border:1px solid #1a2535;color:#64748b;padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;transition:all .12s;white-space:nowrap;font-family:inherit;}
  .gls-fb.active{background:rgba(249,115,22,.15);border-color:rgba(249,115,22,.4);color:#f97316;}
  .gls-fb:hover:not(.active){border-color:#334155;color:#94a3b8;}
  .gls-search{flex:1;min-width:140px;background:#080d12;border:1px solid #1a2535;color:#e2e8f0;padding:7px 11px;border-radius:8px;font-size:12px;outline:none;font-family:inherit;}
  .gls-search:focus{border-color:#f97316;}
  
  /* ─── Table ─── */
  .gls-scroll{overflow-x:auto;}
  .gls-tbl{width:100%;border-collapse:collapse;min-width:800px;}
  .gls-tbl thead th{padding:8px 12px;text-align:left;font-size:9px;font-weight:800;color:#1e3a5f;text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid rgba(255,255,255,.04);white-space:nowrap;}
  .gls-tbl tbody tr{border-bottom:1px solid rgba(255,255,255,.03);transition:background .1s;cursor:pointer;}
  .gls-tbl tbody tr:hover{background:rgba(255,255,255,.02);}
  .gls-tbl tbody td{padding:10px 12px;font-size:12px;vertical-align:middle;}
  .gls-row-selected{background:rgba(249,115,22,.05)!important;border-left:2px solid rgba(249,115,22,.5);}
  .gls-row-hasawb{background:rgba(16,185,129,.02);}
  .gls-row-issues{background:rgba(245,158,11,.03);}
  
  /* ─── Badges ─── */
  .gls-badge{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap;}
  .gls-badge-ok{background:rgba(16,185,129,.1);color:#10b981;border:1px solid rgba(16,185,129,.2);}
  .gls-badge-warn{background:rgba(245,158,11,.1);color:#f59e0b;border:1px solid rgba(245,158,11,.2);}
  .gls-badge-err{background:rgba(244,63,94,.1);color:#f43f5e;border:1px solid rgba(244,63,94,.2);}
  .gls-badge-gls{background:rgba(249,115,22,.12);color:#f97316;border:1px solid rgba(249,115,22,.25);}
  .gls-badge-blue{background:rgba(59,130,246,.1);color:#60a5fa;border:1px solid rgba(59,130,246,.2);}
  .gls-badge-purple{background:rgba(168,85,247,.1);color:#c084fc;border:1px solid rgba(168,85,247,.2);}
  .gls-awbn{font-family:'Space Grotesk',monospace;font-size:11px;color:#10b981;font-weight:700;letter-spacing:.5px;}
  
  /* ─── Buttons ─── */
  .gls-btn{display:inline-flex;align-items:center;gap:5px;padding:8px 16px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;transition:all .12s;font-family:inherit;white-space:nowrap;}
  .gls-btn-primary{background:linear-gradient(135deg,#f97316,#ea580c);color:white;box-shadow:0 3px 12px rgba(249,115,22,.3);}
  .gls-btn-primary:hover:not(:disabled){background:linear-gradient(135deg,#fb923c,#f97316);box-shadow:0 4px 16px rgba(249,115,22,.4);}
  .gls-btn-ghost{background:rgba(255,255,255,.05);color:#94a3b8;border:1px solid rgba(255,255,255,.1);}
  .gls-btn-ghost:hover{background:rgba(255,255,255,.08);color:#e2e8f0;}
  .gls-btn-green{background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.25);}
  .gls-btn-green:hover:not(:disabled){background:rgba(16,185,129,.25);}
  .gls-btn-blue{background:rgba(59,130,246,.15);color:#60a5fa;border:1px solid rgba(59,130,246,.25);}
  .gls-btn-blue:hover{background:rgba(59,130,246,.25);}
  .gls-btn-red{background:rgba(244,63,94,.1);color:#f43f5e;border:1px solid rgba(244,63,94,.2);}
  .gls-btn-red:hover{background:rgba(244,63,94,.2);}
  .gls-btn-sm{padding:4px 10px;font-size:10px;border-radius:6px;}
  .gls-btn:disabled{opacity:.4;cursor:not-allowed;}
  
  /* ─── Action group in table ─── */
  .gls-act-grp{display:flex;gap:4px;align-items:center;flex-wrap:wrap;}
  
  /* ─── Bulk action bar ─── */
  .gls-bulk-bar{position:sticky;bottom:calc(var(--nav-h,62px) + env(safe-area-inset-bottom,0px));z-index:150;background:#0f1623;border:1px solid rgba(249,115,22,.3);border-radius:12px;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;box-shadow:0 8px 32px rgba(0,0,0,.5),0 0 0 1px rgba(249,115,22,.1);backdrop-filter:blur(20px);}
  .gls-bulk-count{font-size:13px;font-weight:800;color:#f97316;flex:1;}
  
  /* ─── Modal Overlay ─── */
  .gls-overlay{position:fixed;inset:0;background:rgba(0,0,0,.87);z-index:500;display:flex;align-items:flex-end;justify-content:center;padding:0;backdrop-filter:blur(6px);}
  @media(min-width:640px){.gls-overlay{align-items:center;padding:16px;}}
  .gls-modal{background:#0d1219;border:1px solid rgba(255,255,255,.1);width:100%;max-height:95dvh;overflow-y:auto;position:relative;}
  @media(min-width:640px){.gls-modal{border-radius:16px;max-width:640px;}}
  .gls-modal-hdr{padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:flex-start;justify-content:space-between;position:sticky;top:0;background:#0d1219;z-index:10;}
  .gls-modal-title{font-size:15px;font-weight:800;letter-spacing:-.3px;}
  .gls-modal-sub{font-size:11px;color:#475569;margin-top:3px;}
  .gls-modal-close{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:#64748b;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;transition:all .12s;}
  .gls-modal-close:hover{background:rgba(255,255,255,.12);color:#e2e8f0;}
  .gls-modal-body{padding:18px 20px;display:flex;flex-direction:column;gap:14px;}
  .gls-modal-ftr{padding:14px 20px;border-top:1px solid rgba(255,255,255,.07);display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:0;background:#0d1219;}
  
  /* ─── Boxes ─── */
  .gls-okbox{background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:10px;padding:16px;text-align:center;}
  .gls-okbox-awb{font-family:'Space Grotesk',monospace;font-size:28px;font-weight:800;color:#10b981;letter-spacing:2px;margin:6px 0;}
  .gls-errbox{background:rgba(244,63,94,.07);border:1px solid rgba(244,63,94,.25);border-radius:8px;padding:12px 14px;font-size:12px;color:#f43f5e;line-height:1.6;}
  .gls-warnbox{background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:12px 14px;font-size:12px;color:#f59e0b;line-height:1.6;}
  .gls-infobox{background:#060b10;border:1px solid rgba(255,255,255,.05);border-radius:8px;padding:12px 14px;font-size:12px;color:#64748b;line-height:1.7;}
  .gls-infobox2{background:rgba(59,130,246,.05);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:12px 14px;font-size:12px;color:#93c5fd;line-height:1.6;}
  
  /* ─── Progress ─── */
  .gls-progress-wrap{background:#1a2535;border-radius:99px;height:5px;overflow:hidden;}
  .gls-progress-bar{height:100%;background:linear-gradient(90deg,#f97316,#ea580c);border-radius:99px;transition:width .3s;}
  
  /* ─── Toggle ─── */
  .gls-toggle{width:38px;height:21px;background:#1a2535;border-radius:99px;position:relative;cursor:pointer;transition:background .2s;border:none;flex-shrink:0;}
  .gls-toggle.on{background:#f97316;}
  .gls-toggle::after{content:'';position:absolute;width:15px;height:15px;background:white;border-radius:50%;top:3px;left:3px;transition:left .2s;box-shadow:0 1px 4px rgba(0,0,0,.4);}
  .gls-toggle.on::after{left:20px;}
  
  /* ─── AWB Card in list ─── */
  .gls-awb-card{background:#080d12;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;}
  .gls-awb-card-row{display:flex;align-items:center;justify-content:space-between;gap:8px;}
  .gls-awb-num{font-family:'Space Grotesk',monospace;font-size:20px;font-weight:800;color:#f97316;letter-spacing:1px;}
  
  /* ─── Connection Status ─── */
  .gls-conn{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;}
  .gls-conn-dot{width:7px;height:7px;border-radius:50%;}
  .gls-conn-dot.ok{background:#10b981;box-shadow:0 0 6px #10b981;}
  .gls-conn-dot.err{background:#f43f5e;box-shadow:0 0 6px #f43f5e;}
  .gls-conn-dot.idle{background:#334155;}
  
  /* ─── Spinner ─── */
  @keyframes spin{to{transform:rotate(360deg)}}
  .gls-spin{display:inline-block;animation:spin .7s linear infinite;}
  @keyframes fadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .gls-fadein{animation:fadeInUp .3s ease both;}
  
  /* ─── Divider ─── */
  .gls-divider{height:1px;background:rgba(255,255,255,.05);margin:4px 0;}
  
  /* ─── Grid 2 cols ─── */
  .gls-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  @media(max-width:480px){.gls-grid2{grid-template-columns:1fr;}}
  
  /* ─── Toast ─── */
  .gls-toasts{position:fixed;bottom:calc(var(--nav-h,62px) + env(safe-area-inset-bottom,0px) + 12px);right:12px;z-index:9999;display:flex;flex-direction:column;gap:6px;pointer-events:none;}
  .gls-toast{background:#131c28;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 16px;font-size:12px;font-weight:600;color:#e2e8f0;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:320px;pointer-events:auto;animation:fadeInUp .25s ease;}
  .gls-toast.success{border-color:rgba(16,185,129,.3);background:rgba(16,185,129,.08);color:#10b981;}
  .gls-toast.error{border-color:rgba(244,63,94,.3);background:rgba(244,63,94,.08);color:#f43f5e;}
  .gls-toast.warn{border-color:rgba(245,158,11,.3);background:rgba(245,158,11,.08);color:#f59e0b;}
  
  /* ─── Empty State ─── */
  .gls-empty{text-align:center;padding:48px 20px;color:#334155;}
  .gls-empty-icon{font-size:48px;margin-bottom:12px;opacity:.4;}
  .gls-empty-title{font-size:15px;font-weight:700;color:#475569;margin-bottom:6px;}
  .gls-empty-sub{font-size:12px;color:#334155;}
  
  /* ─── No config banner ─── */
  .gls-noconfig{background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.2);border-radius:12px;padding:20px;text-align:center;margin-bottom:14px;}
  
  /* ─── Tooltip ─── */
  .gls-tooltip-wrap{position:relative;display:inline-flex;}
  
  /* ─── Addr issues ─── */
  .gls-addr-issues{font-size:10px;color:#f59e0b;line-height:1.6;}
  
  /* ─── Tracking Timeline ─── */
  .gls-timeline{display:flex;flex-direction:column;gap:0;}
  .gls-tl-item{display:flex;gap:12px;padding:8px 0;}
  .gls-tl-line{display:flex;flex-direction:column;align-items:center;width:20px;flex-shrink:0;}
  .gls-tl-dot{width:10px;height:10px;border-radius:50%;background:#1a2535;border:2px solid #334155;flex-shrink:0;}
  .gls-tl-dot.active{background:#f97316;border-color:#f97316;box-shadow:0 0 8px rgba(249,115,22,.4);}
  .gls-tl-dot.done{background:#10b981;border-color:#10b981;}
  .gls-tl-bar{flex:1;width:2px;background:#1a2535;margin:2px 0;}
  .gls-tl-content{flex:1;padding-bottom:4px;}
  .gls-tl-event{font-size:12px;font-weight:600;color:#94a3b8;}
  .gls-tl-event.active{color:#f97316;}
  .gls-tl-event.done{color:#10b981;}
  .gls-tl-date{font-size:10px;color:#334155;margin-top:2px;}
  
  /* ─── Bulk progress modal ─── */
  .gls-bulk-progress-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);}
  .gls-bulk-progress-item:last-child{border-bottom:none;}
  .gls-bulk-status-icon{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;}
  .gls-bulk-status-ok{background:rgba(16,185,129,.15);color:#10b981;}
  .gls-bulk-status-err{background:rgba(244,63,94,.15);color:#f43f5e;}
  .gls-bulk-status-pend{background:rgba(255,255,255,.06);color:#475569;}
  .gls-bulk-status-proc{background:rgba(249,115,22,.15);color:#f97316;}
  
  /* ─── Col visibility on small screens ─── */
  @media(max-width:900px){
    .gls-col-hide{display:none!important;}
  }
`;

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function GLSPage() {
  const [tab, setTab] = useState('orders'); // orders | awbs | settings | stats
  const { toasts, add: toast } = useToast();

  // ── GLS Config (from Vercel ENV, fetched server-side) ──
  // No credentials stored on client — all auth is ENV-only on server
  const [glsConfig, setGlsConfig] = useState(null); // null = loading, false = not configured, obj = config
  const [configLoading, setConfigLoading] = useState(true);

  // ── Orders ──
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('pending'); // all | pending | hasawb | issues | cod | online
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(0);

  // ── AWB data ──
  const [awbMap, setAwbMap] = useState({}); // orderId → { awb, labelBase64, ... }

  // ── Modal state ──
  const [awbModal, setAwbModal] = useState(null); // order to create AWB for
  const [trackModal, setTrackModal] = useState(null); // { awb, order }
  const [bulkModal, setBulkModal] = useState(null); // bulk progress

  // ── Download state ──
  const [downloadingAwb, setDownloadingAwb] = useState(null); // awb string being downloaded

  // ── AWB form ──
  const [weight, setWeight] = useState('1');
  const [parcels, setParcels] = useState('1');
  const [content, setContent] = useState('');
  const [observation, setObservation] = useState('');
  const [selectedServices, setSelectedServices] = useState({});
  const [editAddr, setEditAddr] = useState(null);
  const [awbLoading, setAwbLoading] = useState(false);
  const [awbResult, setAwbResult] = useState(null); // last result

  // ── Settings form ──
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Parcel History (from GLS API) ──
  const [glsParcels, setGlsParcels] = useState([]);
  const [glsParcelsLoading, setGlsParcelsLoading] = useState(false);
  const [glsParcelsErr, setGlsParcelsErr] = useState('');
  const [glsDays, setGlsDays] = useState(30);

  const loadGlsParcels = async () => {
    if (!glsConfig?.configured) { toast('GLS neconfigurat în Vercel ENV', 'error'); return; }
    setGlsParcelsLoading(true); setGlsParcelsErr('');
    try {
      // No credentials sent from browser — server uses ENV vars
      const res = await fetch('/api/gls-parcellist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: glsDays }),
      });
      const data = await res.json();
      if (data.ok) { setGlsParcels(data.parcels || []); toast(data.count + ' colete încărcate din GLS', 'success'); }
      else { setGlsParcelsErr(data.error || 'Eroare'); toast('Eroare GLS: ' + (data.error || '?'), 'error'); }
    } catch (e) { setGlsParcelsErr(e.message); }
    finally { setGlsParcelsLoading(false); }
  };


  // ── Bulk ──
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResults, setBulkResults] = useState([]); // { orderId, name, status, awb, error }
  const [bulkDone, setBulkDone] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    // 1. Fetch GLS config status from server (ENV vars — no credentials sent to client)
    setConfigLoading(true);
    fetch('/api/gls-config')
      .then(r => r.json())
      .then(cfg => { setGlsConfig(cfg); setConfigLoading(false); })
      .catch(() => { setGlsConfig({ configured: false, missing: ['API error'] }); setConfigLoading(false); });

    // 2. Load orders from localStorage
    const sk = getShopKey();
    const raw = ls.get(ordersKey(sk));
    if (raw) {
      try {
        const all = JSON.parse(raw);
        const processed = all.map(o => {
          try { return procOrder(o); }
          catch(e) { console.warn('[GLS] procOrder error for', o?.id, e.message); return null; }
        }).filter(Boolean);
        setOrders(processed);
        console.log('[GLS] Loaded', processed.length, 'orders');
      } catch(e) {
        console.error('[GLS] Failed to load orders:', e.message);
      }
    }

    // 3. Load saved AWBs
    setAwbMap(awbStore.get());
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const savedAwbs = Object.values(awbMap);
  const ordersWithStatus = orders.map(o => {
    const awbData = awbMap[o.id] || null;
    // hasAwb: check trackingNo from Shopify fulfillment, local awbMap, OR isFulfilled with GLS
    const effectiveTrackingNo = o.trackingNo || awbData?.awb || '';
    const hasAwb = !!(effectiveTrackingNo) || !!(o.isFulfilled && o.isGLS);
    return {
      ...o,
      awbData,
      hasAwb,
      effectiveTrackingNo,
    };
  });

  const filtered = ordersWithStatus.filter(o => {
    if (filter === 'pending') return !o.hasAwb && o.fin !== 'refunded' && o.fin !== 'cancelled' && !o.isFulfilled;
    if (filter === 'hasawb') return o.hasAwb || (o.isFulfilled && o.isGLS);
    if (filter === 'fulfilled') return o.isFulfilled;
    if (filter === 'issues') return o.addrIssues.length > 0 && !o.hasAwb;
    if (filter === 'cod') return o.isCOD;
    if (filter === 'online') return !o.isCOD;
    return true; // 'all'
  }).filter(o => {
    if (!search) return true;
    const s = search.toLowerCase();
    return o.name.toLowerCase().includes(s) ||
      (o.client || '').toLowerCase().includes(s) ||
      (o.phone || '').includes(s) ||
      (o.city || '').toLowerCase().includes(s) ||
      (o.effectiveTrackingNo || '').includes(s) ||
      (o.awbData?.awb || '').includes(s) ||
      (o.prods || '').toLowerCase().includes(s);
  });

  const PAGE_SIZE = 20;
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // KPIs
  const kpis = {
    total: orders.length,
    pending: ordersWithStatus.filter(o => !o.hasAwb && !o.isFulfilled && o.fin !== 'refunded' && o.fin !== 'cancelled').length,
    hasAwb: ordersWithStatus.filter(o => o.hasAwb || (o.isFulfilled && o.isGLS)).length,
    fulfilled: ordersWithStatus.filter(o => o.isFulfilled).length,
    issues: ordersWithStatus.filter(o => o.addrIssues.length > 0 && !o.hasAwb && !o.isFulfilled).length,
    savedAwbs: savedAwbs.length,
    totalCOD: ordersWithStatus.filter(o => o.isCOD && !o.hasAwb && !o.isFulfilled).reduce((s, o) => s + (o.total || 0), 0),
  };

  // ── Config / Connection ───────────────────────────────────────────────────
  // Credentials live 100% in Vercel ENV — never on client
  const refreshConfig = async () => {
    setConfigLoading(true);
    try {
      const r = await fetch('/api/gls-config');
      const cfg = await r.json();
      setGlsConfig(cfg);
    } catch { setGlsConfig({ configured: false, missing: ['API error'] }); }
    finally { setConfigLoading(false); }
  };

  const testConnection = async () => {
    if (!glsConfig?.configured) { toast('Configureaza GLS_USERNAME și GLS_PASSWORD în Vercel ENV', 'error'); return; }
    try {
      const res = await fetch('/api/gls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No credentials sent — server uses ENV vars
        body: JSON.stringify({ action: 'test_connection' }),
      });
      const data = await res.json();
      if (data.ok) { toast('✅ GLS conectat! ' + (data.message || ''), 'success'); refreshConfig(); }
      else { toast('❌ Eroare GLS: ' + (data.error || '?'), 'error'); }
    } catch (e) { toast('Eroare rețea: ' + e.message, 'error'); }
  };

  // ── Open AWB Modal ─────────────────────────────────────────────────────────
  const openAwbModal = (order) => {
    setAwbModal(order);
    setAwbResult(null);
    setWeight('1');
    setParcels('1');
    setContent(order.prods?.slice(0, 40) || 'Colet');
    setObservation('');
    setSelectedServices({});
    setEditAddr({
      name: order.client, phone: order.phone, email: order.email,
      address: order.address, city: order.city, county: order.county, zip: order.zip,
    });
  };

  // ── Create AWB ─────────────────────────────────────────────────────────────
  // Credentials are 100% server-side (Vercel ENV). Client never sees them.
  const createAWB = async (order, opts = {}) => {
    const addr = opts.addr || editAddr || {};
    const svc  = opts.services || selectedServices;
    const w    = opts.weight   || weight;
    const p    = opts.parcels  || parcels;
    const cnt  = opts.content  || content;

    if (!glsConfig?.configured) {
      return { ok: false, error: 'GLS neconfigurat — adaugă GLS_USERNAME și GLS_PASSWORD în Vercel ENV' };
    }

    // NO username/password sent from browser — server reads them from ENV
    const payload = {
      recipientName: addr.name    || order.client,
      phone:         addr.phone   || order.phone,
      email:         addr.email   || order.email,
      address:       addr.address || order.address,
      city:          addr.city    || order.city,
      county:        addr.county  || order.county,
      zip:           (addr.zip    || order.zip || '').replace(/\s/g, ''),
      weight:        parseFloat(w) || 1,
      parcels:       parseInt(p)  || 1,
      content:       cnt || order.prods?.slice(0, 40) || 'Colet',
      codAmount:     order.isCOD ? order.total : 0,
      codCurrency:   order.currency || 'RON',
      orderName:     order.name,
      orderId:       order.id,
      selectedServices: svc,
      observations:  observation || '',
    };

    const res = await fetch('/api/gls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  };

  const submitAWB = async () => {
    if (!awbModal) return;
    setAwbLoading(true);
    setAwbResult(null);
    try {
      const data = await createAWB(awbModal);
      setAwbResult(data);
      if (data.ok) {
        awbStore.save(awbModal.id, data);
        setAwbMap(awbStore.get());
        toast(`✅ AWB GLS ${data.awb} generat!`, 'success');
      } else {
        toast('Eroare: ' + data.error, 'error');
      }
    } catch (e) {
      setAwbResult({ ok: false, error: e.message });
      toast('Eroare rețea: ' + e.message, 'error');
    } finally {
      setAwbLoading(false);
    }
  };

  // ── b64 → Blob helper ─────────────────────────────────────────────────────
  const b64ToBlob = (b64, mime) => {
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  const triggerPdfDownload = (base64, filename) => {
    const blob = b64ToBlob(base64, 'application/pdf');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // ── Download Label PDF ────────────────────────────────────────────────────
  // Works for: cached PDF, parcelId re-fetch, or AWB number fallback
  const downloadLabel = async (awbData, orderName, fallbackAwb) => {
    const awbNum = awbData?.awb || fallbackAwb || '';
    setDownloadingAwb(awbNum);

    try {
      // 1. Local cache hit → instant download
      if (awbData?.labelBase64) {
        triggerPdfDownload(awbData.labelBase64, `AWB_GLS_${awbNum}_${orderName||''}.pdf`);
        toast('✅ Etichetă descărcată!', 'success');
        return;
      }

      // 2. Have parcelId → GetPrintedLabels (correct API call)
      if (awbData?.parcelId) {
        toast('⏳ Se descarcă eticheta din GLS...', 'info');
        const res = await fetch('/api/gls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_label', parcelId: awbData.parcelId, awb: awbNum }),
        });
        const data = await res.json();
        if (data.ok && data.labelBase64) {
          const updated = { ...awbData, labelBase64: data.labelBase64 };
          awbStore.save(awbData.orderId || awbNum, updated);
          setAwbMap(awbStore.get());
          triggerPdfDownload(data.labelBase64, `AWB_GLS_${awbNum}_${orderName||''}.pdf`);
          toast('✅ Etichetă descărcată!', 'success');
          return;
        }
        // Fall through to AWB number method if parcelId fails
        console.warn('[GLS] parcelId method failed:', data.error);
      }

      // 3. Fallback: fetch by AWB number (for old AWBs from Shopify without parcelId)
      if (awbNum) {
        toast('⏳ Se descarcă eticheta (AWB number)...', 'info');
        const res = await fetch('/api/gls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_label_by_awb', awb: awbNum }),
        });
        const data = await res.json();
        if (data.ok && data.labelBase64) {
          if (awbData) {
            const updated = { ...awbData, labelBase64: data.labelBase64, parcelId: data.parcelId || awbData.parcelId };
            awbStore.save(awbData.orderId || awbNum, updated);
            setAwbMap(awbStore.get());
          }
          triggerPdfDownload(data.labelBase64, `AWB_GLS_${awbNum}_${orderName||''}.pdf`);
          toast('✅ Etichetă descărcată!', 'success');
          return;
        }
        toast('❌ ' + (data.error || 'Eticheta nu a putut fi obținută din GLS'), 'error');
        return;
      }

      toast('⚠️ Nu există date suficiente pentru descărcare. Regenerează AWB-ul.', 'warn');
    } catch(e) {
      toast('❌ Eroare: ' + e.message, 'error');
    } finally {
      setDownloadingAwb(null);
    }
  };

  // ── Delete AWB ─────────────────────────────────────────────────────────────
  const deleteAwb = (orderId, awb) => {
    if (!confirm(`Stergi AWB-ul ${awb} din local? Coletul rămâne în GLS.`)) return;
    awbStore.remove(orderId);
    setAwbMap(awbStore.get());
    toast('AWB șters din local.', 'info');
  };

  // ── Bulk AWB ───────────────────────────────────────────────────────────────
  const startBulk = async () => {
    const targets = [...selected].map(id => ordersWithStatus.find(o => o.id === id)).filter(Boolean).filter(o => !o.hasAwb);
    if (!targets.length) { toast('Selectează comenzi fără AWB!', 'warn'); return; }
    if (!glsConfig?.configured) { toast('GLS neconfigurat — adaugă credențialele în Vercel ENV', 'error'); return; }

    const results = targets.map(o => ({ orderId: o.id, name: o.name, status: 'pending', awb: null, error: null }));
    setBulkResults(results);
    setBulkDone(false);
    setBulkModal(true);
    setBulkLoading(true);

    for (let i = 0; i < targets.length; i++) {
      const order = targets[i];
      setBulkResults(p => p.map(r => r.orderId === order.id ? { ...r, status: 'processing' } : r));
      try {
        const data = await createAWB(order, {
          addr: { name: order.client, phone: order.phone, email: order.email, address: order.address, city: order.city, county: order.county, zip: order.zip },
          weight: '1', parcels: '1', content: order.prods?.slice(0, 40) || 'Colet',
          services: { SM1: true },
        });
        if (data.ok) {
          awbStore.save(order.id, data);
          setBulkResults(p => p.map(r => r.orderId === order.id ? { ...r, status: 'ok', awb: data.awb } : r));
        } else {
          setBulkResults(p => p.map(r => r.orderId === order.id ? { ...r, status: 'err', error: data.error } : r));
        }
      } catch (e) {
        setBulkResults(p => p.map(r => r.orderId === order.id ? { ...r, status: 'err', error: e.message } : r));
      }
      await new Promise(r => setTimeout(r, 600)); // rate limit
    }

    setAwbMap(awbStore.get());
    setBulkLoading(false);
    setBulkDone(true);
    setSelected(new Set());
    toast(`Bulk finalizat! ${results.filter(r => r.status === 'ok').length}/${results.length} AWBuri generate.`, 'success');
  };

  // ── Download ALL PDFs (bulk) ───────────────────────────────────────────────
  const downloadAllPDFs = () => {
    const withLabels = Object.values(awbMap).filter(a => a.labelBase64);
    if (!withLabels.length) { toast('Nu există etichete PDF salvate.', 'warn'); return; }
    withLabels.forEach(a => downloadLabel(a, a.orderName || a.orderId));
    toast(`${withLabels.length} etichete descărcate.`, 'success');
  };

  // ── Toggle service ─────────────────────────────────────────────────────────
  const toggleSvc = (code) => {
    setSelectedServices(p => {
      const n = { ...p };
      if (n[code]) delete n[code];
      else n[code] = true;
      return n;
    });
  };

  // ── Select all on page ─────────────────────────────────────────────────────
  const selectAllPage = () => {
    const ids = paginated.map(o => o.id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const n = new Set(prev);
      if (allSelected) ids.forEach(id => n.delete(id));
      else ids.forEach(id => n.add(id));
      return n;
    });
  };

  const toggleRow = (id) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const clearSelected = () => setSelected(new Set());

  // ── Render helpers ─────────────────────────────────────────────────────────
  const ConnDot = () => {
    if (configLoading) return <span className="gls-conn"><span className="gls-conn-dot idle" /><span style={{color:'#475569'}}>Se verifică...</span></span>;
    if (glsConfig?.configured) return (
      <span className="gls-conn">
        <span className="gls-conn-dot ok" />
        <span style={{color:'#10b981'}}>Configurat{glsConfig.pickupName ? ` · ${glsConfig.pickupName}` : ''}</span>
      </span>
    );
    return (
      <span className="gls-conn">
        <span className="gls-conn-dot err" />
        <span style={{color:'#f43f5e'}}>Neconfigurat</span>
      </span>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="gls-page">

        {/* ── Header ── */}
        <div className="gls-hdr">
          <div className="gls-hdr-inner">
            <div className="gls-logo-badge">🚚</div>
            <div className="gls-title">
              <h1>GLS AWB Manager</h1>
              <p>Generare · Gestionare · Descărcare etichete GLS Romania</p>
            </div>
            <ConnDot />
            <button className="gls-btn gls-btn-ghost gls-btn-sm" onClick={() => setTab('settings')}>⚙️ Setări</button>
          </div>
        </div>

        {/* ── KPIs ── */}
        <div className="gls-kpis gls-fadein">
          <div className="gls-kpi" style={{ '--kpi-glow': '#f97316', '--kpi-color': '#f97316' }} onClick={() => { setFilter('all'); setTab('orders'); }}>
            <div className="gls-kpi-icon">📦</div>
            <div className="gls-kpi-v">{kpis.total}</div>
            <div className="gls-kpi-l">Comenzi totale</div>
          </div>
          <div className="gls-kpi" style={{ '--kpi-glow': '#f59e0b', '--kpi-color': '#f59e0b' }} onClick={() => { setFilter('pending'); setTab('orders'); }}>
            <div className="gls-kpi-icon">⏳</div>
            <div className="gls-kpi-v">{kpis.pending}</div>
            <div className="gls-kpi-l">Fără AWB</div>
          </div>
          <div className="gls-kpi" style={{ '--kpi-glow': '#10b981', '--kpi-color': '#10b981' }} onClick={() => { setFilter('hasawb'); setTab('orders'); }}>
            <div className="gls-kpi-icon">✅</div>
            <div className="gls-kpi-v">{kpis.hasAwb}</div>
            <div className="gls-kpi-l">AWBuri active</div>
          </div>
          <div className="gls-kpi" style={{ '--kpi-glow': '#3b82f6', '--kpi-color': '#60a5fa' }} onClick={() => { setFilter('fulfilled'); setTab('orders'); }}>
            <div className="gls-kpi-icon">📦</div>
            <div className="gls-kpi-v" style={{ color: '#60a5fa' }}>{kpis.fulfilled}</div>
            <div className="gls-kpi-l">Fulfilled GLS</div>
          </div>
        </div>

        {/* ── ENV Config warning ── */}
        {!configLoading && !glsConfig?.configured && tab !== 'settings' && (
          <div className="gls-noconfig">
            <div style={{ fontSize: 28, marginBottom: 8 }}>🔑</div>
            <div style={{ fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>GLS neconfigurat în Vercel ENV</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
              Lipsesc variabilele de mediu:
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f97316', marginBottom: 12, lineHeight: 1.8 }}>
              {(glsConfig?.missing || []).map(m => <div key={m}>• {m}</div>)}
            </div>
            <button className="gls-btn gls-btn-primary" onClick={() => setTab('settings')}>📋 Vezi instrucțiuni</button>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="gls-tabs">
          {[
            { id: 'orders', label: '📦 Comenzi' },
            { id: 'awbs', label: '🏷️ AWBuri' },
            { id: 'istoric', label: '📡 Istoric GLS' },
            { id: 'settings', label: '⚙️ Setări' },
          ].map(t => (
            <button key={t.id} className={`gls-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════
            TAB: ORDERS
        ══════════════════════════════════════ */}
        {tab === 'orders' && (
          <div className="gls-fadein">
            {/* Filters */}
            <div className="gls-panel">
              <div className="gls-filters">
                {[
                  { id: 'pending', label: `⏳ Neexpediate (${kpis.pending})` },
                  { id: 'hasawb', label: `✅ Cu AWB (${kpis.hasAwb})` },
                  { id: 'fulfilled', label: `📦 Fulfilled (${kpis.fulfilled})` },
                  { id: 'issues', label: `⚠️ Probleme (${kpis.issues})` },
                  { id: 'cod', label: '💵 Ramburs' },
                  { id: 'online', label: '💳 Online' },
                  { id: 'all', label: `📋 Toate (${kpis.total})` },
                ].map(f => (
                  <button key={f.id} className={`gls-fb${filter === f.id ? ' active' : ''}`} onClick={() => { setFilter(f.id); setPage(0); }}>
                    {f.label}
                  </button>
                ))}
                <input
                  className="gls-search"
                  placeholder="🔍 Caută #comandă, client, AWB..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0); }}
                />
              </div>

              {/* Bulk select bar */}
              {selected.size > 0 && (
                <div className="gls-bulk-bar">
                  <span className="gls-bulk-count">✓ {selected.size} comenzi selectate</span>
                  <button className="gls-btn gls-btn-primary" onClick={startBulk} disabled={bulkLoading}>
                    {bulkLoading ? <span className="gls-spin">↻</span> : '🚚'} Generează AWBuri ({selected.size})
                  </button>
                  <button className="gls-btn gls-btn-ghost" onClick={clearSelected}>✕ Deselectează</button>
                </div>
              )}

              {/* Table */}
              <div className="gls-scroll">
                {paginated.length === 0 ? (
                  <div className="gls-empty">
                    <div className="gls-empty-icon">📦</div>
                    <div className="gls-empty-title">Nicio comandă</div>
                    <div className="gls-empty-sub">Schimbă filtrul sau sincronizează comenzile din dashboard</div>
                  </div>
                ) : (
                  <table className="gls-tbl">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input type="checkbox"
                            checked={paginated.length > 0 && paginated.every(o => selected.has(o.id))}
                            onChange={selectAllPage}
                            style={{ cursor: 'pointer', accentColor: '#f97316' }}
                          />
                        </th>
                        <th>Comandă</th>
                        <th>Client</th>
                        <th className="gls-col-hide">Adresă</th>
                        <th>Total</th>
                        <th>Plată</th>
                        <th>Status</th>
                        <th>AWB</th>
                        <th>Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map(o => {
                        const awbData = o.awbData;
                        const effectiveAwb = o.effectiveTrackingNo || '';
                        const sel = selected.has(o.id);
                        return (
                          <tr
                            key={o.id}
                            className={`${sel ? 'gls-row-selected' : ''} ${effectiveAwb ? 'gls-row-hasawb' : ''} ${o.addrIssues.length > 0 && !effectiveAwb ? 'gls-row-issues' : ''}`}
                            onClick={() => toggleRow(o.id)}
                          >
                            <td onClick={e => e.stopPropagation()}>
                              <input type="checkbox"
                                checked={sel}
                                onChange={() => toggleRow(o.id)}
                                style={{ cursor: 'pointer', accentColor: '#f97316' }}
                              />
                            </td>
                            <td>
                              <div style={{ fontWeight: 700, color: '#e2e8f0', fontFamily: 'Space Grotesk,monospace', fontSize: 13 }}>{o.name}</div>
                              <div style={{ fontSize: 9, color: '#334155', marginTop: 1 }}>{fmtD(o.createdAt)}</div>
                              {o.prods && <div style={{ fontSize: 9, color: '#475569', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }} title={o.prods}>{o.prods}</div>}
                            </td>
                            <td>
                              <div style={{ fontWeight: 700, color: '#e2e8f0', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                                {o.client || <span style={{color:'#475569',fontStyle:'italic'}}>Fără nume</span>}
                              </div>
                              <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>{o.phone || '—'}</div>
                              {o.city && <div style={{ fontSize: 9, color: '#334155', marginTop: 1 }}>{o.city}{o.county ? `, ${o.county}` : ''}</div>}
                            </td>
                            <td className="gls-col-hide">
                              <div style={{ fontSize: 11, color: '#64748b', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {o.address}, {o.city}
                              </div>
                              <div style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace' }}>{o.zip}</div>
                              {o.addrIssues.length > 0 && (
                                <div className="gls-addr-issues">⚠ {o.addrIssues[0]}</div>
                              )}
                            </td>
                            <td>
                              <div style={{
                                fontWeight: 700, fontFamily: 'Space Grotesk,monospace',
                                color: o.total > 0 ? (o.isCOD ? '#f59e0b' : '#10b981') : '#334155',
                                fontSize: 13,
                              }}>
                                {o.total > 0 ? `${fmt(o.total)} ${o.currency}` : '—'}
                              </div>
                            </td>
                            <td>
                              <span className={`gls-badge ${o.isCOD ? 'gls-badge-warn' : 'gls-badge-blue'}`}>
                                {o.isCOD ? '💵 Ramburs' : '💳 Online'}
                              </span>
                            </td>
                            <td>
                              {effectiveAwb ? (
                                <div style={{display:'flex',flexDirection:'column',gap:3}}>
                                  <span className="gls-badge gls-badge-ok">✓ AWB</span>
                                  {o.isFulfilled && <span className="gls-badge gls-badge-blue" style={{fontSize:9}}>📦 Fulfilled</span>}
                                </div>
                              ) : o.isFulfilled ? (
                                <span className="gls-badge gls-badge-blue">📦 Fulfilled</span>
                              ) : o.addrIssues.length > 0 ? (
                                <span className="gls-badge gls-badge-warn">⚠ Adresă</span>
                              ) : (
                                <span className="gls-badge" style={{ background: 'rgba(255,255,255,.05)', color: '#475569' }}>⏳ Neexpediat</span>
                              )}
                            </td>
                            <td onClick={e => e.stopPropagation()}>
                              {effectiveAwb ? (
                                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                                  {/* AWB number — prominent */}
                                  <span className="gls-awbn" style={{fontSize:13,letterSpacing:.5}}>{effectiveAwb}</span>
                                  {/* Action row */}
                                  <div className="gls-act-grp">
                                    {/* ⬇ PDF — ALWAYS visible for any AWB */}
                                    <button
                                      className="gls-btn gls-btn-green gls-btn-sm"
                                      style={{fontWeight:800}}
                                      disabled={downloadingAwb === effectiveAwb}
                                      onClick={() => downloadLabel(awbData, o.name, effectiveAwb)}
                                    >
                                      {downloadingAwb === effectiveAwb
                                        ? <><span className="gls-spin">↻</span> ...</>
                                        : '⬇ PDF'}
                                    </button>
                                    <a href={`https://gls-group.eu/RO/ro/urmarire-colet?match=${effectiveAwb}`}
                                      target="_blank" rel="noopener noreferrer"
                                      className="gls-btn gls-btn-blue gls-btn-sm"
                                      style={{ textDecoration: 'none' }}>📍 Track</a>
                                    <a href={`https://mygls.ro/Parcel/Detail/${effectiveAwb}`}
                                      target="_blank" rel="noopener noreferrer"
                                      className="gls-btn gls-btn-ghost gls-btn-sm"
                                      style={{ textDecoration: 'none', fontSize: 10 }}>🌐</a>
                                    {awbData && (
                                      <button className="gls-btn gls-btn-red gls-btn-sm" onClick={() => deleteAwb(o.id, effectiveAwb)}>✕</button>
                                    )}
                                  </div>
                                </div>
                              ) : o.isFulfilled ? (
                                <div className="gls-act-grp">
                                  <span style={{fontSize:10,color:'#475569',fontStyle:'italic'}}>Fulfilled extern</span>
                                  <button className="gls-btn gls-btn-ghost gls-btn-sm" onClick={() => openAwbModal(o)}>+ AWB</button>
                                </div>
                              ) : (
                                <div className="gls-act-grp">
                                  <button
                                    className="gls-btn gls-btn-primary gls-btn-sm"
                                    onClick={() => openAwbModal(o)}
                                  >🚚 AWB</button>
                                  {o.addrIssues.length > 0 && (
                                    <button className="gls-btn gls-btn-ghost gls-btn-sm" onClick={() => openAwbModal(o)} title={o.addrIssues.join(', ')}>
                                      ✏️ Fix adresă
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,.04)', justifyContent: 'center' }}>
                  <button className="gls-btn gls-btn-ghost gls-btn-sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹ Prev</button>
                  <span style={{ fontSize: 11, color: '#475569' }}>{page + 1} / {totalPages} • {filtered.length} comenzi</span>
                  <button className="gls-btn gls-btn-ghost gls-btn-sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next ›</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: AWBs SAVED
        ══════════════════════════════════════ */}
        {tab === 'awbs' && (
          <div className="gls-fadein">
            <div className="gls-panel">
              <div className="gls-panel-hdr">
                <div>
                  <div className="gls-panel-title">🏷️ AWBuri generate ({savedAwbs.length})</div>
                  <div className="gls-panel-sub">Istoric etichete GLS generate din această sesiune</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {savedAwbs.some(a => a.labelBase64) && (
                    <button className="gls-btn gls-btn-primary" onClick={downloadAllPDFs}>⬇ Descarcă toate PDF</button>
                  )}
                </div>
              </div>

              {savedAwbs.length === 0 ? (
                <div className="gls-empty">
                  <div className="gls-empty-icon">🏷️</div>
                  <div className="gls-empty-title">Niciun AWB generat</div>
                  <div className="gls-empty-sub">AWBurile generate vor apărea aici</div>
                </div>
              ) : (
                <div style={{ padding: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(300px,1fr))' }}>
                  {savedAwbs.map((a, idx) => {
                    const order = ordersWithStatus.find(o => o.id === a.orderId);
                    return (
                      <div key={a.awb || idx} className="gls-awb-card gls-fadein">
                        <div className="gls-awb-card-row">
                          <div>
                            <div className="gls-awbn" style={{ fontSize: 22 }}>{a.awb}</div>
                            <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>{order?.name} • {fmtD(a.savedAt)}</div>
                          </div>
                          <span className="gls-badge gls-badge-ok">✓ Activ</span>
                        </div>
                        {order && (
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            <strong style={{ color: '#94a3b8' }}>{order.client}</strong> — {order.city} {order.zip}
                          </div>
                        )}
                        {order && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span className={`gls-badge ${order.isCOD ? 'gls-badge-warn' : 'gls-badge-blue'}`} style={{ fontSize: 9 }}>
                              {order.isCOD ? `💵 Ramburs ${fmt(order.total)} RON` : `💳 ${fmt(order.total)} RON`}
                            </span>
                            {(a.servicesApplied || []).map(s => (
                              <span key={s} className="gls-badge gls-badge-purple" style={{ fontSize: 9 }}>{s}</span>
                            ))}
                          </div>
                        )}
                        <div className="gls-act-grp">
                          {/* ⬇ PDF — always visible */}
                          <button
                            className="gls-btn gls-btn-green gls-btn-sm"
                            style={{fontWeight:800}}
                            disabled={downloadingAwb === a.awb}
                            onClick={() => downloadLabel(a, order?.name, a.awb)}
                          >
                            {downloadingAwb === a.awb
                              ? <><span className="gls-spin">↻</span> ...</>
                              : a.labelBase64 ? '⬇ PDF' : '⬇ PDF GLS'}
                          </button>
                          <a href={`https://gls-group.eu/RO/ro/urmarire-colet?match=${a.awb}`}
                            target="_blank" rel="noopener noreferrer"
                            className="gls-btn gls-btn-blue gls-btn-sm" style={{ textDecoration: 'none' }}>📍 Track</a>
                          <a href={`https://mygls.ro/Parcel/Detail/${a.awb}`}
                            target="_blank" rel="noopener noreferrer"
                            className="gls-btn gls-btn-ghost gls-btn-sm" style={{ textDecoration: 'none' }}>🌐</a>
                          <button className="gls-btn gls-btn-red gls-btn-sm" onClick={() => deleteAwb(a.orderId, a.awb)}>✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}


        {/* ══════════════════════════════════════
            TAB: ISTORIC GLS
        ══════════════════════════════════════ */}
        {tab === 'istoric' && (
          <div className="gls-fadein">
            <div className="gls-panel">
              <div className="gls-panel-hdr">
                <div>
                  <div className="gls-panel-title">📡 Colete din contul MyGLS</div>
                  <div className="gls-panel-sub">Lista coletelor preluate direct din API-ul GLS</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    className="gls-inp"
                    style={{ width: 'auto', padding: '6px 10px', fontSize: 11 }}
                    value={glsDays}
                    onChange={e => setGlsDays(parseInt(e.target.value))}
                  >
                    <option value={7}>Ultimele 7 zile</option>
                    <option value={14}>Ultimele 14 zile</option>
                    <option value={30}>Ultimele 30 zile</option>
                    <option value={60}>Ultimele 60 zile</option>
                    <option value={90}>Ultimele 90 zile</option>
                  </select>
                  <button className="gls-btn gls-btn-primary" onClick={loadGlsParcels} disabled={glsParcelsLoading}>
                    {glsParcelsLoading ? <><span className="gls-spin">↻</span> Se încarcă...</> : '📡 Încarcă din GLS'}
                  </button>
                </div>
              </div>

              {glsParcelsErr && (
                <div style={{ padding: '12px 18px' }}>
                  <div className="gls-errbox">❌ {glsParcelsErr}</div>
                </div>
              )}

              {!glsParcels.length && !glsParcelsLoading && !glsParcelsErr && (
                <div className="gls-empty">
                  <div className="gls-empty-icon">📡</div>
                  <div className="gls-empty-title">Apasă "Încarcă din GLS"</div>
                  <div className="gls-empty-sub">Se vor afișa toate coletele din contul MyGLS pentru perioada selectată</div>
                </div>
              )}

              {glsParcels.length > 0 && (
                <>
                  <div style={{ padding: '8px 18px', fontSize: 11, color: '#475569', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                    {glsParcels.length} colete găsite în ultimele {glsDays} zile
                  </div>
                  <div className="gls-scroll">
                    <table className="gls-tbl">
                      <thead>
                        <tr>
                          <th>Nr. Colet (AWB)</th>
                          <th>Referință client</th>
                          <th>Destinatar</th>
                          <th>Localitate</th>
                          <th>Data pickup</th>
                          <th>Colete</th>
                          <th>Ramburs</th>
                          <th>Servicii</th>
                          <th>Acțiuni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {glsParcels.map((p, i) => (
                          <tr key={p.parcelNumber || i}>
                            <td>
                              <span className="gls-awbn">{p.parcelNumber}</span>
                            </td>
                            <td>
                              <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{p.clientRef || '—'}</span>
                            </td>
                            <td>
                              <span style={{ fontSize: 12, color: '#94a3b8' }}>{p.deliveryName || '—'}</span>
                            </td>
                            <td>
                              <span style={{ fontSize: 11, color: '#64748b' }}>{p.deliveryCity || '—'} {p.deliveryZip ? `(${p.deliveryZip})` : ''}</span>
                            </td>
                            <td>
                              <span style={{ fontSize: 11, color: '#475569' }}>{p.pickupDate ? fmtD(p.pickupDate.replace(/\/Date\((\d+)\)\//, (_, ms) => new Date(parseInt(ms)).toISOString())) : '—'}</span>
                            </td>
                            <td>
                              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#e2e8f0' }}>{p.count || 1}</span>
                            </td>
                            <td>
                              {p.cod > 0 ? (
                                <span className="gls-badge gls-badge-warn" style={{ fontSize: 9 }}>
                                  💵 {fmt(p.cod)} {p.codCurrency || 'RON'}
                                </span>
                              ) : (
                                <span style={{ color: '#334155', fontSize: 10 }}>—</span>
                              )}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                {(p.services || []).map(s => (
                                  <span key={s} className="gls-badge gls-badge-purple" style={{ fontSize: 8 }}>{s}</span>
                                ))}
                                {(!p.services || !p.services.length) && <span style={{ color: '#334155', fontSize: 10 }}>—</span>}
                              </div>
                            </td>
                            <td>
                              <div className="gls-act-grp">
                                <a
                                  href={`https://gls-group.eu/RO/ro/urmarire-colet?match=${p.parcelNumber}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="gls-btn gls-btn-blue gls-btn-sm"
                                  style={{ textDecoration: 'none' }}
                                >📍 Track</a>
                                <a
                                  href={`https://mygls.ro/Parcel/Detail/${p.parcelNumber}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="gls-btn gls-btn-ghost gls-btn-sm"
                                  style={{ textDecoration: 'none' }}
                                >🌐</a>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Summary row */}
                  <div style={{ padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,.04)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#475569' }}>
                      📦 Total colete: <strong style={{ color: '#e2e8f0' }}>{glsParcels.reduce((s, p) => s + (p.count || 1), 0)}</strong>
                    </span>
                    <span style={{ fontSize: 11, color: '#475569' }}>
                      💵 Total ramburs: <strong style={{ color: '#f59e0b' }}>{fmt(glsParcels.reduce((s, p) => s + (p.cod || 0), 0))} RON</strong>
                    </span>
                    <span style={{ fontSize: 11, color: '#475569' }}>
                      📡 Expedieri unice: <strong style={{ color: '#e2e8f0' }}>{glsParcels.length}</strong>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: SETTINGS — ENV only, no client credentials
        ══════════════════════════════════════ */}
        {tab === 'settings' && (
          <div className="gls-fadein">

            {/* ── Status curent ENV ── */}
            <div className="gls-panel" style={{ marginBottom: 12 }}>
              <div className="gls-panel-hdr">
                <div>
                  <div className="gls-panel-title">🔐 Status configurare GLS</div>
                  <div className="gls-panel-sub">Credențialele sunt stocate 100% în Vercel ENV — niciodată în browser</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <ConnDot />
                  <button className="gls-btn gls-btn-ghost gls-btn-sm" onClick={refreshConfig} disabled={configLoading}>
                    {configLoading ? <span className="gls-spin">↻</span> : '↺ Refresh'}
                  </button>
                </div>
              </div>

              {configLoading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#475569', fontSize: 12 }}>
                  <span className="gls-spin">↻</span> Se verifică configurarea...
                </div>
              ) : (
                <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* ENV vars status grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {glsConfig?.envSummary && Object.entries(glsConfig.envSummary).map(([key, val]) => (
                      <div key={key} style={{
                        background: '#060b10', border: '1px solid rgba(255,255,255,.05)',
                        borderRadius: 8, padding: '10px 12px',
                        borderLeft: val.startsWith('✅') ? '3px solid #10b981' : val.startsWith('❌') ? '3px solid #f43f5e' : '3px solid #f59e0b',
                      }}>
                        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#f97316', fontWeight: 700 }}>{key}</div>
                        <div style={{
                          fontSize: 11, marginTop: 3,
                          color: val.startsWith('✅') ? '#10b981' : val.startsWith('❌') ? '#f43f5e' : '#f59e0b'
                        }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Test connection */}
                  {glsConfig?.configured && (
                    <button className="gls-btn gls-btn-primary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={testConnection}>
                      🔌 Testează conexiunea GLS
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Instrucțiuni Vercel ── */}
            <div className="gls-panel">
              <div className="gls-panel-hdr">
                <div className="gls-panel-title">📋 Cum configurezi în Vercel</div>
              </div>
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>

                <div className="gls-infobox2">
                  🔒 <strong>Securitate:</strong> Credențialele GLS nu sunt niciodată trimise din browser. 
                  Sunt citite exclusiv de server din variabilele de mediu Vercel. 
                  Niciun utilizator nu le poate vedea din dashboard.
                </div>

                <div className="gls-infobox">
                  <div style={{ fontWeight: 700, color: '#f97316', marginBottom: 10, fontSize: 12 }}>
                    Pasul 1 — Vercel Dashboard → Settings → Environment Variables
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      ['GLS_USERNAME',      'Email-ul contului MyGLS',               true],
                      ['GLS_PASSWORD',      'Parola MyGLS (plain text)',              true],
                      ['GLS_CLIENT_NUMBER', 'Numărul de client din contractul GLS',   false],
                      ['GLS_PICKUP_NAME',   'Numele firmei expeditor',                true],
                      ['GLS_PICKUP_STREET', 'Strada + număr expeditor',               true],
                      ['GLS_PICKUP_CITY',   'Orașul expeditor',                       true],
                      ['GLS_PICKUP_ZIP',    'Codul poștal expeditor (6 cifre)',        true],
                      ['GLS_PICKUP_COUNTY', 'Județul expeditor',                      false],
                      ['GLS_PICKUP_PHONE',  'Telefonul expeditor',                    false],
                    ].map(([key, desc, required]) => (
                      <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 8px', background: 'rgba(255,255,255,.02)', borderRadius: 6 }}>
                        <code style={{ color: '#f97316', fontFamily: 'monospace', fontSize: 11, flexShrink: 0, minWidth: 180 }}>{key}</code>
                        <span style={{ color: '#64748b', fontSize: 11, flex: 1 }}>{desc}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                          background: required ? 'rgba(244,63,94,.15)' : 'rgba(245,158,11,.1)',
                          color: required ? '#f43f5e' : '#f59e0b',
                          border: `1px solid ${required ? 'rgba(244,63,94,.3)' : 'rgba(245,158,11,.2)'}`,
                        }}>{required ? 'OBLIGATORIU' : 'opțional'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="gls-infobox">
                  <div style={{ fontWeight: 700, color: '#60a5fa', marginBottom: 6, fontSize: 12 }}>
                    Pasul 2 — Redeploy după ce adaugi variabilele
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.8 }}>
                    Vercel → Deployments → Redeploy (sau push un commit nou)<br/>
                    Variabilele sunt active instant după deploy.<br/>
                    Apasă <strong style={{color:'#e2e8f0'}}>↺ Refresh</strong> de mai sus pentru a verifica statusul.
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

      </div>

      {/* ══════════════════════════════════════
          MODAL: Generare AWB
      ══════════════════════════════════════ */}
      {awbModal && (
        <div className="gls-overlay" onClick={e => { if (e.target === e.currentTarget && !awbResult?.ok) setAwbModal(null); }}>
          <div className="gls-modal gls-fadein">
            <div className="gls-modal-hdr">
              <div>
                <div className="gls-modal-title">🚚 Generare AWB GLS</div>
                <div className="gls-modal-sub">{awbModal.name} • {awbModal.client} • {fmt(awbModal.total)} {awbModal.currency} {awbModal.isCOD ? '(Ramburs)' : '(Online)'}</div>
              </div>
              <button className="gls-modal-close" onClick={() => setAwbModal(null)}>✕ Închide</button>
            </div>
            <div className="gls-modal-body">

              {/* Success state */}
              {awbResult?.ok ? (
                <div className="gls-okbox gls-fadein">
                  <div style={{ fontSize: 12, color: '#10b981', marginBottom: 4 }}>✅ AWB generat cu succes!</div>
                  <div className="gls-okbox-awb">{awbResult.awb}</div>
                  <div style={{ fontSize: 11, color: '#064e3b', marginBottom: 12 }}>
                    Comanda {awbModal.name} • {awbModal.client}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {awbResult.labelBase64 && (
                      <button className="gls-btn gls-btn-green" onClick={() => downloadLabel(awbResult, awbModal.name)}>
                        ⬇ Descarcă PDF etichetă
                      </button>
                    )}
                    <a href={`https://gls-group.eu/RO/ro/urmarire-colet?match=${awbResult.awb}`}
                      target="_blank" rel="noopener noreferrer"
                      className="gls-btn gls-btn-blue" style={{ textDecoration: 'none' }}>
                      📍 Tracking live
                    </a>
                    <a href={`https://mygls.ro/Parcel/Detail/${awbResult.awb}`}
                      target="_blank" rel="noopener noreferrer"
                      className="gls-btn gls-btn-ghost" style={{ textDecoration: 'none' }}>
                      🌐 MyGLS portal
                    </a>
                  </div>
                  {awbResult.servicesApplied?.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 10, color: '#065f46' }}>
                      Servicii: {awbResult.servicesApplied.join(' · ')}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Address issues warning */}
                  {awbModal.addrIssues.length > 0 && (
                    <div className="gls-warnbox">
                      ⚠️ <strong>Probleme adresă detectate:</strong>
                      <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.8 }}>
                        {awbModal.addrIssues.map((iss, i) => <li key={i}>{iss}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Error */}
                  {awbResult?.error && (
                    <div className="gls-errbox">❌ {awbResult.error}</div>
                  )}

                  {/* Recipient address (editable) */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>✏️ Date destinatar</div>
                    <div className="gls-grid2">
                      {[
                        { key: 'name', label: 'Nume complet', placeholder: 'Ion Popescu' },
                        { key: 'phone', label: 'Telefon', placeholder: '07xx xxx xxx' },
                        { key: 'email', label: 'Email', placeholder: 'email@exemplu.ro' },
                        { key: 'city', label: 'Oraș', placeholder: 'Bucuresti' },
                        { key: 'county', label: 'Județ', placeholder: 'Ilfov' },
                        { key: 'zip', label: 'Cod poștal', placeholder: '123456', maxLength: 6 },
                      ].map(f => (
                        <div key={f.key} className="gls-field">
                          <label className="gls-lbl">{f.label}</label>
                          <input className="gls-inp" value={editAddr?.[f.key] || ''} maxLength={f.maxLength}
                            placeholder={f.placeholder}
                            onChange={e => setEditAddr(p => ({ ...p, [f.key]: e.target.value }))} />
                        </div>
                      ))}
                      <div className="gls-field" style={{ gridColumn: '1/-1' }}>
                        <label className="gls-lbl">Adresă stradală</label>
                        <input className="gls-inp" value={editAddr?.address || ''}
                          placeholder="Str. Exemplu nr. 10"
                          onChange={e => setEditAddr(p => ({ ...p, address: e.target.value }))} />
                      </div>
                    </div>
                  </div>

                  {/* Parcel details */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>📦 Detalii colet</div>
                    <div className="gls-grid2">
                      <div className="gls-field">
                        <label className="gls-lbl">Greutate (kg)</label>
                        <input className="gls-inp" type="number" min="0.1" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} placeholder="1.0" />
                      </div>
                      <div className="gls-field">
                        <label className="gls-lbl">Nr. colete</label>
                        <input className="gls-inp" type="number" min="1" max="10" value={parcels} onChange={e => setParcels(e.target.value)} placeholder="1" />
                      </div>
                      <div className="gls-field" style={{ gridColumn: '1/-1' }}>
                        <label className="gls-lbl">Conținut colet</label>
                        <input className="gls-inp" value={content} onChange={e => setContent(e.target.value)} placeholder="Produs" maxLength={40} />
                      </div>
                      <div className="gls-field" style={{ gridColumn: '1/-1' }}>
                        <label className="gls-lbl">Observații</label>
                        <input className="gls-inp" value={observation} onChange={e => setObservation(e.target.value)} placeholder="Observații opționale" maxLength={100} />
                      </div>
                    </div>
                  </div>

                  {/* COD info */}
                  {awbModal.isCOD && (
                    <div className="gls-infobox2">
                      💵 <strong>Ramburs activat automat:</strong> {fmt(awbModal.total)} {awbModal.currency}
                      <div style={{ fontSize: 10, marginTop: 3, color: '#6b8ec7' }}>Suma va fi colectată la livrare și returnată în cont</div>
                    </div>
                  )}

                  {/* GLS Services */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>⚡ Servicii GLS</div>
                    {SERVICE_GROUPS.map(grp => {
                      const svcs = Object.values(GLS_SERVICES).filter(s => s.group === grp);
                      return (
                        <div key={grp}>
                          <div className="gls-svc-group-title">{grp}</div>
                          <div className="gls-svc-grid">
                            {svcs.map(s => {
                              const active = !!selectedServices[s.code];
                              return (
                                <div key={s.code} className={`gls-svc-card${active ? ' active' : ''}`} onClick={() => toggleSvc(s.code)}>
                                  <div className={`gls-svc-chk${active ? ' active' : ''}`}>{active ? '✓' : ''}</div>
                                  <div className="gls-svc-body">
                                    <div className="gls-svc-name">{s.label}</div>
                                    <div className="gls-svc-desc">{s.desc}</div>
                                    {active && s.param === 'phone' && (
                                      <div className="gls-svc-input" onClick={e => e.stopPropagation()}>
                                        <input className="gls-inp" value={editAddr?.phone || ''} placeholder="Telefon"
                                          style={{ fontSize: 11, padding: '5px 8px' }}
                                          onChange={e => setEditAddr(p => ({ ...p, phone: e.target.value }))} />
                                      </div>
                                    )}
                                    {active && s.param === 'email' && (
                                      <div className="gls-svc-input" onClick={e => e.stopPropagation()}>
                                        <input className="gls-inp" value={editAddr?.email || ''} placeholder="Email"
                                          style={{ fontSize: 11, padding: '5px 8px' }}
                                          onChange={e => setEditAddr(p => ({ ...p, email: e.target.value }))} />
                                      </div>
                                    )}
                                    {active && s.param === 'value' && (
                                      <div className="gls-svc-input" onClick={e => e.stopPropagation()}>
                                        <input className="gls-inp" type="number" placeholder="Valoare RON"
                                          style={{ fontSize: 11, padding: '5px 8px' }}
                                          value={selectedServices[s.code] === true ? '' : selectedServices[s.code]}
                                          onChange={e => setSelectedServices(p => ({ ...p, [s.code]: e.target.value }))} />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="gls-modal-ftr">
              {awbResult?.ok ? (
                <button className="gls-btn gls-btn-ghost" onClick={() => setAwbModal(null)}>Închide</button>
              ) : (
                <>
                  <button className="gls-btn gls-btn-ghost" onClick={() => setAwbModal(null)}>Anulează</button>
                  <button className="gls-btn gls-btn-primary" onClick={submitAWB} disabled={awbLoading}>
                    {awbLoading ? <><span className="gls-spin">↻</span> Se generează...</> : '🚚 Generează AWB'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          MODAL: Bulk Progress
      ══════════════════════════════════════ */}
      {bulkModal && (
        <div className="gls-overlay">
          <div className="gls-modal gls-fadein" style={{ maxWidth: 520 }}>
            <div className="gls-modal-hdr">
              <div>
                <div className="gls-modal-title">
                  {bulkDone ? '✅ Bulk finalizat!' : <><span className="gls-spin">↻</span> Generare AWBuri bulk...</>}
                </div>
                <div className="gls-modal-sub">
                  {bulkResults.filter(r => r.status === 'ok').length}/{bulkResults.length} completate
                </div>
              </div>
              {bulkDone && <button className="gls-modal-close" onClick={() => setBulkModal(false)}>✕</button>}
            </div>
            <div className="gls-modal-body">
              {/* Progress bar */}
              <div className="gls-progress-wrap">
                <div className="gls-progress-bar"
                  style={{ width: `${(bulkResults.filter(r => ['ok', 'err'].includes(r.status)).length / Math.max(1, bulkResults.length)) * 100}%` }} />
              </div>

              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {bulkResults.map(r => (
                  <div key={r.orderId} className="gls-bulk-progress-item">
                    <div className={`gls-bulk-status-icon ${r.status === 'ok' ? 'gls-bulk-status-ok' : r.status === 'err' ? 'gls-bulk-status-err' : r.status === 'processing' ? 'gls-bulk-status-proc' : 'gls-bulk-status-pend'}`}>
                      {r.status === 'ok' ? '✓' : r.status === 'err' ? '✕' : r.status === 'processing' ? <span className="gls-spin" style={{ display: 'inline-block' }}>↻</span> : '…'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{r.name}</div>
                      {r.awb && <div className="gls-awbn" style={{ fontSize: 13 }}>{r.awb}</div>}
                      {r.error && <div style={{ fontSize: 10, color: '#f43f5e', marginTop: 2 }}>{r.error}</div>}
                    </div>
                    <span className={`gls-badge ${r.status === 'ok' ? 'gls-badge-ok' : r.status === 'err' ? 'gls-badge-err' : r.status === 'processing' ? 'gls-badge-gls' : ''}`} style={{ fontSize: 9 }}>
                      {r.status === 'ok' ? '✓ OK' : r.status === 'err' ? '✕ Eroare' : r.status === 'processing' ? '⟳ Procesare' : '⏳ Asteaptă'}
                    </span>
                  </div>
                ))}
              </div>

              {bulkDone && (
                <div style={{ display: 'flex', gap: 12, padding: '10px 0 0', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    ✅ {bulkResults.filter(r => r.status === 'ok').length} reușite •
                    {bulkResults.filter(r => r.status === 'err').length > 0 && (
                      <span style={{ color: '#f43f5e' }}> ❌ {bulkResults.filter(r => r.status === 'err').length} erori</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {Object.values(awbMap).some(a => a.labelBase64) && (
                      <button className="gls-btn gls-btn-green" onClick={() => { downloadAllPDFs(); setBulkModal(false); }}>
                        ⬇ Descarcă toate PDF
                      </button>
                    )}
                    <button className="gls-btn gls-btn-ghost" onClick={() => setBulkModal(false)}>Închide</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Toasts ── */}
      <div className="gls-toasts">
        {toasts.map(t => (
          <div key={t.id} className={`gls-toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </>
  );
}
