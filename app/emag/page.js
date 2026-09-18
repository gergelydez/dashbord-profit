'use client';
import { useState, useEffect, useMemo } from 'react';

/* ══════════════════════════════════════════════════════════════
   Comenzi eMAG — import din exportul Excel al panoului de seller
   Nu există API live conectat (eMAG cere IP fix whitelist-uit,
   incompatibil cu serverless-ul Vercel fără un proxy plătit) —
   vezi decizia din conversație: mergem pe import manual, ca la
   GLS/Sameday.

   Coloanele de mai jos sunt potrivite EXACT pe un export real
   (orders_details_file), cu fallback pe potrivire aproximativă
   dacă eMAG schimbă vreodată denumirile:
   Nr. comanda | Data comenzii | Numar AWB | Nume produs | Cod produs |
   PNK | Serial numbers | Cantitate | Pret fara TVA/buc | Pret total cu TVA |
   Moneda | TVA | Status comanda | Mod plata | Mod livrare |
   ID extern punct de livrare | Denumire punct de livrare | Status plata |
   Data maxima finalizare | Data maxima de predare | Nume client |
   Persoana juridica | Numar VAT | Numar telefon | Nume livrare |
   Telefon livrare | Adresa de livrare | Cod postal de livrare |
   Nume facturare | Adresa de facturare | Cod postal de facturare | Observatii
══════════════════════════════════════════════════════════════ */

const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { if (typeof window !== 'undefined') localStorage.removeItem(k); } catch {} },
};

const fmt = n => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "Data comenzii" vine ca "2026-09-18 09:57:42" — o afișăm zi.lună.an oră:minut.
function fmtOrderDate(raw) {
  if (!raw) return '';
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`;
  return String(raw).slice(0, 10);
}

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

// Caută întâi un header IDENTIC (exact match, după trim+lowercase) dintr-o
// listă de candidați preferați în ordine — abia dacă niciunul nu există,
// cade pe potrivire "conține cuvântul cheie". Exact match e necesar pentru
// că altfel "Nume produs" era confundat cu "Nume client" (ambele conțin
// "nume") — bug găsit direct pe exportul real trimis.
function findCol(headers, exactCandidates, fuzzyKeywords = [], excludeIdx = []) {
  for (const c of exactCandidates) {
    const idx = headers.indexOf(c);
    if (idx !== -1 && !excludeIdx.includes(idx)) return idx;
  }
  if (fuzzyKeywords.length) {
    const idx = headers.findIndex((h, i) => !excludeIdx.includes(i) && fuzzyKeywords.some(k => h.includes(k)));
    if (idx !== -1) return idx;
  }
  return -1;
}

// "Nume produs" e un titlu SEO lung ("Ceas smartwatch barbati, DELTA MAX
// ecran AMOLED 1.43", rezolutie 466x466, ...") — inutilizabil într-un mesaj
// WhatsApp. Extragem modelul cunoscut (DELTA MAX / DELTA MAX PLUS); pentru
// un produs nou, necunoscut, ne mulțumim cu primele cuvinte relevante.
function shortProductName(fullName) {
  if (!fullName) return 'produsul comandat';
  const m = fullName.match(/DELTA MAX(?:\s*PLUS)?/i);
  if (m) return m[0].toUpperCase().replace(/\s+/g, ' ');
  const afterComma = fullName.split(',')[1] || fullName.split(',')[0] || fullName;
  return afterComma.trim().split(/\s+/).slice(0, 3).join(' ');
}

function toWaPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('40') && digits.length === 11) return digits;
  if (digits.startsWith('0') && digits.length === 10) return '40' + digits.slice(1);
  if (digits.length === 9) return '40' + digits;
  return digits;
}

function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || '';
}

function waFeedbackMessage(order) {
  const product = shortProductName(order.products[0]?.fullName || order.products[0]?.name || '');
  return `Bună ziua!\nSunt de la compania GLAMX SRL, ați comandat de la noi în trecut un ceas inteligent ${product} și dorim să vă întrebăm dacă sunteți mulțumit(ă) de produsul primit.`;
}

function waReviewMessage() {
  return `Dacă experiența a fost una bună, ne-ar însemna enorm o recenzie sinceră pe eMAG. Ajută și alți clienți să ia o decizie corectă.`;
}

function waLink(phone, text) {
  const wa = toWaPhone(phone);
  if (!wa) return null;
  return `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
}

