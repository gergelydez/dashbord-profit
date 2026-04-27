'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useShopStore } from '@/lib/store/shop-store';
import type {
  EnrichedOrder, OrdersResponse, RowActionState,
  ProcessingStatus, CourierName, AwbWizardData,
} from './types';

/* ═══════════════════════════════════════════════════════════
   STYLES
═══════════════════════════════════════════════════════════ */
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
  overlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9998, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  drawer:      { position: 'fixed' as const, left: 0, right: 0, bottom: 0, width: '100%', maxWidth: 600, margin: '0 auto', maxHeight: '90dvh', background: '#0c1018', borderTop: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px 16px 0 0', zIndex: 9999, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const },
  drawerHead:  { padding: '16px 20px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky' as const, top: 0, background: '#0c1018', zIndex: 1 },
  drawerBody:  { padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 18 },
  drawerFoot:  { padding: '12px 20px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', gap: 10, background: '#0c1018', position: 'sticky' as const, bottom: 0, zIndex: 2 },
  section:     { background: 'var(--c-bg3)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '14px 16px' },
  sectionHead: { fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 12 },
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
};

/* ═══════════════════════════════════════════════════════════
   BADGE
═══════════════════════════════════════════════════════════ */
function Badge({ label, color }: { label: string; color: 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'orange' }) {
  const colors: Record<string, React.CSSProperties> = {
    green:  { background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)' },
    yellow: { background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' },
    red:    { background: 'rgba(244,63,94,0.12)',  color: '#f43f5e', border: '1px solid rgba(244,63,94,0.25)' },
    blue:   { background: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.25)' },
    gray:   { background: 'rgba(100,116,139,0.12)', color: '#94a3b8', border: '1px solid rgba(100,116,139,0.2)' },
    orange: { background: 'rgba(249,115,22,0.12)', color: '#f97316', border: '1px solid rgba(249,115,22,0.25)' },
  };
  return (
    <span style={{ ...colors[color], borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
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

/* ═══════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════ */
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
          {Array.from({ length: 10 }).map((_, j) => (
            <td key={j} style={S.td}>
              <div style={{ height: 13, background: 'var(--c-surface2)', borderRadius: 6, animation: 'pulse 1.4s ease-in-out infinite', width: j === 0 ? 20 : j === 1 ? 60 : '80%' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   INPUT FIELD helper
═══════════════════════════════════════════════════════════ */
function Field({
  label, value, onChange, type = 'text', placeholder, disabled,
}: {
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label style={S.inputLabel}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ ...S.input, ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   INVOICE SECTION — handles both DB invoices and xconnector
   note_attributes (xconnector-invoice-url etc.)
═══════════════════════════════════════════════════════════ */
function InvoiceSection({
  order, actionState, onInvoice,
}: {
  order: EnrichedOrder;
  actionState: RowActionState;
  onInvoice: (id: string) => void;
}) {
  // Extract from DB invoice first
  if (order.invoice) {
    return (
      <div style={S.section}>
        <div style={S.sectionHead}>🧾 Factură</div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          <div style={S.row2col}>
            <div><div style={S.fieldLabel}>Serie/Număr</div><div style={{ ...S.fieldValue, fontWeight: 700, color: '#f97316', fontFamily: 'monospace' }}>{order.invoice.series}{order.invoice.number}</div></div>
            <div><div style={S.fieldLabel}>Status</div><div><Badge label={order.invoice.status} color="green" /></div></div>
          </div>
          <InvoiceDownloadBtn url={order.invoice.url} />
        </div>
      </div>
    );
  }

  // Extract from Shopify note_attributes (xconnector-invoice-url etc.)
  const attrs = order.noteAttributes ?? {};
  const xcInvUrl      = attrs['xconnector-invoice-url'] || attrs['invoice-url'] || '';
  const xcInvShortUrl = attrs['xconnector-invoice-short-url'] || '';
  const finalUrl      = xcInvUrl || xcInvShortUrl;

  // Extrage GLA2628 din URL: ?s=GLA&n=2628
  const extractNum = (url: string): string => {
    try {
      const u = new URL(url);
      const s = u.searchParams.get('s') || '';
      const n = u.searchParams.get('n') || '';
      if (s && n) return `${s}${n}`;
      if (n) return n;
    } catch {}
    return attrs['invoice-number'] || attrs['Factură'] || 'Factură';
  };

  if (finalUrl) {
    return (
      <div style={S.section}>
        <div style={S.sectionHead}>🧾 Factură</div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          <div style={S.row2col}>
            <div><div style={S.fieldLabel}>Număr</div><div style={{ ...S.fieldValue, fontWeight: 700, color: '#f97316', fontFamily: 'monospace' }}>{extractNum(xcInvUrl)}</div></div>
            <div><div style={S.fieldLabel}>Status</div><div><Badge label="generată" color="green" /></div></div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
            <a href={finalUrl} target="_blank" rel="noreferrer" style={{ ...S.btnPrimary, textDecoration: 'none' }}>
              📥 Descarcă PDF
            </a>
            {xcInvShortUrl && xcInvShortUrl !== xcInvUrl && (
              <a href={xcInvShortUrl} target="_blank" rel="noreferrer" style={{ ...S.btnGhost, textDecoration: 'none' }}>
                🔗 Link scurt
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // No invoice anywhere — show generate button
  return (
    <div style={S.section}>
      <div style={S.sectionHead}>🧾 Factură</div>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--c-text3)' }}>Nicio factură generată.</div>
        <button
          style={actionState.invoiceLoading ? { ...S.btnPrimary, opacity: 0.6 } : S.btnPrimary}
          onClick={() => onInvoice(order.id)}
          disabled={actionState.invoiceLoading || order.cancelled}
        >
          {actionState.invoiceLoading ? <><Spin /> Se generează…</> : '🧾 Generează factură'}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AWB WIZARD — multi-step modal
═══════════════════════════════════════════════════════════ */
type WizardStep = 1 | 2 | 3;

const STEP_LABELS: Record<WizardStep, string> = {
  1: '👤 Date client',
  2: '📦 Colet & produs',
  3: '🚚 Opțiuni livrare',
};

function buildDefaultWizard(order: EnrichedOrder, courier: CourierName): AwbWizardData {
  // Determine COD: order is COD if financialStatus is 'pending' (ramburs)
  const isCOD = order.financialStatus === 'pending';
  // Product name: first line item name or fallback
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
    productName,
    weight:           1,
    parcels:          1,
    isCOD,
    codAmount:        isCOD ? order.totalPrice : 0,
    courier,
    notifyCustomer:   false,
    observations:     '',
  };
}

function validateStep(step: WizardStep, data: AwbWizardData): string[] {
  const errs: string[] = [];
  if (step === 1) {
    if (!data.recipientName.trim())    errs.push('Numele destinatarului este obligatoriu');
    if (!data.recipientPhone.replace(/\D/g, '') || data.recipientPhone.replace(/\D/g, '').length < 9)
      errs.push('Telefonul trebuie să aibă minim 9 cifre');
    if (!data.recipientAddress.trim()) errs.push('Adresa este obligatorie');
    if (!data.recipientCity.trim())    errs.push('Orașul este obligatoriu');
    if (!data.recipientZip.trim())     errs.push('Codul poștal este obligatoriu');
  }
  if (step === 2) {
    if (!data.productName.trim())      errs.push('Denumirea produsului / conținutului este obligatorie');
    if (data.weight <= 0)              errs.push('Greutatea trebuie să fie mai mare de 0');
    if (data.parcels < 1)              errs.push('Numărul de colete trebuie să fie minim 1');
    if (data.isCOD && data.codAmount <= 0) errs.push('Suma ramburs trebuie să fie mai mare de 0');
  }
  return errs;
}

function AwbWizard({
  order,
  initialCourier,
  onClose,
  onConfirm,
  loading,
}: {
  order:         EnrichedOrder;
  initialCourier: CourierName;
  onClose:       () => void;
  onConfirm:     (data: AwbWizardData) => void;
  loading:       boolean;
}) {
  const [step, setStep]   = useState<WizardStep>(1);
  const [data, setData]   = useState<AwbWizardData>(() => buildDefaultWizard(order, initialCourier));
  const [errors, setErrors] = useState<string[]>([]);

  const set = (key: keyof AwbWizardData) => (val: string) => {
    setData(p => ({ ...p, [key]: val }));
    setErrors([]);
  };
  const setNum = (key: keyof AwbWizardData) => (val: string) => {
    const n = parseFloat(val);
    setData(p => ({ ...p, [key]: isNaN(n) ? 0 : n }));
    setErrors([]);
  };

  const next = () => {
    const errs = validateStep(step, data);
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    setStep(s => (s < 3 ? (s + 1) as WizardStep : s));
  };
  const prev = () => { setErrors([]); setStep(s => (s > 1 ? (s - 1) as WizardStep : s)); };

  const stepActive: React.CSSProperties  = { ...S.stepDot, background: 'var(--c-orange)', color: '#fff' };
  const stepDone: React.CSSProperties    = { ...S.stepDot, background: 'rgba(16,185,129,0.2)', color: '#10b981', border: '1px solid rgba(16,185,129,0.4)' };
  const stepPending: React.CSSProperties = { ...S.stepDot, background: 'var(--c-bg3)', color: 'var(--c-text4)', border: '1px solid var(--c-border)' };

  return (
    <>
      <div style={S.overlay} onClick={onClose} />
      <div style={{ ...S.drawer, maxWidth: 580 }}>
        {/* Head */}
        <div style={S.drawerHead}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>🚚 Generare AWB — {order.name}</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2 }}>Completează datele și confirmă la pasul 3</div>
          </div>
          <button onClick={onClose} style={{ ...S.iconBtn, padding: '6px 10px' }}>✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {([1, 2, 3] as WizardStep[]).map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < 2 ? 1 : undefined }}>
              <div style={step === s ? stepActive : step > s ? stepDone : stepPending}>
                {step > s ? '✓' : s}
              </div>
              <span style={{ fontSize: 12, fontWeight: step === s ? 700 : 400, color: step === s ? 'var(--c-text)' : 'var(--c-text3)', whiteSpace: 'nowrap' as const }}>
                {STEP_LABELS[s]}
              </span>
              {i < 2 && <div style={{ flex: 1, height: 1, background: step > s ? 'rgba(16,185,129,0.4)' : 'var(--c-border)' }} />}
            </div>
          ))}
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div style={{ margin: '12px 20px 0', background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 10, padding: '10px 14px' }}>
            {errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--c-red)' }}>• {e}</div>)}
          </div>
        )}

        {/* Step content */}
        <div style={S.drawerBody}>

          {/* ── Step 1: Client ── */}
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

          {/* ── Step 2: Parcel ── */}
          {step === 2 && (
            <>
              <div style={S.section}>
                <div style={S.sectionHead}>📦 Conținut colet</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                  <div>
                    <label style={S.inputLabel}>Denumire produs / conținut AWB * <span style={{ color: 'var(--c-orange)', fontStyle: 'italic' }}>(apare pe etichetă!)</span></label>
                    <input
                      type="text"
                      value={data.productName}
                      onChange={e => { setData(p => ({ ...p, productName: e.target.value })); setErrors([]); }}
                      placeholder="ex: Bluză damă albă, mărime M"
                      style={S.input}
                    />
                    <div style={{ fontSize: 11, color: 'var(--c-text4)', marginTop: 4 }}>
                      ℹ Acest text va apărea pe AWB la câmpul „Conținut". Editează dacă produsul are un nume diferit față de Shopify.
                    </div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      id="isCOD"
                      checked={data.isCOD}
                      onChange={e => setData(p => ({ ...p, isCOD: e.target.checked, codAmount: e.target.checked ? p.codAmount || order.totalPrice : 0 }))}
                      style={{ width: 16, height: 16, accentColor: 'var(--c-orange)', cursor: 'pointer' }}
                    />
                    <label htmlFor="isCOD" style={{ fontSize: 13, cursor: 'pointer' }}>
                      Comandă ramburs (COD) — colectare numerar la livrare
                    </label>
                  </div>
                  {data.isCOD && (
                    <Field
                      label={`Suma de colectat (${order.currency}) *`}
                      value={data.codAmount}
                      onChange={setNum('codAmount')}
                      type="number"
                      placeholder={String(order.totalPrice)}
                    />
                  )}
                </div>
              </div>
              {/* Products summary for reference */}
              <div style={{ ...S.section, borderColor: 'rgba(249,115,22,0.25)', background: 'rgba(249,115,22,0.04)' }}>
                <div style={{ fontSize: 11, color: 'var(--c-text3)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 8 }}>
                  📋 Produse din comandă (referință)
                </div>
                {order.lineItems.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: i < order.lineItems.length - 1 ? '1px solid var(--c-border2)' : 'none' }}>
                    <span style={{ color: 'var(--c-text2)' }}>{item.quantity}× {item.name}</span>
                    <span style={{ color: 'var(--c-text3)' }}>{item.sku ? `SKU: ${item.sku}` : ''}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Step 3: Options + Confirm ── */}
          {step === 3 && (
            <>
              <div style={S.section}>
                <div style={S.sectionHead}>🚚 Curier & opțiuni</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                  <div>
                    <label style={S.inputLabel}>Curier *</label>
                    <select
                      value={data.courier}
                      onChange={e => setData(p => ({ ...p, courier: e.target.value as CourierName }))}
                      style={{ ...S.input, cursor: 'pointer' }}
                    >
                      <option value="gls">GLS</option>
                      <option value="sameday">Sameday</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      id="notifyCustomer"
                      checked={data.notifyCustomer}
                      onChange={e => setData(p => ({ ...p, notifyCustomer: e.target.checked }))}
                      style={{ width: 16, height: 16, accentColor: 'var(--c-orange)', cursor: 'pointer' }}
                    />
                    <label htmlFor="notifyCustomer" style={{ fontSize: 13, cursor: 'pointer' }}>
                      Notifică clientul la expediere (email/SMS Shopify)
                    </label>
                  </div>
                  <div>
                    <label style={S.inputLabel}>Observații pentru curier (opțional)</label>
                    <textarea
                      value={data.observations}
                      onChange={e => setData(p => ({ ...p, observations: e.target.value }))}
                      placeholder="ex: Sună înainte de livrare, interfon 12..."
                      rows={3}
                      style={{ ...S.input, resize: 'vertical' as const, fontFamily: 'inherit' }}
                    />
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div style={{ ...S.section, background: 'rgba(249,115,22,0.04)', borderColor: 'rgba(249,115,22,0.3)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-orange)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 12 }}>
                  ✅ Sumar AWB — verifică înainte de confirmare
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
                  <div><span style={{ color: 'var(--c-text3)' }}>Destinatar:</span> <strong>{data.recipientName}</strong></div>
                  <div><span style={{ color: 'var(--c-text3)' }}>Telefon:</span> <strong>{data.recipientPhone}</strong></div>
                  <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--c-text3)' }}>Adresă:</span> <strong>{data.recipientAddress}, {data.recipientCity} {data.recipientZip}</strong></div>
                  <div><span style={{ color: 'var(--c-text3)' }}>Conținut:</span> <strong style={{ color: 'var(--c-orange)' }}>{data.productName}</strong></div>
                  <div><span style={{ color: 'var(--c-text3)' }}>Greutate:</span> <strong>{data.weight} kg × {data.parcels} colet(e)</strong></div>
                  <div><span style={{ color: 'var(--c-text3)' }}>COD:</span> <strong>{data.isCOD ? `Da — ${data.codAmount} ${order.currency}` : 'Nu (plătit online)'}</strong></div>
                  <div><span style={{ color: 'var(--c-text3)' }}>Curier:</span> <strong style={{ textTransform: 'uppercase' as const }}>{data.courier}</strong></div>
                </div>
              </div>
            </>
          )}

        </div>

        {/* Footer navigation */}
        <div style={S.drawerFoot}>
          <button style={S.btnGhost} onClick={step === 1 ? onClose : prev} disabled={loading}>
            {step === 1 ? '✕ Anulează' : '← Înapoi'}
          </button>
          {step < 3 ? (
            <button style={S.btnPrimary} onClick={next}>
              Următor →
            </button>
          ) : (
            <button
              style={loading ? { ...S.btnPrimary, opacity: 0.6, fontSize: 13, padding: '8px 18px' } : { ...S.btnPrimary, fontSize: 13, padding: '8px 18px', background: '#10b981' }}
              onClick={() => { const errs = validateStep(3, data); if (errs.length) { setErrors(errs); return; } onConfirm(data); }}
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

/* ═══════════════════════════════════════════════════════════
   ORDER DRAWER
═══════════════════════════════════════════════════════════ */
interface AddrValidation {
  found: boolean; zipMismatch: boolean; correctZip: string | null;
  inputZip: string; streetMatched: string | null;
  scores: { street: number | null; city: number | null; county: number | null; zip: number | null } | null;
}

function OrderDrawer({
  order, onClose, onInvoice, onShipmentWizard, actionState, shop, onAddressFixed, awbResult,
}: {
  order: EnrichedOrder; onClose: () => void;
  onInvoice: (id: string) => void;
  onShipmentWizard: (order: EnrichedOrder) => void;
  actionState: RowActionState; shop: string;
  onAddressFixed: (orderId: string, newZip: string) => void;
  awbResult?: { awb: string; courier: string; labelBase64?: string | null; trackUrl?: string; myglsUrl?: string; labelUrl?: string | null } | null;
}) {
  const fmtPrice = (n: number, cur: string) =>
    n.toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' ' + cur;

  const [validating, setValidating]   = useState(false);
  const [validation, setValidation]   = useState<AddrValidation | null>(null);
  const [fixingZip, setFixingZip]     = useState(false);
  const [fixMsg, setFixMsg]           = useState<string | null>(null);

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
      setFixMsg(`✓ ZIP actualizat în Shopify: ${newZip}`);
      setValidation(v => v ? { ...v, zipMismatch: false, inputZip: newZip } : v);
      onAddressFixed(order.id, newZip);
    } catch (e) { setFixMsg('Eroare: ' + (e as Error).message); }
    finally { setFixingZip(false); }
  };

  return (
    <>
      <div style={S.overlay} onClick={onClose} />
      <div style={S.drawer}>
        <div style={S.drawerHead}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{order.name}</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2 }}>
              {new Date(order.createdAt).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })}
              {' · '}<span style={{ textTransform: 'uppercase', opacity: 0.7 }}>{shop}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ ...S.iconBtn, padding: '6px 10px' }}>✕</button>
        </div>

        <div style={S.drawerBody}>
          {/* STATUS */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {finBadge(order.financialStatus)}
            {fulBadge(order.fulfillmentStatus)}
            {procBadge(order.processingStatus)}
          </div>

          {order.processingError && (
            <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--c-red)' }}>
              ⚠ {order.processingError}
            </div>
          )}

          {/* CUSTOMER */}
          <div style={S.section}>
            <div style={S.sectionHead}>👤 Client</div>
            <div style={S.row2col}>
              <div><div style={S.fieldLabel}>Nume</div><div style={S.fieldValue}>{order.customer.name || '—'}</div></div>
              <div><div style={S.fieldLabel}>Email</div><div style={S.fieldValue}>{order.customer.email || '—'}</div></div>
              <div><div style={S.fieldLabel}>Telefon</div><div style={S.fieldValue}>{order.customer.phone || '—'}</div></div>
              <div><div style={S.fieldLabel}>Total</div><div style={{ ...S.fieldValue, color: 'var(--c-orange)', fontWeight: 700 }}>{fmtPrice(order.totalPrice, order.currency)}</div></div>
            </div>
          </div>

          {/* ADDRESS */}
          <div style={S.section}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={S.sectionHead}>📍 Adresă livrare</div>
              <button style={S.btnGhost} onClick={validateAddress} disabled={validating}>
                {validating ? <><Spin /> Validez…</> : '🔍 Validează'}
              </button>
            </div>
            <div style={S.fieldValue}>{order.address.address1}{order.address.address2 ? `, ${order.address.address2}` : ''}</div>
            <div style={{ ...S.fieldValue, marginTop: 4 }}>{order.address.city}, {order.address.province} {order.address.zip}</div>
            {validation && (
              <div style={{ marginTop: 12 }}>
                {validation.zipMismatch ? (
                  <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
                    <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 6 }}>
                      ⚠ ZIP incorect! Introdus: <strong>{validation.inputZip}</strong> → Corect: <strong>{validation.correctZip}</strong>
                    </div>
                    {validation.scores && (
                      <div style={{ fontSize: 11, color: 'var(--c-text3)', marginBottom: 8 }}>
                        Stradă {validation.scores.street}% · Oraș {validation.scores.city}% · Județ {validation.scores.county}%
                      </div>
                    )}
                    <button style={fixingZip ? { ...S.btnPrimary, opacity: 0.6 } : S.btnPrimary}
                      onClick={() => validation.correctZip && fixZip(validation.correctZip)} disabled={fixingZip}>
                      {fixingZip ? <><Spin /> Se actualizează…</> : `✓ Setează ZIP ${validation.correctZip} în Shopify`}
                    </button>
                  </div>
                ) : (
                  <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#10b981' }}>
                    ✓ Adresă validă · ZIP {validation.inputZip} corect
                    {validation.scores && <span style={{ fontSize: 11, opacity: 0.8 }}> · Stradă {validation.scores.street}%</span>}
                  </div>
                )}
              </div>
            )}
            {fixMsg && <div style={{ marginTop: 8, fontSize: 12, color: fixMsg.startsWith('✓') ? '#10b981' : 'var(--c-red)' }}>{fixMsg}</div>}
          </div>

          {/* PRODUCTS */}
          <div style={S.section}>
            <div style={S.sectionHead}>📦 Produse ({order.lineItems.length})</div>
            {order.lineItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < order.lineItems.length - 1 ? '1px solid var(--c-border2)' : 'none' }}>
                <div>
                  <div style={{ fontSize: 13 }}>{item.name}</div>
                  {item.sku && <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>SKU: {item.sku}</div>}
                </div>
                <div style={{ textAlign: 'right' as const, flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ fontSize: 13 }}>{item.quantity} × {fmtPrice(item.price, order.currency)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* INVOICE — smart: shows DB invoice OR xconnector note_attributes OR generate button */}
          <InvoiceSection order={order} actionState={actionState} onInvoice={onInvoice} />

          {/* AWB */}
          <div style={S.section}>
            <div style={S.sectionHead}>🚚 AWB / Livrare</div>
            {(order.shipment || awbResult) ? (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                <div style={S.row2col}>
                  <div><div style={S.fieldLabel}>Curier</div><div style={{ ...S.fieldValue, textTransform: 'uppercase' as const }}>{awbResult?.courier || order.shipment?.courier}</div></div>
                  <div><div style={S.fieldLabel}>AWB</div><div style={{ ...S.fieldValue, fontFamily: 'monospace', fontWeight: 700, color: '#10b981' }}>{awbResult?.awb || order.shipment?.tracking}</div></div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                  {/* Descarca label — prioritate: URL persistent din DB, apoi base64 din memorie */}
                  {(awbResult?.labelUrl || order.shipment?.labelUrl) ? (
                    <a href={awbResult?.labelUrl || order.shipment?.labelUrl || undefined}
                      target="_blank" rel="noreferrer" style={{ ...S.btnPrimary, textDecoration: 'none' }}>
                      🖨 Descarcă etichetă PDF
                    </a>
                  ) : awbResult?.labelBase64 ? (
                    <button style={S.btnPrimary} onClick={() => {
                      const bin = atob(awbResult.labelBase64!);
                      const arr = new Uint8Array(bin.length);
                      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                      const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
                      const a = document.createElement('a');
                      a.href = url; a.download = `AWB_GLS_${awbResult.awb}.pdf`; a.click();
                      URL.revokeObjectURL(url);
                    }}>🖨 Descarcă etichetă PDF</button>
                  ) : null}
                  {(awbResult?.myglsUrl || order.shipment?.trackingUrl) && (
                    <a href={awbResult?.myglsUrl || order.shipment?.trackingUrl || undefined}
                      target="_blank" rel="noreferrer" style={{ ...S.btnGhost, textDecoration: 'none' }}>
                      🔍 Tracking GLS
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--c-text3)' }}>Niciun AWB generat.</div>
                <button
                  style={actionState.shipmentLoading ? { ...S.btnPrimary, opacity: 0.6 } : S.btnPrimary}
                  onClick={() => onShipmentWizard(order)}
                  disabled={actionState.shipmentLoading || order.cancelled}
                >
                  {actionState.shipmentLoading ? <><Spin /> Se generează…</> : '🚚 Generează AWB'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   SYNC BUTTON
═══════════════════════════════════════════════════════════ */
function SyncButton({ shop, onDone }: { shop: string; onDone: (msg: string) => void }) {
  const [syncing, setSyncing] = useState(false);
  const run = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/connector/sync-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop, limit: 50 }),
      });
      const json = await res.json();
      onDone(json.message || 'Sync terminat');
    } catch { onDone('Eroare sync'); }
    finally { setSyncing(false); }
  };
  return (
    <button style={S.iconBtn} onClick={run} disabled={syncing} title="Sincronizează datele clienților din Shopify">
      {syncing ? <Spin /> : '⟳'} Sync
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════ */
const FLAG: Record<string, string> = { RO: '🇷🇴', HU: '🇭🇺' };

type AwbResultMap = Record<string, {
  awb: string; courier: string; labelBase64?: string | null;
  trackUrl?: string; myglsUrl?: string; labelUrl?: string | null;
}>;

// ── Invoice Download Button — adaugă credențiale SmartBill în URL ─────────────
function InvoiceDownloadBtn({ url }: { url: string }) {
  // Construieste URL-ul cu credentiale la click — nu la render
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    try {
      const u = new URL(url);
      const sbEmail = localStorage.getItem('sb_email') || '';
      const sbToken = localStorage.getItem('sb_token') || '';
      const sbCif   = localStorage.getItem('sb_cif')   || '';
      if (sbEmail) u.searchParams.set('sb_email', sbEmail);
      if (sbToken) u.searchParams.set('sb_token', sbToken);
      if (sbCif)   u.searchParams.set('sb_cif',   sbCif);
      window.open(u.toString(), '_blank', 'noreferrer');
    } catch {
      window.open(url, '_blank', 'noreferrer');
    }
  };
  return (
    <a href={url} onClick={handleClick} target="_blank" rel="noreferrer"
      style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#f97316',
        color:'white', textDecoration:'none', padding:'10px 18px', borderRadius:8,
        fontSize:13, fontWeight:700, width:'fit-content', cursor:'pointer' }}>
      📥 Descarcă PDF
    </a>
  );
}


export default function XConnectorPage() {
  const qc = useQueryClient();
  const { toasts, add: addToast } = useToast();

  /* ── Global shop state (Zustand) ── */
  const { currentShop, shops } = useShopStore();
  const activeShop = currentShop;
  const currentShopInfo = shops.find(s => s.key === activeShop);

  /* ── Filters ── */
  const [search, setSearch]       = useState('');
  const [finFilter, setFinFilter] = useState('all');
  const [dateFrom, setDateFrom]   = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [cursor, setCursor]       = useState<string | null>(null);
  const [prevCursors, setPrev]    = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebounced] = useState('');

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebounced(search); setCursor(null); }, 400);
  }, [search]);

  useEffect(() => { setCursor(null); setPrev([]); }, [activeShop]);

  /* ── Auto-invoice toggle ── */
  const [autoInvoice, setAutoInvoice]           = useState(false);
  const [autoInvoiceLoading, setAutoInvLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/connector/settings?shop=${activeShop}`)
      .then(r => r.json())
      .then(d => setAutoInvoice(Boolean(d.autoInvoice)))
      .catch(() => {});
  }, [activeShop]);

  const toggleAutoInvoice = async () => {
    const next = !autoInvoice;
    setAutoInvoice(next);        // optimistic — se vede imediat
    setAutoInvLoading(true);
    const safetyTimer = setTimeout(() => setAutoInvLoading(false), 6000);
    try {
      const res = await fetch('/api/connector/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: activeShop, autoInvoice: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setAutoInvoice(!next); // rollback
        addToast('err', json.error || 'Nu s-a putut salva setarea');
      } else {
        addToast('ok', next ? '🧾 Facturare automată ACTIVATĂ' : '⏸ Facturare automată DEZACTIVATĂ');
      }
    } catch (e) {
      setAutoInvoice(!next); // rollback
      addToast('err', 'Eroare rețea');
    } finally {
      clearTimeout(safetyTimer);
      setAutoInvLoading(false);
    }
  };

  /* ── Fetch orders ── */
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

  /* ── Selection ── */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll = () => {
    if (!data) return;
    setSelected(prev => prev.size === data.orders.length ? new Set() : new Set(data.orders.map(o => o.id)));
  };

  /* ── Drawer ── */
  const [drawerOrder, setDrawerOrder] = useState<EnrichedOrder | null>(null);

  /* ── AWB Wizard state ── */
  const [wizardOrder, setWizardOrder]     = useState<EnrichedOrder | null>(null);
  const [wizardLoading, setWizardLoading] = useState(false);

  /* ── AWB Results — persistate in localStorage (supravietuiesc refresh) ── */
  const [awbResults, setAwbResultsRaw] = useState<AwbResultMap>(() => {
    try {
      const s = typeof window !== 'undefined' ? localStorage.getItem('xc_awb_results') : null;
      return s ? JSON.parse(s) : {};
    } catch { return {}; }
  });

  const setAwbResults = useCallback((updater: AwbResultMap | ((prev: AwbResultMap) => AwbResultMap)) => {
    setAwbResultsRaw((prev: AwbResultMap) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('xc_awb_results', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  /* ── Per-row action state ── */
  const [actionStates, setActionStates] = useState<Record<string, RowActionState>>({});
  const getState = (id: string): RowActionState => actionStates[id] ?? { invoiceLoading: false, shipmentLoading: false, error: null };
  const setAS = (id: string, patch: Partial<RowActionState>) =>
    setActionStates(p => ({ ...p, [id]: { ...getState(id), ...patch } }));

  /* ── Invoice mutation ── */
  const invoiceMut = useMutation({
    mutationFn: async (shopifyOrderId: string) => {
      setAS(shopifyOrderId, { invoiceLoading: true, error: null });
      const res = await fetch('/api/connector/invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopifyOrderId, shop: activeShop }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Eroare generare factură');
      return json;
    },
    onSuccess: (data, shopifyOrderId) => {
      setAS(shopifyOrderId, { invoiceLoading: false });
      addToast('ok', `Factură ${data.series}${data.number} generată!`);
      qc.invalidateQueries({ queryKey: ['connector-orders', activeShop] });
    },
    onError: (err: Error, shopifyOrderId) => {
      setAS(shopifyOrderId, { invoiceLoading: false, error: err.message });
      addToast('err', err.message);
    },
  });

  /* ── AWB wizard confirm — cheama direct /api/gls sau /api/sameday-awb ca in fulfillment ── */
  const handleWizardConfirm = async (wizData: AwbWizardData) => {
    if (!wizardOrder) return;
    const order = wizardOrder;
    const orderId = order.id;
    setWizardLoading(true);
    setAS(orderId, { shipmentLoading: true, error: null });
    try {
      if (wizData.courier === 'gls') {
        const body = {
          // credentials din env (goale = le ia serverul din process.env)
          username: '', password: '', clientNumber: '',
          recipientName:  (wizData.recipientName  || '').trim() || 'Client',
          phone:          (wizData.recipientPhone || '').replace(/\D/g, '').slice(-10) || '0700000000',
          email:           wizData.recipientEmail  || '',
          address:        (wizData.recipientAddress || '').trim(),
          city:           (wizData.recipientCity   || '').trim(),
          county:         (wizData.recipientCounty || '').trim(),
          zip:            (wizData.recipientZip    || '').replace(/\s/g, ''),
          weight:          parseFloat(String(wizData.weight))  || 1,
          parcels:         parseInt(String(wizData.parcels))   || 1,
          content:        (wizData.productName || order.name || 'Colet').slice(0, 100),
          codAmount:       wizData.isCOD ? wizData.codAmount : 0,
          codCurrency:    'RON',
          orderName:       order.name,
          orderId:         orderId,
          selectedServices: {},
        };
        const res  = await fetch('/api/gls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.ok) {
          const awbData = {
            awb: data.awb, courier: 'gls',
            labelBase64: data.labelBase64 || null,
            trackUrl:    data.trackUrl    || `https://gls-group.eu/RO/ro/urmarire-colet?match=${data.awb}`,
            myglsUrl:    data.myglsUrl    || `https://mygls.ro/Parcel/Detail/${data.awb}`,
            labelUrl:    null as string | null,
          };

          // Salveaza in DB pentru persistenta si label URL permanent
          try {
            const saveRes  = await fetch('/api/connector/save-awb', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                shopifyOrderId: orderId,
                shop:           activeShop,
                courier:        'gls',
                trackingNumber: data.awb,
                trackingUrl:    data.trackUrl,
                labelBase64:    data.labelBase64 || null,
              }),
            });
            const saveData = await saveRes.json();
            if (saveData.ok && saveData.labelUrl) {
              awbData.labelUrl = saveData.labelUrl;
            }
          } catch (e) {
            console.warn('[xConnector] save-awb failed (non-fatal):', e);
          }

          setAwbResults(p => ({ ...p, [orderId]: awbData }));
          setAS(orderId, { shipmentLoading: false });
          setWizardOrder(null);
          setWizardLoading(false);
          addToast('ok', `✅ AWB GLS ${data.awb} generat!`);
          qc.invalidateQueries({ queryKey: ['connector-orders', activeShop] });

          // Descarca PDF automat
          if (data.labelBase64) {
            try {
              const bin = atob(data.labelBase64);
              const arr = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
              const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
              const a = document.createElement('a');
              a.href = url; a.download = `AWB_GLS_${data.awb}.pdf`; a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch {}
          }
        } else {
          throw new Error(data.error || 'Eroare GLS');
        }
      } else {
        // Sameday
        const body = {
          username: '', password: '',
          recipientName:  wizData.recipientName,
          phone:          wizData.recipientPhone,
          email:          wizData.recipientEmail  || '',
          address:        wizData.recipientAddress,
          city:           wizData.recipientCity,
          county:         wizData.recipientCounty,
          zip:           (wizData.recipientZip || '').replace(/\s/g, ''),
          weight:          parseFloat(String(wizData.weight))  || 1,
          parcels:         parseInt(String(wizData.parcels))   || 1,
          content:        (wizData.productName || order.name || 'Colet').slice(0, 100),
          isCOD:           wizData.isCOD,
          total:           wizData.codAmount,
          orderName:       order.name,
          orderId:         orderId,
          observations:    wizData.observations || '',
        };
        const res  = await fetch('/api/sameday-awb', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.ok) {
          setAwbResults(p => ({ ...p, [orderId]: { awb: data.awb, courier: 'sameday' } }));
          setAS(orderId, { shipmentLoading: false });
          setWizardOrder(null);
          setWizardLoading(false);
          addToast('ok', `AWB Sameday ${data.awb} generat!`);
          qc.invalidateQueries({ queryKey: ['connector-orders', activeShop] });
        } else {
          throw new Error(data.error || 'Eroare Sameday');
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      setAS(orderId, { shipmentLoading: false, error: msg });
      addToast('err', msg);
      setWizardLoading(false);
    }
  };

  /* ── Quick AWB from table (also opens wizard) ── */
  const openWizardForOrder = (order: EnrichedOrder) => {
    setWizardOrder(order);
  };

  /* ── Bulk actions ── */
  const [bulkLoading, setBulkLoading] = useState(false);
  const bulkInvoice = async () => {
    setBulkLoading(true);
    addToast('info', `Generez facturi pentru ${selected.size} comenzi…`);
    let ok = 0, fail = 0;
    for (const id of Array.from(selected)) {
      try { await invoiceMut.mutateAsync(id); ok++; } catch { fail++; }
    }
    setBulkLoading(false);
    addToast(fail === 0 ? 'ok' : 'err', `${ok} facturi generate${fail ? `, ${fail} erori` : ''}`);
    setSelected(new Set());
  };

  /* ── Stats ── */
  const orders   = data?.orders ?? [];
  const statPaid = orders.filter(o => o.financialStatus === 'paid').length;
  const statInv  = orders.filter(o => o.invoice || o.noteAttributes?.['xconnector-invoice-url'] || o.noteAttributes?.['invoice-url']).length;
  const statShip = orders.filter(o => o.shipment).length;
  const statFail = orders.filter(o => o.processingStatus === 'failed').length;

  const fmtPrice = (n: number, cur: string) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' ' + cur;
  const fmtDate  = (s: string) => new Date(s).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' });

  /* Helper: resolve best invoice link for table cell */
  const getInvoiceLink = (order: EnrichedOrder): { label: string; url: string } | null => {
    if (order.invoice) return { label: `${order.invoice.series}${order.invoice.number}`, url: order.invoice.url };
    const attrs = order.noteAttributes ?? {};
    const url = attrs['xconnector-invoice-url'] || attrs['invoice-url'] || attrs['xconnector-invoice-short-url'] || '';
    if (!url) return null;
    try {
      const u = new URL(attrs['xconnector-invoice-url'] || '');
      const s = u.searchParams.get('s') || '';
      const n = u.searchParams.get('n') || '';
      const label = (s && n) ? `${s}${n}` : (attrs['invoice-number'] || attrs['Factură'] || 'Factură');
      return { label, url };
    } catch {
      return { label: attrs['invoice-number'] || attrs['Factură'] || 'Factură', url };
    }
  };

  return (
    <div style={S.page}>
      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
        tr:hover td { background: rgba(255,255,255,0.02) !important; }
        select option { background: var(--c-bg2); }
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={S.topbar} className="xconn-topbar">
        <div style={S.topbarRow1}>
          <h1 style={S.h1}>⚡ xConnector</h1>

          {currentShopInfo && (
            <div style={S.shopBadge}>
              <span>{FLAG[currentShopInfo.flag?.toUpperCase()] ?? '🌐'}</span>
              <span>{currentShopInfo.label}</span>
            </div>
          )}

          <div style={S.searchWrap}>
            <span style={S.searchIcon}>🔍</span>
            <input style={S.searchInput} placeholder="Caută comandă, client…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <select value={finFilter} onChange={e => { setFinFilter(e.target.value); setCursor(null); }} style={S.select}>
            <option value="all">Toate</option>
            <option value="paid">Plătit</option>
            <option value="pending">Ramburs</option>
            <option value="refunded">Returnat</option>
          </select>

          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setCursor(null); }} style={S.select} />

          <button style={S.iconBtn} onClick={() => refetch()}>
            {isLoading ? <Spin /> : '↻'} Refresh
          </button>

          <SyncButton shop={activeShop} onDone={() => { addToast('ok', 'Sync trimis! Refresh în 30s.'); setTimeout(() => refetch(), 30000); }} />

          {/* ── Auto-invoice toggle ── */}
          <button
            style={autoInvoiceLoading
              ? { ...S.toggleOff, opacity: 0.6, cursor: 'not-allowed' }
              : autoInvoice ? S.toggleOn : S.toggleOff}
            onClick={toggleAutoInvoice}
            disabled={autoInvoiceLoading}
            title={autoInvoice
              ? 'Facturare automată ACTIVĂ — click pentru a dezactiva'
              : 'Facturare automată INACTIVĂ — click pentru a activa'}
          >
            {autoInvoiceLoading
              ? <><Spin /> Factură auto…</>
              : autoInvoice
                ? <>🧾 <span style={{ width: 28, height: 16, background: '#10b981', borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 3px', flexShrink: 0 }}><span style={{ width: 10, height: 10, background: '#fff', borderRadius: '50%' }} /></span> Factură auto</>
                : <>🧾 <span style={{ width: 28, height: 16, background: 'var(--c-border)', borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', padding: '0 3px', flexShrink: 0 }}><span style={{ width: 10, height: 10, background: '#fff', borderRadius: '50%' }} /></span> Factură auto</>}
          </button>
        </div>
      </div>

      {/* ── STATS ── */}
      <div style={S.statsBar}>
        <div style={S.statCard}><div style={S.statLabel}>Total</div><div style={S.statValue}>{orders.length}</div></div>
        <div style={S.statCard}><div style={S.statLabel}>Plătite</div><div style={{ ...S.statValue, color: 'var(--c-green)' }}>{statPaid}</div></div>
        <div style={S.statCard}><div style={S.statLabel}>Facturate</div><div style={{ ...S.statValue, color: 'var(--c-blue)' }}>{statInv}</div></div>
        <div style={S.statCard}><div style={S.statLabel}>AWB generat</div><div style={{ ...S.statValue, color: 'var(--c-orange)' }}>{statShip}</div></div>
        {statFail > 0 && <div style={S.statCard}><div style={S.statLabel}>Erori</div><div style={{ ...S.statValue, color: 'var(--c-red)' }}>{statFail}</div></div>}
      </div>

      {/* ── BULK BAR ── */}
      {selected.size > 0 && (
        <div style={S.bulkBar}>
          <span style={S.bulkLabel}>✓ {selected.size} selectate</span>
          <button style={S.btnPrimary} onClick={bulkInvoice} disabled={bulkLoading}>{bulkLoading ? <Spin /> : '🧾'} Facturi</button>
          <button style={S.btnDisabled} onClick={() => setSelected(new Set())}>✕ Deselectează</button>
        </div>
      )}

      {/* ── ERROR ── */}
      {isError && (
        <div style={{ margin: '0 20px 10px', background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 12, padding: '12px 16px', color: 'var(--c-red)', fontSize: 13 }}>
          ⚠ {(error as Error).message} — <button onClick={() => refetch()} style={{ color: 'var(--c-red)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}

      {/* ── TABLE ── */}
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
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <Skeleton rows={8} />
            ) : orders.length === 0 ? (
              <tr><td colSpan={10} style={S.empty}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                <div>Nicio comandă găsită</div>
                <div style={{ fontSize: 12, marginTop: 6, color: 'var(--c-text4)' }}>Schimbă filtrele sau verifică conexiunea Shopify</div>
              </td></tr>
            ) : orders.map(order => {
              const as = getState(order.id);
              const invLink = getInvoiceLink(order);
              return (
                <tr key={order.id} onClick={() => setDrawerOrder(order)} style={{ cursor: 'pointer' }}>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" style={S.checkbox} checked={selected.has(order.id)} onChange={() => toggleSelect(order.id)} />
                  </td>
                  <td style={S.td}>
                    <div style={{ fontWeight: 600, color: 'var(--c-orange)' }}>{order.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>{fmtDate(order.createdAt)}</div>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontWeight: 500 }}>{order.customer.name || <span style={{ color: 'var(--c-text4)' }}>—</span>}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>{order.customer.phone}</div>
                  </td>
                  <td style={S.td}>
                    <div>{order.address.city || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>{order.address.zip}</div>
                  </td>
                  <td style={S.td}><div style={{ fontWeight: 600 }}>{fmtPrice(order.totalPrice, order.currency)}</div></td>
                  <td style={S.td}>{finBadge(order.financialStatus)}</td>
                  <td style={S.td}>{fulBadge(order.fulfillmentStatus)}</td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    {invLink ? (
                      <a
                        href={invLink.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ ...S.btnGhost, textDecoration: 'none', fontSize: 11 }}
                        title={invLink.url}
                      >
                        📥 {invLink.label}
                      </a>
                    ) : (
                      <button
                        style={as.invoiceLoading ? { ...S.btnPrimary, opacity: 0.6, fontSize: 11 } : { ...S.btnPrimary, fontSize: 11 }}
                        disabled={as.invoiceLoading || order.cancelled}
                        onClick={e => { e.stopPropagation(); invoiceMut.mutate(order.id); }}
                      >
                        {as.invoiceLoading ? <Spin /> : '🧾'} Factură
                      </button>
                    )}
                  </td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    {(() => {
                      const awbRes = awbResults[order.id];
                      const existingAwb = order.shipment?.tracking || awbRes?.awb;
                      const labelUrl = awbRes?.labelUrl || order.shipment?.labelUrl || null;
                      if (existingAwb) {
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#10b981', fontWeight: 700 }}>{existingAwb}</div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                              {/* Descarca label — prioritate: URL persistent din DB, apoi base64 din memorie */}
                              {labelUrl ? (
                                <a href={labelUrl} target="_blank" rel="noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  style={{ ...S.btnPrimary, textDecoration: 'none', fontSize: 10, padding: '3px 7px' }}>
                                  🖨 PDF
                                </a>
                              ) : awbRes?.labelBase64 ? (
                                <button style={{ ...S.btnPrimary, fontSize: 10, padding: '3px 7px' }} onClick={e => {
                                  e.stopPropagation();
                                  const bin = atob(awbRes.labelBase64!);
                                  const arr = new Uint8Array(bin.length);
                                  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                                  const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
                                  const a = document.createElement('a');
                                  a.href = url; a.download = `AWB_GLS_${existingAwb}.pdf`; a.click();
                                  URL.revokeObjectURL(url);
                                }}>🖨 PDF</button>
                              ) : null}
                              {(awbRes?.myglsUrl || order.shipment?.trackingUrl) && (
                                <a href={awbRes?.myglsUrl || order.shipment?.trackingUrl || undefined}
                                  target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                                  style={{ ...S.btnGhost, textDecoration: 'none', fontSize: 10, padding: '3px 7px' }}>
                                  🔍 Track
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      }
                      return (
                        <button
                          style={as.shipmentLoading ? { ...S.btnGhost, opacity: 0.6, fontSize: 11 } : { ...S.btnGhost, fontSize: 11 }}
                          disabled={as.shipmentLoading || order.cancelled}
                          onClick={e => { e.stopPropagation(); openWizardForOrder(order); }}
                        >
                          {as.shipmentLoading ? <Spin /> : '🚚'} AWB
                        </button>
                      );
                    })()}
                  </td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    <div style={S.actionsCell}>
                      {procBadge(order.processingStatus)}
                      {as.error && (
                        <button title={as.error} style={S.btnDanger} onClick={e => { e.stopPropagation(); setAS(order.id, { error: null }); }}>⚠</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── PAGINATION ── */}
      {data && (
        <div style={{ display: 'flex', gap: 10, padding: '14px 20px', justifyContent: 'center' }}>
          {prevCursors.length > 0 && (
            <button style={S.iconBtn} onClick={() => { const prev = [...prevCursors]; const c = prev.pop() ?? null; setPrev(prev); setCursor(c); }}>← Anterior</button>
          )}
          {data.pageInfo.hasNextPage && (
            <button style={S.iconBtn} onClick={() => { setPrev(p => [...p, cursor ?? '']); setCursor(data.pageInfo.endCursor); }}>Următor →</button>
          )}
        </div>
      )}

      {/* ── ORDER DRAWER ── */}
      {drawerOrder && !wizardOrder && (
        <OrderDrawer
          order={drawerOrder}
          onClose={() => setDrawerOrder(null)}
          onInvoice={id => invoiceMut.mutate(id)}
          onShipmentWizard={order => { openWizardForOrder(order); }}
          actionState={getState(drawerOrder.id)}
          shop={activeShop}
          awbResult={awbResults[drawerOrder.id] || null}
          onAddressFixed={(orderId, newZip) => {
            addToast('ok', `ZIP ${newZip} actualizat în Shopify`);
            qc.invalidateQueries({ queryKey: ['connector-orders', activeShop] });
          }}
        />
      )}

      {/* ── AWB WIZARD ── */}
      {wizardOrder && (
        <AwbWizard
          order={wizardOrder}
          initialCourier="gls"
          onClose={() => { setWizardOrder(null); setWizardLoading(false); }}
          onConfirm={handleWizardConfirm}
          loading={wizardLoading}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
