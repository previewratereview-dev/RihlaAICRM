/**
 * CRM Copilot Inquiry Read Tools (Phase AI-2)
 * 
 * Bounded, canonical inquiry reads strictly scoped by server tenant context.
 * Opportunities are always labeled as estimates, not recognized revenue.
 * Sanitizes all error messages to prevent database/SQL leakage.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type TrustedExecutionContext,
  type ToolResult,
  type ToolDefinition,
  SearchInquiriesSchema,
  GetInquiryDetailsSchema,
} from './types';
import type { InquirySummaryDTO } from '../crm-context-resolver';

export interface InquirySearchResultItem {
  id: string;
  destination: string;
  stage: string;
  priority: string;
  departureDate: string | null;
  returnDate: string | null;
  expectedOpportunityValue: string;
  assignedAgentId: string | null;
  travelerDisplayName?: string | null;
  createdAt: string | null;
}

export const searchInquiriesTool: ToolDefinition<typeof SearchInquiriesSchema, InquirySearchResultItem[]> = {
  name: 'searchInquiries',
  description: 'Search inquiries within the current agency by destination, stage, priority, traveler, or text query. Maximum 10 results returned.',
  parameters: SearchInquiriesSchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<InquirySearchResultItem[]>> => {
    try {
      const limit = Math.min(params.limit || 5, 10);
      let query = supabase
        .from('inquiries')
        .select(`
          id,
          destination,
          pipeline_stage,
          priority,
          expected_value,
          currency,
          departure_date,
          return_date,
          assigned_agent_id,
          traveler_id,
          created_at
        `)
        .eq('tenant_id', context.tenantId)
        .is('archived_at', null);

      if (params.destination) {
        query = query.ilike('destination', `%${params.destination.trim()}%`);
      }
      if (params.stage) {
        query = query.eq('pipeline_stage', params.stage.trim());
      }
      if (params.priority) {
        query = query.eq('priority', params.priority.trim());
      }
      if (params.assignedAgentId) {
        query = query.eq('assigned_agent_id', params.assignedAgentId.trim());
      }
      if (params.travelerId) {
        query = query.eq('traveler_id', params.travelerId.trim());
      }
      if (params.query && !params.destination) {
        query = query.ilike('destination', `%${params.query.trim()}%`);
      }

      query = query.order('created_at', { ascending: false }).limit(limit + 1);

      const { data: inqs, error } = await query;
      if (error) {
        console.error('[Copilot Tool Internal Error] searchInquiries:', error.message);
        return { success: false, error: 'Unable to search inquiries.' };
      }

      const rows = inqs || [];
      const hasMore = rows.length > limit;
      const results = rows.slice(0, limit);

      // Resolve linked traveler names in a bounded batch
      const travelerIds = Array.from(new Set(results.map((r) => r.traveler_id).filter(Boolean)));
      const travelerNameMap = new Map<string, string>();

      if (travelerIds.length > 0) {
        const { data: travelers } = await supabase
          .from('traveler_profiles')
          .select('id, display_name')
          .eq('tenant_id', context.tenantId)
          .in('id', travelerIds);

        for (const t of travelers || []) {
          travelerNameMap.set(t.id, t.display_name);
        }
      }

      const items: InquirySearchResultItem[] = results.map((r) => {
        const valStr = r.expected_value !== null && r.expected_value !== undefined
          ? `${r.currency || 'INR'} ${r.expected_value}`
          : 'Not specified';

        return {
          id: r.id,
          destination: r.destination || 'Unspecified destination',
          stage: r.pipeline_stage || 'new',
          priority: r.priority || 'medium',
          departureDate: r.departure_date || null,
          returnDate: r.return_date || null,
          expectedOpportunityValue: valStr,
          assignedAgentId: r.assigned_agent_id || null,
          travelerDisplayName: r.traveler_id ? travelerNameMap.get(r.traveler_id) || null : null,
          createdAt: r.created_at || null,
        };
      });

      return {
        success: true,
        data: items,
        count: items.length,
        hasMore,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[Copilot Tool Internal Exception] searchInquiries:', msg);
      return { success: false, error: 'Unable to search inquiries.' };
    }
  },
};

export const getInquiryDetailsTool: ToolDefinition<typeof GetInquiryDetailsSchema, InquirySummaryDTO> = {
  name: 'getInquiryDetails',
  description: 'Retrieve full canonical details for a specific inquiry by ID within the current workspace.',
  parameters: GetInquiryDetailsSchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<InquirySummaryDTO>> => {
    try {
      const inquiryId = params.inquiryId.trim();
      const { data: inquiry, error } = await supabase
        .from('inquiries')
        .select(`
          id,
          destination,
          pipeline_stage,
          priority,
          expected_value,
          currency,
          passenger_count,
          departure_date,
          return_date,
          special_requests,
          assigned_agent_id,
          traveler_id,
          created_at
        `)
        .eq('id', inquiryId)
        .eq('tenant_id', context.tenantId)
        .is('archived_at', null)
        .maybeSingle();

      if (error) {
        console.error('[Copilot Tool Internal Error] getInquiryDetails:', error.message);
        return { success: false, error: 'Unable to retrieve inquiry details.' };
      }

      if (!inquiry) {
        return { success: false, error: 'Inquiry not found in current workspace.' };
      }

      let linkedTraveler: InquirySummaryDTO['linkedTraveler'] = null;
      if (inquiry.traveler_id) {
        const { data: traveler } = await supabase
          .from('traveler_profiles')
          .select('id, display_name, email, phone')
          .eq('id', inquiry.traveler_id)
          .eq('tenant_id', context.tenantId)
          .maybeSingle();

        if (traveler) {
          linkedTraveler = {
            id: traveler.id,
            displayName: traveler.display_name || null,
            emailAvailable: !!traveler.email,
            phoneAvailable: !!traveler.phone,
          };
        }
      }

      const dto: InquirySummaryDTO = {
        id: inquiry.id,
        destination: inquiry.destination || null,
        stage: inquiry.pipeline_stage || null,
        priority: inquiry.priority || null,
        expectedValue: inquiry.expected_value !== null && inquiry.expected_value !== undefined ? Number(inquiry.expected_value) : null,
        currency: inquiry.currency || 'INR',
        travelersCount: inquiry.passenger_count !== null && inquiry.passenger_count !== undefined ? Number(inquiry.passenger_count) : null,
        departureDate: inquiry.departure_date || null,
        returnDate: inquiry.return_date || null,
        requirements: inquiry.special_requests || null,
        assignedAgentId: inquiry.assigned_agent_id || null,
        createdAt: inquiry.created_at || null,
        linkedTraveler,
      };

      return { success: true, data: dto };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[Copilot Tool Internal Exception] getInquiryDetails:', msg);
      return { success: false, error: 'Unable to retrieve inquiry details.' };
    }
  },
};
