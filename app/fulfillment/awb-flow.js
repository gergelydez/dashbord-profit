'use client';
/**
 * app/fulfillment/awb-flow.js
 * AWB creation modal for the Fulfillment page — adapted 1:1 from the proven
 * flow in app/gls/page.js (same /api/gls contract, same GLS_SERVICES catalog,
 * same label download logic), instead of the old fulfillment page's separate
 * (less tested) payload-building code.
 *
 * Sameday runs through the unified /api/connector/shipment pipeline (same
 * one xConnector's "Procesare" page uses for GLS), with full easybox support:
 * locker picker (manual search or auto-detected from the order's shipping
 * method/address/note_attributes), sender easybox drop-off, and the
 * "verificare colet" (openPackage) delivery option.
 */
import { useState, useEffect } from 'react';

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

/**
 * Creates a GLS AWB — same payload/contract as app/gls/page.js's createAWB —
 * then persists it via /api/connector/save-awb, exactly like xConnector does
 * after its own GLS call. Without this, an AWB created here would only live
 * in local React state: reloading the page (or viewing the order from
 * xConnector/GLS) would show it as not shipped, since our DB's Shipment
 * table would never actually get the row.
 */
export async function createGlsAwb(order, addr, services, weight, parcels, content, observation, shopKey) {
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
  const data = await res.json();

  if (data.ok) {
    try {
      const sr = await fetch('/api/connector/save-awb', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopifyOrderId: order.id, shop: shopKey, courier: 'gls',
          trackingNumber: data.awb, trackingUrl: data.trackUrl, labelBase64: data.labelBase64 || null,
        }),
      });
      const sd = await sr.json();
      if (sd.ok && sd.labelUrl) data.persistedLabelUrl = sd.labelUrl;
    } catch {
      // Non-fatal — the AWB was created with GLS either way; save-awb only persists it for later.
    }
  }
  return data;
}

/**
 * Caută lockere Sameday (easybox) după județ/oraș — folosește credențialele
 * server (SAMEDAY_USERNAME/PASSWORD din Vercel env vars, la fel ca restul
 * integrării Sameday — xConnector trimite deja username/password goale pe
 * /api/sameday-awb și se bazează pe acest fallback server-side).
 */
export async function fetchSamedayLockers(county, city) {
  const res = await fetch('/api/sameday-awb', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_lockers', county: county || '', city: city || '' }),
  });
  return res.json(); // { ok, lockers:[{id,name,address,city,county,postalCode}], total } | { ok:false, error }
}

