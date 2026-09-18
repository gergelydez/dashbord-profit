'use client';
import { useState, useEffect, useMemo } from 'react';

/* ══════════════════════════════════════════════════════════════
   Comenzi eMAG — import din exportul Excel al panoului de seller
   Nu există API live conectat (eMAG cere IP fix whitelist-uit,
   incompatibil cu serverless-ul Vercel fără un proxy plătit) —
   vezi decizia din conversație: mergem pe import manual, ca la
   GLS/Sameday.
══════════════════════════════════════════════════════════════ */

const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { if (typeof window !== 'undefined') localStorage.removeItem(k); } catch {} },
};

const fmt = n => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

// Caută prima coloană al cărei header conține unul din cuvintele cheie —
// nu ne bazăm pe poziție fixă, pentru că nu am văzut exportul real eMAG
// și denumirile de coloane pot varia (RO/EN, cu/fără diacritice).
function findCol(headers, keywords) {
  return headers.findIndex(h => keywords.some(k => h.includes(k)));
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

    const idx = {
      orderId: findCol(headers, ['comanda', 'id comanda', 'nr. comanda', 'nr comanda', 'order id', 'order number', 'id_comanda']),
      name:    findCol(headers, ['nume client', 'client', 'destinatar', 'nume', 'customer name', 'recipient', 'billing name', 'shipping name']),
      phone:   findCol(headers, ['telefon', 'phone', 'tel.', 'tel']),
      product: findCol(headers, ['denumire produs', 'produs', 'product name', 'product', 'denumire']),
      qty:     findCol(headers, ['cantitate', 'qty', 'quantity', 'buc']),
      price:   findCol(headers, ['pret', 'preț', 'price', 'valoare']),
      city:    findCol(headers, ['localitate', 'oras', 'oraș', 'city']),
      address: findCol(headers, ['adresa', 'adresă', 'address']),
      status:  findCol(headers, ['status', 'stare']),
      date:    findCol(headers, ['data', 'date']),
      awb:     findCol(headers, ['awb']),
    };

    debugSheets.push({ sheetName, headers, idx });

    if (idx.name === -1 && idx.phone === -1 && idx.product === -1) {
      // Foaia asta nu pare să conțină date de comandă (ex. un tab de sumar) — o sărim.
      continue;
    }

    const byOrder = new Map();
    rows.slice(1).forEach((row, rowN) => {
      if (!row.some(c => (c ?? '') !== '')) return; // rând complet gol
      const orderId = idx.orderId !== -1 ? String(row[idx.orderId] || '').trim() : '';
      const key = orderId || `__row_${sheetName}_${rowN}`;

      let order = byOrder.get(key);
      if (!order) {
        order = {
          id: key,
          orderId: orderId || '',
          name: idx.name !== -1 ? String(row[idx.name] || '').trim() : '',
          phone: idx.phone !== -1 ? String(row[idx.phone] || '').trim() : '',
          city: idx.city !== -1 ? String(row[idx.city] || '').trim() : '',
          address: idx.address !== -1 ? String(row[idx.address] || '').trim() : '',
          status: idx.status !== -1 ? String(row[idx.status] || '').trim() : '',
          date: idx.date !== -1 ? String(row[idx.date] || '').trim() : '',
          awb: idx.awb !== -1 ? String(row[idx.awb] || '').trim() : '',
          products: [],
        };
        byOrder.set(key, order);
      }
      // Completăm câmpuri lipsă din rânduri ulterioare ale aceleiași comenzi
      if (!order.name && idx.name !== -1) order.name = String(row[idx.name] || '').trim();
      if (!order.phone && idx.phone !== -1) order.phone = String(row[idx.phone] || '').trim();

      const productName = idx.product !== -1 ? String(row[idx.product] || '').trim() : '';
      if (productName) {
        order.products.push({
          name: productName,
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
  const [showDebug, setShowDebug] = useState(false);

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

        // Dedup pe orderId (dacă există) sau pe telefon+primul produs, ca reimportul
        // aceluiași fișier (sau un export suprapus) să nu dubleze comenzile.
        for (const o of parsed) {
          const dedupKey = o.orderId || `${o.phone}__${o.products[0]?.name || ''}`;
          const existingIdx = merged.findIndex(m => (m.orderId || `${m.phone}__${m.products[0]?.name || ''}`) === dedupKey);
          if (existingIdx !== -1) merged[existingIdx] = o;
          else merged.push(o);
        }
        if (!newFiles.includes(file.name)) newFiles.push(file.name);
      }

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

  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const s = search.toLowerCase();
    return orders.filter(o =>
      (o.name || '').toLowerCase().includes(s) ||
      (o.phone || '').includes(s) ||
      (o.orderId || '').toLowerCase().includes(s) ||
      (o.products || []).some(p => p.name.toLowerCase().includes(s))
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
              <summary style={{ cursor: 'pointer', color: '#64748b' }} onClick={() => setShowDebug(v => !v)}>
                🔍 Debug — ce coloane am recunoscut în fișier
              </summary>
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
              {filtered.map(o => (
                <div key={o.id} style={{ background: '#0f1419', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#e8edf2', fontSize: 14 }}>{o.name || 'Fără nume'}</div>
                      {o.phone && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>📞 {o.phone}</div>}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {o.orderId && <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>#{o.orderId}</div>}
                      {o.status && <div style={{ fontSize: 10, color: '#f97316', marginTop: 2 }}>{o.status}</div>}
                    </div>
                  </div>
                  {(o.city || o.address) && (
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>📍 {[o.address, o.city].filter(Boolean).join(', ')}</div>
                  )}
                  {o.products.length > 0 && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,.04)', paddingTop: 6 }}>
                      {o.products.map((p, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#cbd5e1', marginBottom: 2 }}>
                          <span>{p.name} {p.qty > 1 ? `× ${p.qty}` : ''}</span>
                          {p.price > 0 && <span style={{ color: '#94a3b8', fontFamily: 'monospace', flexShrink: 0, marginLeft: 8 }}>{fmt(p.price)} RON</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, padding: 24 }}>Nicio comandă găsită pentru căutarea asta.</div>
              )}
            </div>
          </>
        )}

        {!orders.length && !loading && (
          <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, padding: '40px 20px', border: '1px dashed rgba(255,255,255,.1)', borderRadius: 12 }}>
            Exportă comenzile din panoul de seller eMAG Marketplace (Comenzi → Export) și încarcă fișierul aici.<br/>
            Dacă formatul exportat nu e recunoscut corect, trimite-mi un exemplu (sau screenshot cu antetele coloanelor) și ajustez detectarea.
          </div>
        )}
      </div>
    </div>
  );
}
