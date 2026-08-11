'use client';
/**
 * app/fulfillment/invoice-flow.js
 * Invoice creation for the Fulfillment page — via /api/connector/invoice, the
 * same server-env-based, DB-backed, multi-shop-aware endpoint xConnector and
 * app/gls/page.js already use (idempotent: ensureInvoice() no-ops if an
 * invoice already exists for the order). Replaces the old fulfillment page's
 * separate /api/smartbill-invoice flow (client-supplied credentials).
 */
import { useState } from 'react';

export async function createInvoice(order, shopKey, opts) {
  const res = await fetch('/api/connector/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shopifyOrderId: order.id,
      shop: shopKey,
      withCollection: opts.withCollection,
      useStock: opts.useStock,
      paymentType: opts.paymentType,
    }),
  });
  return res.json();
}

/**
 * Self-contained invoice creation modal.
 * Props: order (id,name,client,isCOD,total,currency,hasInvoice), shopKey, onClose(), onSuccess(data), toast(msg,type)
 */
export function InvoiceModal({ order, shopKey, onClose, onSuccess, toast }) {
  const [withCollection, setWithCollection] = useState(!order.isCOD);
  const [useStock, setUseStock] = useState(true);
  const [paymentType, setPaymentType] = useState(order.isCOD ? 'Ramburs' : 'Card');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setLoading(true); setResult(null);
    try {
      const data = await createInvoice(order, shopKey, { withCollection, useStock, paymentType });
      setResult(data);
      if (data.ok !== false && !data.error) {
        toast?.(`✅ Factură ${data.series}${data.number} generată!`, 'success');
        onSuccess?.(data);
      } else {
        toast?.('Eroare factură: ' + (data.error || '?'), 'error');
      }
    } catch (e) {
      setResult({ error: e.message });
      toast?.('Eroare rețea: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const success = result && result.series && !result.error;

  return (
    <div className="ff-overlay" onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="ff-modal" style={{ maxWidth: 460 }}>
        <div className="ff-modal-hdr">
          <div>
            <div className="ff-modal-title">🧾 Generare factură</div>
            <div className="ff-modal-sub">{order.name} • {order.client}</div>
          </div>
          <button className="ff-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="ff-modal-body">
          {success ? (
            <div className="ff-okbox">
              <div style={{ fontSize: 12, color: '#10b981', marginBottom: 4 }}>✅ Factură generată</div>
              <div className="ff-okbox-big">{result.series}{result.number}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                {result.downloadUrl && <a href={result.downloadUrl} target="_blank" rel="noopener noreferrer" className="ff-btn ff-btn-green">⬇ Descarcă PDF</a>}
                {result.smartbillUrl && <a href={result.smartbillUrl} target="_blank" rel="noopener noreferrer" className="ff-btn ff-btn-ghost">🌐 SmartBill</a>}
              </div>
            </div>
          ) : (
            <>
              {result?.error && <div className="ff-errbox">❌ {result.error}</div>}

              <div className="ff-toggle-row">
                <div>
                  <div className="ff-toggle-title" style={{ color: withCollection ? '#f59e0b' : '#94a3b8' }}>💰 Adaugă încasare</div>
                  <div className="ff-toggle-sub">{order.isCOD ? 'Comandă ramburs — activează dacă e cazul' : '✓ Auto-activat — comandă plătită online'}</div>
                </div>
                <button type="button" className={`ff-toggle${withCollection ? ' on' : ''}`} onClick={() => setWithCollection(v => !v)} />
              </div>

              {withCollection && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {['Card', 'Ramburs', 'Chitanta', 'Ordin plata'].map(t => (
                    <button key={t} type="button" onClick={() => setPaymentType(t)}
                      className={`ff-paytype${paymentType === t ? ' active' : ''}`}>
                      {t === 'Card' ? '💳' : t === 'Ramburs' ? '💵' : t === 'Chitanta' ? '🧾' : '🏦'} {t}
                    </button>
                  ))}
                </div>
              )}

              <div className="ff-toggle-row">
                <div>
                  <div className="ff-toggle-title" style={{ color: useStock ? '#60a5fa' : '#94a3b8' }}>🏬 Utilizează Gestiunea mărfuri</div>
                  <div className="ff-toggle-sub">Scade din stoc SmartBill la generare</div>
                </div>
                <button type="button" className={`ff-toggle${useStock ? ' on' : ''}`} onClick={() => setUseStock(v => !v)} />
              </div>
            </>
          )}
        </div>

        <div className="ff-modal-ftr">
          {success ? (
            <button className="ff-btn ff-btn-ghost" onClick={onClose}>Închide</button>
          ) : (
            <>
              <button className="ff-btn ff-btn-ghost" onClick={onClose}>Anulează</button>
              <button className="ff-btn ff-btn-primary" onClick={submit} disabled={loading}>
                {loading ? <><span className="ff-spin">↻</span> Se generează...</> : `🧾 Generează${withCollection ? ' + Încasează' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
