'use client';
import { useState, useRef, useEffect } from "react";

// ─── PROMPTS ────────────────────────────────────────────────────────────────

const STEP1_SYSTEM = `You are an elite Sales Intelligence Analyst with 20+ years of experience scaling companies to 7-figure revenues. You specialize in rapid, qualified sales using the latest 2024-2025 methodologies.

When given a URL or product/service description, you generate a COMPLETE, PROFESSIONAL sales optimization report structured as follows:

---

# 🚀 RAPORT STRATEGIE VÂNZĂRI 7-FIGURE
## [Numele Produsului/Serviciului]

---

## 1. 🎯 EXECUTIVE SUMMARY (ICP + Poziționare)
- Ideal Customer Profile (ICP) ultra-specific: demographics, psychographics, pain points top 3
- Poziționare competitivă (Blue Ocean vs Red Ocean)
- USP (Unique Selling Proposition) formulat pe framework-ul "Only We..." 
- Scor oportunitate de piață: X/10

## 2. 💡 ANALIZA PRODUSULUI / SERVICIULUI
- Ce vinde de fapt (beneficiu real vs feature)
- Value Ladder propus (Low ticket → Core offer → High ticket → Continuity)
- Pricing Power Analysis: prețul actual vs prețul optimal perceput
- Obiecții principale ale cumpărătorului + contraargumente pre-emptive

## 3. ⚡ STRATEGII DE VÂNZĂRI RAPIDE (Quick Wins — 0-30 zile)

### A. Offer Engineering
- Irresistible Offer Stack (Bonus stacking, Urgency triggers, Risk reversal)

### B. Social Proof Accelerator
- Tipuri de testimoniale necesare
- Strategie de colectare rapidă

### C. Sales Script — AIDA + Challenger Sale Hybrid
- Hook de deschidere
- Discovery questions (SPIN Selling adaptat)
- Pitch core
- Closing sequence (3 variante)

## 4. 📈 FUNNEL DE VÂNZĂRI CALIFICAT
- Structura funnel-ului recomandat
- Lead Qualification Framework: BANT + MEDDIC hibrid
- Strategii de nurturing (secvență de 5 mesaje inclusă)

## 5. 🔥 TEHNICI AVANSATE 7-FIGURE (2025)
- Velocity Selling, Micro-Commitment Ladder, AI Personalization at Scale
- Value-Based Pricing Psychology, Scarcity Architecture
- Community-Led Growth, Post-Sale Expansion

## 6. 📊 KPI-URI & METRICI
| Metric | Target Lunar | Target Anual |
|--------|-------------|--------------|

## 7. 🛠️ STACK TEHNOLOGIC RECOMANDAT

## 8. 🗓️ PLAN DE ACȚIUNE 90 ZILE
### Ziua 1-30: Foundation & Quick Wins
### Ziua 31-60: Scale & Optimize
### Ziua 61-90: 7-Figure Acceleration

## 9. ⚠️ RED FLAGS & RISCURI

## 10. 💬 BONUS: MESAJE GATA DE FOLOSIT

IMPORTANT: Fii ultra-specific. Fiecare recomandare trebuie acționabilă IMEDIAT. Scrie în română. Tonul: expert direct, fără fluff.`;

