'use client';
/**
 * app/documente/page.js — Documente: sortare automată email → Google Drive
 *
 * Conectare Gmail (OAuth, citire + Drive) și Yahoo (IMAP, parolă de aplicație,
 * citire), sincronizare (automată zilnic + buton manual), clasificare după
 * expeditor în An/Lună/Categorie pe Drive, cu jurnal în DB. Coș „Neclasificate"
 * pentru expeditori noi + panou de reguli editabile. Statistici lunare
 * persistente (introduse manual, salvate server-side — nu se pierd).
 *
 * Stil identic cu celelalte pagini din dashboard (app/fulfillment/page.js,
 * app/gls/page.js): clase `.doc-*`, aceeași paletă închisă, aceleași
 * butoane/toast-uri/carduri.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';

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
  .doc-page{max-width:1200px;margin:0 auto;padding:12px 12px 120px;font-family:'DM Sans',system-ui,sans-serif;}

  .doc-hdr{position:sticky;top:0;z-index:200;background:rgba(7,9,14,.97);backdrop-filter:blur(24px) saturate(180%);border-bottom:1px solid rgba(255,255,255,.06);padding:0 16px;margin-bottom:16px;}
  .doc-hdr-inner{display:flex;align-items:center;gap:10px;padding:12px 0;flex-wrap:wrap;}
  .doc-logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#f97316,#dc2626);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;box-shadow:0 4px 16px rgba(249,115,22,.35);}
  .doc-title h1{font-size:16px;font-weight:800;letter-spacing:-.5px;color:#f1f5f9;}
  .doc-title p{font-size:10px;color:#475569;margin-top:1px;}

  .doc-section-title{font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin:22px 0 10px;}
  .doc-section-title:first-of-type{margin-top:0;}

  .doc-panel{background:#0c1018;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px 16px;margin-bottom:10px;}

  .doc-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px;}
  @media(min-width:600px){.doc-kpis{grid-template-columns:repeat(3,1fr);}}
  .doc-kpi{background:#0c1018;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px 14px;}
  .doc-kpi-l{font-size:9px;color:#475569;margin-bottom:6px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;}
  .doc-kpi input{width:100%;background:#080d12;border:1px solid #1a2535;color:#e2e8f0;padding:7px 9px;border-radius:7px;font-size:14px;font-family:'Space Grotesk',monospace;font-weight:700;outline:none;}
  .doc-kpi input:focus{border-color:#f97316;}

  .doc-account{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #161d24;flex-wrap:wrap;}
  .doc-account:last-child{border-bottom:none;}
  .doc-account-icon{width:34px;height:34px;border-radius:9px;background:#080d12;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
  .doc-account-email{font-size:13px;font-weight:700;color:#e2e8f0;word-break:break-all;}
  .doc-account-meta{font-size:10px;color:#475569;margin-top:1px;}
  .doc-account-actions{display:flex;gap:8px;flex-wrap:wrap;margin-left:44px;}
  @media(min-width:520px){.doc-account-actions{margin-left:0;}}

  .doc-badges{display:flex;gap:5px;flex-wrap:wrap;}
  .doc-badge{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap;}
  .doc-badge-ok{background:rgba(16,185,129,.1);color:#10b981;border:1px solid rgba(16,185,129,.2);}
  .doc-badge-warn{background:rgba(245,158,11,.1);color:#f59e0b;border:1px solid rgba(245,158,11,.2);}
  .doc-badge-gray{background:rgba(255,255,255,.05);color:#64748b;border:1px solid rgba(255,255,255,.08);}

  .doc-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;}
  .doc-btn{display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:8px;border:none;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;text-decoration:none;}
  .doc-btn-primary{background:linear-gradient(135deg,#f97316,#ea580c);color:white;}
  .doc-btn-ghost{background:rgba(255,255,255,.05);color:#94a3b8;border:1px solid rgba(255,255,255,.1);}
  .doc-btn-green{background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.25);}
  .doc-btn-blue{background:rgba(59,130,246,.15);color:#60a5fa;border:1px solid rgba(59,130,246,.25);}
  .doc-btn-red{background:rgba(244,63,94,.12);color:#f43f5e;border:1px solid rgba(244,63,94,.22);}
  .doc-btn:disabled{opacity:.4;cursor:not-allowed;}

  .doc-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  @media(max-width:480px){.doc-grid2{grid-template-columns:1fr;}}
  .doc-field{display:flex;flex-direction:column;gap:5px;}
  .doc-lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:700;}
  .doc-inp,.doc-select{background:#080d12;border:1px solid #1a2535;color:#e2e8f0;padding:9px 12px;border-radius:8px;font-size:13px;outline:none;font-family:inherit;}
  .doc-inp:focus,.doc-select:focus{border-color:#f97316;}

  .doc-month-nav{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
  .doc-month-btn{background:#0c1018;border:1px solid rgba(255,255,255,.08);color:#94a3b8;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:14px;}
  .doc-month-label{font-family:'Space Grotesk',monospace;font-size:15px;font-weight:800;color:#f97316;flex:1;text-align:center;}

  .doc-cat{background:#0c1018;border:1px solid rgba(255,255,255,.06);border-radius:14px;margin-bottom:8px;overflow:hidden;}
  .doc-cat-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;}
  .doc-cat-name{font-size:13px;font-weight:700;color:#e2e8f0;}
  .doc-cat-count{font-size:10px;color:#475569;margin-left:8px;}
  .doc-cat-body{padding:0 16px 12px;}
  .doc-file{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid #161d24;}
  .doc-file-name{font-size:11px;color:#cbd5e1;font-weight:600;}
  .doc-file-meta{font-size:9px;color:#475569;margin-top:1px;}

  .doc-empty{text-align:center;padding:36px 20px;color:#334155;font-size:12px;}
  .doc-errbox{background:rgba(244,63,94,.07);border:1px solid rgba(244,63,94,.25);border-radius:8px;padding:10px 14px;font-size:12px;color:#f43f5e;margin-bottom:12px;}
  .doc-warnbox{background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:10px 14px;font-size:12px;color:#f59e0b;}

  @keyframes docspin{to{transform:rotate(360deg)}}
  .doc-spin{display:inline-block;animation:docspin .7s linear infinite;}

  .doc-toasts{position:fixed;bottom:calc(var(--nav-h,62px) + env(safe-area-inset-bottom,0px) + 12px);right:12px;z-index:9999;display:flex;flex-direction:column;gap:6px;}
  .doc-toast{background:#131c28;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 16px;font-size:12px;font-weight:600;color:#e2e8f0;max-width:320px;}
  .doc-toast.success{border-color:rgba(16,185,129,.3);background:rgba(16,185,129,.08);color:#10b981;}
  .doc-toast.error{border-color:rgba(244,63,94,.3);background:rgba(244,63,94,.08);color:#f43f5e;}

  .doc-section{background:#0c1018;border:1px solid rgba(255,255,255,.06);border-radius:14px;margin-bottom:10px;overflow:hidden;}
  .doc-section-hdr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;cursor:pointer;user-select:none;}
  .doc-section-hdr-title{font-size:12px;font-weight:800;color:#e2e8f0;text-transform:uppercase;letter-spacing:.6px;display:flex;align-items:center;gap:8px;}
  .doc-section-hdr-count{font-size:10px;color:#475569;font-weight:700;text-transform:none;letter-spacing:0;}
  .doc-section-chevron{color:#475569;font-size:12px;transition:transform .15s;flex-shrink:0;}
  .doc-section-body{padding:0 16px 16px;}
  .doc-combine-row{display:flex;gap:6px;flex-wrap:wrap;padding:8px 16px;border-top:1px solid #161d24;}
`;

/** Collapsible panel used to keep the page scannable — most maintenance
 * sections (accounts, rules, manual uploads) default closed; the ones
 * checked daily (Neclasificate, Foldere) default open. */
