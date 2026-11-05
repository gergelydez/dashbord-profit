'use client';
/**
 * app/facturi-lipsa/page.js — Facturi lipsă
 *
 * Audit manual, pornit de la exporturile reale (nu API live): încarci
 * exportul GLS "Settlement Document" (una sau mai multe — colete LIVRATE,
 * cu referința comenzii) și exportul de facturi din SmartBill (referința
 * comenzii e în coloana "Observatii", ex. "Order: #4116; ..."), iar pagina
 * arată exact coletele livrate pentru care NU găsește nicio factură emisă —
 * exact ce a cerut utilizatorul după ce a găsit facturi duplicate/furate
 * (vezi lib/services/invoice-service.ts, fix-ul din aceeași sesiune).
 *
 * Totul rulează în browser (parsare XLS/XLSX client-side, ca la verificarea
 * eMAG/SmartBill de pe Statistici Totale) — fișierele nu se trimit nicăieri
 * în afară de atribuirea opțională de magazin (un singur apel, cu doar
 * numele comenzilor, nu conținutul fișierelor).
 */
import { useState, useMemo } from 'react';

const SHOP_META = {
  ro: { label: 'Romania', flag: '🇷🇴', color: '#f97316' },
  hu: { label: 'Ungaria', flag: '🇭🇺', color: '#3b82f6' },
  glato: { label: 'Glato', flag: '🛍️', color: '#a855f7' },
  glatohu: { label: 'Glato HU', flag: '🛍️', color: '#ec4899' },
};

function loadXLSXLib() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Nu s-a putut încărca XLSX.'));
    document.head.appendChild(s);
  });
}

function toISODate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // "05/11/2026" (SmartBill) — dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Exportul GLS "Settlement Document" — sheet "Delivery Details": listă de
 * colete FACTURATE de GLS către noi (deci, cu puține excepții, chiar livrate
 * — "Delivery date" completată), cu referința comenzii Shopify. */
async function parseGlsSettlement(file) {
  await loadXLSXLib();
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('delivery')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const raw = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!raw.length) throw new Error(`"${file.name}": fișier gol.`);
  const hdr = raw[0].map(h => (h || '').toString().trim().toLowerCase());
  const idx = name => hdr.findIndex(h => h === name);
  const ci = {
    parcel: idx('parcel number'), ref: idx('client reference'),
    pickup: idx('pick up date'), delivery: idx('delivery date'),
    name: idx('addressee name'), address: idx('delivery address'),
    country: idx('destination country'),
  };
  if (ci.parcel < 0) throw new Error(`"${file.name}": nu pare un export GLS Settlement Document (lipsește coloana "Parcel number").`);
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const parcelNumber = (r[ci.parcel] || '').toString().trim();
    if (!parcelNumber) continue;
    rows.push({
      parcelNumber,
      clientRef: (r[ci.ref] || '').toString().trim(),
      pickupDate: toISODate(r[ci.pickup]),
      deliveryDate: toISODate(r[ci.delivery]),
      name: (r[ci.name] || '').toString().trim(),
      address: (r[ci.address] || '').toString().trim(),
      country: (r[ci.country] || '').toString().trim(),
    });
  }
  return rows;
}