function parseWorkbookToOrders(wb) {
  const XLSX = window.XLSX;
  const allOrders = [];
  const debugSheets = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) continue;
    const headers = (rows[0] || []).map(h => (h || '').toString().toLowerCase().trim());

    const idx = {};
    idx.orderId  = findCol(headers, ['nr. comanda', 'nr comanda', 'id comanda'], ['comanda']);
    idx.date     = findCol(headers, ['data comenzii'], ['data']);
    idx.awb      = findCol(headers, ['numar awb'], ['awb']);
    idx.product  = findCol(headers, ['nume produs', 'denumire produs'], ['produs']);
    idx.qty      = findCol(headers, ['cantitate'], ['qty', 'cant']);
    idx.price    = findCol(headers, ['pret total cu tva'], ['pret total', 'pret', 'preț', 'valoare']);
    idx.status   = findCol(headers, ['status comanda'], ['status']);
    idx.payMode  = findCol(headers, ['mod plata'], ['plata', 'payment']);
    idx.delivMode = findCol(headers, ['mod livrare'], ['livrare mod']);
    idx.delivPoint = findCol(headers, ['denumire punct de livrare'], ['punct de livrare']);
    idx.name     = findCol(headers, ['nume livrare', 'nume client'], ['client', 'destinatar', 'nume'], []);
    idx.phone    = findCol(headers, ['telefon livrare', 'numar telefon'], ['telefon', 'phone'], [idx.name].filter(v => v !== undefined && v !== -1));
    idx.address  = findCol(headers, ['adresa de livrare'], ['adresa', 'adresă', 'address']);
    idx.zip      = findCol(headers, ['cod postal de livrare'], ['cod postal']);

    debugSheets.push({ sheetName, headers, idx });

    if (idx.name === -1 && idx.phone === -1 && idx.product === -1) {
      continue; // foaie fără date de comandă (ex. un tab de sumar)
    }

    const byOrder = new Map();
    rows.slice(1).forEach((row, rowN) => {
      if (!row.some(c => (c ?? '') !== '')) return;
      const orderId = idx.orderId !== -1 ? String(row[idx.orderId] || '').trim() : '';
      const key = orderId || `__row_${sheetName}_${rowN}`;

      let order = byOrder.get(key);
      if (!order) {
        order = {
          id: key,
          orderId: orderId || '',
          date: idx.date !== -1 ? String(row[idx.date] || '').trim() : '',
          name: idx.name !== -1 ? String(row[idx.name] || '').trim() : '',
          phone: idx.phone !== -1 ? String(row[idx.phone] || '').trim() : '',
          address: idx.address !== -1 ? String(row[idx.address] || '').trim() : '',
          zip: idx.zip !== -1 ? String(row[idx.zip] || '').trim() : '',
          status: idx.status !== -1 ? String(row[idx.status] || '').trim() : '',
          payMode: idx.payMode !== -1 ? String(row[idx.payMode] || '').trim() : '',
          delivMode: idx.delivMode !== -1 ? String(row[idx.delivMode] || '').trim() : '',
          delivPoint: idx.delivPoint !== -1 ? String(row[idx.delivPoint] || '').trim() : '',
          awb: idx.awb !== -1 ? String(row[idx.awb] || '').trim() : '',
          products: [],
        };
        byOrder.set(key, order);
      }
      if (!order.name && idx.name !== -1) order.name = String(row[idx.name] || '').trim();
      if (!order.phone && idx.phone !== -1) order.phone = String(row[idx.phone] || '').trim();

      const productFull = idx.product !== -1 ? String(row[idx.product] || '').trim() : '';
      if (productFull) {
        order.products.push({
          fullName: productFull,
          name: shortProductName(productFull),
          qty: idx.qty !== -1 ? (parseFloat(row[idx.qty]) || 1) : 1,
          price: idx.price !== -1 ? (parseFloat(row[idx.price]) || 0) : 0,
        });
      }
    });

    allOrders.push(...byOrder.values());
  }

  return { orders: allOrders.filter(o => o.name || o.phone || o.products.length), debugSheets };
}

