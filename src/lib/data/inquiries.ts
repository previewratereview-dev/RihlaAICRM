import { supabase } from '../supabase';
import { assertTenantId } from './access';
import type { InquiryDirectoryItem } from '@/types';

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
}

interface DbTravelerProfileRow {
  id: string;
  tenant_id: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  normalized_phone?: string | null;
}

function requireClient() {
  if (!supabase) {
    throw new Error('Data access requires a configured database connection');
  }
  return supabase;
}

export async function getTenantInquiries(tenantId: string): Promise<InquiryDirectoryItem[]> {
  assertTenantId(tenantId);
  const db = requireClient();

  // 1. Fetch non-archived inquiries
  const { data: inquiries, error: iErr } = await db
    .from('inquiries')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (iErr) {
    console.error('[DAL] Error fetching tenant inquiries:', iErr);
    throw iErr;
  }

  if (!inquiries || inquiries.length === 0) {
    return [];
  }

  // 2. Collect traveler IDs
  const travelerIds = Array.from(new Set((inquiries as DbInquiryRow[]).map(i => i.traveler_id)));

  // 3. Fetch traveler profiles
  const { data: profiles, error: pErr } = await db
    .from('traveler_profiles')
    .select('id, tenant_id, display_name, email, phone, normalized_phone')
    .eq('tenant_id', tenantId)
    .in('id', travelerIds);

  if (pErr) {
    console.error('[DAL] Error fetching tenant traveler profiles for inquiries:', pErr);
    throw pErr;
  }

  const profileMap = new Map<string, DbTravelerProfileRow>();
  ((profiles || []) as DbTravelerProfileRow[]).forEach(p => {
    profileMap.set(p.id, p);
  });

  // 4. Map to InquiryDirectoryItem
  const items: InquiryDirectoryItem[] = [];

  for (const inq of inquiries as DbInquiryRow[]) {
    const profile = profileMap.get(inq.traveler_id);
    if (!profile) {
      // Missing or cross-tenant traveler is an integrity failure as per directive
      console.error(`[DAL] Integrity failure: Inquiry ${inq.id} references missing traveler ${inq.traveler_id}`);
      continue;
    }

    items.push({
      inquiryId: inq.id,
      legacyLeadId: inq.legacy_lead_id || null,
      travelerId: inq.traveler_id,
      travelerDisplayName: profile.display_name,
      travelerEmail: profile.email || null,
      travelerPhone: profile.phone || profile.normalized_phone || null,
      destination: inq.destination || null,
      pipelineStage: inq.pipeline_stage,
      priority: inq.priority,
      expectedValue: inq.expected_value !== null && inq.expected_value !== undefined ? Number(inq.expected_value) : null,
      currency: inq.currency || 'INR',
      leadSource: inq.lead_source,
      assignedAgentId: inq.assigned_agent_id || null,
      lastContactedAt: inq.last_contacted_at || null,
      nextFollowUpAt: inq.next_follow_up_at || null,
      identityReviewRequired: !!inq.identity_review_required,
      identityReviewReason: inq.identity_review_reason || null,
      createdAt: inq.created_at,
    });
  }

  return items;
}
