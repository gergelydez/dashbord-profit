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
`;

// Must match lib/mail/classify.ts's AWB_SUBCATEGORY exactly — a rule saved
// with this subcategory value gets its real subcategory (AWB-<number>)
// computed server-side per message, extracted from the subject/filename.
const AWB_SUBCATEGORY = '{AWB}';

const CATEGORY_PRESETS = [
  { category: 'GLS', subcategories: ['Rambursuri', 'Facturi transport'] },
  { category: 'Sameday', subcategories: ['Rambursuri', 'Facturi transport'] },
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
  const [computingMeta, setComputingMeta] = useState(false);

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
    try {
      const res = await fetch('/api/mail/stats/compute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare calcul');
      setStat(data.stat);
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
      toast(`✅ Meta spend: ${fmt(data.total)} RON`, 'success');
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      setComputingMeta(false);
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

        <div className="doc-section-title">Conturi conectate</div>
        <div className="doc-panel">
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
        </div>

        {unclassified.length > 0 && (
          <>
            <div className="doc-section-title">⚠️ Neclasificate ({unclassified.length})</div>
            <div className="doc-panel">
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
                          placeholder="ex: TheMarketer, ElevenLabs, Recepție"
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
            </div>
          </>
        )}

        <div className="doc-section-title">Încărcare manuală facturi Meta Ads</div>
        <div className="doc-panel">
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
        </div>

        <div className="doc-section-title">Statistici lunare</div>
        <div className="doc-month-nav">
          <button className="doc-month-btn" onClick={() => setMonth(m => shiftMonth(m, -1))}>‹</button>
          <div className="doc-month-label">{monthLabel(month)}</div>
          <button className="doc-month-btn" onClick={() => setMonth(m => shiftMonth(m, 1))}>›</button>
        </div>
        <div className="doc-kpis">
          <StatField label="📦 GLS încasat" value={stat?.glsIncasat} onChange={v => saveStat('glsIncasat', v)} onCompute={computeGlsStat} computing={computingGls} />
          <StatField label="🚀 Sameday încasat" value={stat?.sdIncasat} onChange={v => saveStat('sdIncasat', v)} />
          <StatField label="📘 Meta spend" value={stat?.metaSpend} onChange={v => saveStat('metaSpend', v)} onCompute={computeMetaStat} computing={computingMeta} />
          <StatField label="🎵 TikTok spend" value={stat?.tiktokSpend} onChange={v => saveStat('tiktokSpend', v)} />
          <StatField label="🔍 Google spend" value={stat?.googleSpend} onChange={v => saveStat('googleSpend', v)} />
          <StatField label="💹 Profit" value={stat?.profit} onChange={v => saveStat('profit', v)} />
        </div>
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
                  {Object.entries(cat.subcats).map(([sub, files]) => (
                    <div key={sub}>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 8 }}>{sub}</div>
                      {files.map(f => <FileRow key={f.id} doc={f} />)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="doc-section-title">Reguli de sortare</div>
        <div className="doc-panel">
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
              <input className="doc-inp" placeholder="ex: TheMarketer, ElevenLabs, Recepție" value={newRule.customCategory} onChange={e => setNewRule(p => ({ ...p, customCategory: e.target.value }))} />
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
        </div>
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
