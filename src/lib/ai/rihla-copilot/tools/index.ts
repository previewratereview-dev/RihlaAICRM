/**
 * Central CRM Copilot Read Tool Registry (Phase AI-2)
 * 
 * Aggregates all approved read tools, enforces schema validation,
 * injects trusted server execution context, and dispatches tool execution.
 * 
 * CRM READ TOOLS: 8
 * CRM WRITE TOOLS: 0
 * EXTERNAL ACTION TOOLS: 0
 */
import type { SupabaseClient } from '@supabase/supabase-js';
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

export * from './types';
export * from './inquiries';
export * from './travelers';
export * from './bookings';
export * from './tasks';
export * from './activity';
export * from './knowledge';

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

/**
 * Extracts structured tool calls from model output lines starting with `TOOL_CALL:`.
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
  const descriptions = Object.values(CRM_READ_TOOLS).map((tool) => {
    return `- \`${tool.name}\`: ${tool.description}`;
  });

  return `AVAILABLE CRM READ TOOLS:
${descriptions.join('\n')}

TOOL CALLING SYNTAX:
If you need information not present in the CURRENT CRM CONTEXT to accurately answer the user's question, output a tool call on its own line using this exact format:
TOOL_CALL: {"tool": "toolName", "params": { ... }}

EXAMPLES:
- To check traveler booking history:
  TOOL_CALL: {"tool": "getTravelerHistory", "params": {"travelerId": "uuid-here"}}
- To search agency cancellation policy or FAQs:
  TOOL_CALL: {"tool": "searchAgencyKnowledge", "params": {"query": "cancellation policy"}}
- To find inquiries for a destination:
  TOOL_CALL: {"tool": "searchInquiries", "params": {"destination": "Dubai"}}
- To list pending tasks for the current inquiry:
  TOOL_CALL: {"tool": "listTasks", "params": {"inquiryId": "uuid-here", "status": "pending"}}

If you already have enough information in the CURRENT CRM CONTEXT or after reviewing tool results, provide the final answer directly without outputting TOOL_CALL.`;
}

/**
 * Dispatches a tool execution with server-authoritative context and schema validation.
 */
export async function executeToolCall(
  context: TrustedExecutionContext,
  toolName: string,
  rawParams: unknown,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const tool = CRM_READ_TOOLS[toolName];
  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}. Available tools: ${Object.keys(CRM_READ_TOOLS).join(', ')}`,
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
      error: `Tool execution failed for ${toolName}`,
    };
  }
}
