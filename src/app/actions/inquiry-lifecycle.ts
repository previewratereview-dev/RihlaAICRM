'use server';

/**
 * Phase AI-5B.5: Server Actions and Loaders for Inquiry Lifecycle Workspace
 *
 * Provides authoritative server data loaders and domain mutation actions for:
 * - Itinerary families, versions, draft editing, finalization, revision, and shares
 * - Quote families, versions, draft editing, role-safe pricing, issuance, revision, and shares
 * - Role-safe DTO shaping with zero supplier-cost/margin leakage to Consultant/Specialist/Viewer
 * - Commercial Acceptance provenance and Booking conversion state
 * - Lock version concurrency conflict handling
 * - Super Admin fail-closed enforcement
 */

import { cookies } from 'next/headers';
import { Client } from 'pg';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import {
  shapeQuoteVersionDTO,
  preparePricingInputForRole,
  InternalQuoteVersionDTO,
  StaffSafeQuoteVersionDTO,
} from '@/lib/quotes-itineraries/service';
import {
  calculateQuotePricing,
  PricingLineItemInput,
} from '@/lib/quotes-itineraries/pricing';
import {
  issueItineraryShare,
  issueQuoteShare,
  revokeItineraryShare,
  revokeQuoteShare,
} from '@/lib/quotes-itineraries/sharing';
import {
  ItineraryVersionEntity,
  QuoteLineItem,
} from '@/lib/quotes-itineraries/types';

export interface AuthenticatedStaffContext {
  userId: string;
  tenantId: string;
  role: string;
}

export async function getAuthenticatedStaffContext(): Promise<AuthenticatedStaffContext> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('UNAUTHORIZED: Authentication required');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('UNAUTHORIZED: User profile not found');
  }

  if (profile.role === 'super_admin') {
    throw new Error('FORBIDDEN: Super Admin cannot perform direct agency operational actions');
  }

  return {
    userId: user.id,
    tenantId: profile.tenant_id,
    role: profile.role,
  };
}

export async function withPgClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error('INTERNAL_ERROR: DATABASE_URL is not configured');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}

// ============================================================================
// LIFECYCLE DATA TYPES
// ============================================================================

export interface ItineraryShareDTO {
  id: string;
  itineraryVersionId: string;
  expiresAt: string;
  isExpired: boolean;
  revokedAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  createdAt: string;
}

export interface QuoteShareDTO {
  id: string;
  quoteVersionId: string;
  expiresAt: string;
  isExpired: boolean;
  revokedAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  createdAt: string;
}

export interface ItineraryFamilyDTO {
  id: string;
  inquiryId: string;
  title: string;
  latestVersionNumber: number;
  currentLifecycleState: string;
  createdAt: string;
  updatedAt: string;
  versions: ItineraryVersionEntity[];
  shares: ItineraryShareDTO[];
}

export interface QuoteFamilyDTO {
  id: string;
  inquiryId: string;
  quoteNumber: string;
  latestVersionNumber: number;
  currentCommercialStatus: string;
  createdAt: string;
  updatedAt: string;
  versions: (InternalQuoteVersionDTO | StaffSafeQuoteVersionDTO)[];
  shares: QuoteShareDTO[];
}

export interface QuoteAcceptanceDTO {
  id: string;
  quoteVersionId: string;
  quoteNumber: string;
  quoteVersionNumber: number;
  itineraryVersionId: string;
  itineraryTitle?: string;
  travelerId: string;
  travelerName: string;
  travelerEmail: string;
  acceptanceType: string;
  staffAcceptanceMethod: string | null;
  staffReferenceNotes: string | null;
  acceptedGrandTotal: string;
  currency: string;
  acceptedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  isConverted: boolean;
}

export interface BookingDTO {
  id: string;
  inquiryId: string;
  bookingReference: string;
  bookingStatus: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  totalAmount: string;
  paidAmount: string | null;
  balanceDue: string | null;
  currency: string;
  departureDate: string | null;
  returnDate: string | null;
  passengerCount: number | null;
  quoteAcceptanceId: string | null;
  createdAt: string;
}

export interface InquiryLifecycleData {
  inquiryId: string;
  userRole: string;
  hasInternalPricingPermission: boolean;
  itineraries: ItineraryFamilyDTO[];
  quotes: QuoteFamilyDTO[];
  activeAcceptance: QuoteAcceptanceDTO | null;
  acceptanceHistory: QuoteAcceptanceDTO[];
  booking: BookingDTO | null;
}

