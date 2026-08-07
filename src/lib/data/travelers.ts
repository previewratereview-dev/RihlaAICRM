import { supabase } from '../supabase';
import { assertTenantId } from './access';
import type {
  InquiryEntity,
  BookingEntity,
  TravelerDirectoryItem,
  TravelerKPIs,
} from '@/types';

interface DbInquiryRow {
  id: string;
  tenant_id: string;
  traveler_id: string;
  legacy_lead_id?: string | null;
  destination?: string | null;
  lead_source: string;
  priority: string;
  pipeline_stage: string;
  expected_value?: number | string | null;
  currency: string;
  assigned_agent_id?: string | null;
  last_contacted_at?: string | null;
  next_follow_up_at?: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  external_source?: string | null;
  external_event_id?: string | null;
  identity_review_required: boolean;
  identity_review_reason?: string | null;
  proposed_display_name?: string | null;
  proposed_email?: string | null;
  proposed_phone?: string | null;
}

interface DbBookingRow {
  id: string;
  tenant_id: string;
  traveler_id: string;
  inquiry_id?: string | null;
  legacy_lead_id?: string | null;
  booking_reference: string;
  departure_date?: string | null;
  return_date?: string | null;
  passenger_count?: number | null;
  total_amount?: number | string | null;
  paid_amount?: number | string | null;
  balance_due?: number | string | null;
  currency: string;
  booking_status: string;
  payment_status: string;
  fulfillment_status: string;
  financial_data_complete: boolean;
  assigned_agent_id?: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

interface DbTravelerProfileRow {
  id: string;
  tenant_id: string;
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  normalized_phone?: string | null;
  preferred_language?: string | null;
  special_notes?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function requireClient() {
  if (!supabase) {
    throw new Error('Data access requires a configured database connection');
  }
  return supabase;
}

export async function getTenantTravelers(tenantId: string): Promise<TravelerDirectoryItem[]> {
  assertTenantId(tenantId);
  const db = requireClient();

  // 1. Fetch tenant-scoped TravelerProfiles
  const { data: profiles, error: pErr } = await db
    .from('traveler_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (pErr) {
    console.error('[DAL] Error fetching tenant traveler_profiles:', pErr);
    throw pErr;
  }

  if (!profiles || profiles.length === 0) {
    return [];
  }

  const travelerIds = (profiles as DbTravelerProfileRow[]).map((p) => p.id);

  // 2. Fetch non-archived Inquiries for these travelers
  const { data: inquiries, error: iErr } = await db
    .from('inquiries')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('traveler_id', travelerIds)
    .is('archived_at', null);

  if (iErr) {
    console.error('[DAL] Error fetching tenant inquiries for travelers:', iErr);
    throw iErr;
  }

  // 3. Fetch non-archived Bookings for these travelers
  const { data: bookings, error: bErr } = await db
    .from('bookings')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('traveler_id', travelerIds)
    .is('archived_at', null);

  if (bErr) {
    console.error('[DAL] Error fetching tenant bookings for travelers:', bErr);
    throw bErr;
  }

  // Group Inquiries & Bookings by traveler_id
  const inqMap = new Map<string, InquiryEntity[]>();
  ((inquiries || []) as DbInquiryRow[]).forEach((inq) => {
    const arr = inqMap.get(inq.traveler_id) || [];
    arr.push({
      id: inq.id,
      tenantId: inq.tenant_id,
      travelerId: inq.traveler_id,
      legacyLeadId: inq.legacy_lead_id,
      destination: inq.destination,
      leadSource: inq.lead_source,
      priority: inq.priority,
      pipelineStage: inq.pipeline_stage,
      expectedValue: inq.expected_value !== null && inq.expected_value !== undefined ? Number(inq.expected_value) : null,
      currency: inq.currency,
      assignedAgentId: inq.assigned_agent_id,
      lastContactedAt: inq.last_contacted_at,
      nextFollowUpAt: inq.next_follow_up_at,
      createdAt: inq.created_at,
      updatedAt: inq.updated_at,
      archivedAt: inq.archived_at,
      externalSource: inq.external_source,
      externalEventId: inq.external_event_id,
      identityReviewRequired: !!inq.identity_review_required,
      identityReviewReason: inq.identity_review_reason,
      proposedDisplayName: inq.proposed_display_name,
      proposedEmail: inq.proposed_email,
      proposedPhone: inq.proposed_phone,
    });
    inqMap.set(inq.traveler_id, arr);
  });

  const bkmMap = new Map<string, BookingEntity[]>();
  ((bookings || []) as DbBookingRow[]).forEach((bk) => {
    const arr = bkmMap.get(bk.traveler_id) || [];
    arr.push({
      id: bk.id,
      tenantId: bk.tenant_id,
      travelerId: bk.traveler_id,
      inquiryId: bk.inquiry_id,
      legacyLeadId: bk.legacy_lead_id,
      bookingReference: bk.booking_reference,
      departureDate: bk.departure_date,
      returnDate: bk.return_date,
      passengerCount: bk.passenger_count,
      totalAmount: bk.total_amount !== null && bk.total_amount !== undefined ? Number(bk.total_amount) : null,
      paidAmount: bk.paid_amount !== null && bk.paid_amount !== undefined ? Number(bk.paid_amount) : null,
      balanceDue: bk.balance_due !== null && bk.balance_due !== undefined ? Number(bk.balance_due) : null,
      currency: bk.currency,
      bookingStatus: bk.booking_status,
      paymentStatus: bk.payment_status,
      fulfillmentStatus: bk.fulfillment_status,
      financialDataComplete: !!bk.financial_data_complete,
      assignedAgentId: bk.assigned_agent_id,
      createdAt: bk.created_at,
      updatedAt: bk.updated_at,
      archivedAt: bk.archived_at,
    });
    bkmMap.set(bk.traveler_id, arr);
  });

  // Map each TravelerProfile to a single TravelerDirectoryItem
  return (profiles as DbTravelerProfileRow[]).map((p) => {
    const travInqs = inqMap.get(p.id) || [];
    const travBks = bkmMap.get(p.id) || [];

    // Latest Destination logic
    let latestDest: string | null = null;
    const inqsWithDest = travInqs
      .filter((i) => i.destination && i.destination.trim().length > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (inqsWithDest.length > 0) {
      latestDest = inqsWithDest[0].destination || null;
    }

    // Customer Value: Sum totalAmount ONLY where financialDataComplete === true
    const finCompleteBks = travBks.filter((b) => b.financialDataComplete && b.totalAmount !== null && b.totalAmount !== undefined);
    let customerValue: number | null = null;
    if (finCompleteBks.length > 0) {
      customerValue = finCompleteBks.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
    }

    // Identity review indicator
    const hasIdentityReview = travInqs.some((i) => i.identityReviewRequired);

    return {
      id: p.id,
      tenantId: p.tenant_id,
      displayName: p.display_name,
      email: p.email || null,
      phone: p.phone || p.normalized_phone || null,
      normalizedPhone: p.normalized_phone || null,
      inquiriesCount: travInqs.length,
      bookingsCount: travBks.length,
      latestDestination: latestDest,
      customerValue,
      hasIdentityReview,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  });
}

export async function getTenantTravelerKPIs(tenantId: string): Promise<TravelerKPIs> {
  const directory = await getTenantTravelers(tenantId);

  const db = requireClient();

  // 1. Total Travelers = count of tenant-scoped TravelerProfiles
  const totalTravelers = directory.length;

  // 2. Repeat Travelers = Travelers with >= 2 non-archived Bookings
  const repeatTravelers = directory.filter((d) => d.bookingsCount >= 2).length;

  // 3. Active Customers = Travelers with >= 1 non-archived Inquiry that is not booking_lost or booking_confirmed
  const travelerIds = directory.map((d) => d.id);
  let activeCustomers = 0;

  if (travelerIds.length > 0) {
    const { data: activeInqs } = await db
      .from('inquiries')
      .select('traveler_id, pipeline_stage')
      .eq('tenant_id', tenantId)
      .in('traveler_id', travelerIds)
      .is('archived_at', null)
      .not('pipeline_stage', 'in', '("booking_lost","booking_confirmed")');

    const activeSet = new Set(((activeInqs || []) as DbInquiryRow[]).map((i) => i.traveler_id));
    activeCustomers = activeSet.size;
  }

  return {
    totalTravelers,
    repeatTravelers,
    activeCustomers,
  };
}
