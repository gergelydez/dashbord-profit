'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';

const ls = {
  get: (k) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
};

function getShopKey() {
  try {
    const s = typeof window !== 'undefined' ? localStorage.getItem('glamx-shop') : null;
    const p = s ? JSON.parse(s) : null;
    return p?.state?.currentShop || 'ro';
  } catch { return 'ro'; }
}
const ordersKey = (sk) => sk === 'ro' ? 'gx_orders_all' : `gx_orders_all_${sk}`;

function getLocalOverrides() {
  try { const s = localStorage.getItem('gx_track_ov'); return s ? JSON.parse(s) : {}; } catch { return {}; }
}

function applyOverrides(orders) {
  const ov = getLocalOverrides();
  const now = new Date();
  return orders.map(o => {
    if (['incurs','outfor'].includes(o.ts) && o.createdAt) {
      const daysSince = (now - new Date(o.createdAt)) / (1000 * 60 * 60 * 24);
      if (daysSince > 30) return { ...o, ts: 'anulat' };
    }
    if (o.fin === 'voided' || o.fin === 'refunded') return { ...o, ts: 'anulat' };
    const override = ov[o.id];
    if (!override) return o;
    return { ...o, ts: override.ts };
  });
}

function getFinalStatus(o, sdAwbMap) {
  if (o.courier === 'sameday') {
    const awb = (o.trackingNo || '').trim();
    const sdSt = awb && sdAwbMap[awb] ? sdAwbMap[awb] : null;
    return sdSt || o.ts;
  }
  return o.ts;
}

const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fmt = n => Number(n||0).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtInt = n => Number(n||0).toLocaleString('ro-RO');
const fmtNum = n => Number(n||0).toFixed(2);

const ONLINE_GW = ['shopify_payments','stripe','paypal'];
const isOnlinePayment = (o, onlineIds=[]) => {
  if (onlineIds.includes(String(o.id))) return true;
  const gw = (o.gateway||'').toLowerCase();
  return ONLINE_GW.some(g => gw.includes(g));
};

const now = new Date();
const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();

