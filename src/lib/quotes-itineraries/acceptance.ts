/**
 * Phase AI-5B.4: Commercial Acceptance & Provenance Service
 *
 * Handles:
 * - Deterministic customer-safe AcceptanceSnapshot assembly
 * - Canonical key-sorted JSON serialization & SHA-256 snapshot hashing
 * - Public traveler portal link-holder quote acceptance
 * - Governed staff-recorded manual quote acceptance
 * - Governed quote acceptance voiding with converted-booking protection
 *
 * Invariants:
 * - QuoteAcceptance is the SOLE authority for commercial acceptance.
 * - Customer acceptance is LINK-HOLDER acceptance (not e-signature / cryptographic certificate).
 * - Acceptance snapshot strictly excludes derived portal state (isAcceptable, share metadata)
 *   and internal supplier/pricing/margin data.
 * - Core acceptance facts are immutable once inserted.
 * - An acceptance referenced by a Booking CANNOT be voided.
 */

import { createHash } from 'crypto';
import {
  isValidShareTokenFormat,
  hashShareToken,
  shapeCustomerItineraryDTO,
  shapeCustomerQuoteDTO,
} from './sharing';
import type { CustomerItineraryDTO, CustomerQuoteDTO } from './types';

// ============================================================================
// 1. ACCEPTANCE SNAPSHOT SCHEMA & CANONICAL HASHING
// ============================================================================

export interface AcceptanceSnapshot {
  snapshotSchemaVersion: 1;
  quote: {
    quoteNumber: string;
    versionNumber: number;
    currency: string;
    lineItems: Array<{
      title: string;
      description: string | null;
      category: string;
      quantity: number;
      unitPrice: string;
      totalPrice: string;
    }>;
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    grandTotal: string;
    validUntil: string | null;
    termsAndConditions: string | null;
    customerNotes: string | null;
  };
  itinerary: {
    title: string;
    destinationSummary: string | null;
    startDate: string | null;
    endDate: string | null;
    durationDays: number | null;
    passengerCount: number | null;
    days: Array<{
      dayNumber: number;
      date: string | null;
      title: string;
      summary: string | null;
      items: Array<{
        itemType: string;
        title: string;
        description: string | null;
        location: string | null;
        startTime: string | null;
        endTime: string | null;
      }>;
    }>;
    inclusions: string[];
    exclusions: string[];
  };
}

/**
 * Deterministically canonicalizes a JavaScript object/array/primitive to key-sorted JSON.
 * Ensures consistent SHA-256 hash generation regardless of key insertion order.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const parts = sortedKeys.map(
    (k) => JSON.stringify(k) + ':' + canonicalizeJson(record[k])
  );
  return '{' + parts.join(',') + '}';
}

/**
 * Computes the SHA-256 hexadecimal digest of a canonicalized AcceptanceSnapshot.
 */
export function hashCanonicalSnapshot(snapshot: AcceptanceSnapshot): string {
  const canonicalStr = canonicalizeJson(snapshot);
  return createHash('sha256').update(canonicalStr, 'utf8').digest('hex');
}

/**
 * Constructs an immutable customer-safe AcceptanceSnapshot from raw Quote and Itinerary version records.
 * Explicitly excludes all derived portal state (isAcceptable, share metadata) and internal pricing data.
 */
