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

const STEP2A_SYSTEM = `Act as an elite combination of:
- Top 1% sales closer
- Direct response copywriter
- TikTok/Meta viral strategist
- Performance marketer (CPA obsessed)

Your mission: Turn this business into a HIGH-CONVERTING, FAST-SCALING REVENUE MACHINE.

Based on the Sales Report provided, generate PART 1 of the execution package in Romanian, structured EXACTLY as below:

---

# ⚡ PACHET EXECUȚIE — PARTEA 1

---

## 1. 🔪 REVENUE KILLERS (BRUTAL TRUTH)
List the 5 biggest conversion killers. For each:
- Problem (specific, brutal)
- Why it destroys revenue (mechanism)
- Immediate fix (actionable, 1 sentence)

---

## 2. 📞 SCRIPTS VÂNZARE DIRECTĂ

### A. DM SALES SCRIPT (Instagram / WhatsApp)
- Opener (pattern interrupt)
- 3 Qualification questions (SPIN style)
- Value positioning paragraph
- Soft close → Hard close
- Follow-up messages (3 variante)

### B. SALES CALL SCRIPT (HIGH-TICKET — cuvânt cu cuvânt)
- Opening (authority + trust building — primele 60 secunde)
- Discovery (pain amplification — 5 întrebări)
- Frame control
- Offer pitch (PAS framework)
- Objection handling (top 5)
- Closing lines: 3 stiluri (soft / assumptive / urgency)

### C. VOICE NOTE / VIDEO SALES SCRIPT
- Script scurt, emoțional, persuasiv (max 60 secunde)

---

## 3. 🎬 VOICEOVER TIKTOK & META — 10 RECLAME VIDEO

Pentru FIECARE din cele 10 reclame:
- **HOOK** (primele 3 secunde)
- **UNGHI** (pain / shock / authority / case study / controversial)
- **SCRIPT COMPLET** (cuvânt cu cuvânt)
- **DIRECȚIE VIZUALĂ**
- **CTA**
- **🎙️ VOICEOVER TEXT** (~550 caractere, natural, emoție + beneficiu + urgență)

Tipuri OBLIGATORII: pain-based, shock-based, authority-based, case study, controversial take, before/after, transformation, social proof, FOMO, curiosity gap.

---

## 4. 📣 AD COPY (PAID TRAFFIC READY)

### 5 Primary Texts (Facebook/TikTok)
### 5 Headlines (max 40 caractere)
### 3 Advertorial Angles (150-200 cuvinte fiecare)

---

REGULI: Fii agresiv, direct, zero fluff, totul folosibil IMEDIAT.`;

const STEP2B_SYSTEM = `Act as an elite combination of:
- Performance marketer (CPA obsessed)
- AI growth systems architect
- 7-figure business scaling expert

Based on the Sales Report provided, generate PART 2 of the execution package in Romanian, structured EXACTLY as below:

---

# ⚡ PACHET EXECUȚIE — PARTEA 2

---

## 5. 🚀 FUNNEL + OFFER UPGRADE

- Rescrie oferta (mai premium, mai irezistibilă)
- Adaugă urgency triggers, scarcity reale, bonus stack
- Cel mai bun tip de funnel pentru conversii RAPIDE
- Structura exactă: Landing page → VSL → Checkout → Upsell

---

## 6. 🤖 AI AUTOMATION SYSTEM

1. Lead capture → AI qualification (tool-uri, cum funcționează)
2. Auto DM replies (secvențe, logică)
3. Follow-up sequences (email + WhatsApp, timing exact)
4. CRM logic (pipeline stages, trigger-uri)
5. Retargeting triggers (cine, când, cu ce mesaj)

Explică pentru cineva fără background tehnic.

---

## 7. 💰 RAPID CASH STRATEGY (0–30 ZILE)

- Ziua 1-3: (acțiuni imediate)
- Ziua 4-7: (momentum)
- Ziua 8-14: (accelerare)
- Ziua 15-30: (scale)

---

## 8. 📈 SCALE TO 7 FIGURES

- Top 3 surse de trafic (cu budget minim recomandat)
- Scaling strategy (horizontal vs vertical)
- KPIs critici (cu target numeric)
- Bottleneck warnings
- Winning formula pentru CPA mic + calificare înaltă

---

REGULI: Fii agresiv, direct, zero fluff, totul folosibil IMEDIAT. Gândește ca și cum ești plătit DOAR pe rezultate.`;

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