const STEP2_SYSTEM = `Act as an elite combination of:
- Top 1% sales closer
- Direct response copywriter
- TikTok/Meta viral strategist
- Performance marketer (CPA obsessed)
- AI growth systems architect

Your mission: Turn this business into a HIGH-CONVERTING, FAST-SCALING REVENUE MACHINE with LOW CPA and QUALIFIED leads.

Based on the Sales Report provided, generate a COMPLETE EXECUTION PACKAGE in Romanian (unless scripts need English), structured EXACTLY as below:

---

# ⚡ PACHET EXECUȚIE COMPLET — VÂNZĂRI RAPIDE & CALIFICATE

---

## 1. 🔪 REVENUE KILLERS (BRUTAL TRUTH)
List the 5 biggest conversion killers found in this business. For each:
- Problem (specific, brutal)
- Why it destroys revenue (mechanism)
- Immediate fix (actionable, 1 sentence)

---

## 2. 📞 SCRIPTS VÂNZARE DIRECTĂ

### A. DM SALES SCRIPT (Instagram / WhatsApp)
- Opener (pattern interrupt — primul mesaj care oprește scroll-ul mintal)
- 3 Qualification questions (SPIN style)
- Value positioning paragraph
- Soft close → Hard close
- Follow-up messages (3 variante pentru non-răspuns)

### B. SALES CALL SCRIPT (HIGH-TICKET — cuvânt cu cuvânt)
- Opening (authority + trust building — primele 60 secunde)
- Discovery (pain amplification — 5 întrebări care dor)
- Frame control (repoziționare mentală)
- Offer pitch (PAS framework)
- Objection handling (top 5: prea scump / mă mai gândesc / am alt furnizor / nu am timp / nu sunt sigur)
- Closing lines: 3 stiluri (soft / assumptive / urgency)

### C. VOICE NOTE / VIDEO SALES SCRIPT
- Script scurt, emoțional, persuasiv (max 60 secunde voce)
- Designed for fast close via DM

---

## 3. 🎬 VOICEOVER TIKTOK & META — 10 RECLAME VIDEO

Pentru FIECARE din cele 10 reclame generează:
- **HOOK** (primele 3 secunde — scroll stopper)
- **UNGHI** (pain / shock / authority / case study / controversial)
- **SCRIPT COMPLET** (cuvânt cu cuvânt, natural, conversațional)
- **DIRECȚIE VIZUALĂ** (ce se vede pe ecran)
- **CTA** (call to action specific)
- **🎙️ VOICEOVER TEXT** (~550 caractere, optimizat pentru TikTok/Meta Andromeda, ritm natural, fără cuvinte goale, emoție + beneficiu + urgență)

Tipuri de reclame OBLIGATORII: pain-based, shock-based, authority-based, case study, controversial take, before/after, transformation, social proof, fear of missing out, curiosity gap.

---

## 4. 📣 AD COPY (PAID TRAFFIC READY)

### 5 Primary Texts (Facebook/TikTok — gata de copiat)
Fiecare cu hook puternic, body persuasiv, CTA clar.

### 5 Headlines (max 40 caractere, punch maxim)

### 3 Advertorial Angles (long-form, native feel, 150-200 cuvinte fiecare)

---

## 5. 🚀 FUNNEL + OFFER UPGRADE

- Rescrie oferta (mai premium, mai irezistibilă)
- Adaugă urgency triggers, scarcity reale, bonus stack
- Recomandă cel mai bun tip de funnel pentru conversii RAPIDE
- Structura exactă pas cu pas (Landing page → VSL → Checkout → Upsell)

---

## 6. 🤖 AI AUTOMATION SYSTEM

Construiește sistemul pas cu pas:
1. Lead capture → AI qualification (cum funcționează, ce tool-uri)
2. Auto DM replies (secvențe, logică)
3. Follow-up sequences (email + WhatsApp, timing exact)
4. CRM logic (pipeline stages, trigger-uri)
5. Retargeting triggers (cine, când, cu ce mesaj)

Explică implementarea pentru cineva fără background tehnic.

---

## 7. 💰 RAPID CASH STRATEGY (0–30 ZILE)

Acțiuni exacte, ordonate după impact:
- Ziua 1-3: (acțiuni imediate)
- Ziua 4-7: (momentum)
- Ziua 8-14: (accelerare)
- Ziua 15-30: (scale)

---

## 8. 📈 SCALE TO 7 FIGURES

- Top 3 surse de trafic pentru această nișă (cu budget minim recomandat)
- Scaling strategy (horizontal vs vertical)
- KPIs critici (cu target numeric)
- Bottleneck warnings (ce se rupe primul când scalezi)
- Winning formula pentru CPA mic + calificare înaltă

---

REGULI:
- Fii agresiv, direct, conversion-focused
- ZERO fluff, ZERO teorie generală
- Totul trebuie folosibil IMEDIAT
- Gândește ca și cum ești plătit DOAR pe rezultate
- Voiceover-urile ~550 caractere trebuie să sune NATURAL la citit cu voce tare`;

// ─── MARKDOWN RENDERER ─────────────────────────────────────────────────────

