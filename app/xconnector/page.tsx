'use client';

import { useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────
interface Invoice {
  series: string;
  number: string;
  url: string;
}
interface Shipment {
  courier: string;
  tracking: string;
  trackingUrl: string | null;
  labelUrl: string;
  status: string;
}
interface Order {
  id: string;
  name: string;
  createdAt: string;
  customer: { name: string; phone: string };
  totalPrice: number;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  processingStatus: string;
  processingError?: string;
  invoice: Invoice | null;
  shipment: Shipment | null;
}

// ─── Mock data ───────────────────────────────────────────────────────────────
const MOCK_ORDERS: Order[] = [
  {
    id: '6001', name: '#3201', createdAt: '2026-04-16T07:12:00Z',
    customer: { name: 'Andrei Popescu', phone: '0722123456' },
    totalPrice: 359, currency: 'RON',
    financialStatus: 'paid', fulfillmentStatus: null,
    processingStatus: 'fulfilled',
    invoice: { series: 'GLA', number: '2655', url: 'https://xconnector.app/d/inv1' },
    shipment: { courier: 'GLS', tracking: '6239078223', trackingUrl: null, labelUrl: '#', status: 'CREATED' },
  },
  {
    id: '6002', name: '#3200', createdAt: '2026-04-16T06:45:00Z',
    customer: { name: 'Maria Ionescu', phone: '0744987654' },
    totalPrice: 249, currency: 'RON',
    financialStatus: 'paid', fulfillmentStatus: null,
    processingStatus: 'partial',
    invoice: { series: 'GLA', number: '2654', url: 'https://xconnector.app/d/inv2' },
    shipment: null,
  },
  {
    id: '6003', name: '#3199', createdAt: '2026-04-16T05:30:00Z',
    customer: { name: 'Ion Gheorghe', phone: '0755321098' },
    totalPrice: 599, currency: 'RON',
    financialStatus: 'pending', fulfillmentStatus: null,
    processingStatus: 'pending',
    invoice: null, shipment: null,
  },
  {
    id: '6004', name: '#3198', createdAt: '2026-04-15T20:10:00Z',
    customer: { name: 'Elena Dumitrescu', phone: '0733654321' },
    totalPrice: 179, currency: 'RON',
    financialStatus: 'paid', fulfillmentStatus: 'fulfilled',
    processingStatus: 'partial',
    invoice: null,
    shipment: { courier: 'GLS', tracking: '6239078100', trackingUrl: null, labelUrl: '#', status: 'CREATED' },
  },
  {
    id: '6005', name: '#3197', createdAt: '2026-04-15T18:22:00Z',
    customer: { name: 'Vasile Popa', phone: '0766789012' },
    totalPrice: 429, currency: 'RON',
    financialStatus: 'paid', fulfillmentStatus: null,
    processingStatus: 'failed',
    processingError: 'Adresa invalida - judetul lipseste',
    invoice: null, shipment: null,
  },
  {
    id: '6006', name: '#3196', createdAt: '2026-04-15T15:05:00Z',
    customer: { name: 'Cristina Marin', phone: '0788345678' },
    totalPrice: 319, currency: 'RON',
    financialStatus: 'paid', fulfillmentStatus: null,
    processingStatus: 'fulfilled',
    invoice: { series: 'GLA', number: '2650', url: '#' },
    shipment: { courier: 'GLS', tracking: '6239077999', trackingUrl: null, labelUrl: '#', status: 'CREATED' },
  },
];

// ─── Icons ───────────────────────────────────────────────────────────────────
const IconDoc = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);
const IconTruck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
    <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
  </svg>
);
const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);
const IconSync = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
  </svg>
);
const IconCheck = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconXMark = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconWarning = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
const IconChevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const IconBolt = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#F97316" stroke="none">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function btnStyle(bg: string, outline: boolean = false): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
    border: 'none', fontSize: 12, fontWeight: 700,
    background: bg, color: outline ? 'inherit' : '#fff',
  };
}

const selectStyle: React.CSSProperties = {
  padding: '8px 10px', background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
  color: '#fff', fontSize: 13, cursor: 'pointer', outline: 'none',
};

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '7px 12px', background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
  color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const statCard: React.CSSProperties = {
  flex: 1, padding: '10px 12px', borderRadius: 10,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.07)',
};

// ─── StatusBadge ─────────────────────────────────────────────────────────────
function StatusBadge({ exists, label, type }: { exists: boolean; label: string; type: string }) {
  if (exists) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 8px', borderRadius: 6,
        background: type === 'invoice' ? 'rgba(249,115,22,0.15)' : 'rgba(34,197,94,0.15)',
        color: type === 'invoice' ? '#F97316' : '#22C55E',
        fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
      }}>
        <IconCheck /> {label}
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6,
      background: 'rgba(255,255,255,0.05)',
      color: 'rgba(255,255,255,0.3)',
      fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
    }}>
      <IconXMark /> Fara {label.toLowerCase()}
    </span>
  );
}

