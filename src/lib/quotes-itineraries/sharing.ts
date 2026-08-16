/**
 * Phase AI-5B.3: Secure Sharing Service
 *
 * Handles:
 * - Cryptographically secure 256-bit share token generation
 * - SHA-256 hashing for storage (raw token never persisted)
 * - Customer-safe DTO shaping with recursive internal-data stripping
 * - Share issuance orchestration
 * - Share revocation
 * - Public token resolution and DTO assembly
 *
 * Invariants:
 * - SHARE CREATION != DELIVERY (token is returned; delivery is separate)
 * - VIEW != ACCEPTANCE (portal is read-only in AI-5B.3)
 * - QUOTE EXPIRY != TOKEN EXPIRY (valid_until vs share expires_at)
 */

import { randomBytes, createHash } from 'crypto';
import type {
  CustomerItineraryDTO,
  CustomerQuoteDTO,
} from './types';

// ============================================================================
// 1. CRYPTOGRAPHIC TOKEN UTILITIES
// ============================================================================

/**
 * Generates a cryptographically secure 256-bit (32-byte) random token.
 * Returns hex-encoded string (64 characters).
 */
export function generateShareToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Computes SHA-256 hash of a raw token for database storage.
 * The raw token is NEVER stored — only this hash.
 */
export function hashShareToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// ============================================================================
// 2. CUSTOMER-SAFE DTO SHAPERS (RECURSIVE INTERNAL-DATA STRIPPING)
// ============================================================================

/**
 * Strips internal/staff-only fields from an ItineraryItem.
 * Removes: supplierName, internalNotes
 */
function shapeCustomerItineraryItem(
  item: Record<string, unknown>
): CustomerItineraryDTO['days'][number]['items'][number] {
  return {
    itemType: ((item.itemType ?? item.item_type ?? 'other') as string) as CustomerItineraryDTO['days'][number]['items'][number]['itemType'],
    title: (item.title as string) || '',
    description: (item.description as string) ?? null,
    location: (item.location as string) ?? null,
    startTime: ((item.startTime ?? item.start_time ?? null) as string | null),
    endTime: ((item.endTime ?? item.end_time ?? null) as string | null),
    // supplierName: STRIPPED
    // internalNotes: STRIPPED
  };
}

/**
 * Strips internal fields from an ItineraryDay.
 * Recursively strips items.
 */
function shapeCustomerItineraryDay(
  day: Record<string, unknown>
): CustomerItineraryDTO['days'][number] {
  const items = ((day.items as Array<Record<string, unknown>>) || []).map(
    shapeCustomerItineraryItem
  );
  return {
    dayNumber: ((day.dayNumber ?? day.day_number ?? 0) as number),
    date: (day.date as string) ?? null,
    title: (day.title as string) || '',
    summary: (day.summary as string) ?? null,
    items,
  };
}

/**
 * Shapes a full CustomerItineraryDTO from raw database/JSONB data.
 * Recursively strips ALL internal fields from days → items.
 *
 * NEVER EXPOSES: supplierName, internalNotes, created_by, tenant_id, etc.
 */
export function shapeCustomerItineraryDTO(data: {
  title: string;
  destination_summary?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  duration_days?: number | null;
  passenger_count?: number | null;
  days: unknown;
  inclusions: unknown;
  exclusions: unknown;
}): CustomerItineraryDTO {
  const rawDays = (Array.isArray(data.days) ? data.days : []) as Array<Record<string, unknown>>;
  const rawInclusions = (Array.isArray(data.inclusions) ? data.inclusions : []) as string[];
  const rawExclusions = (Array.isArray(data.exclusions) ? data.exclusions : []) as string[];

  return {
    title: data.title || '',
    destinationSummary: data.destination_summary ?? null,
    startDate: data.start_date ?? null,
    endDate: data.end_date ?? null,
    durationDays: data.duration_days ?? null,
    passengerCount: data.passenger_count ?? null,
    days: rawDays.map(shapeCustomerItineraryDay),
    inclusions: rawInclusions,
    exclusions: rawExclusions,
  };
}

/**
 * Strips internal/supplier fields from quote line items.
 * Removes: supplierCost, supplierName, markupAmount, marginAmount, marginPct, markupPct
 */
function shapeCustomerLineItem(
  item: Record<string, unknown>
): CustomerQuoteDTO['lineItems'][number] {
  return {
    title: (item.title as string) || '',
    description: (item.description as string) ?? null,
    category: ((item.category ?? 'other') as string) as CustomerQuoteDTO['lineItems'][number]['category'],
    quantity: (item.quantity as number) || 0,
    unitPrice: String(item.unitPrice ?? item.unit_price ?? '0.00'),
    totalPrice: String(item.totalPrice ?? item.total_price ?? '0.00'),
    // supplierCost: STRIPPED
    // supplierName: STRIPPED
    // markupAmount: STRIPPED
    // marginAmount: STRIPPED
    // marginPct: STRIPPED
    // markupPct: STRIPPED
  };
}

