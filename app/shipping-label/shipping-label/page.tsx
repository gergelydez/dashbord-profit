/**
 * app/shipping-label/page.tsx
 * Pagina dedicată pentru vizualizarea etichetei AWB
 * URL: /shipping-label?id=<shipmentId>
 * Afișează PDF-ul direct în browser, full-screen
 */
'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function ShippingLabelPage() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || '';
  const trackingNumber = searchParams.get('trackingNumber') || '';
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) setError('ID lipsă');
  }, [id]);

  if (error || !id) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#666' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Eticheta nu a fost găsită</div>
          <div style={{ fontSize: 14, marginTop: 8, color: '#999' }}>{error || 'ID invalid'}</div>
        </div>
      </div>
    );
  }

  const pdfUrl = `/api/connector/awb-label?id=${encodeURIComponent(id)}`;

  return (
    <div style={{ margin: 0, padding: 0, height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>
      {/* Header */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '12px 20px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🚚</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>Etichetă AWB</div>
            {trackingNumber && (
              <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#10b981', fontWeight: 600 }}>{trackingNumber}</div>
            )}
          </div>
        </div>
        <a
          href={pdfUrl}
          download={`AWB_${trackingNumber || id}.pdf`}
          style={{
            background: '#10b981', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 16px', fontSize: 13,
            fontWeight: 600, cursor: 'pointer', textDecoration: 'none',
            display: 'flex', alignItems: 'center', gap: 6
          }}
        >
          📥 Descarcă PDF
        </a>
      </div>

      {/* PDF viewer */}
      <iframe
        src={pdfUrl}
        style={{ flex: 1, border: 'none', width: '100%' }}
        title={`AWB ${trackingNumber}`}
      />
    </div>
  );
}
