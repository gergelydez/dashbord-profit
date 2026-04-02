import { NextResponse } from 'next/server';

const BASE = 'https://ws.smartbill.ro/SBORO/api';

function makeAuth(email, token) {
  return Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
}

// ── Serii disponibile + gestiuni ──────────────────────────────────────────────
async function getSeriesAndWarehouses(auth, cif) {
  const [sRes, wRes] = await Promise.all([
    fetch(`${BASE}/series?cif=${cif}&type=f`, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      cache: 'no-store',
    }),
    fetch(`${BASE}/warehouse/list?cif=${cif}`, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      cache: 'no-store',
    }),
  ]);

  const sData = sRes.ok ? await sRes.json() : {};
  const wData = wRes.ok ? await wRes.json() : {};

  return {
    series: (sData.list || sData.invoiceSeries || []).map(s => s.name || s),
    warehouses: (wData.list || wData.warehouses || []).map(w => w.name || w),
  };
}

// ── Încasare factură prin /payment (endpoint corect din documentație) ──────────
// Structura corectă: POST /payment cu invoicesList pentru a lega chitanța de factură
async function collectInvoice(auth, cif, invoiceSeries, invoiceNumber, value, clientName, paymentSeries) {
  const issueDate = new Date().toISOString().slice(0, 10);

  const body = {
    companyVatCode: cif,
    client: {
      name: (clientName || 'Client').slice(0, 100),
      vatCode: '',
      isTaxPayer: false,
      address: '',
      city: '',
      county: '',
      country: 'Romania',
      saveToDb: false,
    },
    issueDate,
    currency: 'RON',
    precision: 2,
    value: Math.round(parseFloat(value) * 100) / 100,
    isDraft: false,
    // Chitanță pentru plată ramburs / numerar; folosim "Alta incasare" dacă e online
    type: 'Chitanta',
    isCash: true,
    useInvoiceDetails: false,
    // Legăm chitanța de factură prin invoicesList
    invoicesList: [
      {
        seriesName: invoiceSeries,
        number: String(invoiceNumber),
      },
    ],
  };

  // Dacă avem serie de chitanță configurată, o folosim
  if (paymentSeries) {
    body.seriesName = paymentSeries;
  }

  try {
    const res = await fetch(`${BASE}/payment`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw: raw.slice(0, 200) }; }

    if (!res.ok) {
      const errMsg = data.errorText || data.message || data.error || JSON.stringify(data).slice(0, 200);
      console.error('[SmartBill] Eroare încasare:', res.status, errMsg);
      return { ok: false, error: errMsg };
    }

    return { ok: true, series: data.series, number: data.number };
  } catch (e) {
    console.error('[SmartBill] Exception încasare:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Notare în Shopify cu url factură ─────────────────────────────────────────
async function markInvoiceInShopify({ shopifyDomain, shopifyToken, orderId, invoiceSeries, invoiceNumber, invoiceUrl }) {
  if (!shopifyDomain || !shopifyToken || !orderId) return { ok: false };
  try {
    const getRes = await fetch(
      `https://${shopifyDomain}/admin/api/2024-01/orders/${orderId}.json?fields=note_attributes,tags`,
      { headers: { 'X-Shopify-Access-Token': shopifyToken }, cache: 'no-store' }
    );
    if (!getRes.ok) return { ok: false };
    const orderData = await getRes.json();

    const existingAttrs = (orderData.order?.note_attributes || []).filter(a => {
      const n = (a.name || '').toLowerCase();
      return !['xconnector-invoice-url', 'invoice-short-url', 'invoice-number', 'invoice-series'].includes(n);
    });
    existingAttrs.push(
      { name: 'xconnector-invoice-url', value: invoiceUrl },
      { name: 'invoice-short-url',      value: invoiceUrl },
      { name: 'invoice-number',         value: String(invoiceNumber) },
      { name: 'invoice-series',         value: invoiceSeries },
    );

    const tags = (orderData.order?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    if (!tags.includes('invoiced')) tags.push('invoiced');

    const updateRes = await fetch(
      `https://${shopifyDomain}/admin/api/2024-01/orders/${orderId}.json`,
      {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: { id: orderId, note_attributes: existingAttrs, tags: tags.join(', ') } }),
        cache: 'no-store',
      }
    );
    return { ok: updateRes.ok };
  } catch { return { ok: false }; }
}

// ── POST — Generare factură ───────────────────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      email, token, cif,
      seriesName,       // serie factură (ex: "GLA")
      paymentSeries,    // serie chitanță (ex: "FSZ") — opțional
      order,
      shopifyDomain,
      shopifyToken,
    } = body;

    if (!email || !token || !cif || !order) {
      return NextResponse.json({ error: 'Date lipsă: email, token, cif sau order.' }, { status: 400 });
    }

    const auth = makeAuth(email, token);
    const issueDate = new Date().toISOString().slice(0, 10);

    // Serie factură — din request sau prima disponibilă
    let series = seriesName;
    if (!series) {
      const { series: seriesList } = await getSeriesAndWarehouses(auth, cif);
      series = seriesList[0] || null;
    }
    if (!series) {
      return NextResponse.json({ error: 'Completează câmpul "Serie" înainte de generare.' }, { status: 400 });
    }

    const useStock  = order.useStock === true && !!order.warehouseName;
    const warehouse = useStock ? order.warehouseName : null;

    // ── Construiește produsele ────────────────────────────────────────────────
    // Cu gestiune: warehouseName se pune LA NIVEL DE PRODUS (nu la invoice)
    // isTaxIncluded: true => prețul din Shopify include deja TVA
    const buildProduct = (item) => {
      const qty   = Math.max(1, parseInt(item.qty) || 1);
      const price = parseFloat(item.price) || 0;
      const sku   = (item.sku || '').trim();

      return {
        name:               (item.name || 'Produs').slice(0, 255),
        code:               sku || '',
        isDiscount:         false,
        measuringUnitName:  'buc',
        currency:           order.currency || 'RON',
        quantity:           qty,
        price,
        isTaxIncluded:      true,
        taxName:            'Normala',
        taxPercentage:      19,
        isService:          false,
        saveToDb:           false,
        // warehouseName la nivel de produs — corect conform documentației
        ...(useStock && warehouse ? { warehouseName: warehouse } : {}),
      };
    };

    let products = (order.items || [])
      .filter(i => parseFloat(i.price) > 0)
      .map(buildProduct);

    // Fallback dacă nu avem produse individuale
    if (!products.length) {
      products = [{
        name:              `Comanda Shopify ${order.name}`,
        code:              '',
        isDiscount:        false,
        measuringUnitName: 'buc',
        currency:          order.currency || 'RON',
        quantity:          1,
        price:             parseFloat(order.total) || 0,
        isTaxIncluded:     true,
        taxName:           'Normala',
        taxPercentage:     19,
        isService:         false,
        saveToDb:          false,
        ...(useStock && warehouse ? { warehouseName: warehouse } : {}),
      }];
    }

    // ── Body factură ─────────────────────────────────────────────────────────
    const invoiceBody = {
      companyVatCode: cif,
      client: {
        name:       (order.client || 'Client').slice(0, 100),
        vatCode:    '',
        address:    (order.address || '').slice(0, 255),
        isTaxPayer: false,
        city:       order.city    || '',
        county:     order.county  || '',
        country:    'Romania',
        email:      order.clientEmail || '',
        saveToDb:   false,
      },
      issueDate,
      seriesName: series,
      isDraft:    false,
      currency:   order.currency || 'RON',
      language:   'RO',
      precision:  2,
      // useStock la nivel de invoice — activează descărcarea gestiunii
      useStock,
      observations: `Comanda Shopify ${order.name}`,
      mentions:     '',
      products,
    };

    // ── Trimite factura ──────────────────────────────────────────────────────
    const invRes = await fetch(`${BASE}/invoice`, {
      method: 'POST',
      headers: {
        'Authorization':  `Basic ${auth}`,
        'Content-Type':   'application/json',
        'Accept':         'application/json',
      },
      body: JSON.stringify(invoiceBody),
      cache: 'no-store',
    });

    const invRaw = await invRes.text();
    let invData;
    try { invData = JSON.parse(invRaw); }
    catch {
      // HTML în răspuns = endpoint greșit sau credențiale incorecte
      return NextResponse.json({
        error: `SmartBill ${invRes.status}: răspuns invalid (HTML). Verifică email/token/CIF.`,
        _raw: invRaw.slice(0, 200),
      }, { status: invRes.status || 500 });
    }

    if (!invRes.ok) {
      const errMsg = invData.errorText || invData.message || invData.error
        || JSON.stringify(invData).slice(0, 300);
      return NextResponse.json({
        error: `SmartBill ${invRes.status}: ${errMsg}`,
        _debug: { useStock, warehouse, products: products.map(p => ({ code: p.code, name: p.name.slice(0, 30), warehouseName: p.warehouseName })) },
      }, { status: invRes.status });
    }

    const invoiceSeries = invData.series;
    const invoiceNumber = invData.number;
    const invoiceUrl    = invData.url || invData.documentUrl ||
      `https://cloud.smartbill.ro/core/factura/vizualizeaza/?cif=${encodeURIComponent(cif)}&series=${encodeURIComponent(invoiceSeries)}&number=${encodeURIComponent(invoiceNumber)}`;

    // ── Încasare automată ────────────────────────────────────────────────────
    // Doar dacă comanda e plătită (Shopify Payments / ramburs încasat)
    let collected     = false;
    let collectError  = null;
    if (order.isPaid && parseFloat(order.total) > 0) {
      const collectResult = await collectInvoice(
        auth, cif,
        invoiceSeries, invoiceNumber,
        order.total,
        order.client,
        paymentSeries || order.paymentSeries || null,
      );
      collected    = collectResult.ok;
      collectError = collectResult.error || null;
    }

    // ── Notare în Shopify ────────────────────────────────────────────────────
    let shopifyMarked = false;
    if (shopifyDomain && shopifyToken && order.id) {
      const r = await markInvoiceInShopify({
        shopifyDomain, shopifyToken,
        orderId: order.id,
        invoiceSeries, invoiceNumber, invoiceUrl,
      });
      shopifyMarked = r.ok;
    }

    return NextResponse.json({
      ok:            true,
      series:        invoiceSeries,
      number:        invoiceNumber,
      invoiceUrl,
      collected,
      collectError,
      shopifyMarked,
      stockDecreased: useStock,
    });

  } catch (e) {
    console.error('[SmartBill Invoice]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── GET — Serii + gestiuni disponibile ───────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const token = searchParams.get('token');
  const cif   = searchParams.get('cif');

  if (!email || !token || !cif) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  const auth = makeAuth(email, token);
  try {
    const result = await getSeriesAndWarehouses(auth, cif);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