// ─── ProcDot ─────────────────────────────────────────────────────────────────
function ProcDot({ status }: { status: string }) {
  const cfg: Record<string, { color: string; label: string }> = {
    fulfilled:  { color: '#22C55E', label: 'Complet' },
    partial:    { color: '#F97316', label: 'Partial' },
    pending:    { color: '#6B7280', label: 'In asteptare' },
    processing: { color: '#60A5FA', label: 'Procesare' },
    failed:     { color: '#EF4444', label: 'Eroare' },
    cancelled:  { color: '#6B7280', label: 'Anulat' },
  };
  const c = cfg[status] ?? cfg['pending'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 6,
      background: `${c.color}18`,
      color: c.color, fontSize: 11, fontWeight: 700,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: c.color,
        boxShadow: status === 'processing' ? `0 0 6px ${c.color}` : 'none',
      }} />
      {c.label}
    </span>
  );
}

// ─── OrderRow ────────────────────────────────────────────────────────────────
function OrderRow({ order, onAction }: { order: Order; onAction: (type: string, order: Order) => void }) {
  const [expanded, setExpanded] = useState(false);

  const dateStr = new Date(order.createdAt).toLocaleTimeString('ro-RO', {
    hour: '2-digit', minute: '2-digit',
  });

  const hasInvoice  = !!order.invoice;
  const hasShipment = !!order.shipment;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12, overflow: 'hidden', marginBottom: 8,
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 15, fontFamily: 'monospace' }}>
              {order.name}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>{dateStr}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ProcDot status={order.processingStatus} />
            <span style={{
              color: 'rgba(255,255,255,0.4)',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              display: 'inline-flex', transition: 'transform 0.2s',
            }}>
              <IconChevron />
            </span>
          </div>
        </div>

        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 500 }}>
          {order.customer.name}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge
            exists={hasInvoice}
            label={hasInvoice ? `Factura ${order.invoice!.series}${order.invoice!.number}` : 'Factura'}
            type="invoice"
          />
          <StatusBadge
            exists={hasShipment}
            label={hasShipment ? `AWB ${order.shipment!.tracking}` : 'AWB'}
            type="shipment"
          />
        </div>

        {order.processingError && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8,
            background: 'rgba(239,68,68,0.1)', color: '#EF4444',
            fontSize: 12, fontWeight: 500,
          }}>
            <IconWarning /> {order.processingError}
          </div>
        )}
      </div>

      {expanded && (
        <div style={{
          padding: '12px 14px 14px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>
              {order.totalPrice} <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{order.currency}</span>
            </span>
            <span style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: order.financialStatus === 'paid' ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)',
              color: order.financialStatus === 'paid' ? '#22C55E' : '#FBBF24',
            }}>
              {order.financialStatus === 'paid' ? 'Platit' : 'In asteptare plata'}
            </span>
          </div>

          {order.customer.phone && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
              📞 {order.customer.phone}
            </div>
          )}

          {hasShipment && (
            <div style={{
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.2)',
            }}>
              <div style={{ color: '#22C55E', fontSize: 11, fontWeight: 700 }}>
                📦 {order.shipment!.courier} - {order.shipment!.tracking}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            {!hasInvoice && (
              <button onClick={e => { e.stopPropagation(); onAction('invoice', order); }} style={btnStyle('#F97316')}>
                <IconDoc /> Genereaza Factura
              </button>
            )}
            {hasInvoice && (
              <a href={order.invoice!.url} target="_blank" rel="noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ ...btnStyle('#F97316'), textDecoration: 'none' }}>
                <IconDoc /> Descarca Factura
              </a>
            )}
            {!hasShipment && (
              <button onClick={e => { e.stopPropagation(); onAction('awb', order); }} style={btnStyle('rgba(255,255,255,0.15)')}>
                <IconTruck /> Genereaza AWB
              </button>
            )}
            {hasShipment && (
              <a href={order.shipment!.labelUrl} target="_blank" rel="noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ ...btnStyle('rgba(34,197,94,0.2)'), textDecoration: 'none', color: '#22C55E' }}>
                <IconTruck /> Descarca AWB
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function XConnectorPage() {
  const [orders]              = useState<Order[]>(MOCK_ORDERS);
  const [search, setSearch]   = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('17/03/2026');
  const [courier, setCourier] = useState<string>('GLS');
  const [filter, setFilter]   = useState<string>('Toate');
  const [toast, setToast]     = useState<string | null>(null);

  const awbCount = orders.filter(o => o.shipment).length;
  const invCount = orders.filter(o => o.invoice).length;

  const showToast = (msg: string): void => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleAction = (type: string, order: Order): void => {
    if (type === 'invoice') showToast(`Factura generata pentru ${order.name}`);
    if (type === 'awb')     showToast(`AWB generat pentru ${order.name}`);
  };

  const filtered = orders.filter(o => {
    const matchSearch = !search ||
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      o.customer.name.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'Toate'        ? true :
      filter === 'Fara factura' ? !o.invoice :
      filter === 'Fara AWB'     ? !o.shipment :
      filter === 'Complet'      ? (!!o.invoice && !!o.shipment) :
      filter === 'Eroare'       ? o.processingStatus === 'failed' : true;
    return matchSearch && matchFilter;
  });

  type NavItem = { icon: string; label: string; active: boolean };
  const navItems: NavItem[] = [
    { icon: '📦', label: 'COMENZI', active: false },
    { icon: '⚡', label: 'XCONNECTOR', active: true },
    { icon: '📊', label: 'STATS', active: false },
    { icon: '¥', label: 'PROFIT', active: false },
    { icon: '💬', label: 'CHAT', active: false },
    { icon: '🚢', label: 'IMPORT', active: false },
  ];

  const filterLabels = ['Toate', 'Fara factura', 'Fara AWB', 'Complet', 'Eroare'];

  return (
    <div style={{
      minHeight: '100vh', background: '#0F0F0F',
      fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
      maxWidth: 480, margin: '0 auto', position: 'relative',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 16px 0', position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(15,15,15,0.95)', backdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconBolt />
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>xConnector</span>
          </div>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 20,
            padding: '6px 12px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            🇷🇴 Romania
          </button>
        </div>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)' }}>
            <IconSearch />
          </span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cauta comanda, client..."
            style={{
              width: '100%', padding: '11px 12px 11px 38px',
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, color: '#fff', fontSize: 14,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <select value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={selectStyle}>
            <option>17/03/2026</option><option>16/04/2026</option>
          </select>
          <select value={courier} onChange={e => setCourier(e.target.value)} style={selectStyle}>
            <option>GLS</option><option>Fan Courier</option><option>DPD</option>
          </select>
          <button onClick={() => showToast('Reimprospata!')} style={iconBtnStyle}>
            <IconRefresh /> Refresh
          </button>
          <button onClick={() => showToast('Sincronizat!')} style={iconBtnStyle}>
            <IconSync /> Sync
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' }}>
          {filterLabels.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              flexShrink: 0, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
              border: filter === f ? '1px solid #F97316' : '1px solid rgba(255,255,255,0.1)',
              background: filter === f ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.05)',
              color: filter === f ? '#F97316' : 'rgba(255,255,255,0.6)',
              fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: '4px 16px 12px', display: 'flex', gap: 8 }}>
        <div style={statCard}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>AWB Generate</div>
          <div style={{ color: '#F97316', fontSize: 26, fontWeight: 900 }}>{awbCount}</div>
        </div>
        <div style={statCard}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Facturi</div>
          <div style={{ color: '#22C55E', fontSize: 26, fontWeight: 900 }}>{invCount}</div>
        </div>
        <div style={statCard}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total</div>
          <div style={{ color: '#fff', fontSize: 26, fontWeight: 900 }}>{filtered.length}</div>
        </div>
      </div>

      {/* Legend */}
      <div style={{
        margin: '0 16px 10px', padding: '8px 12px', borderRadius: 8,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', gap: 14, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Legenda:</span>
        <span style={{ fontSize: 11, color: '#F97316', display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconCheck /> Factura generata
        </span>
        <span style={{ fontSize: 11, color: '#22C55E', display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconCheck /> AWB generat
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconXMark /> Lipsa
        </span>
      </div>

      {/* Orders */}
      <div style={{ padding: '0 16px 100px' }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
            Nicio comanda gasita
          </div>
        )}
        {filtered.map(order => (
          <OrderRow key={order.id} order={order} onAction={handleAction} />
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: '#1A1A1A', border: '1px solid rgba(249,115,22,0.4)',
          color: '#fff', padding: '10px 20px', borderRadius: 20,
          fontSize: 13, fontWeight: 600, zIndex: 999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
        }}>
          Rezolvat: {toast}
        </div>
      )}

      {/* Bottom nav */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480,
        background: 'rgba(15,15,15,0.97)', backdropFilter: 'blur(16px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', justifyContent: 'space-around',
        padding: '10px 0 20px',
      }}>
        {navItems.map(({ icon, label, active }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
            <span style={{ fontSize: 20 }}>{icon}</span>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3, color: active ? '#F97316' : 'rgba(255,255,255,0.35)' }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
