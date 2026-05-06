/**
 * lib/couriers/gls.ts — GLS Romania courier adapter
 *
 * FIXES applied vs original:
 *  1. PickupDate uses /Date(timestamp)/ format (NOT ISO string)
 *  2. extractLabels handles both int[] byte arrays AND base64 strings
 *  3. GetPrintedLabels uses ParcelIdList (integer IDs), NOT ParcelNumberList
 *  4. GetParcelList date params use /Date(timestamp)/ format
 */

import { logger } from '@/lib/logger';
import type {
  CourierAdapter,
  CreateShipmentInput,
  CreateShipmentResult,
} from './types';

const GLS_BASE = 'https://api.mygls.ro/ParcelService.svc/json';

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

/** FIX: GLS API requires /Date(milliseconds)/ format */
function glsDate(date: Date): string {
  return `/Date(${date.getTime()})/`;
}

/**
 * FIX: GLS API returns Labels as either:
 *  - list[int] (raw byte array) — confirmed by mygls-python library
 *  - base64 string — some GLS API versions
 * We handle both cases.
 */
function extractLabelsAsBase64(data: Record<string, unknown>): string | null {
  const labels = data?.Labels;

  // Case 1: int[] byte array (per mygls-python: Labels: Optional[list[int]])
  if (Array.isArray(labels)) {
    if (labels.length === 0) return null;
    if (typeof labels[0] === 'number') {
      const buf = Buffer.from(labels as number[]);
      logger.debug('[GLS] Labels is int[] byte array → converted to base64', { bytes: buf.length });
      return buf.toString('base64');
    }
    // Array of base64 strings
    if (typeof labels[0] === 'string' && (labels[0] as string).length > 50) {
      return labels[0] as string;
    }
    return null;
  }

  // Case 2: base64 string
  if (typeof labels === 'string' && labels.length > 100) {
    return labels;
  }

  // Case 3: Pdfdocument field
  const pdfdoc = data?.Pdfdocument;
  if (typeof pdfdoc === 'string' && pdfdoc.length > 100) {
    return pdfdoc;
  }

  return null;
}

let _pickupCache: GlsConfig['pickup'] | null = null;

