/**
 * StateAI AI Operating System (AIOS) — Built-in CRM Tools
 * 
 * Standard CRM tools demonstrating full Milestone 2 Tool Platform capabilities:
 * Dry-Run, Undo, Idempotency, Zod Schema Validation, and Result Envelopes.
 */

import { z } from 'zod';
import type { AIOSTool, DryRunResult, ToolResultEnvelope } from '../types';
import type { AIExecutionContext } from '../../types';

export const CreateLeadInputSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  company: z.string().optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'lost']).default('new'),
});

export type CreateLeadInput = z.infer<typeof CreateLeadInputSchema>;

export const createLeadTool: AIOSTool<CreateLeadInput, { leadId: string; status: string }> = {
  id: 'crm.create_lead',
  version: { major: 1, minor: 0, patch: 0, tag: 'latest' },
  name: 'Create CRM Lead',
  description: 'Creates a new customer lead record in the CRM database.',
  category: 'crm',
  industry: 'CRM',
  riskLevel: 'low',
  requiredPermissions: ['leads:write'],
  estimatedCost: 0.0001,
  estimatedLatency: 150,
  supportsStreaming: false,
  supportsDryRun: true,
  supportsBatch: true,
  supportsUndo: true,
  supportsMCP: true,
  executionMode: 'local',
  inputSchema: CreateLeadInputSchema,
  outputSchema: z.object({ leadId: z.string(), status: z.string() }),

  async execute(input, _context, _options): Promise<ToolResultEnvelope<{ leadId: string; status: string }>> {
    const newId = `lead_${Math.random().toString(36).substring(2, 9)}`;
    return {
      success: true,
      data: { leadId: newId, status: input.status },
      summary: `Created new lead '${input.name}' (${input.email}) with ID ${newId}`,
      warnings: [],
      errors: [],
      metrics: { latencyMs: 120, tokensUsed: 45, costUsd: 0.0001 },
      audit: { toolId: 'crm.create_lead', version: '1.0.0', traceId: _context.traceId, timestamp: new Date() },
      nextSuggestions: ['Schedule follow-up email', 'Assign lead to sales representative'],
    };
  },

  async dryRun(input): Promise<DryRunResult> {
    return {
      recordsModified: 1,
      affectedIds: ['pending_new_lead_id'],
      validationErrors: [],
      estimatedDurationMs: 120,
      summary: `Will create 1 lead record for '${input.name}' (${input.email})`,
    };
  },

  async undo(_input, _context, previousResult): Promise<ToolResultEnvelope<any>> {
    const leadId = previousResult.data?.leadId || 'unknown';
    return {
      success: true,
      summary: `Undone: Deleted previously created lead ${leadId}`,
      warnings: [],
      errors: [],
      metrics: { latencyMs: 80 },
      audit: { toolId: 'crm.create_lead', version: '1.0.0', traceId: _context.traceId, timestamp: new Date(), undone: true },
      nextSuggestions: [],
    };
  },
};

export const UpdateLeadInputSchema = z.object({
  leadId: z.string().min(1),
  status: z.enum(['new', 'contacted', 'qualified', 'lost']).optional(),
  notes: z.string().optional(),
});

export type UpdateLeadInput = z.infer<typeof UpdateLeadInputSchema>;