const stripDiacritics = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Best-effort: detectează dacă o comandă a fost plasată pentru livrare la
 * easybox, pe baza a ce trimite Shopify — nu există un câmp standard, deci
 * verificăm toate sursele plauzibile, în ordinea încrederii:
 *  1. atributele LocationId + LocationName (+ ConnectorType) — scrise de
 *     aplicația de easybox folosită la checkout (confirmat pe o comandă
 *     reală: "ConnectorType: Sameday", "LocationId: 1717", "LocationName:
 *     easybox Fratiei"). LocationId poate fi un ID intern al aplicației, nu
 *     neapărat identic cu ID-ul din /api/client/lockers al Sameday — de-aia
 *     returnăm și LocationName ca nameHint, ca LockerPicker să confirme
 *     locker-ul real prin căutare după nume și să folosească LocationId doar
 *     ca ultimă soluție dacă nicio potrivire de nume nu iese.
 *  2. numele metodei de shipping alese la checkout (ex: "Sameday Easybox").
 *  3. alt atribut cu "locker"/"easybox" în nume — valoare numerică = ID direct.
 *  4. address2 — unele aplicații de easybox scriu acolo numele/adresa locker-ului.
 * Dacă nu găsește nimic clar, întoarce null — nu activăm nimic automat, UI-ul
 * rămâne pe livrare normală și utilizatorul poate activa manual easybox-ul.
 */
export function detectEasyboxHint(order) {
  const notes = order.noteAttributes || {};

  const locationId   = notes.LocationId   || notes.locationId   || notes.location_id;
  const locationName = notes.LocationName || notes.locationName || notes.location_name;
  if (locationId || locationName) {
    const connectorType = notes.ConnectorType || notes.connectorType || '';
    return {
      lockerId: /^\d+$/.test(String(locationId || '').trim()) ? String(locationId).trim() : '',
      nameHint: (locationName || '').trim(),
      source: `LocationName="${locationName || ''}"${locationId ? ` (LocationId ${locationId})` : ''}${connectorType ? `, ${connectorType}` : ''}`,
    };
  }

  const shippingMethod = order.shippingMethod || '';
  if (shippingMethod && /easybox|locker/.test(stripDiacritics(shippingMethod))) {
    return { lockerId: '', nameHint: '', source: `metoda de livrare „${shippingMethod}"` };
  }

  for (const [k, v] of Object.entries(notes)) {
    if (/locker|easybox/i.test(k) && /^\d+$/.test(String(v).trim())) {
      return { lockerId: String(v).trim(), nameHint: '', source: `atribut comandă "${k}"` };
    }
  }

  const address2 = order.address2 || '';
  if (address2 && /easybox|locker/.test(stripDiacritics(address2))) {
    return { lockerId: '', nameHint: address2.trim(), source: `adresă (rând 2): „${address2}"` };
  }
  return null;
}

/** Caută cea mai bună potrivire pentru un nume/adresă de locker într-o listă deja încărcată. */
export function matchLockerByName(lockers, nameHint) {
  if (!nameHint || !lockers?.length) return null;
  const h = stripDiacritics(nameHint);
  return lockers.find(l => h.includes(stripDiacritics(l.name)) || stripDiacritics(l.name).includes(h))
    || lockers.find(l => h.includes(stripDiacritics(l.address)) || stripDiacritics(l.address).includes(h))
    || null;
}

/**
 * Sameday AWB — trece prin pipeline-ul unificat /api/connector/shipment
 * (lib/services/shipment-service.ts → lib/couriers/sameday.ts), exact ca
 * xConnector: idempotent, descarcă + salvează eticheta PDF reală de la
 * Sameday, scrie rândul Shipment în DB și creează fulfillment-ul în Shopify
 * — nimic din asta nu se întâmpla înainte (AWB-ul exista doar la Sameday și
 * în starea locală a paginii, dispărea la refresh).
 */
export async function createSamedayAwb(order, addr, weight, parcels, content, observation, shopKey, extra = {}) {
  const payload = {
    shopifyOrderId: order.id,
    shop: shopKey,
    courier: 'sameday',
    courierOptions: {
      weight: parseFloat(weight) || 1,
      parcels: parseInt(parcels) || 1,
      content: (content || order.prods || 'Colet').slice(0, 100),
      insuredValue: extra.insuredValue || undefined,
      openPackage: !!extra.openPackage,
      saturdayDelivery: !!extra.saturdayDelivery,
      repaymentTransport: !!extra.repaymentTransport,
      thermo: !!extra.thermo,
      lockerId: extra.lockerId || undefined,
      senderEasyboxId: extra.senderEasyboxId || undefined,
      notifyCustomer: !!extra.notifyCustomer,
    },
    overrides: {
      recipientName: addr.name || order.client,
      recipientPhone: addr.phone || order.phone,
      recipientEmail: addr.email || order.clientEmail,
      recipientAddress: addr.address || order.address,
      recipientCity: addr.city || order.oras,
      recipientCounty: addr.county || order.county,
      recipientZip: (addr.zip || order.zip || '').replace(/\s/g, ''),
      productName: content || order.prods,
      observations: observation || '',
      isCOD: !!order.isCOD,
      codAmount: order.total,
    },
  };
  const res = await fetch('/api/connector/shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!data.ok && !data.error) return { ok: false, error: 'Eroare necunoscută Sameday' };
  if (data.trackingNumber) {
    return { ok: true, awb: data.trackingNumber, trackUrl: data.trackingUrl, labelUrl: data.labelUrl, mode: (extra.lockerId || extra.senderEasyboxId) ? 'easybox' : 'standard' };
  }
  return data;
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
 * "Verifică colet" — istoricul complet de scanări al unui AWB (GLS sau
 * Sameday), prin /api/tracking — același endpoint deja dovedit în pagina
 * Comenzi. Util mai ales pentru easybox: arată exact dacă/când coletul a
 * ajuns la locker, nu doar statusul curent.
 */
export function TrackingHistoryModal({ order, onClose }) {
  const [state, setState] = useState({ loading: true, history: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/tracking?awb=${order.trackingNo}&courier=${order.courier || 'gls'}`);
        const d = await r.json();
        if (cancelled) return;
        if (d.error) setState({ loading: false, history: [], error: d.error });
        else setState({ loading: false, history: d.history || [], error: '' });
      } catch (e) {
        if (!cancelled) setState({ loading: false, history: [], error: e.message });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.trackingNo, order.courier]);

  return (
    <div className="ff-overlay" onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="ff-modal" style={{ maxWidth: 480 }}>
        <div className="ff-modal-hdr">
          <div>
            <div className="ff-modal-title">📋 Istoric scanări {order.name}</div>
            <div className="ff-modal-sub" style={{ fontFamily: 'monospace' }}>{order.trackingNo} · {order.courier === 'sameday' ? 'Sameday' : 'GLS'}</div>
          </div>
          <button className="ff-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="ff-modal-body">
          {state.loading ? (
            <div style={{ textAlign: 'center', color: '#475569', fontSize: 12, padding: '24px 0' }}>⟳ Se încarcă...</div>
          ) : state.error ? (
            <div className="ff-errbox">⚠ {state.error}</div>
          ) : state.history.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#475569', fontSize: 12, padding: '24px 0' }}>Niciun eveniment de tracking găsit.</div>
          ) : (
            <div>
              {state.history.map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: i < state.history.length - 1 ? '1px solid #1e2a35' : 'none' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 2 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? '#f97316' : '#334155' }} />
                    {i < state.history.length - 1 && <div style={{ width: 1, flex: 1, background: '#1e2a35', marginTop: 4 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {h.code != null && h.code !== '' && <span style={{ fontSize: 10, fontWeight: 800, background: 'rgba(59,130,246,.15)', color: '#93c5fd', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace' }}>#{h.code}</span>}
                      <span style={{ fontSize: 12, fontWeight: 600, color: i === 0 ? '#f97316' : '#cbd5e1' }}>{h.description || '—'}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                      {h.date && <span>{String(h.date).slice(0, 16).replace('T', ' ')}</span>}
                      {h.location && <span> · 📍{h.location}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ff-modal-ftr">
          <button className="ff-btn ff-btn-ghost" onClick={onClose}>Închide</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Căutare + selectare easybox Sameday după județ/oraș. `selectedId` arată ca
 * selectat chiar dacă nu mai e în ultimele rezultate afișate (ex. ales prin
 * auto-detectare, înainte de orice căutare manuală).
 */
function LockerPicker({ defaultCounty, defaultCity, selectedId, onSelect, nameHint, fallbackId }) {
  const [county, setCounty] = useState(defaultCounty || '');
  const [city, setCity] = useState(defaultCity || '');
  const [lockers, setLockers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    setLoading(true); setError(''); setSearched(true);
    const data = await fetchSamedayLockers(county, city);
    setLoading(false);
    if (!data.ok) { setError(data.error || 'Eroare la căutarea lockerelor.'); setLockers([]); return []; }
    setLockers(data.lockers || []);
    return data.lockers || [];
  };

  // Avem un indiciu de nume (din auto-detectare) dar nu un ID exact — căutăm
  // automat în județul/orașul comenzii și încercăm o potrivire fuzzy, fără
  // să-l obligăm pe utilizator să apese el însuși "Caută lockere". Dacă nu
  // găsim nicio potrivire de nume (aplicația de easybox poate folosi alt
  // nume decât cel real la Sameday), cădem pe fallbackId brut, dacă există.
  useEffect(() => {
    if (!nameHint || selectedId) return;
    (async () => {
      const found = await search();
      const match = matchLockerByName(found, nameHint);
      if (match) onSelect(String(match.id));
      else if (fallbackId) onSelect(fallbackId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ background: '#080d12', border: '1px solid #1a2535', borderRadius: 10, padding: 10, marginTop: 8 }}>
      <div className="ff-grid2" style={{ marginBottom: 8 }}>
        <div className="ff-field"><label className="ff-lbl">Județ</label><input className="ff-inp" value={county} onChange={e => setCounty(e.target.value)} /></div>
        <div className="ff-field"><label className="ff-lbl">Oraș</label><input className="ff-inp" value={city} onChange={e => setCity(e.target.value)} /></div>
      </div>
      <button type="button" className="ff-btn ff-btn-ghost" style={{ width: '100%', justifyContent: 'center' }} disabled={loading} onClick={search}>
        {loading ? <span className="ff-spin">↻</span> : '🔍'} Caută lockere
      </button>

      {selectedId && (() => {
        const sel = lockers.find(l => String(l.id) === String(selectedId));
        return (
          <div style={{ marginTop: 8, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: '#10b981' }}>
            ✓ Selectat: {sel ? `${sel.name} — ${sel.address}, ${sel.city}` : `locker #${selectedId}`}
          </div>
        );
      })()}
      {error && <div className="ff-errbox" style={{ marginTop: 8 }}>{error}</div>}
      {searched && !loading && !error && lockers.length === 0 && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Niciun easybox găsit pentru acest județ/oraș.</div>
      )}
      {lockers.length > 0 && (
        <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {lockers.map(l => {
            const active = String(l.id) === String(selectedId);
            return (
              <div
                key={l.id}
                onClick={() => onSelect(String(l.id))}
                style={{
                  background: active ? 'rgba(249,115,22,.1)' : '#0c1018',
                  border: `1px solid ${active ? '#f97316' : 'rgba(255,255,255,.07)'}`,
                  borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: active ? '#f97316' : '#e2e8f0' }}>{active ? '✓ ' : ''}{l.name}</div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>{l.address}, {l.city} {l.county ? `(${l.county})` : ''}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Toggle chip reutilizat pentru livrare/predare easybox și opțiuni Sameday. */
function Chip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`ff-courier-tab${active ? ' active' : ''}`} style={{ flex: 'none', padding: '7px 12px' }}>
      {children}
    </button>
  );
}

/** Secțiunea completă de opțiuni Sameday: livrare la easybox, predare la easybox, servicii extra. */
function SamedayOptions({ editAddr, deliveryMode, setDeliveryMode, pickupMode, setPickupMode, lockerId, setLockerId, senderLockerId, setSenderLockerId, autoDetected, options, setOptions }) {
  const toggleOpt = key => setOptions(p => ({ ...p, [key]: !p[key] }));
  return (
    <div>
      {autoDetected && (
        <div className="ff-infobox" style={{ marginBottom: 8 }}>
          📍 Easybox detectat automat din comandă ({autoDetected.source}). Verifică mai jos că e cel corect.
        </div>
      )}

      <div className="ff-section-title">📦 Livrare către destinatar</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <Chip active={deliveryMode === 'address'} onClick={() => setDeliveryMode('address')}>🏠 La adresă</Chip>
        <Chip active={deliveryMode === 'easybox'} onClick={() => setDeliveryMode('easybox')}>🔒 La easybox</Chip>
      </div>
      {deliveryMode === 'easybox' && (
        <LockerPicker
          defaultCounty={editAddr.county} defaultCity={editAddr.city}
          selectedId={lockerId} onSelect={setLockerId}
          nameHint={autoDetected?.nameHint} fallbackId={autoDetected?.lockerId}
        />
      )}

      <div className="ff-section-title" style={{ marginTop: 14 }}>🏭 Predare colet (expeditor)</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <Chip active={pickupMode === 'courier'} onClick={() => setPickupMode('courier')}>🚐 Ridicare de curier</Chip>
        <Chip active={pickupMode === 'easybox'} onClick={() => setPickupMode('easybox')}>🔒 Predau la easybox</Chip>
      </div>
      {pickupMode === 'easybox' && (
        <LockerPicker selectedId={senderLockerId} onSelect={(id) => setSenderLockerId(id)} />
      )}

      <div className="ff-section-title" style={{ marginTop: 14 }}>⚙️ Opțiuni livrare</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
          <input type="checkbox" checked={options.openPackage} onChange={() => toggleOpt('openPackage')} />
          📦 Verificare colet la livrare (destinatarul poate deschide coletul înainte să plătească ramburs)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
          <input type="checkbox" checked={options.saturdayDelivery} onChange={() => toggleOpt('saturdayDelivery')} />
          📅 Livrare sâmbăta
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
          <input type="checkbox" checked={options.notifyCustomer} onChange={() => toggleOpt('notifyCustomer')} />
          🔔 Notifică clientul în Shopify (fulfillment)
        </label>
      </div>
    </div>
  );
}

/**
 * Self-contained AWB creation modal.
 * Props: order (id,name,client,phone,email,address,city,county,zip,isCOD,total,currency,prods,addrIssues,trackingNo,courier),
 *        onClose(), onSuccess(awbData), toast(msg,type)
 */
export function AwbModal({ order, shopKey, onClose, onSuccess, toast }) {
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
  const [awbLoading, setAwbLoading] = useState(false);
  const [awbResult, setAwbResult] = useState(null);
  const [downloadingAwb, setDownloadingAwb] = useState(false);

  // ── Sameday: easybox / opțiuni livrare ──────────────────────────────────
  const [sdDeliveryMode, setSdDeliveryMode] = useState('address'); // 'address' | 'easybox'
  const [sdPickupMode, setSdPickupMode] = useState('courier');     // 'courier' | 'easybox' — predare colet
  const [sdLockerId, setSdLockerId] = useState('');                // locker DESTINATAR ales
  const [sdSenderLockerId, setSdSenderLockerId] = useState('');    // locker PREDARE ales
  const [sdAutoDetected, setSdAutoDetected] = useState(null);      // { source } când detectat automat
  const [sdOptions, setSdOptions] = useState({ openPackage: false, saturdayDelivery: false, repaymentTransport: false, thermo: false, notifyCustomer: true });

  // Auto-detectare easybox din comandă — o singură dată, la deschiderea
  // modalului. Dacă avem un nume de locker (LocationName etc.), preferăm să-l
  // căutăm la Sameday prin LockerPicker (garantează un ID real) — ID-ul brut
  // detectat rămâne doar fallback dacă acea căutare nu găsește nicio potrivire.
  useEffect(() => {
    const hint = detectEasyboxHint(order);
    if (!hint) return;
    setSdDeliveryMode('easybox');
    setSdAutoDetected(hint);
    if (hint.lockerId && !hint.nameHint) setSdLockerId(hint.lockerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSvc = code => setSelectedServices(p => { const n = { ...p }; if (n[code]) delete n[code]; else n[code] = true; return n; });

  const alreadyHasAwb = !!order.trackingNo;

  const submit = async () => {
    if (courier === 'sameday' && sdDeliveryMode === 'easybox' && !sdLockerId) {
      setAwbResult({ ok: false, error: 'Alege un easybox pentru destinatar (sau comută pe livrare la adresă).' });
      return;
    }
    if (courier === 'sameday' && sdPickupMode === 'easybox' && !sdSenderLockerId) {
      setAwbResult({ ok: false, error: 'Alege un easybox pentru predarea coletului (sau comută pe ridicare de curier).' });
      return;
    }
    setAwbLoading(true); setAwbResult(null);
    try {
      const data = courier === 'gls'
        ? await createGlsAwb(order, editAddr, selectedServices, weight, parcels, content, observation, shopKey)
        : await createSamedayAwb(order, editAddr, weight, parcels, content, observation, shopKey, {
            ...sdOptions,
            lockerId: sdDeliveryMode === 'easybox' ? sdLockerId : undefined,
            senderEasyboxId: sdPickupMode === 'easybox' ? sdSenderLockerId : undefined,
          });

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
                {courier === 'gls' ? (
                  <button className="ff-btn ff-btn-green" disabled={downloadingAwb} onClick={download}>
                    {downloadingAwb ? <span className="ff-spin">↻</span> : '⬇'} Descarcă PDF
                  </button>
                ) : (
                  awbResult.labelUrl && (
                    <a href={awbResult.labelUrl} target="_blank" rel="noopener noreferrer" className="ff-btn ff-btn-green">⬇ Descarcă PDF</a>
                  )
                )}
                <a
                  href={courier === 'gls' ? `https://gls-group.eu/RO/ro/urmarire-colet?match=${awbResult.awb}` : `https://sameday.ro/awb/${awbResult.awb}`}
                  target="_blank" rel="noopener noreferrer" className="ff-btn ff-btn-blue"
                >📍 Tracking</a>
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
                <SamedayOptions
                  editAddr={editAddr}
                  deliveryMode={sdDeliveryMode} setDeliveryMode={setSdDeliveryMode}
                  pickupMode={sdPickupMode} setPickupMode={setSdPickupMode}
                  lockerId={sdLockerId} setLockerId={setSdLockerId}
                  senderLockerId={sdSenderLockerId} setSenderLockerId={setSdSenderLockerId}
                  autoDetected={sdAutoDetected}
                  options={sdOptions} setOptions={setSdOptions}
                />
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