async function resolvePickup(
  cfg: GlsConfig,
  baseReq: Record<string, unknown>,
): Promise<GlsConfig['pickup']> {
  if (cfg.pickup.name && cfg.pickup.city && cfg.pickup.zip) {
    return cfg.pickup;
  }
  if (_pickupCache) return _pickupCache;

  const now  = new Date();
  const from = new Date(now.getTime() - 30 * 86400 * 1000);
  try {
    const res = await fetch(`${GLS_BASE}/GetParcelList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseReq,
        // FIX: /Date(timestamp)/ format
        PickupDateFrom: glsDate(from),
        PickupDateTo:   glsDate(now),
      }),
      cache: 'no-store',
    });
    const data = await res.json();
    const list = (data?.PrintDataInfoList ?? data?.ParcelList ?? []) as Array<Record<string, unknown>>;
    for (const p of list) {
      const pa = (p.Parcel as Record<string, unknown>)?.PickupAddress ?? p.PickupAddress;
      if (pa && (pa as Record<string, unknown>).Name && (pa as Record<string, unknown>).City) {
        const addr = pa as Record<string, unknown>;
        _pickupCache = {
          name:   String(addr.Name  || ''),
          street: String(addr.Street || ''),
          city:   String(addr.City  || ''),
          zip:    cleanZip(String(addr.ZipCode || '')),
          county: String(addr.CountyName || ''),
          phone:  String(addr.ContactPhone || '').replace(/\D/g, '').slice(-10),
        };
        return _pickupCache;
      }
    }
  } catch (e) {
    logger.warn('[GLS] pickup auto-discovery failed', { error: (e as Error).message });
  }

  throw new Error(
    'GLS pickup address missing. Setează în .env: GLS_PICKUP_NAME, GLS_PICKUP_STREET, ' +
    'GLS_PICKUP_CITY, GLS_PICKUP_ZIP, GLS_PICKUP_COUNTY, GLS_PICKUP_PHONE',
  );
}

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

    const missingPickup: string[] = [];
    if (!pickup.name)   missingPickup.push('GLS_PICKUP_NAME');
    if (!pickup.city)   missingPickup.push('GLS_PICKUP_CITY');
    if (!pickup.zip)    missingPickup.push('GLS_PICKUP_ZIP');
    if (!pickup.street) missingPickup.push('GLS_PICKUP_STREET');
    if (missingPickup.length > 0) {
      throw new Error(
        `GLS: adresa de pickup incompletă — setează în .env: ${missingPickup.join(', ')}.`
      );
    }

    const { street: pStreet, houseNum: pHouseNum } = parseStreet(pickup.street);
    const { street: dStreet, houseNum: dHouseNum } = parseStreet(input.recipient.address);
    const zipCleaned = cleanZip(input.recipient.zip);

    if (!zipCleaned || zipCleaned.length < 4 || zipCleaned.length > 9) {
      throw new Error(`GLS: cod poștal invalid "${input.recipient.zip}" — trebuie 6 cifre`);
    }

    const parcelPayload = {
      ClientNumber:    parseInt(cfg.clientNumber),
      ClientReference: input.orderName.slice(0, 40),
      Count:           input.parcels || 1,
      CODAmount:       input.isCOD ? input.totalPrice : 0,
      CODReference:    input.isCOD ? input.orderName.slice(0, 40) : '',
      CODCurrency:     input.isCOD ? (input.currency || 'RON') : undefined,
      Content:         (input.content || input.orderName || 'Colet').slice(0, 40),
      // FIX: /Date(timestamp)/ format — NOT ISO string
      PickupDate:      glsDate(new Date()),
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

    const infoList = (data?.PrintLabelsInfoList as Array<Record<string, unknown>>) ?? [];
    const info     = infoList[0];
    const awbNum   = info?.ParcelNumber;
    const parcelId = info?.ParcelId;

    if (!awbNum && !parcelId) {
      throw new Error(`GLS: AWB not found in response: ${JSON.stringify(data).slice(0, 300)}`);
    }

    const awbStr = String(awbNum || parcelId);
    log.info('GLS AWB created', { awb: awbStr, parcelId });

    // FIX: Use corrected extraction (handles int[] byte arrays)
    let labelBase64 = extractLabelsAsBase64(data);
    log.debug('Label from PrintLabels', { found: !!labelBase64 });

    // FIX: Fetch separately using ParcelId (integer) via GetPrintedLabels
    if (!labelBase64 && parcelId) {
      labelBase64 = await fetchGlsLabelByParcelId(baseReq, Number(parcelId), log);
      log.debug('Label from GetPrintedLabels', { found: !!labelBase64 });
    }

    if (!labelBase64) {
      log.warn('GLS: no label PDF available after all attempts', { awb: awbStr });
    }

    const labelPdf    = labelBase64 ? Buffer.from(labelBase64, 'base64') : null;
    const country     = (input.recipient.country || 'RO').toUpperCase();
    const trackingUrl = country === 'HU'
      ? `https://gls-group.eu/HU/hu/csomagkovetes?match=${awbStr}`
      : `https://gls-group.eu/RO/ro/urmarire-colet?match=${awbStr}`;

    return { trackingNumber: awbStr, trackingUrl, labelPdf, raw: data };
  }
}

/**
 * FIX: Use ParcelIdList with integer ParcelId (NOT ParcelNumberList with AWB string).
 * Per mygls-python: parcel_ids = [label.ParcelId for label in label_info.ParcelInfoList]
 * Per GLS API docs: GetPrintedLabels takes ParcelIdList: list[int]
 */
async function fetchGlsLabelByParcelId(
  baseReq: Record<string, unknown>,
  parcelId: number,
  log: ReturnType<typeof logger.child>,
): Promise<string | null> {
  try {
    const res = await fetch(`${GLS_BASE}/GetPrintedLabels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ...baseReq,
        ParcelIdList: [parcelId],   // integer ID, NOT string AWB
        TypeOfPrinter: 'A4_2x2',
        PrintPosition: 1,
        ShowPrintDialog: false,
      }),
      cache: 'no-store',
    });
    const data = await res.json() as Record<string, unknown>;
    const errs = (data?.GetPrintedLabelsErrorList as Array<{ ErrorCode: number; ErrorDescription: string }>) || [];

    if (errs.length > 0) {
      log.warn('GLS GetPrintedLabels errors', { errors: errs });
      // Error 18 = already printed → try GetPrintData
      if (Number(errs[0]?.ErrorCode) === 18) {
        log.debug('Error 18 → trying GetPrintData');
        const printDataRes = await fetch(`${GLS_BASE}/GetPrintData`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            ...baseReq,
            ParcelIdList: [parcelId],
            TypeOfPrinter: 'A4_2x2',
            PrintPosition: 1,
            ShowPrintDialog: false,
          }),
          cache: 'no-store',
        });
        const printData = await printDataRes.json() as Record<string, unknown>;
        return extractLabelsAsBase64(printData);
      }
      return null;
    }

    return extractLabelsAsBase64(data);
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

export const glsAdapter = new GlsAdapter();
