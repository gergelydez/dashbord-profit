/**
 * lib/couriers/gls.ts — GLS Romania courier adapter
 *
 * Reuses the battle-tested logic from app/api/gls/route.js and wraps it
 * in the CourierAdapter interface with proper TypeScript types.
 *
 * API docs: https://api.mygls.ro (SOAP/JSON hybrid endpoint)
 */

import { logger } from '@/lib/logger';
import type {
  CourierAdapter,
  CreateShipmentInput,
  CreateShipmentResult,
} from './types';

const GLS_BASE = 'https://api.mygls.ro/ParcelService.svc/json';

// ─── Config ───────────────────────────────────────────────────────────────────

interface GlsConfig {
  username:     string;
  password:     string;
  clientNumber: string;
  pickup: {
    name:    string;
    street:  string;
    city:    string;
    zip:     string;
    county:  string;
    phone:   string;
  };
}

function loadConfig(): GlsConfig {
  return {
    username:     process.env.GLS_USERNAME     || '',
    password:     process.env.GLS_PASSWORD     || '',
    clientNumber: process.env.GLS_CLIENT_NUMBER || '553003585',
    pickup: {
      name:   process.env.GLS_PICKUP_NAME    || '',
      street: process.env.GLS_PICKUP_STREET  || '',
      city:   process.env.GLS_PICKUP_CITY    || '',
      zip:    process.env.GLS_PICKUP_ZIP     || '',
      county: process.env.GLS_PICKUP_COUNTY  || '',
      phone:  process.env.GLS_PICKUP_PHONE   || '',
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sha512Bytes(str: string): Promise<number[]> {
  const encoded = new TextEncoder().encode(str);
  const buf = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  return Array.from(new Uint8Array(buf));
}

function cleanZip(z: string): string {
  return (z || '').replace(/\D/g, '');
}

function parseStreet(address: string): { street: string; houseNum: string } {
  const addr = (address || '').trim();
  const patterns = [
    /^(.+?)\s+nr\.?\s*(\d+[\w/\-]*)$/i,
    /^(.+?)\s*,\s*(\d+[\w/\-]*)$/i,
    /^(.+?)\s+(\d+[\w/\-]*)$/i,
  ];
  for (const p of patterns) {
    const m = addr.match(p);
    if (m?.[1] && m?.[2]) return { street: m[1].trim(), houseNum: m[2].trim() };
  }
  return { street: addr, houseNum: '1' };
}

// In-process pickup cache (valid for process lifetime)
let _pickupCache: GlsConfig['pickup'] | null = null;

async function resolvePickup(
  cfg: GlsConfig,
  baseReq: Record<string, unknown>,
): Promise<GlsConfig['pickup']> {
  if (cfg.pickup.name && cfg.pickup.city && cfg.pickup.zip) {
    return cfg.pickup;
  }
  if (_pickupCache) return _pickupCache;

  // Auto-discover pickup from recent parcel history
  const d = new Date();
  d.setDate(d.getDate() - 30);
  try {
    const res = await fetch(`${GLS_BASE}/GetParcelList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseReq,
        PickupDateFrom: d.toISOString(),
        PickupDateTo: new Date().toISOString(),
      }),
      cache: 'no-store',
    });
    const data = await res.json();
    for (const p of (data?.ParcelList ?? [])) {
      const pa = p.PickupAddress;
      if (pa?.Name && pa?.City && pa?.ZipCode) {
        _pickupCache = {
          name:   pa.Name  || '',
          street: pa.Street || '',
          city:   pa.City  || '',
          zip:    cleanZip(pa.ZipCode || ''),
          county: pa.CountyName || '',
          phone:  (pa.ContactPhone || '').replace(/\D/g, '').slice(-10),
        };
        return _pickupCache;
      }
    }
  } catch (e) {
    logger.warn('[GLS] pickup auto-discovery failed', { error: (e as Error).message });
  }

  throw new Error(
    'GLS pickup address missing. Set GLS_PICKUP_NAME, GLS_PICKUP_STREET, GLS_PICKUP_CITY, ' +
    'GLS_PICKUP_ZIP, GLS_PICKUP_COUNTY, GLS_PICKUP_PHONE in env vars.',
  );
}

// ─── Adapter implementation ───────────────────────────────────────────────────

export class GlsAdapter implements CourierAdapter {
  readonly name = 'gls';

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const cfg = loadConfig();
    const log = logger.child({ module: 'couriers/gls', orderName: input.orderName });

    if (!cfg.username || !cfg.password) {
      throw new Error('GLS credentials not configured (GLS_USERNAME / GLS_PASSWORD)');
    }

    const passwordHash = await sha512Bytes(cfg.password);
    const baseReq = {
      Username:         cfg.username,
      Password:         passwordHash,
      ClientNumberList: [parseInt(cfg.clientNumber)],
      WebshopEngine:    'Custom',
    };

    const pickup = await resolvePickup(cfg, baseReq);
    const { street: pStreet, houseNum: pHouseNum } = parseStreet(pickup.street);
    const { street: dStreet, houseNum: dHouseNum } = parseStreet(input.recipient.address);
    const zipCleaned = cleanZip(input.recipient.zip);

    // Basic validation (RO = 6 digits, HU = 4 digits, other = 4–9)
    if (!zipCleaned || zipCleaned.length < 4 || zipCleaned.length > 9) {
      throw new Error(`GLS: invalid recipient zip "${input.recipient.zip}" — must be 4–9 digits`);
    }

    const parcelPayload = {
      ClientNumber:    parseInt(cfg.clientNumber),
      ClientReference: input.orderName.slice(0, 40),
      Count:           input.parcels || 1,
      CODAmount:       input.isCOD ? input.totalPrice : 0,
      CODReference:    input.isCOD ? input.orderName.slice(0, 40) : '',
      CODCurrency:     input.isCOD ? (input.currency || 'RON') : undefined,
      Content:         (input.content || input.orderName || 'Colet').slice(0, 40),
      PickupDate:      `/Date(${Date.now()})/`,
      PickupAddress: {
        Name:           pickup.name.slice(0, 40),
        Street:         pStreet.slice(0, 40),
        HouseNumber:    (pHouseNum || '1').slice(0, 10),
        CountyName:     (pickup.county || '').slice(0, 40),
        City:           pickup.city.slice(0, 40),
        ZipCode:        pickup.zip,
        CountryIsoCode: 'RO',
        ContactName:    pickup.name.slice(0, 40),
        ContactPhone:   pickup.phone || '',
        ContactEmail:   '',
      },
      DeliveryAddress: {
        Name:           input.recipient.name.slice(0, 40),
        Street:         (dStreet || input.recipient.address || '').slice(0, 40),
        HouseNumber:    (dHouseNum || '1').slice(0, 10),
        CountyName:     (input.recipient.county || '').slice(0, 40),
        City:           input.recipient.city.slice(0, 40),
        ZipCode:        zipCleaned,
        CountryIsoCode: (input.recipient.country || 'RO').toUpperCase(),
        ContactName:    input.recipient.name.slice(0, 40),
        ContactPhone:   input.recipient.phone.replace(/\D/g, '').slice(-10),
        ContactEmail:   (input.recipient.email || '').slice(0, 100),
      },
      ServiceList: buildServiceList(input),
    };

    log.debug('GLS PrintLabels request', { ref: parcelPayload.ClientReference });

    const res = await fetch(`${GLS_BASE}/PrintLabels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ...baseReq,
        ParcelList:      [parcelPayload],
        TypeOfPrinter:   'A4_2x2',
        PrintPosition:   1,
        ShowPrintDialog: false,
      }),
      cache: 'no-store',
    });

    const raw = await res.text();
    let data: Record<string, unknown>;
    try { data = JSON.parse(raw); } catch {
      throw new Error(`GLS returned invalid JSON: ${raw.slice(0, 200)}`);
    }

    const printErrs = (data?.PrintLabelsErrorList as Array<{ ErrorCode: number; ErrorDescription: string }>) || [];
    if (printErrs.length > 0) {
      throw new Error(printErrs.map((e) => `GLS ${e.ErrorCode}: ${e.ErrorDescription}`).join('; '));
    }

    const info = ((data?.PrintLabelsInfoList as Array<Record<string, unknown>>) ?? [])[0];
    const awb  = (info?.ParcelNumber ?? info?.ParcelId) as string | number | undefined;
    if (!awb) throw new Error(`GLS: AWB not found in response: ${JSON.stringify(data).slice(0, 300)}`);

    const awbStr  = String(awb);
    const country = (input.recipient.country || 'RO').toUpperCase();

    // Extract label PDF (may be base64 string or array)
    let labelBase64: string | null = null;
    const labels = data?.Labels;
    if (Array.isArray(labels) && typeof labels[0] === 'string' && labels[0].length > 100) {
      labelBase64 = labels[0];
    } else if (typeof labels === 'string' && (labels as string).length > 100) {
      labelBase64 = labels as string;
    }

    // Fallback: fetch label separately if PrintLabels didn't include it
    if (!labelBase64) {
      labelBase64 = await fetchGlsLabel(baseReq, awbStr, log);
    }

    const labelPdf    = labelBase64 ? Buffer.from(labelBase64, 'base64') : null;
    const trackingUrl = country === 'HU'
      ? `https://gls-group.eu/HU/hu/csomagkovetes?match=${awbStr}`
      : `https://gls-group.eu/RO/ro/urmarire-colet?match=${awbStr}`;

    log.info('GLS AWB created', { awb: awbStr, hasLabel: !!labelPdf });

    return { trackingNumber: awbStr, trackingUrl, labelPdf, raw: data };
  }
}