export function createAcceptanceSnapshot(params: {
  quoteNumber: string;
  versionNumber: number;
  currency: string;
  lineItems: unknown;
  subtotal: string | number;
  discountAmount?: string | number | null;
  taxAmount?: string | number | null;
  grandTotal: string | number;
  validUntil?: string | null;
  termsAndConditions?: string | null;
  customerNotes?: string | null;
  itinerary: {
    title: string;
    destinationSummary?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    durationDays?: number | null;
    passengerCount?: number | null;
    days: unknown;
    inclusions: unknown;
    exclusions: unknown;
  };
}): AcceptanceSnapshot {
  // Shape safe quote DTO (strips supplierCost, supplierName, margins, markups)
  const safeQuote: CustomerQuoteDTO = shapeCustomerQuoteDTO({
    quote_number: params.quoteNumber,
    version_number: params.versionNumber,
    currency: params.currency,
    line_items: params.lineItems,
    subtotal: String(params.subtotal),
    discount_amount: params.discountAmount ? String(params.discountAmount) : '0.00',
    tax_amount: params.taxAmount ? String(params.taxAmount) : '0.00',
    grand_total: String(params.grandTotal),
    valid_until: params.validUntil ?? null,
    terms_and_conditions: params.termsAndConditions ?? null,
    customer_notes: params.customerNotes ?? null,
    is_acceptable: true,
    itinerary: null,
  });

  // Shape safe itinerary DTO (strips supplierName, internalNotes)
  const safeItinerary: CustomerItineraryDTO = shapeCustomerItineraryDTO({
    title: params.itinerary.title,
    destination_summary: params.itinerary.destinationSummary ?? null,
    start_date: params.itinerary.startDate ?? null,
    end_date: params.itinerary.endDate ?? null,
    duration_days: params.itinerary.durationDays ?? null,
    passenger_count: params.itinerary.passengerCount ?? null,
    days: params.itinerary.days,
    inclusions: params.itinerary.inclusions,
    exclusions: params.itinerary.exclusions,
  });

  return {
    snapshotSchemaVersion: 1,
    quote: {
      quoteNumber: safeQuote.quoteNumber,
      versionNumber: safeQuote.versionNumber,
      currency: safeQuote.currency,
      lineItems: safeQuote.lineItems.map((item) => ({
        title: item.title,
        description: item.description ?? null,
        category: item.category,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
      subtotal: safeQuote.subtotal,
      discountAmount: safeQuote.discountAmount,
      taxAmount: safeQuote.taxAmount,
      grandTotal: safeQuote.grandTotal,
      validUntil: safeQuote.validUntil ?? null,
      termsAndConditions: safeQuote.termsAndConditions ?? null,
      customerNotes: safeQuote.customerNotes ?? null,
    },
    itinerary: {
      title: safeItinerary.title,
      destinationSummary: safeItinerary.destinationSummary ?? null,
      startDate: safeItinerary.startDate ?? null,
      endDate: safeItinerary.endDate ?? null,
      durationDays: safeItinerary.durationDays ?? null,
      passengerCount: safeItinerary.passengerCount ?? null,
      days: safeItinerary.days.map((day) => ({
        dayNumber: day.dayNumber,
        date: day.date ?? null,
        title: day.title,
        summary: day.summary ?? null,
        items: day.items.map((item) => ({
          itemType: item.itemType,
          title: item.title,
          description: item.description ?? null,
          location: item.location ?? null,
          startTime: item.startTime ?? null,
          endTime: item.endTime ?? null,
        })),
      })),
      inclusions: safeItinerary.inclusions,
      exclusions: safeItinerary.exclusions,
    },
  };
}

// ============================================================================
// 2. DOMAIN SERVICE INTERFACES & EXECUTION
// ============================================================================

export interface AcceptanceServiceDeps {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export interface PortalAcceptanceInput {
  travelerName: string;
  travelerEmail: string;
  confirmed: boolean;
}

export interface StaffAcceptanceOptions {
  method: 'email' | 'whatsapp' | 'phone' | 'in_person' | 'other';
  notes?: string;
  travelerName?: string;
  travelerEmail?: string;
}

export interface AcceptanceResult {
  acceptanceId: string;
  quoteVersionId: string;
  acceptedGrandTotal: string;
  currency: string;
  acceptedAt: string;
  idempotent: boolean;
}

export interface VoidAcceptanceResult {
  acceptanceId: string;
  voidedAt: string;
  voidedBy: string;
  voidReason: string;
  alreadyVoided: boolean;
}

/**
 * Records a traveler portal link-holder quote acceptance.
 * Sourced via a valid capability token.
 */
export async function recordPortalQuoteAcceptance(
  deps: AcceptanceServiceDeps,
  rawToken: string,
  input: PortalAcceptanceInput,
  clientIp: string,
  userAgent: string
): Promise<AcceptanceResult> {
  if (!isValidShareTokenFormat(rawToken)) {
    throw new Error('INVALID_TOKEN: Malformed token');
  }

  if (!input.confirmed) {
    throw new Error('VALIDATION_ERROR: Explicit commercial confirmation is required');
  }

  const name = input.travelerName?.trim();
  if (!name || name.length > 200) {
    throw new Error('VALIDATION_ERROR: Traveler name is required (max 200 chars)');
  }

  const email = input.travelerEmail?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    throw new Error('VALIDATION_ERROR: A valid email address is required');
  }

  const tokenHash = hashShareToken(rawToken);

  const res = await deps.query(
    `SELECT public.rpc_record_portal_quote_acceptance($1, $2, $3, $4, $5) as result`,
    [tokenHash, name, email, clientIp || null, userAgent || null]
  );

  const data = res.rows[0]?.result as Record<string, unknown>;
  return {
    acceptanceId: String(data.acceptance_id),
    quoteVersionId: String(data.quote_version_id),
    acceptedGrandTotal: String(data.accepted_grand_total),
    currency: String(data.currency),
    acceptedAt: String(data.accepted_at),
    idempotent: Boolean(data.idempotent),
  };
}

/**
 * Records a governed staff-recorded quote acceptance.
 * Requires quotes:acceptance:record permission.
 */
export async function recordStaffQuoteAcceptance(
  deps: AcceptanceServiceDeps,
  tenantId: string,
  actorUserId: string,
  quoteVersionId: string,
  options: StaffAcceptanceOptions
): Promise<AcceptanceResult> {
  const allowedMethods = ['email', 'whatsapp', 'phone', 'in_person', 'other'];
  if (!allowedMethods.includes(options.method)) {
    throw new Error(`VALIDATION_ERROR: Invalid staff acceptance method: ${options.method}`);
  }

  const res = await deps.query(
    `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
    [
      tenantId,
      actorUserId,
      quoteVersionId,
      options.method,
      options.notes?.trim() || null,
      options.travelerName?.trim() || null,
      options.travelerEmail?.trim().toLowerCase() || null,
    ]
  );

  const data = res.rows[0]?.result as Record<string, unknown>;
  return {
    acceptanceId: String(data.acceptance_id),
    quoteVersionId: String(data.quote_version_id),
    acceptedGrandTotal: String(data.accepted_grand_total),
    currency: String(data.currency),
    acceptedAt: String(data.accepted_at),
    idempotent: Boolean(data.idempotent),
  };
}

/**
 * Voids an active quote acceptance.
 * Requires quotes:acceptance:void permission (admin or manager only).
 * If the acceptance has already been converted to a Booking, this throws ACCEPTANCE_ALREADY_CONVERTED.
 */
export async function voidQuoteAcceptance(
  deps: AcceptanceServiceDeps,
  tenantId: string,
  actorUserId: string,
  acceptanceId: string,
  voidReason: string
): Promise<VoidAcceptanceResult> {
  const reason = voidReason?.trim();
  if (!reason) {
    throw new Error('VALIDATION_ERROR: void_reason is required and cannot be empty');
  }

  const res = await deps.query(
    `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4) as result`,
    [tenantId, actorUserId, acceptanceId, reason]
  );

  const data = res.rows[0]?.result as Record<string, unknown>;
  return {
    acceptanceId: String(data.acceptance_id),
    voidedAt: String(data.voided_at),
    voidedBy: String(data.voided_by),
    voidReason: String(data.void_reason),
    alreadyVoided: Boolean(data.already_voided),
  };
}