function renderMd(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^#{1} (.+)$/gm, '<h1 class="r-h1">$1</h1>')
    .replace(/^#{2} (.+)$/gm, '<h2 class="r-h2">$1</h2>')
    .replace(/^#{3} (.+)$/gm, '<h3 class="r-h3">$1</h3>')
    .replace(/^#{4} (.+)$/gm, '<h4 class="r-h4">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr class="r-hr"/>')
    .replace(/^\| (.+) \|$/gm, (m) => {
      const cells = m.split('|').map(c => c.trim()).filter(Boolean);
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    });
  // wrap table rows
  html = html.replace(/(<tr>[\s\S]*?<\/tr>\n?)+/g, m => `<table class="r-table">${m}</table>`);
  // lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul class="r-ul">${m}</ul>`);
  html = html.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
  html = html.replace(/(<oli>[\s\S]*?<\/oli>\n?)+/g, m => `<ol class="r-ol">${m.replace(/<\/?oli>/g, m2 => m2 === '<oli>' ? '<li>' : '</li>')}</ol>`);
  // paragraphs
  html = html.split('\n\n').map(p => {
    if (p.match(/^<[h1-6|ul|ol|table|hr]/)) return p;
    if (!p.trim()) return '';
    return `<p class="r-p">${p.replace(/\n/g, ' ')}</p>`;
  }).join('\n');
  return html;
}

// ─── SECTION LABELS ────────────────────────────────────────────────────────

const STEP2_SECTIONS = [
  { id: "killers", label: "💀 Revenue Killers", emoji: "🔪" },
  { id: "scripts", label: "📞 Scripts Vânzare", emoji: "📞" },
  { id: "voiceover", label: "🎬 Voiceover Ads", emoji: "🎙️" },
  { id: "adcopy", label: "📣 Ad Copy", emoji: "📣" },
  { id: "funnel", label: "🚀 Funnel & Offer", emoji: "🚀" },
  { id: "automation", label: "🤖 AI Automation", emoji: "🤖" },
  { id: "cash", label: "💰 Cash 0-30 zile", emoji: "💰" },
  { id: "scale", label: "📈 Scale 7-Figure", emoji: "📈" },
];

// ─── MAIN APP ───────────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState("");
  const [context, setContext] = useState("");
  const [report1, setReport1] = useState("");
  const [report2, setReport2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(null);

  useEffect(() => {
    if (loading) {
      setProgress(0);
      const interval = setInterval(() => {
        setProgress(p => Math.min(p + Math.random() * 3, 92));
      }, 400);
      progressRef.current = interval;
    } else {
      clearInterval(progressRef.current);
      if (report1 || report2) setProgress(100);
    }
    return () => clearInterval(progressRef.current);
  }, [loading]);

  const callAI = async (systemPrompt, userMsg) => {
    const res = await fetch("/api/sales-engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
        max_tokens: 4000,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Eroare server");
    return data.content?.map(b => b.text || "").join("\n") || "";
  };

  const generateStep1 = async () => {
    if (!url.trim()) { setError("Introdu un URL sau descrierea produsului."); return; }
    setError(""); setReport1(""); setLoading(true);
    try {
      const msg = `Analizează: ${url}${context ? `\nContext: ${context}` : ""}\nGenerează raportul complet 7-figure.`;
      const r = await callAI(STEP1_SYSTEM, msg);
      setReport1(r);
      setStep(1.5);
    } catch { setError("Eroare. Încearcă din nou."); }
    setLoading(false);
  };

  const generateStep2 = async () => {
    setError(""); setReport2(""); setLoading(true); setStep(2);
    try {
      const msg = `RAPORT VÂNZĂRI (Step 1):\n${report1}\n\nPRODUS/URL: ${url}\n${context ? `Context: ${context}` : ""}\n\nGenerează pachetul complet de execuție conform structurii.`;
      const r = await callAI(STEP2_SYSTEM, msg);
      setReport2(r);
    } catch { setError("Eroare la generarea Step 2. Încearcă din nou."); }
    setLoading(false);
  };

  const copy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#050508", color: "#e0dbd0", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{CSS}</style>

      {/* HEADER */}
      <div className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <span className="logo-text">SalesEngine<span className="logo-pro">PRO</span></span>
          </div>
          <div className="step-pills">
            <div className={`step-pill ${step >= 1 ? "active" : ""} ${step > 1 ? "done" : ""}`}>
              <span className="sp-num">{step > 1 ? "✓" : "1"}</span>
              <span className="sp-label">Raport Vânzări</span>
            </div>
            <div className="step-connector" />
            <div className={`step-pill ${step >= 2 ? "active" : ""}`}>
              <span className="sp-num">2</span>
              <span className="sp-label">Pachet Execuție</span>
            </div>
          </div>
        </div>
      </div>

      <div className="page">

        {/* ── STEP 1 INPUT ── */}
        {(step === 1 || step === 1.5) && (
          <div className="section fade-in">
            <div className="section-tag">STEP 1</div>
            <h2 className="section-title">Raport Strategie <span className="accent">7-Figure</span></h2>
            <p className="section-sub">Introdu URL-ul sau descrie produsul tău. AI-ul analizează tot și generează raportul complet.</p>

            <div className="input-card">
              <label className="ilabel">🔗 URL / Produs / Serviciu</label>
              <input className="ifield" placeholder="https://site-tau.ro sau 'Curs online €997 pentru antreprenori'" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && !loading && generateStep1()} />
              <label className="ilabel">💬 Context adițional (opțional)</label>
              <textarea className="ifield" rows={3} placeholder="Target, revenue actual, obiective, buget ads, piață..." value={context} onChange={e => setContext(e.target.value)} />
              {error && <div className="error-box">⚠️ {error}</div>}
              <button className="btn-primary" onClick={generateStep1} disabled={loading}>
                {loading ? <Loader text="Analizez business-ul..." /> : "🚀 Generează Raportul Vânzări"}
              </button>
            </div>

            {loading && <ProgressBar value={progress} label="Analizez: ICP, Value Ladder, Scripts, KPIs..." />}

            {report1 && (
              <div className="report-card fade-in">
                <div className="report-topbar">
                  <span className="report-tag">📊 RAPORT STEP 1 — COMPLET</span>
                  <button className="btn-ghost" onClick={() => copy(report1)}>{copied ? "✓ Copiat" : "Copiază"}</button>
                </div>
                <div className="report-body" dangerouslySetInnerHTML={{ __html: renderMd(report1) }} />
              </div>
            )}

            {report1 && !loading && (
              <div className="step2-cta fade-in">
                <div className="cta-box">
                  <div className="cta-icon">⚡</div>
                  <div>
                    <div className="cta-title">Raportul e gata! Acum activează <span className="accent">Step 2 — Pachet Execuție Complet</span></div>
                    <div className="cta-sub">Scripts, 10 Voiceover TikTok/Meta, Ad Copy, Funnel, AI Automation, Cash 0-30 zile + Scale 7-Figure</div>
                  </div>
                  <button className="btn-fire" onClick={generateStep2}>
                    🔥 Activează Step 2
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <div className="section fade-in">
            <div className="section-tag">STEP 2</div>
            <h2 className="section-title">Pachet Execuție <span className="accent">Complet</span></h2>
            <p className="section-sub">Scripts • Voiceover Ads • Ad Copy • Funnel • AI Automation • Cash Strategy • Scale 7-Figure</p>

            {loading && <ProgressBar value={progress} label="Generez: Scripts, Voiceover-uri, Ad Copy, Automation, Cash Strategy..." />}
            {error && <div className="error-box">⚠️ {error}</div>}

            {report2 && (
              <>
                <div className="tabs-bar">
                  {STEP2_SECTIONS.map((s, i) => (
                    <button key={s.id} className={`tab-btn ${activeTab === i ? "tab-active" : ""}`} onClick={() => setActiveTab(i)}>
                      {s.emoji} <span className="tab-label">{s.label.replace(/^.+ /, '')}</span>
                    </button>
                  ))}
                </div>

                <div className="report-card fade-in">
                  <div className="report-topbar">
                    <span className="report-tag">{STEP2_SECTIONS[activeTab].label}</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn-ghost" onClick={() => setStep(1.5)}>← Step 1</button>
                      <button className="btn-ghost" onClick={() => copy(report2)}>{copied ? "✓ Copiat" : "Copiază Tot"}</button>
                    </div>
                  </div>
                  <SectionView report={report2} sectionIndex={activeTab} />
                </div>

                <div className="nav-btns">
                  {activeTab > 0 && <button className="btn-ghost" onClick={() => setActiveTab(a => a - 1)}>← {STEP2_SECTIONS[activeTab - 1].label}</button>}
                  {activeTab < STEP2_SECTIONS.length - 1 && <button className="btn-primary" style={{ flex: 1 }} onClick={() => setActiveTab(a => a + 1)}>Următor: {STEP2_SECTIONS[activeTab + 1].label} →</button>}
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── SECTION VIEW ───────────────────────────────────────────────────────────

const SECTION_ANCHORS = [
  "REVENUE KILLERS",
  "SCRIPTS VÂNZARE",
  "VOICEOVER TIKTOK",
  "AD COPY",
  "FUNNEL",
  "AI AUTOMATION",
  "RAPID CASH",
  "SCALE TO 7",
];

function SectionView({ report, sectionIndex }) {
  const sections = splitSections(report);
  const content = sections[sectionIndex] || report;
  return (
    <div className="report-body" dangerouslySetInnerHTML={{ __html: renderMd(content) }} />
  );
}

function splitSections(text) {
  const markers = [
    /##\s+1\.|REVENUE KILLERS/i,
    /##\s+2\.|SCRIPTS VÂNZARE/i,
    /##\s+3\.|VOICEOVER/i,
    /##\s+4\.|AD COPY/i,
    /##\s+5\.|FUNNEL/i,
    /##\s+6\.|AI AUTOMATION/i,
    /##\s+7\.|RAPID CASH/i,
    /##\s+8\.|SCALE TO 7/i,
  ];
  const lines = text.split('\n');
  const splits = [];
  let current = [];
  let markerIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (markerIdx < markers.length && markers[markerIdx].test(line)) {
      if (current.length && splits.length < 8) {
        splits.push(current.join('\n'));
      }
      current = [line];
      markerIdx++;
    } else {
      current.push(line);
    }
  }
  if (current.length) splits.push(current.join('\n'));

  // If splitting didn't work well, return whole report for every section
  if (splits.length < 3) return Array(8).fill(text);
  while (splits.length < 8) splits.push(splits[splits.length - 1]);
  return splits;
}

// ─── SMALL COMPONENTS ───────────────────────────────────────────────────────

function Loader({ text }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
      <span className="spin">⟳</span> {text}
    </span>
  );
}

function ProgressBar({ value, label }) {
  return (
    <div className="progress-wrap">
      <div className="progress-label">{label}</div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${value}%` }} />
      </div>
      <div className="progress-pct">{Math.round(value)}%</div>
    </div>
  );
}

// ─── CSS ────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Syne:wght@700;800&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.header {
  position: sticky; top: 0; z-index: 100;
  background: rgba(5,5,8,0.92);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 0 24px;
}
.header-inner {
  max-width: 900px; margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 0;
  gap: 16px; flex-wrap: wrap;
}
.logo { display: flex; align-items: center; gap: 8px; }
.logo-icon { font-size: 20px; }
.logo-text { font-family: 'Syne', sans-serif; font-size: 18px; font-weight: 800; color: #f0ead8; }
.logo-pro { color: #ff4d1c; margin-left: 2px; }

.step-pills { display: flex; align-items: center; gap: 8px; }
.step-pill {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px;
  border-radius: 100px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03);
  font-size: 12px; font-weight: 500; color: #666;
  transition: all 0.3s;
}
.step-pill.active { border-color: rgba(255,77,28,0.4); background: rgba(255,77,28,0.08); color: #ff8060; }
.step-pill.done { border-color: rgba(0,200,100,0.3); background: rgba(0,200,100,0.06); color: #00c864; }
.sp-num { width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; }
.step-pill.active .sp-num { background: #ff4d1c; color: white; }
.step-pill.done .sp-num { background: #00c864; color: white; }
.step-connector { width: 24px; height: 1px; background: rgba(255,255,255,0.1); }

.page { max-width: 900px; margin: 0 auto; padding: 40px 24px 80px; }

.section { }
.fade-in { animation: fadein 0.4s ease; }
@keyframes fadein { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

.section-tag {
  display: inline-block;
  font-size: 10px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
  color: #ff4d1c;
  background: rgba(255,77,28,0.1);
  border: 1px solid rgba(255,77,28,0.2);
  border-radius: 100px; padding: 4px 12px;
  margin-bottom: 16px;
}
.section-title {
  font-family: 'Syne', sans-serif; font-size: clamp(28px, 5vw, 44px); font-weight: 800;
  color: #f5f0e8; line-height: 1.1; margin-bottom: 12px; letter-spacing: -1px;
}
.accent { color: #ff4d1c; }
.section-sub { font-size: 15px; color: #666; line-height: 1.6; margin-bottom: 32px; max-width: 560px; }

.input-card {
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px; padding: 28px; margin-bottom: 24px;
}
.ilabel { display: block; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #ff6040; margin-bottom: 8px; }
.ifield {
  width: 100%;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px; padding: 13px 16px;
  color: #f0ead8; font-family: 'DM Sans', sans-serif; font-size: 14px;
  outline: none; transition: border-color 0.2s; margin-bottom: 18px; resize: none;
}
.ifield:focus { border-color: rgba(255,77,28,0.35); background: rgba(255,255,255,0.06); }
.ifield::placeholder { color: #333; }

.error-box {
  background: rgba(255,60,60,0.08); border: 1px solid rgba(255,60,60,0.2);
  border-radius: 8px; padding: 11px 14px; color: #ff7070;
  font-size: 13px; margin-bottom: 16px;
}

.btn-primary {
  width: 100%; background: linear-gradient(135deg, #ff4d1c, #ff7a40);
  border: none; border-radius: 10px; padding: 15px 24px;
  color: white; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 700;
  cursor: pointer; transition: all 0.25s; letter-spacing: 0.3px;
}
.btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(255,77,28,0.35); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.btn-ghost {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px; padding: 8px 14px; color: #888;
  font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.btn-ghost:hover { background: rgba(255,255,255,0.09); color: #ccc; }

.btn-fire {
  background: linear-gradient(135deg, #ff2d00, #ff6030);
  border: none; border-radius: 10px; padding: 14px 24px;
  color: white; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 700;
  cursor: pointer; transition: all 0.25s; white-space: nowrap; flex-shrink: 0;
}
.btn-fire:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(255,60,0,0.4); }

.progress-wrap {
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
  border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.progress-label { font-size: 12px; color: #666; flex: 1; min-width: 200px; }
.progress-track { flex: 2; height: 4px; background: rgba(255,255,255,0.06); border-radius: 100px; overflow: hidden; min-width: 120px; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #ff4d1c, #ff8040); border-radius: 100px; transition: width 0.5s ease; }
.progress-pct { font-size: 12px; color: #ff6040; font-weight: 700; min-width: 36px; text-align: right; }

.report-card {
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 16px; overflow: hidden; margin-bottom: 24px;
}
.report-topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.05);
  background: rgba(255,255,255,0.02); flex-wrap: wrap; gap: 10px;
}
.report-tag { font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #ff6040; }
.report-body { padding: 28px 28px 36px; }

/* markdown styles */
.r-h1 { font-family: 'Syne', sans-serif; font-size: 26px; font-weight: 800; color: #f5f0e8; margin: 28px 0 14px; letter-spacing: -0.5px; }
.r-h2 { font-family: 'Syne', sans-serif; font-size: 18px; font-weight: 700; color: #ff6040; margin: 24px 0 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,77,28,0.15); }
.r-h3 { font-size: 13px; font-weight: 700; color: #d0c8b8; margin: 18px 0 8px; text-transform: uppercase; letter-spacing: 1px; }
.r-h4 { font-size: 13px; font-weight: 600; color: #aaa; margin: 12px 0 6px; }
.r-p { font-size: 14px; line-height: 1.8; color: #9a9080; margin-bottom: 10px; }
.r-ul { padding-left: 0; margin: 8px 0 14px; list-style: none; }
.r-ul li { font-size: 14px; line-height: 1.7; color: #9a9080; padding: 4px 0 4px 20px; position: relative; }
.r-ul li::before { content: "▸"; position: absolute; left: 0; color: #ff4d1c; font-size: 11px; top: 6px; }
.r-ol { padding-left: 20px; margin: 8px 0 14px; }
.r-ol li { font-size: 14px; line-height: 1.7; color: #9a9080; margin-bottom: 4px; }
.r-table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
.r-table td { padding: 9px 14px; border: 1px solid rgba(255,255,255,0.06); color: #888; }
.r-table tr:first-child td { background: rgba(255,77,28,0.08); color: #d0c0b0; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.r-hr { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 20px 0; }

.step2-cta { margin: 32px 0 8px; }
.cta-box {
  background: linear-gradient(135deg, rgba(255,77,28,0.08), rgba(255,120,60,0.05));
  border: 1px solid rgba(255,77,28,0.2);
  border-radius: 16px; padding: 24px 28px;
  display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
}
.cta-icon { font-size: 32px; flex-shrink: 0; }
.cta-title { font-size: 16px; font-weight: 700; color: #f0e8d8; margin-bottom: 4px; line-height: 1.4; }
.cta-sub { font-size: 13px; color: #666; line-height: 1.5; }

.tabs-bar {
  display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px;
}
.tab-btn {
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 100px; padding: 7px 14px;
  color: #555; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.tab-btn:hover { color: #aaa; border-color: rgba(255,255,255,0.12); }
.tab-btn.tab-active { background: rgba(255,77,28,0.12); border-color: rgba(255,77,28,0.3); color: #ff6040; }
.tab-label { }

.nav-btns { display: flex; gap: 10px; margin-top: 16px; }

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.spin { display: inline-block; animation: spin 0.8s linear infinite; }

@media (max-width: 600px) {
  .step-pill .sp-label { display: none; }
  .cta-box { flex-direction: column; }
  .report-body { padding: 18px 16px 24px; }
}
`;
