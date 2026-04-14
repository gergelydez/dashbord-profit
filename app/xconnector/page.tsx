'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { EnrichedOrder, OrdersResponse, RowActionState, ProcessingStatus, CourierName } from './types';

/* ═══════════════════════════════════════════════════════════
   STYLES
═══════════════════════════════════════════════════════════ */
const S: Record<string, React.CSSProperties> = {
  page:        { background: 'var(--c-bg)', minHeight: '100dvh', fontFamily: 'DM Sans, sans-serif', color: 'var(--c-text)', paddingBottom: 80 },
  topbar:      { background: 'var(--c-bg2)', borderBottom: '1px solid var(--c-border)', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 0, zIndex: 50 },
  topbarRow1:  { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  h1:          { fontSize: 18, fontWeight: 700, color: 'var(--c-text)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 },
  searchWrap:  { flex: 1, minWidth: 200, maxWidth: 340, position: 'relative' },
  searchInput: { width: '100%', background: 'var(--c-bg3)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '9px 12px 9px 36px', color: 'var(--c-text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  searchIcon:  { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, fontSize: 14 },
  select:      { background: 'var(--c-bg3)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '9px 12px', color: 'var(--c-text)', fontSize: 13, outline: 'none', cursor: 'pointer' },
  iconBtn:     { background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '8px 14px', color: 'var(--c-text2)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 },
  statsBar:    { display: 'flex', gap: 12, padding: '14px 20px', flexWrap: 'wrap' },
  statCard:    { background: 'var(--c-bg3)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '10px 16px', flex: 1, minWidth: 100 },
  statLabel:   { fontSize: 11, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 },
  statValue:   { fontSize: 22, fontWeight: 700, color: 'var(--c-text)' },
  bulkBar:     { background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 12, margin: '0 20px 12px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  bulkLabel:   { fontSize: 13, color: 'var(--c-orange)', fontWeight: 600, flex: 1 },
  table:       { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th:          { padding: '10px 14px', textAlign: 'left' as const, color: 'var(--c-text3)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg2)', whiteSpace: 'nowrap' as const },
  td:          { padding: '11px 14px', borderBottom: '1px solid var(--c-border2)', verticalAlign: 'middle' as const },
  trHover:     { background: 'var(--c-surface)', cursor: 'pointer', transition: 'background 120ms' },
  trNormal:    { background: 'transparent' },
  actionsCell: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  // Buttons
  btnPrimary:  { background: 'var(--c-orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const, display: 'flex', alignItems: 'center', gap: 4 },
  btnGhost:    { background: 'var(--c-surface)', color: 'var(--c-text2)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const, display: 'flex', alignItems: 'center', gap: 4 },
  btnDisabled: { background: 'var(--c-bg3)', color: 'var(--c-text4)', border: '1px solid var(--c-border2)', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'not-allowed', whiteSpace: 'nowrap' as const, display: 'flex', alignItems: 'center', gap: 4, opacity: 0.5 },
  btnDanger:   { background: 'rgba(244,63,94,0.12)', color: 'var(--c-red)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  // Drawer
  overlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100 },
  drawer:      { position: 'fixed' as const, right: 0, top: 0, bottom: 0, width: '100%', maxWidth: 560, background: 'var(--c-bg2)', borderLeft: '1px solid var(--c-border)', zIndex: 101, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const },
  drawerHead:  { padding: '18px 20px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky' as const, top: 0, background: 'var(--c-bg2)', zIndex: 1 },
  drawerBody:  { padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 20 },
  section:     { background: 'var(--c-bg3)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '14px 16px' },
  sectionHead: { fontSize: 12, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 12 },
  row2col:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  fieldLabel:  { fontSize: 11, color: 'var(--c-text3)', marginBottom: 3 },
  fieldValue:  { fontSize: 13, color: 'var(--c-text)' },
  // Toast
  toastWrap:   { position: 'fixed' as const, bottom: 90, right: 16, zIndex: 200, display: 'flex', flexDirection: 'column' as const, gap: 8, maxWidth: 340 },
  toastOk:     { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.35)', color: '#10b981', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 500 },
  toastErr:    { background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.35)', color: 'var(--c-red)', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 500 },
  toastInfo:   { background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', color: 'var(--c-blue)', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 500 },
  empty:       { padding: '60px 20px', textAlign: 'center' as const, color: 'var(--c-text3)' },
  spinner:     { width: 14, height: 14, border: '2px solid transparent', borderTopColor: 'currentColor', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite' },
  checkbox:    { width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--c-orange)' },
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
  if (s === 'paid') return <Badge label="Plătit" color="green" />;
  if (s === 'pending') return <Badge label="Ramburs" color="yellow" />;
  if (s === 'refunded') return <Badge label="Returnat" color="red" />;
  return <Badge label={s} color="gray" />;
}
function fulBadge(s: string | null) {
  if (!s || s === 'unfulfilled' || s === 'null') return <Badge label="Nefulfilat" color="gray" />;
  if (s === 'fulfilled') return <Badge label="Expediat" color="green" />;
  if (s === 'partial') return <Badge label="Parțial" color="yellow" />;
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

/* ═══════════════════════════════════════════════════════════
   SPINNER
═══════════════════════════════════════════════════════════ */
function Spin() { return <span style={S.spinner} />; }

/* ═══════════════════════════════════════════════════════════
   SKELETON
═══════════════════════════════════════════════════════════ */
function Skeleton({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: 10 }).map((_, j) => (
            <td key={j} style={S.td}>
              <div style={{ height: 14, background: 'var(--c-surface2)', borderRadius: 6, animation: 'pulse 1.4s ease-in-out infinite', width: j === 0 ? 20 : j === 1 ? 60 : '80%' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   ORDER DRAWER
═══════════════════════════════════════════════════════════ */
function OrderDrawer({
  order, onClose, onInvoice, onShipment, actionState, courier, setCourier,
}: {
  order: EnrichedOrder;
  onClose: () => void;
  onInvoice: (id: string) => void;
  onShipment: (id: string) => void;
  actionState: RowActionState;
  courier: CourierName;
  setCourier: (c: CourierName) => void;
}) {
  const fmtPrice = (n: number, cur: string) =>
    n.toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' ' + cur;

  return (
    <>
      <div style={S.overlay} onClick={onClose} />
      <div style={S.drawer}>
        <div style={S.drawerHead}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{order.name}</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2 }}>
              {new Date(order.createdAt).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })}
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

          {/* Error */}
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
            <div style={S.sectionHead}>📍 Adresă livrare</div>
            <div style={S.fieldValue}>{order.address.address1}{order.address.address2 ? `, ${order.address.address2}` : ''}</div>
            <div style={{ ...S.fieldValue, marginTop: 4 }}>{order.address.city}, {order.address.province} {order.address.zip}</div>
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

          {/* INVOICE */}
          <div style={S.section}>
            <div style={S.sectionHead}>🧾 Factură</div>
            {order.invoice ? (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                <div style={S.row2col}>
                  <div><div style={S.fieldLabel}>Serie/Număr</div><div style={S.fieldValue}>{order.invoice.series}{order.invoice.number}</div></div>
                  <div><div style={S.fieldLabel}>Status</div><div><Badge label={order.invoice.status} color="green" /></div></div>
                </div>
                <a href={order.invoice.url} target="_blank" rel="noreferrer" style={{ ...S.btnGhost, textDecoration: 'none', width: 'fit-content' }}>
                  📥 Descarcă PDF
                </a>
              </div>
            ) : (
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
            )}
          </div>

          {/* AWB */}
          <div style={S.section}>
            <div style={S.sectionHead}>📦 AWB / Livrare</div>
            {order.shipment ? (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                <div style={S.row2col}>
                  <div><div style={S.fieldLabel}>Curier</div><div style={{ ...S.fieldValue, textTransform: 'uppercase' as const }}>{order.shipment.courier}</div></div>
                  <div><div style={S.fieldLabel}>AWB</div><div style={S.fieldValue}>{order.shipment.tracking}</div></div>
                  <div><div style={S.fieldLabel}>Status</div><div><Badge label={order.shipment.status} color="blue" /></div></div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a href={order.shipment.labelUrl} target="_blank" rel="noreferrer" style={{ ...S.btnGhost, textDecoration: 'none' }}>
                    🖨 Etichetă
                  </a>
                  {order.shipment.trackingUrl && (
                    <a href={order.shipment.trackingUrl} target="_blank" rel="noreferrer" style={{ ...S.btnGhost, textDecoration: 'none' }}>
                      🔍 Tracking
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--c-text3)' }}>Niciun AWB generat.</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={courier} onChange={e => setCourier(e.target.value as CourierName)} style={{ ...S.select, flex: 1 }}>
                    <option value="gls">GLS</option>
                    <option value="sameday">Sameday</option>
                  </select>
                  <button
                    style={actionState.shipmentLoading ? { ...S.btnPrimary, opacity: 0.6, flex: 2 } : { ...S.btnPrimary, flex: 2 }}
                    onClick={() => onShipment(order.id)}
                    disabled={actionState.shipmentLoading || order.cancelled}
                  >
                    {actionState.shipmentLoading ? <><Spin /> Se generează…</> : '🚚 Generează AWB'}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════ */
type ShopInfo = { key: string; label: string; flag: string };

export default function XConnectorPage() {
  const qc = useQueryClient();
  const { toasts, add: addToast } = useToast();

  /* ── Shop selector ── */
  const [activeShop, setActiveShop] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('xconn_shop') || 'ro';
    return 'ro';
  });
  const [shops, setShops] = useState<ShopInfo[]>([]);
  useEffect(() => {
    fetch('/api/connector/shops').then(r => r.json()).then(d => setShops(d.shops || [])).catch(() => {});
  }, []);
  const switchShop = (key: string) => {
    setActiveShop(key);
    localStorage.setItem('xconn_shop', key);
    setCursor(null);
    qc.invalidateQueries({ queryKey: ['connector-orders'] });
  };

  /* ── Filters ── */
  const [search, setSearch]     = useState('');
  const [finFilter, setFinFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [cursor, setCursor]     = useState<string | null>(null);
  const [prevCursors, setPrev]  = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebounced] = useState('');

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebounced(search); setCursor(null); }, 400);
  }, [search]);

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
  const [drawerCourier, setDrawerCourier] = useState<CourierName>('gls');

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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopifyOrderId, shop: activeShop }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Eroare generare factură');
      return json;
    },
    onSuccess: (data, shopifyOrderId) => {
      setAS(shopifyOrderId, { invoiceLoading: false });
      addToast('ok', `Factură ${data.series}${data.number} generată!`);
      qc.invalidateQueries({ queryKey: ['connector-orders'] });
    },
    onError: (err: Error, shopifyOrderId) => {
      setAS(shopifyOrderId, { invoiceLoading: false, error: err.message });
      addToast('err', err.message);
    },
  });

  /* ── Shipment mutation ── */
  const shipmentMut = useMutation({
    mutationFn: async ({ shopifyOrderId, courier }: { shopifyOrderId: string; courier: string }) => {
      setAS(shopifyOrderId, { shipmentLoading: true, error: null });
      const res = await fetch('/api/connector/shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopifyOrderId, courier, shop: activeShop }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Eroare generare AWB');
      return json;
    },
    onSuccess: (data, { shopifyOrderId }) => {
      setAS(shopifyOrderId, { shipmentLoading: false });
      addToast('ok', `AWB ${data.trackingNumber} generat!`);
      qc.invalidateQueries({ queryKey: ['connector-orders'] });
    },
    onError: (err: Error, { shopifyOrderId }) => {
      setAS(shopifyOrderId, { shipmentLoading: false, error: err.message });
      addToast('err', err.message);
    },
  });

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

  const bulkShipment = async () => {
    setBulkLoading(true);
    addToast('info', `Generez AWB-uri pentru ${selected.size} comenzi…`);
    let ok = 0, fail = 0;
    for (const id of Array.from(selected)) {
      try { await shipmentMut.mutateAsync({ shopifyOrderId: id, courier: 'gls' }); ok++; } catch { fail++; }
    }
    setBulkLoading(false);
    addToast(fail === 0 ? 'ok' : 'err', `${ok} AWB-uri generate${fail ? `, ${fail} erori` : ''}`);
    setSelected(new Set());
  };

  /* ── Stats ── */
  const orders   = data?.orders ?? [];
  const statPaid = orders.filter(o => o.financialStatus === 'paid').length;
  const statInv  = orders.filter(o => o.invoice).length;
  const statShip = orders.filter(o => o.shipment).length;
  const statFail = orders.filter(o => o.processingStatus === 'failed').length;

  /* ── Courier for table-level actions ── */
  const [tableCourier, setTableCourier] = useState<CourierName>('gls');

  const fmtPrice = (n: number, cur: string) =>
    n.toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' ' + cur;

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' });

  return (
    <div style={S.page}>
      {/* ── CSS animations ── */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
        tr:hover td { background: rgba(255,255,255,0.025) !important; }
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={S.topbar}>
        <div style={S.topbarRow1}>
          <h1 style={S.h1}>⚡ xConnector</h1>

          {/* Shop switcher */}
          {shops.length > 1 && (
            <div style={{ display: 'flex', gap: 4, background: 'var(--c-bg3)', border: '1px solid var(--c-border)', borderRadius: 10, padding: 3 }}>
              {shops.map(s => (
                <button
                  key={s.key}
                  onClick={() => switchShop(s.key)}
                  style={{
                    background: activeShop === s.key ? 'var(--c-orange)' : 'transparent',
                    color: activeShop === s.key ? '#fff' : 'var(--c-text2)',
                    border: 'none', borderRadius: 8, padding: '5px 12px',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 150ms',
                  }}
                >
                  {s.flag === 'RO' ? '🇷🇴' : s.flag === 'HU' ? '🇭🇺' : '🌐'} {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          <div style={S.searchWrap}>
            <span style={S.searchIcon}>🔍</span>
            <input
              style={S.searchInput}
              placeholder="Caută comandă, client, email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Filters */}
          <select value={finFilter} onChange={e => { setFinFilter(e.target.value); setCursor(null); }} style={S.select}>
            <option value="all">Toate statusurile</option>
            <option value="paid">Plătit</option>
            <option value="pending">Ramburs</option>
            <option value="refunded">Returnat</option>
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setCursor(null); }}
            style={S.select}
          />

          {/* Courier selector */}
          <select value={tableCourier} onChange={e => setTableCourier(e.target.value as CourierName)} style={S.select}>
            <option value="gls">GLS</option>
            <option value="sameday">Sameday</option>
          </select>

          {/* Refresh */}
          <button style={S.iconBtn} onClick={() => refetch()}>
            {isLoading ? <Spin /> : '↻'} Refresh
          </button>
        </div>
      </div>

      {/* ── STATS ── */}
      <div style={S.statsBar}>
        <div style={S.statCard}><div style={S.statLabel}>Total comenzi</div><div style={S.statValue}>{orders.length}</div></div>
        <div style={S.statCard}><div style={S.statLabel}>Plătite</div><div style={{ ...S.statValue, color: 'var(--c-green)' }}>{statPaid}</div></div>
        <div style={S.statCard}><div style={S.statLabel}>Facturate</div><div style={{ ...S.statValue, color: 'var(--c-blue)' }}>{statInv}</div></div>
        <div style={S.statCard}><div style={S.statLabel}>AWB generat</div><div style={{ ...S.statValue, color: 'var(--c-orange)' }}>{statShip}</div></div>
        {statFail > 0 && <div style={S.statCard}><div style={S.statLabel}>Erori</div><div style={{ ...S.statValue, color: 'var(--c-red)' }}>{statFail}</div></div>}
      </div>

      {/* ── BULK ACTIONS ── */}
      {selected.size > 0 && (
        <div style={S.bulkBar}>
          <span style={S.bulkLabel}>✓ {selected.size} selectate</span>
          <button style={S.btnPrimary} onClick={bulkInvoice} disabled={bulkLoading}>
            {bulkLoading ? <Spin /> : '🧾'} Generează facturi
          </button>
          <button style={S.btnGhost} onClick={bulkShipment} disabled={bulkLoading}>
            {bulkLoading ? <Spin /> : '🚚'} Generează AWB-uri
          </button>
          <button style={S.btnDisabled} onClick={() => setSelected(new Set())}>✕ Deselectează</button>
        </div>
      )}

      {/* ── ERROR STATE ── */}
      {isError && (
        <div style={{ margin: '0 20px 12px', background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 12, padding: '12px 16px', color: 'var(--c-red)', fontSize: 13 }}>
          ⚠ Eroare: {(error as Error).message} — <button onClick={() => refetch()} style={{ color: 'var(--c-red)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Încearcă din nou</button>
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
              <th style={S.th}>Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <Skeleton rows={8} />
            ) : orders.length === 0 ? (
              <tr><td colSpan={10} style={S.empty}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                <div>Nicio comandă găsită</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>Schimbă filtrele sau verifică conexiunea Shopify</div>
              </td></tr>
            ) : orders.map(order => {
              const as = getState(order.id);
              return (
                <tr key={order.id} style={S.trNormal} onClick={() => { setDrawerOrder(order); setDrawerCourier('gls'); }}>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" style={S.checkbox} checked={selected.has(order.id)} onChange={() => toggleSelect(order.id)} />
                  </td>
                  <td style={S.td}>
                    <div style={{ fontWeight: 600, color: 'var(--c-orange)' }}>{order.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>{fmtDate(order.createdAt)}</div>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontWeight: 500 }}>{order.customer.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>{order.customer.phone}</div>
                  </td>
                  <td style={S.td}>
                    <div>{order.address.city}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>{order.address.zip}</div>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontWeight: 600 }}>{fmtPrice(order.totalPrice, order.currency)}</div>
                  </td>
                  <td style={S.td}>{finBadge(order.financialStatus)}</td>
                  <td style={S.td}>{fulBadge(order.fulfillmentStatus)}</td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    {order.invoice ? (
                      <a href={order.invoice.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ ...S.btnGhost, textDecoration: 'none' }}>
                        📥 {order.invoice.series}{order.invoice.number}
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
                    {order.shipment ? (
                      <a href={order.shipment.labelUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ ...S.btnGhost, textDecoration: 'none', fontSize: 11 }}>
                        🖨 {order.shipment.tracking.slice(-8)}
                      </a>
                    ) : (
                      <button
                        style={as.shipmentLoading ? { ...S.btnGhost, opacity: 0.6, fontSize: 11 } : { ...S.btnGhost, fontSize: 11 }}
                        disabled={as.shipmentLoading || order.cancelled}
                        onClick={e => { e.stopPropagation(); shipmentMut.mutate({ shopifyOrderId: order.id, courier: tableCourier }); }}
                      >
                        {as.shipmentLoading ? <Spin /> : '🚚'} AWB
                      </button>
                    )}
                  </td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    <div style={S.actionsCell}>
                      {as.error && (
                        <button title={as.error} style={S.btnDanger} onClick={e => { e.stopPropagation(); setAS(order.id, { error: null }); }}>
                          ⚠ Eroare
                        </button>
                      )}
                      {order.processingStatus === 'failed' && (
                        <button style={S.btnDanger} onClick={e => { e.stopPropagation(); invoiceMut.mutate(order.id); }}>
                          ↻ Retry
                        </button>
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
        <div style={{ display: 'flex', gap: 10, padding: '16px 20px', justifyContent: 'center' }}>
          {prevCursors.length > 0 && (
            <button style={S.iconBtn} onClick={() => {
              const prev = [...prevCursors];
              const c = prev.pop() ?? null;
              setPrev(prev);
              setCursor(c);
            }}>← Anterior</button>
          )}
          {data.pageInfo.hasNextPage && (
            <button style={S.iconBtn} onClick={() => {
              setPrev(p => [...p, cursor ?? '']);
              setCursor(data.pageInfo.endCursor);
            }}>Următor →</button>
          )}
        </div>
      )}

      {/* ── DRAWER ── */}
      {drawerOrder && (
        <OrderDrawer
          order={drawerOrder}
          onClose={() => setDrawerOrder(null)}
          onInvoice={(id) => invoiceMut.mutate(id)}
          onShipment={(id) => shipmentMut.mutate({ shopifyOrderId: id, courier: drawerCourier })}
          actionState={getState(drawerOrder.id)}
          courier={drawerCourier}
          setCourier={setDrawerCourier}
        />
      )}

      {/* ── TOASTS ── */}
      <Toasts toasts={toasts} />
    </div>
  );
}
