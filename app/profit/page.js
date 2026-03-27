
  'use client';
import { useState, useEffect, useCallback } from 'react';

/* ─── HELPERS ─────────────────────────────────────────────── */
const fmt = (n, dec = 2) => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtK = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : fmt(n);
const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (m) => { const [y, mo] = m.split('-'); const d = new Date(y, mo - 1, 1); return d.toLocaleString('ro-RO', { month: 'long', year: 'numeric' }); };

function splitCSV(line) {
  const res = []; let cur = '', q = false;
  for (const c of line) { if (c === '"') q = !q; else if ((c === ',' || c === ';') && !q) { res.push(cur); cur = ''; } else cur += c; }
  res.push(cur); return res;
}

/* ─── MAIN COMPONENT ──────────────────────────────────────── */
export default function ProfitPage() {
  const [month, setMonth] = useState(currentMonth);

  /* Shopify */
  const [shopifyOrders, setShopifyOrders] = useState([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyDone, setShopifyDone] = useState(false);

  /* SmartBill */
  const [sbEmail, setSbEmail] = useState('');
  const [sbToken, setSbToken] = useState('');
  const [sbCif, setSbCif] = useState('');
  const [sbData, setSbData] = useState(null);
  const [sbLoading, setSbLoading] = useState(false);
  const [sbDone, setSbDone] = useState(false);
  const [sbError, setSbError] = useState('');

  /* GLS Excel */
  const [glsCost, setGlsCost] = useState(0);
  const [glsManual, setGlsManual] = useState('');
  const [glsRows, setGlsRows] = useState([]);
  const [glsByOrder, setGlsByOrder] = useState({}); // clientRef -> cost
  const [glsDone, setGlsDone] = useState(false);

  /* Marketing */
  const [metaCost, setMetaCost] = useState('');
  const [tikTokCost, setTikTokCost] = useState('');
  const [googleCost, setGoogleCost] = useState('');

  /* Fixed costs */
  const [fixedCosts, setFixedCosts] = useState([
    { id: 1, name: 'Shopify subscription', amount: '150', currency: 'RON' },
    { id: 2, name: 'Contabilitate', amount: '300', currency: 'RON' },
    { id: 3, name: 'Ambalaje', amount: '', currency: 'RON' },
  ]);

  /* Other variable costs */
  const [otherCosts, setOtherCosts] = useState([]);

  /* Default product costs — editabile, salvate în browser */
  const DEFAULT_PRODUCT_COSTS = [
    { id: 'DM56_SIL',      pattern: 'silicon',           excludes: ['metal','protectie','protecție'], name: 'Delta Max Silicon (fără protecție)',          cost: 159 },
    { id: 'DM56_SIL_PROT', pattern: 'silicon',           excludes: ['metal'],                         name: 'Delta Max Silicon + Protecție ecran',         cost: 159 },
    { id: 'DM56_MET',      pattern: 'silicon+ metal',    excludes: [],                                name: 'Delta Max Silicon + Metal + Protecție',       cost: 179 },
    { id: 'DM56_MET2',     pattern: 'silicon+metal',     excludes: [],                                name: 'Delta Max Silicon+Metal',                     cost: 179 },
    { id: 'HD300',         pattern: 'delta max pro',     excludes: [],                                name: 'Delta Max PRO HD300',                         cost: 181 },
    { id: 'Z85',           pattern: 'z85',               excludes: [],                                name: 'Z85 (toate modelele)',                        cost: 65  },
    { id: 'U8',            pattern: 'u8',                excludes: [],                                name: 'U8 Ultra',                                    cost: 208 },
    { id: 'M99',           pattern: 'delta max ultra',   excludes: [],                                name: 'Delta Max Ultra M99',                         cost: 275 },
    { id: 'DM58',          pattern: 'delta max plus',    excludes: [],                                name: 'Delta Max Plus DM58',                         cost: 169 },
    { id: 'DM58B',         pattern: 'dm58',              excludes: [],                                name: 'Delta Max Plus DM58 (SKU)',                   cost: 169 },
  ];
  const [stdCosts, setStdCosts] = useState(() => {
    try {
      const saved = localStorage.getItem('glamx_std_costs');
      return saved ? JSON.parse(saved) : DEFAULT_PRODUCT_COSTS;
    } catch { return DEFAULT_PRODUCT_COSTS; }
  });

  /* Product cost mapping */
  const [productCosts, setProductCosts] = useState({});    // SmartBill costs
  const [shopifyCosts, setShopifyCosts] = useState({});    // Shopify cost by name
  const [shopifyVariantCosts, setShopifyVariantCosts] = useState({}); // Shopify cost by variant_id
  const [shopifySkuCosts, setShopifySkuCosts] = useState({});  // Shopify cost by SKU
  const [shopifyCostsDone, setShopifyCostsDone] = useState(false);
  const [manualCosts, setManualCosts] = useState({});
  const [costSource, setCostSource] = useState({});        // per-product override: 'smartbill'|'shopify'|'manual'
  const [sbDebug, setSbDebug] = useState('');
  const [sbType, setSbType] = useState('products');

  /* Load saved creds */
  useEffect(() => {
    const e = localStorage.getItem('sb_email');
    const t = localStorage.getItem('sb_token');
    const c = localStorage.getItem('sb_cif');
    if (e) setSbEmail(e);
    if (t) setSbToken(t);
    if (c) setSbCif(c);

    const savedFixed = localStorage.getItem('glamx_fixed_costs');
    if (savedFixed) setFixedCosts(JSON.parse(savedFixed));
    const savedStd = localStorage.getItem('glamx_std_costs');
    if (savedStd) { try { setStdCosts(JSON.parse(savedStd)); } catch {} }
    const savedOther = localStorage.getItem('glamx_other_costs');
    if (savedOther) setOtherCosts(JSON.parse(savedOther));
    const savedMeta = localStorage.getItem('glamx_meta_cost');
    if (savedMeta) setMetaCost(savedMeta);

    /* Load Shopify orders from previous session */
    const savedOrders = localStorage.getItem('gx_orders');
    if (savedOrders) {
      const parsed = JSON.parse(savedOrders);
      setShopifyOrders(parsed);
      setShopifyDone(true);
    }

    /* Load saved Shopify product costs */
    const savedShopifyCosts = localStorage.getItem('glamx_shopify_costs');
    if (savedShopifyCosts) { setShopifyCosts(JSON.parse(savedShopifyCosts)); setShopifyCostsDone(true); }
    const savedVariantCosts = localStorage.getItem('glamx_shopify_variant_costs');
    if (savedVariantCosts) setShopifyVariantCosts(JSON.parse(savedVariantCosts));
    const savedSkuCosts = localStorage.getItem('glamx_shopify_sku_costs');
    if (savedSkuCosts) setShopifySkuCosts(JSON.parse(savedSkuCosts));
  }, []);

  /* ── Shopify fetch ── */
  const fetchShopify = async () => {
    const domain = localStorage.getItem('gx_d');
    const token = localStorage.getItem('gx_t');
    if (!domain || !token) { alert('Conectează-te mai întâi la Shopify din pagina principală!'); return; }
    setShopifyLoading(true);
    try {
      const [year, m] = month.split('-');
      const daysInMonth = new Date(year, m, 0).getDate();
      const from = `${year}-${m}-01`;
      const to = `${year}-${m}-${daysInMonth}`;
      const fields = 'id,name,financial_status,fulfillment_status,fulfillments,cancelled_at,created_at,total_price,line_items,note_attributes,tags';
      const res = await fetch(`/api/orders?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&created_at_min=${from}T00:00:00&created_at_max=${to}T23:59:59&fields=${fields}`);
      const data = await res.json();
      const orders = (data.orders || []).filter(o => !o.cancelled_at && o.financial_status !== 'voided');
      const processed = orders.map(o => {
        // Extract invoice from xConnector note_attributes
        const notes = o.note_attributes || [];
        const invUrlAttr   = notes.find(a => (a.name||'').toLowerCase().includes('invoice-url') && !(a.name||'').toLowerCase().includes('short'));
        const invShortAttr = notes.find(a => (a.name||'').toLowerCase().includes('invoice-short-url'));
        const invoiceUrl   = invUrlAttr?.value || '';
        const invoiceShort = invShortAttr?.value || '';
        // Extract invoice number from URL param n=XXXX
        const invNumMatch  = invoiceUrl.match(/[?&]n=(\d+)/);
        const invoiceNumber = invNumMatch ? invNumMatch[1] : '';
        const hasInvoice   = !!(invoiceUrl || invoiceShort);
        return {
          id: o.id, name: o.name,
          total: parseFloat(o.total_price) || 0,
          financial: o.financial_status,
          fulfillment: o.fulfillment_status,
          items: (o.line_items || []).map(i => ({ name: i.name, sku: i.sku || '', variantId: String(i.variant_id || ''), qty: i.quantity || 1, price: parseFloat(i.price) || 0 })),
          createdAt: o.created_at,
          invoiceNumber,
          hasInvoice,
          noteAttributes: notes,
          tags: o.tags || '',
        };
      });
      setShopifyOrders(processed);
      setShopifyDone(true);
      localStorage.setItem('gx_orders_profit', JSON.stringify(processed));

      /* ── Fetch Shopify cost_per_item in parallel ── */
      try {
        const costRes = await fetch(`/api/product-costs?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}`);
        const costData = await costRes.json();
        if (costData.costs || costData.variantCosts) {
          setShopifyCosts(costData.costs || {});
          setShopifyVariantCosts(costData.variantCosts || {});
          setShopifySkuCosts(costData.skuCosts || {});
          setShopifyCostsDone(true);
          localStorage.setItem('glamx_shopify_costs', JSON.stringify(costData.costs || {}));
          localStorage.setItem('glamx_shopify_variant_costs', JSON.stringify(costData.variantCosts || {}));
          localStorage.setItem('glamx_shopify_sku_costs', JSON.stringify(costData.skuCosts || {}));
        }
      } catch { /* non-critical, continue without Shopify costs */ }
    } catch (e) { alert('Eroare Shopify: ' + e.message); }
    finally { setShopifyLoading(false); }
  };

  /* ── SmartBill fetch ── */
  const fetchSmartBill = async () => {
    if (!sbEmail || !sbToken || !sbCif) { setSbError('Completează toate câmpurile SmartBill!'); return; }
    localStorage.setItem('sb_email', sbEmail);
    localStorage.setItem('sb_token', sbToken);
    localStorage.setItem('sb_cif', sbCif);
    setSbLoading(true); setSbError(''); setSbDebug('');
    try {
      // Try product list first, fallback to expense invoices
      const res = await fetch(`/api/smartbill?email=${encodeURIComponent(sbEmail)}&token=${encodeURIComponent(sbToken)}&cif=${encodeURIComponent(sbCif)}&month=${month}&type=${sbType}`);
      const data = await res.json();
      
      // Show debug info
      setSbDebug(JSON.stringify(data, null, 2).slice(0, 500));
      
      if (data.error) throw new Error(data.error);
      
      // Costs come pre-extracted from API route
      const costs = data.costs || {};
      setProductCosts(costs);
      setSbData(data);
      setSbDone(true);
      localStorage.setItem('glamx_sb_costs', JSON.stringify(costs));
    } catch (e) { setSbError('Eroare SmartBill: ' + e.message); }
    finally { setSbLoading(false); }
  };

  /* ── GLS Excel parse (CSV + XLSX) ── */
  const parseGLSExcel = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isXLSX = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();

    const processData = (hdrs, dataRows) => {
      // GLS Settlement Document - known column names
      const COL_TOTAL    = 'total amount';
      const COL_CLIENT   = 'client reference';
      const COL_PARCEL   = 'parcel number';
      const COL_INVOICE  = 'invoice number';

      // Try exact match first, then partial
      const findCol = (...names) => hdrs.find(h => names.some(n => h === n)) 
                                 || hdrs.find(h => names.some(n => h.includes(n)));

      const totalKey   = findCol(COL_TOTAL, 'total', 'amount', 'suma', 'valoare');
      const clientKey  = findCol(COL_CLIENT, 'client reference', 'referinta', 'reference');
      const parcelKey  = findCol(COL_PARCEL, 'parcel', 'colet', 'awb', 'tracking');
      const invoiceKey = findCol(COL_INVOICE, 'invoice number', 'factura');

      let total = 0;
      const byOrder = {}; // clientRef -> total cost
      const parsed = [];

      dataRows.forEach(r => {
        const rawVal = r[totalKey];
        const cost = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal || '0').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
        const clientRef = String(r[clientKey] || '').trim();
        const parcel = String(r[parcelKey] || '').trim();
        if (cost > 0) {
          total += cost;
          if (clientRef) byOrder[clientRef] = (byOrder[clientRef] || 0) + cost;
          parsed.push({ parcel, clientRef, cost });
        }
      });

      setGlsRows(parsed);
      setGlsCost(total);
      setGlsByOrder(byOrder);
      setGlsDone(true);
    };

    if (isXLSX) {
      reader.onload = (ev) => {
        const loadXLSX = () => {
          const wb = window.XLSX.read(ev.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
          // Row 0 = headers
          const hdrs = (json[0] || []).map(h => String(h || '').toLowerCase().trim());
          const dataRows = json.slice(1).map(row => {
            const o = {};
            hdrs.forEach((h, i) => o[h] = row[i] !== undefined ? row[i] : '');
            return o;
          }).filter(r => Object.values(r).some(v => v !== '' && v !== null));
          processData(hdrs, dataRows);
        };
        if (window.XLSX) { loadXLSX(); }
        else {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          s.onload = loadXLSX;
          document.head.appendChild(s);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (ev) => {
        const lines = ev.target.result.split(/\r?\n/).filter(l => l.trim());
        const delim = (lines[0].match(/;/g)||[]).length > (lines[0].match(/,/g)||[]).length ? ';' : ',';
        const hdrs = splitCSV(lines[0]).map(h => h.replace(/"/g,'').trim().toLowerCase());
        const dataRows = lines.slice(1).map(l => {
          const vals = splitCSV(l);
          const o = {};
          hdrs.forEach((h, i) => o[h] = (vals[i]||'').replace(/"/g,'').trim());
          return o;
        }).filter(r => Object.values(r).some(v => v));
        processData(hdrs, dataRows);
      };
      reader.readAsText(file, 'UTF-8');
    }
  };

  /* ── CALCULATIONS ── */
  const deliveredOrders = shopifyOrders.filter(o => o.fulfillment === 'fulfilled' && o.financial === 'paid');
  const totalRevenue = deliveredOrders.reduce((s, o) => s + o.total, 0);
  const totalOrders = deliveredOrders.length;

  /* Resolve cost — priority: Manual > SmartBill > Shopify (variant_id > SKU > name) */
  const resolveCost = (item) => {
    const nameKey    = (item.name || '').toLowerCase().trim();
    const skuKey     = (item.sku || '').toLowerCase().trim();
    const variantId  = String(item.variantId || '');
    const override   = costSource[item.name];

    if (override === 'manual' || (!override && manualCosts[item.name] !== undefined && manualCosts[item.name] !== '')) {
      return { cost: parseFloat(manualCosts[item.name]) || 0, src: 'manual' };
    }
    if (override === 'smartbill' || (!override && (productCosts[nameKey] || productCosts[skuKey]))) {
      return { cost: productCosts[nameKey] || productCosts[skuKey] || 0, src: 'smartbill' };
    }
    // Shopify: try variant_id first (most accurate), then SKU, then name
    const shopifyCostByVariant = variantId ? shopifyVariantCosts[variantId] : null;
    const shopifyCostBySku     = skuKey ? shopifySkuCosts[skuKey] : null;
    const shopifyCostByName    = shopifyCosts[nameKey];
    const shopifyCost = shopifyCostByVariant || shopifyCostBySku || shopifyCostByName;
    if (override === 'shopify' || (!override && shopifyCost)) {
      return { cost: shopifyCost || 0, src: 'shopify' };
    }
    // Standard costs — pattern matching on product name
    const nameLower = nameKey;
    for (const std of stdCosts) {
      const pat = std.pattern.toLowerCase();
      if (nameLower.includes(pat)) {
        const excluded = (std.excludes || []).some(ex => nameLower.includes(ex.toLowerCase()));
        if (!excluded) return { cost: std.cost, src: 'standard' };
      }
    }
    return { cost: 0, src: 'none' };
  };

  /* Cost produse — prioritate: Manual → SmartBill → Shopify (sau override per produs) */
  const getCOGS = useCallback(() => {
    if (!shopifyOrders.length) return 0;
    let total = 0;
    deliveredOrders.forEach(order => {
      order.items.forEach(item => {
        const { cost } = resolveCost(item);
        total += cost * item.qty;
      });
    });
    return total;
  }, [deliveredOrders, productCosts, shopifyCosts, shopifyVariantCosts, shopifySkuCosts, manualCosts, costSource, stdCosts]);

  const cogs = getCOGS();
  const totalMarketing = (parseFloat(metaCost) || 0) + (parseFloat(tikTokCost) || 0) + (parseFloat(googleCost) || 0);
  const totalFixed = fixedCosts.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  const totalOther = otherCosts.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  const totalCosts = cogs + glsCost + totalMarketing + totalFixed + totalOther;
  const grossProfit = totalRevenue - cogs;
  const netProfit = totalRevenue - totalCosts;
  const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const roasMarketing = totalMarketing > 0 ? totalRevenue / totalMarketing : 0;

  /* Fixed costs helpers */
  const addFixed = () => setFixedCosts(p => [...p, { id: Date.now(), name: '', amount: '', currency: 'RON' }]);
  const updateFixed = (id, field, val) => setFixedCosts(p => p.map(c => c.id === id ? { ...c, [field]: val } : c));
  const removeFixed = (id) => setFixedCosts(p => p.filter(c => c.id !== id));
  const addOther = () => setOtherCosts(p => [...p, { id: Date.now(), name: '', amount: '' }]);
  const updateOther = (id, field, val) => setOtherCosts(p => p.map(c => c.id === id ? { ...c, [field]: val } : c));
  const removeOther = (id) => setOtherCosts(p => p.filter(c => c.id !== id));

  const saveSettings = () => {
    localStorage.setItem('glamx_fixed_costs', JSON.stringify(fixedCosts));
    localStorage.setItem('glamx_other_costs', JSON.stringify(otherCosts));
    localStorage.setItem('glamx_meta_cost', metaCost);
    localStorage.setItem('glamx_std_costs', JSON.stringify(stdCosts));
    alert('✅ Salvat!');
  };

  /* Unique products for manual cost entry */
  const uniqueProducts = [...new Set(deliveredOrders.flatMap(o => o.items.map(i => i.name)))];

  return (
    <>
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box;}
        body{background:#080c10;color:#e8edf2;font-family:'DM Sans',system-ui,sans-serif;}
        .wrap{max-width:1340px;margin:0 auto;padding:20px 14px 80px;}
        
        /* HEADER */
        .ph{display:flex;align-items:center;gap:10px;margin-bottom:24px;padding-bottom:18px;border-bottom:1px solid #1e2a35;flex-wrap:wrap;}
        .logo{background:#f97316;color:#fff;font-weight:800;font-size:14px;padding:6px 10px;border-radius:8px;}
        .ph h1{font-size:18px;font-weight:700;}
        .ph p{font-size:11px;color:#94a3b8;}
        .month-sel{margin-left:auto;display:flex;align-items:center;gap:8px;}
        .month-sel label{font-size:11px;color:#94a3b8;}
        .month-sel input{background:#161d24;border:1px solid #243040;color:#e8edf2;padding:6px 10px;border-radius:8px;font-size:12px;outline:none;}
        .month-sel input:focus{border-color:#f97316;}
        .back-btn{background:#161d24;border:1px solid #243040;color:#94a3b8;padding:6px 12px;border-radius:20px;font-size:11px;cursor:pointer;text-decoration:none;}
        .back-btn:hover{border-color:#f97316;color:#f97316;}

        /* SECTION TITLE */
        .st{font-size:10px;color:#f97316;text-transform:uppercase;letter-spacing:2.5px;margin-bottom:10px;display:flex;align-items:center;gap:8px;}
        .st::after{content:'';flex:1;height:1px;background:#1e2a35;}

        /* GRID LAYOUT */
        .main-grid{display:grid;grid-template-columns:1fr 360px;gap:16px;align-items:start;}
        @media(max-width:900px){.main-grid{grid-template-columns:1fr;}}

        /* SUMMARY CARD (top) */
        .summary-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px;}
        .sum-card{background:#0f1419;border-radius:12px;padding:16px 14px;position:relative;overflow:hidden;}
        .sum-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--c,#f97316);}
        .sum-emoji{font-size:18px;display:block;margin-bottom:6px;}
        .sum-val{font-size:26px;font-weight:800;color:var(--c,#f97316);letter-spacing:-0.5px;line-height:1;}
        .sum-val.neg{color:#f43f5e;}
        .sum-label{font-size:11px;color:#94a3b8;margin-top:4px;}
        .sum-sub{font-size:10px;color:#4a5568;margin-top:2px;}

        /* PROFIT BREAKDOWN */
        .breakdown{background:#0f1419;border:1px solid #1e2a35;border-radius:12px;overflow:hidden;margin-bottom:14px;}
        .brow{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #1e2a35;font-size:12px;}
        .brow:last-child{border-bottom:none;}
        .brow.total{background:#161d24;font-weight:700;}
        .brow.profit-pos{background:rgba(16,185,129,.06);}
        .brow.profit-neg{background:rgba(244,63,94,.06);}
        .blbl{color:#94a3b8;display:flex;align-items:center;gap:6px;}
        .bval{font-family:monospace;font-weight:500;}
        .bval.g{color:#10b981;}.bval.r{color:#f43f5e;}.bval.y{color:#f59e0b;}.bval.o{color:#f97316;}.bval.b{color:#3b82f6;}
        .bar-wrap{height:3px;background:#1e2a35;border-radius:2px;margin-top:4px;overflow:hidden;}
        .bar-fill{height:100%;border-radius:2px;transition:width .8s;}

        /* DATA SOURCE CARDS */
        .source-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
        @media(max-width:600px){.source-grid{grid-template-columns:1fr;}}
        .src-card{background:#0f1419;border:1px solid #1e2a35;border-radius:11px;padding:14px;}
        .src-card.done{border-color:#10b981;}
        .src-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
        .src-icon{font-size:20px;}
        .src-title{font-size:13px;font-weight:600;}
        .src-status{font-size:10px;color:#94a3b8;margin-left:auto;}
        .src-status.ok{color:#10b981;}
        .lbl{display:block;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;margin-top:8px;}
        input[type=text],input[type=email],input[type=password],input[type=number]{width:100%;background:#161d24;border:1px solid #243040;color:#e8edf2;padding:8px 10px;border-radius:7px;font-size:12px;font-family:monospace;outline:none;}
        input:focus{border-color:#f97316;}
        input[type=file]{background:#161d24;border:1px solid #243040;color:#94a3b8;padding:7px 10px;border-radius:7px;font-size:11px;width:100%;}
        .btn{border:none;padding:8px 14px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer;transition:all .2s;}
        .btn-orange{background:#f97316;color:white;width:100%;margin-top:8px;}
        .btn-orange:hover{background:#fb923c;}
        .btn-gray{background:#161d24;border:1px solid #243040;color:#94a3b8;font-size:11px;padding:5px 10px;border-radius:6px;}
        .btn-gray:hover{border-color:#f97316;color:#f97316;}
        .btn-green{background:#10b981;color:white;}
        .btn-red{background:transparent;border:1px solid rgba(244,63,94,.3);color:#f43f5e;font-size:11px;padding:4px 8px;border-radius:6px;}
        .err-msg{color:#f43f5e;font-size:11px;margin-top:6px;}

        /* COST ROWS */
        .cost-row{display:flex;gap:6px;margin-bottom:6px;align-items:center;}
        .cost-row input[type=text]{flex:2;}
        .cost-row input[type=number]{flex:1;}
        .cost-row .ccy{background:#161d24;border:1px solid #243040;color:#94a3b8;padding:8px 6px;border-radius:7px;font-size:11px;width:60px;}

        /* MARKETING */
        .mkt-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
        @media(max-width:500px){.mkt-grid{grid-template-columns:1fr;}}
        .mkt-item label{display:block;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;}

        /* PRODUCT COST TABLE */
        .pc-table{width:100%;font-size:11px;border-collapse:collapse;margin-top:8px;}
        .pc-table th{background:#161d24;padding:7px 10px;text-align:left;font-size:9px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #1e2a35;}
        .pc-table td{padding:7px 10px;border-bottom:1px solid #1e2a35;vertical-align:middle;}
        .pc-table tr:last-child td{border-bottom:none;}
        .pc-table input{padding:5px 7px;font-size:11px;}
        .match-ok{color:#10b981;font-size:10px;}
        .match-no{color:#f59e0b;font-size:10px;}

        /* SIDEBAR (right) */
        .sidebar{display:flex;flex-direction:column;gap:12px;}
        .side-card{background:#0f1419;border:1px solid #1e2a35;border-radius:11px;padding:14px;}
        .side-card h3{font-size:13px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:6px;}

        /* ROAS GAUGE */
        .roas-big{font-size:36px;font-weight:800;color:#a855f7;font-family:system-ui;letter-spacing:-1px;}
        .roas-label{font-size:11px;color:#94a3b8;margin-top:2px;}

        /* SAVE BTN */
        .save-bar{position:fixed;bottom:16px;right:16px;z-index:100;}
        .save-btn{background:#f97316;color:white;border:none;padding:12px 20px;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 4px 20px rgba(249,115,22,.4);}
        .save-btn:hover{background:#fb923c;}

        .spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:white;border-radius:50%;animation:spin .8s linear infinite;display:inline-block;margin-right:6px;vertical-align:middle;}
        @keyframes spin{to{transform:rotate(360deg)}}
        .tag{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:20px;font-size:10px;}
        .tag-green{background:rgba(16,185,129,.11);color:#10b981;border:1px solid rgba(16,185,129,.2);}
        .tag-yellow{background:rgba(245,158,11,.11);color:#f59e0b;border:1px solid rgba(245,158,11,.2);}
      `}</style>

      <div className="wrap">
        {/* HEADER */}
        <div className="ph">
          <div className="logo">GLAMX</div>
          <div>
            <h1>💹 Calculator Profit</h1>
            <p>Analiză completă venituri &amp; costuri</p>
          </div>
          <div className="month-sel">
            <label>Lună:</label>
            <input type="month" value={month} onChange={e => { setMonth(e.target.value); setShopifyDone(false); setSbDone(false); setGlsDone(false); }} />
          </div>
          <a href="/" className="back-btn">← Dashboard</a>
        </div>

        {/* TOP SUMMARY */}
        <div className="st">Sumar {monthLabel(month)}</div>
        <div className="summary-top">
          {[
            { e: '💰', v: fmtK(totalRevenue), lbl: 'Venituri totale', sub: `${totalOrders} comenzi livrate`, c: '#f97316' },
            { e: '📦', v: fmtK(cogs), lbl: 'Cost produse (COGS)', sub: cogs > 0 ? `${totalRevenue > 0 ? Math.round(cogs / totalRevenue * 100) : 0}% din venituri` : 'Necompletat', c: '#3b82f6' },
            { e: '🚚', v: fmtK(glsCost), lbl: 'Cost transport GLS', sub: glsRows.length > 0 ? `${glsRows.length} colete` : 'Neîncărcat', c: '#f59e0b' },
            { e: '📣', v: fmtK(totalMarketing), lbl: 'Cost marketing', sub: totalMarketing > 0 ? `ROAS: ${roasMarketing.toFixed(1)}x` : 'Necompletat', c: '#a855f7' },
            { e: '🔧', v: fmtK(totalFixed + totalOther), lbl: 'Costuri fixe', sub: `${fixedCosts.length + otherCosts.length} categorii`, c: '#64748b' },
            {
              e: netProfit >= 0 ? '📈' : '📉',
              v: `${netProfit >= 0 ? '+' : ''}${fmtK(netProfit)}`,
              lbl: 'Profit net',
              sub: `Marjă: ${margin.toFixed(1)}%`,
              c: netProfit >= 0 ? '#10b981' : '#f43f5e',
              neg: netProfit < 0
            },
          ].map((s, i) => (
            <div key={i} className="sum-card" style={{ '--c': s.c }}>
              <span className="sum-emoji">{s.e}</span>
              <div className={`sum-val ${s.neg ? 'neg' : ''}`}>{s.v} RON</div>
              <div className="sum-label">{s.lbl}</div>
              <div className="sum-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        <div className="main-grid">
          <div>
            {/* BREAKDOWN */}
            <div className="st">Detaliu P&amp;L</div>
            <div className="breakdown">
              <div className="brow">
                <span className="blbl">💰 Venituri brute</span>
                <span className="bval o">+{fmt(totalRevenue)} RON</span>
              </div>
              <div className="brow">
                <span className="blbl">📦 Cost produse (COGS)</span>
                <span className="bval r">-{fmt(cogs)} RON</span>
              </div>
              <div className="brow total">
                <span className="blbl">= Profit brut</span>
                <span className={`bval ${grossProfit >= 0 ? 'g' : 'r'}`}>{grossProfit >= 0 ? '+' : ''}{fmt(grossProfit)} RON <span style={{ fontSize: '10px', color: '#4a5568' }}>({totalRevenue > 0 ? Math.round(grossProfit / totalRevenue * 100) : 0}%)</span></span>
              </div>
              <div className="brow">
                <span className="blbl">🚚 Transport GLS</span>
                <span className="bval r">-{fmt(glsCost)} RON</span>
              </div>
              <div className="brow">
                <span className="blbl">📣 Marketing total</span>
                <span className="bval r">-{fmt(totalMarketing)} RON</span>
              </div>
              {fixedCosts.map(c => (
                <div key={c.id} className="brow">
                  <span className="blbl">🔧 {c.name || 'Cost fix'}</span>
                  <span className="bval r">-{fmt(parseFloat(c.amount) || 0)} RON</span>
                </div>
              ))}
              {otherCosts.map(c => (
                <div key={c.id} className="brow">
                  <span className="blbl">📌 {c.name || 'Alt cost'}</span>
                  <span className="bval r">-{fmt(parseFloat(c.amount) || 0)} RON</span>
                </div>
              ))}
              <div className="brow total">
                <span className="blbl">= Total costuri</span>
                <span className="bval r">-{fmt(totalCosts)} RON</span>
              </div>
              <div className={`brow total ${netProfit >= 0 ? 'profit-pos' : 'profit-neg'}`}>
                <span className="blbl" style={{ fontSize: '13px', fontWeight: 700 }}>{netProfit >= 0 ? '🚀' : '⚠️'} Profit net</span>
                <span className="bval" style={{ fontSize: '15px', fontWeight: 800, color: netProfit >= 0 ? '#10b981' : '#f43f5e' }}>
                  {netProfit >= 0 ? '+' : ''}{fmt(netProfit)} RON
                </span>
              </div>
            </div>

            {/* DATA SOURCES */}
            <div className="st">Surse de date</div>
            <div className="source-grid">

              {/* SHOPIFY */}
              <div className={`src-card ${shopifyDone ? 'done' : ''}`}>
                <div className="src-header">
                  <span className="src-icon">🛍️</span>
                  <span className="src-title">Shopify — Venituri</span>
                  <span className={`src-status ${shopifyDone ? 'ok' : ''}`}>{shopifyDone ? `✓ ${deliveredOrders.length} comenzi` : 'Neconectat'}</span>
                </div>
                {shopifyDone ? (
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    Venituri: <strong style={{ color: '#f97316' }}>{fmt(totalRevenue)} RON</strong><br />
                    Comenzi livrate+încasate: {totalOrders}
                  </div>
                ) : (
                  <button className={`btn btn-orange`} onClick={fetchShopify} disabled={shopifyLoading}>
                    {shopifyLoading && <span className="spinner"></span>}
                    {shopifyLoading ? 'Se încarcă…' : '⟳ Încarcă comenzile lunii'}
                  </button>
                )}
                {shopifyDone && <button className="btn btn-gray" style={{ marginTop: 8, width: '100%' }} onClick={() => setShopifyDone(false)}>↺ Reîncarcă</button>}
              </div>

              {/* COST PRODUSE - din Shopify cost_per_item */}
              <div className={`src-card ${shopifyCostsDone ? 'done' : ''}`}>
                <div className="src-header">
                  <span className="src-icon">🏷️</span>
                  <span className="src-title">Cost produse (Shopify)</span>
                  <span className={`src-status ${shopifyCostsDone ? 'ok' : ''}`}>
                    {shopifyCostsDone ? `✓ ${Object.keys(shopifyCosts).length} produse` : 'Se încarcă automat'}
                  </span>
                </div>
                {shopifyCostsDone && Object.keys(shopifyCosts).length > 0 ? (
                  <div style={{fontSize:12,color:'#94a3b8'}}>
                    <div>Produse cu cost: <strong style={{color:'#10b981'}}>{Object.keys(shopifyCosts).length}</strong></div>
                    <div style={{marginTop:4}}>COGS calculat: <strong style={{color:'#3b82f6'}}>{fmt(cogs)} RON</strong></div>
                    <div style={{marginTop:8,fontSize:11,color:'#4a5568'}}>
                      Costul se ia automat din <em>Shopify → Products → Cost per item</em>
                    </div>
                  </div>
                ) : (
                  <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.6}}>
                    <div style={{marginBottom:8}}>
                      {shopifyDone
                        ? '⚠ Nu s-au găsit costuri în Shopify. Completează câmpul Cost per item:'
                        : 'Costurile se vor încărca automat după ce încarci comenzile Shopify.'}
                    </div>
                    <div style={{padding:'8px 10px',background:'rgba(59,130,246,.08)',border:'1px solid rgba(59,130,246,.2)',borderRadius:7,fontSize:11,color:'#3b82f6'}}>
                      📍 Shopify Admin → Products → click produs → tab <strong>Inventory</strong> → câmp <strong>Cost per item</strong>
                    </div>
                  </div>
                )}
                {/* Manual cost override per product */}
                {shopifyDone && Object.keys(shopifyCosts).length === 0 && (
                  <div style={{marginTop:10,fontSize:11,color:'#94a3b8'}}>
                    Sau introdu costul manual în tabelul de mai jos ↓
                  </div>
                )}
              </div>

              {/* GLS */}
              <div className={`src-card ${glsDone ? 'done' : ''}`}>
                <div className="src-header">
                  <span className="src-icon">🚚</span>
                  <span className="src-title">GLS — Cost transport</span>
                  <span className={`src-status ${glsDone ? 'ok' : ''}`}>{glsDone ? `✓ ${fmt(glsCost)} RON` : 'Neîncărcat'}</span>
                </div>
                <label className="lbl">Excel lunar GLS (.csv sau .xlsx)</label>
                <input type="file" accept=".csv,.xlsx,.xls" onChange={parseGLSExcel} />
                {glsDone && (
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                    {glsRows.length} colete · Total: <strong style={{ color: '#f59e0b' }}>{fmt(glsCost)} RON</strong>
                  </div>
                )}
                {!glsDone && (
                  <>
                    <label className="lbl">Sau introdu manual (RON)</label>
                    <input type="text" inputMode="decimal" placeholder="Ex: 2043.40" value={glsManual} onChange={e => setGlsManual(e.target.value)} onBlur={e => { const v = parseFloat(e.target.value.replace(',','.')); if (!isNaN(v) && v > 0) { setGlsCost(v); setGlsDone(true); }}} />
                  </>
                )}
              </div>

              {/* MARKETING */}
              <div className="src-card">
                <div className="src-header">
                  <span className="src-icon">📣</span>
                  <span className="src-title">Marketing</span>
                  <span className="src-status">{totalMarketing > 0 ? `✓ ${fmt(totalMarketing)} RON` : 'Necompletat'}</span>
                </div>
                <div className="mkt-grid">
                  <div className="mkt-item">
                    <label>Meta Ads (RON)</label>
                    <input type="number" placeholder="0" value={metaCost} onChange={e => setMetaCost(e.target.value)} />
                  </div>
                  <div className="mkt-item">
                    <label>TikTok Ads (RON)</label>
                    <input type="number" placeholder="0" value={tikTokCost} onChange={e => setTikTokCost(e.target.value)} />
                  </div>
                  <div className="mkt-item">
                    <label>Google Ads (RON)</label>
                    <input type="number" placeholder="0" value={googleCost} onChange={e => setGoogleCost(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* FIXED COSTS */}
            <div className="st">Costuri fixe lunare</div>
            <div className="src-card" style={{ marginBottom: 12 }}>
              {fixedCosts.map(c => (
                <div key={c.id} className="cost-row">
                  <input type="text" placeholder="Nume cost (ex: Shopify)" value={c.name} onChange={e => updateFixed(c.id, 'name', e.target.value)} style={{ flex: 2 }} />
                  <input type="number" placeholder="Sumă RON" value={c.amount} onChange={e => updateFixed(c.id, 'amount', e.target.value)} style={{ flex: 1 }} />
                  <button className="btn btn-red" onClick={() => removeFixed(c.id)}>✕</button>
                </div>
              ))}
              <button className="btn btn-gray" onClick={addFixed}>+ Adaugă cost fix</button>
            </div>

            {/* OTHER COSTS */}
            <div className="st">Alte costuri variabile</div>
            <div className="src-card" style={{ marginBottom: 12 }}>
              {otherCosts.length === 0 && <div style={{ fontSize: 12, color: '#4a5568', marginBottom: 8 }}>Nu ai adăugat costuri variabile.</div>}
              {otherCosts.map(c => (
                <div key={c.id} className="cost-row">
                  <input type="text" placeholder="Nume cost" value={c.name} onChange={e => updateOther(c.id, 'name', e.target.value)} style={{ flex: 2 }} />
                  <input type="number" placeholder="Sumă RON" value={c.amount} onChange={e => updateOther(c.id, 'amount', e.target.value)} style={{ flex: 1 }} />
                  <button className="btn btn-red" onClick={() => removeOther(c.id)}>✕</button>
                </div>
              ))}
              <button className="btn btn-gray" onClick={addOther}>+ Adaugă cost variabil</button>
            </div>

            {/* STANDARD COSTS EDITOR */}
            <div className="st" style={{marginTop:16}}>Costuri standard produse</div>
            <div className="src-card" style={{marginBottom:14}}>
              <p style={{fontSize:12,color:'#94a3b8',marginBottom:12,lineHeight:1.5}}>
                Se aplică automat prin potrivire de nume. Editează și apasă <strong>Salvează setările</strong>.
              </p>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr>
                  <th style={{textAlign:'left',padding:'6px 8px',background:'#161d24',color:'#94a3b8',fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1e2a35'}}>Produs</th>
                  <th style={{textAlign:'center',padding:'6px 8px',background:'#161d24',color:'#94a3b8',fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1e2a35',width:100}}>Cost RON</th>
                  <th style={{width:40,background:'#161d24',borderBottom:'1px solid #1e2a35'}}></th>
                </tr></thead>
                <tbody>
                  {stdCosts.map((s,i) => (
                    <tr key={s.id} style={{borderBottom:'1px solid #1e2a35'}}>
                      <td style={{padding:'7px 8px',color:'#94a3b8',fontSize:12}}>{s.name}</td>
                      <td style={{padding:'7px 8px',textAlign:'center'}}>
                        <input type="text" inputMode="decimal" value={s.cost}
                          onChange={e => setStdCosts(p => p.map((x,j) => j===i ? {...x, cost: e.target.value} : x))}
                          onBlur={e => { const v=parseFloat(String(e.target.value).replace(',','.')); if(!isNaN(v)) setStdCosts(p => p.map((x,j) => j===i ? {...x,cost:v} : x)); }}
                          style={{background:'#161d24',border:'1px solid #243040',color:'#10b981',borderRadius:6,padding:'4px 8px',fontSize:12,width:80,fontFamily:'monospace',textAlign:'center',outline:'none'}} />
                      </td>
                      <td style={{padding:'4px'}}>
                        <button onClick={() => setStdCosts(p => p.filter((_,j) => j!==i))}
                          style={{background:'transparent',border:'1px solid rgba(244,63,94,.3)',color:'#f43f5e',borderRadius:5,padding:'2px 6px',fontSize:11,cursor:'pointer'}}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => setStdCosts(p => [...p, {id:'new_'+Date.now(),pattern:'',excludes:[],name:'Produs nou',cost:0}])}
                style={{marginTop:8,background:'transparent',border:'1px solid #243040',color:'#94a3b8',borderRadius:8,padding:'6px 14px',fontSize:12,cursor:'pointer',width:'100%'}}>
                + Adaugă produs
              </button>
            </div>

            {/* PRODUCT COST MAPPING */}
            {uniqueProducts.length > 0 && (
              <>
                <div className="st">Cost produse per SKU</div>
                <div className="src-card">
                  <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
                    {sbDone ? 'Costurile au fost detectate automat din SmartBill. Poți corecta manual mai jos.' : 'SmartBill nu e conectat. Introdu costul per produs manual.'}
                  </p>
                  <table className="pc-table">
                    <thead><tr><th>Produs</th><th>Cost unitar (RON)</th><th>Sursă</th></tr></thead>
                    <tbody>
                      {uniqueProducts.slice(0, 30).map(prod => {
                        const key = prod.toLowerCase().trim();
                        const sbVal  = productCosts[key];
                        const shVal  = shopifyCosts[key];
                        const manualVal = manualCosts[prod];
                        const override  = costSource[prod];
                        const { cost: resolvedCost, src: autoSrc } = resolveCost({ name: prod, sku: '', variantId: '' });

                        // Find matching stdCost for display
                        const matchedStd = stdCosts.find(s => {
                          const pat = s.pattern.toLowerCase();
                          if (!pat) return false;
                          if (!key.includes(pat)) return false;
                          return !(s.excludes||[]).some(ex => key.includes(ex.toLowerCase()));
                        });
                        const stdVal = matchedStd ? matchedStd.cost : null;

                        const srcOptions = [
                          sbVal  ? { id:'smartbill', lbl:`SB: ${sbVal} RON`,   color:'#10b981' } : null,
                          shVal  ? { id:'shopify',   lbl:`SH: ${shVal} RON`,   color:'#3b82f6' } : null,
                          stdVal ? { id:'standard',  lbl:`STD: ${stdVal} RON`, color:'#a855f7' } : null,
                          { id:'manual', lbl:'Manual', color:'#f59e0b' },
                        ].filter(Boolean);

                        const showManualInput = override === 'manual' || (!override && !sbVal && !shVal && !stdVal);

                        return (
                          <tr key={prod}>
                            <td style={{maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#94a3b8',fontSize:11}} title={prod}>{prod}</td>
                            <td>
                              <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                                {srcOptions.map(opt => (
                                  <button key={opt.id} onClick={() => setCostSource(p => ({...p, [prod]: opt.id}))}
                                    style={{padding:'2px 6px',borderRadius:4,border:'1px solid',fontSize:9,cursor:'pointer',
                                      background:(override||autoSrc)===opt.id?opt.color:'#161d24',
                                      borderColor:(override||autoSrc)===opt.id?opt.color:'#243040',
                                      color:(override||autoSrc)===opt.id?'white':'#94a3b8'}}>
                                    {opt.lbl}
                                  </button>
                                ))}
                              </div>
                            </td>
                            <td>
                              {showManualInput ? (
                                <input type="text" inputMode="decimal" placeholder="0"
                                  value={manualVal||''}
                                  onChange={e => setManualCosts(p => ({...p,[prod]:e.target.value}))}
                                  style={{width:80,padding:'4px 6px',fontSize:11,background:'#161d24',border:'1px solid #243040',color:'#e8edf2',borderRadius:6,outline:'none'}} />
                              ) : (
                                <span style={{fontFamily:'monospace',fontSize:12,color:'#10b981',fontWeight:600}}>{resolvedCost} RON</span>
                              )}
                            </td>
                            <td>
                              {resolvedCost > 0
                                ? <span style={{fontSize:10,color:'#10b981'}}>✓ OK</span>
                                : <span style={{fontSize:10,color:'#f59e0b'}}>⚠ Lipsă</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* SIDEBAR */}
          <div className="sidebar">
            {/* ROAS */}
            <div className="side-card">
              <h3>📣 ROAS Marketing</h3>
              <div className="roas-big">{roasMarketing.toFixed(2)}x</div>
              <div className="roas-label">Return on Ad Spend</div>
              <div style={{ marginTop: 12, fontSize: 12 }}>
                {[
                  { lbl: 'Cheltuieli marketing', val: fmt(totalMarketing) + ' RON', c: '#f43f5e' },
                  { lbl: 'Venituri generate', val: fmt(totalRevenue) + ' RON', c: '#10b981' },
                  { lbl: 'Cost/comandă', val: totalOrders > 0 ? fmt(totalMarketing / totalOrders) + ' RON' : '—', c: '#f59e0b' },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e2a35', color: '#94a3b8' }}>
                    <span>{r.lbl}</span>
                    <span style={{ color: r.c, fontFamily: 'monospace' }}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* MARGINS */}
            <div className="side-card">
              <h3>📊 Marje</h3>
              {[
                { lbl: 'Marjă brută', val: totalRevenue > 0 ? Math.round(grossProfit / totalRevenue * 100) : 0, color: '#3b82f6' },
                { lbl: 'Marjă netă', val: Math.round(margin), color: margin >= 0 ? '#10b981' : '#f43f5e' },
                { lbl: 'Cost/venituri', val: totalRevenue > 0 ? Math.round(totalCosts / totalRevenue * 100) : 0, color: '#f43f5e' },
              ].map((m, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: '#94a3b8' }}>{m.lbl}</span>
                    <span style={{ color: m.color, fontFamily: 'monospace', fontWeight: 700 }}>{m.val}%</span>
                  </div>
                  <div className="bar-wrap">
                    <div className="bar-fill" style={{ width: Math.min(100, Math.abs(m.val)) + '%', background: m.color }}></div>
                  </div>
                </div>
              ))}
            </div>

            {/* PER ORDER */}
            <div className="side-card">
              <h3>🧮 Per comandă</h3>
              {totalOrders > 0 ? [
                { lbl: 'Venit mediu', val: fmt(totalRevenue / totalOrders) + ' RON', c: '#f97316' },
                { lbl: 'Cost produse', val: fmt(cogs / totalOrders) + ' RON', c: '#3b82f6' },
                { lbl: 'Cost transport', val: fmt(glsCost / totalOrders) + ' RON', c: '#f59e0b' },
                { lbl: 'Cost marketing', val: fmt(totalMarketing / totalOrders) + ' RON', c: '#a855f7' },
                { lbl: 'Profit net', val: fmt(netProfit / totalOrders) + ' RON', c: netProfit >= 0 ? '#10b981' : '#f43f5e' },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e2a35', fontSize: 12 }}>
                  <span style={{ color: '#94a3b8' }}>{r.lbl}</span>
                  <span style={{ color: r.c, fontFamily: 'monospace', fontWeight: 500 }}>{r.val}</span>
                </div>
              )) : <div style={{ fontSize: 12, color: '#4a5568' }}>Încarcă comenzile Shopify mai întâi.</div>}
            </div>

            {/* COST BREAKDOWN PIE-like */}
            <div className="side-card">
              <h3>🥧 Structură costuri</h3>
              {totalCosts > 0 ? [
                { lbl: 'Produse (COGS)', val: cogs, c: '#3b82f6' },
                { lbl: 'Transport', val: glsCost, c: '#f59e0b' },
                { lbl: 'Marketing', val: totalMarketing, c: '#a855f7' },
                { lbl: 'Fixe + Alte', val: totalFixed + totalOther, c: '#64748b' },
              ].map((r, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: '#94a3b8' }}>{r.lbl}</span>
                    <span style={{ color: r.c, fontFamily: 'monospace' }}>{totalCosts > 0 ? Math.round(r.val / totalCosts * 100) : 0}%</span>
                  </div>
                  <div className="bar-wrap">
                    <div className="bar-fill" style={{ width: totalCosts > 0 ? Math.min(100, r.val / totalCosts * 100) + '%' : '0%', background: r.c }}></div>
                  </div>
                </div>
              )) : <div style={{ fontSize: 12, color: '#4a5568' }}>Adaugă costuri pentru a vedea structura.</div>}
            </div>
          </div>
        </div>
      </div>

      {/* SAVE BUTTON */}
      <div className="save-bar">
        <button className="save-btn" onClick={saveSettings}>💾 Salvează setările</button>
      </div>
    </>
  );
}  

