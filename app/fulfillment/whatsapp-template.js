/**
 * app/fulfillment/whatsapp-template.js
 * Same default template + variable substitution as app/whatsapp/page.js,
 * reading/writing the same localStorage['wa_template'] key so both pages
 * stay in sync. No Twilio call here — just builds a prefilled
 * api.whatsapp.com/send link, exactly like the manual-send button on the
 * chat page.
 */

export const DEFAULT_WA_TEMPLATE = `👋 Bună ziua, {{client}}! Vă contactăm din partea glamx.ro în legătură cu comanda dumneavoastră {{nr}} pentru {{produse}}.
📦 Pentru a putea expedia comanda în valoare de {{total}} RON, vă rugăm să ne confirmați dacă aceasta rămâne valabilă.

👉 Răspundeți cu:
DA – dacă doriți să primiți comanda
NU – dacă doriți anularea acesteia

Vă mulțumim! 🤍`;

const ls = {
  get: k => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
};

export function getWaTemplate() {
  return ls.get('wa_template') || DEFAULT_WA_TEMPLATE;
}

/** order: {name, client, total, prods} — same shape used throughout the Fulfillment page. */
export function buildWaMessage(order, template) {
  const tpl = template || getWaTemplate();
  const firstName = (order.client || 'client').split(' ')[0];
  return tpl
    .replace('{{client}}', firstName)
    .replace('{{nr}}', order.name || order.id)
    .replace('{{total}}', Number(order.total || 0).toFixed(2))
    .replace('{{produse}}', (order.prods || '').slice(0, 60));
}

/** Same phone normalization as app/whatsapp/page.js's getPhone — RO numbers get a +40 prefix. */
export function normalizeWaPhone(phone) {
  let p = (phone || '').replace(/[\s\-().+]/g, '');
  if (!p) return '';
  if (p.startsWith('07') || p.startsWith('02') || p.startsWith('03')) p = '+4' + p;
  else if (p.startsWith('40') && !p.startsWith('+')) p = '+' + p;
  else if (!p.startsWith('+')) p = '+4' + p; // assume RO
  return p;
}

export function buildWaLink(order, template) {
  const phone = normalizeWaPhone(order.phone);
  if (!phone) return null;
  const msg = buildWaMessage(order, template);
  return `https://api.whatsapp.com/send?phone=${phone.replace('+', '')}&text=${encodeURIComponent(msg)}`;
}
