/**
 * lib/services/shipment-service.ts
 *
 * Orchestrates the full AWB creation flow for one order:
 *  1. Idempotency check (skip if AWB already exists for this courier)
 *  2. Validate recipient address
 *  3. Select courier adapter (GLS / Sameday)
 *  4. Call courier API → get tracking number + label PDF
 *  5. Store label PDF (S3 or DB)
 *  6. Persist Shipment row in DB
 *  7. Create Shopify fulfillment with tracking info
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { glsAdapter } from '@/lib/couriers/gls';
import { samedayAdapter } from '@/lib/couriers/sameday';
import type { CourierAdapter } from '@/lib/couriers/types';
import { storePdf, isDbKey } from '@/lib/storage/s3';
import { buildShippingLabelUrl } from '@/lib/security/tokens';
import { createFulfillment, addTimelineEvent } from '@/lib/shopify/fulfillment';
import type { Order, Shipment } from '@prisma/client';

// ─── Courier registry ─────────────────────────────────────────────────────────
// Add new couriers here without touching any other file.
const COURIERS: Record<string, CourierAdapter> = {
  gls:     glsAdapter,
  sameday: samedayAdapter,
};

export function getCourierAdapter(name: string): CourierAdapter {
  const adapter = COURIERS[name.toLowerCase()];
  if (!adapter) {
    throw new Error(`Unknown courier: "${name}". Available: ${Object.keys(COURIERS).join(', ')}`);
  }
  return adapter;
}

export interface ShipmentServiceResult {
  shipment:       Shipment;
  labelUrl:       string;
  shopifyUpdated: boolean;
}

/**
 * Create an AWB for the given Order row.
 * Idempotent: returns existing shipment if already created.
 *
 * @param courierName  - "gls" | "sameday"
 * @param courierOptions - extra options passed to the courier adapter
 */
