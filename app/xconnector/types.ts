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
}

export interface OrdersResponse {
  orders:   EnrichedOrder[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/* Per-row local action state (not in DB, just in React state) */
export interface RowActionState {
  invoiceLoading:  boolean;
  shipmentLoading: boolean;
  error:           string | null;
}

export type CourierName = 'gls' | 'sameday';
