/**
 * lib/courier-tracking.js
 * Shared GLS/Sameday status-code → category classification, extracted from
 * app/page.js's "Colete în tranzit" panel (the already-working live tracking
 * feature) so app/fulfillment/page.js can use the exact same logic instead of
 * a separate, weaker approximation.
 *
 * Categories: 'inregistrat' (AWB creat, încă la noi — de ambalat/predat),
 * 'ridicat' (preluat de curier), 'centru' (în tranzit prin depozit/hub),
 * 'livrare' (ieșit pentru livrare azi), 'easybox' (în așteptare la locker).
 * Returns null when the numeric code alone isn't enough to classify (caller
 * should fall back to whatever status info it already has, e.g. delivered/
 * returned from /api/tracking's simpler `status` field).
 */

/** Categorizes a live GLS/Sameday numeric status code. Mirrors app/page.js's classifyTranzitStatus code-based branch exactly. */
export function classifyByCode(courier, code) {
  if (!code) return null;
  const isGls = courier !== 'sameday';

  if (isGls) {
    if ([4, 29, 32, 56, 58, 92, 93].includes(code)) return 'livrare';
    if ([3, 10, 13, 22, 26, 27, 41, 46, 47, 53, 84, 97, 99].includes(code)) return 'centru';
    if ([1, 2, 85, 86].includes(code)) return 'ridicat';
    if ([51, 52, 80, 83].includes(code)) return 'inregistrat';
    return null;
  }

  if ([10, 33, 34, 35].includes(code)) return 'livrare';
  if ([74, 75, 78, 79].includes(code)) return 'easybox';
  if ([70, 71, 72, 73, 76, 77, 80, 81, 82, 83].includes(code)) return 'centru';
  if ([3, 7, 26, 27, 28, 36, 37, 38, 39, 40, 41, 44, 52, 53, 84, 85, 87].includes(code)) return 'centru';
  if ([2, 4, 23].includes(code)) return 'ridicat';
  if ([1].includes(code)) return 'inregistrat';
  return null;
}

/**
 * Fetches live tracking for a batch of {id, awb, courier} via the existing
 * /api/tracking POST endpoint (same one app/page.js's tranzit panel uses —
 * server-side cached 30min per AWB, so repeated calls are cheap).
 * Returns a Map<id, {status, statusRaw, statusDescription, location, lastUpdate}>.
 */
export async function fetchLiveTrackingBatch(orders) {
  const targets = orders.filter(o => o.awb).map(o => ({ id: o.id, awb: o.awb, courier: o.courier }));
  if (!targets.length) return new Map();
  try {
    const res = await fetch('/api/tracking', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: targets }),
    });
    const data = await res.json();
    const map = new Map();
    for (const r of data.results || []) map.set(r.id, r);
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Categorizes an order given its live tracking result. `live.statusRaw` is
 * the numeric GLS/Sameday code when available (most precise); falls back to
 * /api/tracking's coarser `status` field (delivered/out_for_delivery/
 * returned/failed_attempt/in_transit) when no numeric code was returned.
 */
export function classifyOrder(courier, live) {
  if (!live) return 'inregistrat'; // fără date live încă — presupunem că e la noi, nu ascundem din greșeală
  const code = live.statusRaw ? parseInt(live.statusRaw, 10) : null;
  const byCode = !isNaN(code) ? classifyByCode(courier, code) : null;
  if (byCode) return byCode;

  switch (live.status) {
    case 'delivered':
    case 'out_for_delivery':
    case 'returned':
    case 'failed_attempt':
      return 'ridicat'; // toate astea presupun coletul deja preluat de curier
    case 'in_transit':
      return 'centru';
    default:
      return 'inregistrat';
  }
}