/**
 * Shapes a full CustomerQuoteDTO from raw database/JSONB resolved data.
 * Recursively strips ALL internal pricing, supplier, and margin fields.
 *
 * NEVER EXPOSES: internal_cost_total, gross_margin_amount, supplierCost, margins, etc.
 */
export function shapeCustomerQuoteDTO(data: {
  quote_number: string;
  version_number: number;
  currency: string;
  line_items: unknown;
  subtotal: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  grand_total: string | number;
  valid_until?: string | null;
  terms_and_conditions?: string | null;
  customer_notes?: string | null;
  is_acceptable: boolean;
  itinerary: {
    title: string;
    destination_summary?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    duration_days?: number | null;
    passenger_count?: number | null;
    days: unknown;
    inclusions: unknown;
    exclusions: unknown;
  } | null;
}): CustomerQuoteDTO {
  const rawLineItems = (Array.isArray(data.line_items) ? data.line_items : []) as Array<Record<string, unknown>>;

  return {
    quoteNumber: data.quote_number || '',
    versionNumber: data.version_number || 0,
    currency: data.currency || 'INR',
    lineItems: rawLineItems.map(shapeCustomerLineItem),
    subtotal: String(data.subtotal),
    discountAmount: String(data.discount_amount),
    taxAmount: String(data.tax_amount),
    grandTotal: String(data.grand_total),
    validUntil: data.valid_until ?? null,
    termsAndConditions: data.terms_and_conditions ?? null,
    customerNotes: data.customer_notes ?? null,
    itinerary: data.itinerary
      ? shapeCustomerItineraryDTO(data.itinerary)
      : {
          title: '',
          days: [],
          inclusions: [],
          exclusions: [],
        },
    isAcceptable: data.is_acceptable ?? false,
  };
}

// ============================================================================
// 3. SHARE EXPIRY & CANONICAL URL HELPERS
// ============================================================================

export const DEFAULT_SHARE_EXPIRY_DAYS = 30;

/**
 * Returns the default deterministic expiration date: current time + 30 days.
 */