// ============================================================================
// DATA LOADER
// ============================================================================

export async function getInquiryLifecycleData(inquiryId: string): Promise<InquiryLifecycleData> {
  const ctx = await getAuthenticatedStaffContext();

  return withPgClient(async (client) => {
    // 1. Fetch Itinerary Families
    const itinFamiliesRes = await client.query(
      `SELECT id, inquiry_id, title, latest_version_number, current_lifecycle_state, created_at, updated_at
       FROM public.itineraries
       WHERE tenant_id = $1 AND inquiry_id = $2
       ORDER BY created_at ASC`,
      [ctx.tenantId, inquiryId]
    );

    // 2. Fetch Itinerary Versions
    const itinVersionsRes = await client.query(
      `SELECT iv.*, i.inquiry_id
       FROM public.itinerary_versions iv
       JOIN public.itineraries i ON i.id = iv.itinerary_id
       WHERE iv.tenant_id = $1 AND i.inquiry_id = $2
       ORDER BY iv.version_number ASC`,
      [ctx.tenantId, inquiryId]
    );

    // 3. Fetch Itinerary Shares
    const itinSharesRes = await client.query(
      `SELECT s.id, s.itinerary_version_id, s.expires_at, s.revoked_at, s.first_viewed_at, s.last_viewed_at, s.created_at
       FROM public.itinerary_shares s
       JOIN public.itinerary_versions iv ON iv.id = s.itinerary_version_id
       JOIN public.itineraries i ON i.id = iv.itinerary_id
       WHERE s.tenant_id = $1 AND i.inquiry_id = $2
       ORDER BY s.created_at DESC`,
      [ctx.tenantId, inquiryId]
    );

    // 4. Fetch Quote Families
    const quoteFamiliesRes = await client.query(
      `SELECT id, inquiry_id, quote_number, latest_version_number, current_commercial_status, created_at, updated_at
       FROM public.quotes
       WHERE tenant_id = $1 AND inquiry_id = $2
       ORDER BY created_at ASC`,
      [ctx.tenantId, inquiryId]
    );

    // 5. Fetch Quote Versions
    const quoteVersionsRes = await client.query(
      `SELECT qv.*, q.quote_number, q.inquiry_id
       FROM public.quote_versions qv
       JOIN public.quotes q ON q.id = qv.quote_id
       WHERE qv.tenant_id = $1 AND q.inquiry_id = $2
       ORDER BY qv.version_number ASC`,
      [ctx.tenantId, inquiryId]
    );

    // 6. Fetch Quote Shares (excluding token_hash)
    const quoteSharesRes = await client.query(
      `SELECT qs.id, qs.quote_version_id, qs.expires_at, qs.revoked_at, qs.first_viewed_at, qs.last_viewed_at, qs.created_at
       FROM public.quote_shares qs
       JOIN public.quote_versions qv ON qv.id = qs.quote_version_id
       JOIN public.quotes q ON q.id = qv.quote_id
       WHERE qs.tenant_id = $1 AND q.inquiry_id = $2
       ORDER BY qs.created_at DESC`,
      [ctx.tenantId, inquiryId]
    );

    // 7. Fetch Quote Acceptances
    const acceptancesRes = await client.query(
      `SELECT qa.id, qa.quote_version_id, qa.itinerary_version_id, qa.traveler_id,
              qa.traveler_name_input, qa.traveler_email_input, qa.acceptance_type,
              qa.staff_acceptance_method, qa.staff_reference_notes,
              qa.accepted_grand_total, qa.currency, qa.accepted_at,
              qa.voided_at, qa.void_reason,
              q.quote_number, qv.version_number as quote_version_number,
              iv.title as itinerary_title,
              EXISTS (SELECT 1 FROM public.bookings b WHERE b.quote_acceptance_id = qa.id) as is_converted
       FROM public.quote_acceptances qa
       JOIN public.quote_versions qv ON qv.id = qa.quote_version_id
       JOIN public.quotes q ON q.id = qv.quote_id
       LEFT JOIN public.itinerary_versions iv ON iv.id = qa.itinerary_version_id
       WHERE qa.tenant_id = $1 AND qa.inquiry_id = $2
       ORDER BY qa.accepted_at DESC`,
      [ctx.tenantId, inquiryId]
    );

    // 8. Fetch Booking (if exists)
    const bookingRes = await client.query(
      `SELECT id, inquiry_id, booking_reference, booking_status, payment_status, fulfillment_status,
              total_amount, paid_amount, balance_due, currency,
              departure_date, return_date, passenger_count, quote_acceptance_id, created_at
       FROM public.bookings
       WHERE tenant_id = $1 AND inquiry_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [ctx.tenantId, inquiryId]
    );

    // Assembly
    const nowMs = Date.now();
    const itinShares = itinSharesRes.rows.map((r) => ({
      id: String(r.id),
      itineraryVersionId: String(r.itinerary_version_id),
      expiresAt: String(r.expires_at),
      isExpired: new Date(r.expires_at).getTime() < nowMs,
      revokedAt: r.revoked_at ? String(r.revoked_at) : null,
      firstViewedAt: r.first_viewed_at ? String(r.first_viewed_at) : null,
      lastViewedAt: r.last_viewed_at ? String(r.last_viewed_at) : null,
      createdAt: String(r.created_at),
    }));

    const itinVersions: ItineraryVersionEntity[] = itinVersionsRes.rows.map((r) => ({
      id: String(r.id),
      tenantId: String(r.tenant_id),
      itineraryId: String(r.itinerary_id),
      versionNumber: Number(r.version_number),
      lockVersion: Number(r.lock_version ?? 0),
      status: r.status,
      title: r.title,
      destinationSummary: r.destination_summary,
      startDate: r.start_date,
      endDate: r.end_date,
      durationDays: r.duration_days,
      passengerCount: r.passenger_count,
      days: r.days || [],
      inclusions: r.inclusions || [],
      exclusions: r.exclusions || [],
      itinerarySchemaVersion: Number(r.itinerary_schema_version ?? 1),
      frozenAt: r.frozen_at,
      supersededAt: r.superseded_at,
      archivedAt: r.archived_at,
      createdBy: r.created_by,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));

    const itineraryFamilies: ItineraryFamilyDTO[] = itinFamiliesRes.rows.map((r) => ({
      id: String(r.id),
      inquiryId: String(r.inquiry_id),
      title: String(r.title),
      latestVersionNumber: Number(r.latest_version_number),
      currentLifecycleState: String(r.current_lifecycle_state),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      versions: itinVersions.filter((v) => v.itineraryId === r.id),
      shares: itinShares.filter((s) =>
        itinVersions.some((v) => v.itineraryId === r.id && v.id === s.itineraryVersionId)
      ),
    }));

    const quoteShares = quoteSharesRes.rows.map((r) => ({
      id: String(r.id),
      quoteVersionId: String(r.quote_version_id),
      expiresAt: String(r.expires_at),
      isExpired: new Date(r.expires_at).getTime() < nowMs,
      revokedAt: r.revoked_at ? String(r.revoked_at) : null,
      firstViewedAt: r.first_viewed_at ? String(r.first_viewed_at) : null,
      lastViewedAt: r.last_viewed_at ? String(r.last_viewed_at) : null,
      createdAt: String(r.created_at),
    }));

    const quoteVersions = quoteVersionsRes.rows.map((r) =>
      shapeQuoteVersionDTO(r as unknown as Parameters<typeof shapeQuoteVersionDTO>[0], ctx.role)
    );

    const quoteFamilies: QuoteFamilyDTO[] = quoteFamiliesRes.rows.map((r) => ({
      id: String(r.id),
      inquiryId: String(r.inquiry_id),
      quoteNumber: String(r.quote_number),
      latestVersionNumber: Number(r.latest_version_number),
      currentCommercialStatus: String(r.current_commercial_status),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      versions: quoteVersions.filter((v) => v.quoteId === r.id),
      shares: quoteShares.filter((s) =>
        quoteVersions.some((v) => v.quoteId === r.id && v.id === s.quoteVersionId)
      ),
    }));

    const acceptances: QuoteAcceptanceDTO[] = acceptancesRes.rows.map((r) => ({
      id: String(r.id),
      quoteVersionId: String(r.quote_version_id),
      quoteNumber: String(r.quote_number),
      quoteVersionNumber: Number(r.quote_version_number),
      itineraryVersionId: String(r.itinerary_version_id),
      itineraryTitle: r.itinerary_title ? String(r.itinerary_title) : undefined,
      travelerId: String(r.traveler_id),
      travelerName: String(r.traveler_name_input || ''),
      travelerEmail: String(r.traveler_email_input || ''),
      acceptanceType: String(r.acceptance_type),
      staffAcceptanceMethod: r.staff_acceptance_method ? String(r.staff_acceptance_method) : null,
      staffReferenceNotes: r.staff_reference_notes ? String(r.staff_reference_notes) : null,
      acceptedGrandTotal: String(r.accepted_grand_total),
      currency: String(r.currency),
      acceptedAt: String(r.accepted_at),
      voidedAt: r.voided_at ? String(r.voided_at) : null,
      voidReason: r.void_reason ? String(r.void_reason) : null,
      isConverted: Boolean(r.is_converted),
    }));

    const activeAcceptance = acceptances.find((a) => a.voidedAt === null) || null;

    let booking: BookingDTO | null = null;
    if (bookingRes.rows.length > 0) {
      const b = bookingRes.rows[0];
      booking = {
        id: String(b.id),
        inquiryId: String(b.inquiry_id),
        bookingReference: String(b.booking_reference),
        bookingStatus: String(b.booking_status),
        paymentStatus: String(b.payment_status),
        fulfillmentStatus: String(b.fulfillment_status),
        totalAmount: String(b.total_amount),
        paidAmount: b.paid_amount != null ? String(b.paid_amount) : null,
        balanceDue: b.balance_due != null ? String(b.balance_due) : null,
        currency: String(b.currency),
        departureDate: b.departure_date ? String(b.departure_date) : null,
        returnDate: b.return_date ? String(b.return_date) : null,
        passengerCount: b.passenger_count != null ? Number(b.passenger_count) : null,
        quoteAcceptanceId: b.quote_acceptance_id ? String(b.quote_acceptance_id) : null,
        createdAt: String(b.created_at),
      };
    }

    return {
      inquiryId,
      userRole: ctx.role,
      hasInternalPricingPermission: can(ctx.role, 'quotes:internal_pricing:read'),
      itineraries: itineraryFamilies,
      quotes: quoteFamilies,
      activeAcceptance,
      acceptanceHistory: acceptances,
      booking,
    };
  });
}

// ============================================================================
// ITINERARY MUTATION ACTIONS
// ============================================================================

export interface CreateItineraryActionInput {
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

export async function createItineraryAction(input: CreateItineraryActionInput) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'itineraries:write')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks itineraries:write permission`);
  }

  if (!input.title || !input.title.trim()) {
    throw new Error('VALIDATION_ERROR: Itinerary title is required');
  }

  return withPgClient(async (client) => {
    const res = await client.query(
      `SELECT public.rpc_create_itinerary_family_and_version($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) as result`,
      [
        ctx.tenantId,
        ctx.userId,
        input.inquiryId,
        input.title.trim(),
        input.destinationSummary || null,
        input.startDate || null,
        input.endDate || null,
        input.durationDays || null,
        input.passengerCount || null,
        JSON.stringify(input.days || []),
        JSON.stringify(input.inclusions || []),
        JSON.stringify(input.exclusions || []),
      ]
    );
    const row = res.rows[0]?.result;
    return {
      itineraryId: String(row.itinerary_id),
      versionId: String(row.version_id),
      versionNumber: Number(row.version_number),
    };
  });
}

export interface UpdateItineraryDraftActionInput {
  versionId: string;
  expectedLockVersion: number;
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

export async function updateItineraryDraftAction(input: UpdateItineraryDraftActionInput) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'itineraries:write')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks itineraries:write permission`);
  }

  return withPgClient(async (client) => {
    try {
      const res = await client.query(
        `SELECT public.rpc_update_itinerary_version_draft($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) as result`,
        [
          ctx.tenantId,
          ctx.userId,
          input.versionId,
          input.expectedLockVersion,
          input.title || null,
          input.destinationSummary || null,
          input.startDate || null,
          input.endDate || null,
          input.durationDays || null,
          input.passengerCount || null,
          input.days ? JSON.stringify(input.days) : null,
          input.inclusions ? JSON.stringify(input.inclusions) : null,
          input.exclusions ? JSON.stringify(input.exclusions) : null,
        ]
      );
      const row = res.rows[0]?.result;
      return {
        versionId: String(row.version_id),
        newLockVersion: Number(row.new_lock_version),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('STALE_VERSION')) {
        throw new Error('STALE_VERSION: This itinerary was updated by another team member.');
      }
      throw err;
    }
  });
}

export async function finalizeItineraryAction(versionId: string) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'itineraries:write')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks itineraries:write permission`);
  }

  return withPgClient(async (client) => {
    const res = await client.query(
      `SELECT public.rpc_finalize_itinerary_version($1, $2, $3) as result`,
      [ctx.tenantId, ctx.userId, versionId]
    );
    const row = res.rows[0]?.result;
    return {
      versionId: String(row.version_id),
      finalizedAt: String(row.finalized_at),
    };
  });
}

