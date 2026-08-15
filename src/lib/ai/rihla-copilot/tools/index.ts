/**
 * Central CRM Copilot Tool Registry (Phase AI-2 / AI-3)
 * 
 * Aggregates all approved read tools and model-visible action proposal tools.
 * Enforces schema validation, injects trusted server execution context, and dispatches tool execution.
 * 
 * MODEL-VISIBLE READ TOOLS: 9
 * MODEL-VISIBLE PROPOSAL TOOLS: 3
 * MODEL-VISIBLE MUTATION TOOLS: 0 (Strict PROPOSE != EXECUTE separation)
 * EXTERNAL ACTION TOOLS: 0
 * FINANCE / BOOKING MUTATION TOOLS: 0
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProviderToolDefinition } from '@/lib/ai/providers/openai';
import {
  type TrustedExecutionContext,
  type ToolResult,
  type ToolDefinition,
} from './types';
import { searchInquiriesTool, getInquiryDetailsTool } from './inquiries';
import { searchTravelersTool, getTravelerHistoryTool } from './travelers';
import { getBookingDetailsTool } from './bookings';
import { listTasksTool } from './tasks';
import { getRecentActivityTool } from './activity';
import { searchAgencyKnowledgeTool } from './knowledge';
import {
  proposeUpdateInquiryStageTool,
  proposeAssignInquiryTool,
  proposeSetInquiryFollowUpTool,
  VALID_INQUIRY_STAGES,
} from '../actions/index';

export * from './types';
export * from './inquiries';
export * from './travelers';
export * from './bookings';
export * from './tasks';
export * from './activity';
export * from './knowledge';
export * from './team';

export const CRM_READ_TOOLS: Record<string, ToolDefinition> = {
  searchInquiries: searchInquiriesTool,
  getInquiryDetails: getInquiryDetailsTool,
  searchTravelers: searchTravelersTool,
  getTravelerHistory: getTravelerHistoryTool,
  getBookingDetails: getBookingDetailsTool,
  listTasks: listTasksTool,
  getRecentActivity: getRecentActivityTool,
  searchAgencyKnowledge: searchAgencyKnowledgeTool,
};

export const CRM_PROPOSAL_TOOLS: Record<string, ToolDefinition> = {
  proposeUpdateInquiryStage: proposeUpdateInquiryStageTool,
  proposeAssignInquiry: proposeAssignInquiryTool,
  proposeSetInquiryFollowUp: proposeSetInquiryFollowUpTool,
};

export const CRM_ALL_MODEL_TOOLS: Record<string, ToolDefinition> = {
  ...CRM_READ_TOOLS,
  ...CRM_PROPOSAL_TOOLS,
};

/**
 * Returns JSON Schema tool definitions for provider-native tool calling (OpenAI & Anthropic).
 */