const STEP3_SHOPIFY_SYSTEM = `You are the world's #1 Shopify conversion rate optimizer and direct response copywriter. You've helped brands achieve 4-8% conversion rates.

Based on the sales report and execution package provided, generate a COMPLETE Shopify product page in HTML that:

1. Is optimized for MAXIMUM CONVERSIONS based on the specific ICP, USPs, and objections from the report
2. Uses proven CRO frameworks: above-the-fold hero, social proof, benefit bullets, FAQ, urgency
3. Follows Shopify's liquid-compatible structure

Generate ONLY the HTML content that goes inside Shopify's product page template. Use inline CSS. Make it:
- Mobile-first responsive
- Dark/premium aesthetic with the brand's color palette  
- High-converting above-the-fold section
- Benefit-focused (not feature-focused)
- Strong urgency + scarcity elements
- Trust badges section
- FAQ section addressing the exact objections from the report
- Strong CTA button (use id="add-to-cart-btn" so Shopify can hook into it)

Structure:
1. Hero section (product title, tagline from USP, price, main CTA, urgency timer placeholder)
2. Benefits section (3-5 main benefits from report, with icons)
3. How it works (3 steps)
4. Social proof / testimonials section (use placeholder testimonials based on ICP)
5. FAQ (answer the objections from the report)
6. Final CTA section with guarantee

IMPORTANT: Output ONLY valid HTML with embedded CSS. No markdown. No explanations. Pure HTML.`;

const STEP3_VOICEOVER_SYSTEM = `You are a world-class performance creative director specializing in TikTok UGC and Meta Andromeda algorithm optimization.

Based on the sales report and product info, generate VOICEOVER SCRIPTS for 6 DIFFERENT PERSONAS. Each persona needs 3 platform-optimized voiceovers.

For EACH PERSONA generate:

### PERSONA [N]: [Name, Age, Role]
**Backstory:** (2 sentences — who they are, why they're credible)
**Tone:** (e.g., "excited mom", "skeptical-turned-believer", "authority expert")

#### 🎙️ TIKTOK VOICEOVER (15-30 sec, ~400 caractere)
- Hook in first 2 seconds
- Ultra-casual, TikTok native language
- End with soft CTA

#### 🎙️ META ANDROMEDA VOICEOVER (30-45 sec, ~600 caractere)  
- Optimized for Meta's Andromeda AI delivery system
- Emotional resonance + logic
- Clear value prop in first 5 seconds
- Strong CTA

#### 🎙️ STORY/REEL VOICEOVER (20 sec, ~350 caractere)
- Punchy, visual-dependent
- Works with product close-ups

PERSONAS TO CREATE (adapt names/details to the product niche):
1. The Skeptic (tried everything, finally found this)
2. The Expert/Authority (professional who endorses it)
3. The Young Trendsetter (Gen Z, viral energy)
4. The Relatable Mom/Parent (practical, emotional)
5. The Before/After (transformation story)
6. The Best Friend (casual recommendation, like talking to a friend)

IMPORTANT:
- Write ALL voiceovers in Romanian
- Each must sound COMPLETELY DIFFERENT (different vocabulary, rhythm, personality)
- Meta Andromeda voiceovers must have 3-5 second "retention hooks" every 8-10 seconds
- TikTok voiceovers must feel native, NOT like ads
- Include [PAUZA] markers and [EMFAZA] for delivery guidance`;

