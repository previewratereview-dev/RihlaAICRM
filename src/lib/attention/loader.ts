/**
 * Phase AI-4B: Server-Authoritative Attention Facts Loader
 * 
 * Executes exclusively in trusted server context.
 * - Enforces server session / profile / tenant boundary
 * - Rejects Platform Super Admin (Fail Closed)
 * - Queries canonical public.inquiries & public.conversations
 * - Fetches message metadata ONLY (ZERO message text bodies)
 * - Paginates batches to ensure completeness beyond PostgREST 1000-row limit
 * - Normalizes DB entities into NormalizedInquiryFact & NormalizedConversationFact DTOs
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACTIVE_INQUIRY_STAGES,
  type NormalizedInquiryFact,
  type NormalizedConversationFact,
  type AttentionSignal,
  type TenantAttentionSummary,
} from './types';
import {
  evaluateInquiryAttention,
  evaluateTenantAttention,
} from './engine';

export interface AttentionAuthContext {
  userId: string;
  tenantId: string;
  role: string;
  fullName: string;
}

export interface AttentionAuthResult {
  success: boolean;
  auth?: AttentionAuthContext;
  error?: string;
}

/**
 * Validates server session and profile authority.
 * Fails closed for Super Admin and invalid tenant scopes.
 */
export async function validateAttentionAuth(
  supabase: SupabaseClient,
  overrideAuth?: AttentionAuthContext
): Promise<AttentionAuthResult> {
  if (overrideAuth) {
    if (overrideAuth.role === 'super_admin') {
      return {
        success: false,
        error: 'Forbidden: Platform Super Admin cannot access Agency attention data',
      };
    }
    if (!overrideAuth.tenantId || overrideAuth.tenantId === 'global') {
      return {
        success: false,
        error: 'Forbidden: Valid agency tenant context required',
      };
    }
    return { success: true, auth: overrideAuth };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return {
      success: false,
      error: 'Unauthorized: No active authenticated session',
    };
  }

  const userId = authData.user.id;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, full_name, email')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    return {
      success: false,
      error: 'Unauthorized: Profile record not found',
    };
  }

  if (profile.role === 'super_admin') {
    return {
      success: false,
      error: 'Forbidden: Platform Super Admin cannot access Agency attention data',
    };
  }

  if (!profile.tenant_id || profile.tenant_id === 'global') {
    return {
      success: false,
      error: 'Forbidden: Valid agency tenant context required',
    };
  }

  return {
    success: true,
    auth: {
      userId: profile.id,
      tenantId: profile.tenant_id,
      role: profile.role,
      fullName: profile.full_name || profile.email || 'Agent',
    },
  };
}

/**
 * Helper to parse various legacy budget formats into min/max numeric values.
 */
export function parseBudgetValue(
  budgetString: string | null | undefined,
  expectedValue: number | string | null | undefined
): { min: number | null; max: number | null } {
  let min: number | null = null;
  let max: number | null = null;

  if (expectedValue !== null && expectedValue !== undefined) {
    const num = typeof expectedValue === 'number' ? expectedValue : parseFloat(String(expectedValue));
    if (!isNaN(num) && num > 0) {
      min = num;
      max = num;
    }
  }

  if (budgetString && budgetString.trim() !== '') {
    const cleaned = budgetString.replace(/[₹$,]/g, '').trim();
    const isLakh = /lakh|lac|\bl\b/i.test(cleaned);
    const isThousands = /(?<!la[kc]h?)\bk\b|(?<=\d)k/i.test(cleaned);

    // Check for range: "50000 - 100000" or "50k - 100k"
    const rangeMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:k|lakh|lac|l)?\s*[-–to]\s*(\d+(?:\.\d+)?)\s*(k|lakh|lac|l)?/i);
    if (rangeMatch) {
      let rMin = parseFloat(rangeMatch[1]);
      let rMax = parseFloat(rangeMatch[2]);
      if (isLakh) {
        if (rMin < 1000) rMin *= 100000;
        if (rMax < 1000) rMax *= 100000;
      } else if (isThousands) {
        if (rMin < 1000) rMin *= 1000;
        if (rMax < 1000) rMax *= 1000;
      }
      if (!isNaN(rMin) && rMin > 0) min = rMin;
      if (!isNaN(rMax) && rMax > 0) max = rMax;
    } else {
      // Single number match
      const singleMatch = cleaned.match(/(\d+(?:\.\d+)?)/);
      if (singleMatch) {
        let val = parseFloat(singleMatch[1]);
        if (isLakh) {
          if (val < 1000) val *= 100000;
        } else if (isThousands) {
          if (val < 1000) val *= 1000;
        }
        if (!isNaN(val) && val > 0) {
          min = val;
          max = val;
        }
      }
    }
  }

  return { min, max };
}

