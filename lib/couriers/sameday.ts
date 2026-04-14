/**
 * lib/couriers/sameday.ts — Sameday courier adapter
 *
 * Wraps Sameday REST API with token caching and automatic pickup-point discovery.
 * Token TTL is ~1 hour at Sameday; we refresh at 50 minutes.
 */

import { logger } from '@/lib/logger';
import type {
  CourierAdapter,
  CreateShipmentInput,
  CreateShipmentResult,
} from './types';

const SD_BASE = 'https://api.sameday.ro';

// ─── Token cache (in-process) ────────────────────────────────────────────────

interface TokenCache {
  token: string;
  user:  string;
  ts:    number;  // ms timestamp
}
let _tokenCache: TokenCache | null = null;

async function sdAuth(user: string, pass: string): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.user === user && now - _tokenCache.ts < 50 * 60 * 1000) {
    return _tokenCache.token;
  }

  const res = await fetch(`${SD_BASE}/api/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AUTH-TOKEN': '' },
    body: JSON.stringify({ username: user, password: pass }),
    cache: 'no-store',
  });

  const text = await res.text();
  let data: Record<string, unknown>;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Sameday auth invalid response (${res.status}): ${text.slice(0, 100)}`);
  }

  if (!res.ok) {
    throw new Error(
      (data.message ?? data.error ?? `Sameday auth ${res.status}`) as string,
    );
  }

  const token = (data.token ?? data.Token) as string;
  if (!token) throw new Error('Sameday auth: token missing from response');

  _tokenCache = { token, user, ts: now };
  return token;
}

async function sdGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${SD_BASE}${path}`, {
    headers: { 'X-AUTH-TOKEN': token, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Sameday GET ${path} (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Config resolution ────────────────────────────────────────────────────────

interface SamedayConfig {
  username:       string;
  password:       string;
  pickupPointId?: number;
  serviceId?:     number;
}

function loadConfig(): SamedayConfig {
  return {
    username:       process.env.SAMEDAY_USERNAME         || '',
    password:       process.env.SAMEDAY_PASSWORD         || '',
    pickupPointId:  process.env.SAMEDAY_PICKUP_POINT_ID ? parseInt(process.env.SAMEDAY_PICKUP_POINT_ID) : undefined,
    serviceId:      process.env.SAMEDAY_SERVICE_ID       ? parseInt(process.env.SAMEDAY_SERVICE_ID) : undefined,
  };
}

interface PickupPoint { id: number; name: string }
interface Service     { id: number; name: string; code: string }

function mapPickupPoints(data: unknown): PickupPoint[] {
  const items = ((data as Record<string, unknown>)?.data ?? data) as Array<Record<string, unknown>>;
  return (Array.isArray(items) ? items : [])
    .map((p) => ({ id: p.id as number, name: (p.name ?? p.alias ?? `Pickup #${p.id}`) as string }))
    .filter((p) => p.id);
}

function mapServices(data: unknown): Service[] {
  const items = ((data as Record<string, unknown>)?.data ?? data) as Array<Record<string, unknown>>;
  return (Array.isArray(items) ? items : [])
    .map((s) => ({ id: s.id as number, name: s.name as string, code: s.code as string }))
    .filter((s) => s.id);
}

// ─── Adapter implementation ───────────────────────────────────────────────────

export class SamedayAdapter implements CourierAdapter {
  readonly name = 'sameday';

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const cfg = loadConfig();
    const log = logger.child({ module: 'couriers/sameday', orderName: input.orderName });

    if (!cfg.username || !cfg.password) {
      throw new Error('Sameday credentials not configured (SAMEDAY_USERNAME / SAMEDAY_PASSWORD)');
    }

    const token = await sdAuth(cfg.username, cfg.password);

    // Resolve pickup point
    let ppId = cfg.pickupPointId;
    if (!ppId) {
      const pts = await sdGet<unknown>('/api/client/pickup-points', token);
      ppId = mapPickupPoints(pts)[0]?.id;
      if (!ppId) throw new Error('Sameday: no pickup points configured in account');
    }