const STEP3_UGC_SYSTEM = `You are the creative director at the world's top UGC video production agency. You specialize in turning product photos into viral video concepts.

Based on the product photo description and sales report, generate a COMPLETE UGC VIDEO CREATION PACKAGE.

## 📸 UGC VIDEO BRIEF — COMPLET

Generate 5 complete UGC video concepts, each with:

### VIDEO [N]: [Concept Name]
**Format:** (vertical 9:16 / square 1:1)
**Duration:** (15s / 30s / 60s)
**Style:** (talking head / hands & product / lifestyle / GRWM / unboxing / tutorial)
**Platform:** (TikTok / Meta / Both)

**🎬 SCENE BREAKDOWN:**
Scene 1 (0-3s): [exact visual description]
Scene 2 (3-8s): [exact visual description]
... (all scenes)

**🎙️ VOICEOVER/TEXT OVERLAY:** (exact script)

**📋 SHOOTING INSTRUCTIONS:**
- Camera setup: (phone distance, angle, lighting)
- Background: (what to use, what to avoid)
- Product placement: (how to hold/display)
- B-roll shots needed: (list 3-5 specific shots)

**✍️ TEXT OVERLAYS:** (exact text, timing, style)

**🎵 MUSIC/SOUND:** (type of music, energy level, example)

**📱 CAPTION:** (first line hook + hashtags)

**💡 CREATOR BRIEF (pentru creator extern):**
(2-3 paragraphs explaining exactly what emotion to convey, how to act, what result to show — written AS IF sending to a UGC creator)

Concepts REQUIRED:
1. Unboxing reaction (first impression)
2. Problem→Solution (before/after)
3. "I wish I knew this sooner" (discovery angle)
4. Day-in-the-life (integration)
5. Duet/Response bait (algorithm hack)

IMPORTANT:
- All copy in Romanian
- Each video must be shootable with just a smartphone + natural light
- Include exact product photo usage instructions (which shot to use where)
- Optimize for TikTok/Meta Andromeda first-frame retention`;

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
  html = html.replace(/(<tr>[\s\S]*?<\/tr>\n?)+/g, m => `<table class="r-table">${m}</table>`);
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul class="r-ul">${m}</ul>`);
  html = html.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
  html = html.replace(/(<oli>[\s\S]*?<\/oli>\n?)+/g, m => `<ol class="r-ol">${m.replace(/<\/?oli>/g, m2 => m2 === '<oli>' ? '<li>' : '</li>')}</ol>`);
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

const STEP3_SECTIONS = [
  { id: "shopify", label: "🛍️ Pagina Shopify", emoji: "🛍️" },
  { id: "voiceovers", label: "🎙️ Voiceover Persona", emoji: "🎙️" },
  { id: "ugc", label: "🎬 UGC Video Brief", emoji: "🎬" },
];

// ─── MAIN APP ───────────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState("");
  const [context, setContext] = useState("");
  const [report1, setReport1] = useState("");
  const [report2, setReport2] = useState("");
  const [report3Shopify, setReport3Shopify] = useState("");
  const [report3Voiceover, setReport3Voiceover] = useState("");
  const [report3UGC, setReport3UGC] = useState("");
  const [productPhoto, setProductPhoto] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep3, setLoadingStep3] = useState(false);
  const [loadingStep3Section, setLoadingStep3Section] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [activeTab, setActiveTab] = useState(0);
  const [activeTab3, setActiveTab3] = useState(0);
  const [progress, setProgress] = useState(0);
  const [shopifyPreview, setShopifyPreview] = useState(false);
  const progressRef = useRef(null);

  useEffect(() => {
    if (loading || loadingStep3) {
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
  }, [loading, loadingStep3]);

  const callAI = async (systemPrompt, userMsg, maxTokens = 4000) => {
    const res = await fetch("/api/sales-engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
        max_tokens: maxTokens,
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
      const base = `RAPORT VÂNZĂRI (Step 1):\n${report1}\n\nPRODUS/URL: ${url}\n${context ? `Context: ${context}` : ""}`;
      const [partA, partB] = await Promise.all([
        callAI(STEP2A_SYSTEM, base + "\n\nGenerează PARTEA 1 (secțiunile 1-4)."),
        callAI(STEP2B_SYSTEM, base + "\n\nGenerează PARTEA 2 (secțiunile 5-8)."),
      ]);
      setReport2(partA + "\n\n" + partB);
    } catch { setError("Eroare la generarea Step 2. Încearcă din nou."); }
    setLoading(false);
  };

  const generateStep3 = async () => {
    setError(""); setLoadingStep3(true); setStep(3); setActiveTab3(0);
    const combined = `RAPORT STEP 1:\n${report1}\n\nPACHET EXECUȚIE STEP 2:\n${report2}\n\nPRODUS: ${url}\n${context ? `Context: ${context}` : ""}${productPhoto ? `\nDescriere foto produs: ${productPhoto}` : ""}`;

    try {
      // Generate all 3 in parallel
      setLoadingStep3Section("Generez pagina Shopify + Voiceover Persona + UGC Brief...");
      const [shopify, voiceover, ugc] = await Promise.all([
        callAI(STEP3_SHOPIFY_SYSTEM, combined + "\n\nGenerează DOAR HTML-ul paginii de produs Shopify.", 3000),
        callAI(STEP3_VOICEOVER_SYSTEM, combined + "\n\nGenerează voiceover-urile pentru toate 6 persona.", 4000),
        callAI(STEP3_UGC_SYSTEM, combined + "\n\nGenerează brief-ul complet UGC pentru toate 5 concepte video.", 4000),
      ]);
      setReport3Shopify(shopify);
      setReport3Voiceover(voiceover);
      setReport3UGC(ugc);
    } catch (e) {
      setError("Eroare la Step 3. Încearcă din nou.");
    }
    setLoadingStep3(false);
    setLoadingStep3Section("");
  };

  const copy = (text, id = "main") => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(""), 2000);
  };

  // Extract clean HTML from shopify output
  const getShopifyHTML = () => {
    const raw = report3Shopify;
    // Try to extract HTML block
    const match = raw.match(/<!DOCTYPE[\s\S]*?<\/html>/i) || raw.match(/<html[\s\S]*?<\/html>/i) || raw.match(/<div[\s\S]*/i);
    return match ? match[0] : raw;
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
              <span className="sp-label">Raport</span>
            </div>
            <div className="step-connector" />
            <div className={`step-pill ${step >= 2 ? "active" : ""} ${step > 2 ? "done" : ""}`}>
              <span className="sp-num">{step > 2 ? "✓" : "2"}</span>
              <span className="sp-label">Execuție</span>
            </div>
            <div className="step-connector" />
            <div className={`step-pill ${step >= 3 ? "active" : ""}`}>
              <span className="sp-num">3</span>
              <span className="sp-label">Shopify + Ads</span>
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
                  <button className="btn-ghost" onClick={() => copy(report1)}>{copied === "r1" ? "✓ Copiat" : "Copiază"}</button>
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
                      <button className="btn-ghost" onClick={() => copy(report2)}>{copied === "r2" ? "✓ Copiat" : "Copiază Tot"}</button>
                    </div>
                  </div>
                  <SectionView report={report2} sectionIndex={activeTab} />
                </div>

                <div className="nav-btns">
                  {activeTab > 0 && <button className="btn-ghost" onClick={() => setActiveTab(a => a - 1)}>← {STEP2_SECTIONS[activeTab - 1].label}</button>}
                  {activeTab < STEP2_SECTIONS.length - 1 && <button className="btn-primary" style={{ flex: 1 }} onClick={() => setActiveTab(a => a + 1)}>Următor: {STEP2_SECTIONS[activeTab + 1].label} →</button>}
                </div>

                {/* STEP 3 CTA */}
                <div className="step2-cta fade-in" style={{ marginTop: 32 }}>
                  <div className="cta-box cta-box-3">
                    <div className="cta-icon">🛍️</div>
                    <div style={{ flex: 1 }}>
                      <div className="cta-title">Activează <span className="accent">Step 3 — Shopify + Creatives</span></div>
                      <div className="cta-sub">Pagina de produs Shopify optimizată • Voiceover 6 Persona (TikTok + Meta Andromeda) • UGC Video Brief complet</div>
                      <div style={{ marginTop: 12 }}>
                        <label className="ilabel" style={{ marginBottom: 6, display: "block" }}>📸 Descrie product photo-ul (opțional — pentru UGC)</label>
                        <input
                          className="ifield"
                          style={{ marginBottom: 0 }}
                          placeholder="ex: sticlă albă mată pe fundal negru, lângă flori uscate, lifestyle shot..."
                          value={productPhoto}
                          onChange={e => setProductPhoto(e.target.value)}
                        />
                      </div>
                    </div>
                    <button className="btn-fire btn-fire-3" onClick={generateStep3} disabled={loadingStep3}>
                      {loadingStep3 ? <Loader text="Generez..." /> : "🛍️ Activează Step 3"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <div className="section fade-in">
            <div className="section-tag">STEP 3</div>
            <h2 className="section-title">Shopify + <span className="accent">Creatives</span></h2>
            <p className="section-sub">Pagina de produs • Voiceover Persona • UGC Video Brief</p>

            {loadingStep3 && <ProgressBar value={progress} label={loadingStep3Section || "Generez pagina Shopify, Voiceover-uri și UGC Brief-uri..."} />}
            {error && <div className="error-box">⚠️ {error}</div>}

            {(report3Shopify || report3Voiceover || report3UGC) && (
              <>
                {/* Tab bar */}
                <div className="tabs-bar" style={{ marginBottom: 16 }}>
                  {STEP3_SECTIONS.map((s, i) => (
                    <button key={s.id} className={`tab-btn tab-btn-3 ${activeTab3 === i ? "tab-active" : ""}`} onClick={() => setActiveTab3(i)}>
                      <span style={{ marginRight: 6 }}>{s.emoji}</span>{s.label.replace(/^.+ /, '')}
                    </button>
                  ))}
                  <button className="btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setStep(2)}>← Step 2</button>
                </div>

                {/* SHOPIFY TAB */}
                {activeTab3 === 0 && (
                  <div className="fade-in">
                    <div className="report-card">
                      <div className="report-topbar">
                        <span className="report-tag">🛍️ PAGINA DE PRODUS SHOPIFY — OPTIMIZATĂ CONVERSII</span>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            className={`btn-ghost ${shopifyPreview ? "tab-active" : ""}`}
                            onClick={() => setShopifyPreview(v => !v)}
                          >
                            {shopifyPreview ? "📝 Cod HTML" : "👁️ Preview"}
                          </button>
                          <button className="btn-ghost" onClick={() => copy(getShopifyHTML(), "shopify")}>
                            {copied === "shopify" ? "✓ Copiat!" : "📋 Copiază HTML"}
                          </button>
                        </div>
                      </div>

                      {shopifyPreview ? (
                        <div style={{ padding: 0, height: 600, overflow: "hidden" }}>
                          <iframe
                            srcDoc={getShopifyHTML()}
                            style={{ width: "100%", height: "100%", border: "none", background: "white" }}
                            title="Shopify Preview"
                          />
                        </div>
                      ) : (
                        <div style={{ padding: "20px 24px" }}>
                          <div className="shopify-instructions">
                            <div className="si-title">📌 Cum adaugi în Shopify:</div>
                            <ol className="si-list">
                              <li>Mergi la <strong>Online Store → Themes → Edit code</strong></li>
                              <li>Deschide <strong>templates/product.liquid</strong> (sau product.json)</li>
                              <li>Copiază HTML-ul de mai jos și inserează-l în secțiunea dorită</li>
                              <li>Salvează și preview-uiești</li>
                            </ol>
                          </div>
                          <pre className="code-block">{getShopifyHTML()}</pre>
                        </div>
                      )}
                    </div>
                    <div className="s3-tip">💡 <strong>Pro tip:</strong> Testează varianta mobilă imediat după import. Elementele de urgency (timer, stoc limitat) trebuie conectate la Shopify apps ca <em>Urgency Bear</em> sau <em>Countdown Timer Bar</em>.</div>
                  </div>
                )}

                {/* VOICEOVER TAB */}
                {activeTab3 === 1 && (
                  <div className="fade-in">
                    <div className="report-card">
                      <div className="report-topbar">
                        <span className="report-tag">🎙️ VOICEOVER 6 PERSONA — TIKTOK + META ANDROMEDA</span>
                        <button className="btn-ghost" onClick={() => copy(report3Voiceover, "vo")}>
                          {copied === "vo" ? "✓ Copiat" : "Copiază Tot"}
                        </button>
                      </div>
                      <div className="report-body" dangerouslySetInnerHTML={{ __html: renderMd(report3Voiceover) }} />
                    </div>
                    <div className="s3-tip">💡 <strong>Pro tip Meta Andromeda:</strong> Voiceover-urile sunt optimizate pentru semnalele de retenție ale algoritmului Andromeda. Filmează hook-ul (primele 3 sec) separat pentru a putea testa variante fără a refilma tot.</div>
                  </div>
                )}

                {/* UGC TAB */}
                {activeTab3 === 2 && (
                  <div className="fade-in">
                    <div className="report-card">
                      <div className="report-topbar">
                        <span className="report-tag">🎬 UGC VIDEO BRIEF — 5 CONCEPTE COMPLETE</span>
                        <button className="btn-ghost" onClick={() => copy(report3UGC, "ugc")}>
                          {copied === "ugc" ? "✓ Copiat" : "Copiază Tot"}
                        </button>
                      </div>
                      <div className="report-body" dangerouslySetInnerHTML={{ __html: renderMd(report3UGC) }} />
                    </div>
                    <div className="ugc-platforms">
                      <div className="ugc-platform-card">
                        <div className="up-icon">📱</div>
                        <div className="up-title">Trimite creator-ului</div>
                        <div className="up-sub">Copiază brief-ul și trimite-l direct unui creator UGC de pe Billo, Insense sau direct de pe TikTok Creator Marketplace</div>
                      </div>
                      <div className="ugc-platform-card">
                        <div className="up-icon">🤳</div>
                        <div className="up-title">Filmează singur</div>
                        <div className="up-sub">Fiecare brief conține instrucțiuni exacte de filmare cu telefonul. Ai nevoie doar de product photo + lumină naturală</div>
                      </div>
                      <div className="ugc-platform-card">
                        <div className="up-icon">🤖</div>
                        <div className="up-title">AI Video (no creator)</div>
                        <div className="up-sub">Folosește voiceover-urile + brief-ul cu tools ca HeyGen, Creatify sau Captions.ai pentru UGC complet AI-generated</div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── SECTION VIEW ───────────────────────────────────────────────────────────

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

.step-pills { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.step-pill {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border-radius: 100px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03);
  font-size: 11px; font-weight: 500; color: #666;
  transition: all 0.3s;
}
.step-pill.active { border-color: rgba(255,77,28,0.4); background: rgba(255,77,28,0.08); color: #ff8060; }
.step-pill.done { border-color: rgba(0,200,100,0.3); background: rgba(0,200,100,0.06); color: #00c864; }
.sp-num { width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }
.step-pill.active .sp-num { background: #ff4d1c; color: white; }
.step-pill.done .sp-num { background: #00c864; color: white; }
.step-connector { width: 16px; height: 1px; background: rgba(255,255,255,0.1); flex-shrink: 0; }

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
.btn-fire:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(255,60,0,0.4); }
.btn-fire:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-fire-3 {
  background: linear-gradient(135deg, #6c2fff, #a060ff);
  box-shadow: none;
  padding: 16px 28px; font-size: 15px;
}
.btn-fire-3:hover:not(:disabled) { box-shadow: 0 8px 28px rgba(108,47,255,0.4); }

.progress-wrap {
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
  border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.progress-label { font-size: 12px; color: #666; flex: 1; min-width: 200px; }
.progress-track { flex: 2; height: 4px; background: rgba(255,255,255,0.06); border-radius: 100px; overflow: hidden; min-width: 120px; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #ff4d1c, #a060ff); border-radius: 100px; transition: width 0.5s ease; }
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
  display: flex; align-items: flex-start; gap: 20px; flex-wrap: wrap;
}
.cta-box-3 {
  background: linear-gradient(135deg, rgba(108,47,255,0.1), rgba(160,96,255,0.05));
  border-color: rgba(108,47,255,0.25);
}
.cta-icon { font-size: 32px; flex-shrink: 0; margin-top: 2px; }
.cta-title { font-size: 16px; font-weight: 700; color: #f0e8d8; margin-bottom: 4px; line-height: 1.4; }
.cta-sub { font-size: 13px; color: #666; line-height: 1.5; }

.tabs-bar {
  display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; align-items: center;
}
.tab-btn {
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 100px; padding: 7px 14px;
  color: #555; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.tab-btn:hover { color: #aaa; border-color: rgba(255,255,255,0.12); }
.tab-btn.tab-active { background: rgba(255,77,28,0.12); border-color: rgba(255,77,28,0.3); color: #ff6040; }

.tab-btn-3.tab-active { background: rgba(108,47,255,0.15); border-color: rgba(108,47,255,0.35); color: #a060ff; }

.nav-btns { display: flex; gap: 10px; margin-top: 16px; }

/* Shopify specific */
.shopify-instructions {
  background: rgba(108,47,255,0.06); border: 1px solid rgba(108,47,255,0.15);
  border-radius: 10px; padding: 16px 20px; margin-bottom: 20px;
}
.si-title { font-size: 12px; font-weight: 700; color: #a060ff; margin-bottom: 10px; letter-spacing: 1px; text-transform: uppercase; }
.si-list { padding-left: 18px; }
.si-list li { font-size: 13px; color: #888; line-height: 1.8; }
.si-list li strong { color: #ccc; }

.code-block {
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px; padding: 20px;
  font-family: 'Fira Code', 'Courier New', monospace; font-size: 11px;
  color: #8a9; line-height: 1.6; overflow-x: auto; white-space: pre-wrap;
  word-break: break-all;
}

.s3-tip {
  background: rgba(255,200,0,0.05); border: 1px solid rgba(255,200,0,0.15);
  border-radius: 10px; padding: 14px 18px;
  font-size: 13px; color: #888; line-height: 1.6; margin-bottom: 24px;
}
.s3-tip strong { color: #ffcc44; }
.s3-tip em { color: #aaa; }

/* UGC Platform cards */
.ugc-platforms {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;
  margin-top: 20px;
}
.ugc-platform-card {
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px; padding: 18px;
  transition: border-color 0.2s;
}
.ugc-platform-card:hover { border-color: rgba(108,47,255,0.25); }
.up-icon { font-size: 24px; margin-bottom: 10px; }
.up-title { font-size: 13px; font-weight: 700; color: #d0c8b8; margin-bottom: 6px; }
.up-sub { font-size: 12px; color: #555; line-height: 1.6; }

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.spin { display: inline-block; animation: spin 0.8s linear infinite; }

@media (max-width: 600px) {
  .step-pill .sp-label { display: none; }
  .cta-box { flex-direction: column; }
  .report-body { padding: 18px 16px 24px; }
  .btn-fire-3 { width: 100%; }
}
`;
