/**
 * Phase AI-5B.1: Itinerary & Quote Domain Types
 * 
 * Strict TypeScript interfaces for the deterministic Itinerary & Quote domain.
 * Pure data representations with zero runtime side-effects.
 */

export const ITINERARY_VERSION_STATUSES = [
  'draft',
  'finalized',
  'superseded',
  'archived',
] as const;

export type ItineraryVersionStatus = (typeof ITINERARY_VERSION_STATUSES)[number];

export const QUOTE_VERSION_STATUSES = [
  'draft',
  'issued',
  'rejected',
  'superseded',
  'cancelled',
] as const;

export type QuoteVersionStatus = (typeof QUOTE_VERSION_STATUSES)[number];

export const ITINERARY_ITEM_TYPES = [
  'activity',
  'hotel',
  'flight',
  'transfer',
  'meal',
  'other',
] as const;

export type ItineraryItemType = (typeof ITINERARY_ITEM_TYPES)[number];

export const QUOTE_LINE_CATEGORIES = [
  'accommodation',
  'flight',
  'activity',
  'transfer',
  'visa',
  'fee',
  'other',
] as const;

export type QuoteLineCategory = (typeof QUOTE_LINE_CATEGORIES)[number];

export const ACCEPTANCE_TYPES = [
  'traveler_portal',
  'staff_recorded',
] as const;

export type AcceptanceType = (typeof ACCEPTANCE_TYPES)[number];

/**
 * Single schedule/activity item inside an itinerary day plan.
 */
export interface ItineraryItem {
  id: string;
  itemType: ItineraryItemType;
  title: string;
  description?: string | null;
  location?: string | null;
  startTime?: string | null; // e.g. "09:00"
  endTime?: string | null;   // e.g. "12:30"
  supplierName?: string | null; // Staff reference (stripped in public DTO if internal)
  internalNotes?: string | null; // Staff only (stripped in public DTO)
}

/**
 * Single day in a structured travel program.
 */
export interface ItineraryDay {
  dayNumber: number; // Monotonic 1, 2, 3...
  date?: string | null; // YYYY-MM-DD
  title: string;
  summary?: string | null;
  items: ItineraryItem[];
}

/**
 * Core Itinerary Aggregate Header.
 */
export interface ItineraryHeader {
  id: string;
  tenantId: string;
  inquiryId: string;
  title: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

/**
 * Versioned spatial-temporal travel plan.
 */
export interface ItineraryVersionEntity {
  id: string;
  tenantId: string;
  itineraryId: string;
  versionNumber: number;
  lockVersion: number;
  status: ItineraryVersionStatus;
  frozenAt?: string | null;
  title: string;
  destinationSummary?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  durationDays?: number | null;
  passengerCount?: number | null;
  days: ItineraryDay[];
  inclusions: string[];
  exclusions: string[];
  itinerarySchemaVersion: number; // 1
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Editable Line Item Input (Raw inputs before server calculation).
 * Money values MUST be formatted as valid decimal strings.
 */
export interface QuoteLineItemInput {
  id?: string;
  title: string;
  description?: string | null;
  category: QuoteLineCategory;
  quantity: number; // Positive integer
  unitPrice: string; // Decimal string e.g. "25000.00"
  supplierCost?: string | null; // Decimal string e.g. "18000.00"
  supplierName?: string | null;
}

/**
 * Server-calculated line item with authoritative amounts.
 */
export interface QuoteLineItem {
  id: string;
  title: string;
  description?: string | null;
  category: QuoteLineCategory;
  quantity: number;
  unitPrice: string; // Decimal string
  totalPrice: string; // Server calculated: qty * unitPrice
  supplierCost?: string | null;
  supplierName?: string | null;
  markupAmount?: string | null;
  marginAmount?: string | null;
  marginPct?: number | null;
  markupPct?: number | null;
}

/**
 * Core Quote Aggregate Header.
 */
export interface QuoteHeader {
  id: string;
  tenantId: string;
  inquiryId: string;
  quoteNumber: string; // e.g. "QT-2026-0001"
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

/**
 * Internal Quote Version DTO (Staff-visible; contains supplier costs and margins).
 */
export interface InternalQuoteVersionDTO {
  id: string;
  tenantId: string;
  quoteId: string;
  quoteNumber: string;
  versionNumber: number;
  lockVersion: number;
  itineraryVersionId: string;
  status: QuoteVersionStatus;
  frozenAt?: string | null;
  currency: string;
  lineItems: QuoteLineItem[];
  quoteSchemaVersion: number; // 1
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  grandTotal: string;
  internalCostTotal?: string | null;
  grossMarginAmount?: string | null;
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

/**
 * Sales-Safe Quote Version DTO (Consultant/Specialist view; supplier costs and margins omitted).
 */
export interface StaffSafeQuoteVersionDTO {
  id: string;
  tenantId: string;
  quoteId: string;
  quoteNumber: string;
  versionNumber: number;
  lockVersion: number;
  itineraryVersionId: string;
  status: QuoteVersionStatus;
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

/**
 * Customer-Safe Itinerary DTO (Public portal view; zero internal/staff notes).
 */
export interface CustomerItineraryDTO {
  title: string;
  destinationSummary?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  durationDays?: number | null;
  passengerCount?: number | null;
  days: Array<{
    dayNumber: number;
    date?: string | null;
    title: string;
    summary?: string | null;
    items: Array<{
      itemType: ItineraryItemType;
      title: string;
      description?: string | null;
      location?: string | null;
      startTime?: string | null;
      endTime?: string | null;
    }>;
  }>;
  inclusions: string[];
  exclusions: string[];
}

/**
 * Customer-Safe Quote DTO (Public portal view; zero supplier costs, margins, or internal notes).
 */
export interface CustomerQuoteDTO {
  quoteNumber: string;
  versionNumber: number;
  currency: string;
  lineItems: Array<{
    title: string;
    description?: string | null;
    category: QuoteLineCategory;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
  }>;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  grandTotal: string;
  validUntil?: string | null;
  termsAndConditions?: string | null;
  customerNotes?: string | null;
  itinerary: CustomerItineraryDTO;
  isAcceptable: boolean; // Computed: issued + not expired + no competing acceptance
}

/**
 * Authoritative Quote Acceptance DTO.
 */
export interface QuoteAcceptanceDTO {
  id: string;
  tenantId: string;
  inquiryId: string;
  quoteId: string;
  quoteVersionId: string;
  itineraryVersionId: string;
  travelerId: string;
  acceptanceType: AcceptanceType;
  acceptedByUserId?: string | null;
  quoteShareId?: string | null;
  travelerNameInput?: string | null;
  travelerEmailInput?: string | null;
  acceptedGrandTotal: string;
  currency: string;
  customerSafeSnapshot: CustomerQuoteDTO;
  snapshotSchemaVersion: number; // 1
  acceptedSnapshotHash: string; // SHA-256
  acceptedAt: string;
  clientIp?: string | null;
  userAgent?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  createdAt: string;
}

/**
 * Public Share Capability Record.
 */
export interface ShareCapability {
  id: string;
  tenantId: string;
  resourceType: 'itinerary' | 'quote';
  versionId: string;
  tokenHash: string;
  createdBy?: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
}
