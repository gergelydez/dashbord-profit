/**
 * lib/couriers/types.ts — Courier adapter interface
 *
 * Every courier (GLS, Sameday, DPD, FAN, etc.) must implement CourierAdapter.
 * This makes the system pluggable: adding a new courier = implementing one interface.
 */

// ─── Address ──────────────────────────────────────────────────────────────────

export interface CourierAddress {
  name:    string;
  phone:   string;
  email?:  string;
  address: string;  // full street + number
  city:    string;
  county:  string;  // Romanian judet
  zip:     string;  // 6-digit Romanian postal code
  country: string;  // default "RO"
}

// ─── Shipment request ─────────────────────────────────────────────────────────

export interface CreateShipmentInput {
  /** Our internal Order UUID */
  orderId:       string;
  /** Shopify order name e.g. "#1042" */
  orderName:     string;
  /** Total order value (used for COD amount) */
  totalPrice:    number;
  currency:      string;
  /** Is the order cash-on-delivery? */
  isCOD:         boolean;
  /** Recipient details */
  recipient:     CourierAddress;
  /** Parcel weight in kg */
  weight:        number;
  /** Number of parcels */
  parcels:       number;
  /** Parcel contents description */
  content?:      string;
  /** Courier-specific extra options (passed straight through) */
  courierOptions?: Record<string, unknown>;
}

// ─── Shipment result ──────────────────────────────────────────────────────────

export interface CreateShipmentResult {
  /** AWB tracking number */
  trackingNumber: string;
  /** Full carrier tracking URL */
  trackingUrl:    string;
  /** PDF bytes of the shipping label (may be null if not returned by the API) */
  labelPdf:       Buffer | null;
  /** Raw API response (for debugging) */
  raw:            unknown;
}

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface CourierAdapter {
  /** Courier identifier used in DB: "gls" | "sameday" */
  readonly name: string;

  /**
   * Create a shipment and return tracking number + label PDF.
   * MUST be idempotent: if called twice for the same order, return the same AWB.
   */
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
}

// ─── Address validation result ────────────────────────────────────────────────

export interface AddressValidationResult {
  valid:       boolean;
  issues:      Array<{ field: string; severity: 'error' | 'warning'; msg: string }>;
  suggestion?: {
    zip?:    string;
    city?:   string;
    county?: string;
  };
}