export async function createItineraryRevisionAction(baseVersionId: string) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'itineraries:write')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks itineraries:write permission`);
  }

  return withPgClient(async (client) => {
    const res = await client.query(
      `SELECT public.rpc_create_itinerary_version_revision($1, $2, $3) as result`,
      [ctx.tenantId, ctx.userId, baseVersionId]
    );
    const row = res.rows[0]?.result;
    return {
      newVersionId: String(row.new_version_id),
      versionNumber: Number(row.version_number),
    };
  });
}

export async function createItineraryShareAction(versionId: string, customExpiresAt?: string | null) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'itineraries:share')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks itineraries:share permission`);
  }

  return withPgClient(async (client) => {
    const expiryDate = customExpiresAt ? new Date(customExpiresAt) : null;
    const result = await issueItineraryShare(
      {
        query: async (sql, params) => {
          const res = await client.query(sql, params as unknown[]);
          return { rows: res.rows };
        },
      },
      ctx.tenantId,
      ctx.userId,
      versionId,
      expiryDate
    );
    return {
      shareId: result.shareId,
      shareUrl: result.shareUrl,
      expiresAt: result.expiresAt,
    };
  });
}

export async function revokeItineraryShareAction(shareId: string) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'itineraries:share')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks itineraries:share permission`);
  }

  return withPgClient(async (client) => {
    const result = await revokeItineraryShare(
      {
        query: async (sql, params) => {
          const res = await client.query(sql, params as unknown[]);
          return { rows: res.rows };
        },
      },
      ctx.tenantId,
      ctx.userId,
      shareId
    );
    return {
      shareId: result.shareId,
      revoked: result.revoked,
    };
  });
}

// ============================================================================
// QUOTE MUTATION ACTIONS
// ============================================================================

export interface CreateQuoteActionInput {
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

export async function createQuoteAction(input: CreateQuoteActionInput) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'quotes:write')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks quotes:write permission`);
  }

  if (!input.itineraryVersionId) {
    throw new Error('VALIDATION_ERROR: An exact finalized itinerary version must be selected');
  }

  return withPgClient(async (client) => {
    // 1. Verify that itineraryVersion exists and is finalized
    const itinCheck = await client.query(
      `SELECT status FROM public.itinerary_versions WHERE id = $1 AND tenant_id = $2`,
      [input.itineraryVersionId, ctx.tenantId]
    );
    if (itinCheck.rows.length === 0) {
      throw new Error('NOT_FOUND: Selected itinerary version not found');
    }
    if (itinCheck.rows[0].status !== 'finalized') {
      throw new Error('INVALID_ATTACHMENT: Quotes may only attach to finalized itinerary versions');
    }

    // 2. Prepare pricing items based on role
    const preparedItems = preparePricingInputForRole(input.lineItems, null, ctx.role);

    // 3. Authoritative server pricing calculation
    const pricing = calculateQuotePricing({
      lineItems: preparedItems,
      discountAmount: input.discountAmount,
      taxAmount: input.taxAmount,
    });

    const res = await client.query(
      `SELECT public.rpc_create_quote_family_and_version($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) as result`,
      [
        ctx.tenantId,
        ctx.userId,
        input.inquiryId,
        input.itineraryVersionId,
        input.currency || 'INR',
        JSON.stringify(preparedItems),
        pricing.subtotal,
        pricing.discountAmount,
        pricing.taxAmount,
        pricing.grandTotal,
        pricing.internalCostTotal,
        pricing.grossMarginAmount,
        input.validUntil || null,
        input.termsAndConditions || null,
        input.customerNotes || null,
      ]
    );

    const row = res.rows[0]?.result;
    return {
      quoteId: String(row.quote_id),
      versionId: String(row.version_id),
      quoteNumber: String(row.quote_number),
      versionNumber: Number(row.version_number),
    };
  });
}