/**
 * Loads a single Inquiry Fact from the server database.
 */
export async function loadInquiryAttentionFact(
  supabase: SupabaseClient,
  tenantId: string,
  inquiryId: string
): Promise<NormalizedInquiryFact | null> {
  const { data: inq, error: inqErr } = await supabase
    .from('inquiries')
    .select(
      'id, tenant_id, legacy_lead_id, traveler_id, pipeline_stage, assigned_agent_id, next_follow_up_at, destination, expected_value, currency, archived_at'
    )
    .eq('tenant_id', tenantId)
    .eq('id', inquiryId)
    .maybeSingle();

  if (inqErr || !inq) {
    return null;
  }

  let departureDate: string | null = null;
  let returnDate: string | null = null;
  let numberOfTravelers: number | null = null;
  let budgetString: string | null = null;
  let tripType: string | null = null;

  if (inq.legacy_lead_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('departure_date, return_date, number_of_travelers, budget, trip_type')
      .eq('tenant_id', tenantId)
      .eq('id', inq.legacy_lead_id)
      .maybeSingle();

    if (lead) {
      departureDate = lead.departure_date || null;
      returnDate = lead.return_date || null;
      if (lead.number_of_travelers) {
        const num = parseInt(String(lead.number_of_travelers), 10);
        numberOfTravelers = !isNaN(num) && num > 0 ? num : null;
      }
      budgetString = lead.budget || null;
      tripType = lead.trip_type || null;
    }
  }

  const { min: budgetMin, max: budgetMax } = parseBudgetValue(
    budgetString,
    inq.expected_value
  );

  return {
    inquiryId: inq.id,
    tenantId: inq.tenant_id,
    legacyLeadId: inq.legacy_lead_id || null,
    travelerId: inq.traveler_id || null,
    pipelineStage: inq.pipeline_stage || 'inquiry_received',
    assignedAgentId: inq.assigned_agent_id || null,
    nextFollowUpAt: inq.next_follow_up_at || null,
    destination: inq.destination || null,
    departureDate,
    returnDate,
    numberOfTravelers,
    budgetMin,
    budgetMax,
    expectedValue: inq.expected_value ? Number(inq.expected_value) : null,
    currency: inq.currency || 'INR',
    tripType,
    isArchived: !!inq.archived_at,
  };
}

/**
 * Loads conversation attention facts for an Inquiry or Conversation.
 * ZERO message bodies fetched — only sender_type and timestamps.
 */