const PRESETS = [
  { id: 'today',      label: 'Azi',           from: () => { const d=new Date(); return [toISO(d), toISO(d)]; }},
  { id: 'yesterday',  label: 'Ieri',          from: () => { const d=new Date(y,m,now.getDate()-1); return [toISO(d),toISO(d)]; }},
  { id: 'week',       label: '7 zile',        from: () => [toISO(new Date(y,m,d-6)), toISO(now)]},
  { id: 'month',      label: 'Luna aceasta',  from: () => [`${y}-${pad(m+1)}-01`, toISO(now)]},
  { id: 'last_month', label: 'Luna trecuta',  from: () => { const lm=new Date(y,m,0); return [`${lm.getFullYear()}-${pad(lm.getMonth()+1)}-01`, toISO(lm)]; }},
  { id: 'last_30',    label: '30 zile',       from: () => [toISO(new Date(y,m,d-29)), toISO(now)]},
  { id: 'last_90',    label: '90 zile',       from: () => [toISO(new Date(y,m,d-89)), toISO(now)]},
  { id: 'year',       label: 'Anul acesta',   from: () => [`${y}-01-01`, toISO(now)]},
];

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT EXCEL
// ─────────────────────────────────────────────────────────────────────────────
async function exportExcel({ incasariList, allOrders, onlineIds, sdAwbMap, shopifyFeePercent, shopifyFeeFixed, from, to }) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const fromD = new Date(from + 'T00:00:00');
  const toD   = new Date(to   + 'T23:59:59');

  const addWorkDays = (str, n) => {
    if (!str) return '';
    const d = new Date(str + 'T12:00:00'); let added = 0;
    while (added < n) { d.setDate(d.getDate() + 1); const day = d.getDay(); if (day !== 0 && day !== 6) added++; }
    const p = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  // ── Sheet 1 – Rezumat pe zile ──────────────────────────────────────────────
  const hdr1 = ['Data Incasare', 'Nr. Comenzi', 'GLS Ramburs (RON)', 'Sameday Ramburs (RON)',
    'Card Brut (RON)', 'Comision Shopify (RON)', 'Card Net (RON)', 'TOTAL INCASAT (RON)'];
  const rows1 = [hdr1];
  let tGLS=0,tSD=0,tSPBrut=0,tSPCom=0,tSPNet=0,tTot=0,tCnt=0;
  (incasariList||[]).forEach(([zi,v]) => {
    const sBrut=v.shopifyBrut||0, sCom=v.shopifyComision||0, sNet=v.shopify||0;
    rows1.push([zi.split('-').reverse().join('.'), v.count,
      +fmtNum(v.gls), +fmtNum(v.sameday), +fmtNum(sBrut), +fmtNum(sCom), +fmtNum(sNet), +fmtNum(v.total)]);
    tGLS+=v.gls; tSD+=v.sameday; tSPBrut+=sBrut; tSPCom+=sCom; tSPNet+=sNet; tTot+=v.total; tCnt+=v.count;
  });
  rows1.push(['TOTAL', tCnt, +fmtNum(tGLS), +fmtNum(tSD), +fmtNum(tSPBrut), +fmtNum(tSPCom), +fmtNum(tSPNet), +fmtNum(tTot)]);
  const ws1 = XLSX.utils.aoa_to_sheet(rows1);
  ws1['!cols'] = [18,14,22,24,20,24,20,22].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws1, 'Rezumat pe zile');

  // ── Sheet 2 – DETALIU PE ZILE (principalul pentru contabilă) ─────────────
  // Reconstituim ziua de încasare pentru fiecare comandă livrată
  const detailRows = [];
  const hdr5 = [
    'Data Incasare','Sursa Incasare',
    'Nr. Comanda','Nr. Factura',
    'Client','Adresa','Oras',
    'Valoare Factura (RON)',
    'Valoare Bruta (RON)','Comision Shopify (RON)','NET Incasat (RON)',
    'AWB','Courier'
  ];
  detailRows.push(hdr5);

  // Construim un map: ziIncasare -> lista comenzi
  const byDay = {};

  // GLS & Sameday livrate (COD – ramburs)
  allOrders.forEach(o => {
    if (isOnlinePayment(o, onlineIds)) return;
    if (getFinalStatus(o, sdAwbMap) !== 'livrat') return;
    const livStr = (o.fulfilledAt || o.createdAt || '').slice(0, 10);
    if (!livStr) return;
    const courier = o.courier === 'sameday' ? 'sameday' : 'gls';
    const zile = courier === 'sameday' ? 1 : 2;
    const ziIncasare = addWorkDays(livStr, zile);
    if (!byDay[ziIncasare]) byDay[ziIncasare] = [];
    byDay[ziIncasare].push({ ...o, _ziIncasare: ziIncasare, _tip: courier === 'sameday' ? 'Sameday Ramburs' : 'GLS Ramburs' });
  });

  // Shopify/Card (online)
  allOrders.forEach(o => {
    if (!isOnlinePayment(o, onlineIds)) return;
    const base = (o.createdAt || '').slice(0, 10);
    if (!base) return;
    const ziIncasare = addWorkDays(base, 2);
    if (!byDay[ziIncasare]) byDay[ziIncasare] = [];
    byDay[ziIncasare].push({ ...o, _ziIncasare: ziIncasare, _tip: 'Shopify/Card' });
  });

  // Sortăm zilele descrescător
  const zileSort = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

  let grandTotalGLS = 0, grandTotalSD = 0, grandTotalBrut = 0, grandTotalCom = 0, grandTotalNet = 0, grandTotal = 0;

  zileSort.forEach(zi => {
    const comenzi = byDay[zi];
    const ziLabel = zi.split('-').reverse().join('.');

    // Separăm pe tipuri pentru subtotaluri
    const glsCom   = comenzi.filter(o => o._tip === 'GLS Ramburs');
    const sdCom    = comenzi.filter(o => o._tip === 'Sameday Ramburs');
    const spCom    = comenzi.filter(o => o._tip === 'Shopify/Card');

    let dayGLS=0, daySD=0, dayBrut=0, dayCom=0, dayNet=0, dayTotal=0;

    // Rând separator zi
    detailRows.push([`📅 ${ziLabel}`, '', '', '', '', '', '', '', '', '', '', '', '']);

    // Helper câmpuri reale
    const getF = o => ({
      client:  o.client  || o.customerName || (o.shipping_address && o.shipping_address.name)  || '',
      oras:    o.oras    || o.city         || (o.shipping_address && o.shipping_address.city)   || '',
      adr:     o.address || [o.address1 || (o.shipping_address && o.shipping_address.address1) || '',
                              o.address2 || (o.shipping_address && o.shipping_address.address2) || ''].filter(Boolean).join(', '),
      invoice: o.invoiceNumber || o.invoiceNo || o.invoice || o.invoiceShort || '',
    });

    // GLS
    if (glsCom.length > 0) {
      detailRows.push(['', '── GLS Ramburs ──', '', '', '', '', '', '', '', '', '', '', '']);
      glsCom.forEach(o => {
        const f = getF(o);
        const val = +(fmtNum(o.total));
        detailRows.push([
          ziLabel, 'GLS Ramburs',
          o.name||o.orderNumber||o.id||'', f.invoice,
          f.client, f.adr, f.oras,
          val, val, 0, val,
          o.trackingNo||'', 'GLS'
        ]);
        dayGLS += val; dayTotal += val;
      });
      grandTotalGLS += dayGLS;
    }

    // Sameday
    if (sdCom.length > 0) {
      detailRows.push(['', '── Sameday Ramburs ──', '', '', '', '', '', '', '', '', '', '', '']);
      sdCom.forEach(o => {
        const f = getF(o);
        const val = +(fmtNum(o.total));
        detailRows.push([
          ziLabel, 'Sameday Ramburs',
          o.name||o.orderNumber||o.id||'', f.invoice,
          f.client, f.adr, f.oras,
          val, val, 0, val,
          o.trackingNo||'', 'Sameday'
        ]);
        daySD += val; dayTotal += val;
      });
      grandTotalSD += daySD;
    }

    // Shopify/Card
    if (spCom.length > 0) {
      detailRows.push(['', '── Shopify / Card ──', '', '', '', '', '', '', '', '', '', '', '']);
      spCom.forEach(o => {
        const f = getF(o);
        const brut = +(fmtNum(o.total||0));
        const comPct = brut * (shopifyFeePercent / 100);
        const comTot = +(fmtNum(comPct + shopifyFeeFixed));
        const net = +(fmtNum(brut - comTot));
        detailRows.push([
          ziLabel, 'Shopify/Card',
          o.name||o.orderNumber||o.id||'', f.invoice,
          f.client, f.adr, f.oras,
          brut, brut, comTot, net,
          o.trackingNo||'', (o.courier||'').toUpperCase()||'Online'
        ]);
        dayBrut += brut; dayCom += comTot; dayNet += net; dayTotal += net;
      });
      grandTotalBrut += dayBrut; grandTotalCom += dayCom; grandTotalNet += dayNet;
    }

    grandTotal += dayTotal;

    // Subtotal zi - detaliat pe fiecare sursa de incasare (pentru reconciliere extras bancar)
    if (glsCom.length > 0) {
      detailRows.push([`  ✦ GLS Ramburs ${ziLabel}`, `${glsCom.length} comenzi`, '','','','','', +(fmtNum(dayGLS)), +(fmtNum(dayGLS)), 0, +(fmtNum(dayGLS)), '','']);
    }
    if (sdCom.length > 0) {
      detailRows.push([`  ✦ Sameday Ramburs ${ziLabel}`, `${sdCom.length} comenzi`, '','','','','', +(fmtNum(daySD)), +(fmtNum(daySD)), 0, +(fmtNum(daySD)), '','']);
    }
    if (spCom.length > 0) {
      detailRows.push([`  ✦ Shopify/Card ${ziLabel}`, `${spCom.length} comenzi`, '','','','','', +(fmtNum(dayBrut)), +(fmtNum(dayBrut)), +(fmtNum(dayCom)), +(fmtNum(dayNet)), '','']);
    }
    detailRows.push([
      `▶ TOTAL INCASAT ${ziLabel}`, `${comenzi.length} comenzi`,
      '','','','','',
      +(fmtNum(dayGLS + daySD + dayBrut)),
      +(fmtNum(dayGLS + daySD + dayBrut)),
      +(fmtNum(dayCom)),
      +(fmtNum(dayGLS + daySD + dayNet || dayTotal)),
      '','',
    ]);
    detailRows.push(['', '', '', '', '', '', '', '', '', '', '', '', '']); // linie goală separator
  });

  // Grand total final
  detailRows.push([
    'TOTAL GENERAL', `${Object.values(byDay).flat().length} comenzi`,
    '','','','','',
    +(fmtNum(grandTotalGLS + grandTotalSD + grandTotalBrut)),
    +(fmtNum(grandTotalGLS + grandTotalSD + grandTotalBrut)),
    +(fmtNum(grandTotalCom)),
    +(fmtNum(grandTotalGLS + grandTotalSD + grandTotalNet)),
    '','',
  ]);

  const ws5 = XLSX.utils.aoa_to_sheet(detailRows);
  ws5['!cols'] = [18,20,18,16,26,34,16,20,20,20,20,16,10].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws5, 'Detaliu pe Zile');

  // ── Sheet 3 – GLS Ramburs ──────────────────────────────────────────────────
  const glsOrders = allOrders.filter(o => {
    if (o.courier !== 'gls') return false;
    if (isOnlinePayment(o, onlineIds)) return false;
    if (getFinalStatus(o, sdAwbMap) !== 'livrat') return false;
    const c = new Date(o.createdAt); return c >= fromD && c <= toD;
  });
  const hdr2 = ['Data Comanda','Data Incasare (est.)','Nr. Comanda','AWB','Client','Adresa','Oras','Nr. Factura','Valoare Incasata (RON)'];
  const rows2 = [hdr2];
  let totGLS2 = 0;
  glsOrders.forEach(o => {
    const client = o.client || o.customerName || (o.shipping_address && o.shipping_address.name) || '';
    const oras   = o.oras   || o.city         || (o.shipping_address && o.shipping_address.city) || '';
    const adr    = o.address || [o.address1 || (o.shipping_address && o.shipping_address.address1) || '', o.address2 || (o.shipping_address && o.shipping_address.address2) || ''].filter(Boolean).join(', ');
    const inv    = o.invoiceNumber || o.invoiceNo || o.invoice || o.invoiceShort || '';
    const livStr = (o.fulfilledAt||o.createdAt||'').slice(0,10);
    const ziInc  = addWorkDays(livStr, 2).split('-').reverse().join('.');
    const val    = +(fmtNum(o.total));
    rows2.push([new Date(o.createdAt).toLocaleDateString('ro-RO'), ziInc,
      o.name||o.orderNumber||o.id||'', o.trackingNo||'',
      client, adr, oras, inv, val]);
    totGLS2 += val;
  });
  rows2.push(['TOTAL','','','','','','','', +(fmtNum(totGLS2))]);
  const ws2 = XLSX.utils.aoa_to_sheet(rows2);
  ws2['!cols'] = [16,18,18,16,26,34,16,16,20].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws2, 'GLS Ramburs');

  // ── Sheet 4 – Sameday Ramburs ──────────────────────────────────────────────
  const sdOrders = allOrders.filter(o => {
    if (o.courier !== 'sameday') return false;
    if (isOnlinePayment(o, onlineIds)) return false;
    if (getFinalStatus(o, sdAwbMap) !== 'livrat') return false;
    const c = new Date(o.createdAt); return c >= fromD && c <= toD;
  });
  const hdr3 = ['Data Comanda','Data Incasare (est.)','Nr. Comanda','AWB','Client','Adresa','Oras','Nr. Factura','Valoare Incasata (RON)'];
  const rows3 = [hdr3];
  let totSD3 = 0;
  sdOrders.forEach(o => {
    const client = o.client || o.customerName || (o.shipping_address && o.shipping_address.name) || '';
    const oras   = o.oras   || o.city         || (o.shipping_address && o.shipping_address.city) || '';
    const adr    = o.address || [o.address1 || (o.shipping_address && o.shipping_address.address1) || '', o.address2 || (o.shipping_address && o.shipping_address.address2) || ''].filter(Boolean).join(', ');
    const inv    = o.invoiceNumber || o.invoiceNo || o.invoice || o.invoiceShort || '';
    const livStr = (o.fulfilledAt||o.createdAt||'').slice(0,10);
    const ziInc  = addWorkDays(livStr, 1).split('-').reverse().join('.');
    const val    = +(fmtNum(o.total));
    rows3.push([new Date(o.createdAt).toLocaleDateString('ro-RO'), ziInc,
      o.name||o.orderNumber||o.id||'', o.trackingNo||'',
      client, adr, oras, inv, val]);
    totSD3 += val;
  });
  rows3.push(['TOTAL','','','','','','','', +(fmtNum(totSD3))]);
  const ws3 = XLSX.utils.aoa_to_sheet(rows3);
  ws3['!cols'] = [16,18,18,16,26,34,16,16,20].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws3, 'Sameday Ramburs');

  // ── Sheet 5 – Shopify Card ─────────────────────────────────────────────────
  const spOrders = allOrders.filter(o => {
    if (!isOnlinePayment(o, onlineIds)) return false;
    const c = new Date(o.createdAt); return c >= fromD && c <= toD;
  });
  const hdr4 = [
    'Data Comanda','Data Incasare (est.)','Nr. Comanda','Client','Adresa','Oras','Nr. Factura',
    'Valoare Comanda (RON)','Comision % (' + shopifyFeePercent + '%)','Comision Fix (RON)','Comision TOTAL (RON)','NET Incasat (RON)'
  ];
  const rows4 = [hdr4];
  let spTotBrut=0, spTotCom=0, spTotNet=0;
  spOrders.forEach(o => {
    const brut=+(fmtNum(o.total||0));
    const comPct=+(fmtNum(brut*(shopifyFeePercent/100)));
    const comTot=+(fmtNum(comPct+shopifyFeeFixed));
    const net=+(fmtNum(brut-comTot));
    const client4  = o.client || o.customerName || o.shipping_address?.name || '';
    const oras4    = o.oras   || o.city         || o.shipping_address?.city || '';
    const adr4     = o.address || [o.address1||o.shipping_address?.address1||'', o.address2||o.shipping_address?.address2||''].filter(Boolean).join(', ');
    const invoice4 = o.invoiceNumber || o.invoiceNo || o.invoice || o.invoiceShort || '';
    const base=(o.createdAt||'').slice(0,10);
    const ziInc = addWorkDays(base,2).split('-').reverse().join('.');
    rows4.push([
      new Date(o.createdAt).toLocaleDateString('ro-RO'), ziInc,
      o.name||o.orderNumber||o.id||'',
      client4, adr4, oras4,
      invoice4,
      brut, comPct, +(fmtNum(shopifyFeeFixed)), comTot, net
    ]);
    spTotBrut+=brut; spTotCom+=comTot; spTotNet+=net;
  });
  rows4.push(['TOTAL','','','','','','',
    +(fmtNum(spTotBrut)), '', '', +(fmtNum(spTotCom)), +(fmtNum(spTotNet))]);
  const ws4 = XLSX.utils.aoa_to_sheet(rows4);
  ws4['!cols'] = [16,18,18,26,34,16,16,20,18,14,20,20].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws4, 'Shopify Card');

  const label = `${from.split('-').reverse().join('.')}_${to.split('-').reverse().join('.')}`;
  XLSX.writeFile(wb, `Incasari_GLAMX_${label}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT PDF
// ─────────────────────────────────────────────────────────────────────────────
async function exportPDF({ incasariList, from, to, shopifyFeePercent, shopifyFeeFixed }) {
  const { jsPDF } = await import('jspdf');
  await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const label = `${from.split('-').reverse().join('.')} - ${to.split('-').reverse().join('.')}`;
  const pageW = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(8, 12, 16);
  doc.rect(0, 0, pageW, 22, 'F');
  doc.setTextColor(249, 115, 22);
  doc.setFontSize(15); doc.setFont('helvetica', 'bold');
  doc.text('GLAMX', 14, 13);
  doc.setTextColor(232, 237, 242);
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(`Raport Incasari  ${label}`, 38, 13);
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.text(`Generat: ${new Date().toLocaleDateString('ro-RO')} ${new Date().toLocaleTimeString('ro-RO')}  |  Comision Shopify: ${shopifyFeePercent}% + ${shopifyFeeFixed} RON fix`,
    pageW - 14, 13, { align: 'right' });

  let yPos = 28;
  doc.setTextColor(249, 115, 22);
  doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('REZUMAT INCASARI PE ZILE', 14, yPos);
  yPos += 3;

  let tGLS=0, tSD=0, tSPBrut=0, tSPCom=0, tSPNet=0, tTot=0, tCnt=0;
  const tableBody = (incasariList||[]).map(([zi,v]) => {
    const sBrut=v.shopifyBrut||0, sCom=v.shopifyComision||0, sNet=v.shopify||0;
    tGLS+=v.gls; tSD+=v.sameday; tSPBrut+=sBrut; tSPCom+=sCom; tSPNet+=sNet; tTot+=v.total; tCnt+=v.count;
    return [
      zi.split('-').reverse().join('.'),
      String(v.count),
      v.gls>0 ? fmtNum(v.gls) : '-',
      v.sameday>0 ? fmtNum(v.sameday) : '-',
      sBrut>0 ? fmtNum(sBrut) : '-',
      sCom>0 ? fmtNum(sCom) : '-',
      sNet>0 ? fmtNum(sNet) : '-',
      fmtNum(v.total),
    ];
  });
  tableBody.push(['TOTAL', String(tCnt),
    fmtNum(tGLS), fmtNum(tSD), fmtNum(tSPBrut), fmtNum(tSPCom), fmtNum(tSPNet), fmtNum(tTot)]);

  doc.autoTable({
    startY: yPos,
    head: [['Data','Colete','GLS (RON)','Sameday (RON)','Card Brut','Comision SP','Card Net','Total (RON)']],
    body: tableBody,
    styles: { fontSize: 7.5, cellPadding: 2.5, font: 'helvetica', textColor: [220, 230, 240], fillColor: [13, 21, 32] },
    headStyles: { fillColor: [22, 29, 36], textColor: [148, 163, 184], fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [16, 26, 40] },
    columnStyles: {
      0: { cellWidth: 23 },
      1: { cellWidth: 14, halign: 'center' },
      2: { cellWidth: 30, halign: 'right', textColor: [249, 115, 22] },
      3: { cellWidth: 30, halign: 'right', textColor: [59, 130, 246] },
      4: { cellWidth: 28, halign: 'right', textColor: [168, 85, 247] },
      5: { cellWidth: 25, halign: 'right', textColor: [244, 63, 94] },
      6: { cellWidth: 25, halign: 'right', textColor: [168, 85, 247] },
      7: { cellWidth: 32, halign: 'right', fontStyle: 'bold', textColor: [16, 185, 129] },
    },
    didParseCell: (data) => {
      if (data.row.index === tableBody.length - 1) {
        data.cell.styles.fillColor = [22, 29, 36];
        data.cell.styles.fontStyle = 'bold';
        if (data.column.index === 0) data.cell.styles.textColor = [249, 115, 22];
      }
    },
    margin: { left: 14, right: 14 },
  });

  // Footer
  const pgCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pgCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(74, 85, 104);
    doc.text(`Pagina ${i} / ${pgCount}`, pageW/2, doc.internal.pageSize.getHeight()-6, { align: 'center' });
    doc.text(`GLAMX Dashboard | Raport contabil ${label}`, 14, doc.internal.pageSize.getHeight()-6);
  }

  const fileLabel = `${from.split('-').reverse().join('.')}_${to.split('-').reverse().join('.')}`;
  doc.save(`Incasari_GLAMX_${fileLabel}.pdf`);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTA PRINCIPALA
// ─────────────────────────────────────────────────────────────────────────────
export default function Stats() {
  const [allOrders, setAllOrders] = useState([]);
  const [lastFetch, setLastFetch] = useState(null);
  const [preset, setPreset] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [exporting, setExporting]   = useState('');
  const [onlineIds] = useState(() => { try { return JSON.parse(ls.get('online_payment_ids')||'[]'); } catch { return []; }});
  const [sdAwbMap]  = useState(() => { try { return JSON.parse(ls.get('sd_awb_map')||'{}'); } catch { return {}; }});
  const [shopifyFeePercent, setShopifyFeePercent] = useState(() => parseFloat(ls.get('sp_fee_pct') || '1.9'));
  const [shopifyFeeFixed, setShopifyFeeFixed]     = useState(() => parseFloat(ls.get('sp_fee_fix') || '1.25'));

  useEffect(() => {
    const loadForShop = (sk) => {
      const saved = ls.get(ordersKey(sk));
      if (!saved) { setAllOrders([]); return; }
      try {
        const parsed = JSON.parse(saved);
        const ts = ls.get('gx_fetch_time');
        if (ts) setLastFetch(new Date(ts));
        setAllOrders(applyOverrides(parsed));
      } catch {}
    };
    loadForShop(getShopKey());
    const onShopChange = (e) => loadForShop(e.detail);
    window.addEventListener('glamx:shop', onShopChange);
    const onStorage = (e) => {
      if (e.key === 'gx_track_ov' || (e.key && e.key.startsWith('gx_orders_all'))) loadForShop(getShopKey());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('glamx:shop', onShopChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const [from, to] = useMemo(() => {
    if (showCustom && customFrom && customTo) return [customFrom, customTo];
    const p = PRESETS.find(p => p.id === preset);
    return p ? p.from() : PRESETS[3].from();
  }, [preset, showCustom, customFrom, customTo]);

  const orders = useMemo(() => {
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');
    return allOrders.filter(o => { const c = new Date(o.createdAt); return c >= fromD && c <= toD; });
  }, [allOrders, from, to]);

  const livrateInPeriod = useMemo(() => {
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');
    const byDate = preset === 'today' || preset === 'yesterday';
    return allOrders.filter(o => {
      if (getFinalStatus(o, sdAwbMap) !== 'livrat') return false;
      const refDate = byDate
        ? (o.fulfilledAt ? new Date(o.fulfilledAt) : new Date(o.createdAt))
        : new Date(o.createdAt);
      return refDate >= fromD && refDate <= toD;
    });
  }, [allOrders, from, to, sdAwbMap, preset]);

  const stats = useMemo(() => {
    const total   = orders.length;
    const livrate = livrateInPeriod;
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T23:59:59');

    const retururi = allOrders.filter(o => {
      if (getFinalStatus(o, sdAwbMap) !== 'retur') return false;
      const created = new Date(o.createdAt);
      return created >= fromD && created <= toD;
    });
    const anulate = orders.filter(o => getFinalStatus(o, sdAwbMap) === 'anulat');
    const tranzit = allOrders.filter(o => ['incurs','outfor'].includes(getFinalStatus(o, sdAwbMap)));
    const pending = allOrders.filter(o => getFinalStatus(o, sdAwbMap) === 'pending');

    const onlineOrders = orders.filter(o => isOnlinePayment(o, onlineIds));
    const codOrders    = orders.filter(o => !isOnlinePayment(o, onlineIds));

    const sumLivrate = livrate.reduce((a,o)=>a+o.total,0);
    const sumCOD     = livrate.filter(o=>!isOnlinePayment(o,onlineIds)).reduce((a,o)=>a+o.total,0);
    const sumOnline  = onlineOrders.reduce((a,o)=>a+o.total,0);
    const sumRetur   = retururi.reduce((a,o)=>a+o.total,0);

    const glsAll = orders.filter(o=>o.courier==='gls');
    const sdAll  = orders.filter(o=>o.courier==='sameday');
    const glsLiv = livrateInPeriod.filter(o=>o.courier==='gls').length;
    const sdLiv  = livrateInPeriod.filter(o=>o.courier==='sameday').length;
    const glsRet = retururi.filter(o=>o.courier==='gls').length;
    const sdRet  = retururi.filter(o=>o.courier==='sameday').length;

    const totalGLS        = livrate.filter(o=>o.courier==='gls'&&!isOnlinePayment(o,onlineIds)).reduce((a,o)=>a+o.total,0);
    const totalSameday    = livrate.filter(o=>o.courier==='sameday'&&!isOnlinePayment(o,onlineIds)).reduce((a,o)=>a+o.total,0);
    const totalShopifyBrut = onlineOrders.reduce((a,o)=>a+o.total,0);
    const totalShopify    = onlineOrders.reduce((a,o)=>a+o.total*(1-shopifyFeePercent/100)-shopifyFeeFixed,0);

    const rataLivrare = total ? Math.round(livrate.length/total*100) : 0;
    const rataRetur   = livrate.length ? Math.round(retururi.length/(livrate.length+retururi.length)*100) : 0;
    const avgOrder    = livrate.length ? sumLivrate/livrate.length : 0;

    const prodMap = {};
    livrate.forEach(o => {
      const items = o.items || [];
      if (!items.length) return;
      const totalItems = items.reduce((s,i)=>s+(i.qty||1),0);
      items.forEach(item => {
        const key = item.sku || item.name;
        if (!key) return;
        if (!prodMap[key]) prodMap[key] = { name: item.name, sku: item.sku||'', qty:0, revenue:0 };
        const qty = item.qty||1;
        const unitPrice = (item.price&&item.price>0) ? item.price : (o.total/totalItems);
        prodMap[key].qty     += qty;
        prodMap[key].revenue += unitPrice*qty;
      });
    });
    const prodList = Object.values(prodMap).sort((a,b)=>b.qty-a.qty);
    const topProd  = prodList[0] || null;

    const sourceMap = {};
    orders.forEach(o => {
      const utm=(o.utmSource||'').toLowerCase(), ref=(o.referrerUrl||'').toLowerCase(),
            med=(o.utmMedium||'').toLowerCase(), lp=(o.landingPage||'').toLowerCase();
      let src='Direct';
      if(utm.includes('facebook')||utm.includes('fb')||ref.includes('facebook.com')||lp.includes('fbclid')) src='Facebook';
      else if(utm.includes('tiktok')||ref.includes('tiktok.com')||lp.includes('ttclid')) src='TikTok';
      else if(utm.includes('google')||ref.includes('google.com')||lp.includes('gclid')||med.includes('cpc')) src='Google';
      else if(utm.includes('instagram')||ref.includes('instagram.com')) src='Instagram';
      else if(utm.includes('email')||med.includes('email')) src='Email';
      else if(ref&&!ref.includes('myshopify')&&!ref.includes('glamxonline')) src='Referral';
      else if(utm) src=utm.charAt(0).toUpperCase()+utm.slice(1);
      sourceMap[src]=(sourceMap[src]||0)+1;
    });
    const sourceList = Object.entries(sourceMap).sort((a,b)=>b[1]-a[1]);

    const addWorkDays = (str, n) => {
      if (!str) return '';
      const d = new Date(str + 'T12:00:00'); let added=0;
      while(added<n){d.setDate(d.getDate()+1);const day=d.getDay();if(day!==0&&day!==6)added++;}
      const p=x=>String(x).padStart(2,'0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
    };

    const allLivrate      = allOrders.filter(o => getFinalStatus(o, sdAwbMap) === 'livrat');
    const allOnlineOrders = allOrders.filter(o => isOnlinePayment(o, onlineIds));

    const incasariPerZi = {};
    const addToZi = (str, field, brut, net) => {
      if (!str) return;
      if (!incasariPerZi[str]) incasariPerZi[str]={gls:0,sameday:0,shopify:0,shopifyBrut:0,shopifyComision:0,total:0,count:0};
      const val = net !== undefined ? net : brut;
      incasariPerZi[str][field] += val;
      incasariPerZi[str].total  += val;
      incasariPerZi[str].count++;
      if (field === 'shopify' && net !== undefined) {
        incasariPerZi[str].shopifyBrut      += brut;
        incasariPerZi[str].shopifyComision  += (brut - net);
      }
    };

    allLivrate.forEach(o => {
      const isOnline = isOnlinePayment(o, onlineIds);
      if (isOnline) return;
      if (o.courier==='sameday'&&getFinalStatus(o,sdAwbMap)!=='livrat') return;
      const livStr = (o.fulfilledAt||o.createdAt||'').slice(0,10);
      if (!livStr) return;
      if (o.courier==='gls')          addToZi(addWorkDays(livStr,2),'gls',o.total);
      else if (o.courier==='sameday') addToZi(addWorkDays(livStr,1),'sameday',o.total);
      else                            addToZi(addWorkDays(livStr,2),'gls',o.total);
    });
    allOnlineOrders.forEach(o => {
      const base=(o.createdAt||'').slice(0,10);
      if(!base) return;
      const net=o.total*(1-shopifyFeePercent/100)-shopifyFeeFixed;
      addToZi(addWorkDays(base,2),'shopify',o.total,net);
    });

    const incasariList = Object.entries(incasariPerZi).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,60);

    const todayStr = new Date().toISOString().slice(0,10);
    const pad2 = n=>String(n).padStart(2,'0');
    const nextBD = (str,n) => {
      const d=new Date(str+'T12:00:00'); let added=0;
      while(added<n){d.setDate(d.getDate()+1);if(d.getDay()!==0&&d.getDay()!==6)added++;}
      return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    };
    const nextWD = (n) => {
      const d=new Date(todayStr+'T12:00:00'); let added=0;
      while(added<n){d.setDate(d.getDate()+1);if(d.getDay()!==0&&d.getDay()!==6)added++;}
      return d.toISOString().slice(0,10);
    };
    const workDays = [0,1,2,3,4].map(n=>n===0?todayStr:nextWD(n));
    const workDayLabels = workDays.map(str=>{
      const d=new Date(str+'T12:00:00');
      const days=['Dum','Lun','Mar','Mie','Joi','Vin','Sam'];
      const months=['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','nov','dec'];
      return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    });
    const previziuni = {};
    workDays.forEach(str=>{previziuni[str]={gls:0,sameday:0,shopify:0,total:0};});
    const addByDate=(dateStr,courier,val)=>{
      if(previziuni[dateStr]){previziuni[dateStr][courier]+=val;previziuni[dateStr].total+=val;}
    };
    allLivrate.forEach(o=>{
      if(isOnlinePayment(o,onlineIds)) return;
      if(o.courier==='sameday'&&getFinalStatus(o,sdAwbMap)!=='livrat') return;
      if(!o.fulfilledAt) return;
      const livStr=o.fulfilledAt.slice(0,10);
      if(o.courier==='gls')          addByDate(nextBD(livStr,2),'gls',o.total);
      else if(o.courier==='sameday') addByDate(nextBD(livStr,1),'sameday',o.total);
    });
    allOnlineOrders.forEach(o=>{
      const base=(o.createdAt||'').slice(0,10);
      if(!base) return;
      const net=o.total*(1-shopifyFeePercent/100)-shopifyFeeFixed;
      addByDate(nextBD(base,2),'shopify',net);
    });

    return {
      total, livrate: livrate.length, retururi: retururi.length,
      anulate: anulate.length, tranzit: tranzit.length, pending: pending.length,
      sumLivrate, sumCOD, sumOnline, sumRetur, totalRevenue: sumCOD+sumOnline,
      gls: glsAll.length, sameday: sdAll.length, glsLiv, sdLiv, glsRet, sdRet,
      codCount: codOrders.length, onlineCount: onlineOrders.length,
      totalGLS, totalSameday, totalShopify, totalShopifyBrut,
      rataLivrare, rataRetur, avgOrder, topProd, prodList: prodList.slice(0,10),
      avgPrice: topProd ? topProd.revenue/topProd.qty : 0,
      sourceList, incasariList, previziuni, workDays, workDayLabels,
    };
  }, [orders, livrateInPeriod, allOrders, onlineIds, sdAwbMap, shopifyFeePercent, shopifyFeeFixed, from, to]);

  const handleExcelExport = useCallback(async () => {
    setExporting('excel');
    try {
      await exportExcel({ incasariList: stats.incasariList, allOrders, onlineIds, sdAwbMap,
        shopifyFeePercent, shopifyFeeFixed, from, to });
    } catch(e) { console.error(e); alert('Eroare export Excel: ' + e.message); }
    setExporting('');
  }, [stats.incasariList, allOrders, onlineIds, sdAwbMap, shopifyFeePercent, shopifyFeeFixed, from, to]);

  const handlePDFExport = useCallback(async () => {
    setExporting('pdf');
    try {
      await exportPDF({ incasariList: stats.incasariList, from, to, shopifyFeePercent, shopifyFeeFixed });
    } catch(e) { console.error(e); alert('Eroare export PDF: ' + e.message); }
    setExporting('');
  }, [stats.incasariList, from, to, shopifyFeePercent, shopifyFeeFixed]);

  const Bar = ({ pct, color }) => (
    <div style={{height:4,background:'#1e2a35',borderRadius:2,overflow:'hidden',marginTop:4}}>
      <div style={{height:'100%',width:`${Math.min(100,pct)}%`,background:color,borderRadius:2,transition:'width 1s'}}/>
    </div>
  );
  const KPI = ({ icon, label, value, sub, color, pct }) => (
    <div style={{background:'#0d1520',border:`1px solid ${color}33`,borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:color}}/>
      <div style={{fontSize:20,marginBottom:6}}>{icon}</div>
      <div style={{fontSize:24,fontWeight:800,color,lineHeight:1,marginBottom:4}}>{value}</div>
      <div style={{fontSize:11,color:'#94a3b8',marginBottom:sub?4:0}}>{label}</div>
      {sub && <div style={{fontSize:10,color:'#4a5568'}}>{sub}</div>}
      {pct !== undefined && <Bar pct={pct} color={color}/>}
    </div>
  );
  const Section = ({ title }) => (
    <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:3,margin:'24px 0 12px',display:'flex',alignItems:'center',gap:8}}>
      {title}<div style={{flex:1,height:1,background:'#1e2a35'}}/>
    </div>
  );
  const BtnExport = ({ onClick, loading, color, icon, label }) => (
    <button onClick={onClick} disabled={!!exporting}
      style={{display:'flex',alignItems:'center',gap:6,
        background: loading ? color : color+'18',
        border:`1px solid ${color}`,color: loading ? '#fff' : color,
        padding:'7px 16px',borderRadius:8,fontSize:11,fontWeight:700,
        cursor:exporting?'not-allowed':'pointer',opacity:exporting&&!loading?0.5:1,transition:'all .2s'}}>
      <span>{loading ? '⏳' : icon}</span>
      <span>{loading ? 'Se genereaza...' : label}</span>
    </button>
  );

  if (allOrders.length === 0) {
    return (
      <div style={{minHeight:'100vh',background:'#080c10',color:'#e8edf2',fontFamily:'DM Sans,system-ui,sans-serif',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}}>
        <div style={{fontSize:40}}>📊</div>
        <div style={{fontSize:16,fontWeight:700}}>Nu exista date in cache</div>
        <div style={{fontSize:12,color:'#94a3b8'}}>Mergi la <a href="/" style={{color:'#f97316'}}>Dashboard</a> si sincronizeaza mai intai</div>
      </div>
    );
  }

  return (
    <div style={{minHeight:'100vh',background:'#080c10',color:'#e8edf2',fontFamily:'DM Sans,system-ui,sans-serif'}}>
      <div style={{maxWidth:1200,margin:'0 auto',padding:'20px 14px 60px'}}>

        {/* Header */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20,paddingBottom:16,borderBottom:'1px solid #1e2a35',flexWrap:'wrap'}}>
          <div style={{background:'#f97316',color:'#fff',fontWeight:800,fontSize:14,padding:'6px 10px',borderRadius:8}}>GLAMX</div>
          <div>
            <div style={{fontSize:18,fontWeight:700}}>Statistici</div>
            <div style={{fontSize:11,color:'#94a3b8'}}>{allOrders.length} comenzi in cache · {lastFetch?.toLocaleDateString('ro-RO')}</div>
          </div>
          <a href="/" style={{marginLeft:'auto',background:'#161d24',border:'1px solid #243040',color:'#94a3b8',padding:'5px 12px',borderRadius:20,fontSize:11,textDecoration:'none'}}>← Dashboard</a>
        </div>

        {/* Filtre */}
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => { setPreset(p.id); setShowCustom(false); }}
              style={{background:(!showCustom&&preset===p.id)?'#f97316':'#161d24',border:`1px solid ${(!showCustom&&preset===p.id)?'#f97316':'#243040'}`,
                color:(!showCustom&&preset===p.id)?'white':'#94a3b8',padding:'6px 14px',borderRadius:20,fontSize:11,cursor:'pointer',fontWeight:(!showCustom&&preset===p.id)?600:400}}>
              {p.label}
            </button>
          ))}
          <button onClick={() => setShowCustom(v=>!v)}
            style={{background:showCustom?'#1e3a5f':'#161d24',border:`1px solid ${showCustom?'#3b82f6':'#243040'}`,
              color:showCustom?'#3b82f6':'#94a3b8',padding:'6px 14px',borderRadius:20,fontSize:11,cursor:'pointer',fontWeight:showCustom?600:400}}>
            📅 Interval custom
          </button>
        </div>

        {/* Picker custom */}
        {showCustom && (
          <div style={{background:'#0d1520',border:'1px solid #3b82f6',borderRadius:10,padding:'12px 16px',marginBottom:12,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            <span style={{fontSize:11,color:'#3b82f6',fontWeight:700}}>📅 Interval personalizat:</span>
            <label style={{fontSize:11,color:'#94a3b8'}}>De la</label>
            <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}
              style={{background:'#161d24',border:'1px solid #3b82f6',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:12,outline:'none'}}/>
            <label style={{fontSize:11,color:'#94a3b8'}}>Pana la</label>
            <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}
              style={{background:'#161d24',border:'1px solid #3b82f6',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:12,outline:'none'}}/>
            {customFrom && customTo && (
              <span style={{fontSize:11,color:'#10b981',fontFamily:'monospace'}}>
                {customFrom.split('-').reverse().join('.')} — {customTo.split('-').reverse().join('.')}
              </span>
            )}
          </div>
        )}

        <div style={{fontSize:11,color:'#4a5568',fontFamily:'monospace',marginBottom:20}}>
          {from.split('-').reverse().join('.')} — {to.split('-').reverse().join('.')} · <strong style={{color:'#f97316'}}>{stats.total}</strong> comenzi
        </div>

        {/* ─── EXPORT CONTABIL ─── */}
        <div style={{background:'linear-gradient(135deg,#071510 0%,#0d1520 100%)',border:'1px solid #16a34a55',borderRadius:12,padding:'16px 18px',marginBottom:20}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,flexWrap:'wrap'}}>
            <div style={{fontSize:10,color:'#16a34a',textTransform:'uppercase',letterSpacing:2,fontWeight:700}}>📤 Export Contabil</div>
            <span style={{fontSize:10,color:'#4a5568',marginLeft:4}}>
              {from.split('-').reverse().join('.')} — {to.split('-').reverse().join('.')}
            </span>
          </div>
          <div style={{fontSize:11,color:'#64748b',marginBottom:12,lineHeight:1.6}}>
            Exportul include: <span style={{color:'#f97316'}}>GLS ramburs</span> · <span style={{color:'#3b82f6'}}>Sameday ramburs</span> · <span style={{color:'#a855f7'}}>Shopify card</span> (brut, comision, net) — cu numar comanda, client, adresa, numar factura, per comanda.
          </div>
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
            <BtnExport onClick={handleExcelExport} loading={exporting==='excel'} color="#16a34a" icon="📊" label="Export Excel (.xlsx)"/>
            <BtnExport onClick={handlePDFExport}   loading={exporting==='pdf'}   color="#dc2626" icon="📄" label="Export PDF"/>
          </div>
          <div style={{marginTop:10,fontSize:10,color:'#374151',lineHeight:1.8}}>
            Excel: 4 sheet-uri → <em style={{color:'#94a3b8'}}>Rezumat pe zile</em> · <em style={{color:'#94a3b8'}}>GLS Ramburs</em> · <em style={{color:'#94a3b8'}}>Sameday Ramburs</em> · <em style={{color:'#94a3b8'}}>Shopify Card</em>
          </div>
        </div>

        <Section title="Sumar general"/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:8}}>
          <KPI icon="📦" label="Total comenzi"    value={fmtInt(stats.total)}    color="#f97316" pct={100}/>
          <KPI icon="✅" label="Livrate"           value={fmtInt(stats.livrate)}  color="#10b981" pct={stats.rataLivrare} sub={`dupa data livrarii · ${stats.rataLivrare}%`}/>
          <KPI icon="🚚" label="In tranzit"        value={fmtInt(stats.tranzit)}  color="#3b82f6" pct={stats.total?stats.tranzit/stats.total*100:0}/>
          <KPI icon="↩️" label="Retururi"          value={fmtInt(stats.retururi)} color="#f43f5e" pct={stats.rataRetur} sub={`${stats.rataRetur}% rata retur`}/>
          <KPI icon="❌" label="Anulate"           value={fmtInt(stats.anulate)}  color="#4a5568" pct={stats.total?stats.anulate/stats.total*100:0}/>
          <KPI icon="⏳" label="Neexpediate"       value={fmtInt(stats.pending)}  color="#f59e0b" pct={stats.total?stats.pending/stats.total*100:0}/>
        </div>

        <Section title="Financiar"/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10,marginBottom:8}}>
          <div style={{background:'#0d1520',border:'1px solid #10b981',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Incasat (livrate)</div>
            <div style={{fontSize:26,fontWeight:800,color:'#10b981'}}>{fmt(stats.sumLivrate)} <span style={{fontSize:13}}>RON</span></div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>din {stats.livrate} comenzi livrate · avg {fmt(stats.avgOrder)} RON</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #f59e0b',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>COD ramburs</div>
            <div style={{fontSize:26,fontWeight:800,color:'#f59e0b'}}>{fmt(stats.sumCOD)} <span style={{fontSize:13}}>RON</span></div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>{stats.codCount} comenzi COD</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #3b82f6',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Shopify Payments</div>
            <div style={{fontSize:26,fontWeight:800,color:'#3b82f6'}}>{fmt(stats.sumOnline)} <span style={{fontSize:13}}>RON</span></div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>{stats.onlineCount} comenzi card · toate din perioada</div>
          </div>
          {stats.sumRetur > 0 && (
            <div style={{background:'#0d1520',border:'1px solid #f43f5e',borderRadius:12,padding:'16px 18px'}}>
              <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Pierdut retur</div>
              <div style={{fontSize:26,fontWeight:800,color:'#f43f5e'}}>{fmt(stats.sumRetur)} <span style={{fontSize:13}}>RON</span></div>
              <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>{stats.retururi} retururi</div>
            </div>
          )}
        </div>

        <div style={{background:'rgba(59,130,246,.06)',border:'1px solid rgba(59,130,246,.2)',borderRadius:10,padding:'10px 14px',marginBottom:10,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'#3b82f6'}}>💳 Comision Shopify Payments:</span>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <input type="number" step="0.01" min="0" max="10" value={shopifyFeePercent}
              onChange={e=>{const v=parseFloat(e.target.value)||0;setShopifyFeePercent(v);try{localStorage.setItem('sp_fee_pct',String(v));}catch{}}}
              style={{width:60,background:'#161d24',border:'1px solid #3b82f6',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:12,outline:'none',textAlign:'center'}}/>
            <span style={{fontSize:11,color:'#94a3b8'}}>%</span>
            <span style={{fontSize:11,color:'#4a5568'}}>+</span>
            <input type="number" step="0.01" min="0" value={shopifyFeeFixed}
              onChange={e=>{const v=parseFloat(e.target.value)||0;setShopifyFeeFixed(v);try{localStorage.setItem('sp_fee_fix',String(v));}catch{}}}
              style={{width:60,background:'#161d24',border:'1px solid #3b82f6',color:'#e8edf2',padding:'4px 8px',borderRadius:6,fontSize:12,outline:'none',textAlign:'center'}}/>
            <span style={{fontSize:11,color:'#94a3b8'}}>RON fix</span>
          </div>
          <span style={{fontSize:10,color:'#4a5568'}}>ex: 399 x (1-{shopifyFeePercent}%) = {fmt(399*(1-shopifyFeePercent/100)-shopifyFeeFixed)} RON net</span>
        </div>

        <Section title="De incasat"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
          {(stats.workDays||[]).slice(0,2).map((dateStr, idx) => {
            const p = stats.previziuni?.[dateStr] || {gls:0,sameday:0,shopify:0,total:0};
            const dayLabel = (stats.workDayLabels||[])[idx] || dateStr;
            const label = idx===0 ? '⏰ De incasat AZI' : `📅 ${dayLabel}`;
            const color = idx===0 ? '#a855f7' : '#10b981';
            return (
              <div key={dateStr} style={{background:'#0d1520',border:`1px solid ${color}`,borderRadius:12,padding:'14px 16px'}}>
                <div style={{fontSize:10,color,textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>{label}</div>
                <div style={{fontSize:24,fontWeight:800,color,marginBottom:8}}>{fmt(p.total)} <span style={{fontSize:12}}>RON</span></div>
                {p.gls>0     && <div style={{fontSize:11,color:'#94a3b8',marginBottom:3}}>📦 GLS: <strong style={{color:'#f97316'}}>{fmt(p.gls)} RON</strong></div>}
                {p.sameday>0 && <div style={{fontSize:11,color:'#94a3b8',marginBottom:3}}>🚀 SD: <strong style={{color:'#3b82f6'}}>{fmt(p.sameday)} RON</strong></div>}
                {p.shopify>0 && <div style={{fontSize:11,color:'#94a3b8',marginBottom:3}}>💳 Card: <strong style={{color:'#a855f7'}}>{fmt(p.shopify)} RON</strong></div>}
                {p.total===0 && <div style={{fontSize:11,color:'#4a5568'}}>Nimic programat</div>}
              </div>
            );
          })}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:10}}>
          <div style={{background:'#0d1520',border:'1px solid #f97316',borderRadius:12,padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>📦 GLS Total</div>
            <div style={{fontSize:22,fontWeight:800,color:'#f97316'}}>{fmt(stats.totalGLS||0)} <span style={{fontSize:11}}>RON</span></div>
            <div style={{fontSize:10,color:'#4a5568',marginTop:3}}>ramburs COD livrate</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #3b82f6',borderRadius:12,padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#3b82f6',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>🚀 Sameday Total</div>
            <div style={{fontSize:22,fontWeight:800,color:'#3b82f6'}}>{fmt(stats.totalSameday||0)} <span style={{fontSize:11}}>RON</span></div>
            <div style={{fontSize:10,color:'#4a5568',marginTop:3}}>ramburs COD livrate</div>
          </div>
          <div style={{background:'#0d1520',border:'1px solid #a855f7',borderRadius:12,padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#a855f7',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>💳 Shopify Payments</div>
            <div style={{fontSize:22,fontWeight:800,color:'#a855f7'}}>{fmt(stats.totalShopify||0)} <span style={{fontSize:11}}>RON</span></div>
            <div style={{fontSize:10,color:'#4a5568',marginTop:3}}>brut: {fmt(stats.totalShopifyBrut||0)} · comision: {fmt((stats.totalShopifyBrut||0)-(stats.totalShopify||0))} RON</div>
          </div>
          {(stats.workDays||[]).slice(2).some(d=>(stats.previziuni?.[d]?.total||0)>0) && (
            <div style={{background:'#0d1520',border:'1px solid #f59e0b',borderRadius:12,padding:'14px 16px'}}>
              <div style={{fontSize:10,color:'#f59e0b',textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>📆 Urmatoarele zile</div>
              {(stats.workDays||[]).slice(2).map((dateStr,idx)=>{
                const p=stats.previziuni?.[dateStr]||{gls:0,sameday:0,shopify:0,total:0};
                const label=(stats.workDayLabels||[])[idx+2]||dateStr;
                if(p.total===0) return null;
                return (
                  <div key={dateStr} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid #1a2535'}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:600,color:'#e2e8f0'}}>{label}</div>
                      <div style={{fontSize:10,color:'#475569',display:'flex',gap:8,marginTop:1}}>
                        {p.gls>0&&<span>📦 {fmt(p.gls)}</span>}
                        {p.sameday>0&&<span>🚀 {fmt(p.sameday)}</span>}
                        {p.shopify>0&&<span>💳 {fmt(p.shopify)}</span>}
                      </div>
                    </div>
                    <div style={{fontSize:15,fontWeight:800,color:'#f59e0b'}}>{fmt(p.total)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Section title="Istoric incasari pe zile"/>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginBottom:8}}>
          <BtnExport onClick={handleExcelExport} loading={exporting==='excel'} color="#16a34a" icon="📊" label="Excel"/>
          <BtnExport onClick={handlePDFExport}   loading={exporting==='pdf'}   color="#dc2626" icon="📄" label="PDF"/>
        </div>
        <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,overflow:'hidden',marginBottom:10}}>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'#161d24'}}>
                  {['Data incasare','Colete','📦 GLS','🚀 Sameday','💳 Card Brut','Comision SP','💳 Card Net','Total'].map(h=>(
                    <th key={h} style={{padding:'8px 12px',textAlign:'right',fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(stats.incasariList||[]).length===0 ? (
                  <tr><td colSpan={8} style={{padding:20,textAlign:'center',color:'#4a5568'}}>Nicio livrare in perioada selectata</td></tr>
                ) : (stats.incasariList||[]).map(([zi,v])=>(
                  <tr key={zi} style={{borderTop:'1px solid #1e2a35'}}>
                    <td style={{padding:'8px 12px',color:'#e8edf2',fontFamily:'monospace',fontWeight:500}}>{zi.split('-').reverse().join('.')}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:'#94a3b8'}}>{v.count}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:v.gls>0?'#f97316':'#4a5568',fontFamily:'monospace'}}>{v.gls>0?fmt(v.gls)+' RON':'—'}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:v.sameday>0?'#3b82f6':'#4a5568',fontFamily:'monospace'}}>{v.sameday>0?fmt(v.sameday)+' RON':'—'}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:(v.shopifyBrut||0)>0?'#a855f7':'#4a5568',fontFamily:'monospace'}}>{(v.shopifyBrut||0)>0?fmt(v.shopifyBrut)+' RON':'—'}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:(v.shopifyComision||0)>0?'#f43f5e':'#4a5568',fontFamily:'monospace',fontSize:11}}>{(v.shopifyComision||0)>0?'-'+fmt(v.shopifyComision)+' RON':'—'}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:v.shopify>0?'#a855f7':'#4a5568',fontFamily:'monospace'}}>{v.shopify>0?fmt(v.shopify)+' RON':'—'}</td>
                    <td style={{padding:'8px 12px',textAlign:'right',color:'#10b981',fontFamily:'monospace',fontWeight:700}}>{fmt(v.total)} RON</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <Section title="Curier"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8}}>
          {[{id:'gls',label:'📦 GLS',color:'#f97316',liv:stats.glsLiv,ret:stats.glsRet},{id:'sameday',label:'🚀 Sameday',color:'#3b82f6',liv:stats.sdLiv,ret:stats.sdRet}].map(({id,label,color,liv,ret})=>(
            <div key={id} style={{background:'#0d1520',border:`1px solid ${color}`,borderRadius:12,padding:'16px 18px'}}>
              <div style={{fontSize:12,color,fontWeight:700,marginBottom:12,fontFamily:'monospace'}}>{label}</div>
              {[['Livrate in perioada',liv,'#e8edf2'],['Livrate',liv,'#10b981'],['Returnate',ret,'#f43f5e']].map(([l,v,c])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                  <span style={{fontSize:12,color:'#94a3b8'}}>{l}</span>
                  <span style={{fontSize:13,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <Section title="Metode de plata"/>
        <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,padding:'16px 18px',marginBottom:8}}>
          <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
            {[{label:'💵 COD / Ramburs',count:stats.codCount,color:'#f59e0b'},{label:'💳 Shopify Payments',count:stats.onlineCount,color:'#3b82f6'}].map(({label,count,color})=>(
              <div key={label} style={{flex:1,minWidth:120,background:`rgba(${color==='#f59e0b'?'245,158,11':'59,130,246'},.1)`,border:`1px solid rgba(${color==='#f59e0b'?'245,158,11':'59,130,246'},.3)`,borderRadius:8,padding:'10px 14px'}}>
                <div style={{fontSize:10,color,textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>{label}</div>
                <div style={{fontSize:22,fontWeight:800,color}}>{count}</div>
                <div style={{fontSize:10,color:'#4a5568'}}>{stats.total?Math.round(count/stats.total*100):0}% din comenzi</div>
              </div>
            ))}
          </div>
          <div style={{height:8,background:'#1e2a35',borderRadius:4,overflow:'hidden',display:'flex'}}>
            <div style={{width:`${stats.total?stats.codCount/stats.total*100:0}%`,background:'#f59e0b'}}/>
            <div style={{flex:1,background:'#3b82f6'}}/>
          </div>
        </div>

        <Section title="Sursa trafic (UTM)"/>
        <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,padding:'16px 18px',marginBottom:8}}>
          {stats.sourceList.length===0 ? (
            <div style={{fontSize:12,color:'#4a5568',textAlign:'center',padding:'20px 0'}}>Nu exista date UTM.</div>
          ) : stats.sourceList.map(([src,count])=>{
            const icons={'Facebook':'📘','TikTok':'🎵','Google':'🔍','Instagram':'📸','Email':'📧','Direct':'🏠','Referral':'🔗'};
            const colors={'Facebook':'#1877f2','TikTok':'#ff0050','Google':'#ea4335','Instagram':'#e1306c','Email':'#10b981','Direct':'#94a3b8','Referral':'#a855f7'};
            const color=colors[src]||'#f97316';
            const pct=stats.total?count/stats.total*100:0;
            return (
              <div key={src} style={{marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                  <span style={{fontSize:14}}>{icons[src]||'🌐'}</span>
                  <span style={{fontSize:12,color:'#e8edf2',flex:1,fontWeight:500}}>{src}</span>
                  <span style={{fontSize:12,fontFamily:'monospace',color,fontWeight:700}}>{count}</span>
                  <span style={{fontSize:10,color:'#4a5568',width:36,textAlign:'right'}}>{Math.round(pct)}%</span>
                </div>
                <div style={{height:4,background:'#1e2a35',borderRadius:2,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${pct}%`,background:color,borderRadius:2,transition:'width 1s'}}/>
                </div>
              </div>
            );
          })}
        </div>

        {stats.topProd && (
          <>
            <Section title="Top produse vandute"/>
            <div style={{background:'linear-gradient(135deg,#0d1520 0%,#111c2b 100%)',border:'1px solid #f97316',borderRadius:12,padding:'18px 20px',marginBottom:10}}>
              <div style={{display:'flex',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>🏆 Cel mai vandut</div>
                  <div style={{fontSize:16,fontWeight:700,color:'#e8edf2',lineHeight:1.3,marginBottom:4}}>{stats.topProd.name}</div>
                  {stats.topProd.sku&&<div style={{fontSize:11,color:'#4a5568',fontFamily:'monospace'}}>SKU: {stats.topProd.sku}</div>}
                </div>
                <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                  {[{v:fmtInt(stats.topProd.qty),l:'buc vandute',c:'#f97316'},{v:fmt(stats.avgPrice),l:'RON pret mediu',c:'#10b981'},{v:fmt(stats.topProd.revenue),l:'RON total',c:'#f59e0b'}].map(({v,l,c})=>(
                    <div key={l} style={{textAlign:'center'}}>
                      <div style={{fontSize:28,fontWeight:800,color:c}}>{v}</div>
                      <div style={{fontSize:10,color:'#94a3b8'}}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {stats.prodList.length>1&&(
              <div style={{background:'#0d1520',border:'1px solid #1e2a35',borderRadius:12,overflow:'hidden'}}>
                <div style={{padding:'10px 16px',borderBottom:'1px solid #1e2a35',fontSize:12,fontWeight:700}}>Top 10 produse</div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#161d24'}}>
                        {['#','Produs','SKU','Buc','Pret mediu','Total'].map(h=>(
                          <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.prodList.map((p,i)=>(
                        <tr key={i} style={{borderTop:'1px solid #1e2a35'}}>
                          <td style={{padding:'8px 12px',color:i===0?'#f97316':'#4a5568',fontWeight:700}}>{i+1}</td>
                          <td style={{padding:'8px 12px',color:'#e8edf2',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={p.name}>{p.name}</td>
                          <td style={{padding:'8px 12px',color:'#4a5568',fontFamily:'monospace',fontSize:11}}>{p.sku||'—'}</td>
                          <td style={{padding:'8px 12px',color:i===0?'#f97316':'#10b981',fontWeight:700,fontFamily:'monospace'}}>{fmtInt(p.qty)}</td>
                          <td style={{padding:'8px 12px',color:'#94a3b8',fontFamily:'monospace'}}>{fmt(p.revenue/p.qty)} RON</td>
                          <td style={{padding:'8px 12px',color:'#f59e0b',fontFamily:'monospace',fontWeight:600}}>{fmt(p.revenue)} RON</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