export interface UpdateQuoteDraftActionInput {
  versionId: string;
  expectedLockVersion: number;
  itineraryVersionId?: string;
  currency?: string;
  lineItems: PricingLineItemInput[];
  discountAmount?: string;
  taxAmount?: string;
  validUntil?: string | null;
  termsAndConditions?: string | null;
  customerNotes?: string | null;
}

export async function updateQuoteDraftAction(input: UpdateQuoteDraftActionInput) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'quotes:write')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks quotes:write permission`);
  }

  return withPgClient(async (client) => {
    // 1. Fetch current draft line items to preserve supplier costs if caller lacks permission
    const currentDraft = await client.query(
      `SELECT line_items, itinerary_version_id, currency FROM public.quote_versions WHERE id = $1 AND tenant_id = $2`,
      [input.versionId, ctx.tenantId]
    );
    if (currentDraft.rows.length === 0) {
      throw new Error('NOT_FOUND: Quote version not found');
    }

    const existingDraftItems = (currentDraft.rows[0].line_items || []) as QuoteLineItem[];
    const targetItineraryVersionId = input.itineraryVersionId || currentDraft.rows[0].itinerary_version_id;

    // 2. Prepare pricing input for role
    const preparedItems = preparePricingInputForRole(input.lineItems, existingDraftItems, ctx.role);

    // 3. Authoritative server pricing calculation
    const pricing = calculateQuotePricing({
      lineItems: preparedItems,
      discountAmount: input.discountAmount,
      taxAmount: input.taxAmount,
    });

    try {
      const res = await client.query(
        `SELECT public.rpc_update_quote_version_draft($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) as result`,
        [
          ctx.tenantId,
          ctx.userId,
          input.versionId,
          input.expectedLockVersion,
          targetItineraryVersionId,
          input.currency || currentDraft.rows[0].currency || 'INR',
          JSON.stringify(preparedItems),
          pricing.subtotal,
          pricing.discountAmount,
          pricing.taxAmount,
          pricing.grandTotal,
          pricing.internalCostTotal,
          pricing.grossMarginAmount,
          input.validUntil || null,
          input.termsAndConditions || null,
          input.customerNotes || null,
        ]
      );
      const row = res.rows[0]?.result;
      return {
        versionId: String(row.version_id),
        newLockVersion: Number(row.new_lock_version),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('STALE_VERSION')) {
        throw new Error('STALE_VERSION: This quote was updated by another team member.');
      }
      throw err;
    }
  });
}

export async function issueQuoteAction(versionId: string) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'quotes:write')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks quotes:write permission`);
  }

  return withPgClient(async (client) => {
    const res = await client.query(
      `SELECT public.rpc_issue_quote_version($1, $2, $3) as result`,
      [ctx.tenantId, ctx.userId, versionId]
    );
    const row = res.rows[0]?.result;
    return {
      versionId: String(row.version_id),
      frozenAt: String(row.frozen_at),
    };
  });
}

