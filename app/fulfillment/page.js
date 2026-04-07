'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

const ls = {
  get:(k)=>{ try{ return typeof window!=='undefined'?localStorage.getItem(k):null; }catch{return null;} },
  set:(k,v)=>{ try{ if(typeof window!=='undefined')localStorage.setItem(k,v); }catch{} },
};
const fmt = n=>Number(n||0).toLocaleString('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtD = d=>{ if(!d)return'—'; try{const p=d.split('T')[0].split('-');return`${p[2]}.${p[1]}.${p[0]}`;}catch{return d.slice(0,10);} };
const pad = n=>String(n).padStart(2,'0');
const toISO = d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

// ── Opțiuni GLS (din documentație oficială GLS CEE) ───────────────────────
const GLS_SERVICES = {
  SM1:{ code:'SM1',label:'📱 SMS la livrare',      desc:'SMS trimis destinatarului la livrare',              param:'phone',  group:'Notificări' },
  SM2:{ code:'SM2',label:'📧 SMS + Email livrare', desc:'SMS și email notificare la livrare',                param:'email',  group:'Notificări' },
  FDS:{ code:'FDS',label:'🕐 FlexDelivery Email',  desc:'Destinatarul alege ora/locul via email',            param:'email',  group:'Flex' },
  FSS:{ code:'FSS',label:'💬 FlexDelivery SMS',    desc:'Destinatarul alege ora/locul via SMS',              param:'phone',  group:'Flex' },
  SAT:{ code:'SAT',label:'📅 Livrare Sâmbătă',     desc:'Garantat livrat sâmbătă',                          param:null,     group:'Livrare' },
  T12:{ code:'T12',label:'⏰ Livrare până 12:00',  desc:'Garantat înainte de prânz',                        param:null,     group:'Livrare' },
  SBS:{ code:'SBS',label:'🏪 Shop/ParcelLocker',   desc:'Livrare la shop GLS sau parcel locker',            param:'shopId', group:'Livrare' },
  AOS:{ code:'AOS',label:'✍️ Semnătură',           desc:'Confirmare prin semnătură la livrare',             param:null,     group:'Livrare' },
  DPV:{ code:'DPV',label:'🏠 Numai adresă privată',desc:'Nu se lasă la vecin/recepție',                     param:null,     group:'Livrare' },
  INS:{ code:'INS',label:'🛡️ Asigurare',           desc:'Asigurare pentru valoarea declarată a coletului',  param:'value',  group:'Extra' },
  SDS:{ code:'SDS',label:'↩️ Shop Return',         desc:'Return facilitat prin shop GLS',                   param:null,     group:'Extra' },
  EXW:{ code:'EXW',label:'🚛 Ex Works',            desc:'Ridicare de la adresa expeditorului',              param:null,     group:'Extra' },
};

// ── Opțiuni Sameday ────────────────────────────────────────────────────────
const SD_OPTIONS = {
  openPackage:      { label:'📂 Deschide coletul la livrare', desc:'Destinatarul poate verifica conținutul' },
  saturdayDelivery: { label:'📅 Livrare Sâmbătă',             desc:'Livrare garantată sâmbătă' },
  thermo:           { label:'❄️ Transport frigorific',         desc:'Temperatura controlată' },
  repaymentTransport:{ label:'💸 Ramburs transport',          desc:'Taxa transport suportată de destinatar' },
};

// ── Address validator ──────────────────────────────────────────────────────
function validateAddr(a) {
  const issues = [];
  if (!a.name||a.name.trim().length<3) issues.push('Nume destinatar lipsă');
  if (!a.address||a.address.trim().length<5) issues.push('Adresa stradală incompletă');
  if (a.address && !/\d/.test(a.address)) issues.push('Adresa fără număr stradal');
  if (!a.city||a.city.trim().length<2) issues.push('Orașul lipsește');
  if (!a.phone||a.phone.replace(/\D/g,'').length<10) issues.push('Telefon invalid (min 10 cifre)');
  return issues;
}

function procOrder(o) {
  const notes = o.note_attributes||[];
  const invUrlAttr = notes.find(a=>(a.name||'').toLowerCase().includes('invoice-url')&&!(a.name||'').toLowerCase().includes('short'));
  const invoiceUrl = invUrlAttr?.value||'';
  const hasInvoice = !!invoiceUrl||notes.some(a=>(a.name||'').toLowerCase().includes('invoice-number'));
  const invNumAttr = notes.find(a=>(a.name||'').toLowerCase()==='invoice-number');
  const invSeriesAttr = notes.find(a=>(a.name||'').toLowerCase()==='invoice-series');
  const fulfillmentData=(o.fulfillments||[]).find(f=>f.tracking_company||f.tracking_number);
  const trackingNo=fulfillmentData?.tracking_number||'';
  const tc=(fulfillmentData?.tracking_company||'').toLowerCase();
  const courier=tc.includes('sameday')?'sameday':tc.includes('gls')?'gls':'unknown';
  const addr=o.shipping_address||o.billing_address||{};
  const lineItems=o.line_items||[];
  const isOnlinePay=['shopify_payments','stripe','paypal'].some(g=>(o.payment_gateway||'').toLowerCase().includes(g));
  const isCOD=(o.financial_status||'')==='pending'||(o.payment_gateway||'').toLowerCase().includes('cod')||(!isOnlinePay&&(o.financial_status||'')==='paid');

  return {
    id:String(o.id||''), name:o.name||'', client:addr.name||'',
    phone:o.phone||addr.phone||'', address:addr.address1||'', address2:addr.address2||'',
    city:addr.city||'', county:addr.province||'', zip:addr.zip||'',
    fin:(o.financial_status||'').toLowerCase(),
    fulfillmentStatus:(o.fulfillment_status||'').toLowerCase(),
    createdAt:o.created_at||'', total:parseFloat(o.total_price||0), currency:o.currency||'RON',
    gateway:o.payment_gateway||'', courier, trackingNo, hasInvoice, invoiceUrl,
    invoiceNumber:invNumAttr?.value||'', invoiceSeries:invSeriesAttr?.value||'',
    items:lineItems.map(i=>({ name:i.name||'',sku:i.sku||'',qty:i.quantity||1,price:parseFloat(i.price||0) })),
    prods:lineItems.map(i=>i.name).join(', '),
    isCOD, isOnlinePay,
    addrIssues:validateAddr({ name:addr.name, address:addr.address1, city:addr.city, phone:o.phone||addr.phone }),
  };
}

function useToast() {
  const [toasts,setToasts]=useState([]);
  const add=useCallback((msg,type='info')=>{
    const id=Date.now();
    setToasts(p=>[...p,{id,msg,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),4500);
  },[]);
  return { toasts, add };
}

const CSS = `
  .fb-page{max-width:1400px;margin:0 auto;padding:12px 12px 100px}
  .fb-hdr{position:sticky;top:0;z-index:100;background:rgba(7,9,14,.96);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.07);padding:10px 14px;margin-bottom:12px}
  .fb-hrow{display:flex;align-items:center;gap:8px}
  .fb-title{flex:1;font-size:15px;font-weight:800;letter-spacing:-.3px}
  .fb-sub{font-size:10px;color:#64748b;margin-top:1px}
  .fb-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px}
  .fb-kpi{background:#0c1018;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px 14px;cursor:default}
  .fb-kpi.clickable{cursor:pointer;transition:border-color .15s}
  .fb-kpi.clickable:hover{border-color:rgba(249,115,22,.4)}
  .fb-kpi-v{font-size:22px;font-weight:800;font-family:monospace;letter-spacing:-1px}
  .fb-kpi-l{font-size:10px;color:#64748b;margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
  .fb-panel{background:#0c1018;border:1px solid rgba(255,255,255,.07);border-radius:12px;overflow:hidden;margin-bottom:12px}
  .fb-ph{padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between}
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
  .fb-warn{background:rgba(245,158,11,.06);border-left:3px solid #f59e0b}
  .fb-err-row{background:rgba(244,63,94,.05);border-left:3px solid #f43f5e}
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
  .fb-badge-gls{background:rgba(249,115,22,.12);color:#f97316;border:1px solid rgba(249,115,22,.2);font-family:monospace;font-size:9px}
  .fb-badge-sd{background:rgba(59,130,246,.12);color:#3b82f6;border:1px solid rgba(59,130,246,.2);font-family:monospace;font-size:9px}
  .fb-awbn{font-family:monospace;font-size:10px;color:#10b981;font-weight:700}
  .fb-errt{font-size:9px;color:#f43f5e;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)}
  .fb-modal{background:#0f1419;border:1px solid rgba(255,255,255,.1);border-radius:14px;width:100%;max-height:92vh;overflow-y:auto}
  .fb-mhdr{padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#0f1419;z-index:10}
  .fb-mt{font-size:14px;font-weight:700}
  .fb-mx{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#94a3b8;padding:4px 10px;border-radius:8px;cursor:pointer;font-size:13px}
  .fb-mbdy{padding:16px 20px;display:flex;flex-direction:column;gap:12px}
  .fb-mftr{padding:14px 20px;border-top:1px solid rgba(255,255,255,.07);display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:0;background:#0f1419}
  .fb-field{display:flex;flex-direction:column;gap:4px}
  .fb-lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px}
  .fb-inp{background:#161d24;border:1px solid #243040;color:#e2e8f0;padding:8px 11px;border-radius:7px;font-size:12px;font-family:monospace;outline:none;width:100%}
  .fb-inp:focus{border-color:#f97316}
  .fb-inp.err{border-color:#f43f5e}
  .fb-sel{background:#161d24;border:1px solid #243040;color:#e2e8f0;padding:8px 11px;border-radius:7px;font-size:12px;outline:none;width:100%;font-family:inherit;cursor:pointer}
  .fb-infobox{background:#080c10;border-radius:8px;padding:10px 12px;font-size:12px;color:#94a3b8;line-height:1.7;border:1px solid rgba(255,255,255,.05)}
  .fb-okbox{background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:8px;padding:14px;text-align:center}
  .fb-errbox{background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.25);border-radius:8px;padding:10px 12px;font-size:12px;color:#f43f5e}
  .fb-warnbox{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:10px 12px;font-size:12px;color:#f59e0b;line-height:1.6}
  .fb-toggle{width:34px;height:19px;background:#243040;border-radius:99px;position:relative;cursor:pointer;transition:background .2s;border:none;flex-shrink:0}
  .fb-toggle.on{background:#f97316}
  .fb-toggle::after{content:'';position:absolute;width:13px;height:13px;background:white;border-radius:50%;top:3px;left:3px;transition:left .2s}
  .fb-toggle.on::after{left:18px}
  .fb-trow{display:flex;align-items:center;justify-content:space-between;padding:4px 0}
  .fb-trow-label{font-size:12px;color:#94a3b8;flex:1}
  .fb-trow-desc{font-size:10px;color:#475569;margin-top:1px}
  .fb-svc-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .fb-svc-card{background:#080c10;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px 12px;cursor:pointer;transition:border-color .15s;display:flex;align-items:flex-start;gap:10px}
  .fb-svc-card.selected{border-color:#f97316;background:rgba(249,115,22,.08)}
  .fb-svc-card.selected-sd{border-color:#3b82f6;background:rgba(59,130,246,.08)}
  .fb-svc-check{width:16px;height:16px;border-radius:4px;border:2px solid #334155;flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center;transition:all .15s}
  .fb-svc-card.selected .fb-svc-check,.fb-svc-card.selected-sd .fb-svc-check{background:#f97316;border-color:#f97316}
  .fb-svc-card.selected-sd .fb-svc-check{background:#3b82f6;border-color:#3b82f6}
  .fb-svc-body{flex:1;min-width:0}
  .fb-svc-label{font-size:12px;font-weight:700;color:#e2e8f0}
  .fb-svc-desc{font-size:10px;color:#64748b;margin-top:2px;line-height:1.4}
  .fb-svc-input{margin-top:6px}
  .fb-btn-p{background:#f97316;color:white;border:none;padding:9px 18px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;transition:background .15s}
  .fb-btn-p:hover{background:#ea580c}
  .fb-btn-p:disabled{opacity:.4;cursor:not-allowed}
  .fb-btn-p.blue{background:#3b82f6}
  .fb-btn-p.blue:hover{background:#2563eb}
  .fb-btn-p.green{background:#10b981}
  .fb-btn-p.green:hover{background:#059669}
  .fb-btn-g{background:rgba(255,255,255,.05);color:#94a3b8;border:1px solid rgba(255,255,255,.1);padding:9px 18px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
  .fb-btn-g:hover{background:rgba(255,255,255,.08)}
  .fb-progress-wrap{background:#1e2a35;border-radius:99px;height:6px;overflow:hidden;margin:8px 0}
  .fb-progress-bar{height:100%;border-radius:99px;background:#f97316;transition:width .3s}
  .fb-addr-issue{background:rgba(244,63,94,.06);border:1px solid rgba(244,63,94,.2);border-radius:8px;padding:10px 12px}
  .fb-addr-tag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(244,63,94,.15);color:#f43f5e;cursor:pointer;border:1px solid rgba(244,63,94,.3)}
  .fb-sett-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .fb-sett-card{background:#080c10;border:1px solid rgba(255,255,255,.07);border-radius:10px;overflow:hidden}
  .fb-sett-hdr{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.05);display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700}
  .fb-sett-body{padding:14px;display:flex;flex-direction:column;gap:10px}
  .fb-section-title{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px;margin-top:4px}
  .fb-bnav{position:fixed;bottom:0;left:0;right:0;z-index:200;background:rgba(7,9,14,.96);backdrop-filter:blur(24px);border-top:1px solid rgba(255,255,255,.06)}
  .fb-bni{display:grid;grid-template-columns:repeat(5,1fr);height:62px}
  .fb-bn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#475569;text-decoration:none;font-size:9px;font-weight:700;text-transform:uppercase;cursor:pointer;background:none;border:none;padding:4px 2px}
  .fb-bn.active{color:#f97316}
  .fb-bnic{font-size:20px}
  .toast-container{position:fixed;bottom:80px;right:16px;display:flex;flex-direction:column;gap:6px;z-index:9999}
  .fb-toast{background:#0f1419;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 14px;font-size:12px;font-weight:600;min-width:240px;animation:toastIn .2s ease;box-shadow:0 8px 32px rgba(0,0,0,.4)}
  .fb-toast.success{border-left:3px solid #10b981}
  .fb-toast.error{border-left:3px solid #f43f5e}
  .fb-toast.info{border-left:3px solid #3b82f6}
  @keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}
  @keyframes spin{to{transform:rotate(360deg)}}
  .fb-spin{animation:spin .8s linear infinite;display:inline-block}
  @media(max-width:700px){.fb-kpis{grid-template-columns:1fr 1fr 1fr}.fb-sett-grid{grid-template-columns:1fr}.fb-svc-grid{grid-template-columns:1fr}.fb-hmob{display:none}}
`;

// ── SmartBill: preia produse din gestiune ──────────────────────────────────
async function fetchSbProducts(email, token, cif, warehouseName) {
  try {
    const url = `/api/smartbill/products?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&cif=${encodeURIComponent(cif)}${warehouseName?`&warehouse=${encodeURIComponent(warehouseName)}`:''}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.products||data.list||[];
  } catch { return []; }
}

// ── Actualizare adresă în Shopify ──────────────────────────────────────────
async function updateShopifyAddress(domain, token, orderId, addrData) {
  const res = await fetch(`https://${domain}/admin/api/2024-01/orders/${orderId}.json`, {
    method:'PUT',
    headers:{ 'X-Shopify-Access-Token':token,'Content-Type':'application/json' },
    body:JSON.stringify({ order:{ id:orderId, shipping_address:addrData } }),
    cache:'no-store',
  });
  return res.ok;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function FulfillmentPage() {
  const [domain]  = useState(()=>ls.get('gx_d')||'');
  const [shopToken] = useState(()=>ls.get('gx_t')||'');
  const [orders,setOrders]   = useState([]);
  const [loading,setLoading] = useState(false);
  const [error,setError]     = useState('');
  const [search,setSearch]   = useState('');
  const [filterStatus,setFilterStatus] = useState('pending');

  // GLS config
  const [glsUser,setGlsUser]     = useState(()=>ls.get('fb_gls_user')||'');
  const [glsPass,setGlsPass]     = useState(()=>ls.get('fb_gls_pass')||'');
  const [glsClient,setGlsClient] = useState(()=>ls.get('fb_gls_client')||'553003585');

  // Stare configurare din Vercel env vars (auto-detectată la mount)
  const [glsEnvOk,setGlsEnvOk]   = useState(false);
  const [sdEnvOk,setSdEnvOk]     = useState(false);
  // Status conexiune live per curier
  const [glsStatus,setGlsStatus]     = useState('idle'); // idle | testing | ok | error
  const [glsStatusMsg,setGlsStatusMsg] = useState('');
  const [sdStatus,setSdStatus]       = useState('idle');
  const [sdStatusMsg,setSdStatusMsg]   = useState('');

  // Sameday config
  const [sdUser,setSdUser]     = useState(()=>ls.get('fb_sd_user')||'');
  const [sdPass,setSdPass]     = useState(()=>ls.get('fb_sd_pass')||'');
  const [sdPickup,setSdPickup] = useState(()=>ls.get('fb_sd_pickup')||'');
  const [sdService,setSdService] = useState(()=>ls.get('fb_sd_service')||'');
  const [sdConfig,setSdConfig]   = useState({ pickupPoints:[], services:[] });

  // SmartBill config
  const [sbEmail,setSbEmail]     = useState(()=>ls.get('sb_email')||'');
  const [sbToken,setSbToken]     = useState(()=>ls.get('sb_token')||'');
  const [sbCif,setSbCif]         = useState(()=>ls.get('sb_cif')||'');
  const [sbSeries,setSbSeries]   = useState(()=>ls.get('sb_inv_series')||'');
  const [sbSeriesList,setSbSeriesList] = useState([]);
  const [sbWarehouse,setSbWarehouse]   = useState(()=>ls.get('sb_warehouse')||'');
  const [sbWarehouses,setSbWarehouses] = useState([]);
  const [sbUseStock,setSbUseStock]     = useState(()=>ls.get('sb_use_stock')==='true');
  const [sbPaySeries,setSbPaySeries]   = useState(()=>ls.get('sb_pay_series')||'');

  // Results
  const [awbResults,setAwbResults] = useState({});
  const [awbLoading,setAwbLoading] = useState({});
  const [invResults,setInvResults] = useState({});
  const [invLoading,setInvLoading] = useState({});

  // Modals
  const [awbModal,setAwbModal]     = useState(null);
  const [invModal,setInvModal]     = useState(null);
  const [addrModal,setAddrModal]   = useState(null); // { order, editAddr, apiIssues, suggestion, saving, validating }

  const openAddrModal = (order) => {
    const editAddr = { name:order.client, address:order.address, address2:order.address2||'', city:order.city, county:order.county, zip:order.zip, phone:order.phone, email:'' };
    setAddrModal({ order, editAddr, apiIssues:[], suggestion:null, saving:false, validating:false });
    // Validare automată la deschidere (skipEmpty = nu marca câmpurile goale)
    setTimeout(() => validateAddrApi(editAddr, true), 200);
  };

  const validateAddrApi = async (fields, skipEmpty=false) => {
    setAddrModal(p => p ? { ...p, validating:true } : null);
    try {
      const res = await fetch('/api/validate-address', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...fields, skipEmpty }),
      });
      const data = await res.json();
      setAddrModal(p => p ? { ...p, apiIssues: data.issues||[], suggestion: data.suggestion||null, validating:false } : null);
    } catch {
      setAddrModal(p => p ? { ...p, validating:false } : null);
    }
  };

  const applyAddrSuggestion = () => {
    if (!addrModal?.suggestion) return;
    const s = addrModal.suggestion;
    setAddrModal(p => ({
      ...p,
      editAddr: { ...p.editAddr,
        address: s.formattedAddress || p.editAddr.address,
        city:    s.city     || p.editAddr.city,
        county:  s.county   || p.editAddr.county,
        zip:     s.postcode || p.editAddr.zip,
      },
      suggestion: null, apiIssues: [],
    }));
  };
  const [settingsOpen,setSettingsOpen] = useState(false);
  const [bulkModal,setBulkModal]   = useState(false);
  const [bulkProgress,setBulkProgress] = useState({ running:false, done:0, total:0, errors:[] });

  // Bulk settings
  const [bulkCourier,setBulkCourier] = useState('gls');
  const [bulkWeight,setBulkWeight]   = useState('1');
  const [bulkDoAwb,setBulkDoAwb]     = useState(true);
  const [bulkDoInv,setBulkDoInv]     = useState(true);

  const { toasts, add:toast } = useToast();

  // ── Fetch comenzi ──────────────────────────────────────────────────────
  const fetchOrders = useCallback(async()=>{
    if (!domain||!shopToken) { setError('Conectează-te din pagina principală.'); return; }
    setLoading(true); setError('');
    try {
      const d30 = toISO(new Date(Date.now()-30*24*60*60*1000));
      const res = await fetch(`/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(shopToken)}&created_at_min=${d30}`);
      const data = await res.json();
      if (!res.ok||!data.orders) throw new Error(data.error||'Eroare Shopify');
      const processed = data.orders.map(procOrder);
      setOrders(processed);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  },[domain,shopToken]);

  useEffect(()=>{ fetchOrders(); },[fetchOrders]);

  // Auto-detectare credențiale din Vercel env vars la mount
  useEffect(()=>{
    // Check GLS — GET /api/gls returnează configured:true dacă env vars sunt setate
    fetch('/api/gls').then(r=>r.json()).then(d=>{
      if(d.configured) {
        setGlsEnvOk(true);
        if(d.clientNumber) setGlsClient(d.clientNumber);
      }
    }).catch(()=>{});
    // Check Sameday + încarcă pickup points automat
    fetch('/api/sameday-awb').then(r=>r.json()).then(d=>{
      if(d.configured) {
        setSdEnvOk(true);
        if(d.pickupPoints?.length) {
          setSdConfig({ pickupPoints:d.pickupPoints, services:d.services||[] });
          if(!sdPickup&&d.pickupPoints[0]) setSdPickup(String(d.pickupPoints[0].id));
          if(!sdService&&d.services?.[0]) setSdService(String(d.services[0].id));
        }
      }
    }).catch(()=>{});
  },[]);// eslint-disable-line

  // ── SmartBill serii ────────────────────────────────────────────────────
  const loadSbSeries = useCallback(async()=>{
    if (!sbEmail||!sbToken||!sbCif) return;
    try {
      const res = await fetch(`/api/smartbill-invoice?email=${encodeURIComponent(sbEmail)}&token=${encodeURIComponent(sbToken)}&cif=${encodeURIComponent(sbCif)}`);
      const data = await res.json();
      if (data.series?.length) { setSbSeriesList(data.series); if(!sbSeries)setSbSeries(data.series[0]); }
      if (data.warehouses?.length) { setSbWarehouses(data.warehouses); if(!sbWarehouse)setSbWarehouse(data.warehouses[0]); }
    } catch {}
  },[sbEmail,sbToken,sbCif,sbSeries,sbWarehouse]);

  // ── Sameday config ─────────────────────────────────────────────────────
  const loadSdConfig = useCallback(async()=>{
    // Dacă env vars sunt configurate — folosim GET (fără credențiale)
    // Dacă nu — trimitem credențialele manual prin POST
    try {
      let data;
      if (sdEnvOk) {
        const res = await fetch('/api/sameday-awb');
        data = await res.json();
      } else {
        if (!sdUser||!sdPass) { toast('Introdu username și parola Sameday.','error'); return; }
        const res = await fetch('/api/sameday-awb', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ action:'get_lockers', username:sdUser, password:sdPass, county:'' }),
        });
        // Folosim un apel de test pentru a obține pickup points
        const res2 = await fetch('/api/sameday-awb', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ action:'test_connection', username:sdUser, password:sdPass }),
        });
        data = await res2.json();
        if (!data.ok) {
          // Fallback — doar marcăm ca conectat cu credențialele introduse
          toast('Credențiale Sameday salvate. Pickup points se vor încărca la prima generare AWB.','info');
          return;
        }
      }
      if (data.ok||data.configured) {
        setSdEnvOk(true);
        if(data.pickupPoints?.length) {
          setSdConfig({ pickupPoints:data.pickupPoints||[], services:data.services||[] });
          if(!sdPickup&&data.pickupPoints[0]) setSdPickup(String(data.pickupPoints[0].id));
          if(!sdService&&data.services?.[0]) setSdService(String(data.services[0].id));
          toast('Sameday conectat! '+data.pickupPoints.length+' pickup points.','success');
        } else {
          toast('Sameday conectat!','success');
        }
      } else {
        toast('Sameday: '+(data.error||data.message||'eroare necunoscută'),'error');
      }
    } catch(e) { toast('Sameday eroare: '+e.message,'error'); }
  },[sdEnvOk,sdUser,sdPass,sdPickup,sdService,toast]);

  const saveSettings = ()=>{
    ls.set('fb_gls_user',glsUser); ls.set('fb_gls_pass',glsPass); ls.set('fb_gls_client',glsClient);
    ls.set('fb_sd_user',sdUser); ls.set('fb_sd_pass',sdPass);
    ls.set('fb_sd_pickup',sdPickup); ls.set('fb_sd_service',sdService);
    ls.set('sb_email',sbEmail); ls.set('sb_token',sbToken); ls.set('sb_cif',sbCif);
    ls.set('sb_inv_series',sbSeries); ls.set('sb_warehouse',sbWarehouse);
    ls.set('sb_use_stock',String(sbUseStock)); ls.set('sb_pay_series',sbPaySeries);
    toast('Setări salvate!','success'); setSettingsOpen(false); loadSbSeries();
  };

  // ── Test conexiune GLS ─────────────────────────────────────────────────
  const testGlsConnection = async () => {
    setGlsStatus('testing'); setGlsStatusMsg('');
    const user   = glsUser   || '';
    const pass   = glsPass   || '';
    const client = glsClient || '553003585';
    if (!user || !pass) {
      setGlsStatus('error'); setGlsStatusMsg('✗ Completează username și parola GLS.');
      toast('Completează credențialele GLS.', 'error'); return;
    }
    try {
      const res = await fetch('/api/gls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_connection', username: user, password: pass, clientNumber: client }),
      });
      let data;
      try { data = await res.json(); }
      catch { data = { ok: false, error: `Server error ${res.status} — verifică Vercel logs` }; }
      if (data.ok || data.configured) {
        setGlsStatus('ok'); setGlsEnvOk(true);
        if (data.clientNumber) setGlsClient(data.clientNumber);
        setGlsStatusMsg('✓ ' + (data.message || 'GLS conectat!'));
        toast('GLS conectat!', 'success');
      } else {
        setGlsStatus('error');
        setGlsStatusMsg('✗ ' + (data.error || data.message || 'Credențiale invalide'));
        toast('GLS: ' + (data.error || data.message || 'eroare'), 'error');
      }
    } catch (e) {
      setGlsStatus('error');
      setGlsStatusMsg('✗ ' + e.message);
      toast('GLS eroare: ' + e.message, 'error');
    }
  };

  const testSdConnection = async () => {
    setSdStatus('testing'); setSdStatusMsg('');
    const user = sdUser || '';
    const pass = sdPass || '';
    if (!user || !pass) {
      setSdStatus('error'); setSdStatusMsg('✗ Completează username și parola Sameday.');
      toast('Completează credențialele Sameday.', 'error'); return;
    }
    try {
      const res = await fetch('/api/sameday-awb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_connection', username: user, password: pass }),
      });
      let data;
      try { data = await res.json(); }
      catch { data = { ok: false, error: `Server error ${res.status} — verifică Vercel logs` }; }
      if (data.ok) {
        setSdStatus('ok'); setSdEnvOk(true);
        const pts = data.pickupPoints || [];
        const svcs = data.services || [];
        if (pts.length) {
          setSdConfig({ pickupPoints: pts, services: svcs });
          if (!sdPickup && pts[0]) setSdPickup(String(pts[0].id));
          if (!sdService && svcs[0]) setSdService(String(svcs[0].id));
        }
        setSdStatusMsg(`✓ Sameday conectat! ${pts.length} pickup points, ${svcs.length} servicii`);
        toast(`Sameday conectat! ${pts.length} pickup points.`, 'success');
      } else {
        setSdStatus('error');
        setSdStatusMsg('✗ ' + (data.error || 'Credențiale Sameday invalide'));
        toast('Sameday: ' + (data.error || 'credențiale invalide'), 'error');
      }
    } catch (e) {
      setSdStatus('error');
      setSdStatusMsg('✗ ' + e.message);
      toast('Sameday eroare: ' + e.message, 'error');
    }
  };
  // ── Generare AWB ───────────────────────────────────────────────────────
  const generateAwb = async(order, options)=>{
    const { courier, weight, parcels, manualAwb, selectedServices, sdOptions, lockerId, observation, senderEasyboxId } = options;
    setAwbLoading(p=>({...p,[order.id]:true}));
    setAwbResults(p=>({...p,[order.id]:null}));
    try {
      if (courier==='gls') {
        const body = {
          username:glsUser, password:glsPass, clientNumber:glsClient,
          recipientName:order.client, phone:order.phone, email:'',
          address:order.address, city:order.city, county:order.county, zip:order.zip,
          weight:parseFloat(weight)||1, parcels:parseInt(parcels)||1,
          content:order.prods.slice(0,100)||'Colet',
          codAmount:order.isCOD?order.total:0, codCurrency:'RON',
          orderName:order.name, orderId:order.id,
          selectedServices, manualAwb:manualAwb||undefined,
        };
        const res = await fetch('/api/gls',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
        const data = await res.json();
        if (data.requiresCorrection) { toast('Adresă invalidă — corectează înainte de generare.','error'); setAwbLoading(p=>({...p,[order.id]:false})); return; }
        if (data.ok) {
          setAwbResults(p=>({...p,[order.id]:{ ok:true,awb:data.awb,courier,pdf:data.pdf,servicesApplied:data.servicesApplied||[],mode:data.mode }}));
          setOrders(prev=>prev.map(o=>o.id===order.id?{...o,trackingNo:data.awb,courier}:o));
          toast(`AWB GLS ${data.awb} generat!`,'success');
        } else { setAwbResults(p=>({...p,[order.id]:{ok:false,error:data.error}})); toast(`Eroare GLS: ${data.error}`,'error'); }
      } else {
        const body = {
          username:sdUser, password:sdPass, pickupPointId:sdPickup||undefined, serviceId:sdService||undefined,
          lockerId:lockerId||undefined,
          senderEasyboxId:senderEasyboxId||undefined,
          recipientName:order.client, phone:order.phone, email:'',
          address:order.address, city:order.city, county:order.county, zip:order.zip,
          weight:parseFloat(weight)||1, parcels:parseInt(parcels)||1,
          content:order.prods.slice(0,100)||'Colet',
          isCOD:order.isCOD, total:order.total,
          orderName:order.name, orderId:order.id, manualAwb:manualAwb||undefined,
          observations:observation||order.prods.slice(0,100)||`Comanda ${order.name}`,
          ...sdOptions,
        };
        const res = await fetch('/api/sameday-awb',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
        const data = await res.json();
        if (data.requiresCorrection) { toast('Adresă invalidă — corectează înainte.','error'); setAwbLoading(p=>({...p,[order.id]:false})); return; }
        if (data.ok) {
          setAwbResults(p=>({...p,[order.id]:{ ok:true,awb:data.awb,courier,mode:data.mode }}));
          setOrders(prev=>prev.map(o=>o.id===order.id?{...o,trackingNo:data.awb,courier}:o));
          toast(`AWB Sameday ${data.awb} generat!`,'success');
        } else { setAwbResults(p=>({...p,[order.id]:{ok:false,error:data.error}})); toast(`Eroare Sameday: ${data.error}`,'error'); }
      }
    } catch(e) { setAwbResults(p=>({...p,[order.id]:{ok:false,error:e.message}})); toast('Eroare rețea: '+e.message,'error'); }
    finally { setAwbLoading(p=>({...p,[order.id]:false})); }
  };

  // ── Generare Factură SmartBill (cu gestiune + încasare automată) ───────
  const generateInvoice = async(order, editItems, seriesOverride)=>{
    setInvLoading(p=>({...p,[order.id]:true}));
    setInvResults(p=>({...p,[order.id]:null}));
    setInvModal(null);
    try {
      const res = await fetch('/api/smartbill-invoice',{
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
            total:order.total,
            items:editItems||order.items||[],
            // Încasare automată pentru Shopify Payments / card online
            isPaid:order.fin==='paid'&&(order.isOnlinePay||order.fin==='paid'),
            useStock:sbUseStock, warehouseName:sbUseStock?sbWarehouse:'',
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setInvResults(p=>({...p,[order.id]:{ ok:true,number:data.number,series:data.series,invoiceUrl:data.invoiceUrl,collected:data.collected,stockDecreased:data.stockDecreased }}));
        setOrders(prev=>prev.map(o=>o.id===order.id?{...o,hasInvoice:true,invoiceNumber:data.number,invoiceSeries:data.series,invoiceUrl:data.invoiceUrl}:o));
        const extras = [data.collected&&'💰 încasat',data.stockDecreased&&'📦 stoc scăzut'].filter(Boolean).join(' ');
        toast(`Factura ${data.series}${data.number} emisă! ${extras}`,'success');
      } else {
        setInvResults(p=>({...p,[order.id]:{ok:false,error:data.error}}));
        toast(`Eroare SmartBill: ${data.error}`,'error');
      }
    } catch(e) { setInvResults(p=>({...p,[order.id]:{ok:false,error:e.message}})); toast('Eroare rețea: '+e.message,'error'); }
    finally { setInvLoading(p=>({...p,[order.id]:false})); }
  };

  // ── Actualizare adresă în Shopify ──────────────────────────────────────
  const saveAddress = async(order, newAddr)=>{
    try {
      const ok = await updateShopifyAddress(domain, shopToken, order.id, {
        name:newAddr.name, address1:newAddr.address, address2:newAddr.address2||'',
        city:newAddr.city, province:newAddr.county, zip:newAddr.zip, country:'Romania', phone:newAddr.phone,
      });
      if (ok) {
        setOrders(prev=>prev.map(o=>o.id===order.id?{...o,...newAddr,addrIssues:validateAddr(newAddr)}:o));
        toast('Adresă actualizată în Shopify!','success');
        setAddrModal(null);
      } else toast('Eroare actualizare Shopify.','error');
    } catch(e) { toast('Eroare: '+e.message,'error'); }
  };

  // ── Bulk process ───────────────────────────────────────────────────────
  const runBulk = async()=>{
    const targets = filteredOrders.filter(o=>!awbResults[o.id]?.ok||(!invResults[o.id]?.ok&&o.fin==='paid'));
    if (!targets.length) { toast('Nicio comandă de procesat.','info'); setBulkModal(false); return; }
    setBulkProgress({ running:true,done:0,total:targets.length,errors:[] });
    setBulkModal(false);
    const errors = [];
    for (let i=0;i<targets.length;i++) {
      const o = targets[i];
      try {
        if (bulkDoAwb&&!awbResults[o.id]?.ok&&!o.trackingNo) {
          await generateAwb(o,{ courier:bulkCourier,weight:bulkWeight,parcels:1,selectedServices:{},sdOptions:{} });
          await new Promise(r=>setTimeout(r,350));
        }
        if (bulkDoInv&&!invResults[o.id]?.ok&&!o.hasInvoice&&o.fin==='paid') {
          await generateInvoice(o,null,sbSeries);
          await new Promise(r=>setTimeout(r,450));
        }
      } catch(e) { errors.push(`${o.name}: ${e.message}`); }
      setBulkProgress(p=>({...p,done:i+1,errors}));
    }
    setBulkProgress(p=>({...p,running:false}));
    toast(`Bulk: ${targets.length-errors.length} succes, ${errors.length} erori.`,errors.length?'error':'success');
  };

  // ── Filter ─────────────────────────────────────────────────────────────
  const filteredOrders = orders.filter(o=>{
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
            <div style={{flex:1}}>
              <div className="fb-title">⚡ Fulfillment Bridge</div>
              <div className="fb-sub">AWB GLS · AWB Sameday · Facturi SmartBill · Validare adrese</div>
            </div>
            <button onClick={()=>{ setSettingsOpen(true); loadSbSeries(); }} className="fb-act fb-act-sm" style={{color:'#94a3b8',borderColor:'rgba(255,255,255,.15)'}}>⚙️ Setări</button>
            <button onClick={fetchOrders} className="fb-act fb-act-sm" style={{color:'#3b82f6',borderColor:'rgba(59,130,246,.3)',marginLeft:4}} disabled={loading}>
              {loading?<span className="fb-spin">↻</span>:'↻ Sync'}
            </button>
          </div>
        </div>

        {error&&<div className="fb-errbox" style={{marginBottom:12}}>⚠️ {error} — <a href="/" style={{color:'#f97316'}}>conectează-te din pagina principală</a></div>}
        {loading&&<div style={{textAlign:'center',padding:32,color:'#64748b'}}><span className="fb-spin" style={{fontSize:24}}>↻</span><br/>Se încarcă...</div>}

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
              <div className="fb-kpi-v" style={{color:cntAddrIssues>0?'#f43f5e':'#64748b'}}>{cntAddrIssues}</div><div className="fb-kpi-l">Adrese invalide</div>
            </div>
            <div className="fb-kpi"><div className="fb-kpi-v" style={{color:'#3b82f6'}}>{cntShipped}</div><div className="fb-kpi-l">Expediate</div></div>
          </div>
        )}

        {/* ORDERS PANEL */}
        {!loading&&orders.length>0&&(
          <div className="fb-panel">
            <div className="fb-ph">
              <div><div className="fb-pt">Comenzi Shopify</div><div style={{fontSize:10,color:'#475569',marginTop:1}}>AWB + Factură + Validare adrese</div></div>
              <button onClick={()=>setBulkModal(true)} className="fb-btn-p" style={{fontSize:11,padding:'6px 14px'}}>⚡ Bulk ({filteredOrders.length})</button>
            </div>
            <div className="fb-filters">
              {[{id:'all',lbl:'Toate'},{id:'pending',lbl:`⚠ Fără AWB (${cntPending})`},{id:'no-invoice',lbl:`🧾 Fără factură (${cntNoInvoice})`},{id:'addr-issues',lbl:`⚠️ Adrese (${cntAddrIssues})`},{id:'shipped',lbl:`✅ Expediate (${cntShipped})`}].map(f=>(
                <button key={f.id} className={`fb-fb ${filterStatus===f.id?'active':''}`} onClick={()=>setFilterStatus(f.id)}>{f.lbl}</button>
              ))}
              <input className="fb-search" placeholder="Caută..." value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
            <div style={{overflowX:'auto'}}>
              <table className="fb-tbl">
                <thead><tr>
                  <th>Comandă</th><th>Client & Adresă</th>
                  <th className="fb-hmob">Produse</th>
                  <th>Total</th>
                  <th className="fb-hmob">Data</th>
                  <th>AWB</th><th>Factură</th>
                </tr></thead>
                <tbody>
                  {filteredOrders.length===0?(<tr><td colSpan={7}><div style={{padding:40,textAlign:'center',color:'#334155',fontSize:12}}>📭 Nicio comandă în filtrul selectat.</div></td></tr>)
                  :filteredOrders.map(o=>{
                    const awbRes=awbResults[o.id]; const invRes=invResults[o.id];
                    const awbLoad=awbLoading[o.id]; const invLoad=invLoading[o.id];
                    const existingAwb=o.trackingNo||awbRes?.awb;
                    const existingInv=o.hasInvoice||invRes?.ok;
                    const hasIssues=o.addrIssues&&o.addrIssues.length>0;
                    return (
                      <tr key={o.id} className={hasIssues?'fb-warn':''}>
                        <td>
                          <div style={{fontFamily:'monospace',fontWeight:700,color:'#f97316',fontSize:12}}>{o.name}</div>
                          <div style={{fontSize:9,marginTop:2,display:'flex',gap:4,flexWrap:'wrap'}}>
                            {o.courier!=='unknown'&&<span className={`fb-badge fb-badge-${o.courier==='sameday'?'sd':'gls'}`}>{o.courier.toUpperCase()}</span>}
                            {hasIssues&&<span style={{fontSize:9,color:'#f43f5e',fontWeight:700}}>⚠ adresă</span>}
                          </div>
                        </td>
                        <td>
                          <div style={{fontWeight:600,fontSize:12}}>{o.client||'—'}</div>
                          <div style={{fontSize:10,color:'#64748b'}}>{[o.address,o.city].filter(Boolean).join(', ')||'—'}</div>
                          {hasIssues&&(
                            <div style={{marginTop:3}}>
                              {o.addrIssues.slice(0,2).map((iss,i)=>(
                                <div key={i} style={{fontSize:9,color:'#f43f5e'}}>⚠ {iss}</div>
                              ))}
                              <button className="fb-addr-tag" style={{marginTop:3}} onClick={()=>openAddrModal(o)}>
                                ✏️ Corectează
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="fb-hmob" style={{fontSize:11,color:'#64748b',maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={o.prods}>{o.prods.slice(0,50)||'—'}</td>
                        <td>
                          <div style={{fontFamily:'monospace',fontWeight:700,color:o.isCOD?'#f97316':'#3b82f6',fontSize:12}}>{fmt(o.total)} RON</div>
                          <div style={{fontSize:9,color:o.isCOD?'#f97316':'#3b82f6'}}>{o.isCOD?'💵 COD':'💳 Card'}</div>
                        </td>
                        <td className="fb-hmob" style={{fontSize:10,color:'#64748b'}}>{fmtD(o.createdAt)}</td>
                        {/* AWB */}
                        <td>
                          {existingAwb?(
                            <div>
                              <div className="fb-awbn">{String(existingAwb).slice(0,16)}</div>
                              {awbRes?.servicesApplied?.length>0&&<div style={{fontSize:8,color:'#475569'}}>{awbRes.servicesApplied.join(' ')}</div>}
                              {awbRes?.mode==='manual'&&<div style={{fontSize:8,color:'#64748b'}}>manual</div>}
                            </div>
                          ):awbRes?.error?(
                            <div>
                              <div className="fb-errt" title={awbRes.error}>✗ {awbRes.error.slice(0,40)}</div>
                              <button className="fb-act fb-act-awb fb-act-sm" onClick={()=>setAwbModal(o)}>↺ Retry</button>
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
                              {invRes?.collected&&<div style={{fontSize:8,color:'#10b981'}}>💰 încasat</div>}
                              {invRes?.stockDecreased&&<div style={{fontSize:8,color:'#3b82f6'}}>📦 stoc ↓</div>}
                            </div>
                          ):invRes?.error?(
                            <div>
                              <div className="fb-errt" title={invRes.error}>✗ {invRes.error.slice(0,40)}</div>
                              <button className="fb-act fb-act-inv fb-act-sm" onClick={()=>setInvModal({ order:o, editItems:o.items.length?[...o.items]:[{name:o.prods||'Produs',sku:'',qty:1,price:o.total}],seriesInput:sbSeries })}>↺ Retry</button>
                            </div>
                          ):o.fin==='paid'?(
                            <button className="fb-act fb-act-inv" disabled={invLoad} onClick={()=>setInvModal({ order:o, editItems:o.items.length?[...o.items.map(i=>({...i}))]:[{name:o.prods||'Produs',sku:'',qty:1,price:o.total}],seriesInput:sbSeries })}>
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

      {/* ── MODAL AWB ─────────────────────────────────────────────────── */}
      {awbModal&&<AwbModal order={awbModal} glsUser={glsUser} glsPass={glsPass} glsClient={glsClient} sdUser={sdUser} sdPass={sdPass} sdConfig={sdConfig} sdPickup={sdPickup} sdService={sdService} onGenerate={(opts)=>{ generateAwb(awbModal,opts); setAwbModal(null); }} onCancel={()=>setAwbModal(null)} />}

      {/* ── MODAL FACTURĂ ─────────────────────────────────────────────── */}
      {invModal&&(
        <div className="fb-overlay" onClick={e=>{if(e.target===e.currentTarget)setInvModal(null);}}>
          <div className="fb-modal" style={{maxWidth:520}}>
            <div className="fb-mhdr">
              <div>
                <div className="fb-mt">🧾 Factură SmartBill — {invModal.order.name}</div>
                <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{invModal.order.client} · {fmt(invModal.order.total)} RON{invModal.order.isCOD?' · COD':' · Card online'}</div>
              </div>
              <button className="fb-mx" onClick={()=>setInvModal(null)}>✕</button>
            </div>
            <div className="fb-mbdy">
              {!sbEmail||!sbToken||!sbCif?(
                <div className="fb-warnbox">⚠️ Configurează credențialele SmartBill în Setări.</div>
              ):(
                <>
                  {/* Serie */}
                  <div className="fb-field">
                    <div className="fb-lbl">Serie factură</div>
                    {sbSeriesList.length>0
                      ?<select className="fb-sel" value={invModal.seriesInput} onChange={e=>setInvModal(p=>({...p,seriesInput:e.target.value}))}>
                          {sbSeriesList.map(s=><option key={s} value={s}>{s}</option>)}
                        </select>
                      :<input className="fb-inp" value={invModal.seriesInput} placeholder="ex: FACT" onChange={e=>setInvModal(p=>({...p,seriesInput:e.target.value}))}/>
                    }
                  </div>
                  {/* Gestiune */}
                  {sbUseStock&&(
                    <div className="fb-field">
                      <div className="fb-lbl">Gestiune SmartBill</div>
                      {sbWarehouses.length>0
                        ?<select className="fb-sel" value={sbWarehouse} onChange={e=>{setSbWarehouse(e.target.value);ls.set('sb_warehouse',e.target.value);}}>
                            {sbWarehouses.map(w=><option key={w} value={w}>{w}</option>)}
                          </select>
                        :<input className="fb-inp" value={sbWarehouse} placeholder="Depozit principal" onChange={e=>{setSbWarehouse(e.target.value);ls.set('sb_warehouse',e.target.value);}}/>
                      }
                    </div>
                  )}
                  {/* Opțiuni */}
                  <div style={{display:'flex',gap:20,flexWrap:'wrap',padding:'6px 0'}}>
                    <div className="fb-trow" style={{gap:8}}>
                      <button className={`fb-toggle ${sbUseStock?'on':''}`} onClick={()=>{setSbUseStock(v=>!v);ls.set('sb_use_stock',String(!sbUseStock));}}/>
                      <span style={{fontSize:12,color:'#94a3b8'}}>Descarcă stoc gestiune</span>
                    </div>
                  </div>
                  {/* Info comandă */}
                  <div className="fb-infobox">
                    <strong style={{color:'#e2e8f0'}}>Client:</strong> {invModal.order.client}<br/>
                    {invModal.order.city&&<><strong style={{color:'#e2e8f0'}}>Oraș:</strong> {invModal.order.city}<br/></>}
                    <strong style={{color:'#e2e8f0'}}>Plată:</strong> {invModal.order.isOnlinePay?'💳 Card online (se va marca Încasat automat)':'💵 COD (se va marca Încasat dacă fin=paid)'}
                  </div>
                  {/* Produse */}
                  <div className="fb-section-title">Produse pe factură</div>
                  {invModal.editItems.map((item,idx)=>(
                    <div key={idx} style={{background:'#080c10',borderRadius:8,padding:'10px 12px',border:'1px solid rgba(255,255,255,.05)'}}>
                      <div style={{display:'flex',gap:8,marginBottom:6}}>
                        <div style={{flex:1}}>
                          <div className="fb-lbl" style={{marginBottom:3}}>Produs (numele din gestiune)</div>
                          <input className="fb-inp" value={item.name} onChange={e=>setInvModal(p=>{const it=[...p.editItems];it[idx]={...it[idx],name:e.target.value};return{...p,editItems:it};})}/>
                        </div>
                        <div style={{width:80}}>
                          <div className="fb-lbl" style={{marginBottom:3}}>SKU</div>
                          <input className="fb-inp" value={item.sku||''} onChange={e=>setInvModal(p=>{const it=[...p.editItems];it[idx]={...it[idx],sku:e.target.value};return{...p,editItems:it};})}/>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
                        <div style={{width:65}}>
                          <div className="fb-lbl" style={{marginBottom:3}}>Cant.</div>
                          <input type="number" min="1" className="fb-inp" value={item.qty} onChange={e=>setInvModal(p=>{const it=[...p.editItems];it[idx]={...it[idx],qty:parseInt(e.target.value)||1};return{...p,editItems:it};})}/>
                        </div>
                        <div style={{width:100}}>
                          <div className="fb-lbl" style={{marginBottom:3}}>Preț RON</div>
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
                    {Math.abs(invModal.editItems.reduce((s,i)=>s+i.qty*i.price,0)-invModal.order.total)>0.5&&<div style={{fontSize:9,color:'#f59e0b'}}>⚠ Diferă față de Shopify ({fmt(invModal.order.total)} RON)</div>}
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

      {/* ── MODAL ADRESĂ ──────────────────────────────────────────────── */}
      {addrModal&&(
        <div className="fb-overlay" onClick={e=>{if(e.target===e.currentTarget)setAddrModal(null);}}>
          <div className="fb-modal" style={{maxWidth:460}}>

            <div className="fb-mhdr" style={{position:'sticky',top:0,background:'#0f1419',zIndex:10,borderRadius:'14px 14px 0 0'}}>
              <div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:15}}>✏️</span>
                  <span className="fb-mt">Corectare adresă — {addrModal.order.name}</span>
                </div>
                <div style={{fontSize:11,color:'#475569',marginTop:2}}>Modificările se salvează în Shopify</div>
              </div>
              <button className="fb-mx" onClick={()=>setAddrModal(null)}>✕</button>
            </div>

            <div className="fb-mbdy">
              {(addrModal.apiIssues||[]).length>0&&(
                <div style={{background:'rgba(244,63,94,.08)',border:'1px solid rgba(244,63,94,.3)',borderRadius:10,padding:'10px 14px'}}>
                  <div style={{fontSize:11,color:'#f43f5e',fontWeight:700,marginBottom:5}}>⚠ Probleme detectate:</div>
                  {(addrModal.apiIssues||[]).map((iss,i)=>(
                    <div key={i} style={{fontSize:11,color:'#f43f5e',lineHeight:1.7}}>• {iss.msg||iss}</div>
                  ))}
                </div>
              )}

              {addrModal.suggestion&&(
                <div style={{
                  background: addrModal.suggestion.zipMismatch ? 'rgba(245,158,11,.07)' : 'rgba(16,185,129,.07)',
                  border: `1px solid ${addrModal.suggestion.zipMismatch ? 'rgba(245,158,11,.3)' : 'rgba(16,185,129,.25)'}`,
                  borderRadius:10, padding:'10px 14px',
                }}>
                  <div style={{fontSize:10,color: addrModal.suggestion.zipMismatch?'#f59e0b':'#10b981',fontWeight:700,marginBottom:6}}>
                    {addrModal.suggestion.zipMessage || `Adresa verificată · ZIP: ${addrModal.suggestion.postcode}`}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,color:'#94a3b8'}}>
                        📍 {addrModal.suggestion.city}{addrModal.suggestion.county?', '+addrModal.suggestion.county:''}
                        {addrModal.suggestion.formattedAddress?', '+addrModal.suggestion.formattedAddress:''}
                      </div>
                      {addrModal.suggestion.postcode&&(
                        <div style={{fontSize:13,fontWeight:800,color: addrModal.suggestion.zipMismatch?'#f59e0b':'#10b981',marginTop:3,fontFamily:'monospace'}}>
                          ZIP: {addrModal.suggestion.postcode}
                          {addrModal.suggestion.zipMismatch&&<span style={{fontSize:10,color:'#94a3b8',fontWeight:400,marginLeft:6}}>
                            (actual: {addrModal.editAddr.zip||'lipsă'})
                          </span>}
                        </div>
                      )}
                    </div>
                    <button onClick={applyAddrSuggestion}
                      style={{background:'#10b981',color:'white',border:'none',borderRadius:6,padding:'6px 18px',fontSize:12,fontWeight:700,cursor:'pointer',flexShrink:0}}>
                      fix
                    </button>
                  </div>
                </div>
              )}

              {[
                {key:'name',    label:'NUME DESTINATAR',              ph:'Ion Popescu'},
                {key:'phone',   label:'TELEFON',                      ph:'07XXXXXXXX'},
                {key:'address', label:'ADRESĂ (STR. + NR.)',          ph:'Str. Exemplu nr. 10'},
                {key:'address2',label:'APARTAMENT / ETAJ (OPȚIONAL)', ph:'Ap. 3, Et. 2'},
                {key:'city',    label:'ORAȘ',                         ph:'București'},
                {key:'county',  label:'JUDEȚ',                        ph:'Ilfov'},
                {key:'zip',     label:'COD POȘTAL',                   ph:'077190'},
              ].map(({key,label,ph})=>{
                const apiErr = (addrModal.apiIssues||[]).some(i=>(i.field||'')=== key);
                const loc = validateAddr(addrModal.editAddr);
                const locErr = key==='address'&&loc.some(i=>i.includes('strad')) || key==='phone'&&loc.some(i=>i.includes('telefon')||i.includes('Telefon'));
                const isErr = apiErr||locErr;
                return (
                  <div key={key} className="fb-field">
                    <div className="fb-lbl" style={{color:isErr?'#f43f5e':'#64748b'}}>{label}</div>
                    <input
                      className={`fb-inp ${isErr?'err':''}`}
                      value={addrModal.editAddr[key]||''} placeholder={ph}
                      style={{fontFamily:'monospace',fontSize:14}}
                      onChange={e=>setAddrModal(p=>({...p,editAddr:{...p.editAddr,[key]:e.target.value}}))}
                    />
                  </div>
                );
              })}

              {(()=>{
                const rem = validateAddr(addrModal.editAddr);
                if(rem.length>0) return (
                  <div className="fb-warnbox">
                    <div style={{fontWeight:700,marginBottom:4}}>⚠ Probleme rămase:</div>
                    {rem.map((r,i)=><div key={i} style={{fontSize:11}}>• {r}</div>)}
                  </div>
                );
                return <div className="fb-okbox"><div style={{color:'#10b981',fontWeight:700,fontSize:13}}>✓ Adresa validă!</div></div>;
              })()}
            </div>

            <div className="fb-mftr" style={{position:'sticky',bottom:0,background:'#0f1419',borderRadius:'0 0 14px 14px'}}>
              <button className="fb-btn-g" onClick={()=>setAddrModal(null)}>Anulează</button>
              <button
                onClick={()=>validateAddrApi(addrModal.editAddr,false)}
                disabled={addrModal.validating}
                style={{flex:1,background:'rgba(59,130,246,.12)',border:'1px solid rgba(59,130,246,.3)',color:'#3b82f6',borderRadius:8,padding:'9px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',opacity:addrModal.validating?.6:1}}>
                {addrModal.validating?'⟳ Verifică...':'🔍 Verifică'}
              </button>
              <button className="fb-btn-p" disabled={addrModal.saving}
                onClick={()=>saveAddress(addrModal.order,addrModal.editAddr)} style={{flex:2}}>
                {addrModal.saving?'↻ Se salvează...':'💾 Salvează în Shopify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL BULK ────────────────────────────────────────────────── */}
      {bulkModal&&(
        <div className="fb-overlay" onClick={e=>{if(e.target===e.currentTarget)setBulkModal(false);}}>
          <div className="fb-modal" style={{maxWidth:440}}>
            <div className="fb-mhdr"><div className="fb-mt">⚡ Procesare Bulk</div><button className="fb-mx" onClick={()=>setBulkModal(false)}>✕</button></div>
            <div className="fb-mbdy">
              <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.6}}>Procesează <strong style={{color:'#e2e8f0'}}>{filteredOrders.length}</strong> comenzi din filtrul curent.</div>
              <div className="fb-field"><div className="fb-lbl">Curier</div>
                <select className="fb-sel" value={bulkCourier} onChange={e=>setBulkCourier(e.target.value)}>
                  <option value="gls">GLS Romania</option><option value="sameday">Sameday</option>
                </select>
              </div>
              <div className="fb-field"><div className="fb-lbl">Greutate standard (kg)</div><input type="number" step="0.1" min="0.1" className="fb-inp" value={bulkWeight} onChange={e=>setBulkWeight(e.target.value)}/></div>
              <div className="fb-trow"><span className="fb-trow-label">Generează AWB (comenzi fără AWB)</span><button className={`fb-toggle ${bulkDoAwb?'on':''}`} onClick={()=>setBulkDoAwb(v=>!v)}/></div>
              <div className="fb-trow"><span className="fb-trow-label">Emite facturi SmartBill (comenzi plătite)</span><button className={`fb-toggle ${bulkDoInv?'on':''}`} onClick={()=>setBulkDoInv(v=>!v)}/></div>
            </div>
            <div className="fb-mftr">
              <button className="fb-btn-g" onClick={()=>setBulkModal(false)}>Anulează</button>
              <button className="fb-btn-p" onClick={runBulk}>⚡ Procesează</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL SETĂRI ──────────────────────────────────────────────── */}
      {settingsOpen&&(
        <div className="fb-overlay" onClick={e=>{if(e.target===e.currentTarget)setSettingsOpen(false);}}>
          <div className="fb-modal" style={{maxWidth:680}}>
            <div className="fb-mhdr">
              <div className="fb-mt">⚙️ Setări Integrări</div>
              <button className="fb-mx" onClick={()=>setSettingsOpen(false)}>✕</button>
            </div>
            <div className="fb-mbdy">

              {/* ── GLS ── */}
              <div className="fb-sett-card" style={{gridColumn:'1/-1'}}>
                <div className="fb-sett-hdr" style={{color:'#f97316'}}>
                  📦 GLS Romania
                  {glsStatus==='ok'&&<span style={{marginLeft:'auto',fontSize:10,background:'rgba(16,185,129,.15)',color:'#10b981',border:'1px solid rgba(16,185,129,.3)',padding:'3px 10px',borderRadius:10,fontWeight:700}}>✓ Conectat</span>}
                  {glsStatus==='error'&&<span style={{marginLeft:'auto',fontSize:10,background:'rgba(244,63,94,.15)',color:'#f43f5e',border:'1px solid rgba(244,63,94,.3)',padding:'3px 10px',borderRadius:10,fontWeight:700}}>✗ Eroare</span>}
                  {glsStatus==='testing'&&<span style={{marginLeft:'auto',fontSize:10,color:'#64748b'}}>⟳ Se testează...</span>}
                </div>
                <div className="fb-sett-body">
                  {glsEnvOk&&glsStatus!=='error'&&(
                    <div style={{background:'rgba(16,185,129,.07)',border:'1px solid rgba(16,185,129,.2)',borderRadius:8,padding:'10px 12px',fontSize:12,color:'#10b981'}}>
                      ✓ Credențialele GLS sunt în <strong>Vercel ENV</strong> (GLS_USERNAME / GLS_PASSWORD)
                    </div>
                  )}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div className="fb-field">
                      <div className="fb-lbl">Username / App ID</div>
                      <input className="fb-inp" value={glsUser} onChange={e=>setGlsUser(e.target.value)} placeholder={glsEnvOk?'(din Vercel ENV)':'user@gls.ro'}/>
                    </div>
                    <div className="fb-field">
                      <div className="fb-lbl">Parolă / API Secret</div>
                      <input type="password" className="fb-inp" value={glsPass} onChange={e=>setGlsPass(e.target.value)} placeholder={glsEnvOk?'(din Vercel ENV)':'••••••'}/>
                    </div>
                  </div>
                  <div className="fb-field">
                    <div className="fb-lbl">Număr Client GLS</div>
                    <input className="fb-inp" value={glsClient} onChange={e=>setGlsClient(e.target.value)} placeholder="553003585"/>
                  </div>
                  {glsStatusMsg&&<div style={{fontSize:11,color:glsStatus==='ok'?'#10b981':'#f43f5e',background:glsStatus==='ok'?'rgba(16,185,129,.07)':'rgba(244,63,94,.07)',border:`1px solid ${glsStatus==='ok'?'rgba(16,185,129,.2)':'rgba(244,63,94,.2)'}`,borderRadius:7,padding:'7px 10px'}}>{glsStatusMsg}</div>}
                  <button className="fb-btn-g" style={{fontSize:12}} onClick={testGlsConnection} disabled={glsStatus==='testing'}>
                    {glsStatus==='testing'?'⟳ Se testează...':'🔌 Testează conexiunea GLS'}
                  </button>
                </div>
              </div>

              {/* ── SAMEDAY ── */}
              <div className="fb-sett-card" style={{gridColumn:'1/-1'}}>
                <div className="fb-sett-hdr" style={{color:'#3b82f6'}}>
                  🚀 Sameday
                  {sdStatus==='ok'&&<span style={{marginLeft:'auto',fontSize:10,background:'rgba(16,185,129,.15)',color:'#10b981',border:'1px solid rgba(16,185,129,.3)',padding:'3px 10px',borderRadius:10,fontWeight:700}}>✓ Conectat</span>}
                  {sdStatus==='error'&&<span style={{marginLeft:'auto',fontSize:10,background:'rgba(244,63,94,.15)',color:'#f43f5e',border:'1px solid rgba(244,63,94,.3)',padding:'3px 10px',borderRadius:10,fontWeight:700}}>✗ Eroare</span>}
                  {sdStatus==='testing'&&<span style={{marginLeft:'auto',fontSize:10,color:'#64748b'}}>⟳ Se testează...</span>}
                </div>
                <div className="fb-sett-body">
                  {sdEnvOk&&sdStatus!=='error'&&(
                    <div style={{background:'rgba(16,185,129,.07)',border:'1px solid rgba(16,185,129,.2)',borderRadius:8,padding:'10px 12px',fontSize:12,color:'#10b981'}}>
                      ✓ Credențialele Sameday sunt în <strong>Vercel ENV</strong> (SAMEDAY_USERNAME / SAMEDAY_PASSWORD)
                    </div>
                  )}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div className="fb-field">
                      <div className="fb-lbl">Username</div>
                      <input className="fb-inp" value={sdUser} onChange={e=>setSdUser(e.target.value)} placeholder={sdEnvOk?'(din Vercel ENV)':'username'}/>
                    </div>
                    <div className="fb-field">
                      <div className="fb-lbl">Parolă</div>
                      <input type="password" className="fb-inp" value={sdPass} onChange={e=>setSdPass(e.target.value)} placeholder={sdEnvOk?'(din Vercel ENV)':'••••••'}/>
                    </div>
                  </div>
                  {sdStatusMsg&&<div style={{fontSize:11,color:sdStatus==='ok'?'#10b981':'#f43f5e',background:sdStatus==='ok'?'rgba(16,185,129,.07)':'rgba(244,63,94,.07)',border:`1px solid ${sdStatus==='ok'?'rgba(16,185,129,.2)':'rgba(244,63,94,.2)'}`,borderRadius:7,padding:'7px 10px'}}>{sdStatusMsg}</div>}
                  <button className="fb-btn-g" style={{fontSize:12}} onClick={testSdConnection} disabled={sdStatus==='testing'}>
                    {sdStatus==='testing'?'⟳ Se testează...':'🔌 Testează conexiunea Sameday'}
                  </button>
                  {sdConfig.pickupPoints.length>0&&(
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                      <div className="fb-field">
                        <div className="fb-lbl">Pickup Point ({sdConfig.pickupPoints.length} disponibile)</div>
                        <select className="fb-sel" value={sdPickup} onChange={e=>setSdPickup(e.target.value)}>
                          {sdConfig.pickupPoints.map(p=><option key={p.id} value={p.id}>{p.name} ({p.city})</option>)}
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

              {/* ── SMARTBILL ── */}
              <div className="fb-sett-card" style={{gridColumn:'1/-1'}}>
                <div className="fb-sett-hdr" style={{color:'#10b981'}}>🧾 SmartBill</div>
                <div className="fb-sett-body">
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                    <div className="fb-field"><div className="fb-lbl">Email</div><input className="fb-inp" value={sbEmail} onChange={e=>setSbEmail(e.target.value)} placeholder="email@firma.ro"/></div>
                    <div className="fb-field"><div className="fb-lbl">Token API</div><input type="password" className="fb-inp" value={sbToken} onChange={e=>setSbToken(e.target.value)} placeholder="token"/></div>
                    <div className="fb-field"><div className="fb-lbl">CIF</div><input className="fb-inp" value={sbCif} onChange={e=>setSbCif(e.target.value)} placeholder="RO12345678"/></div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                    <div className="fb-field">
                      <div className="fb-lbl">Serie Factură</div>
                      {sbSeriesList.length>0?<select className="fb-sel" value={sbSeries} onChange={e=>setSbSeries(e.target.value)}>{sbSeriesList.map(s=><option key={s}>{s}</option>)}</select>
                      :<input className="fb-inp" value={sbSeries} onChange={e=>setSbSeries(e.target.value)} placeholder="FACT"/>}
                    </div>
                    <div className="fb-field"><div className="fb-lbl">Serie Chitanță</div><input className="fb-inp" value={sbPaySeries} onChange={e=>setSbPaySeries(e.target.value)} placeholder="CHT"/></div>
                    <div className="fb-field">
                      <div className="fb-lbl">Gestiune</div>
                      {sbWarehouses.length>0?<select className="fb-sel" value={sbWarehouse} onChange={e=>setSbWarehouse(e.target.value)}>{sbWarehouses.map(w=><option key={w}>{w}</option>)}</select>
                      :<input className="fb-inp" value={sbWarehouse} onChange={e=>setSbWarehouse(e.target.value)} placeholder="Depozit"/>}
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

// ── AWB Modal — GLS + Sameday cu toate opțiunile ──────────────────────────
function AwbModal({ order, glsUser, glsPass, glsClient, sdUser, sdPass, sdConfig, sdPickup, sdService, onGenerate, onCancel }) {
  const [courier,setCourier]   = useState(order.courier!=='unknown'?order.courier:'gls');
  const [weight,setWeight]     = useState('1');
  const [parcels,setParcels]   = useState('1');
  const [manual,setManual]     = useState('');
  const [useManual,setUseManual] = useState(false);

  // GLS services
  const [glsSelected,setGlsSelected] = useState({});
  const [glsParams,setGlsParams]     = useState({});

  // Sameday options
  const [sdOpts,setSdOpts] = useState({ openPackage:false,saturdayDelivery:false,thermo:false,repaymentTransport:false });
  const [sdObservation,setSdObservation] = useState('');


  // Sameday easybox sender drop-off
  const [sdUseEasybox,setSdUseEasybox]   = useState(false);
  const [sdEasyboxId,setSdEasyboxId]     = useState("");
  const [sdLockerList,setSdLockerList]   = useState([]);
  const [sdLockerCounty,setSdLockerCounty] = useState("");
  const [sdLockerLoading,setSdLockerLoading] = useState(false);

  const loadLockers = async () => {
    if (!sdUser||!sdPass) return;
    setSdLockerLoading(true);
    try {
      const res = await fetch("/api/sameday-awb", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ action:"get_lockers", username:sdUser, password:sdPass, county:sdLockerCounty }),
      });
      const data = await res.json();
      if (data.ok) setSdLockerList(data.lockers||[]);
    } catch {}
    setSdLockerLoading(false);
  };
  const fmt2=n=>Number(n||0).toLocaleString('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2});
  const addrOk = order.addrIssues?.length===0;

  const toggleGls = (code)=>{
    setGlsSelected(p=>({...p,[code]:!p[code]}));
  };

  const buildGlsServices = ()=>{
    const svc = {};
    for (const [code,selected] of Object.entries(glsSelected)) {
      if (!selected) continue;
      const def = GLS_SERVICES[code];
      if (def.param==='phone') svc[code]=glsParams[code]||order.phone||'';
      else if (def.param==='email') svc[code]=glsParams[code]||'';
      else if (def.param==='value') svc[code]=glsParams[code]||String(order.total);
      else if (def.param==='shopId') svc[code]=glsParams[code]||'';
      else svc[code]=true;
    }
    return svc;
  };

  const handleGenerate = ()=>{
    onGenerate({
      courier,weight,parcels,
      manualAwb:useManual?manual:'',
      selectedServices:courier==='gls'?buildGlsServices():{},
      sdOptions:courier==="sameday"?sdOpts:{},
      senderEasyboxId:courier==="sameday"&&sdUseEasybox?sdEasyboxId:"",
      observation:sdObservation,
    });
  };

  // Grupează GLS services
  const glsGroups = {};
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
          {/* Adresă */}
          <div className="fb-infobox" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <div><div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:.5}}>Client</div><div style={{fontWeight:700,fontSize:12}}>{order.client}</div></div>
            <div><div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:.5}}>Adresă</div><div style={{fontSize:11,color:'#94a3b8'}}>{order.address}, {order.city}</div></div>
            <div><div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:.5}}>Total</div><div style={{fontWeight:800,fontSize:13,color:order.isCOD?'#f97316':'#3b82f6',fontFamily:'monospace'}}>{fmt2(order.total)} RON {order.isCOD?'(COD)':'(CARD)'}</div></div>
            <div><div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:.5}}>Telefon</div><div style={{fontSize:11,fontFamily:'monospace',color:'#94a3b8'}}>{order.phone||'—'}</div></div>
          </div>
          {!addrOk&&<div className="fb-errbox">⚠️ Adresă cu probleme! Corectează din lista de comenzi înainte de a genera AWB.<br/>{order.addrIssues?.map((i,idx)=><div key={idx}>• {i}</div>)}</div>}

          {/* Curier */}
          <div>
            <div className="fb-lbl" style={{marginBottom:6}}>Curier</div>
            <div style={{display:'flex',gap:8}}>
              {[{id:'gls',label:'📦 GLS Romania',ok:!!(glsUser&&glsPass&&glsClient)},{id:'sameday',label:'🚀 Sameday',ok:!!(sdUser&&sdPass)}].map(c=>(
                <button key={c.id} onClick={()=>setCourier(c.id)} style={{flex:1,padding:'10px',borderRadius:8,border:`2px solid ${courier===c.id?(c.id==='gls'?'#f97316':'#3b82f6'):'rgba(255,255,255,.08)'}`,background:courier===c.id?(c.id==='gls'?'rgba(249,115,22,.1)':'rgba(59,130,246,.1)'):'transparent',color:courier===c.id?(c.id==='gls'?'#f97316':'#3b82f6'):'#64748b',fontWeight:700,fontSize:12,cursor:'pointer',transition:'all .15s'}}>
                  {c.label}{!c.ok&&<div style={{fontSize:9,color:'#f59e0b',marginTop:2}}>⚠ neconfigurat în Setări</div>}
                </button>
              ))}
            </div>
          </div>

          {/* Greutate & colete */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div className="fb-field"><div className="fb-lbl">Greutate (kg)</div><input type="number" step="0.1" min="0.1" className="fb-inp" value={weight} onChange={e=>setWeight(e.target.value)}/></div>
            <div className="fb-field"><div className="fb-lbl">Nr. colete</div><input type="number" min="1" className="fb-inp" value={parcels} onChange={e=>setParcels(e.target.value)}/></div>
          </div>

          {/* ── GLS Services ── */}
          {courier==='gls'&&(
            <div>
              <div className="fb-section-title">Servicii suplimentare GLS</div>
              {Object.entries(glsGroups).map(([group,svcs])=>(
                <div key={group} style={{marginBottom:8}}>
                  <div style={{fontSize:9,color:'#334155',textTransform:'uppercase',letterSpacing:.5,marginBottom:4}}>{group}</div>
                  <div className="fb-svc-grid">
                    {svcs.map(svc=>(
                      <div key={svc.code} className={`fb-svc-card ${glsSelected[svc.code]?'selected':''}`} onClick={()=>toggleGls(svc.code)}>
                        <div className={`fb-svc-check`}>{glsSelected[svc.code]&&<span style={{fontSize:10,color:'white'}}>✓</span>}</div>
                        <div className="fb-svc-body">
                          <div className="fb-svc-label">{svc.label}</div>
                          <div className="fb-svc-desc">{svc.desc}</div>
                          {glsSelected[svc.code]&&svc.param&&svc.param!==null&&(
                            <input className="fb-inp fb-svc-input" placeholder={svc.param==='phone'?'07XXXXXXXX':svc.param==='email'?'email@ex.com':svc.param==='value'?'valoare RON':'ID shop'} value={glsParams[svc.code]||''} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();setGlsParams(p=>({...p,[svc.code]:e.target.value}));}} style={{fontSize:11,padding:'5px 8px'}}/>
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
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                <div className={`fb-svc-card ${!sdUseEasybox?'selected-sd':''}`} onClick={()=>setSdUseEasybox(false)}>
                  <div className="fb-svc-check">{!sdUseEasybox&&<span style={{fontSize:10,color:'white'}}>✓</span>}</div>
                  <div className="fb-svc-body">
                    <div className="fb-svc-label">🚚 Ridicare de curier</div>
                    <div className="fb-svc-desc">Curierul Sameday vine la adresa ta de pickup să ridice coletele</div>
                  </div>
                </div>
                <div className={`fb-svc-card ${sdUseEasybox?'selected-sd':''}`} onClick={()=>setSdUseEasybox(true)}>
                  <div className="fb-svc-check">{sdUseEasybox&&<span style={{fontSize:10,color:'white'}}>✓</span>}</div>
                  <div className="fb-svc-body">
                    <div className="fb-svc-label">📦 Predare la easybox</div>
                    <div className="fb-svc-desc">Tu duci coletul la un easybox din rețeaua Sameday (serviciu Locker NextDay)</div>
                  </div>
                </div>
              </div>

              {/* Selectare easybox când expeditorul predă personal */}
              {sdUseEasybox&&(
                <div style={{background:'rgba(59,130,246,.06)',border:'1px solid rgba(59,130,246,.2)',borderRadius:8,padding:'12px 14px',marginBottom:10}}>
                  <div style={{fontSize:11,color:'#3b82f6',fontWeight:700,marginBottom:8}}>📦 Selectează easybox-ul unde duci coletul</div>
                  {sdLockerList.length===0?(
                    <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                      <input className="fb-inp" style={{flex:1,minWidth:120}} placeholder="Județ (ex: Ilfov, Cluj...)" value={sdLockerCounty} onChange={e=>setSdLockerCounty(e.target.value)}/>
                      <button className="fb-btn-p blue" style={{fontSize:11,padding:'7px 14px',whiteSpace:'nowrap'}} onClick={loadLockers} disabled={sdLockerLoading}>
                        {sdLockerLoading?<span className="fb-spin">↻</span>:'🔍 Caută easybox'}
                      </button>
                    </div>
                  ):(
                    <>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                        <div style={{fontSize:10,color:'#64748b'}}>{sdLockerList.length} easybox-uri găsite {sdLockerCounty&&`în ${sdLockerCounty}`}</div>
                        <button onClick={()=>{ setSdLockerList([]); setSdEasyboxId(''); }} style={{fontSize:10,background:'transparent',border:'none',color:'#475569',cursor:'pointer'}}>↩ Caută altul</button>
                      </div>
                      <select className="fb-sel" value={sdEasyboxId} onChange={e=>setSdEasyboxId(e.target.value)}>
                        <option value="">— Selectează easybox —</option>
                        {sdLockerList.map(l=>(
                          <option key={l.id} value={l.id}>{l.name} — {l.address}, {l.city}</option>
                        ))}
                      </select>
                      {sdEasyboxId&&(
                        <div style={{marginTop:6,fontSize:10,color:'#10b981'}}>
                          ✓ {sdLockerList.find(l=>String(l.id)===String(sdEasyboxId))?.address}, {sdLockerList.find(l=>String(l.id)===String(sdEasyboxId))?.city}
                        </div>
                      )}
                    </>
                  )}
                  <div style={{marginTop:8,fontSize:10,color:'#475569',lineHeight:1.5}}>
                    ℹ️ Serviciu: <strong style={{color:'#3b82f6'}}>Locker NextDay</strong> — după ce generezi AWB-ul, vei primi un QR code / PIN pentru a deschide easybox-ul. Ai la dispoziție 7 zile să depui coletul.
                  </div>
                </div>
              )}

              {/* Opțiuni suplimentare */}
              <div className="fb-section-title">Opțiuni suplimentare</div>
              <div className="fb-svc-grid">
                {Object.entries(SD_OPTIONS).map(([key,opt])=>(
                  <div key={key} className={`fb-svc-card ${sdOpts[key]?'selected-sd':''}`} onClick={()=>setSdOpts(p=>({...p,[key]:!p[key]}))}>
                    <div className="fb-svc-check">{sdOpts[key]&&<span style={{fontSize:10,color:'white'}}>✓</span>}</div>
                    <div className="fb-svc-body"><div className="fb-svc-label">{opt.label}</div><div className="fb-svc-desc">{opt.desc}</div></div>
                  </div>
                ))}
              </div>
              <div className="fb-field" style={{marginTop:8}}>
                <div className="fb-lbl">Observații colet (apare pe AWB)</div>
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
            {useManual&&<input className="fb-inp" placeholder={courier==='gls'?'ex: 123456789':'ex: 1SDA123456789'} value={manual} onChange={e=>setManual(e.target.value)}/>}
          </div>
        </div>

        <div className="fb-mftr">
          <button className="fb-btn-g" onClick={onCancel}>Anulează</button>
          <button className="fb-btn-p" disabled={useManual&&!manual} onClick={handleGenerate}>
            🚚 {useManual?'Înregistrează AWB':'Generează AWB'}
          </button>
        </div>
      </div>
    </div>
  );
}