    // Resolve service
    let svcId = cfg.serviceId;
    if (!svcId) {
      const svcs = await sdGet<unknown>('/api/client/services', token);
      svcId = mapServices(svcs)[0]?.id;
      if (!svcId) throw new Error('Sameday: no services available in account');
    }

    const opts = (input.courierOptions ?? {}) as Record<string, unknown>;
    const phone = input.recipient.phone.replace(/\D/g, '').slice(-10);

    const awbBody = {
      awbPayment:              input.isCOD ? 1 : 0,
      cashOnDelivery:          input.isCOD ? Math.round(input.totalPrice * 100) / 100 : 0,
      cashOnDeliveryReturns:   0,
      insuredValue:            parseFloat(String(opts.insuredValue ?? 0)),
      packageType:             0,
      packageNumber:           input.parcels || 1,
      packageWeight:           input.weight  || 1,
      observations:            (input.content || `Comanda ${input.orderName}`).slice(0, 255),
      reference:               input.orderName.slice(0, 50),
      recipientName:           input.recipient.name.slice(0, 100),
      recipientPhone:          phone,
      recipientEmail:          (input.recipient.email || '').slice(0, 100),
      recipientAddress:        input.recipient.address.slice(0, 200),
      recipientCity:           input.recipient.city.slice(0, 100),
      recipientCounty:         input.recipient.county.slice(0, 100),
      recipientPostalCode:     (input.recipient.zip || '').replace(/\s/g, '').slice(0, 10),
      pickupPoint:             ppId,
      service_id:              svcId,
      openPackage:             opts.openPackage ? 1 : 0,
      repaymentTransport:      opts.repaymentTransport ? 1 : 0,
      saturday_delivery:       opts.saturdayDelivery ? 1 : 0,
      thermo:                  opts.thermo ? 1 : 0,
      ...(opts.lockerId      ? { locker_id:       parseInt(String(opts.lockerId)) } : {}),
      ...(opts.senderEasyboxId ? { lockerFirstMile: parseInt(String(opts.senderEasyboxId)) } : {}),
    };

    log.debug('Sameday AWB payload', { ref: awbBody.reference });

    const awbRes = await fetch(`${SD_BASE}/api/awb`, {
      method: 'POST',
      headers: {
        'X-AUTH-TOKEN':  token,
        'Content-Type':  'application/json',
        Accept:          'application/json',
      },
      body: JSON.stringify(awbBody),
      cache: 'no-store',
    });

    const rawText = await awbRes.text();
    let data: Record<string, unknown>;
    try { data = JSON.parse(rawText); } catch {
      throw new Error(`Sameday invalid AWB response: ${rawText.slice(0, 200)}`);
    }

    if (!awbRes.ok) {
      const violations = (data.violations as Array<{ message: string }> | undefined)
        ?.map((v) => v.message).join('; ');
      throw new Error(violations || (data.message as string) || `Sameday AWB ${awbRes.status}`);
    }

    const awbNumber = String(
      data.awbNumber ?? data.AWBNumber ?? data.awb ?? (data.data as Record<string, unknown>)?.awbNumber ?? '',
    );
    if (!awbNumber) {
      throw new Error(`Sameday: AWB number missing from response: ${JSON.stringify(data).slice(0, 300)}`);
    }

    // Fetch label PDF from Sameday
    const labelPdf = await this.fetchLabel(token, awbNumber, log);

    const trackingUrl = `https://sameday.ro/#awb=${awbNumber}`;

    log.info('Sameday AWB created', { awb: awbNumber, hasLabel: !!labelPdf });

    return { trackingNumber: awbNumber, trackingUrl, labelPdf, raw: data };
  }

  private async fetchLabel(
    token: string,
    awb: string,
    log: ReturnType<typeof logger.child>,
  ): Promise<Buffer | null> {
    try {
      const res = await fetch(`${SD_BASE}/api/awb/download/${awb}`, {
        headers: { 'X-AUTH-TOKEN': token, Accept: 'application/pdf, */*' },
        cache: 'no-store',
      });
      if (!res.ok) {
        log.warn('Sameday label download failed', { status: res.status });
        return null;
      }
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (e) {
      log.warn('Sameday label download exception', { error: (e as Error).message });
      return null;
    }
  }
}

// Export singleton
export const samedayAdapter = new SamedayAdapter();
