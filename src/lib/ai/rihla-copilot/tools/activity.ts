/**
 * CRM Copilot Activity & Timeline Read Tools (Phase AI-2)
 * 
 * Bounded activity timeline lookup strictly scoped by server tenant context.
 * Resolves canonical inquiry ID to compatibility legacy lead ID server-side.
 * PII minimized: truncates long text bodies and returns concise timeline entries.
 * Sanitizes all error messages to prevent database/SQL leakage.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type TrustedExecutionContext,
  type ToolResult,
  type ToolDefinition,
  GetRecentActivitySchema,
} from './types';

export interface TimelineEventItem {
  id: string;
  type: string;
  title: string;
  summary: string;
  timestamp: string;
  userName?: string | null;
}

export const getRecentActivityTool: ToolDefinition<typeof GetRecentActivitySchema, TimelineEventItem[]> = {
  name: 'getRecentActivity',
  description: 'Retrieve recent timeline activity events (calls, notes, stage changes, emails) for an inquiry. Maximum 15 events.',
  parameters: GetRecentActivitySchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<TimelineEventItem[]>> => {
    try {
      const limit = Math.min(params.limit || 10, 15);
      const inquiryId = params.inquiryId?.trim();

      if (!inquiryId) {
        return { success: false, error: 'Inquiry ID is required to fetch timeline activity.' };
      }

      // Resolve canonical inquiry to determine if there is a linked legacy_lead_id
      const { data: inq } = await supabase
        .from('inquiries')
        .select('id, legacy_lead_id')
        .eq('id', inquiryId)
        .eq('tenant_id', context.tenantId)
        .maybeSingle();

      const candidateLeadIds = inq
        ? (Array.from(new Set([inq.id, inq.legacy_lead_id].filter(Boolean))) as string[])
        : [inquiryId];

      let query = supabase
        .from('activities')
        .select('id, type, title, description, created_at, user_name')
        .eq('tenant_id', context.tenantId);

      if (candidateLeadIds.length === 1) {
        query = query.eq('lead_id', candidateLeadIds[0]);
      } else {
        query = query.in('lead_id', candidateLeadIds);
      }

      query = query.order('created_at', { ascending: false }).limit(limit + 1);

      const { data: activities, error } = await query;
      if (error) {
        console.error('[Copilot Tool Internal Error] getRecentActivity:', error.message);
        return { success: false, error: 'Unable to retrieve timeline activity.' };
      }

      const rows = activities || [];
      const hasMore = rows.length > limit;
      const results = rows.slice(0, limit);

      const items: TimelineEventItem[] = results.map((a) => {
        const rawDesc = a.description || '';
        const summary = rawDesc.length > 150 ? `${rawDesc.slice(0, 147)}...` : rawDesc;

        return {
          id: a.id,
          type: a.type || 'activity',
          title: a.title || 'Activity',
          summary,
          timestamp: a.created_at || '',
          userName: a.user_name || null,
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
      console.error('[Copilot Tool Internal Exception] getRecentActivity:', msg);
      return { success: false, error: 'Unable to retrieve timeline activity.' };
    }
  },
};