function Section({ title, icon, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="doc-section">
      <div className="doc-section-hdr" onClick={() => setOpen(v => !v)}>
        <div className="doc-section-hdr-title">
          {icon} {title} {typeof count === 'number' && <span className="doc-section-hdr-count">({count})</span>}
        </div>
        <span className="doc-section-chevron">{open ? '▲' : '▼'}</span>
      </div>
      {open && <div className="doc-section-body">{children}</div>}
    </div>
  );
}

// Must match lib/mail/classify.ts's AWB_SUBCATEGORY exactly — a rule saved
// with this subcategory value gets its real subcategory (AWB-<number>)
// computed server-side per message, extracted from the subject/filename.
const AWB_SUBCATEGORY = '{AWB}';

const CATEGORY_PRESETS = [
  { category: 'GLS', subcategories: ['Rambursuri', 'Facturi transport'] },
  { category: 'Sameday', subcategories: ['Rambursuri', 'Facturi transport'] },
  { category: 'Receptie', subcategories: [] },
  { category: 'Facebook', subcategories: [] },
  { category: 'TikTok', subcategories: [] },
  { category: 'Google', subcategories: [] },
  { category: 'Shopify', subcategories: [] },
  { category: 'SmartBill', subcategories: [] },
  { category: 'Vesna', subcategories: [] },
  { category: 'Extras', subcategories: [] },
];

