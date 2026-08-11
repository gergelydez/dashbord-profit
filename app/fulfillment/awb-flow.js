'use client';
/**
 * app/fulfillment/awb-flow.js
 * AWB creation modal for the Fulfillment page — adapted 1:1 from the proven
 * flow in app/gls/page.js (same /api/gls contract, same GLS_SERVICES catalog,
 * same label download logic), instead of the old fulfillment page's separate
 * (less tested) payload-building code.
 *
 * Sameday is kept as a lightweight secondary courier option via the existing
 * /api/sameday-awb endpoint (credentials still user-supplied, stored in
 * localStorage — unchanged from before), without the full locker/easybox UI.
 */
import { useState } from 'react';

export const GLS_SERVICES = {
  SM1: { code: 'SM1', label: '📱 SMS Livrare',       desc: 'SMS trimis destinatarului la livrare',      param: 'phone',  group: 'Notificări' },
  SM2: { code: 'SM2', label: '📧 SMS + Email',        desc: 'Notificare SMS și email la livrare',        param: 'email',  group: 'Notificări' },
  FDS: { code: 'FDS', label: '🕐 FlexDelivery Email', desc: 'Destinatarul alege ora/locul via email',    param: 'email',  group: 'Flex' },
  FSS: { code: 'FSS', label: '💬 FlexDelivery SMS',  desc: 'Destinatarul alege ora/locul via SMS',      param: 'phone',  group: 'Flex' },
  SAT: { code: 'SAT', label: '📅 Livrare Sâmbătă',   desc: 'Garantat livrat sâmbătă',                   param: null,     group: 'Livrare' },
  T12: { code: 'T12', label: '⏰ Până 12:00',         desc: 'Garantat livrat înainte de prânz',          param: null,     group: 'Livrare' },
  AOS: { code: 'AOS', label: '✍️ Semnătură',          desc: 'Confirmare livrare prin semnătură',         param: null,     group: 'Livrare' },
  DPV: { code: 'DPV', label: '🏠 Adresă privată',    desc: 'Livrare numai la adresa destinatarului',    param: null,     group: 'Livrare' },
  INS: { code: 'INS', label: '🛡️ Asigurare',          desc: 'Asigurare pentru valoarea declarată',       param: 'value',  group: 'Extra' },
  SDS: { code: 'SDS', label: '↩️ Shop Return',        desc: 'Return facilitat prin shop GLS',            param: null,     group: 'Extra' },
};
export const SERVICE_GROUPS = ['Notificări', 'Flex', 'Livrare', 'Extra'];

const ls = {
  get: k => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') localStorage.setItem(k, v); } catch {} },
};

