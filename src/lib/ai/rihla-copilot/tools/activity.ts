/**
 * CRM Copilot Activity & Timeline Read Tools (Phase AI-2)
 * 
 * Bounded activity timeline lookup strictly scoped by server tenant context.
 * PII minimized: truncates long text bodies and returns concise timeline entries.
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
        return { success: false, error: 'Inquiry ID is required to fetch timeline activity' };
      }

      const { data: activities, error } = await supabase
        .from('activities')
        .select('id, type, title, description, created_at, user_name')
        .eq('tenant_id', context.tenantId)
        .eq('lead_id', inquiryId)
        .order('created_at', { ascending: false })
        .limit(limit + 1);

      if (error) {
        console.error('[Copilot Tool Error] getRecentActivity failed:', error.message);
        return { success: false, error: 'Failed to retrieve timeline activity' };
      }

      const rows = activities || [];
      const hasMore = rows.length > limit;
      const results = rows.slice(0, limit);

      const items: TimelineEventItem[] = results.map((a) => {
        // Truncate long descriptions to minimize PII and payload size
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
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Copilot Tool Exception] getRecentActivity:', msg);
      return { success: false, error: 'Error fetching recent activity' };
    }
  },
};