async function fetchGlsLabel(
  baseReq: Record<string, unknown>,
  awb: string,
  log: ReturnType<typeof logger.child>,
): Promise<string | null> {
  try {
    const res = await fetch(`${GLS_BASE}/GetPrintedLabels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...baseReq, ParcelNumberList: [awb], TypeOfPrinter: 'A4_2x2', PrintPosition: 1 }),
      cache: 'no-store',
    });
    const data = await res.json();
    const labels = data?.Labels;
    if (Array.isArray(labels) && typeof labels[0] === 'string' && labels[0].length > 100) return labels[0];
    if (typeof labels === 'string' && labels.length > 100) return labels;
    log.warn('GLS GetPrintedLabels returned no label', { keys: Object.keys(data) });
    return null;
  } catch (e) {
    log.warn('GLS GetPrintedLabels failed', { error: (e as Error).message });
    return null;
  }
}

function buildServiceList(input: CreateShipmentInput): Array<Record<string, unknown>> {
  const opts = (input.courierOptions ?? {}) as Record<string, unknown>;
  const services: Array<Record<string, unknown>> = [];
  const phone = input.recipient.phone.replace(/\D/g, '').slice(-10);

  if (opts.SM1) services.push({ Code: 'SM1', SM1Parameter: { Value: `${phone}|Colet GLS #ParcelNr#` } });
  if (opts.SM2) services.push({ Code: 'SM2', SM2Parameter: { Value: phone } });
  if (opts.SAT) services.push({ Code: 'SAT' });
  if (opts.T12) services.push({ Code: 'T12' });
  if (opts.AOS) services.push({ Code: 'AOS', AOSParameter: { Value: input.recipient.name } });
  if (opts.DPV) services.push({ Code: 'DPV' });
  if (opts.SDS) services.push({ Code: 'SDS' });

  return services;
}

// Export singleton
export const glsAdapter = new GlsAdapter();