function b64ToBlob(b64, mime) {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function triggerPdfDownload(base64, filename) {
  const blob = b64ToBlob(base64, 'application/pdf');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Creates a GLS AWB — same payload/contract as app/gls/page.js's createAWB. */
export async function createGlsAwb(order, addr, services, weight, parcels, content, observation) {
  const payload = {
    recipientName: addr.name    || order.client,
    phone:         addr.phone   || order.phone,
    email:         addr.email   || order.clientEmail,
    address:       addr.address || order.address,
    city:          addr.city    || order.oras,
    county:        addr.county  || order.county,
    zip:           (addr.zip    || order.zip || '').replace(/\s/g, ''),
    weight:        parseFloat(weight) || 1,
    parcels:       parseInt(parcels)  || 1,
    content:       content || order.prods?.slice(0, 40) || 'Colet',
    codAmount:     order.isCOD ? order.total : 0,
    codCurrency:   order.currency || 'RON',
    orderName:     order.name,
    orderId:       order.id,
    selectedServices: services,
    observations:  observation || '',
  };
  const res = await fetch('/api/gls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return res.json();
}

/** Minimal Sameday AWB — secondary option, core fields only (no locker/easybox UI). */
export async function createSamedayAwb(order, addr, weight, parcels, content, observation, sdUser, sdPass) {
  const payload = {
    username: sdUser, password: sdPass,
    recipientName: addr.name    || order.client,
    phone:         addr.phone   || order.phone,
    email:         addr.email   || order.clientEmail,
    address:       addr.address || order.address,
    city:          addr.city    || order.oras,
    county:        addr.county  || order.county,
    zip:           (addr.zip    || order.zip || '').replace(/\s/g, ''),
    weight:        parseFloat(weight) || 1,
    parcels:       parseInt(parcels)  || 1,
    content:       (content || order.prods || 'Colet').slice(0, 100),
    isCOD:         order.isCOD,
    total:         order.total,
    orderName:     order.name,
    orderId:       order.id,
    observations:  observation || (order.prods || '').slice(0, 100) || `Comanda ${order.name}`,
  };
  const res = await fetch('/api/sameday-awb', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return res.json();
}

/** Re-download a GLS label — same fallback chain as app/gls/page.js's downloadLabel. */
export async function downloadGlsLabel(awbData, orderName, fallbackAwb) {
  const awbNum = awbData?.awb || fallbackAwb || '';
  try {
    if (awbData?.labelBase64) {
      triggerPdfDownload(awbData.labelBase64, `AWB_GLS_${awbNum}_${orderName || ''}.pdf`);
      return { ok: true };
    }
    if (awbData?.parcelId) {
      const res = await fetch('/api/gls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_label', parcelId: awbData.parcelId, awb: awbNum }) });
      const data = await res.json();
      if (data.ok && data.labelBase64) {
        triggerPdfDownload(data.labelBase64, `AWB_GLS_${awbNum}_${orderName || ''}.pdf`);
        return { ok: true, labelBase64: data.labelBase64 };
      }
    }
    if (awbNum) {
      const res = await fetch('/api/gls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_label_by_awb', awb: awbNum }) });
      const data = await res.json();
      if (data.ok && data.labelBase64) {
        triggerPdfDownload(data.labelBase64, `AWB_GLS_${awbNum}_${orderName || ''}.pdf`);
        return { ok: true, labelBase64: data.labelBase64, parcelId: data.parcelId };
      }
      return { ok: false, error: data.error || 'Eticheta nu a putut fi obținută din GLS.' };
    }
    return { ok: false, error: 'Nu există date suficiente pentru descărcare. Regenerează AWB-ul.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Self-contained AWB creation modal.
 * Props: order (id,name,client,phone,email,address,city,county,zip,isCOD,total,currency,prods,addrIssues,trackingNo,courier),
 *        onClose(), onSuccess(awbData), toast(msg,type)
 */
export function AwbModal({ order, onClose, onSuccess, toast }) {
  const [courier, setCourier] = useState('gls');
  const [weight, setWeight] = useState('1');
  const [parcels, setParcels] = useState('1');
  const [content, setContent] = useState(order.prods?.slice(0, 40) || 'Colet');
  const [observation, setObservation] = useState('');
  const [selectedServices, setSelectedServices] = useState({});
  const [editAddr, setEditAddr] = useState({
    name: order.client, phone: order.phone, email: order.clientEmail,
    address: order.address, city: order.oras, county: order.county, zip: order.zip,
  });
  const [sdUser, setSdUser] = useState(() => ls.get('fb_sd_user') || '');
  const [sdPass, setSdPass] = useState(() => ls.get('fb_sd_pass') || '');
  const [awbLoading, setAwbLoading] = useState(false);
  const [awbResult, setAwbResult] = useState(null);
  const [downloadingAwb, setDownloadingAwb] = useState(false);

  const toggleSvc = code => setSelectedServices(p => { const n = { ...p }; if (n[code]) delete n[code]; else n[code] = true; return n; });

  const alreadyHasAwb = !!order.trackingNo;

  const submit = async () => {
    setAwbLoading(true); setAwbResult(null);
    try {
      if (courier === 'sameday') {
        if (!sdUser || !sdPass) { setAwbResult({ ok: false, error: 'Completează username/parolă Sameday.' }); setAwbLoading(false); return; }
        ls.set('fb_sd_user', sdUser); ls.set('fb_sd_pass', sdPass);
      }
      const data = courier === 'gls'
        ? await createGlsAwb(order, editAddr, selectedServices, weight, parcels, content, observation)
        : await createSamedayAwb(order, editAddr, weight, parcels, content, observation, sdUser, sdPass);

      setAwbResult(data);
      if (data.ok) {
        toast?.(`✅ AWB ${courier === 'gls' ? 'GLS' : 'Sameday'} ${data.awb} generat!`, 'success');
        onSuccess?.({ ...data, courier });
      } else {
        toast?.('Eroare: ' + data.error, 'error');
      }
    } catch (e) {
      setAwbResult({ ok: false, error: e.message });
      toast?.('Eroare rețea: ' + e.message, 'error');
    } finally {
      setAwbLoading(false);
    }
  };

  const download = async () => {
    setDownloadingAwb(true);
    const r = await downloadGlsLabel(awbResult, order.name, awbResult?.awb);
    if (!r.ok) toast?.('❌ ' + r.error, 'error');
    setDownloadingAwb(false);
  };

  return (
    <div className="ff-overlay" onClick={e => { if (e.target === e.currentTarget && !awbResult?.ok) onClose?.(); }}>
      <div className="ff-modal">
        <div className="ff-modal-hdr">
          <div>
            <div className="ff-modal-title">🚚 Generare AWB</div>
            <div className="ff-modal-sub">{order.name} • {order.client}</div>
          </div>
          <button className="ff-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="ff-modal-body">
          {awbResult?.ok ? (
            <div className="ff-okbox">
              <div style={{ fontSize: 12, color: '#10b981', marginBottom: 4 }}>✅ AWB generat cu succes!</div>
              <div className="ff-okbox-big">{awbResult.awb}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                {courier === 'gls' && (
                  <button className="ff-btn ff-btn-green" disabled={downloadingAwb} onClick={download}>
                    {downloadingAwb ? <span className="ff-spin">↻</span> : '⬇'} Descarcă PDF
                  </button>
                )}
                <a href={`https://gls-group.eu/RO/ro/urmarire-colet?match=${awbResult.awb}`} target="_blank" rel="noopener noreferrer" className="ff-btn ff-btn-blue">📍 Tracking</a>
              </div>
            </div>
          ) : (
            <>
              {alreadyHasAwb && (
                <div className="ff-warnbox">⚠️ Comanda are deja AWB ({order.trackingNo}, {order.courier}). Continuă doar dacă vrei să regenerezi.</div>
              )}
              {order.addrIssues?.length > 0 && (
                <div className="ff-warnbox">
                  ⚠️ Probleme adresă:
                  <ul style={{ margin: '6px 0 0 16px' }}>{order.addrIssues.map((iss, i) => <li key={i}>{iss}</li>)}</ul>
                </div>
              )}
              {awbResult?.error && <div className="ff-errbox">❌ {awbResult.error}</div>}

              <div className="ff-courier-tabs">
                <button className={`ff-courier-tab${courier === 'gls' ? ' active' : ''}`} onClick={() => setCourier('gls')}>🚚 GLS</button>
                <button className={`ff-courier-tab${courier === 'sameday' ? ' active' : ''}`} onClick={() => setCourier('sameday')}>🚀 Sameday</button>
              </div>

              {courier === 'sameday' && (
                <div className="ff-grid2">
                  <div className="ff-field"><label className="ff-lbl">Username Sameday</label><input className="ff-inp" value={sdUser} onChange={e => setSdUser(e.target.value)} /></div>
                  <div className="ff-field"><label className="ff-lbl">Parolă Sameday</label><input type="password" className="ff-inp" value={sdPass} onChange={e => setSdPass(e.target.value)} /></div>
                </div>
              )}

              <div>
                <div className="ff-section-title">✏️ Date destinatar</div>
                <div className="ff-grid2">
                  {[
                    { key: 'name', label: 'Nume' }, { key: 'phone', label: 'Telefon' },
                    { key: 'email', label: 'Email' }, { key: 'city', label: 'Oraș' },
                    { key: 'county', label: 'Județ' }, { key: 'zip', label: 'Cod poștal', maxLength: 6 },
                  ].map(f => (
                    <div key={f.key} className="ff-field">
                      <label className="ff-lbl">{f.label}</label>
                      <input className="ff-inp" value={editAddr[f.key] || ''} maxLength={f.maxLength}
                        onChange={e => setEditAddr(p => ({ ...p, [f.key]: e.target.value }))} />
                    </div>
                  ))}
                  <div className="ff-field" style={{ gridColumn: '1/-1' }}>
                    <label className="ff-lbl">Adresă</label>
                    <input className="ff-inp" value={editAddr.address || ''} onChange={e => setEditAddr(p => ({ ...p, address: e.target.value }))} />
                  </div>
                </div>
              </div>

              <div>
                <div className="ff-section-title">📦 Colet</div>
                <div className="ff-grid2">
                  <div className="ff-field"><label className="ff-lbl">Greutate (kg)</label><input className="ff-inp" type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} /></div>
                  <div className="ff-field"><label className="ff-lbl">Nr. colete</label><input className="ff-inp" type="number" value={parcels} onChange={e => setParcels(e.target.value)} /></div>
                  <div className="ff-field" style={{ gridColumn: '1/-1' }}><label className="ff-lbl">Conținut</label><input className="ff-inp" value={content} maxLength={40} onChange={e => setContent(e.target.value)} /></div>
                  <div className="ff-field" style={{ gridColumn: '1/-1' }}><label className="ff-lbl">Observații</label><input className="ff-inp" value={observation} maxLength={100} onChange={e => setObservation(e.target.value)} /></div>
                </div>
              </div>

              {order.isCOD && (
                <div className="ff-infobox">💵 Ramburs {order.total} {order.currency} — colectat la livrare.</div>
              )}

              {courier === 'gls' && (
                <div>
                  <div className="ff-section-title">⚡ Servicii GLS</div>
                  {SERVICE_GROUPS.map(grp => (
                    <div key={grp}>
                      <div className="ff-svc-group">{grp}</div>
                      <div className="ff-svc-grid">
                        {Object.values(GLS_SERVICES).filter(s => s.group === grp).map(s => {
                          const active = !!selectedServices[s.code];
                          return (
                            <div key={s.code} className={`ff-svc-card${active ? ' active' : ''}`} onClick={() => toggleSvc(s.code)}>
                              <div className={`ff-svc-chk${active ? ' active' : ''}`}>{active ? '✓' : ''}</div>
                              <div>
                                <div className="ff-svc-name">{s.label}</div>
                                <div className="ff-svc-desc">{s.desc}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="ff-modal-ftr">
          {awbResult?.ok ? (
            <button className="ff-btn ff-btn-ghost" onClick={onClose}>Închide</button>
          ) : (
            <>
              <button className="ff-btn ff-btn-ghost" onClick={onClose}>Anulează</button>
              <button className="ff-btn ff-btn-primary" onClick={submit} disabled={awbLoading}>
                {awbLoading ? <><span className="ff-spin">↻</span> Se generează...</> : '🚚 Generează AWB'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