export async function ensureShipment(
  order: Order,
  shopifyAccessToken: string,
  shopifyDomain: string,
  courierName: string = process.env.DEFAULT_COURIER || 'gls',
  courierOptions: Record<string, unknown> = {},
): Promise<ShipmentServiceResult> {
  const log = logger.child({
    module: 'shipment-service',
    orderId: order.id,
    orderName: order.shopifyName,
    courier: courierName,
  });

  // ── Idempotency ───────────────────────────────────────────────────────────
  const existing = await db.shipment.findFirst({
    where: {
      orderId: order.id,
      courier: courierName,
      status:  { in: ['CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
    },
  });
  if (existing) {
    log.info('Shipment already exists — skipping', { shipmentId: existing.id });
    return {
      shipment:       existing,
      labelUrl:       buildShippingLabelUrl(existing.id),
      shopifyUpdated: existing.shopifyUpdated,
    };
  }

  // ── Resolve adapter ────────────────────────────────────────────────────────
  const adapter = getCourierAdapter(courierName);

  // ── Build recipient from Order ────────────────────────────────────────────
  const recipient = {
    name:    order.customerName,
    phone:   order.customerPhone,
    email:   order.customerEmail || undefined,
    address: order.shippingAddress1,
    city:    order.shippingCity,
    county:  order.shippingProvince,
    zip:     order.shippingZip,
    country: order.shippingCountry || 'RO',
  };

  // Basic address sanity check before hitting the courier API
  validateRecipientAddress(recipient, order.shopifyName);

  log.info('Creating AWB', { courier: courierName, recipient: recipient.name });

  // ── Call courier API ───────────────────────────────────────────────────────
  const shipResult = await adapter.createShipment({
    orderId:       order.id,
    orderName:     order.shopifyName,
    totalPrice:    Number(order.totalPrice),
    currency:      order.currency,
    isCOD:         !order.isPaid,
    recipient,
    weight:        Number(courierOptions.weight ?? 0.5),
    parcels:       Number(courierOptions.parcels ?? 1),
    content:       String(courierOptions.content ?? order.shopifyName),
    courierOptions,
  });

  // ── Create Shipment row ───────────────────────────────────────────────────
  const shipment = await db.shipment.create({
    data: {
      orderId:        order.id,
      shopId:         order.shopId,
      courier:        courierName,
      trackingNumber: shipResult.trackingNumber,
      trackingUrl:    shipResult.trackingUrl,
      status:         'CREATED',
      weight:         Number(courierOptions.weight ?? 0.5),
      parcels:        Number(courierOptions.parcels ?? 1),
      codAmount:      !order.isPaid ? Number(order.totalPrice) : null,
    },
  });

  // ── Store label PDF ────────────────────────────────────────────────────────
  if (shipResult.labelPdf) {
    const stored = await storePdf(shipResult.labelPdf, 'labels', shipment.id);
    const pdfData = isDbKey(stored.key) ? shipResult.labelPdf : undefined;
    await db.shipment.update({
      where: { id: shipment.id },
      data:  { labelStorageKey: stored.key, labelData: pdfData ?? undefined },
    });
  } else {
    log.warn('Courier did not return label PDF', { awb: shipResult.trackingNumber });
  }

  // ── Build signed label URL ─────────────────────────────────────────────────
  const labelUrl = buildShippingLabelUrl(shipment.id);

  // ── Create Shopify fulfillment ────────────────────────────────────────────
  let shopifyUpdated = false;
  try {
    const orderGid = order.shopifyGid ?? `gid://shopify/Order/${order.shopifyId}`;
    const fulfillResult = await createFulfillment(
      { domain: shopifyDomain, accessToken: shopifyAccessToken },
      {
        orderGid,
        trackingNumber:  shipResult.trackingNumber,
        trackingUrl:     labelUrl,   // link to OUR endpoint (signed URL)
        trackingCompany: courierName === 'gls' ? 'GLS' : 'Sameday',
        notifyCustomer:  Boolean(courierOptions.notifyCustomer),
      },
    );

    if (fulfillResult.fulfillmentId) {
      await db.shipment.update({
        where: { id: shipment.id },
        data:  { fulfillmentId: fulfillResult.fulfillmentId, shopifyUpdated: true },
      });
    }

    await addTimelineEvent(
      { domain: shopifyDomain, accessToken: shopifyAccessToken },
      orderGid,
      `📦 AWB ${courierName.toUpperCase()} ${shipResult.trackingNumber} generat. ` +
      `[Etichetă](${labelUrl}) | [Tracking](${shipResult.trackingUrl})`,
    );

    shopifyUpdated = true;
  } catch (err) {
    log.warn('Shopify fulfillment creation failed (non-fatal)', { error: (err as Error).message });
  }

  // ── Update Order status ────────────────────────────────────────────────────
  await db.order.update({
    where: { id: order.id },
    data:  {
      shipmentCreated: true,
      fulfilled:       shopifyUpdated,
      status:          shopifyUpdated ? 'FULFILLED' : 'SHIPMENT_CREATED',
    },
  });

  const updatedShipment = await db.shipment.findUniqueOrThrow({ where: { id: shipment.id } });

  log.info('Shipment flow complete', {
    shipmentId: shipment.id,
    awb:        shipResult.trackingNumber,
    shopifyUpdated,
  });

  return { shipment: updatedShipment, labelUrl, shopifyUpdated };
}

// ─── Address validation ───────────────────────────────────────────────────────

function validateRecipientAddress(
  recipient: { name: string; phone: string; address: string; city: string; zip: string },
  orderName: string,
): void {
  const errors: string[] = [];

  if (!recipient.name || recipient.name.trim().length < 2) {
    errors.push('numele destinatarului lipsește');
  }
  const phoneDigits = (recipient.phone || '').replace(/\D/g, '');
  if (phoneDigits.length < 6) {
    errors.push(`telefon invalid: "${recipient.phone}" (minim 6 cifre)`);
  }
  if (!recipient.address || recipient.address.trim().length < 3) {
    errors.push('adresa de livrare lipsește');
  }
  if (!recipient.city || recipient.city.trim().length < 2) {
    errors.push('orașul lipsește');
  }
  const zipDigits = (recipient.zip || '').replace(/\D/g, '');
  if (zipDigits.length < 4) {
    errors.push(`cod poștal invalid: "${recipient.zip}" (minim 4 cifre)`);
  }

  if (errors.length > 0) {
    throw new Error(`Comanda ${orderName}: ${errors.join('; ')}`);
  }
}
