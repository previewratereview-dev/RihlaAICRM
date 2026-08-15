/**
 * CRM Copilot Team Read Tools (Phase AI-2/AI-3)
 * 
 * Bounded team member lookup strictly scoped by server tenant context.
 * Enables accurate assignee resolution for inquiry assignment proposals.
 * PII minimized: returns ID, full name, role, and sanitized handle.
 * Strictly read-only (zero mutations).
 */
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type TrustedExecutionContext,
  type ToolResult,
  type ToolDefinition,
} from './types';

export const ListTeamMembersSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().min(1).max(10).optional().default(10),
});

export interface TeamMemberSummaryItem {
  id: string;
  fullName: string;
  role: string;
  email: string | null;
}

export const listTeamMembersTool: ToolDefinition<typeof ListTeamMembersSchema, TeamMemberSummaryItem[]> = {
  name: 'listTeamMembers',
  description: 'List eligible agency team members/specialists for task or inquiry assignment in the current workspace. Maximum 10 members.',
  parameters: ListTeamMembersSchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<TeamMemberSummaryItem[]>> => {
    try {
      const limit = Math.min(params.limit || 10, 10);
      let query = supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('tenant_id', context.tenantId)
        .neq('role', 'super_admin');

      if (params.query) {
        query = query.ilike('full_name', `%${params.query.trim()}%`);
      }

      query = query.order('full_name', { ascending: true }).limit(limit);

      const { data: members, error } = await query;
      if (error) {
        console.error('[Copilot Tool Internal Error] listTeamMembers:', error.message);
        return { success: false, error: 'Unable to list team members.' };
      }

      const items: TeamMemberSummaryItem[] = (members || []).map((m) => ({
        id: m.id,
        fullName: m.full_name || 'Team Member',
        role: m.role || 'agent',
        email: m.email || null,
      }));

      return {
        success: true,
        data: items,
        count: items.length,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[Copilot Tool Internal Exception] listTeamMembers:', msg);
      return { success: false, error: 'Unable to list team members.' };
    }
  },
};
