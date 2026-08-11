/**
 * app/fulfillment/orders-source.js
 * Fulfillment's order list reads from /api/connector/orders — the same
 * live-from-Shopify + DB-enriched source app/xconnector/page.tsx already
 * uses, instead of /api/orders-server (DB-only). orders-server only lists
 * rows already webhooked into our DB, so a brand-new order (or one from
 * before webhooks were wired up) simply wouldn't appear; /api/connector/orders
 * always lists what's actually in Shopify and layers our DB's invoice/shipment
 * state on top, with a fallback to Shopify's own fulfillment/note_attributes
 * data for orders processed before this app existed.
 */

function findNoteValue(notes, pred) {
  const key = Object.keys(notes || {}).find(k => pred(k.toLowerCase()));
  return key ? notes[key] : '';
}

/** Normalizes one /api/connector/orders entry into the shape the rest of the fulfillment page expects. */
export function mapConnectorOrder(o) {
  const notes = o.noteAttributes || {};
  const noteInvoiceUrl = findNoteValue(notes, n => (n.includes('invoice-url') || n.includes('invoice_url')) && !n.includes('short'));
  const noteInvoiceNumber = findNoteValue(notes, n => n === 'invoice-number' || n === 'invoice_number');
  const hasInvoice = !!(o.invoice || noteInvoiceUrl || noteInvoiceNumber);
  const invoiceNumber = o.invoice ? `${o.invoice.series}${o.invoice.number}` : noteInvoiceNumber;
  const invoiceUrl = o.invoice?.url || noteInvoiceUrl || '';

  const items = (o.lineItems || []).map(i => ({ name: i.name, sku: i.sku, qty: i.quantity, price: i.price }));
  const fin = (o.financialStatus || '').toLowerCase();

  // Un AWB anulat (regenerat între timp) nu contează ca "înregistrat" — comanda
  // trebuie să revină la "de procesat" până se creează unul nou.
  const shipmentStatus = o.shipment?.status || null;
  const shipmentCancelled = shipmentStatus === 'CANCELLED';
  // /api/connector/orders întoarce id:null pentru un AWB văzut doar prin
  // fulfillment-ul Shopify (fallback, fără rând Shipment în DB-ul nostru) —
  // acelea nu sunt urmărite de sincronizarea automată de status GLS.
  const shipmentDbId = o.shipment?.id || null;

  return {
    id: o.id,
    name: o.name,
    fin,
    cancelled: !!o.cancelled,
    shipmentStatus,
    shipmentDbId,
    trackingNo: shipmentCancelled ? '' : (o.shipment?.tracking || ''),
    courier: o.shipment?.courier || 'unknown',
    client: o.customer?.name || '',
    oras: o.address?.city || '',
    county: o.address?.province || '',
    zip: o.address?.zip || '',
    address: [o.address?.address1, o.address?.address2].filter(Boolean).join(', '),
    phone: o.customer?.phone || '',
    clientEmail: o.customer?.email || '',
    total: o.totalPrice || 0,
    currency: o.currency || 'RON',
    prods: items.map(i => i.name).filter(Boolean).join(' + '),
    createdAt: o.createdAt,
    hasInvoice,
    invoiceNumber,
    invoiceUrl,
    items,
    isCOD: fin !== 'paid',
    _dbId: o.dbId,
  };
}
