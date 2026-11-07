'use client';
/**
 * app/agent/page.js — Agent AI pentru toate magazinele
 * Tab-uri: Statistici (live, per magazin) · Raport zilnic · Chat agent (cu confirmare la modificări)
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const FLAG = { RO: '🇷🇴', HU: '🇭🇺', GLATO: '🛍️', GLATOHU: '🎀' };
const PERIODS = [
  { k: 'today', l: 'Azi' }, { k: 'yesterday', l: 'Ieri' }, { k: '7d', l: '7 zile' },
  { k: '30d', l: '30 zile' }, { k: 'month', l: 'Luna asta' },
];
const SUGGESTIONS = [
  'Câte comenzi am azi pe toate magazinele?',
  'Care e cel mai vândut produs în ultimele 7 zile, pe fiecare magazin?',
  'Compară funnel-ul ATC / IC pe ultimele 7 zile între magazine',
  'Ce produse au stoc sub 5 bucăți?',
];

/* ─── helpers ─────────────────────────────────────────────── */
const fmt = (n, d = 0) => new Intl.NumberFormat('ro-RO', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n || 0);
const money = (n, cur) => `${fmt(n, cur === 'HUF' ? 0 : n >= 1000 ? 0 : 2)} ${cur || ''}`.trim();
const pct = (a, b) => (b ? (a / b) * 100 : 0);

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function md(text) {
  const lines = esc(text || '').split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    let l = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const li = /^\s*[-•*]\s+(.*)/.exec(l);
    const h = /^#{1,4}\s+(.*)/.exec(l);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (h) html += `<div class="ag-mdh">${h[1]}</div>`;
    else if (l.trim()) html += `<p>${l}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

function load(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

/* ─── page ────────────────────────────────────────────────── */
export default function AgentPage() {
  const [tab, setTab] = useState('stats');
  const [pinAsk, setPinAsk] = useState(null); // resolver while PIN modal open
  const [pinVal, setPinVal] = useState('');

  const api = useCallback(async (url, opts = {}) => {
    for (let i = 0; i < 2; i++) {
      const pin = load('agent_pin', '');
      const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'x-agent-pin': pin, ...(opts.headers || {}) } });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.needPin) {
        const ok = await new Promise(resolve => setPinAsk(() => resolve));
        if (!ok) throw new Error('Ai nevoie de PIN pentru agent');
        continue;
      }
      if (!res.ok) throw new Error(data.error || `Eroare ${res.status}`);
      return data;
    }
    throw new Error('PIN greșit');
  }, []);

  // shared between tabs: "ask the agent about X"
  const [prefill, setPrefill] = useState(null);
  const askAgent = (text, shops) => { setPrefill({ text, shops }); setTab('chat'); };

  return (
    <div className="wrap ag">
      <style>{CSS}</style>

      <div className="ag-head">
        <div>
          <div className="ag-title">🤖 Agent AI</div>
          <div className="ag-sub">Toate magazinele Shopify · statistici live, raport zilnic, modificări cu confirmare</div>
        </div>
      </div>

      <div className="ag-tabs">
        {[['stats', '📊 Statistici'], ['report', '🗞️ Raport zilnic'], ['chat', '💬 Chat agent']].map(([k, l]) => (
          <button key={k} className={`ag-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div style={{ display: tab === 'stats' ? 'block' : 'none' }}><StatsTab api={api} askAgent={askAgent} /></div>
      <div style={{ display: tab === 'report' ? 'block' : 'none' }}><ReportTab api={api} active={tab === 'report'} /></div>
      <div style={{ display: tab === 'chat' ? 'block' : 'none' }}><ChatTab api={api} prefill={prefill} clearPrefill={() => setPrefill(null)} /></div>

      {pinAsk && (
        <div className="ag-modal">
          <div className="ag-modal-box">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>🔒 PIN agent</div>
            <div className="ag-muted" style={{ marginBottom: 10 }}>Introdu PIN-ul setat în Vercel (AGENT_PIN). Se ține minte pe acest dispozitiv.</div>
            <input className="ag-input" type="password" inputMode="numeric" autoFocus value={pinVal}
              onChange={e => setPinVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { save('agent_pin', pinVal); pinAsk(true); setPinAsk(null); } }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="ag-btn ghost" onClick={() => { pinAsk(false); setPinAsk(null); }}>Anulează</button>
              <button className="ag-btn" onClick={() => { save('agent_pin', pinVal); pinAsk(true); setPinAsk(null); }}>Continuă</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Statistici ──────────────────────────────────────────── */
function StatsTab({ api, askAgent }) {
  const [period, setPeriod] = useState('today');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const refresh = useCallback(async (p) => {
    setLoading(true); setErr('');
    try { setData(await api(`/api/agent/overview?period=${p}`)); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { refresh(period); }, [period, refresh]);

  const shops = data?.shops || [];
  const totOrders = shops.reduce((s, x) => s + x.orders, 0);
  const byCur = {};
  for (const s of shops) if (s.currency) byCur[s.currency] = (byCur[s.currency] || 0) + s.sales;
  const fun = shops.reduce((a, s) => s.funnel ? { s: a.s + s.funnel.sessions, atc: a.atc + s.funnel.atc, ic: a.ic + s.funnel.ic, c: a.c + s.funnel.completed } : a, { s: 0, atc: 0, ic: 0, c: 0 });

  return (
    <>
      <div className="ag-chips">
        {PERIODS.map(p => <button key={p.k} className={`ag-chip ${period === p.k ? 'on' : ''}`} onClick={() => setPeriod(p.k)}>{p.l}</button>)}
        <button className="ag-chip" onClick={() => refresh(period)} disabled={loading}>{loading ? '⏳' : '↻'} Actualizează</button>
      </div>

      {err && <div className="ag-err">{err}</div>}
      {!data && loading && <div className="ag-card ag-muted">Se încarcă datele din toate magazinele…</div>}

      {data && (
        <div className="ag-card ag-total">
          <div className="ag-card-h"><span>Σ Toate magazinele</span><span className="ag-muted">{shops[0]?.range?.from}{shops[0]?.range?.to !== shops[0]?.range?.from ? ` → ${shops[0]?.range?.to}` : ''}</span></div>
          <div className="ag-kpis">
            <Kpi label="Comenzi" value={fmt(totOrders)} accent />
            <Kpi label="Vânzări" value={Object.entries(byCur).map(([c, v]) => money(v, c)).join(' · ') || '—'} />
            <Kpi label="Sesiuni" value={fmt(fun.s)} />
            <Kpi label="ATC / IC" value={`${fmt(fun.atc)} / ${fmt(fun.ic)}`} />
          </div>
        </div>
      )}

      <div className="ag-grid">
        {shops.map(s => (
          <div key={s.shop} className="ag-card">
            <div className="ag-card-h">
              <span>{FLAG[s.flag] || '🌐'} {s.name}</span>
              <span className="ag-muted">{s.domain}</span>
            </div>
            {s.error ? <div className="ag-err">{s.error}</div> : (
              <>
                <div className="ag-kpis">
                  <Kpi label="Comenzi" value={fmt(s.orders)} accent />
                  <Kpi label="Vânzări" value={money(s.sales, s.currency)} />
                  <Kpi label="AOV" value={money(s.aov, s.currency)} />
                  <Kpi label="Ramburs" value={`${fmt(s.codOrders)}${s.cancelled ? ` · ${s.cancelled} anul.` : ''}`} />
                </div>

                {s.funnel ? <FunnelBars f={s.funnel} /> : <div className="ag-note">{s.funnelError || 'Funnel indisponibil'}</div>}

                <div className="ag-sec">Top produse</div>
                {s.topProducts.length ? s.topProducts.slice(0, 3).map((p, i) => (
                  <div key={p.title} className="ag-row">
                    <span className="ag-rank">{i + 1}</span>
                    <span className="ag-ell" style={{ flex: 1 }}>{p.title}</span>
                    <b>{p.qty} buc</b>
                  </div>
                )) : <div className="ag-muted" style={{ fontSize: 12 }}>Nicio vânzare în perioadă</div>}

                <button className="ag-link" onClick={() => askAgent(`Analizează magazinul ${s.name} pentru perioada ${PERIODS.find(p => p.k === period)?.l.toLowerCase()}: ce merge, ce nu și ce să fac.`, [s.shop])}>
                  Întreabă agentul despre {s.name} →
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Kpi({ label, value, accent }) {
  return <div className="ag-kpi"><div className="ag-kpi-l">{label}</div><div className={`ag-kpi-v ${accent ? 'acc' : ''}`}>{value}</div></div>;
}

function FunnelBars({ f }) {
  const steps = [['Sesiuni', f.sessions], ['ATC', f.atc], ['IC', f.ic], ['Comenzi', f.completed]];
  return (
    <div className="ag-funnel">
      {steps.map(([l, v], i) => (
        <div key={l} className="ag-fstep">
          <div className="ag-fl"><span>{l}</span><span><b>{fmt(v)}</b>{i > 0 && <span className="ag-muted"> · {fmt(pct(v, f.sessions), 1)}%</span>}</span></div>
          <div className="ag-fbar"><div style={{ width: `${Math.max(i === 0 ? 100 : pct(v, f.sessions), v ? 2 : 0)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/* ─── Raport zilnic ───────────────────────────────────────── */
function ReportTab({ api, active }) {
  const [data, setData] = useState(null);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const loaded = useRef(false);

  const fetchReport = useCallback(async (d) => {
    setErr('');
    try { setData(await api(`/api/agent/daily-report${d ? `?date=${d}` : ''}`)); } catch (e) { setErr(e.message); }
  }, [api]);

  useEffect(() => { if (active && !loaded.current) { loaded.current = true; fetchReport(''); } }, [active, fetchReport]);

  const generate = async () => {
    setBusy(true); setErr('');
    try { const d = await api('/api/agent/daily-report', { method: 'POST' }); setData(d); setDate(''); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const r = data?.report;
  return (
    <>
      <div className="ag-chips">
        <button className="ag-chip on" onClick={generate} disabled={busy}>{busy ? '⏳ Generez…' : '⚡ Generează acum'}</button>
        {(data?.dates || []).length > 0 && (
          <select className="ag-select" value={date} onChange={e => { setDate(e.target.value); fetchReport(e.target.value); }}>
            <option value="">Ultimul raport</option>
            {data.dates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
      </div>

      {err && <div className="ag-err">{err}</div>}
      {data?.storage === 'none' && <div className="ag-note">REDIS_URL nu e setat — raportul se generează, dar nu se păstrează istoric.</div>}

      {!r && data && !busy && (
        <div className="ag-card ag-muted">Încă nu există raport. Se generează automat în fiecare dimineață la 08:30, sau apasă „Generează acum”.</div>
      )}

      {r && (
        <>
          <div className="ag-card">
            <div className="ag-card-h"><span>🗞️ Raport pentru {r.date}</span><span className="ag-muted">generat {new Date(r.generatedAt).toLocaleString('ro-RO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span></div>
            <div className="ag-md" dangerouslySetInnerHTML={{ __html: md(r.summary) }} />
          </div>

          <div className="ag-grid">
            {r.shops.map(({ yesterday: y, dayBefore: b, lowStock }) => (
              <div key={y.shop} className="ag-card">
                <div className="ag-card-h"><span>{FLAG[y.flag] || '🌐'} {y.name}</span></div>
                {y.error ? <div className="ag-err">{y.error}</div> : (
                  <>
                    <div className="ag-kpis">
                      <Kpi label="Comenzi" value={<>{fmt(y.orders)} <Delta a={y.orders} b={b.orders} /></>} accent />
                      <Kpi label="Vânzări" value={<>{money(y.sales, y.currency)} <Delta a={y.sales} b={b.sales} /></>} />
                      <Kpi label="ATC" value={y.funnel ? <>{fmt(y.funnel.atc)} <Delta a={y.funnel.atc} b={b.funnel?.atc} /></> : '—'} />
                      <Kpi label="IC" value={y.funnel ? <>{fmt(y.funnel.ic)} <Delta a={y.funnel.ic} b={b.funnel?.ic} /></> : '—'} />
                    </div>
                    {y.topProducts[0] && <div className="ag-row"><span className="ag-muted">Top:</span><span className="ag-ell" style={{ flex: 1 }}>{y.topProducts[0].title}</span><b>{y.topProducts[0].qty} buc</b></div>}
                    {lowStock.length > 0 && (
                      <>
                        <div className="ag-sec">⚠️ Stoc mic</div>
                        {lowStock.slice(0, 4).map((l, i) => (
                          <div key={i} className="ag-row"><span className="ag-ell" style={{ flex: 1 }}>{l.product}{l.variant !== 'Default Title' ? ` · ${l.variant}` : ''}</span><b style={{ color: l.qty <= 0 ? 'var(--c-red)' : 'var(--c-yellow)' }}>{l.qty}</b></div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Delta({ a, b }) {
  if (b === undefined || b === null) return null;
  if (!b) return a ? <span className="ag-up">nou</span> : null;
  const d = ((a - b) / b) * 100;
  if (Math.abs(d) < 0.5) return <span className="ag-muted" style={{ fontSize: 11 }}>=</span>;
  return <span className={d > 0 ? 'ag-up' : 'ag-down'}>{d > 0 ? '▲' : '▼'}{fmt(Math.abs(d))}%</span>;
}

/* ─── Chat ────────────────────────────────────────────────── */
function ChatTab({ api, prefill, clearPrefill }) {
  const [shops, setShops] = useState([]);
  const [focus, setFocus] = useState([]);       // [] = toate
  const [msgs, setMsgs] = useState([]);         // {role, content, actions?, state?, results?}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { setMsgs(load('agent_chat', [])); }, []);
  useEffect(() => { save('agent_chat', msgs.slice(-60)); endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);
  useEffect(() => { fetch('/api/connector/shops').then(r => r.json()).then(d => setShops(d.shops || [])).catch(() => {}); }, []);

  const send = useCallback(async (text, focusOverride) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    const f = focusOverride ?? focus;
    const next = [...msgs, { role: 'user', content: t }];
    setMsgs(next); setInput(''); setBusy(true);
    try {
      const history = next.map(m => ({ role: m.role, content: m.content }));
      const d = await api('/api/agent/chat', { method: 'POST', body: JSON.stringify({ messages: history, shops: f.length ? f : undefined }) });
      setMsgs(m => [...m, { role: 'assistant', content: d.reply || '(fără răspuns)', actions: d.actions?.length ? d.actions : undefined, state: d.actions?.length ? 'pending' : undefined }]);
    } catch (e) {
      setMsgs(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    } finally { setBusy(false); }
  }, [api, busy, focus, input, msgs]);

  useEffect(() => {
    if (!prefill) return;
    if (prefill.shops) setFocus(prefill.shops);
    send(prefill.text, prefill.shops || []);
    clearPrefill();
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (idx, selected) => {
    const m = msgs[idx];
    if (!selected) { setMsgs(ms => ms.map((x, i) => i === idx ? { ...x, state: 'cancelled' } : x)); return; }
    const chosen = m.actions.filter((_, i) => selected.includes(i));
    if (!chosen.length) return;
    setMsgs(ms => ms.map((x, i) => i === idx ? { ...x, state: 'running' } : x));
    try {
      const d = await api('/api/agent/execute', { method: 'POST', body: JSON.stringify({ actions: chosen }) });
      const lines = d.results.map(r => `${r.ok ? '✅' : '❌'} [${r.shop}] ${r.summary}${r.ok ? ` — ${r.result}` : ` — ${r.error}`}`);
      setMsgs(ms => [...ms.map((x, i) => i === idx ? { ...x, state: 'done', results: d.results } : x),
        { role: 'assistant', content: `Rezultat după confirmare:\n${lines.map(l => `- ${l}`).join('\n')}` }]);
    } catch (e) {
      setMsgs(ms => ms.map((x, i) => i === idx ? { ...x, state: 'pending' } : x));
      alert(e.message);
    }
  };

  const toggleShop = k => setFocus(f => f.includes(k) ? f.filter(x => x !== k) : [...f, k]);

  return (
    <div className="ag-chat">
      <div className="ag-chips">
        <button className={`ag-chip ${!focus.length ? 'on' : ''}`} onClick={() => setFocus([])}>🌐 Toate</button>
        {shops.map(s => <button key={s.key} className={`ag-chip ${focus.includes(s.key) ? 'on' : ''}`} onClick={() => toggleShop(s.key)}>{FLAG[s.flag] || '🛒'} {s.label}</button>)}
        {msgs.length > 0 && <button className="ag-chip" onClick={() => setMsgs([])}>🗑 Conversație nouă</button>}
      </div>

      <div className="ag-msgs">
        {!msgs.length && (
          <div className="ag-card">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Ce vrei să afli sau să schimbi?</div>
            <div className="ag-muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Ex: „la glato și glamx pune prețul 349 la Delta Max” — îți arăt exact ce modific și aplic doar după ce confirmi.
            </div>
            {SUGGESTIONS.map(s => <button key={s} className="ag-sugg" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={`ag-msg ${m.role}`}>
            <div className="ag-bubble">
              {m.role === 'assistant' ? <div className="ag-md" dangerouslySetInnerHTML={{ __html: md(m.content) }} /> : m.content}
            </div>
            {m.actions && <ActionCard m={m} onDecide={sel => decide(i, sel)} />}
          </div>
        ))}
        {busy && <div className="ag-msg assistant"><div className="ag-bubble ag-muted">⏳ Lucrez pe magazine…</div></div>}
        <div ref={endRef} />
      </div>

      <div className="ag-composer">
        <textarea className="ag-input" rows={1} placeholder={focus.length ? `Întreabă despre ${focus.join(', ')}…` : 'Întreabă sau cere o modificare…'}
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="ag-send" onClick={() => send()} disabled={busy || !input.trim()}>➤</button>
      </div>
    </div>
  );
}

function ActionCard({ m, onDecide }) {
  const [sel, setSel] = useState(() => m.actions.map((_, i) => i));
  const st = m.state;
  return (
    <div className={`ag-action ${st}`}>
      <div className="ag-action-h">
        {st === 'pending' && '✋ Modificări de confirmat'}
        {st === 'running' && '⏳ Aplic modificările…'}
        {st === 'done' && '✅ Modificări procesate'}
        {st === 'cancelled' && '🚫 Anulat — nimic nu s-a modificat'}
      </div>
      {m.actions.map((a, i) => {
        const r = m.results?.find(x => x.summary === a.summary && x.shop === a.shop);
        return (
          <label key={i} className="ag-action-row">
            {st === 'pending' && <input type="checkbox" checked={sel.includes(i)} onChange={() => setSel(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i])} />}
            {r && <span>{r.ok ? '✅' : '❌'}</span>}
            <span><b>[{a.shop}]</b> {a.summary}{r && !r.ok ? <span className="ag-down"> — {r.error}</span> : null}</span>
          </label>
        );
      })}
      {st === 'pending' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="ag-btn ghost" onClick={() => onDecide(null)}>Anulează</button>
          <button className="ag-btn" disabled={!sel.length} onClick={() => onDecide(sel)}>Confirmă ({sel.length})</button>
        </div>
      )}
    </div>
  );
}

/* ─── styles ──────────────────────────────────────────────── */
const CSS = `
.ag { padding-top: 14px; }
.ag-head { margin-bottom: 12px; }
.ag-title { font-family: 'Syne', sans-serif; font-size: 20px; font-weight: 800; letter-spacing: -.4px; }
.ag-sub, .ag-muted { color: var(--c-text3); font-size: 12px; }
.ag-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 12px; }
.ag-tab { background: var(--c-surface); border: 1px solid var(--c-border); color: var(--c-text2); padding: 9px 6px; border-radius: 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
.ag-tab.on { background: rgba(249,115,22,.12); border-color: rgba(249,115,22,.45); color: var(--c-orange); }
.ag-chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 10px; scrollbar-width: none; }
.ag-chip { flex-shrink: 0; background: var(--c-surface); border: 1px solid var(--c-border); color: var(--c-text2); padding: 6px 11px; border-radius: 999px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.ag-chip.on { background: var(--c-orange); border-color: var(--c-orange); color: #fff; }
.ag-chip:disabled { opacity: .6; }
.ag-select { background: var(--c-bg3); border: 1px solid var(--c-border); color: var(--c-text); border-radius: 999px; padding: 5px 10px; font-size: 12px; }
.ag-card { background: var(--c-bg2); border: 1px solid var(--c-border); border-radius: 14px; padding: 12px; margin-bottom: 10px; }
.ag-total { border-color: rgba(249,115,22,.3); background: linear-gradient(180deg, rgba(249,115,22,.07), var(--c-bg2)); }
.ag-card-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-weight: 800; margin-bottom: 10px; }
.ag-card-h > span:last-child { font-weight: 500; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ag-grid { display: grid; grid-template-columns: 1fr; gap: 0 10px; }
@media (min-width: 900px) { .ag-grid { grid-template-columns: 1fr 1fr; } }
.ag-kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-bottom: 10px; }
@media (min-width: 600px) { .ag-kpis { grid-template-columns: repeat(4, 1fr); } }
.ag-kpi { background: var(--c-surface); border: 1px solid var(--c-border2); border-radius: 10px; padding: 8px 10px; min-width: 0; }
.ag-kpi-l { font-size: 10px; color: var(--c-text3); text-transform: uppercase; letter-spacing: .5px; font-weight: 700; }
.ag-kpi-v { font-size: 15px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ag-kpi-v.acc { color: var(--c-orange); }
.ag-funnel { display: grid; gap: 6px; margin-bottom: 10px; }
.ag-fl { display: flex; justify-content: space-between; font-size: 12px; color: var(--c-text2); margin-bottom: 3px; }
.ag-fbar { height: 6px; background: var(--c-surface2); border-radius: 99px; overflow: hidden; }
.ag-fbar > div { height: 100%; background: linear-gradient(90deg, var(--c-orange), #fb923c); border-radius: 99px; }
.ag-sec { font-size: 11px; font-weight: 800; color: var(--c-text3); text-transform: uppercase; letter-spacing: .5px; margin: 6px 0 4px; }
.ag-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; border-top: 1px solid var(--c-border2); }
.ag-rank { width: 18px; height: 18px; border-radius: 6px; background: var(--c-surface2); display: grid; place-items: center; font-size: 10px; font-weight: 800; color: var(--c-text2); flex-shrink: 0; }
.ag-ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ag-link { background: none; border: none; color: var(--c-orange); font-size: 12px; font-weight: 700; cursor: pointer; padding: 8px 0 0; }
.ag-err { background: rgba(244,63,94,.08); border: 1px solid rgba(244,63,94,.25); color: #fda4af; border-radius: 10px; padding: 8px 10px; font-size: 12px; margin-bottom: 10px; }
.ag-note { background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.25); color: #fcd34d; border-radius: 10px; padding: 8px 10px; font-size: 12px; margin-bottom: 10px; }
.ag-up { color: var(--c-green); font-size: 11px; font-weight: 700; }
.ag-down { color: var(--c-red); font-size: 11px; font-weight: 700; }
.ag-md p { margin: 0 0 6px; } .ag-md ul { margin: 0 0 6px 16px; } .ag-md li { margin: 2px 0; }
.ag-md code { background: var(--c-surface2); padding: 1px 5px; border-radius: 5px; font-size: 12px; }
.ag-mdh { font-weight: 800; margin: 8px 0 4px; }
.ag-chat { display: flex; flex-direction: column; }
.ag-msgs { display: flex; flex-direction: column; gap: 8px; padding-bottom: 80px; }
.ag-msg { display: flex; flex-direction: column; max-width: 92%; }
.ag-msg.user { align-self: flex-end; align-items: flex-end; }
.ag-msg.assistant { align-self: flex-start; }
.ag-bubble { padding: 9px 12px; border-radius: 14px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.ag-msg.assistant .ag-bubble { white-space: normal; background: var(--c-bg2); border: 1px solid var(--c-border); border-bottom-left-radius: 4px; }
.ag-msg.user .ag-bubble { background: var(--c-orange); color: #fff; border-bottom-right-radius: 4px; }
.ag-sugg { display: block; width: 100%; text-align: left; background: var(--c-surface); border: 1px solid var(--c-border); color: var(--c-text); border-radius: 10px; padding: 9px 11px; font-size: 13px; margin-top: 6px; cursor: pointer; }
.ag-sugg:hover { border-color: var(--c-orange); }
.ag-action { margin-top: 6px; border: 1px solid rgba(249,115,22,.45); background: rgba(249,115,22,.06); border-radius: 12px; padding: 10px 12px; font-size: 13px; }
.ag-action.done { border-color: rgba(16,185,129,.4); background: rgba(16,185,129,.06); }
.ag-action.cancelled { opacity: .6; border-color: var(--c-border); background: var(--c-surface); }
.ag-action-h { font-weight: 800; margin-bottom: 6px; }
.ag-action-row { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; cursor: pointer; }
.ag-action-row input { margin-top: 3px; accent-color: var(--c-orange); }
.ag-btn { flex: 1; background: var(--c-orange); color: #fff; border: none; border-radius: 10px; padding: 9px 12px; font-weight: 800; font-size: 13px; cursor: pointer; }
.ag-btn.ghost { background: var(--c-surface); color: var(--c-text2); border: 1px solid var(--c-border); }
.ag-btn:disabled { opacity: .5; }
.ag-composer { position: fixed; left: 0; right: 0; bottom: calc(var(--nav-h, 64px) + var(--safe-bottom, 0px)); z-index: 150; display: flex; gap: 8px; padding: 8px 12px; background: rgba(7,9,14,.96); border-top: 1px solid var(--c-border2); backdrop-filter: blur(16px); }
@media (min-width: 1024px) { .ag-composer { position: sticky; bottom: 12px; border: 1px solid var(--c-border); border-radius: 14px; } .ag-msgs { padding-bottom: 12px; } }
.ag-input { flex: 1; min-width: 0; width: 100%; background: var(--c-bg3); border: 1px solid var(--c-border); border-radius: 12px; padding: 10px 12px; font-size: 16px; resize: none; outline: none; color: var(--c-text); }
.ag-input:focus { border-color: var(--c-orange); }
.ag-send { width: 44px; flex-shrink: 0; border: none; border-radius: 12px; background: var(--c-orange); color: #fff; font-size: 16px; cursor: pointer; }
.ag-send:disabled { opacity: .45; }
.ag-modal { position: fixed; inset: 0; z-index: 400; background: rgba(0,0,0,.6); display: grid; place-items: center; padding: 16px; }
.ag-modal-box { width: 100%; max-width: 340px; background: var(--c-bg2); border: 1px solid var(--c-border); border-radius: 16px; padding: 16px; }
`;