const MONTH_NAMES_RO = ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function firstOfMonth(month) {
  return `${month}-01`;
}
function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES_RO[m - 1]} ${y}`;
}
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const fmt = n => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatField({ label, value, onChange, onCompute, computing }) {
  return (
    <div className="doc-kpi">
      <div className="doc-kpi-l" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{label}</span>
        {onCompute && (
          <button
            type="button"
            onClick={onCompute}
            disabled={computing}
            title="Calculează automat din documentele GLS deja importate"
            style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontSize: 12, padding: 0 }}
          >
            {computing ? <span className="doc-spin">↻</span> : '🧮'}
          </button>
        )}
      </div>
      <input type="number" step="0.01" value={value ?? ''} placeholder="0.00" onChange={e => onChange(e.target.value)} />
    </div>
  );
}

export default function DocumentePage() {
  const { toasts, toast } = useToast();

  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [yahooForm, setYahooForm] = useState({ email: '', appPassword: '' });
  const [connectingYahoo, setConnectingYahoo] = useState(false);
  const [showYahooForm, setShowYahooForm] = useState(false);

  const [reclassifying, setReclassifying] = useState(false);
  const [uploadingMeta, setUploadingMeta] = useState(false);
  const [uploadingReceptie, setUploadingReceptie] = useState(false);
  const [receptieProgress, setReceptieProgress] = useState(null);
  const [receptieDebug, setReceptieDebug] = useState(null);
  const [uploadingExtras, setUploadingExtras] = useState(false);
  const [extrasProgress, setExtrasProgress] = useState(null);
  const [combineDebug, setCombineDebug] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total }
  const [backfillFor, setBackfillFor] = useState(null); // mailAccountId
  const [backfillDate, setBackfillDate] = useState('');
  const [backfilling, setBackfilling] = useState(false);

  const [month, setMonth] = useState(currentMonth());
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [openCats, setOpenCats] = useState({});

  const [stat, setStat] = useState(null);
  const [savingStat, setSavingStat] = useState(false);
  const [computingGls, setComputingGls] = useState(false);
  const [glsDebug, setGlsDebug] = useState(null);
  const [glsPerFile, setGlsPerFile] = useState(null);
  const [glsDuplicates, setGlsDuplicates] = useState(null);
  const [computingMeta, setComputingMeta] = useState(false);
  const [computingSameday, setComputingSameday] = useState(false);

  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState({ category: 'GLS', customCategory: '', subcategory: '', awbAuto: false, matchType: 'sender_domain', matchValue: '', filenameContains: '' });
  const [savingRule, setSavingRule] = useState(false);

  const [unclassified, setUnclassified] = useState([]);
  const [assign, setAssign] = useState({}); // docId -> { category, subcategory, createRule }

  const loadAccounts = useCallback(() => {
    setLoadingAccounts(true);
    fetch('/api/mail/accounts').then(r => r.json()).then(d => setAccounts(d.accounts || [])).finally(() => setLoadingAccounts(false));
  }, []);

  const loadDocuments = useCallback(() => {
    setLoadingDocs(true);
    fetch(`/api/mail/documents?month=${month}`).then(r => r.json()).then(d => setDocuments(d.documents || [])).finally(() => setLoadingDocs(false));
  }, [month]);

  const loadUnclassified = useCallback(() => {
    fetch('/api/mail/documents?status=unclassified').then(r => r.json()).then(d => setUnclassified(d.documents || []));
  }, []);

  const loadStat = useCallback(() => {
    fetch(`/api/mail/stats?month=${month}`).then(r => r.json()).then(d => setStat(d.stat || null));
  }, [month]);

  const loadRules = useCallback(() => {
    fetch('/api/mail/rules').then(r => r.json()).then(d => setRules(d.rules || []));
  }, []);

  useEffect(() => { loadAccounts(); loadRules(); loadUnclassified(); }, [loadAccounts, loadRules, loadUnclassified]);
  useEffect(() => { loadDocuments(); loadStat(); }, [loadDocuments, loadStat]);

  // Feedback de la /api/mail/google/callback (?connected= / ?mailError=)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const mailError = params.get('mailError');
    if (connected) {
      toast(`✅ Cont Google conectat: ${connected}`, 'success');
      loadAccounts();
    }
    if (mailError) toast(`❌ ${mailError}`, 'error');
    if (connected || mailError) window.history.replaceState({}, '', '/documente');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/mail/sync');
      const data = await res.json();
      const totalIngested = (data.results || []).reduce((a, r) => a + (r.ingested || 0), 0);
      const errors = (data.results || []).filter(r => r.error);
      if (errors.length) toast(`⚠️ Sincronizat cu erori: ${errors.map(e => e.email).join(', ')}`, 'error');
      else toast(`✅ Sincronizat — ${totalIngested} documente noi`, 'success');
      loadDocuments(); loadUnclassified(); loadAccounts();
    } catch (e) {
      toast('Eroare sincronizare: ' + e.message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const runReclassify = async () => {
    setReclassifying(true);
    try {
      const res = await fetch('/api/mail/reclassify', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare reclasificare');
      toast(`✅ Reclasificat — ${data.changed} din ${data.checked} documente mutate`, 'success');
      loadDocuments(); loadUnclassified();
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setReclassifying(false);
    }
  };

  const connectYahoo = async () => {
    if (!yahooForm.email || !yahooForm.appPassword) { toast('Completează email și parola de aplicație', 'error'); return; }
    setConnectingYahoo(true);
    try {
      const res = await fetch('/api/mail/connect/yahoo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(yahooForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare conectare');
      toast(`✅ Yahoo conectat: ${data.account.email}`, 'success');
      setYahooForm({ email: '', appPassword: '' });
      setShowYahooForm(false);
      setBackfillFor(data.account.id);
      setBackfillDate(firstOfMonth(currentMonth()));
      loadAccounts();
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setConnectingYahoo(false);
    }
  };

  const disconnectAccount = async (id) => {
    if (!confirm('Deconectezi acest cont? Documentele deja importate rămân neatinse.')) return;
    await fetch(`/api/mail/accounts?id=${id}`, { method: 'DELETE' });
    toast('Cont deconectat', 'info');
    loadAccounts();
  };

  const runBackfill = async () => {
    if (!backfillFor || !backfillDate) return;
    setBackfilling(true);
    try {
      const res = await fetch('/api/mail/backfill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mailAccountId: backfillFor, since: backfillDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare import');
      toast(`✅ Import istoric — ${data.ingested} documente (din ${data.checked} email-uri verificate)`, 'success');
      setBackfillFor(null);
      loadDocuments(); loadUnclassified();
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setBackfilling(false);
    }
  };

  const saveStat = async (field, value) => {
    setStat(prev => ({ ...(prev || {}), [field]: value }));
  };
  const computeGlsStat = async () => {
    setComputingGls(true);
    setGlsDebug(null);
    setGlsPerFile(null);
    setGlsDuplicates(null);
    try {
      const res = await fetch('/api/mail/stats/compute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare calcul');
      setStat(data.stat);
      if (data.debug) setGlsDebug(data.debug);
      if (data.perFile) setGlsPerFile(data.perFile);
      if (data.duplicates) setGlsDuplicates(data.duplicates);
      if (data.checked === 0) {
        toast('⚠️ Niciun fișier "GLS / Rambursuri" găsit pentru luna asta — verifică subcategoria din reguli sau apasă „Reclasifică" întâi', 'error');
      } else if (data.errors?.length) {
        toast(`⚠️ GLS încasat: ${fmt(data.total)} RON (${data.filesUsed}/${data.checked} fișiere) — probleme: ${data.errors.join(' · ')}`, 'error');
      } else {
        toast(`✅ GLS încasat: ${fmt(data.total)} RON (din ${data.filesUsed} fișiere Rambursuri)`, 'success');
      }
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setComputingGls(false);
    }
  };

  const computeMetaStat = async () => {
    setComputingMeta(true);
    try {
      const res = await fetch('/api/mail/stats/compute-meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare calcul');
      setStat(data.stat);
      if (data.errors?.length) {
        toast(`⚠️ Meta spend: ${fmt(data.total)} RON (${data.filesUsed}/${data.checked} facturi) — probleme: ${data.errors.join(' · ')}`, 'error');
      } else {
        toast(`✅ Meta spend: ${fmt(data.total)} RON (din ${data.filesUsed} facturi)`, 'success');
      }
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setComputingMeta(false);
    }
  };

  const computeSamedayStat = async () => {
    setComputingSameday(true);
    try {
      const res = await fetch('/api/mail/stats/compute-sameday', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare calcul');
      setStat(data.stat);
      if (data.checked === 0) {
        toast('⚠️ Niciun fișier "Sameday / Rambursuri" găsit pentru luna asta', 'error');
      } else if (data.errors?.length) {
        toast(`⚠️ Sameday încasat: ${fmt(data.total)} RON (${data.filesUsed}/${data.checked} fișiere) — probleme: ${data.errors.join(' · ')}`, 'error');
      } else {
        toast(`✅ Sameday încasat: ${fmt(data.total)} RON (din ${data.filesUsed} fișiere)`, 'success');
      }
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setComputingSameday(false);
    }
  };

  const loadJSZip = () => new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.JSZip) { resolve(window.JSZip); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error('Nu s-a putut încărca JSZip'));
    document.head.appendChild(s);
  });

  const handleMetaUpload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploadingMeta(true);
    setUploadProgress({ done: 0, total: 0 });
    try {
      // Flatten: a .zip is unzipped in the browser (Meta's export can be 10+ MB —
      // too big to forward whole to a single serverless request), individual
      // .pdf files pass through as-is.
      const pdfEntries = [];
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const JSZip = await loadJSZip();
          const zip = await JSZip.loadAsync(file);
          for (const entry of Object.values(zip.files)) {
            if (entry.dir || !entry.name.toLowerCase().endsWith('.pdf')) continue;
            const blob = await entry.async('blob');
            pdfEntries.push({ name: entry.name.split('/').pop(), blob });
          }
        } else if (file.name.toLowerCase().endsWith('.pdf')) {
          pdfEntries.push({ name: file.name, blob: file });
        }
      }

      if (pdfEntries.length === 0) { toast('Nu am găsit niciun PDF în fișierele selectate', 'error'); return; }
      setUploadProgress({ done: 0, total: pdfEntries.length });

      let paid = 0, failed = 0, duplicate = 0, unknown = 0;
      const monthsAffected = new Set();
      for (const entry of pdfEntries) {
        try {
          const form = new FormData();
          form.append('file', entry.blob, entry.name);
          form.append('filename', entry.name);
          const res = await fetch('/api/mail/manual-upload', { method: 'POST', body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'eroare');
          if (data.status === 'paid' && data.uploaded) { paid++; monthsAffected.add(data.month); }
          else if (data.status === 'duplicate') { duplicate++; if (data.month) monthsAffected.add(data.month); }
          else if (data.status === 'failed') failed++;
          else unknown++;
        } catch {
          unknown++;
        }
        setUploadProgress(p => ({ done: (p?.done || 0) + 1, total: pdfEntries.length }));
      }

      for (const m of monthsAffected) {
        await fetch('/api/mail/stats/compute-meta', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: m }),
        }).catch(() => {});
      }

      toast(
        `✅ Meta: ${paid} facturi plătite urcate, ${failed} eșuate ignorate, ${duplicate} deja existente${unknown ? `, ${unknown} nerecunoscute` : ''}`,
        'success',
      );
      loadDocuments(); loadStat();
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setUploadingMeta(false);
      setUploadProgress(null);
    }
  };

  const loadXLSXLib = () => new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.XLSX) { resolve(window.XLSX); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Nu s-a putut încărca XLSX.js'));
    document.head.appendChild(s);
  });

  /**
   * PDF text extraction happens here, in the browser, NOT on the server.
   * Confirmed live, twice: pdf.js has no real Worker threads available in
   * Node/Vercel's serverless functions, and every fallback it tries there
   * (an ancient bundled version throwing on a technically-malformed but
   * real xref table, then a "fake worker" trying to require() a relative
   * path that doesn't survive webpack bundling) broke in a different way.
   * A real browser tab has genuine Worker support pdf.js can just use —
   * none of that class of problem exists here. Same reasoning that put
   * the xlsx→PDF conversion client-side already.
   */
  const loadPdfJsLib = () => new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('Nu s-a putut încărca PDF.js'));
    document.head.appendChild(s);
  });

  const extractTextFromPdf = async (file) => {
    const pdfjsLib = await loadPdfJsLib();
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
    }
    return text;
  };

  /** Mirrors lib/mail/invoice-awb-link.ts's extractInvoiceNumberFromText —
   * matches "Factura SX6193524801" (NIR wording) and generic "Invoice No: X". */
  const extractInvoiceNumberFromTextClient = (text) => {
    const patterns = [/Factur[ăa]\s+([A-Za-z0-9-]{5,})/i, /Invoice\s*(?:No\.?|Number)?[:\s]+([A-Za-z0-9-]{5,})/i];
    for (const p of patterns) {
      const m = (text || '').match(p);
      if (m) return m[1];
    }
    return null;
  };

  /** Recepție only ever holds PDFs — an .xlsx (the transport commercial
   * invoice) is rendered to a PDF client-side before upload; the original
   * filename (which sometimes encodes the invoice number + AWB) is kept
   * with just the extension swapped, so server-side filename extraction
   * still works when it can. */
  /**
   * Renders the ORIGINAL grid (every row/column of the sheet's used range,
   * with merged cells preserved as spanning cells) via jspdf-autotable's
   * grid theme, instead of reconstructing a simplified summary - this is
   * what makes the output look like a native Excel Save As -> PDF export.
   * One real, unavoidable limitation: the free xlsx (SheetJS Community)
   * build cannot read cell fill/background colour, so header shading is
   * lost - everything else (layout, merges, text, column order) is kept.
   * Fully-blank rows are dropped (confirmed safe for this document family:
   * none of its merge ranges span multiple rows, so no merge can straddle
   * a dropped row) - a genuinely different sheet layout with vertical
   * merges could in principle break on this, but none seen so far do.
   *
   * Also extracts the invoice number + AWB/tracking number straight from
   * the sheet's cells (not just the filename): some transport invoices
   * (confirmed real example: Invoice_tracking1309608801.xlsx) don't encode
   * the invoice number in the filename at all, only the tracking number -
   * so filename-only extraction silently loses the invoice-AWB link for
   * those. The caller sends these back to the server explicitly.
   */
  /**
   * Shared by convertXlsxToPdf (single-file Recepție upload) and
   * combineExcelFiles (the "un fișier per pagină A4" combine button) — the
   * full-grid, merge-aware extraction doesn't depend on which of those is
   * calling it, only on the parsed sheet.
   */
  const buildXlsxGridRows = (XLSX, sheet) => {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const merges = sheet['!merges'] || [];
    const covered = new Set();
    const spanAt = new Map();
    for (const m of merges) {
      const rowSpan = m.e.r - m.s.r + 1;
      const colSpan = m.e.c - m.s.c + 1;
      if (rowSpan < 2 && colSpan < 2) continue;
      spanAt.set(`${m.s.r},${m.s.c}`, { rowSpan, colSpan });
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue;
          covered.add(`${r},${c}`);
        }
      }
    }
    // Printable ASCII + Latin-1/Extended-A/B (keeps Romanian diacritics in
    // both spellings, drops CJK - jsPDF's default fonts can't render it).
    const clean = v => (v === null || v === undefined ? '' : String(v).replace(/[^ -~ -ɏ]/g, '').trim());

    /**
     * Confirmed real bug (GLS rambursuri xlsx): label rows like "Nume
     * Client: GLAMX SRL" aren't merged cells at all in the source file —
     * Excel just lets that text visually overflow into the empty
     * neighbouring cells (extremely common, no merge underneath). A
     * bordered grid theme draws a box around every cell regardless,
     * so those genuinely-empty neighbours showed up as a trailing row
     * of empty boxes instead of just... not being there. Collapsing a
     * run of empty cells into the non-empty cell right before it
     * mimics that overflow visually, without touching real, isolated
     * blank cells that sit between two non-empty ones (e.g. a blank
     * unit-header cell between "Sumă ramburs" and "Postal Address") —
     * those have no preceding run to merge into on their right side,
     * so they're left exactly as they were: their own empty cell.
     */
    const collapseEmptyRuns = (row) => {
      const out = [];
      for (const cell of row) {
        const isObj = cell !== null && typeof cell === 'object';
        const text = isObj ? cell.content : cell;
        if (text === '' && out.length > 0) {
          const prev = out[out.length - 1];
          if (typeof prev === 'object') {
            prev.colSpan = (prev.colSpan || 1) + 1;
            continue;
          }
          if (prev !== '') {
            out[out.length - 1] = { content: prev, colSpan: 2, rowSpan: 1 };
            continue;
          }
        }
        out.push(cell);
      }
      return out;
    };

    const gridRows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const rowCells = [];
      let rowHasContent = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const key = `${r},${c}`;
        if (covered.has(key)) continue;
        const cellObj = sheet[XLSX.utils.encode_cell({ r, c })];
        const text = clean(cellObj ? (cellObj.w !== undefined ? cellObj.w : cellObj.v) : '');
        if (text) rowHasContent = true;
        const span = spanAt.get(key);
        rowCells.push(span ? { content: text, colSpan: span.colSpan, rowSpan: span.rowSpan } : text);
      }
      if (rowHasContent) gridRows.push(collapseEmptyRuns(rowCells));
    }
    return gridRows;
  };

  const convertXlsxToPdf = async (file) => {
    const XLSX = await loadXLSXLib();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];

    // --- content-based invoice number / AWB extraction ---
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    let invoiceNumber = null;
    for (const row of rawRows) {
      for (let i = 0; i < row.length; i++) {
        const cellText = String(row[i] || '').trim();
        if (!cellText) continue;
        const inline = cellText.match(/invoice\s*no\.?:?\s*([A-Za-z0-9-]{5,})/i);
        if (inline) { invoiceNumber = inline[1]; break; }
        if (/invoice\s*no/i.test(cellText)) {
          for (let j = i + 1; j < row.length; j++) {
            const v = String(row[j] || '').trim();
            if (v) { invoiceNumber = v; break; }
          }
          if (invoiceNumber) break;
        }
      }
      if (invoiceNumber) break;
    }
    let awb = null;
    const headerIdx = rawRows.findIndex(r => r.some(c => /tracking/i.test(String(c || ''))));
    if (headerIdx !== -1) {
      const col = rawRows[headerIdx].findIndex(c => /tracking/i.test(String(c || '')));
      for (let i = headerIdx + 1; i < rawRows.length && !awb; i++) {
        const m = String(rawRows[i]?.[col] || '').match(/\d{6,}/);
        if (m) awb = m[0];
      }
    }
    if (!awb) {
      const fm = file.name.match(/tracking(\d{6,})/i);
      if (fm) awb = fm[1];
    }

    const gridRows = buildXlsxGridRows(XLSX, sheet);

    const { jsPDF } = await import('jspdf');
    await import('jspdf-autotable');
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    doc.autoTable({
      body: gridRows,
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 1.2, overflow: 'linebreak', font: 'helvetica' },
      margin: { top: 8, left: 6, right: 6, bottom: 8 },
    });
    return { blob: doc.output('blob'), filename: file.name.replace(/\.xlsx$/i, '.pdf'), invoiceNumber, awb };
  };

  const handleReceptieUpload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploadingReceptie(true);
    setReceptieProgress({ done: 0, total: files.length });
    try {
      let uploaded = 0, pending = 0, duplicate = 0, reconciled = 0;
      const debugRows = [];
      for (const file of files) {
        try {
          let blob = file;
          let filename = file.name;
          let contentInvoiceNumber = null;
          let contentAwb = null;
          let clientPdfTextSample = null;
          let clientPdfTextLength = null;
          let clientPdfError = null;
          if (file.name.toLowerCase().endsWith('.xlsx')) {
            const converted = await convertXlsxToPdf(file);
            blob = converted.blob;
            filename = converted.filename;
            contentInvoiceNumber = converted.invoiceNumber;
            contentAwb = converted.awb;
          } else if (file.name.toLowerCase().endsWith('.pdf')) {
            try {
              const text = await extractTextFromPdf(file);
              clientPdfTextLength = text.length;
              clientPdfTextSample = text.slice(0, 400);
              contentInvoiceNumber = extractInvoiceNumberFromTextClient(text);
            } catch (e) {
              clientPdfError = e.message;
            }
          }
          const form = new FormData();
          form.append('file', blob, filename);
          form.append('filename', filename);
          form.append('month', month);
          if (contentInvoiceNumber) form.append('invoiceNumber', contentInvoiceNumber);
          if (contentAwb) form.append('awb', contentAwb);
          const res = await fetch('/api/mail/manual-upload-receptie', { method: 'POST', body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'eroare');
          debugRows.push({ filename, contentInvoiceNumber, contentAwb, clientPdfTextSample, clientPdfTextLength, clientPdfError, ...data });
          if (data.status === 'duplicate') duplicate++;
          else if (data.awb) { uploaded++; reconciled += data.reconciled || 0; }
          else pending++;
        } catch (e) {
          toast(`❌ ${file.name}: ${e.message}`, 'error');
        }
        setReceptieProgress(p => ({ done: (p?.done || 0) + 1, total: files.length }));
      }
      setReceptieDebug(debugRows);
      toast(
        `✅ Receptie: ${uploaded} urcate, ${pending} în așteptare (AWB negăsit)${duplicate ? `, ${duplicate} deja existente` : ''}${reconciled ? `, ${reconciled} reconciliate automat` : ''}`,
        'success',
      );
      loadDocuments(); loadUnclassified();
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setUploadingReceptie(false);
      setReceptieProgress(null);
    }
  };

  /** Bank statements — pure archival, no parsing/matching like Recepție's
   * AWB linking. .xlsx still gets converted to PDF client-side first, same
   * reasoning as Recepție: keeps the category PDF-only and reuses the
   * full-grid renderer instead of a second, different conversion path. */
  const handleExtrasUpload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploadingExtras(true);
    setExtrasProgress({ done: 0, total: files.length });
    try {
      let uploaded = 0, duplicate = 0;
      for (const file of files) {
        try {
          let blob = file;
          let filename = file.name;
          if (file.name.toLowerCase().endsWith('.xlsx')) {
            const converted = await convertXlsxToPdf(file);
            blob = converted.blob;
            filename = converted.filename;
          }
          const form = new FormData();
          form.append('file', blob, filename);
          form.append('filename', filename);
          form.append('month', month);
          const res = await fetch('/api/mail/manual-upload-extras', { method: 'POST', body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'eroare');
          if (data.status === 'duplicate') duplicate++; else uploaded++;
        } catch (e) {
          toast(`❌ ${file.name}: ${e.message}`, 'error');
        }
        setExtrasProgress(p => ({ done: (p?.done || 0) + 1, total: files.length }));
      }
      toast(`✅ Extras: ${uploaded} urcate${duplicate ? `, ${duplicate} deja existente` : ''}`, 'success');
      loadDocuments();
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setUploadingExtras(false);
      setExtrasProgress(null);
    }
  };

  /** "Combină Excel (o pagină/fișier)" — downloads each xlsx's raw bytes
   * (via /api/mail/download-file, since the server never keeps a parsed
   * copy) and appends its full grid as a new page on one shared jsPDF doc,
   * so N source files become one N(+)-page PDF instead of N separate ones. */
  const combineExcelFiles = async (docs) => {
    const XLSX = await loadXLSXLib();
    const { jsPDF } = await import('jspdf');
    await import('jspdf-autotable');
    const pdfDoc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    let renderedAny = false;
    const debugRows = [];
    for (const d of docs) {
      try {
        const res = await fetch(`/api/mail/download-file?id=${d.id}`);
        if (!res.ok) { debugRows.push({ filename: d.filename, error: `HTTP ${res.status}` }); continue; }
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const hex = Array.from(bytes.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const gridRows = buildXlsxGridRows(XLSX, sheet);
        const nonEmptyCells = gridRows.reduce((n, row) => n + row.filter(c => (typeof c === 'object' ? c.content : c) !== '').length, 0);
        debugRows.push({
          filename: d.filename, byteLength: buf.byteLength, hex,
          sheetNames: wb.SheetNames, ref: sheet['!ref'], rowCount: gridRows.length, nonEmptyCells,
        });
        if (renderedAny) pdfDoc.addPage();
        pdfDoc.setFontSize(9);
        pdfDoc.text(d.filename, 6, 6);
        pdfDoc.autoTable({
          startY: 10,
          body: gridRows,
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 1.2, overflow: 'linebreak', font: 'helvetica' },
          margin: { top: 8, left: 6, right: 6, bottom: 8 },
        });
        renderedAny = true;
      } catch (e) {
        debugRows.push({ filename: d.filename, error: e.message });
        toast(`❌ ${d.filename}: ${e.message}`, 'error');
      }
    }
    setCombineDebug(debugRows);
    if (!renderedAny) {
      toast('❌ Niciun fișier Excel nu a putut fi combinat', 'error');
      return;
    }
    // A real download instead of window.open()-ing a blob URL in a new tab —
    // confirmed more reliable on mobile Chrome: opening a blank tab and then
    // pointing it at a blob: URL produced a blank page (blob URLs don't
    // always navigate cleanly across that tab boundary), whereas a
    // programmatic <a download> click triggers the browser's normal
    // download flow every time, with the full PDF, ready to open and print
    // from wherever the phone saves it.
    const url = URL.createObjectURL(pdfDoc.output('blob'));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Excel_combinat_${month}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const commitStat = async () => {
    setSavingStat(true);
    try {
      const payload = { month, glsIncasat: null, sdIncasat: null, metaSpend: null, tiktokSpend: null, googleSpend: null, profit: null, ...(stat || {}) };
      ['glsIncasat', 'sdIncasat', 'metaSpend', 'tiktokSpend', 'googleSpend', 'profit'].forEach(k => {
        payload[k] = payload[k] === '' || payload[k] == null ? null : Number(payload[k]);
      });
      const res = await fetch('/api/mail/stats', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare salvare');
      toast('✅ Cifre salvate', 'success');
      setStat(data.stat);
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setSavingStat(false);
    }
  };

  const addRule = async () => {
    const category = newRule.category === '__custom__' ? newRule.customCategory.trim() : newRule.category;
    if (!category) { toast('Completează numele categoriei', 'error'); return; }
    if (!newRule.matchValue.trim()) { toast('Completează expeditorul/domeniul', 'error'); return; }
    const subcategory = newRule.awbAuto ? AWB_SUBCATEGORY : (newRule.subcategory || null);
    setSavingRule(true);
    try {
      const res = await fetch('/api/mail/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newRule, category, subcategory, matchValue: newRule.matchValue.trim(), filenameContains: newRule.filenameContains.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare');
      toast('✅ Regulă adăugată', 'success');
      setNewRule({ category: 'GLS', customCategory: '', subcategory: '', awbAuto: false, matchType: 'sender_domain', matchValue: '', filenameContains: '' });
      loadRules();
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setSavingRule(false);
    }
  };

  const deleteRule = async (id) => {
    await fetch(`/api/mail/rules?id=${id}`, { method: 'DELETE' });
    loadRules();
  };

  const assignDocument = async (docId) => {
    const a = assign[docId];
    const category = a?.category === '__custom__' ? (a.customCategory || '').trim() : a?.category;
    const subcategory = a?.subcategory === '__custom__' ? (a.customSubcategory || '').trim() : a?.subcategory;
    if (!category) { toast('Alege sau completează o categorie', 'error'); return; }
    try {
      const res = await fetch('/api/mail/documents', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId, category, subcategory: subcategory || null, createRule: a.createRule !== false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare');
      toast('✅ Document clasificat', 'success');
      loadUnclassified(); loadDocuments();
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    }
  };

  const ignoreSender = async (doc) => {
    if (!confirm(`Ignori toate email-urile de la ${doc.senderEmail}? Documentul curent va fi șters din Drive (coș de gunoi) și din listă, iar cele viitoare de la acest expeditor nu vor mai fi importate deloc.`)) return;
    try {
      await fetch('/api/mail/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'Ignorat', matchType: 'sender_email', matchValue: doc.senderEmail }),
      });
      await fetch(`/api/mail/documents?id=${doc.id}`, { method: 'DELETE' });
      toast(`🚫 Ignorat: ${doc.senderEmail}`, 'success');
      loadUnclassified(); loadDocuments(); loadRules();
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    }
  };

  const allCategories = useMemo(() => {
    const names = new Set(CATEGORY_PRESETS.map(c => c.category));
    for (const r of rules) if (r.category) names.add(r.category);
    for (const d of documents) if (d.category) names.add(d.category);
    for (const d of unclassified) if (d.category) names.add(d.category);
    names.delete('Neclasificate');
    names.delete('Ignorat'); // use the dedicated "🚫 Ignoră expeditor" button instead of picking this from the dropdown
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rules, documents, unclassified]);

  const grouped = useMemo(() => {
    const map = {};
    for (const d of documents) {
      const key = d.category;
      if (!map[key]) map[key] = { category: key, subcats: {}, files: [] };
      if (d.subcategory) {
        if (!map[key].subcats[d.subcategory]) map[key].subcats[d.subcategory] = [];
        map[key].subcats[d.subcategory].push(d);
      } else {
        map[key].files.push(d);
      }
    }
    return Object.values(map).sort((a, b) => a.category.localeCompare(b.category));
  }, [documents]);

  const toggleCat = (cat) => setOpenCats(p => ({ ...p, [cat]: !p[cat] }));

  /** Only worth offering when there's more than one file to actually combine. */
  const renderCombineRow = (files, category, subcategory) => {
    const pdfFiles = files.filter(f => /\.pdf$/i.test(f.filename));
    const xlsxFiles = files.filter(f => /\.xlsx$/i.test(f.filename));
    if (pdfFiles.length < 2 && xlsxFiles.length < 2) return null;
    return (
      <div className="doc-combine-row">
        {pdfFiles.length >= 2 && (
          <a
            className="doc-btn doc-btn-green"
            href={`/api/mail/combine-pdfs?month=${month}&category=${encodeURIComponent(category)}${subcategory ? `&subcategory=${encodeURIComponent(subcategory)}` : ''}`}
            target="_blank" rel="noopener noreferrer"
          >
            🖨️ Combină + printează PDF-uri ({pdfFiles.length})
          </a>
        )}
        {xlsxFiles.length >= 2 && (
          <button className="doc-btn doc-btn-blue" onClick={() => combineExcelFiles(xlsxFiles)}>
            📊 Combină Excel, o pagină/fișier ({xlsxFiles.length})
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="doc-page">
        <div className="doc-hdr">
          <div className="doc-hdr-inner">
            <div className="doc-logo">📁</div>
            <div className="doc-title">
              <h1>Documente</h1>
              <p>Sortare automată email → Google Drive</p>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="doc-btn doc-btn-ghost" onClick={runReclassify} disabled={reclassifying} title="Re-aplică regulile curente peste documentele deja importate">
                {reclassifying ? <span className="doc-spin">↻</span> : '🔀'} Reclasifică
              </button>
              <button className="doc-btn doc-btn-primary" onClick={runSync} disabled={syncing}>
                {syncing ? <span className="doc-spin">↻</span> : '↻'} Sincronizează acum
              </button>
            </div>
          </div>
        </div>

        <Section title="Conturi conectate" icon="🔌" count={accounts.length}>
          {loadingAccounts ? (
            <div className="doc-empty">Se încarcă...</div>
          ) : accounts.length === 0 ? (
            <div className="doc-empty">Niciun cont conectat încă.</div>
          ) : accounts.map(acc => (
            <div className="doc-account" key={acc.id}>
              <div className="doc-account-icon">{acc.provider === 'gmail' ? '📧' : '💌'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="doc-account-email">{acc.email}</div>
                <div className="doc-account-meta">
                  {acc.provider === 'gmail' ? 'Gmail (citire + Drive)' : 'Yahoo (IMAP)'} · {acc.lastSyncAt ? `ultima sincronizare ${new Date(acc.lastSyncAt).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'niciodată sincronizat'}
                </div>
              </div>
              <span className={`doc-badge ${acc.active ? 'doc-badge-ok' : 'doc-badge-gray'}`}>{acc.active ? '✓ Activ' : 'Inactiv'}</span>
              <div className="doc-account-actions">
                <button className="doc-btn doc-btn-ghost" onClick={() => { setBackfillFor(acc.id); setBackfillDate(firstOfMonth(currentMonth())); }}>📥 Import istoric</button>
                {acc.active && <button className="doc-btn doc-btn-red" onClick={() => disconnectAccount(acc.id)}>Deconectează</button>}
              </div>
            </div>
          ))}

          <div className="doc-actions">
            <a className="doc-btn doc-btn-primary" href="/api/mail/connect/google">📧 Conectează Gmail</a>
            <button className="doc-btn doc-btn-ghost" onClick={() => setShowYahooForm(v => !v)}>💌 Conectează Yahoo</button>
          </div>

          {showYahooForm && (
            <div className="doc-grid2" style={{ marginTop: 12 }}>
              <div className="doc-field">
                <label className="doc-lbl">Email Yahoo</label>
                <input className="doc-inp" value={yahooForm.email} onChange={e => setYahooForm(p => ({ ...p, email: e.target.value }))} placeholder="nume@yahoo.com" />
              </div>
              <div className="doc-field">
                <label className="doc-lbl">Parolă de aplicație</label>
                <input className="doc-inp" type="password" value={yahooForm.appPassword} onChange={e => setYahooForm(p => ({ ...p, appPassword: e.target.value }))} placeholder="generată din Yahoo Account Security" />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <button className="doc-btn doc-btn-primary" onClick={connectYahoo} disabled={connectingYahoo}>
                  {connectingYahoo ? <span className="doc-spin">↻</span> : '💌'} Conectează
                </button>
              </div>
            </div>
          )}

          {backfillFor && (
            <div className="doc-warnbox" style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 8, fontWeight: 700 }}>📥 Importă email-uri vechi din:</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="doc-inp" type="date" value={backfillDate} onChange={e => setBackfillDate(e.target.value)} />
                <button className="doc-btn doc-btn-primary" onClick={runBackfill} disabled={backfilling}>
                  {backfilling ? <span className="doc-spin">↻</span> : '📥'} Importă
                </button>
                <button className="doc-btn doc-btn-ghost" onClick={() => setBackfillFor(null)}>Anulează</button>
              </div>
            </div>
          )}
        </Section>

        {unclassified.length > 0 && (
          <Section title="Neclasificate" icon="⚠️" count={unclassified.length} defaultOpen={true}>
              {unclassified.map(doc => {
                const a = assign[doc.id] || { category: '', customCategory: '', subcategory: '', customSubcategory: '', createRule: true };
                const preset = CATEGORY_PRESETS.find(c => c.category === a.category);
                return (
                  <div key={doc.id} style={{ padding: '10px 0', borderTop: '1px solid #161d24' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{doc.filename}</div>
                    <div style={{ fontSize: 10, color: '#475569', marginBottom: 8 }}>{doc.senderEmail} · {doc.subject}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select className="doc-select" value={a.category} onChange={e => setAssign(p => ({ ...p, [doc.id]: { ...a, category: e.target.value, subcategory: '' } }))}>
                        <option value="">Categorie...</option>
                        {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        <option value="__custom__">+ Categorie nouă...</option>
                      </select>
                      {a.category === '__custom__' && (
                        <input
                          className="doc-inp"
                          placeholder="ex: TheMarketer, ElevenLabs, Receptie"
                          value={a.customCategory || ''}
                          onChange={e => setAssign(p => ({ ...p, [doc.id]: { ...a, customCategory: e.target.value } }))}
                        />
                      )}
                      {a.category && (
                        <select className="doc-select" value={a.subcategory} onChange={e => setAssign(p => ({ ...p, [doc.id]: { ...a, subcategory: e.target.value, createRule: e.target.value === '__custom__' ? false : a.createRule } }))}>
                          <option value="">(fără subcategorie)</option>
                          {(preset?.subcategories || []).map(s => <option key={s} value={s}>{s}</option>)}
                          <option value="__custom__">+ Subcategorie nouă...</option>
                        </select>
                      )}
                      {a.subcategory === '__custom__' && (
                        <input
                          className="doc-inp"
                          placeholder="ex: nr. AWB 1309608801"
                          value={a.customSubcategory || ''}
                          onChange={e => setAssign(p => ({ ...p, [doc.id]: { ...a, customSubcategory: e.target.value } }))}
                        />
                      )}
                      <label style={{ fontSize: 10, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox" checked={a.createRule !== false} onChange={e => setAssign(p => ({ ...p, [doc.id]: { ...a, createRule: e.target.checked } }))} />
                        creează regulă automată
                      </label>
                      <button className="doc-btn doc-btn-primary" onClick={() => assignDocument(doc.id)}>Atribuie</button>
                      <button className="doc-btn doc-btn-red" onClick={() => ignoreSender(doc)}>🚫 Ignoră expeditor</button>
                    </div>
                  </div>
                );
              })}
          </Section>
        )}

        <Section title="Încărcare manuală facturi Meta Ads" icon="📘">
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
            Meta nu trimite facturile pe email — descarci exportul „Transactions" (zip sau PDF-uri individuale) din Ads Manager → Billing, îl încarci aici. Se verifică automat statusul din fiecare PDF: doar cele <b style={{ color: '#10b981' }}>Paid</b> ajung pe Drive (folder Facebook) și intră în calculul „Meta spend"; cele <b style={{ color: '#f43f5e' }}>Failed</b> sunt ignorate complet.
          </div>
          <div className="doc-actions">
            <label className="doc-btn doc-btn-primary" style={{ cursor: 'pointer' }}>
              {uploadingMeta ? <span className="doc-spin">↻</span> : '📤'} Alege zip sau PDF-uri
              <input
                type="file" accept=".zip,.pdf" multiple style={{ display: 'none' }}
                disabled={uploadingMeta}
                onChange={e => { handleMetaUpload(e.target.files); e.target.value = ''; }}
              />
            </label>
            {uploadProgress && (
              <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>
                Procesez {uploadProgress.done}/{uploadProgress.total}...
              </span>
            )}
          </div>
        </Section>

        <Section title="Încărcare manuală Recepție" icon="📥">
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
            (facturi transport, NIR, furnizor) — Încarci PDF-uri (sau .xlsx pentru factura de transport — se convertește automat în PDF). Fiecare fișier ajunge automat în <b>Recepție/AWB-&lt;număr&gt;</b>: dacă numele conține „Invoice_...tracking..." (factura de transport), reține legătura factură↔AWB pentru viitor; dacă numele conține direct un AWB, îl folosește pe acela; altfel caută numărul facturii în textul PDF-ului (NIR, factură furnizor) și caută AWB-ul asociat. Dacă nu găsește nimic încă, fișierul așteaptă în „Neclasificate" până apare factura de transport corespunzătoare — apoi se mută automat.
          </div>
          <div className="doc-actions">
            <label className="doc-btn doc-btn-primary" style={{ cursor: 'pointer' }}>
              {uploadingReceptie ? <span className="doc-spin">↻</span> : '📤'} Alege PDF-uri sau .xlsx
              <input
                type="file" accept=".pdf,.xlsx" multiple style={{ display: 'none' }}
                disabled={uploadingReceptie}
                onChange={e => { handleReceptieUpload(e.target.files); e.target.value = ''; }}
              />
            </label>
            {receptieProgress && (
              <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>
                Procesez {receptieProgress.done}/{receptieProgress.total}...
              </span>
            )}
          </div>
          {receptieDebug && (
            <div className="doc-errbox" style={{ marginTop: 12, fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
              <div style={{ marginBottom: 6, fontWeight: 700 }}>Debug ultima încărcare ({receptieDebug.length} fișier{receptieDebug.length === 1 ? '' : 'e'}):</div>
              {receptieDebug.map((r, i) => (
                <div key={i} style={{ marginBottom: 8, color: r.status === 'duplicate' ? '#94a3b8' : (r.awb ? '#10b981' : '#f43f5e') }}>
                  {r.status === 'duplicate' ? '⏸' : (r.awb ? '✓' : '✗')} {r.filename}
                  {r.contentInvoiceNumber && <> · factură din conținut: {r.contentInvoiceNumber}</>}
                  {r.contentAwb && <> · awb din conținut: {r.contentAwb}</>}
                  {r.invoiceNumber && <> · factură folosită: {r.invoiceNumber}</>}
                  {r.awb && <> · AWB: {r.awb}</>}
                  {r.status === 'duplicate' && <> · deja există (fișier deja clasificat cu succes)</>}
                  {r.debug?.path && <div>&nbsp;&nbsp;traseu: {r.debug.path}</div>}
                  {r.clientPdfError && <div style={{ color: '#f43f5e' }}>&nbsp;&nbsp;eroare la citirea PDF-ului în browser: {r.clientPdfError}</div>}
                  {typeof r.clientPdfTextLength === 'number' && (
                    <div>
                      &nbsp;&nbsp;text extras din PDF în browser: {r.clientPdfTextLength} caractere
                      {r.clientPdfTextLength === 0
                        ? ' — GOL (probabil PDF scanat/poză, fără strat de text selectabil)'
                        : ` — "${r.clientPdfTextSample}"`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Încărcare extrase bancare" icon="🏦">
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
            Încarci extrasul de cont (PDF sau .xlsx) direct aici — nu vine pe email. Fiecare fișier ajunge în <b>Extras/{monthLabel(month)}</b>, fără nicio prelucrare automată — doar arhivare.
          </div>
          <div className="doc-actions">
            <label className="doc-btn doc-btn-primary" style={{ cursor: 'pointer' }}>
              {uploadingExtras ? <span className="doc-spin">↻</span> : '📤'} Alege PDF-uri sau .xlsx
              <input
                type="file" accept=".pdf,.xlsx" multiple style={{ display: 'none' }}
                disabled={uploadingExtras}
                onChange={e => { handleExtrasUpload(e.target.files); e.target.value = ''; }}
              />
            </label>
            {extrasProgress && (
              <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>
                Procesez {extrasProgress.done}/{extrasProgress.total}...
              </span>
            )}
          </div>
        </Section>

        <div className="doc-section-title">Statistici lunare</div>
        <div className="doc-month-nav">
          <button className="doc-month-btn" onClick={() => setMonth(m => shiftMonth(m, -1))}>‹</button>
          <div className="doc-month-label">{monthLabel(month)}</div>
          <button className="doc-month-btn" onClick={() => setMonth(m => shiftMonth(m, 1))}>›</button>
        </div>
        <div className="doc-kpis">
          <StatField label="📦 GLS încasat" value={stat?.glsIncasat} onChange={v => saveStat('glsIncasat', v)} onCompute={computeGlsStat} computing={computingGls} />
          <StatField label="🚀 Sameday încasat" value={stat?.sdIncasat} onChange={v => saveStat('sdIncasat', v)} onCompute={computeSamedayStat} computing={computingSameday} />
          <StatField label="📘 Meta spend" value={stat?.metaSpend} onChange={v => saveStat('metaSpend', v)} onCompute={computeMetaStat} computing={computingMeta} />
          <StatField label="🎵 TikTok spend" value={stat?.tiktokSpend} onChange={v => saveStat('tiktokSpend', v)} />
          <StatField label="🔍 Google spend" value={stat?.googleSpend} onChange={v => saveStat('googleSpend', v)} />
          <StatField label="💹 Profit" value={stat?.profit} onChange={v => saveStat('profit', v)} />
        </div>
        {glsDuplicates?.length > 0 && (
          <div className="doc-errbox" style={{ marginBottom: 12, fontFamily: 'monospace', fontSize: 10 }}>
            <div style={{ fontWeight: 700 }}>⚠️ Nume de fișier duplicate găsite luna asta:</div>
            {glsDuplicates.map(([name, count]) => <div key={name}>{name} — apare de {count} ori</div>)}
          </div>
        )}
        {glsPerFile && (
          <div className="doc-errbox" style={{ marginBottom: 12, fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
            <div style={{ marginBottom: 6, fontWeight: 700 }}>Rezultat per fișier ({glsPerFile.length}):</div>
            {glsPerFile.map((f, i) => (
              <div key={i} style={{ color: f.headerFound ? '#10b981' : '#f43f5e' }}>
                {f.headerFound ? '✓' : '✗'} {f.filename} [{f.source}]{f.headerHex ? ` hex:${f.headerHex}` : ''} — {f.headerFound ? `${fmt(f.total)} RON` : `header lipsă (foi: ${f.sheetNames.join(',')}, ${f.rowCount} rânduri)`}
                {f.driveUrl && <> · <a href={f.driveUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>deschide exact acest fișier</a></>}
              </div>
            ))}
          </div>
        )}
        {glsDebug && (
          <div className="doc-errbox" style={{ marginBottom: 12, fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
            <div style={{ marginBottom: 6, fontWeight: 700 }}>Debug — {glsDebug.filename} [sursă: {glsDebug.source}] ({glsDebug.bufferBytes} bytes, foi: {glsDebug.sheetNames.join(', ')}, {glsDebug.rowCount} rânduri)</div>
            {glsDebug.headerHex && <div style={{ marginBottom: 6 }}>Primii 16 bytes (hex): {glsDebug.headerHex} — un xlsx valid trebuie să înceapă cu 504b0304</div>}
            {(glsDebug.sampleRows || []).map((row, i) => (
              <div key={i}>{i}: [{row.map(c => `"${c}"`).join(', ')}]</div>
            ))}
          </div>
        )}
        <div className="doc-actions" style={{ marginBottom: 16 }}>
          <button className="doc-btn doc-btn-primary" onClick={commitStat} disabled={savingStat}>
            {savingStat ? <span className="doc-spin">↻</span> : '💾'} Salvează cifrele lunii
          </button>
        </div>

        <div className="doc-section-title">Foldere — {monthLabel(month)}</div>
        <div className="doc-actions" style={{ marginBottom: 10 }}>
          <a className="doc-btn doc-btn-green" href={`/api/mail/download-month?month=${month}`}>📦 Descarcă tot (zip)</a>
        </div>
        {loadingDocs ? (
          <div className="doc-empty">Se încarcă...</div>
        ) : grouped.length === 0 ? (
          <div className="doc-empty">📭 Nicio comandă pentru {monthLabel(month)}.</div>
        ) : grouped.map(cat => {
          const total = cat.files.length + Object.values(cat.subcats).reduce((a, arr) => a + arr.length, 0);
          const open = !!openCats[cat.category];
          return (
            <div className="doc-cat" key={cat.category}>
              <div className="doc-cat-hdr" onClick={() => toggleCat(cat.category)}>
                <div>
                  <span className="doc-cat-name">📂 {cat.category}</span>
                  <span className="doc-cat-count">{total} fișiere</span>
                </div>
                <span style={{ color: '#475569' }}>{open ? '▲' : '▼'}</span>
              </div>
              {open && (
                <div className="doc-cat-body">
                  {cat.files.map(f => <FileRow key={f.id} doc={f} />)}
                  {renderCombineRow(cat.files, cat.category, null)}
                  {Object.entries(cat.subcats).map(([sub, files]) => (
                    <div key={sub}>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 8 }}>{sub}</div>
                      {files.map(f => <FileRow key={f.id} doc={f} />)}
                      {renderCombineRow(files, cat.category, sub)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {combineDebug && (
          <div className="doc-errbox" style={{ marginBottom: 12, fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
            <div style={{ marginBottom: 6, fontWeight: 700 }}>Debug ultima combinare Excel ({combineDebug.length} fișier{combineDebug.length === 1 ? '' : 'e'}):</div>
            {combineDebug.map((r, i) => (
              <div key={i} style={{ marginBottom: 6, color: r.error ? '#f43f5e' : (r.nonEmptyCells > 5 ? '#10b981' : '#f59e0b') }}>
                {r.error ? '✗' : '✓'} {r.filename}
                {r.error && <> · eroare: {r.error}</>}
                {!r.error && <> · {r.byteLength} bytes · hex:{r.hex} (valid xlsx = 504b0304) · foi: {r.sheetNames.join(', ')} · range: {r.ref} · {r.rowCount} rânduri · {r.nonEmptyCells} celule cu conținut</>}
              </div>
            ))}
          </div>
        )}

        {(() => {
          const allPdfCount = documents.filter(d => /\.pdf$/i.test(d.filename)).length;
          return allPdfCount >= 2 && (
            <div className="doc-actions" style={{ margin: '4px 0 20px' }}>
              <a
                className="doc-btn doc-btn-green"
                href={`/api/mail/combine-pdfs?month=${month}`}
                target="_blank" rel="noopener noreferrer"
              >
                🖨️ Combină + printează TOATE PDF-urile lunii ({allPdfCount})
              </a>
            </div>
          );
        })()}

        <Section title="Reguli de sortare" icon="⚙️" count={rules.length}>
          {rules.length === 0 ? (
            <div className="doc-empty">Nicio regulă încă — cele create din „Neclasificate" apar aici.</div>
          ) : rules.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid #161d24' }}>
              <span className="doc-badge doc-badge-ok" style={{ flexShrink: 0 }}>{r.category}{r.subcategory ? ` / ${r.subcategory}` : ''}</span>
              <span style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>
                {r.matchType === 'sender_email' ? 'email' : 'domeniu'}: {r.matchValue}
                {r.filenameContains ? ` · fișier conține „${r.filenameContains}"` : ''}
              </span>
              <button className="doc-btn doc-btn-red" onClick={() => deleteRule(r.id)}>✕</button>
            </div>
          ))}
          <div className="doc-grid2" style={{ marginTop: 12 }}>
            <select className="doc-select" value={newRule.category} onChange={e => setNewRule(p => ({ ...p, category: e.target.value, subcategory: '' }))}>
              {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__custom__">+ Categorie nouă...</option>
            </select>
            {newRule.category === '__custom__' ? (
              <input className="doc-inp" placeholder="ex: TheMarketer, ElevenLabs, Receptie" value={newRule.customCategory} onChange={e => setNewRule(p => ({ ...p, customCategory: e.target.value }))} />
            ) : (
              <select className="doc-select" value={newRule.subcategory} onChange={e => setNewRule(p => ({ ...p, subcategory: e.target.value }))} disabled={newRule.awbAuto}>
                <option value="">(fără subcategorie)</option>
                {(CATEGORY_PRESETS.find(c => c.category === newRule.category)?.subcategories || []).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <select className="doc-select" value={newRule.matchType} onChange={e => setNewRule(p => ({ ...p, matchType: e.target.value }))}>
              <option value="sender_domain">după domeniu</option>
              <option value="sender_email">după email exact</option>
            </select>
            <input className="doc-inp" placeholder={newRule.matchType === 'sender_domain' ? 'sameday.ro' : 'noreply@sameday.ro'} value={newRule.matchValue} onChange={e => setNewRule(p => ({ ...p, matchValue: e.target.value }))} />
            <input className="doc-inp" placeholder="opțional: fișierul conține (ex: RON sau Document)" value={newRule.filenameContains} onChange={e => setNewRule(p => ({ ...p, filenameContains: e.target.value }))} />
            <label style={{ fontSize: 10, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4, gridColumn: '1/-1' }}>
              <input type="checkbox" checked={newRule.awbAuto} onChange={e => setNewRule(p => ({ ...p, awbAuto: e.target.checked, subcategory: '' }))} />
              subcategorie automată: extrage nr. AWB din subiectul emailului (ex: DHL — fiecare colet într-un subfolder separat)
            </label>
            <div style={{ gridColumn: '1/-1' }}>
              <button className="doc-btn doc-btn-primary" onClick={addRule} disabled={savingRule}>
                {savingRule ? <span className="doc-spin">↻</span> : '➕'} Adaugă regulă
              </button>
            </div>
          </div>
        </Section>
      </div>

      <div className="doc-toasts">
        {toasts.map(t => <div key={t.id} className={`doc-toast ${t.type}`}>{t.msg}</div>)}
      </div>
    </>
  );
}

function FileRow({ doc }) {
  return (
    <div className="doc-file">
      <div style={{ minWidth: 0 }}>
        <div className="doc-file-name">{doc.filename}</div>
        <div className="doc-file-meta">{doc.senderEmail} · {new Date(doc.receivedAt).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' })}</div>
      </div>
      {doc.driveUrl ? (
        <a className="doc-btn doc-btn-blue" href={doc.driveUrl} target="_blank" rel="noopener noreferrer">Vezi</a>
      ) : (
        <span className="doc-badge doc-badge-warn">eșuat</span>
      )}
    </div>
  );
}