/** Observatii SmartBill: "Order: #4116; Payment method: ..." → "#4116". */
function extractOrderRefFromObs(obs) {
  if (!obs) return null;
  let m = obs.match(/Order:\s*#?(\d+)/i);
  if (m) return `#${m[1]}`;
  m = obs.match(/#(\d+)/);
  return m ? `#${m[1]}` : null;
}

/** Exportul "Raport facturi emise" din SmartBill — referința comenzii e în
 * coloana Observatii (nu la toate facturile — depinde cum a fost creată). */
async function parseSmartBillInvoiceList(file) {
  await loadXLSXLib();
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let hi = -1;
  for (let i = 0; i < raw.length; i++) {
    const joined = raw[i].join('|').toLowerCase();
    if (joined.includes('factura') && joined.includes('client') && joined.includes('status')) { hi = i; break; }
  }
  if (hi === -1) throw new Error(`"${file.name}": nu am găsit header-ul — asigură-te că e exportul de facturi SmartBill.`);
  const hdr = raw[hi].map(h => (h || '').toString().trim().toLowerCase());
  const idx = name => hdr.findIndex(h => h === name);
  const ci = { invoice: idx('factura'), client: idx('client'), status: idx('status'), obs: idx('observatii') };
  const rows = [];
  for (let i = hi + 1; i < raw.length; i++) {
    const r = raw[i];
    const invoiceNumber = (r[ci.invoice] || '').toString().trim();
    if (!invoiceNumber) continue;
    const status = (r[ci.status] || '').toString().trim().toLowerCase();
    rows.push({
      invoiceNumber,
      client: (r[ci.client] || '').toString().trim(),
      status,
      orderRef: ci.obs >= 0 ? extractOrderRefFromObs((r[ci.obs] || '').toString()) : null,
    });
  }
  return rows;
}

function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(c => {
    const s = String(c ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function FacturiLipsaPage() {
  const [glsParcels, setGlsParcels] = useState([]); // deduplicat după parcelNumber
  const [glsFileNames, setGlsFileNames] = useState([]);
  const [glsLoading, setGlsLoading] = useState(false);
  const [glsError, setGlsError] = useState('');

  const [invoiceRows, setInvoiceRows] = useState([]);
  const [sbFileName, setSbFileName] = useState('');
  const [sbLoading, setSbLoading] = useState(false);
  const [sbError, setSbError] = useState('');

  const [shopMatches, setShopMatches] = useState({});
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [matchDone, setMatchDone] = useState(false);

  const handleGlsUpload = async (files) => {
    setGlsLoading(true); setGlsError('');
    try {
      const byParcel = new Map(glsParcels.map(p => [p.parcelNumber, p]));
      const names = [];
      for (const file of files) {
        const rows = await parseGlsSettlement(file);
        for (const r of rows) byParcel.set(r.parcelNumber, r);
        names.push(file.name);
      }
      setGlsParcels(Array.from(byParcel.values()));
      setGlsFileNames(prev => [...prev, ...names]);
    } catch (e) {
      setGlsError(e.message);
    } finally {
      setGlsLoading(false);
    }
  };

  const handleSbUpload = async (file) => {
    setSbLoading(true); setSbError('');
    try {
      const rows = await parseSmartBillInvoiceList(file);
      setInvoiceRows(rows);
      setSbFileName(file.name);
    } catch (e) {
      setSbError(e.message);
    } finally {
      setSbLoading(false);
    }
  };

  const invoicedRefs = useMemo(() => {
    const s = new Set();
    for (const r of invoiceRows) {
      if (r.status.includes('anulat') || r.status.includes('ciorn')) continue;
      if (r.orderRef) s.add(r.orderRef);
    }
    return s;
  }, [invoiceRows]);

  const invoicedRefsFound = invoiceRows.filter(r => r.orderRef).length;

  const missing = useMemo(() => {
    return glsParcels
      .filter(p => {
        const ref = (p.clientRef || '').trim();
        if (!/^#?\d+$/.test(ref)) return false; // doar colete cu referință de comandă (nu manuale/accesorii)
        if (!p.deliveryDate) return false; // doar cele chiar livrate
        const normRef = ref.startsWith('#') ? ref : `#${ref}`;
        return !invoicedRefs.has(normRef);
      })
      .map(p => ({ ...p, normRef: p.clientRef.startsWith('#') ? p.clientRef : `#${p.clientRef}` }))
      .sort((a, b) => (b.deliveryDate || '').localeCompare(a.deliveryDate || ''));
  }, [glsParcels, invoicedRefs]);

  const resolveShops = async () => {
    if (!missing.length) return;
    setMatchLoading(true); setMatchError(''); setMatchDone(false);
    try {
      const dates = missing.map(m => m.pickupDate).filter(Boolean).sort();
      const from = dates[0] || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/stats-totale/shopify-order-names', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      }).then(r => r.json());
      if (res.ok) { setShopMatches(res.nameToShop || {}); setMatchDone(true); }
      else setMatchError(res.error || 'Eroare la atribuirea magazinelor.');
    } catch (e) {
      setMatchError(e.message);
    } finally {
      setMatchLoading(false);
    }
  };

  const exportCsv = () => {
    const rows = [['Referință', 'Magazin', 'Client (GLS)', 'Oraș/Țară', 'Dată livrare', 'Colet (AWB)']];
    for (const m of missing) {
      rows.push([m.normRef, matchDone ? (SHOP_META[shopMatches[m.normRef]]?.label || 'necunoscut') : '', m.name, `${m.address} ${m.country}`.trim(), m.deliveryDate, m.parcelNumber]);
    }
    downloadCsv(`facturi-lipsa_${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e2e8f0', padding: '16px 16px 100px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#f97316' }}>🧾 Facturi lipsă</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Comenzi livrate (GLS) fără nicio factură emisă (SmartBill)</div>
          </div>
          <a href="/" style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '6px 12px' }}>← Comenzi</a>
        </div>

        {/* ── Upload GLS ── */}
        <div style={{ background: '#0f1419', border: '1px solid rgba(59,130,246,.3)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6', marginBottom: 6 }}>📦 1. Export-uri GLS — „Settlement Document" (Delivery Details)</div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.6 }}>
            Din contul GLS — poți încărca mai multe fișiere pe rând (ex. câte unul pe lună/facturare); se adună, fără duplicate (după numărul coletului).
            {!!glsFileNames.length && <> Încărcate până acum: <b style={{ color: '#e2e8f0' }}>{glsFileNames.join(', ')}</b> — <b style={{ color: '#10b981' }}>{glsParcels.length}</b> colete în total.</>}
          </div>
          <label style={{ ...btnPrimary, background: '#3b82f6', display: 'inline-flex', cursor: 'pointer' }}>
            {glsLoading ? '⟳ Se încarcă...' : '📥 Încarcă export(uri) GLS'}
            <input type="file" accept=".xlsx,.xls" multiple style={{ display: 'none' }} disabled={glsLoading}
              onChange={e => { const files = Array.from(e.target.files || []); if (files.length) handleGlsUpload(files); e.target.value = ''; }} />
          </label>
          {glsError && <div style={errBox}>⚠️ {glsError}</div>}
        </div>

        {/* ── Upload SmartBill ── */}
        <div style={{ background: '#0f1419', border: '1px solid rgba(16,185,129,.3)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', marginBottom: 6 }}>🧾 2. Export facturi — SmartBill ("Raport facturi emise")</div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.6 }}>
            Exportă din SmartBill Cloud lista de facturi (perioadă cât mai largă, ca să prindă toate comenzile de mai sus).
            {!!sbFileName && <> Încărcat: <b style={{ color: '#e2e8f0' }}>{sbFileName}</b> — <b style={{ color: '#10b981' }}>{invoicedRefsFound}</b> din {invoiceRows.length} facturi au referința comenzii recunoscută.</>}
          </div>
          <label style={{ ...btnPrimary, background: '#10b981', display: 'inline-flex', cursor: 'pointer' }}>
            {sbLoading ? '⟳ Se încarcă...' : '📥 Încarcă export SmartBill'}
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={sbLoading}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleSbUpload(f); e.target.value = ''; }} />
          </label>
          {sbError && <div style={errBox}>⚠️ {sbError}</div>}
        </div>

        {/* ── Rezultate ── */}
        {!!glsParcels.length && !!invoiceRows.length && (
          <div style={{ background: '#0f1419', border: '1px solid rgba(244,63,94,.3)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f43f5e' }}>
                ⚠️ {missing.length} colete livrate, fără factură găsită
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={resolveShops} disabled={matchLoading || !missing.length} style={btnGhost}>
                  {matchLoading ? '⟳ Se atribuie...' : '🏬 Atribuie magazin (Shopify live)'}
                </button>
                <button onClick={exportCsv} disabled={!missing.length} style={btnGhost}>⬇ Export CSV</button>
              </div>
            </div>
            <div style={{ fontSize: 10, color: '#475569', marginBottom: 10, lineHeight: 1.5 }}>
              Potrivire DOAR pe referința comenzii — dacă o factură există dar nu are referința scrisă în "Observatii" (depinde cum a fost creată), poate apărea greșit aici ca „lipsă". Verifică manual înainte să refaci o factură.
            </div>
            {matchError && <div style={errBox}>⚠️ {matchError}</div>}
            {!missing.length ? (
              <div style={{ textAlign: 'center', color: '#475569', padding: 24 }}>Nicio comandă livrată fără factură — totul pare în regulă. 🎉</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 620 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)' }}>
                      {['Referință', 'Magazin', 'Client (GLS)', 'Oraș', 'Dată livrare', 'Colet (AWB)'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#64748b', whiteSpace: 'nowrap', fontWeight: 700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {missing.map((m, i) => {
                      const shopKey = shopMatches[m.normRef];
                      const meta = shopKey ? SHOP_META[shopKey] : null;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                          <td style={{ padding: '5px 8px', color: '#f43f5e', fontWeight: 700, fontFamily: 'monospace' }}>{m.normRef}</td>
                          <td style={{ padding: '5px 8px', color: meta?.color || '#64748b' }}>
                            {matchLoading ? '⟳' : meta ? `${meta.flag} ${meta.label}` : matchDone ? '❓ necunoscut' : '—'}
                          </td>
                          <td style={{ padding: '5px 8px', color: '#cbd5e1' }}>{m.name}</td>
                          <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{m.address}{m.country ? `, ${m.country}` : ''}</td>
                          <td style={{ padding: '5px 8px', color: '#e2e8f0' }}>{m.deliveryDate}</td>
                          <td style={{ padding: '5px 8px', color: '#64748b', fontFamily: 'monospace' }}>{m.parcelNumber}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {(!glsParcels.length || !invoiceRows.length) && (
          <div style={{ textAlign: 'center', color: '#475569', padding: 24, fontSize: 12 }}>
            Încarcă ambele exporturi (GLS + SmartBill) ca să vezi rezultatele.
          </div>
        )}
      </div>
    </div>
  );
}

const btnPrimary = { background: '#f97316', color: 'white', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'transparent', border: '1px solid rgba(255,255,255,.1)', color: '#94a3b8', borderRadius: 8, padding: '6px 12px', fontSize: 11, cursor: 'pointer' };
const errBox = { background: 'rgba(244,63,94,.08)', border: '1px solid rgba(244,63,94,.25)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f43f5e', marginTop: 10 };