export async function loadConversationAttentionFacts(
  supabase: SupabaseClient,
  tenantId: string,
  inquiryIdOrConversationId: string
): Promise<NormalizedConversationFact[]> {
  // Query conversations matching inquiryId, legacyLeadId, or direct conversationId
  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('id, tenant_id, inquiry_id, legacy_lead_id, channel, status')
    .eq('tenant_id', tenantId)
    .or(
      `id.eq.${inquiryIdOrConversationId},inquiry_id.eq.${inquiryIdOrConversationId},legacy_lead_id.eq.${inquiryIdOrConversationId}`
    );

  if (error || !conversations || conversations.length === 0) {
    return [];
  }

  const results: NormalizedConversationFact[] = [];

  for (const conv of conversations) {
    // Query message metadata ONLY
    const { data: messages } = await supabase
      .from('messages')
      .select('sender_type, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });

    let latestContactAt: string | null = null;
    let latestAgentAfterContactAt: string | null = null;

    if (messages && messages.length > 0) {
      for (const msg of messages) {
        if (msg.sender_type === 'contact') {
          latestContactAt = msg.created_at;
          latestAgentAfterContactAt = null; // Reset reply status on new customer message
        } else if (msg.sender_type === 'agent') {
          if (latestContactAt && Date.parse(msg.created_at) >= Date.parse(latestContactAt)) {
            latestAgentAfterContactAt = msg.created_at;
          }
        }
        // Note: sender_type === 'system' is intentionally ignored (does not count as customer or agent)
      }
    }

    results.push({
      conversationId: conv.id,
      inquiryId: conv.inquiry_id || null,
      legacyLeadId: conv.legacy_lead_id || null,
      tenantId: conv.tenant_id,
      channel: conv.channel || 'chat',
      status: conv.status || 'open',
      latestContactAt,
      latestAgentAfterContactAt,
    });
  }

  return results;
}

/**
 * Loads full tenant attention facts with pagination completeness for >1000 rows.
 */
export async function loadTenantAttentionFacts(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{
  inquiryFacts: NormalizedInquiryFact[];
  conversationFacts: NormalizedConversationFact[];
}> {
  const batchSize = 1000;

  // 1. Paginated load of all active inquiries
  const rawInquiries: Array<{
    id: string;
    tenant_id: string;
    legacy_lead_id: string | null;
    traveler_id: string | null;
    pipeline_stage: string;
    assigned_agent_id: string | null;
    next_follow_up_at: string | null;
    destination: string | null;
    expected_value: number | string | null;
    currency: string;
    archived_at: string | null;
  }> = [];

  let inqOffset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('inquiries')
      .select(
        'id, tenant_id, legacy_lead_id, traveler_id, pipeline_stage, assigned_agent_id, next_follow_up_at, destination, expected_value, currency, archived_at'
      )
      .eq('tenant_id', tenantId)
      .is('archived_at', null)
      .in('pipeline_stage', ACTIVE_INQUIRY_STAGES as unknown as string[])
      .range(inqOffset, inqOffset + batchSize - 1);

    if (error) {
      throw error;
    }
    if (!data || data.length === 0) break;
    rawInquiries.push(...data);
    if (data.length < batchSize) break;
    inqOffset += batchSize;
  }

  // 2. Load linked leads for qualification fields
  const legacyLeadIds = rawInquiries
    .map((i) => i.legacy_lead_id)
    .filter((id): id is string => !!id);

  const leadsMap = new Map<
    string,
    {
      departure_date?: string | null;
      return_date?: string | null;
      number_of_travelers?: string | null;
      budget?: string | null;
      trip_type?: string | null;
    }
  >();

  const chunkSize = 500;
  for (let i = 0; i < legacyLeadIds.length; i += chunkSize) {
    const chunk = legacyLeadIds.slice(i, i + chunkSize);
    const { data: leads } = await supabase
      .from('leads')
      .select('id, departure_date, return_date, number_of_travelers, budget, trip_type')
      .eq('tenant_id', tenantId)
      .in('id', chunk);

    if (leads) {
      for (const lead of leads) {
        leadsMap.set(lead.id, lead);
      }
    }
  }

  // Map to NormalizedInquiryFact[]
  const inquiryFacts: NormalizedInquiryFact[] = rawInquiries.map((inq) => {
    const lead = inq.legacy_lead_id ? leadsMap.get(inq.legacy_lead_id) : undefined;
    let numberOfTravelers: number | null = null;
    if (lead?.number_of_travelers) {
      const num = parseInt(String(lead.number_of_travelers), 10);
      numberOfTravelers = !isNaN(num) && num > 0 ? num : null;
    }

    const { min: budgetMin, max: budgetMax } = parseBudgetValue(
      lead?.budget,
      inq.expected_value
    );

    return {
      inquiryId: inq.id,
      tenantId: inq.tenant_id,
      legacyLeadId: inq.legacy_lead_id || null,
      travelerId: inq.traveler_id || null,
      pipelineStage: inq.pipeline_stage || 'inquiry_received',
      assignedAgentId: inq.assigned_agent_id || null,
      nextFollowUpAt: inq.next_follow_up_at || null,
      destination: inq.destination || null,
      departureDate: lead?.departure_date || null,
      returnDate: lead?.return_date || null,
      numberOfTravelers,
      budgetMin,
      budgetMax,
      expectedValue: inq.expected_value ? Number(inq.expected_value) : null,
      currency: inq.currency || 'INR',
      tripType: lead?.trip_type || null,
      isArchived: !!inq.archived_at,
    };
  });

  // 3. Paginated load of open conversations
  const rawConversations: Array<{
    id: string;
    tenant_id: string;
    inquiry_id: string | null;
    legacy_lead_id: string | null;
    channel: string;
    status: string;
  }> = [];

  let convOffset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, tenant_id, inquiry_id, legacy_lead_id, channel, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .range(convOffset, convOffset + batchSize - 1);

    if (error) {
      throw error;
    }
    if (!data || data.length === 0) break;
    rawConversations.push(...data);
    if (data.length < batchSize) break;
    convOffset += batchSize;
  }

  // 4. Batch fetch messages metadata for open conversations
  const conversationFacts: NormalizedConversationFact[] = [];
  const convIds = rawConversations.map((c) => c.id);

  const messagesByConv = new Map<string, Array<{ sender_type: string; created_at: string }>>();

  for (let i = 0; i < convIds.length; i += chunkSize) {
    const chunk = convIds.slice(i, i + chunkSize);
    const { data: msgs } = await supabase
      .from('messages')
      .select('conversation_id, sender_type, created_at')
      .in('conversation_id', chunk)
      .order('created_at', { ascending: true });

    if (msgs) {
      for (const m of msgs) {
        if (!messagesByConv.has(m.conversation_id)) {
          messagesByConv.set(m.conversation_id, []);
        }
        messagesByConv.get(m.conversation_id)!.push(m);
      }
    }
  }

  for (const conv of rawConversations) {
    const msgs = messagesByConv.get(conv.id) || [];
    let latestContactAt: string | null = null;
    let latestAgentAfterContactAt: string | null = null;

    for (const msg of msgs) {
      if (msg.sender_type === 'contact') {
        latestContactAt = msg.created_at;
        latestAgentAfterContactAt = null;
      } else if (msg.sender_type === 'agent') {
        if (latestContactAt && Date.parse(msg.created_at) >= Date.parse(latestContactAt)) {
          latestAgentAfterContactAt = msg.created_at;
        }
      }
    }

    conversationFacts.push({
      conversationId: conv.id,
      inquiryId: conv.inquiry_id || null,
      legacyLeadId: conv.legacy_lead_id || null,
      tenantId: conv.tenant_id,
      channel: conv.channel || 'chat',
      status: conv.status || 'open',
      latestContactAt,
      latestAgentAfterContactAt,
    });
  }

  return { inquiryFacts, conversationFacts };
}

/**
 * High-level server entry point: Get attention signals for a specific Inquiry.
 */
export async function getInquiryAttentionSignals(
  supabase: SupabaseClient,
  tenantId: string,
  inquiryId: string,
  evaluatedAt: Date | string = new Date()
): Promise<AttentionSignal[]> {
  const inqFact = await loadInquiryAttentionFact(supabase, tenantId, inquiryId);
  if (!inqFact) return [];

  return evaluateInquiryAttention(inqFact, evaluatedAt);
}

/**
 * High-level server entry point: Get full attention summary for an Agency tenant.
 */
export async function getTenantAttentionSummary(
  supabase: SupabaseClient,
  tenantId: string,
  evaluatedAt: Date | string = new Date()
): Promise<TenantAttentionSummary> {
  const { inquiryFacts, conversationFacts } = await loadTenantAttentionFacts(
    supabase,
    tenantId
  );

  return evaluateTenantAttention(
    tenantId,
    inquiryFacts,
    conversationFacts,
    evaluatedAt
  );
}
