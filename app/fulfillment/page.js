'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

const ls = {
  get:(k)=>{ try{ return typeof window!=='undefined'?localStorage.getItem(k):null; }catch{return null;} },
  set:(k,v)=>{ try{ if(typeof window!=='undefined')localStorage.setItem(k,v); }catch{} },
};
const fmt = n=>Number(n||0).toLocaleString('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtD = d=>{ if(!d)return'—'; try{const p=(d.split('T')[0]).split('-');return`${p[2]}.${p[1]}.${p[0]}`;}catch{return d.slice(0,10);} };
const pad = n=>String(n).padStart(2,'0');
const toISO = d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

// ── GLS Services ────────────────────────────────────────────────────────────
const GLS_SERVICES = {
  SM1:{ code:'SM1',label:'📱 SMS la livrare',      desc:'SMS trimis destinatarului',           param:'phone',  group:'Notificări' },
  SM2:{ code:'SM2',label:'📧 SMS + Email',          desc:'SMS și email la livrare',             param:'email',  group:'Notificări' },
  FDS:{ code:'FDS',label:'🕐 FlexDelivery Email',   desc:'Destinatarul alege ora/locul via email', param:'email', group:'Flex' },
  FSS:{ code:'FSS',label:'💬 FlexDelivery SMS',     desc:'Destinatarul alege ora/locul via SMS', param:'phone', group:'Flex' },
  SAT:{ code:'SAT',label:'📅 Livrare Sâmbătă',      desc:'Garantat livrat sâmbătă',             param:null,     group:'Livrare' },
  T12:{ code:'T12',label:'⏰ Livrare până 12:00',   desc:'Garantat înainte de prânz',           param:null,     group:'Livrare' },
  SBS:{ code:'SBS',label:'🏪 Shop/ParcelLocker',    desc:'Livrare la shop GLS',                 param:'shopId', group:'Livrare' },
  AOS:{ code:'AOS',label:'✍️ Semnătură',            desc:'Confirmare prin semnătură',           param:null,     group:'Livrare' },
  DPV:{ code:'DPV',label:'🏠 Numai adresă privată', desc:'Nu la vecin/recepție',                param:null,     group:'Livrare' },
  INS:{ code:'INS',label:'🛡️ Asigurare',            desc:'Asigurare pentru valoarea declarată', param:'value',  group:'Extra' },
  SDS:{ code:'SDS',label:'↩️ Shop Return',          desc:'Return facilitat prin shop GLS',      param:null,     group:'Extra' },
};

// ── Sameday Options ─────────────────────────────────────────────────────────
const SD_OPTIONS = {
  openPackage:       { label:'📂 Deschide la livrare',   desc:'Destinatarul verifică conținutul' },
  saturdayDelivery:  { label:'📅 Livrare Sâmbătă',       desc:'Livrare garantată sâmbătă' },
  thermo:            { label:'❄️ Transport frigorific',   desc:'Temperatura controlată' },
  repaymentTransport:{ label:'💸 Ramburs transport',     desc:'Taxa transport suportată de destinatar' },
};

// ── Validare locală adresă ───────────────────────────────────────────────────
function validateAddrLocal(a) {
  const issues = [];
  if (!a.name||a.name.trim().length<3) issues.push('Nume destinatar lipsă');
  if (!a.address||a.address.trim().length<5) issues.push('Adresa stradală incompletă');
  if (a.address && !/\d/.test(a.address)) issues.push('Adresa fără număr stradal');
  if (!a.city||a.city.trim().length<2) issues.push('Orașul lipsește');
  if (!a.zip||!/^\d{6}$/.test((a.zip||'').replace(/\s/g,''))) issues.push('Cod poștal invalid (trebuie 6 cifre)');
  const digits=(a.phone||'').replace(/\D/g,'');
  if (!digits||digits.length<9) issues.push('Telefon invalid (min 9 cifre)');
  return issues;
}

function procOrder(o) {
  const notes=o.note_attributes||[];
  const invUrlAttr=notes.find(a=>(a.name||'').toLowerCase().includes('invoice-url')&&!(a.name||'').toLowerCase().includes('short'));
  const invoiceUrl=invUrlAttr?.value||'';
  const hasInvoice=!!invoiceUrl||notes.some(a=>(a.name||'').toLowerCase().includes('invoice-number'));
  const invNumAttr=notes.find(a=>(a.name||'').toLowerCase()==='invoice-number');
  const invSeriesAttr=notes.find(a=>(a.name||'').toLowerCase()==='invoice-series');
  const fulfillmentData=(o.fulfillments||[]).find(f=>f.tracking_company||f.tracking_number);
  const trackingNo=fulfillmentData?.tracking_number||'';
  const tc=(fulfillmentData?.tracking_company||'').toLowerCase();
  const courier=tc.includes('sameday')?'sameday':tc.includes('gls')?'gls':'unknown';
  const addr=o.shipping_address||o.billing_address||{};
  const lineItems=o.line_items||[];
  const isOnlinePay=['shopify_payments','stripe','paypal'].some(g=>(o.payment_gateway||'').toLowerCase().includes(g));
  const isCOD=(o.financial_status||'')==='pending'||(o.payment_gateway||'').toLowerCase().includes('cod')||(!isOnlinePay&&(o.financial_status||'')==='paid');

  const orderData = {
    id:String(o.id||''), name:o.name||'', client:addr.name||'',
    phone:o.phone||addr.phone||'', email:o.email||'',
    address:addr.address1||'', address2:addr.address2||'',
    city:addr.city||'',
    // BUGFIX: folosim province din Shopify ca județ (câmpul corect)
    county:addr.province||addr.province_code||'',
    zip:(addr.zip||'').replace(/\s/g,''),
    fin:(o.financial_status||'').toLowerCase(),
    fulfillmentStatus:(o.fulfillment_status||'').toLowerCase(),
    createdAt:o.created_at||'', total:parseFloat(o.total_price||0), currency:o.currency||'RON',
    gateway:o.payment_gateway||'', courier, trackingNo, hasInvoice, invoiceUrl,
    invoiceNumber:invNumAttr?.value||'', invoiceSeries:invSeriesAttr?.value||'',
    items:lineItems.map(i=>({ name:i.name||'',sku:i.sku||'',qty:i.quantity||1,price:parseFloat(i.price||0) })),
    prods:lineItems.map(i=>i.name).join(', '),
    isCOD, isOnlinePay,
  };

  orderData.addrIssues = validateAddrLocal({
    name:orderData.client, address:orderData.address,
    city:orderData.city, zip:orderData.zip, phone:orderData.phone,
  });

  return orderData;
}

function useToast() {
  const [toasts,setToasts]=useState([]);
  const add=useCallback((msg,type='info')=>{
    const id=Date.now()+Math.random();
    setToasts(p=>[...p,{id,msg,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),5000);
  },[]);
  return { toasts, add };
}

const CSS = `
  *{box-sizing:border-box}
  .fb-page{max-width:1400px;margin:0 auto;padding:12px 12px 100px}
  .fb-hdr{position:sticky;top:0;z-index:100;background:rgba(7,9,14,.97);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.07);padding:10px 14px;margin-bottom:12px}
  .fb-hrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .fb-title{flex:1;font-size:15px;font-weight:800;letter-spacing:-.3px}
  .fb-sub{font-size:10px;color:#64748b;margin-top:1px}
  .fb-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px}
  .fb-kpi{background:#0c1018;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px 14px}
  .fb-kpi.clickable{cursor:pointer;transition:border-color .15s}
  .fb-kpi.clickable:hover{border-color:rgba(249,115,22,.4)}
  .fb-kpi-v{font-size:22px;font-weight:800;font-family:monospace;letter-spacing:-1px}
  .fb-kpi-l{font-size:10px;color:#64748b;margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
  .fb-panel{background:#0c1018;border:1px solid rgba(255,255,255,.07);border-radius:12px;overflow:hidden;margin-bottom:12px}
  .fb-ph{padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
  .fb-pt{font-size:13px;font-weight:700}
  .fb-filters{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.05);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .fb-fb{background:#0a0f14;border:1px solid #1e2a35;color:#94a3b8;padding:5px 12px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap}
  .fb-fb.active{background:#f97316;border-color:#f97316;color:white}
  .fb-fb:hover:not(.active){border-color:#f97316;color:#f97316}
  .fb-search{flex:1;min-width:140px;background:#0a0f14;border:1px solid #1e2a35;color:#e2e8f0;padding:6px 10px;border-radius:8px;font-size:12px;outline:none;font-family:inherit}
  .fb-search:focus{border-color:#f97316}
  .fb-tbl{width:100%;border-collapse:collapse}
  .fb-tbl thead th{padding:8px 12px;text-align:left;font-size:9px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,.05);white-space:nowrap}
  .fb-tbl tbody tr{border-bottom:1px solid rgba(255,255,255,.04);transition:background .1s}
  .fb-tbl tbody tr:hover{background:rgba(255,255,255,.02)}
  .fb-tbl tbody td{padding:10px 12px;font-size:12px;vertical-align:middle}
  .fb-warn{background:rgba(245,158,11,.04);border-left:3px solid #f59e0b}
  .fb-err-row{background:rgba(244,63,94,.04);border-left:3px solid #f43f5e}
  .fb-act{display:inline-flex;align-items:center;gap:3px;padding:4px 9px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid;transition:all .15s;white-space:nowrap;background:transparent;font-family:inherit}
  .fb-act-awb{color:#f97316;border-color:rgba(249,115,22,.3)}
  .fb-act-awb:hover{background:rgba(249,115,22,.12)}
  .fb-act-inv{color:#10b981;border-color:rgba(16,185,129,.3)}
  .fb-act-inv:hover{background:rgba(16,185,129,.12)}
  .fb-act-edit{color:#3b82f6;border-color:rgba(59,130,246,.3)}
  .fb-act-edit:hover{background:rgba(59,130,246,.12)}
  .fb-act-sm{font-size:10px;padding:3px 7px}
  .fb-act:disabled{opacity:.4;cursor:not-allowed}
  .fb-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap}
  .fb-badge-ok{background:rgba(16,185,129,.12);color:#10b981;border:1px solid rgba(16,185,129,.2)}
  .fb-badge-warn{background:rgba(245,158,11,.12);color:#f59e0b;border:1px solid rgba(245,158,11,.2)}
  .fb-badge-err{background:rgba(244,63,94,.12);color:#f43f5e;border:1px solid rgba(244,63,94,.2)}
  .fb-badge-gls{background:rgba(249,115,22,.12);color:#f97316;border:1px solid rgba(249,115,22,.2);font-size:9px}
  .fb-badge-sd{background:rgba(59,130,246,.12);color:#3b82f6;border:1px solid rgba(59,130,246,.2);font-size:9px}
  .fb-awbn{font-family:monospace;font-size:10px;color:#10b981;font-weight:700}
  .fb-errt{font-size:9px;color:#f43f5e;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:flex-end;justify-content:center;padding:0;backdrop-filter:blur(4px)}
  @media(min-width:600px){.fb-overlay{align-items:center;padding:16px}}
  .fb-modal{background:#0f1419;border:1px solid rgba(255,255,255,.1);width:100%;max-height:95vh;overflow-y:auto}
  @media(min-width:600px){.fb-modal{border-radius:14px}}
  .fb-mhdr{padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:flex-start;justify-content:space-between;position:sticky;top:0;background:#0f1419;z-index:10}
  .fb-mt{font-size:14px;font-weight:700}
  .fb-mx{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#94a3b8;padding:4px 10px;border-radius:8px;cursor:pointer;font-size:13px;flex-shrink:0;margin-left:8px}
  .fb-mbdy{padding:14px 18px;display:flex;flex-direction:column;gap:12px}
  .fb-mftr{padding:12px 18px;border-top:1px solid rgba(255,255,255,.07);display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:0;background:#0f1419}
  .fb-field{display:flex;flex-direction:column;gap:4px}
  .fb-lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
  .fb-inp{background:#161d24;border:1px solid #243040;color:#e2e8f0;padding:9px 11px;border-radius:7px;font-size:13px;font-family:monospace;outline:none;width:100%;transition:border-color .15s}
  .fb-inp:focus{border-color:#f97316}
  .fb-inp.err{border-color:#f43f5e}
  .fb-inp.warn{border-color:#f59e0b}
  .fb-inp.ok{border-color:#10b981}
  .fb-sel{background:#161d24;border:1px solid #243040;color:#e2e8f0;padding:9px 11px;border-radius:7px;font-size:12px;outline:none;width:100%;font-family:inherit;cursor:pointer}
  .fb-sel:focus{border-color:#f97316}
  .fb-infobox{background:#080c10;border-radius:8px;padding:10px 12px;font-size:12px;color:#94a3b8;line-height:1.7;border:1px solid rgba(255,255,255,.05)}
  .fb-okbox{background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:8px;padding:12px;text-align:center}
  .fb-errbox{background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.25);border-radius:8px;padding:10px 12px;font-size:12px;color:#f43f5e;line-height:1.6}
  .fb-warnbox{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:10px 12px;font-size:12px;color:#f59e0b;line-height:1.6}
  .fb-infobox2{background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:10px 12px;font-size:12px;color:#93c5fd;line-height:1.6}
  .fb-toggle{width:36px;height:20px;background:#243040;border-radius:99px;position:relative;cursor:pointer;transition:background .2s;border:none;flex-shrink:0}
  .fb-toggle.on{background:#f97316}
  .fb-toggle::after{content:'';position:absolute;width:14px;height:14px;background:white;border-radius:50%;top:3px;left:3px;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
  .fb-toggle.on::after{left:19px}
  .fb-trow{display:flex;align-items:center;gap:10px;padding:4px 0}
  .fb-trow-label{font-size:12px;color:#94a3b8;flex:1}
  .fb-trow-desc{font-size:10px;color:#475569;margin-top:1px}
  .fb-svc-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  @media(max-width:480px){.fb-svc-grid{grid-template-columns:1fr}}
  .fb-svc-card{background:#080c10;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px 12px;cursor:pointer;transition:border-color .15s;display:flex;align-items:flex-start;gap:10px}
  .fb-svc-card:hover{border-color:rgba(255,255,255,.15)}
  .fb-svc-card.sel-gls{border-color:#f97316;background:rgba(249,115,22,.08)}
  .fb-svc-card.sel-sd{border-color:#3b82f6;background:rgba(59,130,246,.08)}
  .fb-svc-check{width:16px;height:16px;border-radius:4px;border:2px solid #334155;flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center;transition:all .15s}
  .fb-svc-card.sel-gls .fb-svc-check{background:#f97316;border-color:#f97316}
  .fb-svc-card.sel-sd .fb-svc-check{background:#3b82f6;border-color:#3b82f6}
  .fb-svc-body{flex:1;min-width:0}
  .fb-svc-label{font-size:12px;font-weight:700;color:#e2e8f0}
  .fb-svc-desc{font-size:10px;color:#64748b;margin-top:2px;line-height:1.4}
  .fb-svc-input{margin-top:6px}
  .fb-btn-p{background:#f97316;color:white;border:none;padding:9px 18px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;transition:background .15s}
  .fb-btn-p:hover:not(:disabled){background:#ea580c}
  .fb-btn-p:disabled{opacity:.4;cursor:not-allowed}
  .fb-btn-p.blue{background:#3b82f6}
  .fb-btn-p.blue:hover:not(:disabled){background:#2563eb}
  .fb-btn-p.green{background:#10b981}
  .fb-btn-p.green:hover:not(:disabled){background:#059669}
  .fb-btn-g{background:rgba(255,255,255,.05);color:#94a3b8;border:1px solid rgba(255,255,255,.1);padding:9px 18px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .15s}
  .fb-btn-g:hover{background:rgba(255,255,255,.08)}
  .fb-progress-wrap{background:#1e2a35;border-radius:99px;height:6px;overflow:hidden;margin:8px 0}
  .fb-progress-bar{height:100%;border-radius:99px;background:#f97316;transition:width .3s}
  .fb-addr-tag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(244,63,94,.15);color:#f43f5e;cursor:pointer;border:1px solid rgba(244,63,94,.3);font-family:inherit}
  .fb-sett-card{background:#080c10;border:1px solid rgba(255,255,255,.07);border-radius:10px;overflow:hidden}
  .fb-sett-hdr{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.05);display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;flex-wrap:wrap}
  .fb-sett-body{padding:14px;display:flex;flex-direction:column;gap:10px}
  .fb-section-title{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px;margin-top:6px}
  .fb-bnav{position:fixed;bottom:0;left:0;right:0;z-index:200;background:rgba(7,9,14,.97);backdrop-filter:blur(24px);border-top:1px solid rgba(255,255,255,.06)}
  .fb-bni{display:grid;grid-template-columns:repeat(5,1fr);height:62px}
  .fb-bn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#475569;text-decoration:none;font-size:9px;font-weight:700;text-transform:uppercase;cursor:pointer;background:none;border:none;padding:4px 2px}
  .fb-bn.active{color:#f97316}
  .fb-bnic{font-size:20px}
  .toast-container{position:fixed;bottom:74px;right:12px;display:flex;flex-direction:column;gap:6px;z-index:9999;max-width:320px}
  .fb-toast{background:#0f1419;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 14px;font-size:12px;font-weight:600;animation:toastIn .2s ease;box-shadow:0 8px 32px rgba(0,0,0,.5)}
  .fb-toast.success{border-left:3px solid #10b981}
  .fb-toast.error{border-left:3px solid #f43f5e}
  .fb-toast.info{border-left:3px solid #3b82f6}
  @keyframes toastIn{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}
  @keyframes spin{to{transform:rotate(360deg)}}
  .fb-spin{animation:spin .7s linear infinite;display:inline-block}
  .fb-divider{height:1px;background:rgba(255,255,255,.06);margin:4px 0}
  .fb-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  @media(max-width:480px){.fb-grid2{grid-template-columns:1fr}}
  .fb-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
  @media(max-width:600px){.fb-grid3{grid-template-columns:1fr 1fr}}
  .hmob{} @media(max-width:700px){.hmob{display:none}}
  .fb-addr-info{font-size:11px;color:#64748b;margin-top:2px;line-height:1.4}
`;

// BUGFIX: nu apela direct Shopify din browser — CORS blocat!
// Trebuie să treacă prin API-ul nostru server-side
async function updateShopifyAddress(domain, token, orderId, addrData) {
  const res = await fetch('/api/orders', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, token, orderId, shippingAddress: addrData }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Shopify update ${res.status}: ${txt.slice(0, 200)}`);
  }
  return true;
}

export default function FulfillmentPage() {
  const [domain]    = useState(()=>ls.get('gx_d')||'');
  const [shopToken] = useState(()=>ls.get('gx_t')||'');
  const [orders,setOrders]   = useState([]);
  const [loading,setLoading] = useState(false);
  const [error,setError]     = useState('');
  const [search,setSearch]   = useState('');
  const [filterStatus,setFilterStatus] = useState('pending');

  // GLS config
  const [glsUser,setGlsUser]     = useState(()=>ls.get('fb_gls_user')||'');
  const [glsPass,setGlsPass]     = useState(()=>ls.get('fb_gls_pass')||'');
  const [glsClient,setGlsClient] = useState(()=>ls.get('fb_gls_client')||'');
  const [glsEnvOk,setGlsEnvOk]   = useState(false);
  const [glsStatus,setGlsStatus] = useState('idle');
  const [glsStatusMsg,setGlsStatusMsg] = useState('');

  // Sameday config
  const [sdUser,setSdUser]       = useState(()=>ls.get('fb_sd_user')||'');
  const [sdPass,setSdPass]       = useState(()=>ls.get('fb_sd_pass')||'');
  const [sdPickup,setSdPickup]   = useState(()=>ls.get('fb_sd_pickup')||'');
  const [sdService,setSdService] = useState(()=>ls.get('fb_sd_service')||'');
  const [sdConfig,setSdConfig]   = useState({ pickupPoints:[], services:[] });
  const [sdEnvOk,setSdEnvOk]     = useState(false);
  const [sdStatus,setSdStatus]   = useState('idle');
  const [sdStatusMsg,setSdStatusMsg] = useState('');

  // SmartBill config
  const [sbEmail,setSbEmail]         = useState(()=>ls.get('sb_email')||'');
  const [sbToken,setSbToken]         = useState(()=>ls.get('sb_token')||'');
  const [sbCif,setSbCif]             = useState(()=>ls.get('sb_cif')||'');
  const [sbSeries,setSbSeries]       = useState(()=>ls.get('sb_inv_series')||'');
  const [sbSeriesList,setSbSeriesList] = useState([]);
  const [sbWarehouse,setSbWarehouse] = useState(()=>ls.get('sb_warehouse')||'');
  const [sbWarehouses,setSbWarehouses] = useState([]);
  const [sbUseStock,setSbUseStock]   = useState(()=>ls.get('sb_use_stock')==='true');
  const [sbPaySeries,setSbPaySeries] = useState(()=>ls.get('sb_pay_series')||'');

  const [awbResults,setAwbResultsRaw] = useState(()=>{
    try { const s=ls.get('fb_awb_results'); return s?JSON.parse(s):{};} catch{return {};}
  });
  const [awbLoading,setAwbLoading] = useState({});
  const [invResults,setInvResultsRaw] = useState(()=>{
    try { const s=ls.get('fb_inv_results'); return s?JSON.parse(s):{};} catch{return {};}
  });
  const [invLoading,setInvLoading] = useState({});

  // Wrapper-e care salvează în localStorage automat
  const setAwbResults = useCallback((updater) => {
    setAwbResultsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { ls.set('fb_awb_results', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const setInvResults = useCallback((updater) => {
    setInvResultsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { ls.set('fb_inv_results', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const [awbModal,setAwbModal]     = useState(null);
  const [invModal,setInvModal]     = useState(null);
  const [addrModal,setAddrModal]   = useState(null);
  const [settingsOpen,setSettingsOpen] = useState(false);
  const [bulkModal,setBulkModal]   = useState(false);
  const [bulkProgress,setBulkProgress] = useState({ running:false, done:0, total:0, errors:[] });
  const [bulkCourier,setBulkCourier] = useState('gls');
  const [bulkWeight,setBulkWeight] = useState('1');
  const [bulkDoAwb,setBulkDoAwb]   = useState(true);
  const [bulkDoInv,setBulkDoInv]   = useState(false);
  // ZIP validation results per order id
  const [zipIssues,setZipIssues]   = useState({});

  const { toasts, add:toast } = useToast();

  // ── Validare ZIP automată pentru comenzile din tabel ─────────────────────────
  const validateZipBatch = useCallback(async(orderList)=>{
    // Validează primele 30 comenzi fără AWB — în background, câte 3 deodată
    const toValidate = orderList.filter(o=>!o.trackingNo && o.address && o.city && o.zip);
    const chunks = [];
    for (let i=0;i<Math.min(toValidate.length,30);i+=3) chunks.push(toValidate.slice(i,i+3));
    for (const chunk of chunks) {
      await Promise.all(chunk.map(async o=>{
        try {
          const res=await fetch('/api/validate-address',{
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ address:o.address, city:o.city, county:o.county, zip:o.zip, phone:o.phone, skipEmpty:true }),
          });
          const data=await res.json();
          const zipErr = (data.issues||[]).find(i=>i.field==='zip'&&i.severity==='error');
          const suggestion = data.suggestion;
          if (zipErr||suggestion?.zipMismatch) {
            setZipIssues(prev=>({...prev,[o.id]:{ msg:zipErr?.msg||suggestion?.zipMessage, correct:suggestion?.postcode||null }}));
            // Adaugă și în addrIssues pentru filtrul din tabel
            setOrders(prev=>prev.map(x=>x.id===o.id?{...x,addrIssues:[...(x.addrIssues||[]).filter(i=>!i.includes('poștal')&&!i.includes('ZIP')), zipErr?.msg||suggestion?.zipMessage]}:x));
          }
        } catch{}
      }));
      await new Promise(r=>setTimeout(r,300)); // pauză între chunk-uri
    }
  },[]);

  // ── Fetch comenzi ──────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async()=>{
    if (!domain||!shopToken) { setError('Conectează-te din pagina principală.'); return; }
    setLoading(true); setError('');
    try {
      const d30=toISO(new Date(Date.now()-30*24*60*60*1000));
      const res=await fetch(`/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(shopToken)}&created_at_min=${d30}`);
      const data=await res.json();
      if (!res.ok||!data.orders) throw new Error(data.error||'Eroare Shopify');
      const processed = data.orders.map(procOrder);
      setOrders(processed);
      // Validare ZIP în background după ce comenzile s-au încărcat
      setTimeout(()=>validateZipBatch(processed), 500);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  },[domain,shopToken]);

  useEffect(()=>{ fetchOrders(); },[fetchOrders]);

  // Auto-detectare credențiale din ENV vars
  useEffect(()=>{
    fetch('/api/gls').then(r=>r.json()).then(d=>{
      if (d.configured) {
        setGlsEnvOk(true);
        if (d.clientNumber) setGlsClient(prev=>prev||d.clientNumber);
      }
    }).catch(()=>{});

    fetch('/api/sameday-awb').then(r=>r.json()).then(d=>{
      if (d.configured&&d.ok) {
        setSdEnvOk(true);
        if (d.pickupPoints?.length) {
          setSdConfig({ pickupPoints:d.pickupPoints, services:d.services||[] });
          setSdPickup(prev=>prev||(d.pickupPoints[0]?.id?String(d.pickupPoints[0].id):''));
          setSdService(prev=>prev||(d.services?.[0]?.id?String(d.services[0].id):''));
        }
      }
    }).catch(()=>{});
  },[]); // eslint-disable-line

  // ── SmartBill serii ────────────────────────────────────────────────────────
  const loadSbSeries = useCallback(async()=>{
    if (!sbEmail||!sbToken||!sbCif) return;
    try {
      const res=await fetch(`/api/smartbill-invoice?email=${encodeURIComponent(sbEmail)}&token=${encodeURIComponent(sbToken)}&cif=${encodeURIComponent(sbCif)}`);
      const data=await res.json();
      if (data.series?.length) { setSbSeriesList(data.series); if(!sbSeries)setSbSeries(data.series[0]); }
      if (data.warehouses?.length) { setSbWarehouses(data.warehouses); if(!sbWarehouse)setSbWarehouse(data.warehouses[0]); }
      toast('SmartBill conectat!','success');
    } catch(e) { toast('SmartBill: '+e.message,'error'); }
  },[sbEmail,sbToken,sbCif,sbSeries,sbWarehouse,toast]);

  const saveSettings = ()=>{
    ls.set('fb_gls_user',glsUser); ls.set('fb_gls_pass',glsPass); ls.set('fb_gls_client',glsClient);
    ls.set('fb_sd_user',sdUser); ls.set('fb_sd_pass',sdPass);
    ls.set('fb_sd_pickup',sdPickup); ls.set('fb_sd_service',sdService);
    ls.set('sb_email',sbEmail); ls.set('sb_token',sbToken); ls.set('sb_cif',sbCif);
    ls.set('sb_inv_series',sbSeries); ls.set('sb_warehouse',sbWarehouse);
    ls.set('sb_use_stock',String(sbUseStock)); ls.set('sb_pay_series',sbPaySeries);
    toast('Setări salvate!','success'); setSettingsOpen(false);
  };

  // ── Test GLS ───────────────────────────────────────────────────────────────
  const testGls = async()=>{
    setGlsStatus('testing'); setGlsStatusMsg('');
    const user=glsUser||''; const pass=glsPass||''; const client=glsClient||'553003585';
    if (!user||!pass) { setGlsStatus('error'); setGlsStatusMsg('✗ Completează username și parola.'); toast('Completează credențialele GLS.','error'); return; }
    try {
      const res=await fetch('/api/gls',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ action:'test_connection',username:user,password:pass,clientNumber:client }) });
      const data=await res.json();
      if (data.ok) {
        setGlsStatus('ok'); setGlsEnvOk(true);
        if (data.clientNumber) setGlsClient(data.clientNumber);
        setGlsStatusMsg('✓ '+(data.message||'GLS conectat!'));
        toast('GLS conectat!','success');
      } else {
        setGlsStatus('error'); setGlsStatusMsg('✗ '+(data.error||'Eroare'));
        toast('GLS: '+(data.error||'eroare'),'error');
      }
    } catch(e) { setGlsStatus('error'); setGlsStatusMsg('✗ '+e.message); toast('GLS: '+e.message,'error'); }
  };

  // ── Test Sameday ───────────────────────────────────────────────────────────
  const testSd = async()=>{
    setSdStatus('testing'); setSdStatusMsg('');
    const user=sdUser||''; const pass=sdPass||'';
    if (!user||!pass) { setSdStatus('error'); setSdStatusMsg('✗ Completează username și parola.'); toast('Completează credențialele Sameday.','error'); return; }
    try {
      const res=await fetch('/api/sameday-awb',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ action:'test_connection',username:user,password:pass }) });
      const data=await res.json();
      if (data.ok) {
        setSdStatus('ok'); setSdEnvOk(true);
        const pts=data.pickupPoints||[]; const svcs=data.services||[];
        if (pts.length) {
          setSdConfig({ pickupPoints:pts, services:svcs });
          setSdPickup(prev=>prev||(pts[0]?.id?String(pts[0].id):''));
          setSdService(prev=>prev||(svcs[0]?.id?String(svcs[0].id):''));
        }
        setSdStatusMsg(`✓ Conectat! ${pts.length} pickup points, ${svcs.length} servicii`);
        toast(`Sameday conectat! ${pts.length} pickup points.`,'success');
      } else {
        setSdStatus('error'); setSdStatusMsg('✗ '+(data.error||'Credențiale invalide'));
        toast('Sameday: '+(data.error||'credențiale invalide'),'error');
      }
    } catch(e) { setSdStatus('error'); setSdStatusMsg('✗ '+e.message); toast('Sameday: '+e.message,'error'); }
  };

  // ── Validare adresă API ────────────────────────────────────────────────────
  const validateAddrApi = async(fields, skipEmpty=false)=>{
    setAddrModal(p=>p?{...p,validating:true,apiIssues:[],suggestion:null}:null);
    try {
      const res=await fetch('/api/validate-address',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ ...fields, skipEmpty }),
      });
      const data=await res.json();
      setAddrModal(p=>p?{...p,apiIssues:data.issues||[],suggestion:data.suggestion||null,validating:false}:null);
    } catch(e) {
      setAddrModal(p=>p?{...p,validating:false,apiIssues:[{field:'',severity:'error',msg:'Eroare validare: '+e.message}]}:null);
    }
  };

  const openAddrModal=(order)=>{
    const editAddr={
      name:order.client, address:order.address, address2:order.address2||'',
      city:order.city, county:order.county, zip:order.zip, phone:order.phone,
    };
    setAddrModal({ order, editAddr, apiIssues:[], suggestion:null, saving:false, validating:false });
    setTimeout(()=>validateAddrApi(editAddr,true),300);
  };

  const validateRef=useRef(null);
  const onAddrChange=(key,value)=>{
    setAddrModal(p=>{
      if (!p) return null;
      const newFields={...p.editAddr,[key]:value};
      clearTimeout(validateRef.current);
      validateRef.current=setTimeout(()=>validateAddrApi(newFields,false),700);
      return {...p,editAddr:newFields,suggestion:null};
    });
  };

  const applyAddrSuggestion=()=>{
    if (!addrModal?.suggestion) return;
    const s=addrModal.suggestion;
    setAddrModal(p=>({
      ...p,
      editAddr:{
        ...p.editAddr,
        county:s.county||p.editAddr.county,
        zip:s.postcode||p.editAddr.zip,
        city:s.city||p.editAddr.city,
        address:s.formattedAddress||p.editAddr.address,
      },
      suggestion:null, apiIssues:[],
    }));
  };

  // ── Salvare adresă Shopify ─────────────────────────────────────────────────
  const saveAddress=async(order,newAddr)=>{
    setAddrModal(p=>p?{...p,saving:true}:null);
    try {
      await updateShopifyAddress(domain,shopToken,order.id,{
        name:newAddr.name, address1:newAddr.address, address2:newAddr.address2||'',
        city:newAddr.city, province:newAddr.county, zip:newAddr.zip,
        country:'Romania', phone:newAddr.phone,
      });
      setOrders(prev=>prev.map(o=>o.id===order.id?{...o,...newAddr,addrIssues:validateAddrLocal(newAddr)}:o));
      toast('Adresă actualizată în Shopify!','success');
      setAddrModal(null);
    } catch(e) { toast('Eroare: '+e.message,'error'); setAddrModal(p=>p?{...p,saving:false}:null); }
  };

  // ── Generare AWB ───────────────────────────────────────────────────────────
  const generateAwb=async(order,options)=>{
    const { courier, weight, parcels, manualAwb, selectedServices, sdOptions, lockerId, senderEasyboxId, observation } = options;
    setAwbLoading(p=>({...p,[order.id]:true}));
    setAwbResults(p=>({...p,[order.id]:null}));
    try {
      if (courier==='gls') {
        // BUGFIX: trimite TOATE câmpurile de adresă inclusiv county și zip curățat
        const body={
          username:glsUser, password:glsPass, clientNumber:glsClient,
          recipientName:order.client,
          phone:order.phone,
          email:order.email||'',
          address:order.address,
          city:order.city,
          county:order.county,   // BUGFIX: era omis înainte
          zip:(order.zip||'').replace(/\s/g,''),  // BUGFIX: ZIP fără spații
          weight:parseFloat(weight)||1,
          parcels:parseInt(parcels)||1,
          content:(order.prods||'Colet').slice(0,100),
          codAmount:order.isCOD?order.total:0,
          codCurrency:'RON',
          orderName:order.name,
          orderId:order.id,
          selectedServices,
          manualAwb:manualAwb||undefined,
        };
        const res=await fetch('/api/gls',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
        const data=await res.json();
        if (data.ok) {
          setAwbResults(p=>({...p,[order.id]:{
            ok:true, awb:data.awb, courier,
            labelBase64: data.labelBase64 || null,
            trackUrl: data.trackUrl || `https://gls-group.com/RO/ro/paket-verfolgen?match=${data.awb}`,
            myglsUrl: data.myglsUrl || `https://mygls.ro/Parcel/Detail/${data.awb}`,
            servicesApplied: data.servicesApplied||[],
            mode: data.mode,
          }}));
          setOrders(prev=>prev.map(o=>o.id===order.id?{...o,trackingNo:data.awb,courier}:o));
          toast(`AWB GLS ${data.awb} generat!`,'success');
        } else {
          setAwbResults(p=>({...p,[order.id]:{ok:false,error:data.error}}));
          toast(`Eroare GLS: ${data.error}`,'error');
        }
      } else {
        // BUGFIX: trimite TOATE câmpurile Sameday corect
        const body={
          username:sdUser, password:sdPass,
          pickupPointId:sdPickup||undefined,
          serviceId:sdService||undefined,
          lockerId:lockerId||undefined,
          senderEasyboxId:senderEasyboxId||undefined,
          recipientName:order.client,
          phone:order.phone,
          email:order.email||'',
          address:order.address,
          city:order.city,
          county:order.county,
          zip:(order.zip||'').replace(/\s/g,''),
          weight:parseFloat(weight)||1,
          parcels:parseInt(parcels)||1,
          content:(order.prods||'Colet').slice(0,100),
          isCOD:order.isCOD,
          total:order.total,
          orderName:order.name,
          orderId:order.id,
          observations:observation||(order.prods||'').slice(0,100)||`Comanda ${order.name}`,
          manualAwb:manualAwb||undefined,
          ...sdOptions,
        };
        const res=await fetch('/api/sameday-awb',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
        const data=await res.json();
        if (data.ok) {
          setAwbResults(p=>({...p,[order.id]:{ ok:true,awb:data.awb,courier,mode:data.mode }}));
          setOrders(prev=>prev.map(o=>o.id===order.id?{...o,trackingNo:data.awb,courier}:o));
          toast(`AWB Sameday ${data.awb} generat!`,'success');
        } else {
          setAwbResults(p=>({...p,[order.id]:{ok:false,error:data.error}}));
          toast(`Eroare Sameday: ${data.error}`,'error');
        }
      }
    } catch(e) {
      setAwbResults(p=>({...p,[order.id]:{ok:false,error:e.message}}));
      toast('Eroare rețea: '+e.message,'error');
    } finally { setAwbLoading(p=>({...p,[order.id]:false})); }
  };

  // ── Generare Factură ───────────────────────────────────────────────────────
  const generateInvoice=async(order,editItems,seriesOverride)=>{
    setInvLoading(p=>({...p,[order.id]:true}));
    setInvResults(p=>({...p,[order.id]:null}));
    setInvModal(null);
    try {
      const res=await fetch('/api/smartbill-invoice',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          email:sbEmail, token:sbToken, cif:sbCif,
          seriesName:seriesOverride||sbSeries||undefined,
          paymentSeries:sbPaySeries||undefined,
          shopifyDomain:domain, shopifyToken:shopToken,
          order:{
            id:order.id, name:order.name, client:order.client,
            address:order.address, city:order.city, county:order.county,
            country:'Romania', clientEmail:'', currency:order.currency||'RON',
            total:order.total, items:editItems||order.items||[],
            isPaid:order.fin==='paid',
            useStock:sbUseStock, warehouseName:sbUseStock?sbWarehouse:'',
          },
        }),
      });
      const data=await res.json();
      if (data.ok) {
        setInvResults(p=>({...p,[order.id]:{ ok:true,number:data.number,series:data.series,invoiceUrl:data.invoiceUrl,collected:data.collected }}));
        setOrders(prev=>prev.map(o=>o.id===order.id?{...o,hasInvoice:true,invoiceNumber:data.number,invoiceSeries:data.series,invoiceUrl:data.invoiceUrl}:o));
        toast(`Factura ${data.series}${data.number} emisă!`,'success');
      } else {
        setInvResults(p=>({...p,[order.id]:{ok:false,error:data.error}}));
        toast(`Eroare SmartBill: ${data.error}`,'error');
      }
    } catch(e) { setInvResults(p=>({...p,[order.id]:{ok:false,error:e.message}})); toast('Eroare: '+e.message,'error'); }
    finally { setInvLoading(p=>({...p,[order.id]:false})); }
  };

  // ── Bulk process ───────────────────────────────────────────────────────────
  const runBulk=async()=>{
    const targets=filteredOrders.filter(o=>!awbResults[o.id]?.ok);
    if (!targets.length) { toast('Nicio comandă de procesat.','info'); setBulkModal(false); return; }
    setBulkProgress({ running:true,done:0,total:targets.length,errors:[] });
    setBulkModal(false);
    const errors=[];
    for (let i=0;i<targets.length;i++) {
      const o=targets[i];
      try {
        if (bulkDoAwb&&!awbResults[o.id]?.ok&&!o.trackingNo) {
          await generateAwb(o,{ courier:bulkCourier,weight:bulkWeight,parcels:1,selectedServices:{},sdOptions:{} });
          await new Promise(r=>setTimeout(r,400));
        }
        if (bulkDoInv&&!invResults[o.id]?.ok&&!o.hasInvoice&&o.fin==='paid') {
          await generateInvoice(o,null,sbSeries);
          await new Promise(r=>setTimeout(r,500));
        }
      } catch(e) { errors.push(`${o.name}: ${e.message}`); }
      setBulkProgress(p=>({...p,done:i+1,errors}));
    }
    setBulkProgress(p=>({...p,running:false}));
    toast(`Bulk: ${targets.length-errors.length} succes, ${errors.length} erori.`,errors.length?'error':'success');
  };

  // ── Filtrare ───────────────────────────────────────────────────────────────
  const filteredOrders=orders.filter(o=>{
    if (filterStatus==='pending'&&o.trackingNo) return false;
    if (filterStatus==='shipped'&&!o.trackingNo) return false;
    if (filterStatus==='no-invoice'&&(o.hasInvoice||invResults[o.id]?.ok||o.fin!=='paid')) return false;
    if (filterStatus==='addr-issues'&&(!o.addrIssues||o.addrIssues.length===0)) return false;
    if (search) { const q=search.toLowerCase(); return [o.name,o.client,o.city,o.prods].some(v=>(v||'').toLowerCase().includes(q)); }
    return true;
  });

  const cntPending    = orders.filter(o=>!o.trackingNo).length;
  const cntNoInvoice  = orders.filter(o=>o.fin==='paid'&&!o.hasInvoice&&!invResults[o.id]?.ok).length;
  const cntShipped    = orders.filter(o=>o.trackingNo).length;
  const cntAddrIssues = orders.filter(o=>o.addrIssues&&o.addrIssues.length>0).length;

  return (
    <>
      <style>{CSS}</style>
      <div className="fb-page">

        {/* HEADER */}
        <div className="fb-hdr">
          <div className="fb-hrow">
            <a href="/" style={{background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',color:'#94a3b8',padding:'5px 12px',borderRadius:20,fontSize:11,fontWeight:700,textDecoration:'none'}}>← Comenzi</a>
            <div style={{flex:1,minWidth:0}}>
              <div className="fb-title">⚡ Fulfillment Bridge</div>
              <div className="fb-sub">AWB GLS · AWB Sameday · Facturi SmartBill · Validare adrese</div>
            </div>
            <button onClick={()=>{ setSettingsOpen(true); loadSbSeries(); }} className="fb-act fb-act-sm" style={{color:'#94a3b8',borderColor:'rgba(255,255,255,.15)'}}>⚙️ Setări</button>
            <button onClick={fetchOrders} className="fb-act fb-act-sm" style={{color:'#3b82f6',borderColor:'rgba(59,130,246,.3)'}} disabled={loading}>
              {loading?<span className="fb-spin">↻</span>:'↻ Sync'}
            </button>
          </div>
        </div>

        {error&&<div className="fb-errbox" style={{marginBottom:12}}>⚠️ {error} — <a href="/" style={{color:'#f97316'}}>conectează-te din pagina principală</a></div>}
        {loading&&<div style={{textAlign:'center',padding:40,color:'#64748b'}}><span className="fb-spin" style={{fontSize:28}}>↻</span><br/><div style={{marginTop:8,fontSize:12}}>Se încarcă comenzile...</div></div>}

        {/* BULK PROGRESS */}
        {bulkProgress.running&&(
          <div style={{background:'rgba(249,115,22,.06)',border:'1px solid rgba(249,115,22,.2)',borderRadius:10,padding:'12px 16px',marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:'#f97316',marginBottom:4}}>⚡ Procesare bulk...</div>
            <div className="fb-progress-wrap"><div className="fb-progress-bar" style={{width:`${bulkProgress.total?(bulkProgress.done/bulkProgress.total)*100:0}%`}}/></div>
            <div style={{fontSize:10,color:'#64748b'}}>{bulkProgress.done} / {bulkProgress.total}</div>
          </div>
        )}

        {/* KPIs */}
        {!loading&&orders.length>0&&(
          <div className="fb-kpis">
            <div className="fb-kpi"><div className="fb-kpi-v" style={{color:'#e2e8f0'}}>{orders.length}</div><div className="fb-kpi-l">Total 30 zile</div></div>
            <div className="fb-kpi clickable" onClick={()=>setFilterStatus('pending')} style={{borderColor:filterStatus==='pending'?'#f97316':''}}>
              <div className="fb-kpi-v" style={{color:'#f97316'}}>{cntPending}</div><div className="fb-kpi-l">Fără AWB</div>
            </div>
            <div className="fb-kpi clickable" onClick={()=>setFilterStatus('no-invoice')} style={{borderColor:filterStatus==='no-invoice'?'#10b981':''}}>
              <div className="fb-kpi-v" style={{color:'#10b981'}}>{cntNoInvoice}</div><div className="fb-kpi-l">Fără Factură</div>
            </div>
            <div className="fb-kpi clickable" onClick={()=>setFilterStatus('addr-issues')} style={{borderColor:filterStatus==='addr-issues'?'#f43f5e':''}}>
              <div className="fb-kpi-v" style={{color:cntAddrIssues>0?'#f43f5e':'#64748b'}}>{cntAddrIssues}</div><div className="fb-kpi-l">Adrese ⚠</div>
            </div>
            <div className="fb-kpi"><div className="fb-kpi-v" style={{color:'#3b82f6'}}>{cntShipped}</div><div className="fb-kpi-l">Expediate</div></div>
          </div>
        )}

        {/* ORDERS TABLE */}
        {!loading&&orders.length>0&&(
          <div className="fb-panel">
            <div className="fb-ph">
              <div><div className="fb-pt">Comenzi Shopify</div><div style={{fontSize:10,color:'#475569',marginTop:1}}>AWB + Factură + Validare adrese</div></div>
              <button onClick={()=>setBulkModal(true)} className="fb-btn-p" style={{fontSize:11,padding:'6px 14px'}}>⚡ Bulk ({filteredOrders.length})</button>
            </div>
            <div className="fb-filters">
              {[
                {id:'all',lbl:'Toate'},
                {id:'pending',lbl:`⚠ Fără AWB (${cntPending})`},
                {id:'no-invoice',lbl:`🧾 Fără factură (${cntNoInvoice})`},
                {id:'addr-issues',lbl:`📍 Adrese (${cntAddrIssues})`},
                {id:'shipped',lbl:`✅ Expediate (${cntShipped})`},
              ].map(f=>(
                <button key={f.id} className={`fb-fb ${filterStatus===f.id?'active':''}`} onClick={()=>setFilterStatus(f.id)}>{f.lbl}</button>
              ))}
              <input className="fb-search" placeholder="Caută comandă, client, oraș..." value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
            <div style={{overflowX:'auto'}}>
              <table className="fb-tbl">
                <thead><tr>
                  <th>Comandă</th>
                  <th>Client & Adresă</th>
                  <th className="hmob">Produse</th>
                  <th>Total</th>
                  <th className="hmob">Data</th>
                  <th>AWB</th>
                  <th>Factură</th>
                </tr></thead>
                <tbody>
                  {filteredOrders.length===0?(
                    <tr><td colSpan={7}><div style={{padding:40,textAlign:'center',color:'#334155',fontSize:12}}>📭 Nicio comandă în filtrul selectat.</div></td></tr>
                  ):filteredOrders.map(o=>{
                    const awbRes=awbResults[o.id]; const invRes=invResults[o.id];
                    const awbLoad=awbLoading[o.id]; const invLoad=invLoading[o.id];
                    const existingAwb=o.trackingNo||awbRes?.awb;
                    const existingInv=o.hasInvoice||invRes?.ok;
                    const hasIssues=o.addrIssues&&o.addrIssues.length>0;
                    const zipIssue = zipIssues[o.id];
                    return (
                      <tr key={o.id} className={hasIssues||zipIssue?'fb-warn':''}>
                        <td>
                          <div style={{fontFamily:'monospace',fontWeight:700,color:'#f97316',fontSize:12}}>{o.name}</div>
                          <div style={{fontSize:9,marginTop:3,display:'flex',gap:4,flexWrap:'wrap'}}>
                            {o.courier!=='unknown'&&existingAwb&&<span className={`fb-badge fb-badge-${o.courier==='sameday'?'sd':'gls'}`}>{o.courier.toUpperCase()}</span>}
                            {(hasIssues||zipIssue)&&<span style={{fontSize:9,color:'#f43f5e',fontWeight:700}}>⚠ adresă</span>}
                          </div>
                        </td>
                        <td>
                          <div style={{fontWeight:600,fontSize:12}}>{o.client||'—'}</div>
                          <div className="fb-addr-info">
                            {[o.address,o.city].filter(Boolean).join(', ')||'—'}
                            {o.county&&<span style={{color:'#475569'}}> · {o.county}</span>}
                            {o.zip&&<span style={{fontFamily:'monospace',color:zipIssue?'#f43f5e':'#334155',fontWeight:zipIssue?700:400}}> {o.zip}{zipIssue?' ⚠':''}</span>}
                          </div>
                          {/* ZIP issue — afișat direct în tabel */}
                          {zipIssue&&(
                            <div style={{marginTop:3,background:'rgba(244,63,94,.08)',border:'1px solid rgba(244,63,94,.25)',borderRadius:5,padding:'4px 7px'}}>
                              <div style={{fontSize:9,color:'#f43f5e',lineHeight:1.5,fontWeight:600}}>📮 {zipIssue.msg}</div>
                              {zipIssue.correct&&<div style={{fontSize:9,color:'#f59e0b',marginTop:1}}>Corect: <strong>{zipIssue.correct}</strong></div>}
                            </div>
                          )}
                          {hasIssues&&(
                            <div style={{marginTop:4}}>
                              {o.addrIssues.filter(i=>!i.includes('poștal')&&!i.includes('ZIP')&&!i.includes('437')&&!i.includes('430')).slice(0,2).map((iss,i)=>(
                                <div key={i} style={{fontSize:9,color:'#f43f5e',lineHeight:1.5}}>⚠ {iss}</div>
                              ))}
                              <button className="fb-addr-tag" style={{marginTop:4}} onClick={()=>openAddrModal(o)}>
                                ✏️ Corectează
                              </button>
                            </div>
                          )}
                          {!hasIssues&&zipIssue&&(
                            <button className="fb-addr-tag" style={{marginTop:4}} onClick={()=>openAddrModal(o)}>
                              ✏️ Corectează ZIP
                            </button>
                          )}
                        </td>
                        <td className="hmob" style={{fontSize:11,color:'#64748b',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={o.prods}>{(o.prods||'—').slice(0,55)}</td>
                        <td>
                          <div style={{fontFamily:'monospace',fontWeight:700,color:o.isCOD?'#f97316':'#3b82f6',fontSize:12}}>{fmt(o.total)} RON</div>
                          <div style={{fontSize:9,color:o.isCOD?'#f97316':'#3b82f6'}}>{o.isCOD?'💵 COD':'💳 Card'}</div>
                        </td>
                        <td className="hmob" style={{fontSize:10,color:'#64748b'}}>{fmtD(o.createdAt)}</td>
                        {/* AWB */}
                        <td>
                          {existingAwb?(
                            <div>
                              <div style={{fontFamily:'monospace',fontWeight:800,color:'#10b981',fontSize:12,letterSpacing:'-0.5px'}}>
                                {String(existingAwb)}
                              </div>
                              <div style={{display:'flex',gap:6,marginTop:4,flexWrap:'wrap'}}>
                                {/* PDF base64 dacă avem din generare curentă */}
                                {awbRes?.labelBase64 ? (
                                  <button onClick={()=>{
                                    try {
                                      const bin=atob(awbRes.labelBase64);
                                      const bytes=new Uint8Array(bin.length);
                                      for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
                                      const blob=new Blob([bytes],{type:'application/pdf'});
                                      const url=URL.createObjectURL(blob);
                                      const a=document.createElement('a');
                                      a.href=url; a.download=`AWB_GLS_${existingAwb}.pdf`; a.click();
                                      setTimeout(()=>URL.revokeObjectURL(url),1000);
                                    } catch(e){ alert('Eroare: '+e.message); }
                                  }} style={{background:'#10b981',border:'none',color:'white',borderRadius:5,padding:'4px 10px',fontSize:11,cursor:'pointer',fontWeight:700}}>
                                    ⬇ PDF
                                  </button>
                                ) : (
                                  // ÎNTOTDEAUNA arată buton MyGLS — merge și pentru AWB vechi
                                  <a href={`https://mygls.ro/Parcel/Detail/${existingAwb}`}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{background:'rgba(249,115,22,.2)',border:'1px solid #f97316',color:'#f97316',borderRadius:5,padding:'4px 10px',fontSize:11,fontWeight:700,textDecoration:'none',display:'inline-block'}}>
                                    ⬇ Etichetă
                                  </a>
                                )}
                                {/* Track — ÎNTOTDEAUNA vizibil */}
                                <a href={`https://gls-group.eu/RO/ro/urmarire-colet?match=${existingAwb}`}
                                  target="_blank" rel="noopener noreferrer"
                                  style={{background:'rgba(59,130,246,.15)',border:'1px solid #3b82f6',color:'#3b82f6',borderRadius:5,padding:'4px 10px',fontSize:11,fontWeight:700,textDecoration:'none',display:'inline-block'}}>
                                  📍 Track
                                </a>
                              </div>
                              {awbRes?.servicesApplied?.length>0&&<div style={{fontSize:8,color:'#475569',marginTop:3}}>{awbRes.servicesApplied.join(' · ')}</div>}
                              {awbRes?.mode==='manual'&&<div style={{fontSize:8,color:'#64748b'}}>manual</div>}
                            </div>
                          ):awbRes?.error?(
                            <div>
                              <div className="fb-errt" title={awbRes.error}>✗ {awbRes.error.slice(0,45)}</div>
                              <button className="fb-act fb-act-awb fb-act-sm" style={{marginTop:3}} onClick={()=>setAwbModal(o)}>↺ Retry</button>
                            </div>
                          ):(
                            <button className="fb-act fb-act-awb" disabled={awbLoad} onClick={()=>setAwbModal(o)}>
                              {awbLoad?<span className="fb-spin">↻</span>:'🚚 AWB'}
                            </button>
                          )}
                        </td>
                        {/* Factură */}
                        <td>
                          {existingInv?(
                            <div>
                              {(invRes?.invoiceUrl||o.invoiceUrl)?(
                                <a href={invRes?.invoiceUrl||o.invoiceUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:'#10b981',fontFamily:'monospace',fontWeight:700,textDecoration:'none'}}>
                                  ✓ {invRes?.series||o.invoiceSeries}{invRes?.number||o.invoiceNumber} ↗
                                </a>
                              ):<span className="fb-badge fb-badge-ok">✓ Facturat</span>}
                            </div>
                          ):invRes?.error?(
                            <div>
                              <div className="fb-errt" title={invRes.error}>✗ {invRes.error.slice(0,40)}</div>
                              <button className="fb-act fb-act-inv fb-act-sm" style={{marginTop:3}} onClick={()=>setInvModal({ order:o,editItems:o.items.length?[...o.items]:[{name:o.prods||'Produs',sku:'',qty:1,price:o.total}],seriesInput:sbSeries })}>↺ Retry</button>
                            </div>
                          ):o.fin==='paid'?(
                            <button className="fb-act fb-act-inv" disabled={invLoad} onClick={()=>setInvModal({ order:o,editItems:o.items.length?[...o.items.map(i=>({...i}))]:[{name:o.prods||'Produs',sku:'',qty:1,price:o.total}],seriesInput:sbSeries })}>
                              {invLoad?<span className="fb-spin">↻</span>:'🧾 Factură'}
                            </button>
                          ):<span style={{fontSize:10,color:'#334155'}}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── MODAL AWB ─────────────────────────────────────────────────────────── */}
      {awbModal&&(
        <AwbModal
          order={awbModal}
          glsUser={glsUser} glsPass={glsPass} glsClient={glsClient}
          sdUser={sdUser} sdPass={sdPass}
          sdConfig={sdConfig} sdPickup={sdPickup} sdService={sdService}
          onGenerate={(opts)=>{ generateAwb(awbModal,opts); setAwbModal(null); }}
          onCancel={()=>setAwbModal(null)}
        />
      )}

      {/* ── MODAL FACTURĂ ──────────────────────────────────────────────────────── */}
      {invModal&&(
        <div className="fb-overlay" onClick={e=>{if(e.target===e.currentTarget)setInvModal(null);}}>
          <div className="fb-modal" style={{maxWidth:540}}>
            <div className="fb-mhdr">
              <div>
                <div className="fb-mt">🧾 Factură SmartBill — {invModal.order.name}</div>
                <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{invModal.order.client} · {fmt(invModal.order.total)} RON{invModal.order.isCOD?' · COD':' · Card'}</div>
              </div>
              <button className="fb-mx" onClick={()=>setInvModal(null)}>✕</button>
            </div>
            <div className="fb-mbdy">
              {!sbEmail||!sbToken||!sbCif?(
                <div className="fb-warnbox">⚠️ Configurează credențialele SmartBill în Setări înainte de a emite facturi.</div>
              ):(
                <>
                  <div className="fb-field">
                    <div className="fb-lbl">Serie factură</div>
                    {sbSeriesList.length>0
                      ?<select className="fb-sel" value={invModal.seriesInput} onChange={e=>setInvModal(p=>({...p,seriesInput:e.target.value}))}>
                          {sbSeriesList.map(s=><option key={s} value={s}>{s}</option>)}
                        </select>
                      :<input className="fb-inp" value={invModal.seriesInput} placeholder="ex: FACT" onChange={e=>setInvModal(p=>({...p,seriesInput:e.target.value}))}/>
                    }
                  </div>
                  <div className="fb-section-title">Produse pe factură</div>
                  {invModal.editItems.map((item,idx)=>(
                    <div key={idx} style={{background:'#080c10',borderRadius:8,padding:'10px 12px',border:'1px solid rgba(255,255,255,.05)'}}>
                      <div className="fb-grid2" style={{marginBottom:6}}>
                        <div className="fb-field">
                          <div className="fb-lbl">Produs</div>
                          <input className="fb-inp" value={item.name} onChange={e=>setInvModal(p=>{const it=[...p.editItems];it[idx]={...it[idx],name:e.target.value};return{...p,editItems:it};})}/>
                        </div>
                        <div className="fb-field">
                          <div className="fb-lbl">SKU</div>
                          <input className="fb-inp" value={item.sku||''} onChange={e=>setInvModal(p=>{const it=[...p.editItems];it[idx]={...it[idx],sku:e.target.value};return{...p,editItems:it};})}/>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
                        <div className="fb-field" style={{width:70}}>
                          <div className="fb-lbl">Cant.</div>
                          <input type="number" min="1" className="fb-inp" value={item.qty} onChange={e=>setInvModal(p=>{const it=[...p.editItems];it[idx]={...it[idx],qty:parseInt(e.target.value)||1};return{...p,editItems:it};})}/>
                        </div>
                        <div className="fb-field" style={{width:110}}>
                          <div className="fb-lbl">Preț RON</div>
                          <input type="number" step="0.01" className="fb-inp" value={item.price} onChange={e=>setInvModal(p=>{const it=[...p.editItems];it[idx]={...it[idx],price:parseFloat(e.target.value)||0};return{...p,editItems:it};})}/>
                        </div>
                        <div style={{flex:1,textAlign:'right',fontFamily:'monospace',fontSize:12,color:'#f97316',fontWeight:700,paddingBottom:2}}>{fmt(item.qty*item.price)} RON</div>
                        {invModal.editItems.length>1&&<button onClick={()=>setInvModal(p=>({...p,editItems:p.editItems.filter((_,i)=>i!==idx)}))} style={{background:'rgba(244,63,94,.1)',border:'1px solid rgba(244,63,94,.3)',color:'#f43f5e',borderRadius:6,padding:'5px 8px',cursor:'pointer',fontSize:12}}>✕</button>}
                      </div>
                    </div>
                  ))}
                  <button onClick={()=>setInvModal(p=>({...p,editItems:[...p.editItems,{name:'',sku:'',qty:1,price:0}]}))} style={{background:'transparent',border:'1px dashed #243040',color:'#475569',borderRadius:8,padding:'7px',cursor:'pointer',fontSize:11,width:'100%'}}>+ Adaugă produs</button>
                  <div style={{borderTop:'1px solid #1e2a35',paddingTop:10}}>
                    <div style={{fontSize:10,color:'#64748b'}}>Total factură</div>
                    <div style={{fontSize:18,fontWeight:800,color:'#f97316',fontFamily:'monospace'}}>{fmt(invModal.editItems.reduce((s,i)=>s+i.qty*i.price,0))} RON</div>
                  </div>
                </>
              )}
            </div>
            <div className="fb-mftr">
              <button className="fb-btn-g" onClick={()=>setInvModal(null)}>Anulează</button>
              <button className="fb-btn-p green" disabled={!sbEmail||!sbToken||!sbCif||!invModal.seriesInput} onClick={()=>generateInvoice(invModal.order,invModal.editItems,invModal.seriesInput)}>⚡ Generează Factura</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL ADRESĂ ──────────────────────────────────────────────────────── */}
      {addrModal&&(
        <div className="fb-overlay" onClick={e=>{if(e.target===e.currentTarget)setAddrModal(null);}}>
          <div className="fb-modal" style={{maxWidth:480}}>
            <div className="fb-mhdr">
              <div>
                <div className="fb-mt">✏️ Corectare adresă — {addrModal.order.name}</div>
                <div style={{fontSize:11,color:'#475569',marginTop:2}}>Modificările se salvează în Shopify</div>
              </div>
              <button className="fb-mx" onClick={()=>setAddrModal(null)}>✕</button>
            </div>
            <div className="fb-mbdy">
              {/* Probleme detectate */}
              {(addrModal.apiIssues||[]).filter(i=>i.severity==='error').length>0&&(
                <div className="fb-errbox">
                  <div style={{fontWeight:700,marginBottom:5}}>⚠ Probleme detectate:</div>
                  {(addrModal.apiIssues||[]).filter(i=>i.severity==='error').map((iss,i)=>(
                    <div key={i} style={{lineHeight:1.7}}>• {iss.msg}</div>
                  ))}
                </div>
              )}
              {(addrModal.apiIssues||[]).filter(i=>i.severity==='warning').length>0&&(
                <div className="fb-warnbox">
                  {(addrModal.apiIssues||[]).filter(i=>i.severity==='warning').map((iss,i)=>(
                    <div key={i} style={{lineHeight:1.7}}>⚠ {iss.msg}</div>
                  ))}
                </div>
              )}

              {/* Sugestie ZIP mismatch */}
              {addrModal.suggestion&&(
                <div style={{
                  background: addrModal.suggestion.zipMismatch ? 'rgba(244,63,94,.07)' : 'rgba(16,185,129,.07)',
                  border: `1px solid ${addrModal.suggestion.zipMismatch ? 'rgba(244,63,94,.3)' : 'rgba(16,185,129,.25)'}`,
                  borderRadius:10, padding:'12px 14px',
                }}>
                  <div style={{fontSize:11,color:addrModal.suggestion.zipMismatch?'#f43f5e':'#10b981',fontWeight:700,marginBottom:8}}>
                    {addrModal.suggestion.zipMessage}
                  </div>
                  {addrModal.suggestion.county&&(
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{flex:1,fontSize:12,color:'#94a3b8'}}>
                        Județ corect pentru ZIP {addrModal.editAddr.zip}: <strong style={{color:'#e2e8f0'}}>{addrModal.suggestion.county}</strong>
                      </div>
                      <button onClick={applyAddrSuggestion}
                        style={{background:addrModal.suggestion.zipMismatch?'#f43f5e':'#10b981',color:'white',border:'none',borderRadius:6,padding:'6px 16px',fontSize:12,fontWeight:700,cursor:'pointer',flexShrink:0}}>
                        Corectează
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Câmpuri adresă */}
              {[
                {key:'name',    label:'NUME DESTINATAR', ph:'Ion Popescu'},
                {key:'phone',   label:'TELEFON',         ph:'07XXXXXXXX'},
                {key:'address', label:'ADRESĂ (STR. + NR.)', ph:'Str. Exemplu nr. 10'},
                {key:'address2',label:'APARTAMENT / ETAJ (OPȚIONAL)', ph:'Ap. 3, Et. 2'},
                {key:'city',    label:'ORAȘ',             ph:'Baia Mare'},
                {key:'county',  label:'JUDEȚ',            ph:'Maramureș'},
                {key:'zip',     label:'COD POȘTAL',       ph:'430XXX'},
              ].map(({key,label,ph})=>{
                const apiErr=(addrModal.apiIssues||[]).find(i=>i.field===key&&i.severity==='error');
                const apiWarn=(addrModal.apiIssues||[]).find(i=>i.field===key&&i.severity==='warning');
                const cls=apiErr?'err':apiWarn?'warn':'';
                return (
                  <div key={key} className="fb-field">
                    <div className="fb-lbl" style={{color:apiErr?'#f43f5e':apiWarn?'#f59e0b':'#64748b',display:'flex',alignItems:'center',gap:6}}>
                      {label}
                      {key==='zip'&&addrModal.validating&&<span style={{fontSize:9,color:'#64748b'}}>⟳ verifică...</span>}
                    </div>
                    <input
                      className={`fb-inp ${cls}`}
                      value={addrModal.editAddr[key]||''} placeholder={ph}
                      style={{fontSize:14}}
                      onChange={e=>onAddrChange(key,e.target.value)}
                    />
                    {key==='zip'&&addrModal.editAddr.county&&addrModal.editAddr.zip&&addrModal.editAddr.zip.length===6&&!apiErr&&(
                      <div style={{fontSize:10,color:'#10b981',marginTop:2}}>✓ Format ZIP valid</div>
                    )}
                  </div>
                );
              })}

              {/* Status validare locală */}
              {(()=>{
                const rem=validateAddrLocal(addrModal.editAddr);
                if (rem.length>0) return (
                  <div className="fb-warnbox">
                    <div style={{fontWeight:700,marginBottom:4}}>⚠ Probleme rămase:</div>
                    {rem.map((r,i)=><div key={i} style={{fontSize:11,lineHeight:1.7}}>• {r}</div>)}
                  </div>
                );
                return (
                  <div className="fb-okbox">
                    <div style={{color:'#10b981',fontWeight:700,fontSize:13}}>✓ Adresa validă!</div>
                    <div style={{fontSize:11,color:'#6ee7b7',marginTop:3}}>Codul poștal corespunde județului</div>
                  </div>
                );
              })()}
            </div>
            <div className="fb-mftr">
              <button className="fb-btn-g" onClick={()=>setAddrModal(null)}>Anulează</button>
              <button className="fb-btn-p" disabled={addrModal.saving} onClick={()=>saveAddress(addrModal.order,addrModal.editAddr)} style={{flex:2}}>
                {addrModal.saving?'↻ Se salvează...':'💾 Salvează în Shopify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL BULK ─────────────────────────────────────────────────────────── */}
      {bulkModal&&(
        <div className="fb-overlay" onClick={e=>{if(e.target===e.currentTarget)setBulkModal(false);}}>
          <div className="fb-modal" style={{maxWidth:440}}>
            <div className="fb-mhdr"><div className="fb-mt">⚡ Procesare Bulk</div><button className="fb-mx" onClick={()=>setBulkModal(false)}>✕</button></div>
            <div className="fb-mbdy">
              <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.6}}>Procesează <strong style={{color:'#e2e8f0'}}>{filteredOrders.filter(o=>!awbResults[o.id]?.ok).length}</strong> comenzi fără AWB din filtrul curent.</div>
              <div className="fb-field"><div className="fb-lbl">Curier</div>
                <select className="fb-sel" value={bulkCourier} onChange={e=>setBulkCourier(e.target.value)}>
                  <option value="gls">📦 GLS Romania</option>
                  <option value="sameday">🚀 Sameday</option>
                </select>
              </div>
              <div className="fb-field"><div className="fb-lbl">Greutate standard (kg)</div><input type="number" step="0.1" min="0.1" className="fb-inp" value={bulkWeight} onChange={e=>setBulkWeight(e.target.value)}/></div>
              <div className="fb-trow"><span className="fb-trow-label">Generează AWB (comenzi fără AWB)</span><button className={`fb-toggle ${bulkDoAwb?'on':''}`} onClick={()=>setBulkDoAwb(v=>!v)}/></div>
              <div className="fb-trow"><span className="fb-trow-label">Emite facturi SmartBill (comenzi plătite)</span><button className={`fb-toggle ${bulkDoInv?'on':''}`} onClick={()=>setBulkDoInv(v=>!v)}/></div>
              <div className="fb-warnbox" style={{fontSize:11}}>⚠ Comenzile cu adrese invalide (cod poștal greșit, telefon lipsă) vor genera erori. Corectați adresele mai întâi.</div>
            </div>
            <div className="fb-mftr">
              <button className="fb-btn-g" onClick={()=>setBulkModal(false)}>Anulează</button>
              <button className="fb-btn-p" onClick={runBulk}>⚡ Procesează</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL SETĂRI ─────────────────────────────────────────────────────────── */}
      {settingsOpen&&(
        <div className="fb-overlay" onClick={e=>{if(e.target===e.currentTarget)setSettingsOpen(false);}}>
          <div className="fb-modal" style={{maxWidth:680}}>
            <div className="fb-mhdr">
              <div className="fb-mt">⚙️ Setări Integrări</div>
              <button className="fb-mx" onClick={()=>setSettingsOpen(false)}>✕</button>
            </div>
            <div className="fb-mbdy">

              {/* GLS */}
              <div className="fb-sett-card">
                <div className="fb-sett-hdr" style={{color:'#f97316'}}>
                  📦 GLS Romania
                  {glsStatus==='ok'&&<span style={{marginLeft:'auto',fontSize:10,background:'rgba(16,185,129,.15)',color:'#10b981',border:'1px solid rgba(16,185,129,.3)',padding:'3px 10px',borderRadius:10,fontWeight:700}}>✓ Conectat</span>}
                  {glsStatus==='error'&&<span style={{marginLeft:'auto',fontSize:10,background:'rgba(244,63,94,.15)',color:'#f43f5e',border:'1px solid rgba(244,63,94,.3)',padding:'3px 10px',borderRadius:10,fontWeight:700}}>✗ Eroare</span>}
                  {glsStatus==='testing'&&<span style={{marginLeft:'auto',fontSize:10,color:'#64748b'}}>⟳ Se testează...</span>}
                </div>
                <div className="fb-sett-body">
                  {glsEnvOk&&glsStatus!=='error'&&(
                    <div className="fb-infobox2">✓ Credențialele GLS sunt în <strong>Vercel ENV</strong> (GLS_USERNAME / GLS_PASSWORD). Poți lăsa câmpurile goale.</div>
                  )}
                  <div className="fb-grid2">
                    <div className="fb-field"><div className="fb-lbl">Username / App ID</div><input className="fb-inp" value={glsUser} onChange={e=>setGlsUser(e.target.value)} placeholder={glsEnvOk?'(din Vercel ENV)':'user@gls.ro'}/></div>
                    <div className="fb-field"><div className="fb-lbl">Parolă / API Secret</div><input type="password" className="fb-inp" value={glsPass} onChange={e=>setGlsPass(e.target.value)} placeholder={glsEnvOk?'(din Vercel ENV)':'••••••'}/></div>
                  </div>
                  <div className="fb-field">
                    <div className="fb-lbl">Număr Client GLS</div>
                    <input className="fb-inp" value={glsClient} onChange={e=>setGlsClient(e.target.value)} placeholder="553003585"/>
                    <div style={{fontSize:10,color:'#475569',marginTop:2}}>Numărul de client din contractul GLS (apare în MyGLS)</div>
                  </div>
                  {glsStatusMsg&&<div style={{fontSize:11,color:glsStatus==='ok'?'#10b981':'#f43f5e',background:glsStatus==='ok'?'rgba(16,185,129,.07)':'rgba(244,63,94,.07)',border:`1px solid ${glsStatus==='ok'?'rgba(16,185,129,.2)':'rgba(244,63,94,.2)'}`,borderRadius:7,padding:'7px 10px'}}>{glsStatusMsg}</div>}
                  <button className="fb-btn-g" style={{fontSize:12}} onClick={testGls} disabled={glsStatus==='testing'}>
                    {glsStatus==='testing'?'⟳ Se testează...':'🔌 Testează conexiunea GLS'}
                  </button>
                </div>
              </div>

              {/* SAMEDAY */}
              <div className="fb-sett-card">
                <div className="fb-sett-hdr" style={{color:'#3b82f6'}}>
                  🚀 Sameday
                  {sdStatus==='ok'&&<span style={{marginLeft:'auto',fontSize:10,background:'rgba(16,185,129,.15)',color:'#10b981',border:'1px solid rgba(16,185,129,.3)',padding:'3px 10px',borderRadius:10,fontWeight:700}}>✓ Conectat</span>}
                  {sdStatus==='error'&&<span style={{marginLeft:'auto',fontSize:10,background:'rgba(244,63,94,.15)',color:'#f43f5e',border:'1px solid rgba(244,63,94,.3)',padding:'3px 10px',borderRadius:10,fontWeight:700}}>✗ Eroare</span>}
                  {sdStatus==='testing'&&<span style={{marginLeft:'auto',fontSize:10,color:'#64748b'}}>⟳ Se testează...</span>}
                </div>
                <div className="fb-sett-body">
                  {sdEnvOk&&sdStatus!=='error'&&(
                    <div className="fb-infobox2">✓ Credențialele Sameday sunt în <strong>Vercel ENV</strong> (SAMEDAY_USERNAME / SAMEDAY_PASSWORD).</div>
                  )}
                  <div className="fb-grid2">
                    <div className="fb-field"><div className="fb-lbl">Username</div><input className="fb-inp" value={sdUser} onChange={e=>setSdUser(e.target.value)} placeholder={sdEnvOk?'(din Vercel ENV)':'username'}/></div>
                    <div className="fb-field"><div className="fb-lbl">Parolă</div><input type="password" className="fb-inp" value={sdPass} onChange={e=>setSdPass(e.target.value)} placeholder={sdEnvOk?'(din Vercel ENV)':'••••••'}/></div>
                  </div>
                  {sdStatusMsg&&<div style={{fontSize:11,color:sdStatus==='ok'?'#10b981':'#f43f5e',background:sdStatus==='ok'?'rgba(16,185,129,.07)':'rgba(244,63,94,.07)',border:`1px solid ${sdStatus==='ok'?'rgba(16,185,129,.2)':'rgba(244,63,94,.2)'}`,borderRadius:7,padding:'7px 10px'}}>{sdStatusMsg}</div>}
                  <button className="fb-btn-g" style={{fontSize:12}} onClick={testSd} disabled={sdStatus==='testing'}>
                    {sdStatus==='testing'?'⟳ Se testează...':'🔌 Testează conexiunea Sameday'}
                  </button>
                  {sdConfig.pickupPoints.length>0&&(
                    <div className="fb-grid2">
                      <div className="fb-field">
                        <div className="fb-lbl">Pickup Point ({sdConfig.pickupPoints.length} disponibile)</div>
                        <select className="fb-sel" value={sdPickup} onChange={e=>setSdPickup(e.target.value)}>
                          {sdConfig.pickupPoints.map(p=><option key={p.id} value={p.id}>{p.name}{p.city?` (${p.city})`:''}</option>)}
                        </select>
                      </div>
                      <div className="fb-field">
                        <div className="fb-lbl">Serviciu</div>
                        <select className="fb-sel" value={sdService} onChange={e=>setSdService(e.target.value)}>
                          {sdConfig.services.map(s=><option key={s.id} value={s.id}>{s.name}{s.isLocker?' 🔒':''}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* SMARTBILL */}
              <div className="fb-sett-card">
                <div className="fb-sett-hdr" style={{color:'#10b981'}}>🧾 SmartBill</div>
                <div className="fb-sett-body">
                  <div className="fb-grid3">
                    <div className="fb-field"><div className="fb-lbl">Email</div><input className="fb-inp" value={sbEmail} onChange={e=>setSbEmail(e.target.value)} placeholder="email@firma.ro"/></div>
                    <div className="fb-field"><div className="fb-lbl">Token API</div><input type="password" className="fb-inp" value={sbToken} onChange={e=>setSbToken(e.target.value)} placeholder="token"/></div>
                    <div className="fb-field"><div className="fb-lbl">CIF</div><input className="fb-inp" value={sbCif} onChange={e=>setSbCif(e.target.value)} placeholder="RO12345678"/></div>
                  </div>
                  <div className="fb-grid3">
                    <div className="fb-field">
                      <div className="fb-lbl">Serie Factură</div>
                      {sbSeriesList.length>0
                        ?<select className="fb-sel" value={sbSeries} onChange={e=>setSbSeries(e.target.value)}>{sbSeriesList.map(s=><option key={s}>{s}</option>)}</select>
                        :<input className="fb-inp" value={sbSeries} onChange={e=>setSbSeries(e.target.value)} placeholder="FACT"/>
                      }
                    </div>
                    <div className="fb-field"><div className="fb-lbl">Serie Chitanță</div><input className="fb-inp" value={sbPaySeries} onChange={e=>setSbPaySeries(e.target.value)} placeholder="CHT"/></div>
                    <div className="fb-field">
                      <div className="fb-lbl">Gestiune</div>
                      {sbWarehouses.length>0
                        ?<select className="fb-sel" value={sbWarehouse} onChange={e=>setSbWarehouse(e.target.value)}>{sbWarehouses.map(w=><option key={w}>{w}</option>)}</select>
                        :<input className="fb-inp" value={sbWarehouse} onChange={e=>setSbWarehouse(e.target.value)} placeholder="Depozit"/>
                      }
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
                    <div className="fb-trow" style={{gap:8}}>
                      <button className={`fb-toggle ${sbUseStock?'on':''}`} onClick={()=>setSbUseStock(v=>!v)}/>
                      <span style={{fontSize:12,color:'#94a3b8'}}>Descarcă stoc gestiune</span>
                    </div>
                    <button className="fb-btn-g" style={{fontSize:12}} onClick={loadSbSeries}>🔌 Testează SmartBill</button>
                  </div>
                </div>
              </div>

            </div>
            <div className="fb-mftr">
              <button className="fb-btn-g" onClick={()=>setSettingsOpen(false)}>Anulează</button>
              <button className="fb-btn-p" onClick={saveSettings}>💾 Salvează</button>
            </div>
          </div>
        </div>
      )}

      {/* TOASTS */}
      <div className="toast-container">
        {toasts.map(t=>(<div key={t.id} className={`fb-toast ${t.type}`}>{t.type==='success'?'✅':t.type==='error'?'❌':'ℹ️'} {t.msg}</div>))}
      </div>

      {/* BOTTOM NAV */}
      <nav className="fb-bnav"><div className="fb-bni">
        <a href="/" className="fb-bn"><span className="fb-bnic">📦</span>Comenzi</a>
        <a href="/fulfillment" className="fb-bn active"><span className="fb-bnic">⚡</span>Fulfillment</a>
        <a href="/profit" className="fb-bn"><span className="fb-bnic">💹</span>Profit</a>
        <a href="/stats" className="fb-bn"><span className="fb-bnic">📊</span>Stats</a>
        <a href="/whatsapp" className="fb-bn"><span className="fb-bnic">📱</span>WhatsApp</a>
      </div></nav>
    </>
  );
}

// ── AWB Modal ─────────────────────────────────────────────────────────────────
function AwbModal({ order, glsUser, glsPass, glsClient, sdUser, sdPass, sdConfig, sdPickup, sdService, onGenerate, onCancel }) {
  const [courier,setCourier] = useState(order.courier!=='unknown'?order.courier:'gls');
  const [weight,setWeight]   = useState('1');
  const [parcels,setParcels] = useState('1');
  const [manual,setManual]   = useState('');
  const [useManual,setUseManual] = useState(false);

  // GLS services
  const [glsSelected,setGlsSelected] = useState({});
  const [glsParams,setGlsParams]     = useState({});

  // Sameday options
  const [sdOpts,setSdOpts]     = useState({ openPackage:false,saturdayDelivery:false,thermo:false,repaymentTransport:false });
  const [sdObservation,setSdObservation] = useState('');

  // Sameday easybox — expeditor predă la easybox
  const [sdUseEasybox,setSdUseEasybox]       = useState(false);
  const [sdEasyboxId,setSdEasyboxId]         = useState('');
  const [sdLockerList,setSdLockerList]       = useState([]);
  const [sdLockerCounty,setSdLockerCounty]   = useState(order.county||'');
  const [sdLockerLoading,setSdLockerLoading] = useState(false);
  const [sdLockerError,setSdLockerError]     = useState('');

  const loadLockers=async()=>{
    if (!sdUser||!sdPass) { setSdLockerError('Configurează credențialele Sameday în Setări.'); return; }
    setSdLockerLoading(true); setSdLockerError(''); setSdLockerList([]);
    try {
      const res=await fetch('/api/sameday-awb',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ action:'get_lockers', username:sdUser, password:sdPass, county:sdLockerCounty }),
      });
      const data=await res.json();
      if (data.ok) {
        if (data.lockers?.length) setSdLockerList(data.lockers);
        else setSdLockerError(`Niciun easybox găsit în ${sdLockerCounty||'România'}. Încearcă alt județ.`);
      } else {
        setSdLockerError(data.error||'Eroare la căutare easybox');
      }
    } catch(e) { setSdLockerError('Eroare: '+e.message); }
    setSdLockerLoading(false);
  };

  const fmt2=n=>Number(n||0).toLocaleString('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2});
  const addrOk=order.addrIssues?.length===0;

  const toggleGls=(code)=>{
    const svc=GLS_SERVICES[code];
    setGlsSelected(p=>{
      const newVal=!p[code];
      if (newVal&&svc?.param) {
        setGlsParams(pp=>{
          // Pre-completează cu datele din comandă dacă câmpul e gol
          let defaultVal = pp[code];
          if (!defaultVal) {
            if (svc.param==='phone') defaultVal = order.phone||'';
            else if (svc.param==='email') defaultVal = order.email||''; // EMAIL DIN SHOPIFY automat
            else if (svc.param==='value') defaultVal = String(order.total);
            else defaultVal = '';
          }
          return { ...pp, [code]: defaultVal };
        });
      }
      return {...p,[code]:newVal};
    });
  };

  const buildGlsServices=()=>{
    const svc={};
    for (const [code,selected] of Object.entries(glsSelected)) {
      if (!selected) continue;
      const def=GLS_SERVICES[code];
      if (def.param==='phone') {
        // Trimite telefonul — dacă e completat manual în câmp, altfel cel din comandă
        svc[code] = glsParams[code] || order.phone || '';
      } else if (def.param==='email') {
        // FDS/SM2 — email. Dacă nu e completat, folosim un placeholder valid
        // GLS nu acceptă string gol pentru FDS, trimitem 'noreply@glamx.ro' ca fallback
        svc[code] = glsParams[code] || order.email || '';
      } else if (def.param==='value') {
        svc[code] = glsParams[code] || String(order.total);
      } else if (def.param==='shopId') {
        svc[code] = glsParams[code] || '';
      } else {
        // SAT, T12, AOS, DPV, SDS — fără parametru, trimitem true
        svc[code] = true;
      }
    }
    console.log('[AWB Modal] selectedServices:', JSON.stringify(svc));
    return svc;
  };

  const handleGenerate=()=>{
    onGenerate({
      courier, weight, parcels,
      manualAwb:useManual?manual:'',
      selectedServices:courier==='gls'?buildGlsServices():{},
      sdOptions:courier==='sameday'?sdOpts:{},
      senderEasyboxId:courier==='sameday'&&sdUseEasybox?sdEasyboxId:'',
      lockerId:'',
      observation:sdObservation,
    });
  };

  // Grupează GLS services
  const glsGroups={};
  for (const [code,svc] of Object.entries(GLS_SERVICES)) {
    if (!glsGroups[svc.group]) glsGroups[svc.group]=[];
    glsGroups[svc.group].push({code,...svc});
  }

  return (
    <div className="fb-overlay" onClick={e=>{if(e.target===e.currentTarget)onCancel();}}>
      <div className="fb-modal" style={{maxWidth:560}}>
        <div className="fb-mhdr">
          <div>
            <div className="fb-mt">🚚 Generare AWB — {order.name}</div>
            <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{order.client} · {order.city}</div>
          </div>
          <button className="fb-mx" onClick={onCancel}>✕</button>
        </div>
        <div className="fb-mbdy">

          {/* Info comandă */}
          <div className="fb-infobox" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <div>
              <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:.5}}>Client</div>
              <div style={{fontWeight:700,fontSize:12}}>{order.client}</div>
            </div>
            <div>
              <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:.5}}>Adresă completă</div>
              <div style={{fontSize:11,color:'#94a3b8',lineHeight:1.4}}>
                {order.address}<br/>
                {order.city}{order.county?`, ${order.county}`:''} {order.zip}
              </div>
            </div>
            <div>
              <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:.5}}>Total</div>
              <div style={{fontWeight:800,fontSize:13,color:order.isCOD?'#f97316':'#3b82f6',fontFamily:'monospace'}}>{fmt2(order.total)} RON {order.isCOD?'(COD)':'(CARD)'}</div>
            </div>
            <div>
              <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:.5}}>Telefon</div>
              <div style={{fontSize:11,fontFamily:'monospace',color:'#94a3b8'}}>{order.phone||'—'}</div>
            </div>
          </div>

          {!addrOk&&(
            <div className="fb-errbox">
              ⚠️ Adresă cu probleme! Corectează înainte de generare AWB:
              {order.addrIssues?.map((i,idx)=><div key={idx} style={{marginTop:2}}>• {i}</div>)}
            </div>
          )}

          {/* Curier */}
          <div>
            <div className="fb-lbl" style={{marginBottom:6}}>Curier</div>
            <div style={{display:'flex',gap:8}}>
              {[
                {id:'gls',label:'📦 GLS Romania',ok:!!(glsUser&&glsPass&&glsClient)||true},
                {id:'sameday',label:'🚀 Sameday',ok:!!(sdUser&&sdPass)||true},
              ].map(c=>(
                <button key={c.id} onClick={()=>setCourier(c.id)} style={{
                  flex:1, padding:'10px', borderRadius:8,
                  border:`2px solid ${courier===c.id?(c.id==='gls'?'#f97316':'#3b82f6'):'rgba(255,255,255,.08)'}`,
                  background:courier===c.id?(c.id==='gls'?'rgba(249,115,22,.1)':'rgba(59,130,246,.1)'):'transparent',
                  color:courier===c.id?(c.id==='gls'?'#f97316':'#3b82f6'):'#64748b',
                  fontWeight:700, fontSize:12, cursor:'pointer', transition:'all .15s',
                }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Greutate & colete */}
          <div className="fb-grid2">
            <div className="fb-field"><div className="fb-lbl">Greutate (kg)</div><input type="number" step="0.1" min="0.1" className="fb-inp" value={weight} onChange={e=>setWeight(e.target.value)}/></div>
            <div className="fb-field"><div className="fb-lbl">Nr. colete</div><input type="number" min="1" className="fb-inp" value={parcels} onChange={e=>setParcels(e.target.value)}/></div>
          </div>

          {/* ── GLS Services ── */}
          {courier==='gls'&&(
            <div>
              <div className="fb-section-title">Servicii suplimentare GLS (opțional)</div>
              {Object.entries(glsGroups).map(([group,svcs])=>(
                <div key={group} style={{marginBottom:10}}>
                  <div style={{fontSize:9,color:'#334155',textTransform:'uppercase',letterSpacing:.5,marginBottom:5}}>{group}</div>
                  <div className="fb-svc-grid">
                    {svcs.map(svc=>(
                      <div key={svc.code} className={`fb-svc-card ${glsSelected[svc.code]?'sel-gls':''}`} onClick={()=>toggleGls(svc.code)}>
                        <div className="fb-svc-check">{glsSelected[svc.code]&&<span style={{fontSize:10,color:'white',fontWeight:700}}>✓</span>}</div>
                        <div className="fb-svc-body">
                          <div className="fb-svc-label">{svc.label}</div>
                          <div className="fb-svc-desc">{svc.desc}</div>
                          {glsSelected[svc.code]&&svc.param&&(
                            <div onClick={e=>e.stopPropagation()} style={{marginTop:6}}>
                              <input
                                className="fb-inp fb-svc-input"
                                style={{
                                  fontSize:11, padding:'5px 8px',
                                  borderColor: svc.param==='email'
                                    ? (glsParams[svc.code]||order.email) ? '#10b981' : '#f43f5e'
                                    : undefined,
                                }}
                                placeholder={
                                  svc.param==='phone' ? (order.phone||'07XXXXXXXX') :
                                  svc.param==='email' ? (order.email ? `${order.email} (din Shopify)` : 'email@client.com') :
                                  svc.param==='value' ? String(order.total) : 'ID shop'
                                }
                                value={glsParams[svc.code] || (svc.param==='phone' ? (order.phone||'') : svc.param==='email' ? (order.email||'') : '')}
                                onChange={e=>setGlsParams(p=>({...p,[svc.code]:e.target.value}))}
                              />
                              {svc.param==='email' && (glsParams[svc.code]||order.email) && (
                                <div style={{fontSize:9,color:'#10b981',marginTop:2}}>
                                  ✓ Email: {glsParams[svc.code]||order.email}
                                </div>
                              )}
                              {svc.param==='email' && !(glsParams[svc.code]||order.email) && (
                                <div style={{fontSize:9,color:'#f43f5e',marginTop:2}}>⚠ Email obligatoriu — completează manual</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Sameday Options ── */}
          {courier==='sameday'&&(
            <div>
              {/* MOD PREDARE */}
              <div className="fb-section-title">Mod predare colet</div>
              <div className="fb-grid2" style={{marginBottom:12}}>
                <div className={`fb-svc-card ${!sdUseEasybox?'sel-sd':''}`} onClick={()=>setSdUseEasybox(false)}>
                  <div className="fb-svc-check">{!sdUseEasybox&&<span style={{fontSize:10,color:'white',fontWeight:700}}>✓</span>}</div>
                  <div className="fb-svc-body">
                    <div className="fb-svc-label">🚚 Ridicare de curier</div>
                    <div className="fb-svc-desc">Curierul Sameday ridică coletul de la adresa ta de pickup</div>
                  </div>
                </div>
                <div className={`fb-svc-card ${sdUseEasybox?'sel-sd':''}`} onClick={()=>setSdUseEasybox(true)}>
                  <div className="fb-svc-check">{sdUseEasybox&&<span style={{fontSize:10,color:'white',fontWeight:700}}>✓</span>}</div>
                  <div className="fb-svc-body">
                    <div className="fb-svc-label">📦 Predare la easybox</div>
                    <div className="fb-svc-desc">Depui coletul la un easybox Sameday (Locker NextDay)</div>
                  </div>
                </div>
              </div>

              {/* Selectare easybox */}
              {sdUseEasybox&&(
                <div className="fb-infobox2" style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:'#3b82f6',fontWeight:700,marginBottom:8}}>📦 Selectează easybox-ul unde depui coletul</div>

                  {sdLockerList.length===0?(
                    <div>
                      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
                        <div className="fb-field" style={{flex:1,minWidth:120}}>
                          <div className="fb-lbl" style={{color:'#93c5fd'}}>Județ</div>
                          <input className="fb-inp" style={{background:'rgba(59,130,246,.1)',borderColor:'rgba(59,130,246,.3)'}}
                            placeholder="ex: Cluj, Maramureș, Ilfov..."
                            value={sdLockerCounty} onChange={e=>setSdLockerCounty(e.target.value)}
                            onKeyDown={e=>e.key==='Enter'&&loadLockers()}
                          />
                        </div>
                        <div style={{paddingTop:14}}>
                          <button className="fb-btn-p blue" style={{fontSize:11,padding:'8px 14px',whiteSpace:'nowrap'}} onClick={loadLockers} disabled={sdLockerLoading}>
                            {sdLockerLoading?<span className="fb-spin">↻</span>:'🔍 Caută easybox'}
                          </button>
                        </div>
                      </div>
                      {sdLockerError&&<div style={{fontSize:11,color:'#f43f5e'}}>{sdLockerError}</div>}
                    </div>
                  ):(
                    <div>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                        <div style={{fontSize:10,color:'#64748b'}}>{sdLockerList.length} easybox-uri găsite{sdLockerCounty?` în ${sdLockerCounty}`:''}</div>
                        <button onClick={()=>{ setSdLockerList([]); setSdEasyboxId(''); }} style={{fontSize:10,background:'transparent',border:'none',color:'#475569',cursor:'pointer'}}>↩ Caută altul</button>
                      </div>
                      <select className="fb-sel" style={{background:'rgba(59,130,246,.1)',borderColor:'rgba(59,130,246,.3)'}}
                        value={sdEasyboxId} onChange={e=>setSdEasyboxId(e.target.value)}>
                        <option value="">— Selectează easybox —</option>
                        {sdLockerList.map(l=>(
                          <option key={l.id} value={l.id}>{l.name} — {l.address}, {l.city}</option>
                        ))}
                      </select>
                      {sdEasyboxId&&(
                        <div style={{marginTop:6,fontSize:11,color:'#10b981'}}>
                          ✓ {sdLockerList.find(l=>String(l.id)===String(sdEasyboxId))?.address}, {sdLockerList.find(l=>String(l.id)===String(sdEasyboxId))?.city}
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{marginTop:8,fontSize:10,color:'#64748b',lineHeight:1.5}}>
                    ℹ️ Serviciu: <strong style={{color:'#3b82f6'}}>Locker NextDay</strong> — după generare AWB vei primi QR code / PIN pentru easybox. Ai 7 zile să depui coletul.
                  </div>
                </div>
              )}

              {/* Opțiuni suplimentare */}
              <div className="fb-section-title">Opțiuni suplimentare</div>
              <div className="fb-svc-grid">
                {Object.entries(SD_OPTIONS).map(([key,opt])=>(
                  <div key={key} className={`fb-svc-card ${sdOpts[key]?'sel-sd':''}`} onClick={()=>setSdOpts(p=>({...p,[key]:!p[key]}))}>
                    <div className="fb-svc-check">{sdOpts[key]&&<span style={{fontSize:10,color:'white',fontWeight:700}}>✓</span>}</div>
                    <div className="fb-svc-body"><div className="fb-svc-label">{opt.label}</div><div className="fb-svc-desc">{opt.desc}</div></div>
                  </div>
                ))}
              </div>

              {/* Observații */}
              <div className="fb-field" style={{marginTop:8}}>
                <div className="fb-lbl">Observații (apar pe AWB)</div>
                <input className="fb-inp" placeholder={`ex: Colet fragil · Comanda ${order.name}`} value={sdObservation} onChange={e=>setSdObservation(e.target.value)}/>
              </div>
            </div>
          )}

          {/* AWB manual fallback */}
          <div style={{background:'rgba(245,158,11,.07)',border:'1px solid rgba(245,158,11,.2)',borderRadius:8,padding:'10px 12px'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:useManual?8:0}}>
              <button className={`fb-toggle ${useManual?'on':''}`} onClick={()=>setUseManual(v=>!v)}/>
              <span style={{fontSize:11,color:'#f59e0b',fontWeight:600}}>AWB generat manual în {courier==='gls'?'MyGLS':'platforma Sameday'}</span>
            </div>
            {useManual&&(
              <input className="fb-inp" style={{marginTop:4}}
                placeholder={courier==='gls'?'ex: 123456789012':'ex: 1SDA123456789'}
                value={manual} onChange={e=>setManual(e.target.value)}
              />
            )}
          </div>

        </div>
        <div className="fb-mftr">
          <button className="fb-btn-g" onClick={onCancel}>Anulează</button>
          <button className="fb-btn-p"
            disabled={(useManual&&!manual)||(sdUseEasybox&&!sdEasyboxId&&courier==='sameday'&&!useManual)}
            onClick={handleGenerate}>
            🚚 {useManual?'Înregistrează AWB':'Generează AWB'}
          </button>
        </div>
      </div>
    </div>
  );
}
