'use client';
/**
 * components/profit/PriceCalculator.js
 * Calculator de preț de vânzare, izolat de comenzile reale din Shopify —
 * pentru testat "ce preț ar trebui să pun" / "ce profit rămâne la un preț
 * anume". Port al unui calculator de referință primit de la utilizator,
 * adaptat la React + tema aplicației. Toate sumele introduse de utilizator
 * pot fi marcate per-linie ca "fără TVA, +21%" (se adaugă TVA), "TVA inclus"
 * (se scoate din sumă) sau "factură fără TVA" (ex. Meta — taxare inversă,
 * se anulează în decont pentru un plătitor de TVA, deci nu e nimic de scos).
 */
import { useState, useEffect, useMemo } from 'react';

const KEY = 'glamx_price_calc_v1';
const VAT = 0.21;

const DEFAULTS = {
  cost: '145', ship: '18', shipVat: 'plus', mkt: '30', mktVat: 'none', profit: '30',
  orders: '150', china: '15', taxMode: 'profit', tax: '16', test: '', round: '99',
  monthly: [
    { name: 'Shopify și aplicații', amount: '400', vat: 'none' },
    { name: 'Contabilă', amount: '800', vat: 'incl' },
    { name: 'Ambalaje', amount: '200', vat: 'incl' },
  ],
};

const n = v => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : 0; };
const fmtN = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const L = v => fmtN.format(isFinite(v) ? v : 0) + ' lei';
const P = v => fmtN.format(isFinite(v) ? v : 0);

// fără TVA (+21% adăugat) · TVA inclus (scos din sumă) · factură fără TVA (nimic de scos)
const split = (a, mode) => mode === 'plus' ? [a, a * VAT] : mode === 'incl' ? [a / (1 + VAT), a - a / (1 + VAT)] : [a, 0];

function computeCalc(s) {
  const cost = n(s.cost), china = n(s.china);
  const vatImport = Math.max(cost - china, 0) * VAT;
  const [shipN, shipV] = split(n(s.ship), s.shipVat);
  const [mktN, mktV] = split(n(s.mkt), s.mktVat);
  const orders = n(s.orders);

  let mG = 0, mN = 0, mV = 0;
  s.monthly.forEach(m => { const a = n(m.amount); const [x, y] = split(a, m.vat); mG += x + y; mN += x; mV += y; });
  const perN = orders > 0 ? mN / orders : 0;
  const perV = orders > 0 ? mV / orders : 0;

  const C = cost + shipN + mktN + perN; // cost real, fără TVA recuperabil
  const r = n(s.tax) / 100, micro = s.taxMode === 'micro', profitTarget = n(s.profit);

  const at = (price) => {
    const Pn = price / (1 + VAT), vatOut = price - Pn, gross = Pn - C;
    const tax = micro ? Pn * r : Math.max(gross, 0) * r;
    return { P: price, Pn, vatOut, tax, prof: gross - tax };
  };

  const Pexact = (micro ? (C + profitTarget) / (1 - r) : C + profitTarget / (1 - r)) * (1 + VAT);

  const rnd = (p) => {
    if (!(p > 0)) return p;
    switch (s.round) {
      case 'int': return Math.ceil(p - 1e-9);
      case '99': return Math.ceil(p + 0.01 - 1e-9) - 0.01;
      case '9': return Math.ceil((p + 1) / 10 - 1e-9) * 10 - 1;
      default: return Math.round(p * 100) / 100;
    }
  };

  const rec = at(rnd(Pexact));
  const tp = n(s.test), testing = tp > 0;
  const cur = testing ? at(tp) : rec;
  const ded = vatImport + shipV + mktV + perV;
  const vatPay = cur.vatOut - ded;
  const breakEven = (micro ? C / (1 - r) : C) * (1 + VAT);

  return { cost, china, vatImport, shipN, shipV, mktN, mktV, orders, mG, mN, mV, perN, perV,
    C, r, micro, profitTarget, Pexact, rec, cur, tp, testing, ded, vatPay, breakEven };
}