export async function createQuoteRevisionAction(baseVersionId: string) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'quotes:write')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks quotes:write permission`);
  }

  return withPgClient(async (client) => {
    const res = await client.query(
      `SELECT public.rpc_create_quote_version_revision($1, $2, $3) as result`,
      [ctx.tenantId, ctx.userId, baseVersionId]
    );
    const row = res.rows[0]?.result;
    return {
      newVersionId: String(row.new_version_id),
      versionNumber: Number(row.version_number),
    };
  });
}

export async function createQuoteShareAction(versionId: string, customExpiresAt?: string | null) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'quotes:share')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks quotes:share permission`);
  }

  return withPgClient(async (client) => {
    const expiryDate = customExpiresAt ? new Date(customExpiresAt) : null;
    const result = await issueQuoteShare(
      {
        query: async (sql, params) => {
          const res = await client.query(sql, params as unknown[]);
          return { rows: res.rows };
        },
      },
      ctx.tenantId,
      ctx.userId,
      versionId,
      expiryDate
    );
    return {
      shareId: result.shareId,
      shareUrl: result.shareUrl,
      expiresAt: result.expiresAt,
    };
  });
}

export async function revokeQuoteShareAction(shareId: string) {
  const ctx = await getAuthenticatedStaffContext();
  if (!can(ctx.role, 'quotes:share')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks quotes:share permission`);
  }

  return withPgClient(async (client) => {
    const result = await revokeQuoteShare(
      {
        query: async (sql, params) => {
          const res = await client.query(sql, params as unknown[]);
          return { rows: res.rows };
        },
      },
      ctx.tenantId,
      ctx.userId,
      shareId
    );
    return {
      shareId: result.shareId,
      revoked: result.revoked,
    };
  });
}
