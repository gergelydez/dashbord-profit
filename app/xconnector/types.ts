export interface OrderInvoice {
  id:          string;
  series:      string;
  number:      string;
  status:      string;
  url:         string;
}

export interface OrderShipment {
  id:          string;
  courier:     string;
  tracking:    string;
  trackingUrl: string | null;
  labelUrl:    string;
  status:      string;
}

export interface LineItem {
  name:     string;
  quantity: number;
  price:    number;
  sku:      string;
}

export type ProcessingStatus = 'pending' | 'processing' | 'partial' | 'fulfilled' | 'failed' | 'cancelled';

/** Flat key→value map from Shopify note_attributes */
export type NoteAttributes = Record<string, string>;

export interface EnrichedOrder {
  id:        string;   // Shopify numeric ID
  gid:       string;   // Shopify GID
  dbId:      string | null;
  name:      string;
  createdAt: string;
  cancelled: boolean;
  customer: { name: string; email: string; phone: string };
  address:  { address1: string; address2: string; city: string; province: string; zip: string };
  lineItems: LineItem[];
  totalPrice:        number;
  currency:          string;
  financialStatus:   string;
  fulfillmentStatus: string | null;
  invoice:   OrderInvoice  | null;
  shipment:  OrderShipment | null;
  processingStatus: ProcessingStatus;
  processingError:  string | null;
  /** Raw Shopify note_attributes as key→value map (includes xconnector-invoice-url etc.) */
  noteAttributes: NoteAttributes;
}

export interface OrdersResponse {
  orders:   EnrichedOrder[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor:   string | null;
    hasPrevPage: boolean;
    prevCursor:  string | null;
  };
}

/* Per-row local action state (not in DB, just in React state) */
export interface RowActionState {
  invoiceLoading:  boolean;
  shipmentLoading: boolean;
  error:           string | null;
}

export type CourierName = 'gls' | 'sameday';

/* ─── AWB Wizard ──────────────────────────────────────────────────────────── */

export interface AwbWizardData {
  /** Step 1 — Client */
  recipientName:    string;
  recipientPhone:   string;
  recipientEmail:   string;
  recipientAddress: string;
  recipientCity:    string;
  recipientCounty:  string;
  recipientZip:     string;
  /** Step 2 — Parcel */
  productName:      string;   // printed on AWB content field
  weight:           number;   // kg
  parcels:          number;
  isCOD:            boolean;
  codAmount:        number;
  /** Step 3 — Options */
  courier:          CourierName;
  notifyCustomer:   boolean;
  observations:     string;   // extra notes for courier
  /** GLS Services */
  glsFDS:           boolean;  // Flex Delivery Service (email)
  glsSM1:           boolean;  // SMS notificare cu tracking
  glsSM2:           boolean;  // SMS notificare simplu
  glsAOS:           boolean;  // Livrare doar la destinatar
  glsSAT:           boolean;  // Livrare sambata
  glsT12:           boolean;  // Livrare pana la 12:00
}
