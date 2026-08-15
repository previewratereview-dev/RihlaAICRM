/**
 * CRM Copilot Tool Types & Interfaces (Phase AI-2)
 * 
 * Defines trusted execution context, tool definitions, input/output schemas,
 * and structured citation contracts for read-only CRM intelligence.
 */
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface TrustedExecutionContext {
  userId: string;
  tenantId: string;
  role: string;
  fullName: string;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
  hasMore?: boolean;
}

export interface KnowledgeSource {
  sourceId: string;
  title: string;
  sourceType: string;
  excerpt: string;
  score?: number;
}

export interface KnowledgeSearchResult {
  answerContext: string;
  sources: KnowledgeSource[];
}

export interface ToolDefinition<TSchema extends z.ZodType = z.ZodType, TData = unknown> {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (
    context: TrustedExecutionContext,
    params: z.input<TSchema>,
    supabase: SupabaseClient
  ) => Promise<ToolResult<TData>>;
}

// ─── Tool Input Schemas ──────────────────────────────────────────

export const SearchInquiriesSchema = z.object({
  query: z.string().optional().describe('Text search across destination or inquiry metadata'),
  destination: z.string().optional().describe('Filter by travel destination, e.g. "Dubai", "Switzerland"'),
  stage: z.string().optional().describe('Filter by pipeline stage, e.g. "new", "quoted", "customizing_package"'),
  priority: z.string().optional().describe('Filter by priority, e.g. "low", "medium", "high", "urgent"'),
  assignedAgentId: z.string().optional().describe('Filter by assigned agent ID'),
  travelerId: z.string().optional().describe('Filter by canonical traveler ID'),
  limit: z.number().int().min(1).max(10).optional().default(5).describe('Max results to return (max 10)'),
});

export const GetInquiryDetailsSchema = z.object({
  inquiryId: z.string().min(1).describe('The canonical ID of the inquiry to retrieve'),
});

export const SearchTravelersSchema = z.object({
  query: z.string().min(1).describe('Name, email handle, or search term for the traveler'),
  limit: z.number().int().min(1).max(5).optional().default(5).describe('Max results to return (max 5)'),
});

export const GetTravelerHistorySchema = z.object({
  travelerId: z.string().min(1).describe('The canonical traveler profile ID'),
});

export const GetBookingDetailsSchema = z.object({
  bookingId: z.string().optional().describe('The canonical booking ID'),
  bookingReference: z.string().optional().describe('The alphanumeric booking reference code'),
});

export const ListTasksSchema = z.object({
  inquiryId: z.string().optional().describe('Filter tasks linked to a specific inquiry/lead'),
  status: z.enum(['pending', 'in_progress', 'completed', 'overdue', 'all']).optional().default('pending'),
  assignedTo: z.string().optional().describe('Filter by assigned user ID'),
  limit: z.number().int().min(1).max(10).optional().default(5).describe('Max results to return (max 10)'),
});

export const GetRecentActivitySchema = z.object({
  inquiryId: z.string().optional().describe('Inquiry/lead ID to fetch activity timeline for'),
  limit: z.number().int().min(1).max(15).optional().default(10).describe('Max timeline events to return (max 15)'),
});

export const SearchAgencyKnowledgeSchema = z.object({
  query: z.string().min(1).describe('The question or topic to search within agency policies, FAQs, and guides'),
  limit: z.number().int().min(1).max(5).optional().default(4).describe('Max source passages to return (max 5)'),
});