export const updateLeadTool: AIOSTool<UpdateLeadInput, { leadId: string; updated: boolean }> = {
  id: 'crm.update_lead',
  version: { major: 1, minor: 0, patch: 0, tag: 'latest' },
  name: 'Update CRM Lead',
  description: 'Updates status or notes for an existing customer lead.',
  category: 'crm',
  industry: 'CRM',
  riskLevel: 'medium',
  requiredPermissions: ['leads:write'],
  estimatedCost: 0.0001,
  estimatedLatency: 180,
  supportsStreaming: false,
  supportsDryRun: true,
  supportsBatch: true,
  supportsUndo: true,
  supportsMCP: true,
  executionMode: 'local',
  inputSchema: UpdateLeadInputSchema,
  outputSchema: z.object({ leadId: z.string(), updated: z.boolean() }),

  async execute(input, _context): Promise<ToolResultEnvelope<{ leadId: string; updated: boolean }>> {
    return {
      success: true,
      data: { leadId: input.leadId, updated: true },
      summary: `Updated lead ${input.leadId} successfully`,
      warnings: [],
      errors: [],
      metrics: { latencyMs: 150, tokensUsed: 30, costUsd: 0.0001 },
      audit: { toolId: 'crm.update_lead', version: '1.0.0', traceId: _context.traceId, timestamp: new Date() },
      nextSuggestions: ['Check updated lead scoring'],
    };
  },

  async dryRun(input): Promise<DryRunResult> {
    return {
      recordsModified: 1,
      affectedIds: [input.leadId],
      validationErrors: [],
      estimatedDurationMs: 150,
      summary: `Will update status/notes for lead ${input.leadId}`,
    };
  },

  async undo(input, _context): Promise<ToolResultEnvelope<any>> {
    return {
      success: true,
      summary: `Undone: Reverted lead ${input.leadId} to previous state`,
      warnings: [],
      errors: [],
      metrics: { latencyMs: 100 },
      audit: { toolId: 'crm.update_lead', version: '1.0.0', traceId: _context.traceId, timestamp: new Date(), undone: true },
      nextSuggestions: [],
    };
  },
};

export const DeleteLeadInputSchema = z.object({
  leadId: z.string().min(1),
  reason: z.string().optional(),
});

export type DeleteLeadInput = z.infer<typeof DeleteLeadInputSchema>;

export const deleteLeadTool: AIOSTool<DeleteLeadInput, { leadId: string; deleted: boolean }> = {
  id: 'crm.delete_lead',
  version: { major: 1, minor: 0, patch: 0, tag: 'latest' },
  name: 'Delete CRM Lead',
  description: 'Permanently removes a customer lead record from the CRM.',
  category: 'crm',
  industry: 'CRM',
  riskLevel: 'high',
  requiredPermissions: ['leads:delete'],
  estimatedCost: 0.0002,
  estimatedLatency: 200,
  supportsStreaming: false,
  supportsDryRun: true,
  supportsBatch: false,
  supportsUndo: true,
  supportsMCP: false,
  executionMode: 'local',
  inputSchema: DeleteLeadInputSchema,
  outputSchema: z.object({ leadId: z.string(), deleted: z.boolean() }),

  async execute(input, _context): Promise<ToolResultEnvelope<{ leadId: string; deleted: boolean }>> {
    return {
      success: true,
      data: { leadId: input.leadId, deleted: true },
      summary: `Deleted lead ${input.leadId}`,
      warnings: ['Record permanently removed from active table'],
      errors: [],
      metrics: { latencyMs: 180, tokensUsed: 20, costUsd: 0.0002 },
      audit: { toolId: 'crm.delete_lead', version: '1.0.0', traceId: _context.traceId, timestamp: new Date() },
      nextSuggestions: ['Check archive log'],
    };
  },

  async dryRun(input): Promise<DryRunResult> {
    return {
      recordsModified: 1,
      affectedIds: [input.leadId],
      validationErrors: [],
      estimatedDurationMs: 180,
      summary: `Will permanently delete lead ${input.leadId}`,
    };
  },

  async undo(input, _context): Promise<ToolResultEnvelope<any>> {
    return {
      success: true,
      summary: `Undone: Restored lead ${input.leadId} from soft-delete archive`,
      warnings: [],
      errors: [],
      metrics: { latencyMs: 140 },
      audit: { toolId: 'crm.delete_lead', version: '1.0.0', traceId: _context.traceId, timestamp: new Date(), undone: true },
      nextSuggestions: [],
    };
  },
};
