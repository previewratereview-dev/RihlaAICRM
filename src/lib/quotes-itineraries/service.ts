import { can } from '../permissions';
import { type PricingLineItemInput } from './pricing';
import {
  ItineraryVersionEntity,
  QuoteLineItem,
  InternalQuoteVersionDTO,
  QuoteVersionStatus,
} from './types';

export interface DomainContext {
  userId: string;
  tenantId: string;
  role: string;
}

export interface StaffSafeQuoteVersionDTO {
  id: string;
  tenantId: string;
  quoteId: string;
  quoteNumber: string;
  versionNumber: number;
  itineraryVersionId: string;
  status: string;
  frozenAt?: string | null;
  currency: string;
  lineItems: Array<Omit<QuoteLineItem, 'supplierCost' | 'markupAmount' | 'marginAmount' | 'marginPct' | 'markupPct'>>;
  quoteSchemaVersion: number;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  grandTotal: string;
  validUntil?: string | null;
  termsAndConditions?: string | null;
  customerNotes?: string | null;
  rejectedAt?: string | null;
  cancelledAt?: string | null;
  supersededAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItineraryParams {
  inquiryId: string;
  title: string;
  destinationSummary?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  durationDays?: number | null;
  passengerCount?: number | null;
  days?: ItineraryVersionEntity['days'];
  inclusions?: string[];
  exclusions?: string[];
}

export interface UpdateItineraryDraftParams {
  versionId: string;
  expectedUpdatedAt?: string;
  title?: string;
  destinationSummary?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  durationDays?: number | null;
  passengerCount?: number | null;
  days?: ItineraryVersionEntity['days'];
  inclusions?: string[];
  exclusions?: string[];
}

export interface CreateQuoteDraftParams {
  inquiryId: string;
  itineraryVersionId: string;
  currency?: string;
  lineItems: PricingLineItemInput[];
  discountAmount?: string;
  taxAmount?: string;
  validUntil?: string | null;
  termsAndConditions?: string | null;
  customerNotes?: string | null;
}

export interface UpdateQuoteDraftParams {
  versionId: string;
  expectedUpdatedAt?: string;
  itineraryVersionId?: string;
  currency?: string;
  lineItems: PricingLineItemInput[];
  discountAmount?: string;
  taxAmount?: string;
  validUntil?: string | null;
  termsAndConditions?: string | null;
  customerNotes?: string | null;
}

/**
 * Shape quote version output depending on caller permissions.
 * Admins/Managers receive InternalQuoteVersionDTO (with costs and margins).
 * Consultants/Specialists receive StaffSafeQuoteVersionDTO (zero cost/margin fields).
 */
export function shapeQuoteVersionDTO(
  quoteRow: {
    id: string;
    tenant_id: string;
    quote_id: string;
    quote_number?: string;
    version_number: number;
    itinerary_version_id: string;
    status: string;
    frozen_at?: string | null;
    currency: string;
    line_items: QuoteLineItem[];
    quote_schema_version: number;
    subtotal: string | number;
    discount_amount: string | number;
    tax_amount: string | number;
    grand_total: string | number;
    internal_cost_total?: string | number | null;
    gross_margin_amount?: string | number | null;
    valid_until?: string | null;
    terms_and_conditions?: string | null;
    customer_notes?: string | null;
    rejected_at?: string | null;
    cancelled_at?: string | null;
    superseded_at?: string | null;
    created_by?: string | null;
    created_at: string;
    updated_at: string;
  },
  role: string
): InternalQuoteVersionDTO | StaffSafeQuoteVersionDTO {
  const hasInternalPricing = can(role, 'quotes:internal_pricing:read');

  if (hasInternalPricing) {
    return {
      id: quoteRow.id,
      tenantId: quoteRow.tenant_id,
      quoteId: quoteRow.quote_id,
      quoteNumber: quoteRow.quote_number || '',
      versionNumber: quoteRow.version_number,
      itineraryVersionId: quoteRow.itinerary_version_id,
      status: quoteRow.status as QuoteVersionStatus,
      frozenAt: quoteRow.frozen_at,
      currency: quoteRow.currency,
      lineItems: quoteRow.line_items,
      quoteSchemaVersion: quoteRow.quote_schema_version,
      subtotal: String(quoteRow.subtotal),
      discountAmount: String(quoteRow.discount_amount),
      taxAmount: String(quoteRow.tax_amount),
      grandTotal: String(quoteRow.grand_total),
      internalCostTotal: quoteRow.internal_cost_total != null ? String(quoteRow.internal_cost_total) : null,
      grossMarginAmount: quoteRow.gross_margin_amount != null ? String(quoteRow.gross_margin_amount) : null,
      validUntil: quoteRow.valid_until,
      termsAndConditions: quoteRow.terms_and_conditions,
      customerNotes: quoteRow.customer_notes,
      rejectedAt: quoteRow.rejected_at,
      cancelledAt: quoteRow.cancelled_at,
      supersededAt: quoteRow.superseded_at,
      createdBy: quoteRow.created_by,
      createdAt: quoteRow.created_at,
      updatedAt: quoteRow.updated_at,
    };
  }

  // Omit supplier cost, margins, and markups for unauthorized roles
  const safeLineItems = (quoteRow.line_items || []).map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalPrice: item.totalPrice,
    supplierName: item.supplierName,
  }));

  return {
    id: quoteRow.id,
    tenantId: quoteRow.tenant_id,
    quoteId: quoteRow.quote_id,
    quoteNumber: quoteRow.quote_number || '',
    versionNumber: quoteRow.version_number,
    itineraryVersionId: quoteRow.itinerary_version_id,
    status: quoteRow.status,
    frozenAt: quoteRow.frozen_at,
    currency: quoteRow.currency,
    lineItems: safeLineItems,
    quoteSchemaVersion: quoteRow.quote_schema_version,
    subtotal: String(quoteRow.subtotal),
    discountAmount: String(quoteRow.discount_amount),
    taxAmount: String(quoteRow.tax_amount),
    grandTotal: String(quoteRow.grand_total),
    validUntil: quoteRow.valid_until,
    termsAndConditions: quoteRow.terms_and_conditions,
    customerNotes: quoteRow.customer_notes,
    rejectedAt: quoteRow.rejected_at,
    cancelledAt: quoteRow.cancelled_at,
    supersededAt: quoteRow.superseded_at,
    createdBy: quoteRow.created_by,
    createdAt: quoteRow.created_at,
    updatedAt: quoteRow.updated_at,
  };
}

/**
 * Validate and prepare quote pricing inputs based on caller authorization.
 * If caller lacks quotes:internal_pricing:read, any user-submitted supplierCost is ignored,
 * and existing supplierCost is preserved from current draft if line ID matches.
 */
export function preparePricingInputForRole(
  inputItems: PricingLineItemInput[],
  existingDraftItems: QuoteLineItem[] | null,
  role: string
): PricingLineItemInput[] {
  const hasInternalPricing = can(role, 'quotes:internal_pricing:read');

  if (hasInternalPricing) {
    return inputItems;
  }

  // Create lookup for existing supplier costs by stable line ID
  const existingCostMap = new Map<string, string | null>();
  if (existingDraftItems) {
    for (const item of existingDraftItems) {
      if (item.id && item.supplierCost) {
        existingCostMap.set(item.id, item.supplierCost);
      }
    }
  }

  return inputItems.map((item) => {
    // Preserve server-side supplier cost if existing item ID matches; otherwise null
    const preservedCost = item.id ? existingCostMap.get(item.id) || null : null;
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      category: item.category,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      supplierCost: preservedCost,
      supplierName: item.supplierName,
    };
  });
}