export default function EmagOrdersPage() {
  const [orders, setOrders] = useState(() => { try { return JSON.parse(ls.get('emag_orders') || '[]'); } catch { return []; } });
  const [files, setFiles] = useState(() => { try { return JSON.parse(ls.get('emag_files') || '[]'); } catch { return []; } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debugInfo, setDebugInfo] = useState(null);

  useEffect(() => { ls.set('emag_orders', JSON.stringify(orders)); }, [orders]);
  useEffect(() => { ls.set('emag_files', JSON.stringify(files)); }, [files]);

  const handleImport = async (e) => {
    const fileList = Array.from(e.target.files || []);
    if (!fileList.length) return;
    setLoading(true); setError('');
    try {
      await loadXLSXLib();
      const XLSX = window.XLSX;
      let merged = [...orders];
      const newFiles = [...files];
      const allDebug = [];

      for (const file of fileList) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const { orders: parsed, debugSheets } = parseWorkbookToOrders(wb);
        allDebug.push({ file: file.name, sheets: debugSheets, found: parsed.length });

        for (const o of parsed) {
          const dedupKey = o.orderId || `${o.phone}__${o.products[0]?.name || ''}`;
          const existingIdx = merged.findIndex(m => (m.orderId || `${m.phone}__${m.products[0]?.name || ''}`) === dedupKey);
          if (existingIdx !== -1) {
            merged[existingIdx] = {
              ...o,
              feedbackSentAt: merged[existingIdx].feedbackSentAt,
              reviewSentAt: merged[existingIdx].reviewSentAt,
            };
          } else merged.push(o);
        }
        if (!newFiles.includes(file.name)) newFiles.push(file.name);
      }

      merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      if (!merged.length) {
        setError('Niciun rând recunoscut ca și comandă în fișierul importat. Vezi debug mai jos.');
      }
      setOrders(merged);
      setFiles(newFiles);
      setDebugInfo(allDebug);
    } catch (err) {
      setError('Eroare la import: ' + err.message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const clearAll = () => {
    setOrders([]); setFiles([]); setDebugInfo(null); setError('');
    ls.del('emag_orders'); ls.del('emag_files');
  };

  // wa.me doar deschide conversația pre-completată — nu ne spune dacă chiar
  // ai apăsat trimite în WhatsApp. Marcăm "cerut" la click, ca proxy
  // rezonabil, ca să vezi cui i-ai scris deja și să nu trimiți de două ori.
  const markSent = (orderId, field) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, [field]: new Date().toISOString() } : o));
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const s = search.toLowerCase();
    return orders.filter(o =>
      (o.name || '').toLowerCase().includes(s) ||
      (o.phone || '').includes(s) ||
      (o.orderId || '').toLowerCase().includes(s) ||
      (o.products || []).some(p => p.fullName.toLowerCase().includes(s))
    );
  }, [orders, search]);

  return (
    <div style={{ minHeight: '100vh', background: '#0c1018', color: '#e2e8f0', padding: '16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#f97316' }}>🛍️ Comenzi eMAG</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Import din exportul Excel al panoului de seller eMAG Marketplace</div>
          </div>
          <a href="/" style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '6px 12px' }}>← Comenzi</a>
        </div>

        <div style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ background: 'rgba(249,115,22,.15)', border: '1px solid #f97316', color: '#f97316', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              {loading ? '⟳ Se importă...' : '📊 Importă Excel eMAG'}
              <input type="file" accept=".xlsx,.xls,.csv" multiple onChange={handleImport} style={{ display: 'none' }} disabled={loading} />
            </label>
            {orders.length > 0 && (
              <button onClick={clearAll} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 8, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}>
                ✕ Șterge tot
              </button>
            )}
            <div style={{ fontSize: 12, color: '#475569', marginLeft: 'auto' }}>
              {orders.length > 0 ? `${orders.length} comenzi importate` : 'Niciun import încă'}
            </div>
          </div>
          {files.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 10, color: '#4a5568' }}>
              {files.map((f, i) => <div key={i}>📄 {f}</div>)}
            </div>
          )}
          {error && <div style={{ marginTop: 8, fontSize: 12, color: '#f43f5e' }}>⚠️ {error}</div>}
          {debugInfo && (
            <details style={{ marginTop: 8, fontSize: 11 }} open={!orders.length && !!error}>
              <summary style={{ cursor: 'pointer', color: '#64748b' }}>🔍 Debug — ce coloane am recunoscut în fișier</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 250, overflow: 'auto', fontSize: 10, marginTop: 6, background: '#080d12', padding: 8, borderRadius: 6 }}>
                {JSON.stringify(debugInfo, null, 1)}
              </pre>
            </details>
          )}
        </div>

        {orders.length > 0 && (
          <>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Caută după nume, telefon, produs sau nr. comandă..."
              style={{ width: '100%', boxSizing: 'border-box', background: '#0f1419', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: '9px 12px', color: '#e2e8f0', fontSize: 13, marginBottom: 12 }}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(o => {
                const fbLink = waLink(o.phone, waFeedbackMessage(o));
                const revLink = waLink(o.phone, waReviewMessage());
                return (
                  <div key={o.id} style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                      <div>
                        <div style={{ fontWeight: 700, color: '#e8edf2', fontSize: 14 }}>{o.name || 'Fără nume'}</div>
                        {o.phone && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>📞 {o.phone}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {o.orderId && <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>#{o.orderId}</div>}
                        {o.date && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>📅 {fmtOrderDate(o.date)}</div>}
                        {o.status && <div style={{ fontSize: 10, color: '#f97316', marginTop: 2 }}>{o.status}</div>}
                        {o.payMode && <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>{o.payMode}</div>}
                      </div>
                    </div>
                    {(o.address) && (
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                        📍 {o.address}{o.delivMode === 'locker' && o.delivPoint ? ` — ${o.delivPoint}` : ''}
                      </div>
                    )}
                    {o.products.length > 0 && (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,.04)', paddingTop: 6, marginBottom: 8 }}>
                        {o.products.map((p, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#cbd5e1', marginBottom: 2 }}>
                            <span title={p.fullName}>{p.name} {p.qty > 1 ? `× ${p.qty}` : ''}</span>
                            {p.price > 0 && <span style={{ color: '#94a3b8', fontFamily: 'monospace', flexShrink: 0, marginLeft: 8 }}>{fmt(p.price)} RON</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {o.phone && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,.04)', paddingTop: 8 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <a href={fbLink} target="_blank" rel="noopener noreferrer" onClick={() => markSent(o.id, 'feedbackSentAt')}
                            style={{ flex: 1, textAlign: 'center', background: 'rgba(37,211,102,.12)', border: '1px solid rgba(37,211,102,.35)', color: '#25d366', borderRadius: 7, padding: '7px 10px', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>
                            💬 Cere feedback
                          </a>
                          <a href={revLink} target="_blank" rel="noopener noreferrer" onClick={() => markSent(o.id, 'reviewSentAt')}
                            style={{ flex: 1, textAlign: 'center', background: 'rgba(249,115,22,.12)', border: '1px solid rgba(249,115,22,.35)', color: '#f97316', borderRadius: 7, padding: '7px 10px', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>
                            ⭐ Cere recenzie
                          </a>
                        </div>
                        {(o.feedbackSentAt || o.reviewSentAt) && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {o.feedbackSentAt && (
                              <div style={{ fontSize: 10, color: '#25d366' }}>✓ Feedback cerut {fmtOrderDate(o.feedbackSentAt)}</div>
                            )}
                            {o.reviewSentAt && (
                              <div style={{ fontSize: 10, color: '#f97316' }}>✓ Recenzie cerută {fmtOrderDate(o.reviewSentAt)}</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, padding: 24 }}>Nicio comandă găsită pentru căutarea asta.</div>
              )}
            </div>
          </>
        )}

        {!orders.length && !loading && (
          <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, padding: '40px 20px', border: '1px dashed rgba(255,255,255,.1)', borderRadius: 12 }}>
            Exportă comenzile din panoul de seller eMAG Marketplace și încarcă fișierul aici.
          </div>
        )}
      </div>
    </div>
  );
}
