'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useShopStore } from '@/lib/store/shop-store';
import type {
  EnrichedOrder, OrdersResponse, RowActionState,
  ProcessingStatus, CourierName, AwbWizardData,
} from './types';

const S: Record<string, React.CSSProperties> = {
  page:        { background: 'var(--c-bg)', minHeight: '100dvh', fontFamily: 'DM Sans, sans-serif', color: 'var(--c-text)', paddingBottom: 80 },
  topbar:      { background: 'var(--c-bg2)', borderBottom: '1px solid var(--c-border)', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', top: 0, zIndex: 50 },
  topbarRow1:  { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  h1:          { fontSize: 17, fontWeight: 700, color: 'var(--c-text)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 },
  shopBadge:   { display: 'flex', alignItems: 'center', gap: 6, background: 'var(--c-bg3)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: 'var(--c-text2)' },
  searchWrap:  { flex: 1, minWidth: 180, maxWidth: 320, position: 'relative' },
  searchInput: { width: '100%', background: 'var(--c-bg3)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '8px 12px 8px 34px', color: 'var(--c-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },
  searchIcon:  { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, fontSize: 13 },
  select:      { background: 'var(--c-bg3)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '8px 12px', color: 'var(--c-text)', fontSize: 13, outline: 'none', cursor: 'pointer' },
  iconBtn:     { background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '7px 12px', color: 'var(--c-text2)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' as const },
  statsBar:    { display: 'flex', gap: 10, padding: '12px 20px', flexWrap: 'wrap' },
  statCard:    { background: 'var(--c-bg3)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '10px 16px', flex: 1, minWidth: 90 },
  statLabel:   { fontSize: 10, color: 'var(--c-text3)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 3 },
  statValue:   { fontSize: 22, fontWeight: 700, color: 'var(--c-text)' },
  bulkBar:     { background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 12, margin: '0 20px 10px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  bulkLabel:   { fontSize: 13, color: 'var(--c-orange)', fontWeight: 600, flex: 1 },
  table:       { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th:          { padding: '10px 14px', textAlign: 'left' as const, color: 'var(--c-text3)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg2)', whiteSpace: 'nowrap' as const },
  td:          { padding: '10px 14px', borderBottom: '1px solid var(--c-border2)', verticalAlign: 'middle' as const },
  actionsCell: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  btnPrimary:  { background: 'var(--c-orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const, display: 'flex', alignItems: 'center', gap: 4 },
  btnGhost:    { background: 'var(--c-surface)', color: 'var(--c-text2)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '5px 9px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const, display: 'flex', alignItems: 'center', gap: 4 },
  btnDisabled: { background: 'var(--c-bg3)', color: 'var(--c-text4)', border: '1px solid var(--c-border2)', borderRadius: 8, padding: '5px 9px', fontSize: 12, cursor: 'not-allowed', whiteSpace: 'nowrap' as const, display: 'flex', alignItems: 'center', gap: 4, opacity: 0.5 },
  btnDanger:   { background: 'rgba(244,63,94,0.12)', color: 'var(--c-red)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 8, padding: '5px 9px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  btnEdit:     { background: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' as const },
  overlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9998, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  drawer:      { position: 'fixed' as const, left: 0, right: 0, bottom: 0, width: '100%', maxWidth: 640, margin: '0 auto', maxHeight: '92dvh', background: '#0a0e17', borderTop: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px 20px 0 0', zIndex: 9999, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const },
  drawerHead:  { padding: '16px 20px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky' as const, top: 0, background: '#0a0e17', zIndex: 1 },
  drawerBody:  { padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 14 },
  drawerFoot:  { padding: '12px 20px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', gap: 10, background: '#0a0e17', position: 'sticky' as const, bottom: 0, zIndex: 2 },
  section:     { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '14px 16px' },
  sectionHead: { fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' as const },
  row2col:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  fieldLabel:  { fontSize: 11, color: 'var(--c-text3)', marginBottom: 3 },
  fieldValue:  { fontSize: 13, color: 'var(--c-text)' },
  toastWrap:   { position: 'fixed' as const, bottom: 90, right: 16, zIndex: 200, display: 'flex', flexDirection: 'column' as const, gap: 8, maxWidth: 340 },
  toastOk:     { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.35)', color: '#10b981', borderRadius: 12, padding: '11px 15px', fontSize: 13, fontWeight: 500 },
  toastErr:    { background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.35)', color: 'var(--c-red)', borderRadius: 12, padding: '11px 15px', fontSize: 13, fontWeight: 500 },
  toastInfo:   { background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', color: 'var(--c-blue)', borderRadius: 12, padding: '11px 15px', fontSize: 13, fontWeight: 500 },
  empty:       { padding: '60px 20px', textAlign: 'center' as const, color: 'var(--c-text3)' },
  spinner:     { width: 14, height: 14, border: '2px solid transparent', borderTopColor: 'currentColor', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite' },
  checkbox:    { width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--c-orange)' },
  input:       { width: '100%', background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '7px 10px', color: 'var(--c-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },
  inputLabel:  { fontSize: 11, color: 'var(--c-text3)', marginBottom: 4, display: 'block' },
  stepDot:     { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 },
  toggleOn:    { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 10, padding: '6px 12px', color: '#10b981', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, whiteSpace: 'nowrap' as const },
  toggleOff:   { background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '6px 12px', color: 'var(--c-text3)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, whiteSpace: 'nowrap' as const },
  inlineInput: { flex: 1, background: 'var(--c-bg)', border: '1px solid var(--c-orange)', borderRadius: 6, padding: '5px 8px', color: 'var(--c-text)', fontSize: 13, outline: 'none', boxShadow: '0 0 0 2px rgba(249,115,22,0.15)', boxSizing: 'border-box' as const },
  saveBtn:     { background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const, display: 'flex', alignItems: 'center', gap: 4 },
  cancelBtn:   { background: 'var(--c-surface)', color: 'var(--c-text3)', border: '1px solid var(--c-border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, cursor: 'pointer' },
  editRow:     { display: 'flex', alignItems: 'center', gap: 6 },
  codToggle:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, cursor: 'pointer', userSelect: 'none' as const },
};

/* BADGE */
function Badge({ label, color }: { label: string; color: 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'orange' }) {
  const colors: Record<string, React.CSSProperties> = {
    green:  { background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)' },
    yellow: { background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' },
    red:    { background: 'rgba(244,63,94,0.12)',  color: '#f43f5e', border: '1px solid rgba(244,63,94,0.25)' },
    blue:   { background: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.25)' },
    gray:   { background: 'rgba(100,116,139,0.12)', color: '#94a3b8', border: '1px solid rgba(100,116,139,0.2)' },
    orange: { background: 'rgba(249,115,22,0.12)', color: '#f97316', border: '1px solid rgba(249,115,22,0.25)' },
  };
  return <span style={{ ...colors[color], borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>;
}
function finBadge(s: string) {
  if (s === 'paid')     return <Badge label="Plătit" color="green" />;
  if (s === 'pending')  return <Badge label="Ramburs" color="yellow" />;
  if (s === 'refunded') return <Badge label="Returnat" color="red" />;
  return <Badge label={s} color="gray" />;
}
function fulBadge(s: string | null) {
  if (!s || s === 'unfulfilled' || s === 'null') return <Badge label="Nefulfilat" color="gray" />;
  if (s === 'fulfilled') return <Badge label="Expediat" color="green" />;
  if (s === 'partial')   return <Badge label="Parțial" color="yellow" />;
  return <Badge label={s} color="blue" />;
}
function procBadge(s: ProcessingStatus) {
  if (s === 'fulfilled')  return <Badge label="✓ Complet" color="green" />;
  if (s === 'partial')    return <Badge label="Parțial" color="yellow" />;
  if (s === 'failed')     return <Badge label="Eroare" color="red" />;
  if (s === 'processing') return <Badge label="Se procesează…" color="blue" />;
  if (s === 'cancelled')  return <Badge label="Anulat" color="gray" />;
  return <Badge label="În așteptare" color="gray" />;
}

/* TOAST */
interface Toast { id: number; type: 'ok' | 'err' | 'info'; msg: string }
let toastId = 0;
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((type: Toast['type'], msg: string) => {
    const id = ++toastId;
    setToasts(p => [...p, { id, type, msg }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);
  return { toasts, add };
}
function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div style={S.toastWrap}>
      {toasts.map(t => (
        <div key={t.id} style={t.type === 'ok' ? S.toastOk : t.type === 'err' ? S.toastErr : S.toastInfo}>
          {t.type === 'ok' ? '✓ ' : t.type === 'err' ? '✕ ' : 'ℹ '}{t.msg}
        </div>
      ))}
    </div>
  );
}

function Spin() { return <span style={S.spinner} />; }

function Skeleton({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: 11 }).map((_, j) => (
            <td key={j} style={S.td}>
              <div style={{ height: 13, background: 'var(--c-surface2)', borderRadius: 6, animation: 'pulse 1.4s ease-in-out infinite', width: j === 0 ? 20 : j === 1 ? 60 : '80%' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* SWITCH */
function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={e => { e.stopPropagation(); onChange(!on); }}
      style={{ width: 40, height: 22, borderRadius: 11, background: on ? '#10b981' : 'var(--c-border)', position: 'relative', transition: 'background 0.2s', cursor: 'pointer', flexShrink: 0 }}
    >
      <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: on ? 20 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
    </div>
  );
}

/* EDITABLE FIELD */
function EditableField({ label, value, onSave, type = 'text', placeholder }: {
  label: string; value: string | number; onSave: (v: string) => Promise<void>;
  type?: string; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(String(value));
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);

  const save = async () => {
    if (draft === String(value)) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); setEditing(false); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={S.inputLabel}>{label}</div>
      {editing ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            ref={inputRef}
            type={type}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(String(value)); setEditing(false); } }}
            style={S.inlineInput}
            placeholder={placeholder}
          />
          <button style={S.saveBtn} onClick={save} disabled={saving}>{saving ? <Spin /> : '✓'}</button>
          <button style={S.cancelBtn} onClick={() => { setDraft(String(value)); setEditing(false); }}>✕</button>
        </div>
      ) : (
        <div style={S.editRow}>
          <span style={S.fieldValue}>{value || <span style={{ color: 'var(--c-text4)', fontStyle: 'italic' }}>—</span>}</span>
          <button style={S.btnEdit} onClick={() => setEditing(true)}>✏</button>
        </div>
      )}
    </div>
  );
}

/* FIELD (wizard use) */
function Field({ label, value, onChange, type = 'text', placeholder, disabled }: {
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label style={S.inputLabel}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        style={{ ...S.input, ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
      />
    </div>
  );
}

/* INVOICE SECTION */
/* ─── INVOICE MODAL ────────────────────────────────────────────────────────── */
interface InvoiceLineLocal {
  name: string; sku: string; quantity: number; price: number;
  sbCode?: string; sbName?: string; sbMatched?: boolean;
  useGestiuneName?: boolean; // true = use name from gestiune, false = use Shopify name
}
interface SbProduct { code: string; name: string; unit: string; price: number; warehouse: string; stock?: number | null; }

function InvoiceModal({ order, shop, actionState, onClose, onGenerate, generatedInvoice: generatedInvoiceProp }: {
  order: EnrichedOrder; shop: string; actionState: RowActionState;
  onClose: () => void;
  generatedInvoice?: { series: string; number: string; downloadUrl: string; collected: boolean } | null;
  onGenerate: (opts: { shopifyOrderId: string; withCollection: boolean; useStock: boolean; overrides: { customer: { name: string; phone: string; email: string }; address: { address1: string; city: string; zip: string; province: string }; lineItems: InvoiceLineLocal[] } }) => void;
}) {
  const isPaid = order.financialStatus !== 'pending';

  // Client state
  const [name,     setName]     = useState(order.customer.name  || '');
  const [phone,    setPhone]    = useState(order.customer.phone || '');
  const [email,    setEmail]    = useState(order.customer.email || '');
  const [addr1,    setAddr1]    = useState(order.address.address1 || '');
  const [city,     setCity]     = useState(order.address.city    || '');
  const [zip,      setZip]      = useState(order.address.zip     || '');
  const [province, setProvince] = useState(order.address.province || '');

  // Line items state
  const [items, setItems] = useState<InvoiceLineLocal[]>(
    order.lineItems.map(li => ({ name: li.name, sku: li.sku || '', quantity: li.quantity, price: li.price }))
  );

  // Options
  const [withCollection, setWithCollection] = useState(!isPaid); // auto-bifat dacă e ramburs (pending)
  const [useStock,       setUseStock]       = useState(false);

  // SmartBill product search per row
  const [sbQuery,    setSbQuery]    = useState<Record<number, string>>({});
  const [sbResults,  setSbResults]  = useState<Record<number, SbProduct[]>>({});
  const [sbLoading,  setSbLoading]  = useState<Record<number, boolean>>({});
  const [sbOpen,     setSbOpen]     = useState<Record<number, boolean>>({});

  // Use external generatedInvoice prop (set by parent after mutation)
  const generatedInvoice = generatedInvoiceProp ?? null;

  // Existing invoice check
  const attrs     = order.noteAttributes ?? {};
  const existUrl  = order.invoice?.url || attrs['xconnector-invoice-url'] || attrs['invoice-url'] || '';
  const existNum  = order.invoice ? `${order.invoice.series}${order.invoice.number}` : (attrs['invoice-number'] || attrs['Factură'] || '');

  const updateItem = (i: number, patch: Partial<InvoiceLineLocal>) => {
    setItems(p => { const n = [...p]; n[i] = { ...n[i], ...patch }; return n; });
  };

  // SmartBill search for a row
  const sbTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [sbErrors, setSbErrors] = useState<Record<number, string>>({});

  const searchSb = (i: number, q: string) => {
    setSbQuery(p => ({ ...p, [i]: q }));
    if (!q || q.length < 1) {
      setSbResults(p => ({ ...p, [i]: [] }));
      setSbOpen(p => ({ ...p, [i]: false }));
      return;
    }
    // Debounce 400ms
    clearTimeout(sbTimers.current[i]);
    sbTimers.current[i] = setTimeout(async () => {
      setSbLoading(p => ({ ...p, [i]: true }));
      setSbErrors(p => ({ ...p, [i]: '' }));
      try {
        const res = await fetch(`/api/connector/smartbill-products?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (!res.ok || json.error) {
          setSbErrors(p => ({ ...p, [i]: json.error || `Eroare ${res.status}` }));
          setSbResults(p => ({ ...p, [i]: [] }));
        } else {
          setSbResults(p => ({ ...p, [i]: json.products || [] }));
          setSbOpen(p => ({ ...p, [i]: true }));
          if ((json.products || []).length === 0) {
            // Not a blocking error — user can still generate with manual SKU
            setSbErrors(p => ({ ...p, [i]: 'Niciun rezultat în Gestiune. Dacă SKU-ul e corect, poți genera factura.' }));
          }
        }
      } catch (e) {
        setSbErrors(p => ({ ...p, [i]: (e as Error).message }));
      } finally {
        setSbLoading(p => ({ ...p, [i]: false }));
      }
    }, 400);
  };

  const pickSbProduct = (i: number, p: SbProduct) => {
    // Keep current name (Shopify) by default — user can switch to gestiune name via toggle
    updateItem(i, {
      sku: p.code,
      sbCode: p.code,
      sbName: p.name,          // store gestiune name for toggle
      sbMatched: true,
      useGestiuneName: false,  // default: keep Shopify name on invoice
      price: p.price > 0 ? p.price : items[i].price,
    });
    setSbOpen(prev => ({ ...prev, [i]: false }));
    setSbQuery(prev => ({ ...prev, [i]: '' }));
    setSbResults(prev => ({ ...prev, [i]: [] }));
    setSbErrors(prev => ({ ...prev, [i]: '' }));
  };

  const [localError, setLocalError] = useState<string | null>(null);

  const handleGenerate = () => {
    setLocalError(null);
    // When useStock=true: ALL products MUST have SKU — no exceptions
    if (useStock) {
      const missing = items.filter(i => i.price > 0 && !i.sku?.trim());
      if (missing.length > 0) {
        setLocalError(
          `Adaugă codul SKU pentru: ` +
          missing.map(i => `"${i.name}"`).join(', ') +
          `. Caută produsul în câmpul SKU de mai sus și selectează-l din Gestiunea SmartBill.`
        );
        return; // BLOCK — do not generate
      }
    }
    onGenerate({
      shopifyOrderId: order.id, withCollection, useStock,
      overrides: {
        customer: { name, phone, email },
        address:  { address1: addr1, city, zip, province },
        lineItems: items,
      },
    });
  };

  const mStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'rgba(0,0,0,0.82)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  };
  const boxStyle: React.CSSProperties = {
    background: '#0d1220',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 20,
    width: '100%', maxWidth: 620,
    maxHeight: '92dvh',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  };
  const headStyle: React.CSSProperties = {
    padding: '18px 22px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  };
  const bodyStyle: React.CSSProperties = {
    overflowY: 'auto', flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16,
  };
  const footStyle: React.CSSProperties = {
    padding: '14px 22px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0,
    background: '#0d1220',
  };
  const secStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14, padding: '14px 16px',
  };
  const secH: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--c-text3)',
    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12,
  };
  const inp: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, padding: '7px 10px', color: 'var(--c-text)', fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--c-text3)', marginBottom: 3, display: 'block' };
  const toggleRow: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderRadius: 10, cursor: 'pointer', userSelect: 'none',
  };

  // ── After generation: show invoice viewer ─────────────────────────────────
  if (generatedInvoice || (existUrl && existNum)) {
    const inv = generatedInvoice || { series: '', number: existNum, downloadUrl: existUrl, collected: !!order.invoice?.status };
    return (
      <div style={mStyle} onClick={onClose}>
        <div style={boxStyle} onClick={e => e.stopPropagation()}>
          <div style={headStyle}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#f97316' }}>🧾 Factură {inv.number}</div>
              <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2 }}>Comanda {order.name}</div>
            </div>
            <button style={{ background: 'none', border: 'none', color: 'var(--c-text3)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }} onClick={onClose}>✕</button>
          </div>
          <div style={{ ...bodyStyle, gap: 14 }}>
            {/* Status badges */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge label="✓ Generată" color="green" />
              {inv.collected && <Badge label="✓ Încasată" color="orange" />}
              {generatedInvoice && <Badge label="✓ Salvată în Shopify" color="blue" />}
            </div>

            {/* Invoice number display — big and clickable like XConnector */}
            <div style={{ ...secStyle, textAlign: 'center' as const }}>
              <div style={{ fontSize: 11, color: 'var(--c-text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Număr factură</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#f97316', fontFamily: 'monospace', letterSpacing: 2 }}>{inv.number}</div>
              <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 4 }}>
                {order.customer.name} · {order.address.city}
              </div>
            </div>

            {/* PDF viewer iframe */}
            <div style={{ ...secStyle, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: 12, color: 'var(--c-text3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>📄 Previzualizare factură</span>
                <a href={inv.downloadUrl} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11, color: '#f97316', textDecoration: 'none', fontWeight: 600 }}>
                  Deschide în tab nou ↗
                </a>
              </div>
              <iframe
                src={inv.downloadUrl}
                style={{ width: '100%', height: 380, border: 'none', background: '#fff' }}
                title={`Factură ${inv.number}`}
              />
            </div>

            {/* Download button */}
            <a href={inv.downloadUrl} target="_blank" rel="noreferrer"
              style={{ ...S.btnPrimary, textDecoration: 'none', justifyContent: 'center', padding: '10px 16px', fontSize: 14 }}>
              📥 Descarcă PDF
            </a>
          </div>
          <div style={footStyle}>
            <button style={S.btnGhost} onClick={onClose}>Închide</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Generate form ──────────────────────────────────────────────────────────
  return (
    <div style={mStyle} onClick={onClose}>
      <div style={boxStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headStyle}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>🧾 Generează factură</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2 }}>
              Comanda {order.name} · {order.totalPrice.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} {order.currency}
            </div>
          </div>
          <button style={{ background: 'none', border: 'none', color: 'var(--c-text3)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={bodyStyle}>

          {/* CLIENT */}
          <div style={secStyle}>
            <div style={secH}>👤 Date client</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Nume complet *</label>
                <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Ion Popescu" />
              </div>
              <div>
                <label style={lbl}>Telefon</label>
                <input style={inp} value={phone} onChange={e => setPhone(e.target.value)} placeholder="07xxxxxxxx" />
              </div>
              <div>
                <label style={lbl}>Email</label>
                <input style={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="client@email.ro" />
              </div>
            </div>
          </div>

          {/* ADDRESS */}
          <div style={secStyle}>
            <div style={secH}>📍 Adresă facturare</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Stradă + număr</label>
                <input style={inp} value={addr1} onChange={e => setAddr1(e.target.value)} placeholder="Str. Exemplu nr. 1" />
              </div>
              <div>
                <label style={lbl}>Oraș</label>
                <input style={inp} value={city} onChange={e => setCity(e.target.value)} placeholder="Cluj-Napoca" />
              </div>
              <div>
                <label style={lbl}>Județ</label>
                <input style={inp} value={province} onChange={e => setProvince(e.target.value)} placeholder="Cluj" />
              </div>
              <div>
                <label style={lbl}>Cod poștal</label>
                <input style={inp} value={zip} onChange={e => setZip(e.target.value)} placeholder="400000" />
              </div>
            </div>
          </div>

          {/* PRODUCTS */}
          <div style={secStyle}>
            <div style={secH}>📦 Produse facturate</div>
            {items.map((item, i) => {
              const shopifyName = order.lineItems[i]?.name ?? item.name;
              const gestiuneName = item.sbName ?? item.name;
              const showNameToggle = item.sbMatched && item.sbName && item.sbName !== shopifyName;
              return (
              <div key={i} style={{ paddingBottom: i < items.length - 1 ? 14 : 0, marginBottom: i < items.length - 1 ? 14 : 0, borderBottom: i < items.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>

                {/* SKU / Cod SmartBill — FIRST, most important */}
                <div style={{ marginBottom: 8 }}>
                  <label style={lbl}>
                    SKU / Cod SmartBill
                    {!item.sku && (
                      <span style={{ marginLeft: 6, color: '#f59e0b', fontSize: 10, fontWeight: 600 }}>⚠ fără cod</span>
                    )}
                    {item.sbMatched && (
                      <span style={{ marginLeft: 6, color: '#10b981', fontSize: 10, fontWeight: 600 }}>✓ asociat din Gestiune</span>
                    )}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      style={{ ...inp, fontFamily: 'monospace', fontSize: 13, paddingRight: sbLoading[i] ? 32 : 10,
                        ...(item.sbMatched ? { borderColor: '#10b981', background: 'rgba(16,185,129,0.05)' } : {})
                      }}
                      value={item.sku}
                      onChange={e => {
                        updateItem(i, { sku: e.target.value, sbMatched: false, sbName: undefined });
                        searchSb(i, e.target.value);
                      }}
                      placeholder="Cod SKU din SmartBill (ex: WBAND) sau caută după nume…"
                    />
                    {sbLoading[i] && (
                      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}><Spin /></span>
                    )}
                    {sbOpen[i] && (sbResults[i] || []).length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#141928', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, zIndex: 200, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                        {(sbResults[i] || []).map((p, pi) => (
                          <div key={pi}
                            onClick={() => pickSbProduct(i, p)}
                            style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(249,115,22,0.1)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{p.name}</div>
                                <div style={{ fontSize: 11, color: '#f97316', fontFamily: 'monospace', marginTop: 2 }}>{p.code}</div>
                              </div>
                              <div style={{ textAlign: 'right' as const, flexShrink: 0, marginLeft: 8 }}>
                                {p.stock != null && <div style={{ fontSize: 11, color: p.stock > 0 ? '#10b981' : '#f43f5e', fontWeight: 600 }}>Stoc: {p.stock}</div>}
                                {p.price > 0 && <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>{p.price} RON</div>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {sbErrors[i] && (
                    <div style={{ marginTop: 3, fontSize: 11, color: '#f59e0b' }}>⚠ {sbErrors[i]}</div>
                  )}
                </div>

                {/* Name toggle — shown only when gestiune name differs from Shopify name */}
                {showNameToggle && (
                  <div style={{ marginBottom: 8, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)', marginBottom: 6 }}>📝 Nume pe factură:</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => updateItem(i, { useGestiuneName: false, name: shopifyName })}
                        style={{ flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                          background: !item.useGestiuneName ? '#f97316' : 'rgba(255,255,255,0.07)',
                          color: !item.useGestiuneName ? '#fff' : 'var(--c-text3)',
                        }}
                      >
                        🛒 Shopify<br/>
                        <span style={{ fontWeight: 400, opacity: 0.8, fontSize: 10 }}>{shopifyName.slice(0, 30)}{shopifyName.length > 30 ? '…' : ''}</span>
                      </button>
                      <button
                        onClick={() => updateItem(i, { useGestiuneName: true, name: gestiuneName })}
                        style={{ flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                          background: item.useGestiuneName ? '#10b981' : 'rgba(255,255,255,0.07)',
                          color: item.useGestiuneName ? '#fff' : 'var(--c-text3)',
                        }}
                      >
                        🏬 Gestiune<br/>
                        <span style={{ fontWeight: 400, opacity: 0.8, fontSize: 10 }}>{gestiuneName.slice(0, 30)}{gestiuneName.length > 30 ? '…' : ''}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Qty + Price */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={lbl}>Cantitate</label>
                    <input type="number" min={1} style={inp} value={item.quantity} onChange={e => updateItem(i, { quantity: parseInt(e.target.value) || 1 })} />
                  </div>
                  <div>
                    <label style={lbl}>Preț unit. ({order.currency})</label>
                    <input type="number" step="0.01" style={inp} value={item.price} onChange={e => updateItem(i, { price: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>

              </div>
              );
            })}
          </div>

          {/* OPTIONS */}
          <div style={secStyle}>
            <div style={secH}>⚙ Opțiuni factură</div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {/* Încasare toggle */}
              <div
                style={{ ...toggleRow, background: withCollection ? 'rgba(245,158,11,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${withCollection ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.07)'}` }}
                onClick={() => setWithCollection(v => !v)}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: withCollection ? '#f59e0b' : 'var(--c-text2)' }}>
                    💰 Adaugă încasare
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 2 }}>
                    {isPaid ? 'Comanda e plătită online — emite chitanță' : 'Comandă ramburs — auto-activat'}
                  </div>
                </div>
                <Switch on={withCollection} onChange={setWithCollection} />
              </div>

              {/* Gestiune toggle */}
              <div
                style={{ ...toggleRow, background: useStock ? 'rgba(59,130,246,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${useStock ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.07)'}` }}
                onClick={() => setUseStock(v => !v)}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: useStock ? '#60a5fa' : 'var(--c-text2)' }}>
                    🏬 Utilizează Gestiunea mărfuri
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 2 }}>
                    Scade din stoc SmartBill la generare
                  </div>
                </div>
                <Switch on={useStock} onChange={setUseStock} />
              </div>
            </div>
          </div>

          {(localError || actionState.error) && (
            <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#f43f5e', lineHeight: 1.5 }}>
              ✕ {localError || actionState.error}
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={footStyle}>
          <button style={S.btnGhost} onClick={onClose} disabled={actionState.invoiceLoading}>Anulează</button>
          <button
            style={{ ...S.btnPrimary, padding: '9px 20px', fontSize: 14, ...(actionState.invoiceLoading || order.cancelled ? { opacity: 0.6 } : {}) }}
            onClick={handleGenerate}
            disabled={actionState.invoiceLoading || order.cancelled || !name.trim()}
          >
            {actionState.invoiceLoading
              ? <><Spin /> Se generează…</>
              : `🧾 Generează${withCollection ? ' + Încasează' : ''}`
            }
          </button>
        </div>
      </div>
    </div>
  );
}

/* InvoiceSection — shown inside OrderDrawer tab, opens InvoiceModal */
function InvoiceSection({ order, shop, actionState, onOpenModal }: {
  order: EnrichedOrder; shop: string; actionState: RowActionState;
  onOpenModal: () => void;
}) {
  const attrs    = order.noteAttributes ?? {};
  const existUrl = order.invoice?.url || attrs['xconnector-invoice-url'] || attrs['invoice-url'] || '';
  const existNum = order.invoice ? `${order.invoice.series}${order.invoice.number}` : (attrs['invoice-number'] || attrs['Factură'] || '');

  if (existUrl || existNum) {
    return (
      <div style={S.section}>
        <div style={S.sectionHead}>🧾 Factură</div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
          <div style={S.row2col}>
            <div><div style={S.fieldLabel}>Serie/Număr</div>
              <button onClick={onOpenModal} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#f97316', fontFamily: 'monospace', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>{existNum}</span>
              </button>
            </div>
            <div><div style={S.fieldLabel}>Status</div><Badge label={order.invoice?.status || 'generată'} color="green" /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
            <button onClick={onOpenModal} style={{ ...S.btnPrimary, textDecoration: 'none' }}>👁 Vizualizează</button>
            <a href={existUrl} target="_blank" rel="noreferrer" style={{ ...S.btnGhost, textDecoration: 'none' }}>📥 Descarcă</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.section}>
      <div style={S.sectionHead}>🧾 Factură</div>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--c-text3)' }}>Nicio factură generată pentru această comandă.</div>
        <button
          style={order.cancelled ? { ...S.btnPrimary, opacity: 0.5 } : S.btnPrimary}
          onClick={onOpenModal}
          disabled={order.cancelled}
        >
          🧾 Generează factură
        </button>
      </div>
    </div>
  );
}

/* EDITABLE PRODUCTS SECTION */
interface LocalLineItem { name: string; sku: string; quantity: number; price: number; _edited?: boolean; }

function ProductsSection({ order, shop, onToast, onRefresh }: {
  order: EnrichedOrder; shop: string;
  onToast: (t: 'ok' | 'err' | 'info', m: string) => void; onRefresh: () => void;
}) {
  const [items, setItems]   = useState<LocalLineItem[]>(order.lineItems.map(li => ({ ...li })));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty]   = useState(false);

  const update = (idx: number, field: keyof LocalLineItem, val: string) => {
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: (field === 'quantity' || field === 'price') ? (parseFloat(val) || 0) : val, _edited: true };
      return next;
    });
    setDirty(true);
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/connector/update-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopifyOrderId: order.id, shop, lineItems: items.map(({ _edited, ...li }) => li) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Eroare salvare');
      onToast('ok', 'Produse actualizate!');
      setDirty(false);
      onRefresh();
    } catch (e) { onToast('err', (e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div style={S.section}>
      <div style={S.sectionHead}>
        <span>📦 Produse ({items.length})</span>
        {dirty && (
          <button style={saving ? { ...S.saveBtn, opacity: 0.6 } : S.saveBtn} onClick={saveAll} disabled={saving}>
            {saving ? <><Spin /> Salvez…</> : '💾 Salvează'}
          </button>
        )}
      </div>
      {items.map((item, i) => (
        <div key={i} style={{ padding: '10px 0', borderBottom: i < items.length - 1 ? '1px solid var(--c-border2)' : 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px', gap: 8, alignItems: 'start' }}>
            <div>
              <label style={S.inputLabel}>Produs</label>
              <input value={item.name} onChange={e => update(i, 'name', e.target.value)}
                style={{ ...S.input, ...(item._edited ? { background: 'rgba(249,115,22,0.05)', borderColor: 'rgba(249,115,22,0.4)' } : {}) }}
                placeholder="Nume produs"
              />
            </div>
            <div>
              <label style={S.inputLabel}>Cant.</label>
              <input type="number" value={item.quantity} min={1} onChange={e => update(i, 'quantity', e.target.value)}
                style={{ ...S.input, ...(item._edited ? { background: 'rgba(249,115,22,0.05)', borderColor: 'rgba(249,115,22,0.4)' } : {}) }}
              />
            </div>
            <div>
              <label style={S.inputLabel}>Preț ({order.currency})</label>
              <input type="number" value={item.price} step="0.01" onChange={e => update(i, 'price', e.target.value)}
                style={{ ...S.input, ...(item._edited ? { background: 'rgba(249,115,22,0.05)', borderColor: 'rgba(249,115,22,0.4)' } : {}) }}
              />
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            <label style={S.inputLabel}>SKU</label>
            <input value={item.sku || ''} onChange={e => update(i, 'sku', e.target.value)}
              style={{ ...S.input, fontFamily: 'monospace', fontSize: 12, ...(item._edited ? { background: 'rgba(249,115,22,0.05)', borderColor: 'rgba(249,115,22,0.4)' } : {}) }}
              placeholder="SKU produs (opțional)"
            />
          </div>
          {item._edited && (
            <div style={{ marginTop: 5, fontSize: 11, color: 'var(--c-orange)' }}>
              ✏ modificat
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* COD SECTION */
function CodSection({ order, shop, onToast, onRefresh }: {
  order: EnrichedOrder; shop: string;
  onToast: (t: 'ok' | 'err' | 'info', m: string) => void; onRefresh: () => void;
}) {
  const isCOD = order.financialStatus === 'pending';
  const [amount, setAmount]  = useState(String(order.totalPrice));
  const [saving, setSaving]  = useState(false);
  const [editing, setEditing]= useState(false);

  const saveAmount = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/connector/update-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopifyOrderId: order.id, shop, codAmount: parseFloat(amount) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Eroare salvare');
      onToast('ok', `Suma ramburs: ${amount} ${order.currency}`);
      setEditing(false); onRefresh();
    } catch (e) { onToast('err', (e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div style={S.section}>
      <div style={S.sectionHead}>💰 Ramburs (COD)</div>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: isCOD ? '#f59e0b' : '#10b981', boxShadow: `0 0 6px ${isCOD ? '#f59e0b' : '#10b981'}`, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: isCOD ? '#f59e0b' : '#10b981' }}>
            {isCOD ? 'Comandă ramburs — se colectează la livrare' : 'Comandă plătită online'}
          </span>
        </div>
        {isCOD && (
          <div>
            <div style={S.fieldLabel}>Suma de colectat</div>
            {editing ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveAmount(); if (e.key === 'Escape') setEditing(false); }}
                  style={S.inlineInput} step="0.01" autoFocus
                />
                <span style={{ fontSize: 12, color: 'var(--c-text3)', flexShrink: 0 }}>{order.currency}</span>
                <button style={S.saveBtn} onClick={saveAmount} disabled={saving}>{saving ? <Spin /> : '✓'}</button>
                <button style={S.cancelBtn} onClick={() => { setAmount(String(order.totalPrice)); setEditing(false); }}>✕</button>
              </div>
            ) : (
              <div style={S.editRow}>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace' }}>
                  {order.totalPrice.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} {order.currency}
                </span>
                <button style={S.btnEdit} onClick={() => setEditing(true)}>✏</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* AWB WIZARD */
type WizardStep = 1 | 2 | 3;
const STEP_LABELS: Record<WizardStep, string> = { 1: '👤 Date client', 2: '📦 Colet & produs', 3: '🚚 Opțiuni livrare' };

function buildDefaultWizard(order: EnrichedOrder, courier: CourierName): AwbWizardData {
  const isCOD = order.financialStatus === 'pending';
  const productName = order.lineItems.length > 0
    ? order.lineItems.map(li => li.quantity > 1 ? `${li.quantity}x ${li.name}` : li.name).join(', ')
    : 'Colet';
  return {
    recipientName:    (order.customer.name  || '').trim() || 'Client',
    recipientPhone:   (order.customer.phone || '').replace(/\D/g, '').slice(-10) || '',
    recipientEmail:   order.customer.email  || '',
    recipientAddress: ((order.address.address1 || '') + (order.address.address2 ? `, ${order.address.address2}` : '')).trim(),
    recipientCity:    (order.address.city     || '').trim(),
    recipientCounty:  (order.address.province || '').trim(),
    recipientZip:     (order.address.zip      || '').replace(/\s/g, ''),
    productName, weight: 1, parcels: 1, isCOD, codAmount: isCOD ? order.totalPrice : 0,
    courier, notifyCustomer: false, observations: '',
  };
}

function validateStep(step: WizardStep, data: AwbWizardData): string[] {
  const errs: string[] = [];
  if (step === 1) {
    if (!data.recipientName.trim()) errs.push('Numele destinatarului este obligatoriu');
    if (!data.recipientPhone.replace(/\D/g, '') || data.recipientPhone.replace(/\D/g, '').length < 9) errs.push('Telefonul trebuie să aibă minim 9 cifre');
    if (!data.recipientAddress.trim()) errs.push('Adresa este obligatorie');
    if (!data.recipientCity.trim()) errs.push('Orașul este obligatoriu');
    if (!data.recipientZip.trim()) errs.push('Codul poștal este obligatoriu');
  }
  if (step === 2) {
    if (!data.productName.trim()) errs.push('Denumirea produsului / conținutului este obligatorie');
    if (data.weight <= 0) errs.push('Greutatea trebuie să fie mai mare de 0');
    if (data.parcels < 1) errs.push('Numărul de colete trebuie să fie minim 1');
    if (data.isCOD && data.codAmount <= 0) errs.push('Suma ramburs trebuie să fie mai mare de 0');
  }
  return errs;
}

function AwbWizard({ order, initialCourier, onClose, onConfirm, loading }: {
  order: EnrichedOrder; initialCourier: CourierName;
  onClose: () => void; onConfirm: (data: AwbWizardData) => void; loading: boolean;
}) {
  const [step, setStep]     = useState<WizardStep>(1);
  const [data, setData]     = useState<AwbWizardData>(() => buildDefaultWizard(order, initialCourier));
  const [errors, setErrors] = useState<string[]>([]);

  const set = (key: keyof AwbWizardData) => (val: string) => { setData(p => ({ ...p, [key]: val })); setErrors([]); };
  const setNum = (key: keyof AwbWizardData) => (val: string) => { const n = parseFloat(val); setData(p => ({ ...p, [key]: isNaN(n) ? 0 : n })); setErrors([]); };
  const next = () => { const e = validateStep(step, data); if (e.length) { setErrors(e); return; } setErrors([]); setStep(s => (s < 3 ? (s + 1) as WizardStep : s)); };
  const prev = () => { setErrors([]); setStep(s => (s > 1 ? (s - 1) as WizardStep : s)); };

  const stepActive:  React.CSSProperties = { ...S.stepDot, background: 'var(--c-orange)', color: '#fff' };
  const stepDone:    React.CSSProperties = { ...S.stepDot, background: 'rgba(16,185,129,0.2)', color: '#10b981', border: '1px solid rgba(16,185,129,0.4)' };
  const stepPending: React.CSSProperties = { ...S.stepDot, background: 'var(--c-bg3)', color: 'var(--c-text4)', border: '1px solid var(--c-border)' };

  return (
    <>
      <div style={S.overlay} onClick={onClose} />
      <div style={{ ...S.drawer, maxWidth: 580 }}>
        <div style={S.drawerHead}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>🚚 Generare AWB — {order.name}</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2 }}>Completează datele și confirmă la pasul 3</div>
          </div>
          <button onClick={onClose} style={{ ...S.iconBtn, padding: '6px 10px' }}>✕</button>
        </div>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {([1, 2, 3] as WizardStep[]).map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < 2 ? 1 : undefined }}>
              <div style={step === s ? stepActive : step > s ? stepDone : stepPending}>{step > s ? '✓' : s}</div>
              <span style={{ fontSize: 12, fontWeight: step === s ? 700 : 400, color: step === s ? 'var(--c-text)' : 'var(--c-text3)', whiteSpace: 'nowrap' as const }}>{STEP_LABELS[s]}</span>
              {i < 2 && <div style={{ flex: 1, height: 1, background: step > s ? 'rgba(16,185,129,0.4)' : 'var(--c-border)' }} />}
            </div>
          ))}
        </div>
        {errors.length > 0 && (
          <div style={{ margin: '12px 20px 0', background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 10, padding: '10px 14px' }}>
            {errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--c-red)' }}>• {e}</div>)}
          </div>
        )}
        <div style={S.drawerBody}>
          {step === 1 && (
            <>
              <div style={S.section}>
                <div style={S.sectionHead}>👤 Informații destinatar</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                  <Field label="Nume complet *" value={data.recipientName} onChange={set('recipientName')} placeholder="Ion Popescu" />
                  <div style={S.row2col}>
                    <Field label="Telefon *" value={data.recipientPhone} onChange={set('recipientPhone')} placeholder="07xxxxxxxx" type="tel" />
                    <Field label="Email" value={data.recipientEmail} onChange={set('recipientEmail')} placeholder="client@email.com" type="email" />
                  </div>
                </div>
              </div>
              <div style={S.section}>
                <div style={S.sectionHead}>📍 Adresă livrare</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                  <Field label="Stradă + număr *" value={data.recipientAddress} onChange={set('recipientAddress')} placeholder="Str. Exemplu nr. 10" />
                  <div style={S.row2col}>
                    <Field label="Oraș *" value={data.recipientCity} onChange={set('recipientCity')} placeholder="București" />
                    <Field label="Județ" value={data.recipientCounty} onChange={set('recipientCounty')} placeholder="Ilfov" />
                  </div>
                  <Field label="Cod poștal *" value={data.recipientZip} onChange={set('recipientZip')} placeholder="077160" />
                </div>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div style={S.section}>
                <div style={S.sectionHead}>📦 Conținut colet</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                  <div>
                    <label style={S.inputLabel}>Denumire produs / conținut AWB * <span style={{ color: 'var(--c-orange)', fontStyle: 'italic' }}>(apare pe etichetă!)</span></label>
                    <input type="text" value={data.productName} onChange={e => { setData(p => ({ ...p, productName: e.target.value })); setErrors([]); }} placeholder="ex: Bluză damă albă, mărime M" style={S.input} />
                    <div style={{ fontSize: 11, color: 'var(--c-text4)', marginTop: 4 }}>ℹ Editează dacă produsul are un nume diferit față de Shopify.</div>
                  </div>
                  <div style={S.row2col}>
                    <Field label="Greutate (kg) *" value={data.weight} onChange={setNum('weight')} type="number" placeholder="1" />
                    <Field label="Nr. colete *" value={data.parcels} onChange={setNum('parcels')} type="number" placeholder="1" />
                  </div>
                </div>
              </div>
              <div style={S.section}>
                <div style={S.sectionHead}>💰 Ramburs (COD)</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                  <div style={S.codToggle} onClick={() => setData(p => ({ ...p, isCOD: !p.isCOD, codAmount: !p.isCOD ? (p.codAmount || order.totalPrice) : 0 }))}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Comandă ramburs (COD)</div>
                      <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 2 }}>Colectare numerar la livrare</div>
                    </div>
                    <Switch on={data.isCOD} onChange={v => setData(p => ({ ...p, isCOD: v, codAmount: v ? (p.codAmount || order.totalPrice) : 0 }))} />
                  </div>
                  {data.isCOD && <Field label={`Suma de colectat (${order.currency}) *`} value={data.codAmount} onChange={setNum('codAmount')} type="number" placeholder={String(order.totalPrice)} />}
                </div>
              </div>
              <div style={{ ...S.section, borderColor: 'rgba(249,115,22,0.25)', background: 'rgba(249,115,22,0.04)' }}>
                <div style={{ fontSize: 11, color: 'var(--c-text3)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 8 }}>📋 Produse din comandă</div>
                {order.lineItems.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: i < order.lineItems.length - 1 ? '1px solid var(--c-border2)' : 'none' }}>
                    <span style={{ color: 'var(--c-text2)' }}>{item.quantity}× {item.name}</span>
                    <span style={{ color: 'var(--c-text3)' }}>{item.sku ? `SKU: ${item.sku}` : ''}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <div style={S.section}>
                <div style={S.sectionHead}>🚚 Curier & opțiuni</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                  <div>
                    <label style={S.inputLabel}>Curier *</label>
                    <select value={data.courier} onChange={e => setData(p => ({ ...p, courier: e.target.value as CourierName }))} style={{ ...S.input, cursor: 'pointer' }}>
                      <option value="gls">GLS</option>
                      <option value="sameday">Sameday</option>
                    </select>
                  </div>
                  <div style={S.codToggle} onClick={() => setData(p => ({ ...p, notifyCustomer: !p.notifyCustomer }))}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Notifică clientul la expediere</div>
                      <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 2 }}>Email/SMS Shopify</div>
                    </div>
                    <Switch on={data.notifyCustomer} onChange={v => setData(p => ({ ...p, notifyCustomer: v }))} />
                  </div>
                  <div>
                    <label style={S.inputLabel}>Observații pentru curier (opțional)</label>
                    <textarea value={data.observations} onChange={e => setData(p => ({ ...p, observations: e.target.value }))} placeholder="ex: Sună înainte de livrare..." rows={3} style={{ ...S.input, resize: 'vertical' as const, fontFamily: 'inherit' }} />
                  </div>
                </div>
              </div>
              <div style={{ ...S.section, background: 'rgba(249,115,22,0.04)', borderColor: 'rgba(249,115,22,0.3)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-orange)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 12 }}>✅ Sumar AWB</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
                  <div><span style={{ color: 'var(--c-text3)' }}>Destinatar:</span> <strong>{data.recipientName}</strong></div>
                  <div><span style={{ color: 'var(--c-text3)' }}>Telefon:</span> <strong>{data.recipientPhone}</strong></div>
                  <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--c-text3)' }}>Adresă:</span> <strong>{data.recipientAddress}, {data.recipientCity} {data.recipientZip}</strong></div>
                  <div><span style={{ color: 'var(--c-text3)' }}>Conținut:</span> <strong style={{ color: 'var(--c-orange)' }}>{data.productName}</strong></div>
                  <div><span style={{ color: 'var(--c-text3)' }}>Greutate:</span> <strong>{data.weight} kg × {data.parcels} colet(e)</strong></div>
                  <div><span style={{ color: 'var(--c-text3)' }}>COD:</span> <strong>{data.isCOD ? `Da — ${data.codAmount} ${order.currency}` : 'Nu'}</strong></div>
                  <div><span style={{ color: 'var(--c-text3)' }}>Curier:</span> <strong style={{ textTransform: 'uppercase' as const }}>{data.courier}</strong></div>
                </div>
              </div>
            </>
          )}
        </div>
        <div style={S.drawerFoot}>
          <button style={S.btnGhost} onClick={step === 1 ? onClose : prev} disabled={loading}>{step === 1 ? '✕ Anulează' : '← Înapoi'}</button>
          {step < 3 ? (
            <button style={S.btnPrimary} onClick={next}>Următor →</button>
          ) : (
            <button
              style={loading ? { ...S.btnPrimary, opacity: 0.6, fontSize: 13, padding: '8px 18px' } : { ...S.btnPrimary, fontSize: 13, padding: '8px 18px', background: '#10b981' }}
              onClick={() => { const e = validateStep(3, data); if (e.length) { setErrors(e); return; } onConfirm(data); }}
              disabled={loading}
            >
              {loading ? <><Spin /> Se generează AWB…</> : '✅ Confirmă și generează AWB'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* ORDER DRAWER — tabbed with full editing */
interface AddrValidation {
  found: boolean; zipMismatch: boolean; correctZip: string | null;
  inputZip: string; streetMatched: string | null;
  scores: { street: number | null; city: number | null; county: number | null; zip: number | null } | null;
}

function OrderDrawer({ order, onClose, onOpenInvoiceModal, onShipmentWizard, actionState, shop, onAddressFixed, awbResult, onToast, onRefresh }: {
  order: EnrichedOrder; onClose: () => void;
  onOpenInvoiceModal: () => void;
  onShipmentWizard: (order: EnrichedOrder) => void;
  actionState: RowActionState; shop: string;
  onAddressFixed: (orderId: string, newZip: string) => void;
  awbResult?: { awb: string; courier: string; labelBase64?: string | null; trackUrl?: string; myglsUrl?: string; labelUrl?: string | null } | null;
  onToast: (t: 'ok' | 'err' | 'info', m: string) => void;
  onRefresh: () => void;
}) {
  const fmtPrice = (n: number, cur: string) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' ' + cur;
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<AddrValidation | null>(null);
  const [fixingZip, setFixingZip]   = useState(false);
  const [fixMsg, setFixMsg]         = useState<string | null>(null);
  const [tab, setTab]               = useState<'overview' | 'products' | 'delivery'>('overview');

  const parseStreet = (addr1: string) => {
    const m = addr1.match(/^(.*?)[\s,]+(\d+\w*)$/);
    return m ? { street: m[1].trim(), number: m[2] } : { street: addr1.trim(), number: '' };
  };

  const validateAddress = async () => {
    setValidating(true); setValidation(null); setFixMsg(null);
    try {
      const { street, number } = parseStreet(order.address.address1);
      const res = await fetch('/api/connector/validate-address', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ county: order.address.province, city: order.address.city, zip: order.address.zip, address1: street, address2: number }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setValidation(json);
    } catch (e) { setFixMsg('Eroare validare: ' + (e as Error).message); }
    finally { setValidating(false); }
  };

  const fixZip = async (newZip: string) => {
    setFixingZip(true);
    try {
      const res = await fetch('/api/connector/update-address', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopifyOrderId: order.id, zip: newZip, shop }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setFixMsg(`✓ ZIP actualizat: ${newZip}`);
      setValidation(v => v ? { ...v, zipMismatch: false, inputZip: newZip } : v);
      onAddressFixed(order.id, newZip);
    } catch (e) { setFixMsg('Eroare: ' + (e as Error).message); }
    finally { setFixingZip(false); }
  };

  const saveCustomer = async (field: string, value: string) => {
    const res = await fetch('/api/connector/update-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopifyOrderId: order.id, shop, customer: { [field]: value } }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Eroare salvare');
    onToast('ok', 'Client actualizat!');
    onRefresh();
  };

  const tabs = [
    { id: 'overview' as const, label: '📋 General' },
    { id: 'products' as const, label: '📦 Produse' },
    { id: 'delivery' as const, label: '🚚 Livrare' },
  ];

  return (
    <>
      <div style={S.overlay} onClick={onClose} />
      <div style={S.drawer}>
        <div style={S.drawerHead}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--c-orange)' }}>{order.name}</span>
              {finBadge(order.financialStatus)}
              {fulBadge(order.fulfillmentStatus)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 4 }}>
              {new Date(order.createdAt).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })}
              {' · '}<span style={{ opacity: 0.7, textTransform: 'uppercase' }}>{shop}</span>
              {' · '}<span style={{ color: 'var(--c-orange)', fontWeight: 700 }}>{fmtPrice(order.totalPrice, order.currency)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ ...S.iconBtn, padding: '6px 10px' }}>✕</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--c-border)', padding: '0 20px', background: '#0a0e17', position: 'sticky', top: 73, zIndex: 1 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'none', border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--c-orange)' : '2px solid transparent',
              color: tab === t.id ? 'var(--c-text)' : 'var(--c-text3)',
              fontWeight: tab === t.id ? 700 : 400,
              padding: '10px 14px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const, marginBottom: -1,
            }}>{t.label}</button>
          ))}
        </div>

        <div style={S.drawerBody}>
          {order.processingError && (
            <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--c-red)' }}>
              ⚠ {order.processingError}
            </div>
          )}

          {/* OVERVIEW */}
          {tab === 'overview' && (
            <>
              <div style={S.section}>
                <div style={S.sectionHead}>👤 Client</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
                  <EditableField label="Nume complet" value={order.customer.name || ''} onSave={v => saveCustomer('name', v)} placeholder="Ion Popescu" />
                  <div style={S.row2col}>
                    <EditableField label="Telefon" value={order.customer.phone || ''} onSave={v => saveCustomer('phone', v)} placeholder="07xxxxxxxx" />
                    <EditableField label="Email" value={order.customer.email || ''} onSave={v => saveCustomer('email', v)} placeholder="client@email.com" />
                  </div>
                </div>
              </div>
              <div style={S.section}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={S.sectionHead}>📍 Adresă livrare</div>
                  <button style={S.btnGhost} onClick={validateAddress} disabled={validating}>{validating ? <><Spin /> Validez…</> : '🔍 Validează'}</button>
                </div>
                <div style={S.fieldValue}>{order.address.address1}{order.address.address2 ? `, ${order.address.address2}` : ''}</div>
                <div style={{ ...S.fieldValue, marginTop: 4 }}>{order.address.city}, {order.address.province} {order.address.zip}</div>
                {validation && (
                  <div style={{ marginTop: 12 }}>
                    {validation.zipMismatch ? (
                      <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
                        <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 6 }}>
                          ⚠ ZIP incorect! <strong>{validation.inputZip}</strong> → <strong>{validation.correctZip}</strong>
                        </div>
                        {validation.scores && <div style={{ fontSize: 11, color: 'var(--c-text3)', marginBottom: 8 }}>Stradă {validation.scores.street}% · Oraș {validation.scores.city}%</div>}
                        <button style={fixingZip ? { ...S.btnPrimary, opacity: 0.6 } : S.btnPrimary}
                          onClick={() => validation.correctZip && fixZip(validation.correctZip)} disabled={fixingZip}>
                          {fixingZip ? <><Spin /> Se actualizează…</> : `✓ Setează ZIP ${validation.correctZip}`}
                        </button>
                      </div>
                    ) : (
                      <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#10b981' }}>
                        ✓ Adresă validă · ZIP {validation.inputZip} corect
                      </div>
                    )}
                  </div>
                )}
                {fixMsg && <div style={{ marginTop: 8, fontSize: 12, color: fixMsg.startsWith('✓') ? '#10b981' : 'var(--c-red)' }}>{fixMsg}</div>}
              </div>
              <CodSection order={order} shop={shop} onToast={onToast} onRefresh={onRefresh} />
              <InvoiceSection order={order} shop={shop} actionState={actionState} onOpenModal={onOpenInvoiceModal} />
            </>
          )}

          {/* PRODUCTS */}
          {tab === 'products' && (
            <ProductsSection order={order} shop={shop} onToast={onToast} onRefresh={onRefresh} />
          )}

          {/* DELIVERY */}
          {tab === 'delivery' && (
            <div style={S.section}>
              <div style={S.sectionHead}>🚚 AWB / Livrare</div>
              {(order.shipment || awbResult) ? (
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                  <div style={S.row2col}>
                    <div><div style={S.fieldLabel}>Curier</div><div style={{ ...S.fieldValue, textTransform: 'uppercase' as const, fontWeight: 700 }}>{awbResult?.courier || order.shipment?.courier}</div></div>
                    <div><div style={S.fieldLabel}>AWB</div><div style={{ ...S.fieldValue, fontFamily: 'monospace', fontWeight: 700, color: '#10b981', fontSize: 15 }}>{awbResult?.awb || order.shipment?.tracking}</div></div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                    {(awbResult?.labelUrl || order.shipment?.labelUrl) ? (
                      <a href={awbResult?.labelUrl || order.shipment?.labelUrl || undefined} target="_blank" rel="noreferrer" style={{ ...S.btnPrimary, textDecoration: 'none' }}>🖨 Descarcă etichetă PDF</a>
                    ) : awbResult?.labelBase64 ? (
                      <button style={S.btnPrimary} onClick={() => {
                        const bin = atob(awbResult.labelBase64!); const arr = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                        const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
                        const a = document.createElement('a'); a.href = url; a.download = `AWB_GLS_${awbResult.awb}.pdf`; a.click(); URL.revokeObjectURL(url);
                      }}>🖨 Descarcă etichetă PDF</button>
                    ) : null}
                    {(awbResult?.myglsUrl || order.shipment?.trackingUrl) && (
                      <a href={awbResult?.myglsUrl || order.shipment?.trackingUrl || undefined} target="_blank" rel="noreferrer" style={{ ...S.btnGhost, textDecoration: 'none' }}>🔍 Tracking</a>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                  <div style={{ fontSize: 13, color: 'var(--c-text3)' }}>Niciun AWB generat.</div>
                  <button style={actionState.shipmentLoading ? { ...S.btnPrimary, opacity: 0.6 } : S.btnPrimary}
                    onClick={() => onShipmentWizard(order)} disabled={actionState.shipmentLoading || order.cancelled}>
                    {actionState.shipmentLoading ? <><Spin /> Se generează…</> : '🚚 Generează AWB'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* SYNC BUTTON */
function SyncButton({ shop, onDone }: { shop: string; onDone: (msg: string) => void }) {
  const [syncing, setSyncing] = useState(false);
  const run = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/connector/sync-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop, limit: 50 }) });
      const json = await res.json();
      onDone(json.message || 'Sync terminat');
    } catch { onDone('Eroare sync'); }
    finally { setSyncing(false); }
  };
  return <button style={S.iconBtn} onClick={run} disabled={syncing}>{syncing ? <Spin /> : '⟳'} Sync</button>;
}

/* MAIN PAGE */
const FLAG: Record<string, string> = { RO: '🇷🇴', HU: '🇭🇺' };
type AwbResultMap = Record<string, { awb: string; courier: string; labelBase64?: string | null; trackUrl?: string; myglsUrl?: string; labelUrl?: string | null; }>;

export default function XConnectorPage() {
  const qc = useQueryClient();
  const { toasts, add: addToast } = useToast();
  const { currentShop, shops } = useShopStore();
  const activeShop = currentShop;
  const currentShopInfo = shops.find(s => s.key === activeShop);

  const [search, setSearch]       = useState('');
  const [finFilter, setFinFilter] = useState('all');
  const [dateFrom, setDateFrom]   = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [cursor, setCursor]       = useState<string | null>(null);
  const [prevCursors, setPrev]    = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebounced] = useState('');

  useEffect(() => { clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => { setDebounced(search); setCursor(null); }, 400); }, [search]);
  useEffect(() => { setCursor(null); setPrev([]); }, [activeShop]);

  const [autoInvoice, setAutoInvoice] = useState(false);
  const [autoInvLoading, setAutoInvLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/connector/settings?shop=${activeShop}`).then(r => r.json()).then(d => setAutoInvoice(Boolean(d.autoInvoice))).catch(() => {});
  }, [activeShop]);

  const toggleAutoInvoice = async () => {
    const next = !autoInvoice;
    setAutoInvoice(next); setAutoInvLoading(true);
    const t = setTimeout(() => setAutoInvLoading(false), 6000);
    try {
      const res = await fetch('/api/connector/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop: activeShop, autoInvoice: next }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) { setAutoInvoice(!next); addToast('err', json.error || 'Nu s-a putut salva setarea'); }
      else addToast('ok', next ? '🧾 Facturare automată ACTIVATĂ' : '⏸ Facturare automată DEZACTIVATĂ');
    } catch { setAutoInvoice(!next); addToast('err', 'Eroare rețea'); }
    finally { clearTimeout(t); setAutoInvLoading(false); }
  };

  const queryKey = ['connector-orders', activeShop, debouncedSearch, finFilter, dateFrom, cursor];
  const { data, isLoading, isError, error, refetch } = useQuery<OrdersResponse>({
    queryKey,
    queryFn: async () => {
      const p = new URLSearchParams({ shop: activeShop, search: debouncedSearch, fin: finFilter, from: dateFrom, ...(cursor ? { cursor } : {}) });
      const res = await fetch(`/api/connector/orders?${p}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Eroare server'); }
      return res.json();
    },
    placeholderData: prev => prev,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll = () => { if (!data) return; setSelected(prev => prev.size === data.orders.length ? new Set() : new Set(data.orders.map(o => o.id))); };

  const [drawerOrder, setDrawerOrder] = useState<EnrichedOrder | null>(null);
  const [wizardOrder, setWizardOrder] = useState<EnrichedOrder | null>(null);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [invoiceModalOrder, setInvoiceModalOrder] = useState<EnrichedOrder | null>(null);
  const [invoiceResult, setInvoiceResult] = useState<{ series: string; number: string; downloadUrl: string; collected: boolean } | null>(null);

  const [awbResults, setAwbResultsRaw] = useState<AwbResultMap>(() => {
    try { const s = typeof window !== 'undefined' ? localStorage.getItem('xc_awb_results') : null; return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const setAwbResults = useCallback((updater: AwbResultMap | ((prev: AwbResultMap) => AwbResultMap)) => {
    setAwbResultsRaw((prev: AwbResultMap) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('xc_awb_results', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const [actionStates, setActionStates] = useState<Record<string, RowActionState>>({});
  const getState = (id: string): RowActionState => actionStates[id] ?? { invoiceLoading: false, shipmentLoading: false, error: null };
  const setAS = (id: string, patch: Partial<RowActionState>) => setActionStates(p => ({ ...p, [id]: { ...getState(id), ...patch } }));

  const invoiceMut = useMutation({
    mutationFn: async ({ shopifyOrderId, withCollection, useStock, overrides }: {
      shopifyOrderId: string; withCollection: boolean; useStock?: boolean;
      overrides?: { customer: { name: string; phone: string; email: string }; address: { address1: string; city: string; zip: string; province: string }; lineItems: { name: string; sku: string; quantity: number; price: number }[] };
    }) => {
      setAS(shopifyOrderId, { invoiceLoading: true, error: null });
      // First save overrides to Shopify if provided
      if (overrides) {
        await fetch('/api/connector/update-order', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shopifyOrderId, shop: activeShop, customer: overrides.customer, address: overrides.address, lineItems: overrides.lineItems }),
        });
      }
      const res = await fetch('/api/connector/invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopifyOrderId, shop: activeShop, withCollection, useStock }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Eroare generare factură');
      return { ...json, shopifyOrderId };
    },
    onSuccess: (data) => {
      setAS(data.shopifyOrderId, { invoiceLoading: false });
      addToast('ok', `Factură ${data.series}${data.number} generată!`);
      setInvoiceResult({ series: data.series, number: data.number, downloadUrl: data.downloadUrl, collected: data.collected });
      qc.invalidateQueries({ queryKey: ['connector-orders', activeShop] });
    },
    onError: (err: Error, { shopifyOrderId }) => { setAS(shopifyOrderId, { invoiceLoading: false, error: err.message }); addToast('err', err.message); },
  });

  const handleInvoiceGenerate = (opts: { shopifyOrderId: string; withCollection: boolean; useStock: boolean; overrides: { customer: { name: string; phone: string; email: string }; address: { address1: string; city: string; zip: string; province: string }; lineItems: { name: string; sku: string; quantity: number; price: number }[] } }) => {
    invoiceMut.mutate(opts);
  };

  // Quick generate from table row (no modal)
  const handleQuickInvoice = (shopifyOrderId: string, withCollection: boolean) => invoiceMut.mutate({ shopifyOrderId, withCollection });

  const handleWizardConfirm = async (wizData: AwbWizardData) => {
    if (!wizardOrder) return;
    const order = wizardOrder;
    const orderId = order.id;
    setWizardLoading(true);
    setAS(orderId, { shipmentLoading: true, error: null });
    try {
      if (wizData.courier === 'gls') {
        const body = {
          username: '', password: '', clientNumber: '',
          recipientName: (wizData.recipientName || '').trim() || 'Client',
          phone: (wizData.recipientPhone || '').replace(/\D/g, '').slice(-10) || '0700000000',
          email: wizData.recipientEmail || '',
          address: (wizData.recipientAddress || '').trim(),
          city: (wizData.recipientCity || '').trim(),
          county: (wizData.recipientCounty || '').trim(),
          zip: (wizData.recipientZip || '').replace(/\s/g, ''),
          weight: parseFloat(String(wizData.weight)) || 1,
          parcels: parseInt(String(wizData.parcels)) || 1,
          content: (wizData.productName || order.name || 'Colet').slice(0, 100),
          codAmount: wizData.isCOD ? wizData.codAmount : 0,
          codCurrency: 'RON', orderName: order.name, orderId, selectedServices: {},
        };
        const res = await fetch('/api/gls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.ok) {
          const awbData = { awb: data.awb, courier: 'gls', labelBase64: data.labelBase64 || null, trackUrl: data.trackUrl || `https://gls-group.eu/RO/ro/urmarire-colet?match=${data.awb}`, myglsUrl: data.myglsUrl || `https://mygls.ro/Parcel/Detail/${data.awb}`, labelUrl: null as string | null };
          try {
            const sr = await fetch('/api/connector/save-awb', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopifyOrderId: orderId, shop: activeShop, courier: 'gls', trackingNumber: data.awb, trackingUrl: data.trackUrl, labelBase64: data.labelBase64 || null }) });
            const sd = await sr.json();
            if (sd.ok && sd.labelUrl) awbData.labelUrl = sd.labelUrl;
          } catch {}
          setAwbResults(p => ({ ...p, [orderId]: awbData }));
          setAS(orderId, { shipmentLoading: false }); setWizardOrder(null); setWizardLoading(false);
          addToast('ok', `✅ AWB GLS ${data.awb} generat!`);
          qc.invalidateQueries({ queryKey: ['connector-orders', activeShop] });
          if (data.labelBase64) {
            try {
              const bin = atob(data.labelBase64); const arr = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
              const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
              const a = document.createElement('a'); a.href = url; a.download = `AWB_GLS_${data.awb}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch {}
          }
        } else { throw new Error(data.error || 'Eroare GLS'); }
      } else {
        const body = {
          username: '', password: '', recipientName: wizData.recipientName, phone: wizData.recipientPhone,
          email: wizData.recipientEmail || '', address: wizData.recipientAddress, city: wizData.recipientCity,
          county: wizData.recipientCounty, zip: (wizData.recipientZip || '').replace(/\s/g, ''),
          weight: parseFloat(String(wizData.weight)) || 1, parcels: parseInt(String(wizData.parcels)) || 1,
          content: (wizData.productName || order.name || 'Colet').slice(0, 100),
          isCOD: wizData.isCOD, total: wizData.codAmount, orderName: order.name, orderId, observations: wizData.observations || '',
        };
        const res = await fetch('/api/sameday-awb', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.ok) {
          setAwbResults(p => ({ ...p, [orderId]: { awb: data.awb, courier: 'sameday' } }));
          setAS(orderId, { shipmentLoading: false }); setWizardOrder(null); setWizardLoading(false);
          addToast('ok', `AWB Sameday ${data.awb} generat!`);
          qc.invalidateQueries({ queryKey: ['connector-orders', activeShop] });
        } else { throw new Error(data.error || 'Eroare Sameday'); }
      }
    } catch (err) {
      const msg = (err as Error).message;
      setAS(orderId, { shipmentLoading: false, error: msg }); addToast('err', msg); setWizardLoading(false);
    }
  };

  const [bulkLoading, setBulkLoading] = useState(false);
  const bulkInvoice = async () => {
    setBulkLoading(true); addToast('info', `Generez facturi pentru ${selected.size} comenzi…`);
    let ok = 0, fail = 0;
    for (const id of Array.from(selected)) {
      try { await invoiceMut.mutateAsync({ shopifyOrderId: id, withCollection: false }); ok++; } catch { fail++; }
    }
    setBulkLoading(false); addToast(fail === 0 ? 'ok' : 'err', `${ok} facturi generate${fail ? `, ${fail} erori` : ''}`); setSelected(new Set());
  };

  const orders   = data?.orders ?? [];
  const statPaid = orders.filter(o => o.financialStatus === 'paid').length;
  const statCOD  = orders.filter(o => o.financialStatus === 'pending').length;
  const statInv  = orders.filter(o => o.invoice || o.noteAttributes?.['xconnector-invoice-url'] || o.noteAttributes?.['invoice-url']).length;
  const statShip = orders.filter(o => o.shipment).length;
  const statFail = orders.filter(o => o.processingStatus === 'failed').length;

  const fmtPrice = (n: number, cur: string) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' ' + cur;
  const fmtDate  = (s: string) => new Date(s).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' });

  const getInvoiceLink = (order: EnrichedOrder): { label: string; url: string } | null => {
    if (order.invoice) return { label: `${order.invoice.series}${order.invoice.number}`, url: order.invoice.url };
    const attrs = order.noteAttributes ?? {};
    const url = attrs['xconnector-invoice-url'] || attrs['invoice-url'] || attrs['xconnector-invoice-short-url'] || '';
    if (!url) return null;
    try {
      const u = new URL(attrs['xconnector-invoice-url'] || '');
      const s = u.searchParams.get('s') || ''; const n = u.searchParams.get('n') || '';
      return { label: (s && n) ? `${s}${n}` : (attrs['invoice-number'] || 'Factură'), url };
    } catch { return { label: attrs['invoice-number'] || 'Factură', url }; }
  };

  return (
    <div style={S.page}>
      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:none} }
        tr:hover td { background: rgba(255,255,255,0.015) !important; }
        select option { background: var(--c-bg2); }
      `}</style>

      {/* TOP BAR */}
      <div style={S.topbar}>
        <div style={S.topbarRow1}>
          <h1 style={S.h1}>
            <span style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>⚡ xConnector</span>
          </h1>
          {currentShopInfo && (
            <div style={S.shopBadge}><span>{FLAG[currentShopInfo.flag?.toUpperCase()] ?? '🌐'}</span><span>{currentShopInfo.label}</span></div>
          )}
          <div style={S.searchWrap}>
            <span style={S.searchIcon}>🔍</span>
            <input style={S.searchInput} placeholder="Caută comandă, client, telefon…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select value={finFilter} onChange={e => { setFinFilter(e.target.value); setCursor(null); }} style={S.select}>
            <option value="all">Toate</option>
            <option value="paid">💳 Plătit</option>
            <option value="pending">💰 Ramburs</option>
            <option value="refunded">↩ Returnat</option>
          </select>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setCursor(null); }} style={S.select} />
          <button style={S.iconBtn} onClick={() => refetch()}>{isLoading ? <Spin /> : '↻'} Refresh</button>
          <SyncButton shop={activeShop} onDone={() => { addToast('ok', 'Sync trimis! Refresh în 30s.'); setTimeout(() => refetch(), 30000); }} />
          <button
            style={autoInvLoading ? { ...S.toggleOff, opacity: 0.6, cursor: 'not-allowed' } : autoInvoice ? S.toggleOn : S.toggleOff}
            onClick={toggleAutoInvoice} disabled={autoInvLoading}
          >
            {autoInvLoading ? <><Spin /> Factură auto…</> : autoInvoice
              ? <>🧾 <span style={{ width: 28, height: 16, background: '#10b981', borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 3px', flexShrink: 0 }}><span style={{ width: 10, height: 10, background: '#fff', borderRadius: '50%' }} /></span> Factură auto</>
              : <>🧾 <span style={{ width: 28, height: 16, background: 'var(--c-border)', borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', padding: '0 3px', flexShrink: 0 }}><span style={{ width: 10, height: 10, background: '#fff', borderRadius: '50%' }} /></span> Factură auto</>
            }
          </button>
        </div>
      </div>

      {/* STATS */}
      <div style={S.statsBar}>
        <div style={S.statCard}><div style={S.statLabel}>Total comenzi</div><div style={S.statValue}>{orders.length}</div></div>
        <div style={S.statCard}><div style={S.statLabel}>💳 Plătite</div><div style={{ ...S.statValue, color: 'var(--c-green)' }}>{statPaid}</div></div>
        <div style={S.statCard}><div style={S.statLabel}>💰 Ramburs</div><div style={{ ...S.statValue, color: '#f59e0b' }}>{statCOD}</div></div>
        <div style={S.statCard}><div style={S.statLabel}>🧾 Facturate</div><div style={{ ...S.statValue, color: 'var(--c-blue)' }}>{statInv}</div></div>
        <div style={S.statCard}><div style={S.statLabel}>🚚 AWB generat</div><div style={{ ...S.statValue, color: 'var(--c-orange)' }}>{statShip}</div></div>
        {statFail > 0 && <div style={S.statCard}><div style={S.statLabel}>⚠ Erori</div><div style={{ ...S.statValue, color: 'var(--c-red)' }}>{statFail}</div></div>}
      </div>

      {/* BULK BAR */}
      {selected.size > 0 && (
        <div style={S.bulkBar}>
          <span style={S.bulkLabel}>✓ {selected.size} selectate</span>
          <button style={S.btnPrimary} onClick={bulkInvoice} disabled={bulkLoading}>{bulkLoading ? <Spin /> : '🧾'} Generează facturi</button>
          <button style={S.btnDisabled} onClick={() => setSelected(new Set())}>✕ Deselectează</button>
        </div>
      )}

      {/* ERROR */}
      {isError && (
        <div style={{ margin: '0 20px 10px', background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 12, padding: '12px 16px', color: 'var(--c-red)', fontSize: 13 }}>
          ⚠ {(error as Error).message} — <button onClick={() => refetch()} style={{ color: 'var(--c-red)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}

      {/* TABLE */}
      <div style={{ overflowX: 'auto' as const, padding: '0 20px' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}><input type="checkbox" style={S.checkbox} onChange={toggleAll} checked={selected.size > 0 && selected.size === orders.length} /></th>
              <th style={S.th}>Comandă</th>
              <th style={S.th}>Client</th>
              <th style={S.th}>Localitate</th>
              <th style={S.th}>Total</th>
              <th style={S.th}>Plată</th>
              <th style={S.th}>Fulfillment</th>
              <th style={S.th}>Factură</th>
              <th style={S.th}>AWB</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Edit</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? <Skeleton rows={8} /> : orders.length === 0 ? (
              <tr><td colSpan={11} style={S.empty}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                <div>Nicio comandă găsită</div>
                <div style={{ fontSize: 12, marginTop: 6, color: 'var(--c-text4)' }}>Schimbă filtrele sau verifică conexiunea Shopify</div>
              </td></tr>
            ) : orders.map(order => {
              const as = getState(order.id);
              const invLink = getInvoiceLink(order);
              const awbRes  = awbResults[order.id];
              const existingAwb = order.shipment?.tracking || awbRes?.awb;
              const labelUrl = awbRes?.labelUrl || order.shipment?.labelUrl || null;
              return (
                <tr key={order.id} style={{ cursor: 'pointer', animation: 'fadeIn 0.2s ease' }}>
                  <td style={S.td} onClick={e => e.stopPropagation()}><input type="checkbox" style={S.checkbox} checked={selected.has(order.id)} onChange={() => toggleSelect(order.id)} /></td>
                  <td style={S.td} onClick={() => setDrawerOrder(order)}>
                    <div style={{ fontWeight: 700, color: 'var(--c-orange)' }}>{order.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>{fmtDate(order.createdAt)}</div>
                  </td>
                  <td style={S.td} onClick={() => setDrawerOrder(order)}>
                    <div style={{ fontWeight: 500 }}>{order.customer.name || <span style={{ color: 'var(--c-text4)' }}>—</span>}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)', fontFamily: 'monospace' }}>{order.customer.phone}</div>
                  </td>
                  <td style={S.td} onClick={() => setDrawerOrder(order)}>
                    <div>{order.address.city || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)', fontFamily: 'monospace' }}>{order.address.zip}</div>
                  </td>
                  <td style={S.td} onClick={() => setDrawerOrder(order)}>
                    <div style={{ fontWeight: 700, color: order.financialStatus === 'pending' ? '#f59e0b' : 'var(--c-text)' }}>{fmtPrice(order.totalPrice, order.currency)}</div>
                  </td>
                  <td style={S.td} onClick={() => setDrawerOrder(order)}>{finBadge(order.financialStatus)}</td>
                  <td style={S.td} onClick={() => setDrawerOrder(order)}>{fulBadge(order.fulfillmentStatus)}</td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    {invLink ? (
                      <a href={invLink.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ ...S.btnGhost, textDecoration: 'none', fontSize: 11 }} title={invLink.url}>📥 {invLink.label}</a>
                    ) : (
                      <button style={as.invoiceLoading ? { ...S.btnPrimary, opacity: 0.6, fontSize: 11 } : { ...S.btnPrimary, fontSize: 11 }}
                        disabled={as.invoiceLoading || order.cancelled}
                        onClick={e => { e.stopPropagation(); setInvoiceModalOrder(order); setInvoiceResult(null); }}>
                        {as.invoiceLoading ? <Spin /> : '🧾'} {order.financialStatus === 'pending' ? 'Gen+Inc' : 'Factură'}
                      </button>
                    )}
                  </td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    {existingAwb ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#10b981', fontWeight: 700 }}>{existingAwb}</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                          {labelUrl ? (
                            <a href={labelUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ ...S.btnPrimary, textDecoration: 'none', fontSize: 10, padding: '3px 7px' }}>🖨 PDF</a>
                          ) : awbRes?.labelBase64 ? (
                            <button style={{ ...S.btnPrimary, fontSize: 10, padding: '3px 7px' }} onClick={e => {
                              e.stopPropagation();
                              const bin = atob(awbRes.labelBase64!); const arr = new Uint8Array(bin.length);
                              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                              const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
                              const a = document.createElement('a'); a.href = url; a.download = `AWB_GLS_${existingAwb}.pdf`; a.click(); URL.revokeObjectURL(url);
                            }}>🖨 PDF</button>
                          ) : null}
                          {(awbRes?.myglsUrl || order.shipment?.trackingUrl) && (
                            <a href={awbRes?.myglsUrl || order.shipment?.trackingUrl || undefined} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ ...S.btnGhost, textDecoration: 'none', fontSize: 10, padding: '3px 7px' }}>🔍 Track</a>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button style={as.shipmentLoading ? { ...S.btnGhost, opacity: 0.6, fontSize: 11 } : { ...S.btnGhost, fontSize: 11 }}
                        disabled={as.shipmentLoading || order.cancelled}
                        onClick={e => { e.stopPropagation(); setWizardOrder(order); }}>
                        {as.shipmentLoading ? <Spin /> : '🚚'} AWB
                      </button>
                    )}
                  </td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    <div style={S.actionsCell}>
                      {procBadge(order.processingStatus)}
                      {as.error && <button title={as.error} style={S.btnDanger} onClick={e => { e.stopPropagation(); setAS(order.id, { error: null }); }}>⚠</button>}
                    </div>
                  </td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    <button style={S.btnEdit} onClick={e => { e.stopPropagation(); setDrawerOrder(order); }} title="Editează comanda">✏ Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PAGINATION */}
      {data && (
        <div style={{ display: 'flex', gap: 10, padding: '14px 20px', justifyContent: 'center' }}>
          {prevCursors.length > 0 && <button style={S.iconBtn} onClick={() => { const prev = [...prevCursors]; const c = prev.pop() ?? null; setPrev(prev); setCursor(c); }}>← Anterior</button>}
          {data.pageInfo.hasNextPage && <button style={S.iconBtn} onClick={() => { setPrev(p => [...p, cursor ?? '']); setCursor(data.pageInfo.endCursor); }}>Următor →</button>}
        </div>
      )}

      {/* ORDER DRAWER */}
      {drawerOrder && !wizardOrder && (
        <OrderDrawer
          order={drawerOrder} onClose={() => setDrawerOrder(null)}
          onOpenInvoiceModal={() => { setInvoiceModalOrder(drawerOrder); setInvoiceResult(null); }}
          onShipmentWizard={order => { setWizardOrder(order); }}
          actionState={getState(drawerOrder.id)} shop={activeShop}
          awbResult={awbResults[drawerOrder.id] || null}
          onAddressFixed={(orderId, newZip) => { addToast('ok', `ZIP ${newZip} actualizat`); qc.invalidateQueries({ queryKey: ['connector-orders', activeShop] }); }}
          onToast={addToast} onRefresh={() => qc.invalidateQueries({ queryKey: ['connector-orders', activeShop] })}
        />
      )}

      {/* INVOICE MODAL */}
      {invoiceModalOrder && (
        <InvoiceModal
          order={invoiceModalOrder}
          shop={activeShop}
          actionState={getState(invoiceModalOrder.id)}
          onClose={() => { setInvoiceModalOrder(null); setInvoiceResult(null); }}
          onGenerate={handleInvoiceGenerate}
          generatedInvoice={invoiceResult}
        />
      )}

      {/* AWB WIZARD */}
      {wizardOrder && (
        <AwbWizard order={wizardOrder} initialCourier="gls"
          onClose={() => { setWizardOrder(null); setWizardLoading(false); }}
          onConfirm={handleWizardConfirm} loading={wizardLoading}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