export function getCrmCopilotProviderTools(includeProposals: boolean = false): ProviderToolDefinition[] {
  const readTools: ProviderToolDefinition[] = [
    // --- 9 READ TOOLS ---
    {
      name: 'searchInquiries',
      description: 'Search inquiries within the current agency by destination, stage, priority, traveler, or text query. Maximum 10 results returned.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text search across destination or inquiry metadata' },
          destination: { type: 'string', description: 'Filter by travel destination, e.g. "Dubai", "Switzerland"' },
          stage: { type: 'string', description: 'Filter by pipeline stage, e.g. "new", "quoted"' },
          priority: { type: 'string', description: 'Filter by priority, e.g. "low", "medium", "high", "urgent"' },
          assignedAgentId: { type: 'string', description: 'Filter by assigned agent ID' },
          travelerId: { type: 'string', description: 'Filter by canonical traveler ID' },
          limit: { type: 'integer', description: 'Max results to return (max 10)' },
        },
      },
    },
    {
      name: 'getInquiryDetails',
      description: 'Retrieve full canonical details for a specific inquiry by ID within the current workspace.',
      parameters: {
        type: 'object',
        properties: {
          inquiryId: { type: 'string', description: 'The canonical ID of the inquiry to retrieve' },
        },
        required: ['inquiryId'],
      },
    },
    {
      name: 'searchTravelers',
      description: 'Search for travelers/clients in the agency workspace by name or search term. Maximum 5 results. Returns PII-minimized identity.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name, email handle, or search term for the traveler' },
          limit: { type: 'integer', description: 'Max results to return (max 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'getTravelerHistory',
      description: 'Retrieve full travel history for a specific traveler, including past inquiries, confirmed/cancelled bookings, and booking counts.',
      parameters: {
        type: 'object',
        properties: {
          travelerId: { type: 'string', description: 'The canonical traveler profile ID' },
        },
        required: ['travelerId'],
      },
    },
    {
      name: 'getBookingDetails',
      description: 'Retrieve details for a specific booking by booking ID or booking reference code in the current agency.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'The canonical booking ID' },
          bookingReference: { type: 'string', description: 'The alphanumeric booking reference code' },
        },
      },
    },
    {
      name: 'listTasks',
      description: 'List CRM tasks/follow-ups in the current agency. Filter by inquiry ID, status (pending/in_progress/completed/all), or assigned user.',
      parameters: {
        type: 'object',
        properties: {
          inquiryId: { type: 'string', description: 'Filter tasks linked to a specific inquiry/lead' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'overdue', 'all'], description: 'Filter by task status' },
          assignedTo: { type: 'string', description: 'Filter by assigned user ID' },
          limit: { type: 'integer', description: 'Max results to return (max 10)' },
        },
      },
    },
    {
      name: 'getRecentActivity',
      description: 'Retrieve recent timeline activity events (calls, notes, stage changes, emails) for an inquiry. Maximum 15 events.',
      parameters: {
        type: 'object',
        properties: {
          inquiryId: { type: 'string', description: 'Inquiry/lead ID to fetch activity timeline for' },
          limit: { type: 'integer', description: 'Max timeline events to return (max 15)' },
        },
        required: ['inquiryId'],
      },
    },
    {
      name: 'searchAgencyKnowledge',
      description: 'Search the agency knowledge base for official policies (cancellation, refunds, baggage, visas), destination guides, supplier contacts, and FAQs. Returns structured source citations.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The question or topic to search within agency policies, FAQs, and guides' },
          limit: { type: 'integer', description: 'Max source passages to return (max 5)' },
        },
        required: ['query'],
      },
    },
  ];

  if (!includeProposals) {
    return readTools;
  }

  const proposalTools: ProviderToolDefinition[] = [
    // --- 3 ACTION PROPOSAL TOOLS (PROPOSAL ONLY — ZERO MUTATION) ---
    {
      name: 'proposeUpdateInquiryStage',
      description: 'Propose moving an inquiry to a new pipeline stage. Prepares a structured confirmation card. ZERO business mutations occur until the user confirms.',
      parameters: {
        type: 'object',
        properties: {
          inquiryId: { type: 'string', description: 'The canonical ID of the inquiry to update' },
          proposedStage: {
            type: 'string',
            enum: [...VALID_INQUIRY_STAGES],
            description: 'The target pipeline stage for the inquiry',
          },
          reason: { type: 'string', description: 'Optional explanation for why the stage should be updated' },
        },
        required: ['inquiryId', 'proposedStage'],
      },
    },
    {
      name: 'proposeAssignInquiry',
      description: 'Propose assigning an inquiry to an eligible team member in the current agency. Prepares a confirmation card. ZERO mutations occur until the user confirms.',
      parameters: {
        type: 'object',
        properties: {
          inquiryId: { type: 'string', description: 'The canonical ID of the inquiry' },
          assigneeUserId: { type: 'string', description: 'The profile ID of the team member to assign' },
          reason: { type: 'string', description: 'Optional reason for the assignment' },
        },
        required: ['inquiryId', 'assigneeUserId'],
      },
    },
    {
      name: 'proposeSetInquiryFollowUp',
      description: 'Propose setting, changing, or clearing the next follow-up date for an inquiry. Prepares a confirmation card. ZERO mutations occur until the user confirms.',
      parameters: {
        type: 'object',
        properties: {
          inquiryId: { type: 'string', description: 'The canonical ID of the inquiry' },
          nextFollowUpAt: {
            type: ['string', 'null'],
            description: 'ISO 8601 formatted datetime string for the follow-up, or null to clear',
          },
          reason: { type: 'string', description: 'Optional note regarding the follow-up' },
        },
        required: ['inquiryId', 'nextFollowUpAt'],
      },
    },
  ];

  return [...readTools, ...proposalTools];
}

/**
 * Extracts structured tool calls from text if model output fallback is needed.
 */
export function extractToolCalls(text: string): Array<{ tool: string; params: Record<string, unknown> }> {
  const calls: Array<{ tool: string; params: Record<string, unknown> }> = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('TOOL_CALL:')) {
      const jsonStr = trimmed.slice('TOOL_CALL:'.length).trim();
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed.tool === 'string') {
          calls.push({ tool: parsed.tool, params: parsed.params || {} });
        }
      } catch {
        // Invalid JSON on tool line - skip
      }
    }
  }
  return calls;
}

/**
 * Builds the tool description documentation for the system prompt.
 */
export function buildToolDescriptionsPrompt(): string {
  const readDescriptions = Object.values(CRM_READ_TOOLS).map((tool) => {
    return `- \`${tool.name}\`: ${tool.description}`;
  });

  const proposalDescriptions = Object.values(CRM_PROPOSAL_TOOLS).map((tool) => {
    return `- \`${tool.name}\`: ${tool.description}`;
  });

  return `AVAILABLE CRM READ TOOLS:
${readDescriptions.join('\n')}

AVAILABLE ACTION PROPOSAL TOOLS (PROPOSE ONLY — ZERO DIRECT MUTATION):
${proposalDescriptions.join('\n')}

INSTRUCTIONS FOR ACTION PROPOSALS:
- If the user asks to move an inquiry, assign it, or schedule follow-up, invoke the appropriate \`propose*\` tool.
- Propose at most ONE action per message.
- Invoking a proposal tool does NOT mutate the database. Rihla CRM will render a confirmation card for human approval.`;
}

/**
 * Dispatches a tool execution with server-authoritative context and schema validation.
 * Sanitizes all error messages so no internal SQL or database details leak to the model.
 */
export async function executeToolCall(
  context: TrustedExecutionContext,
  toolName: string,
  rawParams: unknown,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const tool = CRM_ALL_MODEL_TOOLS[toolName];
  if (!tool) {
    return {
      success: false,
      error: `Unknown tool requested: ${toolName}`,
    };
  }

  // 1. Validate parameters with Zod schema
  const parseResult = tool.parameters.safeParse(rawParams || {});
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    return {
      success: false,
      error: `Invalid parameters for tool ${toolName}: ${errorMsg}`,
    };
  }

  // 2. Execute with server-trusted context (tenantId, userId, role cannot be spoofed)
  try {
    return await tool.execute(context, parseResult.data, supabase);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown execution failure';
    console.error(`[Copilot Tool Dispatch Error] ${toolName}:`, msg);
    return {
      success: false,
      error: `Tool execution failed for ${toolName}.`,
    };
  }
}