export default function PriceCalculator() {
  const [s, setS] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setS(prev => ({ ...prev, ...JSON.parse(raw) }));
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }, [s, loaded]);

  const set = (k, v) => setS(prev => ({ ...prev, [k]: v }));
  const setMonthly = (i, k, v) => setS(prev => ({ ...prev, monthly: prev.monthly.map((m, j) => j === i ? { ...m, [k]: v } : m) }));
  const addMonthly = () => setS(prev => ({ ...prev, monthly: [...prev.monthly, { name: '', amount: '', vat: 'plus' }] }));
  const delMonthly = (i) => setS(prev => ({ ...prev, monthly: prev.monthly.filter((_, j) => j !== i) }));

  const calc = useMemo(() => computeCalc(s), [s]);
  const { cost, china, vatImport, orders, mG, C, r, micro, rec, cur, tp, testing, ded, vatPay, breakEven, Pexact } = calc;

  const bump = (delta) => {
    const base = n(s.test) || rec.P;
    set('test', fmtN.format(Math.max(0, Math.round((base + delta) * 100) / 100)).replace(/\./g, ''));
  };

  if (!loaded) return null;

  const inp = { background: '#070d12', border: '1px solid #1a2535', color: '#e8edf2', padding: '9px 10px', borderRadius: 8, fontSize: 14, outline: 'none', width: '100%', fontFamily: 'monospace', textAlign: 'right' };
  const inpL = { ...inp, textAlign: 'left', fontFamily: 'inherit' };
  const lbl = { fontSize: 13, color: '#e8edf2' };
  const sub = { fontSize: 11, color: '#64748b', display: 'block', marginTop: 1 };
  const sel = { background: '#070d12', border: '1px solid #1a2535', color: '#94a3b8', borderRadius: 8, padding: '7px 8px', fontSize: 11, outline: 'none' };
  const card = { background: '#0c1520', border: '1px solid #1a2535', borderRadius: 14, padding: '16px 18px', marginBottom: 14 };
  const rowGrid = { display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10, alignItems: 'center', padding: '9px 0', borderTop: '1px solid #1a2535' };

  const rl = (a, b, opts = {}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '3px 0', fontWeight: opts.bold ? 700 : 400,
      borderTop: opts.top ? '1px solid rgba(234,243,238,.2)' : 'none', marginTop: opts.top ? 4 : 0, paddingTop: opts.top ? 6 : 3 }}>
      <span style={{ color: opts.bold ? '#eaf3ee' : '#9dbbac' }}>{a}</span>
      <span style={{ fontFamily: 'monospace', color: opts.gold ? '#f2c14e' : undefined }}>{b}</span>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: '1fr', alignItems: 'start' }} className="pc-grid">
      <style>{`
        @media (min-width: 900px) { .pc-grid { grid-template-columns: minmax(0,1fr) 380px !important; } .pc-panel { position: sticky; top: 14px; } }
      `}</style>

      <main>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Costuri pe produs</div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
            Lângă fiecare cost alegi cum ai introdus suma: <b>fără TVA, +21%</b> (se adaugă TVA-ul de pe factură), <b>TVA inclus</b> (se scoate din sumă) sau <b>factură fără TVA</b> (ex. Meta — taxare inversă, se anulează în decont). TVA-ul se recuperează în toate cazurile.
          </div>

          <div style={rowGrid}>
            <div style={lbl}>Cost produs din NIR<span style={sub}>fără TVA, cu transport China inclus · TVA plătit în vamă: {L(vatImport)}</span></div>
            <input style={inp} inputMode="decimal" value={s.cost} onChange={e => set('cost', e.target.value)} />
          </div>

          <div style={{ ...rowGrid, gridTemplateColumns: '1fr 100px auto' }}>
            <div style={lbl}>Transport în România<span style={sub}>curier către client</span></div>
            <input style={inp} inputMode="decimal" value={s.ship} onChange={e => set('ship', e.target.value)} />
            <select style={sel} value={s.shipVat} onChange={e => set('shipVat', e.target.value)}>
              <option value="plus">fără TVA, +21%</option><option value="incl">TVA inclus</option><option value="none">factură fără TVA</option>
            </select>
          </div>

          <div style={{ ...rowGrid, gridTemplateColumns: '1fr 100px auto' }}>
            <div style={lbl}>Marketing<span style={sub}>cost reclame per comandă</span></div>
            <input style={inp} inputMode="decimal" value={s.mkt} onChange={e => set('mkt', e.target.value)} />
            <select style={sel} value={s.mktVat} onChange={e => set('mktVat', e.target.value)}>
              <option value="plus">fără TVA, +21%</option><option value="incl">TVA inclus</option><option value="none">factură fără TVA</option>
            </select>
          </div>

          <div style={rowGrid}>
            <div style={lbl}>Profit dorit<span style={sub}>net, după impozit, pe produs</span></div>
            <input style={inp} inputMode="decimal" value={s.profit} onChange={e => set('profit', e.target.value)} />
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Costuri lunare</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>Comenzi pe lună</span>
            <input style={{ ...inp, width: 100 }} inputMode="decimal" value={s.orders} onChange={e => set('orders', e.target.value)} />
          </div>
          {s.monthly.map((m, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto auto', gap: 8, alignItems: 'center', padding: '6px 0' }}>
              <input style={inpL} placeholder="Denumire" value={m.name} onChange={e => setMonthly(i, 'name', e.target.value)} />
              <input style={inp} inputMode="decimal" value={m.amount} onChange={e => setMonthly(i, 'amount', e.target.value)} />
              <select style={sel} value={m.vat} onChange={e => setMonthly(i, 'vat', e.target.value)}>
                <option value="plus">fără TVA, +21%</option><option value="incl">TVA inclus</option><option value="none">factură fără TVA</option>
              </select>
              <button onClick={() => delMonthly(i)} style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: 16, cursor: 'pointer' }}>✕</button>
            </div>
          ))}
          <button onClick={addMonthly} style={{ marginTop: 8, background: 'transparent', border: '1px dashed #10b981', color: '#10b981', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}>+ Adaugă cost lunar</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #1a2535', marginTop: 10, paddingTop: 10, fontSize: 12, color: '#64748b' }}>
            <span>Total cu TVA {L(mG)} / lună, împărțit la {orders || 0} comenzi</span>
            <b style={{ color: '#e8edf2' }}>{orders > 0 ? L(mG / orders) + ' / produs' : '—'}</b>
          </div>
        </div>

        <div style={card}>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>Setări</summary>
            <div style={{ marginTop: 12 }}>
              <div style={rowGrid}>
                <div style={lbl}>Transport China inclus în NIR<span style={sub}>se scade înainte de calculul TVA din vamă</span></div>
                <input style={inp} inputMode="decimal" value={s.china} onChange={e => set('china', e.target.value)} />
              </div>
              <div style={rowGrid}>
                <div style={lbl}>Tip impozit</div>
                <select style={{ ...sel, textAlign: 'left' }} value={s.taxMode} onChange={e => { const v = e.target.value; setS(prev => ({ ...prev, taxMode: v, tax: v === 'micro' && n(prev.tax) > 3 ? '1' : v === 'profit' && n(prev.tax) < 5 ? '16' : prev.tax })); }}>
                  <option value="profit">Impozit pe profit</option><option value="micro">Microîntreprindere (din venit)</option>
                </select>
              </div>
              <div style={rowGrid}>
                <div style={lbl}>Cota de impozit<span style={sub}>{micro ? 'se aplică pe prețul fără TVA' : 'se aplică pe profitul brut'}</span></div>
                <input style={inp} inputMode="decimal" value={s.tax} onChange={e => set('tax', e.target.value)} />
              </div>
              <div style={rowGrid}>
                <div style={lbl}>Rotunjire preț</div>
                <select style={{ ...sel, textAlign: 'left' }} value={s.round} onChange={e => set('round', e.target.value)}>
                  <option value="none">Fără</option><option value="int">Leu întreg</option><option value="99">Terminat în ,99</option><option value="9">Terminat în 9</option>
                </select>
              </div>
            </div>
          </details>
        </div>
      </main>

      <aside className="pc-panel">
        <div style={{ background: '#123D2F', color: '#EAF3EE', borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 13, color: '#9DBBAC' }}>Preț de vânzare recomandat, cu TVA</div>
          <div style={{ font: '700 44px/1 "IBM Plex Sans Condensed",sans-serif', color: '#F2C14E', margin: '6px 0 4px' }}>{P(rec.P)}<small style={{ fontSize: 16, marginLeft: 4 }}>lei</small></div>
          <div style={{ fontSize: 13, color: '#9DBBAC' }}>{L(rec.Pn)} fără TVA. Profit net {L(rec.prof)}</div>

          {s.round !== 'none' && Math.abs(rec.P - Pexact) > 0.005 && (
            <div style={{ background: 'rgba(242,193,78,.14)', borderLeft: '3px solid #F2C14E', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginTop: 10 }}>
              Preț exact: {L(Pexact)}. Rotunjit în sus, profitul crește la {L(rec.prof)}.
            </div>
          )}
          {!(orders > 0) && (
            <div style={{ background: 'rgba(242,193,78,.14)', borderLeft: '3px solid #F2C14E', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginTop: 10 }}>
              Completează comenzile pe lună.
            </div>
          )}

          <div style={{ marginTop: 16, background: 'rgba(234,243,238,.08)', borderRadius: 12, padding: 12 }}>
            <label style={{ fontSize: 12, color: '#9DBBAC', display: 'block', marginBottom: 6 }}>Testează alt preț de vânzare, cu TVA</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8 }}>
              <button onClick={() => bump(-10)} style={{ font: '600 13px monospace', background: 'none', border: '1px solid rgba(234,243,238,.35)', color: '#EAF3EE', borderRadius: 8, padding: '0 10px', cursor: 'pointer' }}>−10</button>
              <input style={{ ...inp, background: 'rgba(0,0,0,.2)', borderColor: 'rgba(234,243,238,.3)', color: '#EAF3EE', fontSize: 16, fontWeight: 600 }} inputMode="decimal" placeholder="ex. 249,99" value={s.test} onChange={e => set('test', e.target.value)} />
              <button onClick={() => bump(10)} style={{ font: '600 13px monospace', background: 'none', border: '1px solid rgba(234,243,238,.35)', color: '#EAF3EE', borderRadius: 8, padding: '0 10px', cursor: 'pointer' }}>+10</button>
            </div>
            {testing && (
              <>
                <div style={{ font: '700 22px/1.1 "IBM Plex Sans Condensed",sans-serif', marginTop: 10, color: cur.prof >= 0 ? '#8FE0B6' : '#FF9D85' }}>
                  {cur.prof >= 0 ? 'Profit net' : 'Pierdere'} {L(Math.abs(cur.prof))}
                </div>
                <div style={{ fontSize: 12, color: '#9DBBAC', marginTop: 2 }}>
                  {cur.prof - rec.prof >= 0 ? '+' : '−'}{L(Math.abs(cur.prof - rec.prof))} față de prețul recomandat. Marjă {P(cur.Pn > 0 ? cur.prof / cur.Pn * 100 : 0)}%. Pe lună: {L(cur.prof * (orders || 0))}.
                </div>
                <div style={{ fontSize: 12, color: '#9DBBAC', marginTop: 2 }}>Sub {L(breakEven)} vinzi în pierdere.</div>
              </>
            )}
            {testing && <button onClick={() => set('test', '')} style={{ marginTop: 8, font: '500 12px inherit', background: 'none', border: 0, color: '#9DBBAC', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>Înapoi la prețul recomandat</button>}
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 4px', paddingTop: 12, borderTop: '1px dashed rgba(234,243,238,.3)' }}>
            {testing ? `Profit pe trepte la ${L(tp)}` : 'Profit pe trepte'}
          </div>
          {(() => {
            const q = orders > 0 ? orders : 0;
            const gross = cur.Pn - C, preVat = gross + vatPay;
            const rows = [
              ['Profit înainte de TVA', preVat, true],
              [vatPay >= 0 ? '− TVA de plată la stat' : '+ TVA de recuperat', Math.abs(vatPay), false],
              ['Profit înainte de impozit', gross, true],
              [`− Impozit ${micro ? 'micro' : 'pe profit'} ${P(n(s.tax))}%`, cur.tax, false],
              ['Profit net, după impozit', cur.prof, true],
            ];
            return (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><th></th><th style={{ textAlign: 'right', fontWeight: 500, color: '#9DBBAC', fontSize: 11 }}>pe produs</th><th style={{ textAlign: 'right', fontWeight: 500, color: '#9DBBAC', fontSize: 11 }}>pe lună</th></tr></thead>
                <tbody>
                  {rows.map(([label, val, isLvl], i) => (
                    <tr key={i} style={{ borderTop: isLvl ? '1px solid rgba(234,243,238,.2)' : 'none', fontWeight: isLvl ? 600 : 400,
                      color: i === rows.length - 1 ? '#F2C14E' : undefined }}>
                      <td style={{ padding: '4px 0', color: isLvl ? undefined : '#9DBBAC', fontSize: isLvl ? 13 : 12 }}>{label}</td>
                      <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'monospace' }}>{L(val)}</td>
                      <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'monospace' }}>{q ? L(val * q) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}

          <div style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 4px', paddingTop: 12, borderTop: '1px dashed rgba(234,243,238,.3)' }}>
            {testing ? `TVA la prețul de ${L(tp)}` : 'TVA pe un produs vândut'}
          </div>
          {rl('TVA colectat din prețul de vânzare', L(cur.vatOut))}
          {rl(`TVA vamă: 21% × (${P(cost)} − ${P(china)})`, '− ' + L(vatImport))}
          {calc.shipV > 0 && rl('TVA transport România', '− ' + L(calc.shipV))}
          {calc.mktV > 0 && rl('TVA marketing', '− ' + L(calc.mktV))}
          {calc.perV > 0 && rl('TVA costuri lunare', '− ' + L(calc.perV))}
          {rl(vatPay >= 0 ? 'TVA de plată la stat' : 'TVA de recuperat de la stat', L(Math.abs(vatPay)), { top: true, bold: true })}

          <div style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 4px', paddingTop: 12, borderTop: '1px dashed rgba(234,243,238,.3)' }}>
            {testing ? `Unde se duc banii la ${L(tp)}` : 'Unde se duc banii'}
          </div>
          {rl('Produs (NIR)', L(cost))}
          {rl('TVA plătit în vamă', L(vatImport))}
          {rl('Transport România, cu TVA', L(calc.shipN + calc.shipV))}
          {rl('Marketing' + (calc.mktV > 0 ? ', cu TVA' : ''), L(calc.mktN + calc.mktV))}
          {rl('Costuri lunare, cu TVA', L(orders > 0 ? mG / orders : 0))}
          {rl(`Impozit ${micro ? 'micro' : 'pe profit'} ${P(n(s.tax))}%`, L(cur.tax))}
          {rl('TVA de plată la stat', L(vatPay))}
          {rl(cur.prof >= 0 ? 'Profit net' : 'Pierdere', L(cur.prof), { gold: true })}
          {rl('Total = preț de vânzare', L(cur.P), { top: true, bold: true })}

          <div style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 4px', paddingTop: 12, borderTop: '1px dashed rgba(234,243,238,.3)' }}>Pe lună</div>
          {orders > 0 ? (
            <>
              {rl('Încasări', L(cur.P * orders))}
              {rl('TVA de plată', L(vatPay * orders))}
              {rl(`Impozit ${micro ? 'micro' : 'pe profit'}`, L(cur.tax * orders))}
              {rl('Profit net', L(cur.prof * orders), { top: true, bold: true })}
            </>
          ) : rl('Completează comenzile pe lună', '—')}
        </div>
      </aside>
    </div>
  );
}