export function getDefaultShareExpiry(): Date {
  return new Date(Date.now() + DEFAULT_SHARE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Validates that a custom expiry timestamp is strictly in the future.
 */
export function validateShareExpiry(expiresAt: Date): Date {
  if (!(expiresAt instanceof Date) || isNaN(expiresAt.getTime())) {
    throw new Error('VALIDATION_ERROR: expiresAt must be a valid Date object');
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error('VALIDATION_ERROR: expiresAt must be in the future');
  }
  return expiresAt;
}

/**
 * Resolves the canonical server-configured application origin.
 * Prevents Host header poisoning and arbitrary phishing URL generation.
 */
export function getCanonicalAppUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (envUrl && envUrl.trim() !== '') {
    return envUrl.trim().replace(/\/+$/, '');
  }
  // Safe local development fallback
  return 'http://localhost:3000';
}

/**
 * Constructs the canonical public portal capability URL for a share token.
 */
export function buildShareUrl(
  resourceType: 'itinerary' | 'quote',
  rawToken: string
): string {
  const base = getCanonicalAppUrl();
  return `${base}/p/${resourceType}/${rawToken}`;
}

// ============================================================================
// 4. SHARE ISSUANCE & REVOCATION (SERVICE LAYER)
// ============================================================================

export interface ShareIssuanceResult {
  shareId: string;
  rawToken: string; // One-time: caller must deliver this, NOT re-fetchable
  tokenHash: string;
  shareUrl: string; // Canonical public access URL
  expiresAt: string;
}

export interface ShareServiceDeps {
  /** Execute a raw SQL query (e.g. supabase admin client or pg client) */
  query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Issues a share for a finalized ItineraryVersion.
 * Generates the token client-side, hashes it, and passes hash to the DB RPC.
 * Returns the raw token and canonical share URL for one-time delivery.
 */
export async function issueItineraryShare(
  deps: ShareServiceDeps,
  tenantId: string,
  actorUserId: string,
  itineraryVersionId: string,
  customExpiresAt?: Date | null
): Promise<ShareIssuanceResult> {
  const effectiveExpiresAt = customExpiresAt
    ? validateShareExpiry(customExpiresAt)
    : getDefaultShareExpiry();

  const rawToken = generateShareToken();
  const tokenHash = hashShareToken(rawToken);

  const result = await deps.query(
    `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5) as result`,
    [tenantId, actorUserId, itineraryVersionId, tokenHash, effectiveExpiresAt.toISOString()]
  );

  const row = result.rows[0]?.result as Record<string, unknown>;

  return {
    shareId: String(row.share_id),
    rawToken,
    tokenHash,
    shareUrl: buildShareUrl('itinerary', rawToken),
    expiresAt: effectiveExpiresAt.toISOString(),
  };
}

/**
 * Issues a share for an issued QuoteVersion.
 */
export async function issueQuoteShare(
  deps: ShareServiceDeps,
  tenantId: string,
  actorUserId: string,
  quoteVersionId: string,
  customExpiresAt?: Date | null
): Promise<ShareIssuanceResult> {
  const effectiveExpiresAt = customExpiresAt
    ? validateShareExpiry(customExpiresAt)
    : getDefaultShareExpiry();

  const rawToken = generateShareToken();
  const tokenHash = hashShareToken(rawToken);

  const result = await deps.query(
    `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5) as result`,
    [tenantId, actorUserId, quoteVersionId, tokenHash, effectiveExpiresAt.toISOString()]
  );

  const row = result.rows[0]?.result as Record<string, unknown>;

  return {
    shareId: String(row.share_id),
    rawToken,
    tokenHash,
    shareUrl: buildShareUrl('quote', rawToken),
    expiresAt: effectiveExpiresAt.toISOString(),
  };
}

/**
 * Revokes an itinerary share.
 */
export async function revokeItineraryShare(
  deps: ShareServiceDeps,
  tenantId: string,
  actorUserId: string,
  shareId: string
): Promise<{ shareId: string; revoked: boolean }> {
  const result = await deps.query(
    `SELECT public.rpc_revoke_itinerary_share($1, $2, $3) as result`,
    [tenantId, actorUserId, shareId]
  );
  const row = result.rows[0]?.result as Record<string, unknown>;
  return { shareId: String(row.share_id), revoked: Boolean(row.revoked) };
}

/**
 * Revokes a quote share.
 */
export async function revokeQuoteShare(
  deps: ShareServiceDeps,
  tenantId: string,
  actorUserId: string,
  shareId: string
): Promise<{ shareId: string; revoked: boolean }> {
  const result = await deps.query(
    `SELECT public.rpc_revoke_quote_share($1, $2, $3) as result`,
    [tenantId, actorUserId, shareId]
  );
  const row = result.rows[0]?.result as Record<string, unknown>;
  return { shareId: String(row.share_id), revoked: Boolean(row.revoked) };
}

// ============================================================================
// 4. PUBLIC TOKEN RESOLUTION (SERVER-SIDE)
// ============================================================================

export interface ResolvedItineraryShare {
  shareId: string;
  versionId: string;
  agencyName: string;
  expiresAt: string;
  itinerary: CustomerItineraryDTO;
}

export interface ResolvedQuoteShare {
  shareId: string;
  quoteVersionId: string;
  agencyName: string;
  expiresAt: string;
  quote: CustomerQuoteDTO;
}

/**
 * Resolves an itinerary share token to customer-safe data.
 * Server-side only. The raw token is hashed before lookup.
 */
export async function resolveItineraryShareToken(
  deps: ShareServiceDeps,
  rawToken: string
): Promise<ResolvedItineraryShare> {
  const tokenHash = hashShareToken(rawToken);

  const result = await deps.query(
    `SELECT public.resolve_itinerary_share_token($1) as result`,
    [tokenHash]
  );

  const data = result.rows[0]?.result as Record<string, unknown>;

  const itinerary = shapeCustomerItineraryDTO({
    title: data.title as string,
    destination_summary: data.destination_summary as string | null,
    start_date: data.start_date as string | null,
    end_date: data.end_date as string | null,
    duration_days: data.duration_days as number | null,
    passenger_count: data.passenger_count as number | null,
    days: data.days,
    inclusions: data.inclusions,
    exclusions: data.exclusions,
  });

  return {
    shareId: String(data.share_id),
    versionId: String(data.version_id),
    agencyName: String(data.agency_name),
    expiresAt: String(data.expires_at),
    itinerary,
  };
}

/**
 * Resolves a quote share token to customer-safe data.
 * Server-side only. The raw token is hashed before lookup.
 */
export async function resolveQuoteShareToken(
  deps: ShareServiceDeps,
  rawToken: string
): Promise<ResolvedQuoteShare> {
  const tokenHash = hashShareToken(rawToken);

  const result = await deps.query(
    `SELECT public.resolve_quote_share_token($1) as result`,
    [tokenHash]
  );

  const data = result.rows[0]?.result as Record<string, unknown>;
  const itineraryData = data.itinerary as Record<string, unknown> | null;

  const quote = shapeCustomerQuoteDTO({
    quote_number: data.quote_number as string,
    version_number: data.version_number as number,
    currency: data.currency as string,
    line_items: data.line_items,
    subtotal: data.subtotal as string,
    discount_amount: data.discount_amount as string,
    tax_amount: data.tax_amount as string,
    grand_total: data.grand_total as string,
    valid_until: data.valid_until as string | null,
    terms_and_conditions: data.terms_and_conditions as string | null,
    customer_notes: data.customer_notes as string | null,
    is_acceptable: data.is_acceptable as boolean,
    itinerary: itineraryData ? {
      title: itineraryData.title as string,
      destination_summary: itineraryData.destination_summary as string | null,
      start_date: itineraryData.start_date as string | null,
      end_date: itineraryData.end_date as string | null,
      duration_days: itineraryData.duration_days as number | null,
      passenger_count: itineraryData.passenger_count as number | null,
      days: itineraryData.days,
      inclusions: itineraryData.inclusions,
      exclusions: itineraryData.exclusions,
    } : null,
  });

  return {
    shareId: String(data.share_id),
    quoteVersionId: String(data.quote_version_id),
    agencyName: String(data.agency_name),
    expiresAt: String(data.expires_at),
    quote,
  };
}
