/**
 * lib/shopify/fulfillment.ts — Create Shopify fulfillments and timeline events
 *
 * Flow after AWB is created:
 *  1. createFulfillment()  → mark order as fulfilled with tracking number
 *  2. addOrderNote()       → write invoice URL into order note_attributes
 *  3. addTimelineEvent()   → post a note to the order timeline
 */

import { logger } from '@/lib/logger';
import { shopifyGraphQL, updateOrderAttributes, ShopifyClientOptions } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FulfillmentInput {
  /** Shopify order GID: "gid://shopify/Order/123456" */
  orderGid: string;
  /** AWB tracking number */
  trackingNumber: string;
  /** Link to our /api/shipping-label endpoint (signed URL) */
  trackingUrl: string;
  /** "GLS" | "Sameday" */
  trackingCompany: string;
  /** Notify the customer via email? */
  notifyCustomer?: boolean;
}

export interface FulfillmentResult {
  fulfillmentId: string;  // GID of the created fulfillment
  status: string;
}

// ─── Fulfillment creation via GraphQL Fulfillment API ────────────────────────

const CREATE_FULFILLMENT_MUTATION = `
  mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
    fulfillmentCreateV2(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
        trackingInfo {
          number
          url
          company
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_FULFILLMENT_ORDER = `
  query getFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      fulfillmentOrders(first: 1) {
        edges {
          node {
            id
            status
          }
        }
      }
    }
  }
`;

/**
 * Create a Shopify fulfillment for the order, attaching AWB tracking info.
 *
 * Uses the Fulfillment API v2 (recommended over legacy REST fulfillments).
 * Handles the case where no unfilfilled line items exist (idempotent).
 */
export async function createFulfillment(
  opts: ShopifyClientOptions,
  input: FulfillmentInput,
): Promise<FulfillmentResult> {
  const log = logger.child({ module: 'shopify/fulfillment', orderGid: input.orderGid });

  // Step 1: get the fulfillment order ID (required by Fulfillment API v2)
  type FOResponse = {
    order: {
      fulfillmentOrders: {
        edges: Array<{ node: { id: string; status: string } }>;
      };
    };
  };

  const foData = await shopifyGraphQL<FOResponse>(opts, GET_FULFILLMENT_ORDER, {
    orderId: input.orderGid,
  });

  const fulfillmentOrders = foData?.order?.fulfillmentOrders?.edges ?? [];
  const openFO = fulfillmentOrders.find(
    (e) => e.node.status !== 'CLOSED' && e.node.status !== 'CANCELLED',
  );

  if (!openFO) {
    log.warn('No open fulfillment order found — order may already be fulfilled');
    return { fulfillmentId: '', status: 'already_fulfilled' };
  }

  // Step 2: create the fulfillment
  type CreateResponse = {
    fulfillmentCreateV2: {
      fulfillment: {
        id: string;
        status: string;
        trackingInfo: Array<{ number: string; url: string; company: string }>;
      } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  };

  const result = await shopifyGraphQL<CreateResponse>(
    opts,
    CREATE_FULFILLMENT_MUTATION,
    {
      fulfillment: {
        lineItemsByFulfillmentOrder: [
          { fulfillmentOrderId: openFO.node.id },
        ],
        trackingInfo: {
          number:  input.trackingNumber,
          url:     input.trackingUrl,
          company: input.trackingCompany,
        },
        notifyCustomer: input.notifyCustomer ?? false,
      },
    },
  );

  const userErrors = result.fulfillmentCreateV2.userErrors;
  if (userErrors.length > 0) {
    const msg = userErrors.map((e) => `${e.field.join('.')}: ${e.message}`).join('; ');
    throw new Error(`Shopify fulfillment errors: ${msg}`);
  }

  const fulfillment = result.fulfillmentCreateV2.fulfillment;
  if (!fulfillment) {
    throw new Error('Shopify did not return a fulfillment object');
  }

  log.info('Fulfillment created', {
    fulfillmentId: fulfillment.id,
    tracking: input.trackingNumber,
  });

  return { fulfillmentId: fulfillment.id, status: fulfillment.status };
}

// ─── Add invoice URL to order ─────────────────────────────────────────────────

/**
 * Write the invoice URL and number back to the Shopify order as note_attributes.
 * Also adds an "invoiced" tag.
 */
export async function addInvoiceToOrder(
  opts: ShopifyClientOptions,
  shopifyOrderId: string | number,
  params: {
    invoiceUrl:    string;  // signed download URL
    invoiceSeries: string;
    invoiceNumber: string;
  },
): Promise<void> {
  await updateOrderAttributes(
    opts,
    shopifyOrderId,
    [
      { name: 'xconnector-invoice-url', value: params.invoiceUrl },
      { name: 'invoice-short-url',      value: params.invoiceUrl },
      { name: 'invoice-number',         value: params.invoiceNumber },
      { name: 'invoice-series',         value: params.invoiceSeries },
    ],
    ['invoiced'],
  );
}

// ─── Order timeline event ─────────────────────────────────────────────────────

const ADD_EVENT_MUTATION = `
  mutation orderCreateEvent($orderId: ID!, $message: String!) {
    orderCreateNote(input: { id: $orderId, note: $message }) {
      order { id }
      userErrors { field message }
    }
  }
`;

/**
 * Post a note to the Shopify order timeline.
 * Non-critical: errors are logged but not thrown.
 */
export async function addTimelineEvent(
  opts: ShopifyClientOptions,
  orderGid: string,
  message: string,
): Promise<void> {
  const log = logger.child({ module: 'shopify/timeline', orderGid });
  try {
    await shopifyGraphQL(opts, ADD_EVENT_MUTATION, {
      orderId: orderGid,
      message,
    });
    log.info('Timeline event added', { message: message.slice(0, 80) });
  } catch (err) {
    // Timeline events are best-effort — don't fail the pipeline
    log.warn('Timeline event failed (non-critical)', { error: (err as Error).message });
  }
}
