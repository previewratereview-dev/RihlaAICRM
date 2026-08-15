/**
 * CRM Copilot Task Read Tools (Phase AI-2)
 * 
 * Bounded task lookup strictly scoped by server tenant context.
 * Resolves canonical inquiry ID to compatibility legacy lead ID server-side.
 * Strictly read-only (zero task creation, updates, or status changes).
 * Sanitizes all error messages to prevent database/SQL leakage.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type TrustedExecutionContext,
  type ToolResult,
  type ToolDefinition,
  ListTasksSchema,
} from './types';

export interface TaskSummaryItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  dueDate: string | null;
  assignedTo: string | null;
  inquiryId?: string | null;
  createdAt: string | null;
}

export const listTasksTool: ToolDefinition<typeof ListTasksSchema, TaskSummaryItem[]> = {
  name: 'listTasks',
  description: 'List CRM tasks/follow-ups in the current agency. Filter by inquiry ID, status (pending/in_progress/completed/all), or assigned user.',
  parameters: ListTasksSchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<TaskSummaryItem[]>> => {
    try {
      const limit = Math.min(params.limit || 5, 10);
      let targetLegacyLeadId: string | null = null;

      if (params.inquiryId) {
        const inquiryId = params.inquiryId.trim();
        // Resolve canonical inquiry to determine its linked legacy_lead_id
        const { data: inq } = await supabase
          .from('inquiries')
          .select('id, legacy_lead_id')
          .eq('id', inquiryId)
          .eq('tenant_id', context.tenantId)
          .maybeSingle();

        // If inquiry not found or has no legacy_lead_id linked, no legacy child tasks exist
        if (!inq || !inq.legacy_lead_id) {
          return {
            success: true,
            data: [],
            count: 0,
            hasMore: false,
          };
        }

        targetLegacyLeadId = inq.legacy_lead_id;
      }

      let query = supabase
        .from('tasks')
        .select(`
          id,
          title,
          status,
          priority,
          type,
          due_date,
          assigned_to,
          lead_id,
          created_at
        `)
        .eq('tenant_id', context.tenantId);

      if (targetLegacyLeadId) {
        query = query.eq('lead_id', targetLegacyLeadId);
      }

      if (params.status && params.status !== 'all') {
        query = query.eq('status', params.status);
      }

      if (params.assignedTo) {
        query = query.eq('assigned_to', params.assignedTo.trim());
      }

      query = query.order('due_date', { ascending: true }).limit(limit + 1);

      const { data: tasks, error } = await query;
      if (error) {
        console.error('[Copilot Tool Internal Error] listTasks:', error.message);
        return { success: false, error: 'Unable to list tasks.' };
      }

      const rows = tasks || [];
      const hasMore = rows.length > limit;
      const results = rows.slice(0, limit);

      const items: TaskSummaryItem[] = results.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status || 'pending',
        priority: t.priority || 'medium',
        type: t.type || 'follow_up',
        dueDate: t.due_date || null,
        assignedTo: t.assigned_to || null,
        inquiryId: t.lead_id || null,
        createdAt: t.created_at || null,
      }));

      return {
        success: true,
        data: items,
        count: items.length,
        hasMore,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[Copilot Tool Internal Exception] listTasks:', msg);
      return { success: false, error: 'Unable to list tasks.' };
    }
  },
};
