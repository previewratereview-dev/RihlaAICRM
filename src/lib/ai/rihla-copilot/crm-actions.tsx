'use server';

/**
 * CRM Copilot Server Actions (Phase AI-2)
 * 
 * Server-authoritative, read-only CRM Copilot handler with provider-native
 * structured tool calling (OpenAI & Anthropic), bounded 2-round tool loop,
 * and validated tenant knowledge citations.
 * 
 * Invariants:
 * - Authenticates session server-side
 * - Resolves tenant-safe context via resolveCopilotContext
 * - Enforces trusted execution context (tenantId, userId, role derived on server)
 * - READ TOOLS: 8 (inquiries, travelers, bookings, tasks, activity, knowledge)
 * - WRITE TOOLS: 0
 * - EXTERNAL ACTIONS: 0
 * - Tool loop bounded by MAX_TOOL_ROUNDS (2) and MAX_TOOL_CALLS (4)
 * - Provider-native tool calling with fallback normalized adapter
 * - Validated citation handles (server owns source identity)
 */
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { executeAIRequest } from '@/lib/ai/route-helper';
import {
  resolveCopilotContext,
  type ClientContextHint,
} from './crm-context-resolver';
import { buildCrmCopilotPrompt } from './crm-prompt';
import {
  executeToolCall,
  getCrmCopilotProviderTools,
  type TrustedExecutionContext,
  type KnowledgeSource,
  type KnowledgeSearchResult,
} from './tools';

export interface CrmCopilotResponse {
  id: string;
  content: string;
  contextSummary?: string;
  sources?: KnowledgeSource[];
  error?: string;
}

const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 4;

/**
 * Validates citation handles in model response against actually retrieved sources.
 * Server owns source identity: model cannot invent valid citation handles.
 */
export async function validateCitedSources(
  responseText: string,
  retrievedSources: KnowledgeSource[]
): Promise<KnowledgeSource[]> {
  if (retrievedSources.length === 0) return [];

  // Match [S1], [S2] ... in response
  const matches = responseText.match(/\[S(\d+)\]/g);
  if (!matches || matches.length === 0) {
    // If no explicit inline handles cited but sources were retrieved, return all retrieved sources
    return retrievedSources;
  }

  const validSources: KnowledgeSource[] = [];
  const seenIds = new Set<string>();

  for (const match of matches) {
    const numMatch = match.match(/\d+/);
    if (numMatch) {
      const idx = parseInt(numMatch[0], 10) - 1; // 1-indexed [S1] -> 0
      if (idx >= 0 && idx < retrievedSources.length) {
        const source = retrievedSources[idx];
        if (!seenIds.has(source.sourceId)) {
          seenIds.add(source.sourceId);
          validSources.push(source);
        }
      }
      // Out-of-bounds indices (e.g. [S99]) are intentionally ignored/unverified
    }
  }

  return validSources.length > 0 ? validSources : retrievedSources;
}

/**
 * Server Action: Submit a user query to CRM Copilot with bounded tool execution.
 */
export async function submitCrmCopilotMessage(
  userQuery: string,
  clientHint: ClientContextHint = {}
): Promise<CrmCopilotResponse> {
  const query = userQuery.trim();
  if (!query) {
    return {
      id: `err-${Date.now()}`,
      content: 'Please provide a message or question.',
      error: 'empty_query',
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 1. Resolve server-authoritative context
  const context = await resolveCopilotContext(supabase, clientHint);

  if (!context.success) {
    return {
      id: `err-${Date.now()}`,
      content: context.error?.includes('Super Admin')
        ? 'Rihla Copilot is designed for Agency CRM workspaces and is not available in Platform Super Admin mode.'
        : 'You must be signed in to an agency workspace to use Rihla Copilot.',
      error: context.error,
    };
  }

  const tenantId = context.agency?.tenantId || 'global';
  const userId = context.user?.userId || null;

  const trustedContext: TrustedExecutionContext = {
    userId: context.user?.userId || 'unknown-user',
    tenantId,
    role: context.user?.role || 'agent',
    fullName: context.user?.fullName || 'Agent',
  };

  const collectedSources: KnowledgeSource[] = [];
  let toolOutputContext = '';
  let toolCallsCount = 0;

  try {
    // ─── ROUND 1: Initial Inference with Provider-Native Tools ─────
    const initialPrompt = buildCrmCopilotPrompt(query, context);
    const providerTools = getCrmCopilotProviderTools();

    const initialResult = await executeAIRequest({
      supabase,
      tenantId,
      feature: 'crm_copilot',
      prompt: initialPrompt,
      maxTokens: 600,
      userId,
      tools: providerTools,
    });

    if (initialResult.blocked) {
      return {
        id: `blocked-${Date.now()}`,
        content: initialResult.content || 'AI assistant is currently unavailable for this workspace.',
        error: initialResult.blockReason || 'blocked',
      };
    }

    const firstOutput = initialResult.content || '';

    // Strict provider-native structured tool calls ONLY (no free-text TOOL_CALL parsing fallback)
    const rawToolCalls: Array<{ tool: string; params: Record<string, unknown> }> = [];
    if (initialResult.toolCalls && initialResult.toolCalls.length > 0) {
      for (const tc of initialResult.toolCalls) {
        rawToolCalls.push({ tool: tc.name, params: tc.arguments });
      }
    }

    // If no tool calls requested, return the direct answer
    if (rawToolCalls.length === 0 || MAX_TOOL_ROUNDS <= 1) {
      return {
        id: `resp-${Date.now()}`,
        content: firstOutput,
        contextSummary: formatContextSummary(context),
      };
    }

    // ─── EXECUTE REQUESTED READ TOOLS ─────────────────────────────
    const toolResultsText: string[] = [];

    for (const call of rawToolCalls) {
      if (toolCallsCount >= MAX_TOOL_CALLS) {
        toolResultsText.push(`[Tool Notice] Maximum tool limit (${MAX_TOOL_CALLS}) reached. Remaining tool calls skipped.`);
        break;
      }

      toolCallsCount += 1;
      const res = await executeToolCall(trustedContext, call.tool, call.params, supabase);

      if (!res.success) {
        toolResultsText.push(`[Tool: ${call.tool}] Error: ${res.error || 'Execution failed'}`);
      } else {
        // Check if knowledge search returned structured sources
        if (call.tool === 'searchAgencyKnowledge' && res.data) {
          const knowledgeData = res.data as KnowledgeSearchResult;
          if (knowledgeData.sources && knowledgeData.sources.length > 0) {
            for (const s of knowledgeData.sources) {
              if (!collectedSources.some((existing) => existing.sourceId === s.sourceId)) {
                collectedSources.push(s);
              }
            }
          }
          toolResultsText.push(`[Tool: searchAgencyKnowledge]\n${knowledgeData.answerContext}`);
        } else {
          toolResultsText.push(`[Tool: ${call.tool}]\nData: ${JSON.stringify(res.data, null, 2)}`);
        }
      }
    }

    toolOutputContext = toolResultsText.join('\n\n');

    // ─── ROUND 2: Final Grounded Inference ─────────────────────────
    const groundedPrompt = buildCrmCopilotPrompt(query, context, toolOutputContext);

    const groundedResult = await executeAIRequest({
      supabase,
      tenantId,
      feature: 'crm_copilot',
      prompt: groundedPrompt,
      maxTokens: 700,
      userId,
    });

    if (groundedResult.blocked) {
      return {
        id: `blocked-${Date.now()}`,
        content: groundedResult.content || 'AI assistant is currently unavailable for this workspace.',
        error: groundedResult.blockReason || 'blocked',
      };
    }

    let finalContent = groundedResult.content || '';
    // Strip any lingering raw TOOL_CALL: lines from final output
    finalContent = finalContent
      .split('\n')
      .filter((l) => !l.trim().startsWith('TOOL_CALL:'))
      .join('\n')
      .trim();

    // Server-side citation handle validation
    const validatedSources = await validateCitedSources(finalContent, collectedSources);

    return {
      id: `resp-${Date.now()}`,
      content: finalContent,
      contextSummary: formatContextSummary(context),
      sources: validatedSources.length > 0 ? validatedSources : undefined,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[CRM Copilot Action Error]', errorMsg);

    return {
      id: `err-${Date.now()}`,
      content: 'I encountered an issue processing your request. Please try again or refine your question.',
      error: 'processing_error',
    };
  }
}

function formatContextSummary(context: import('./crm-context-resolver').CopilotContextResolution): string {
  let contextSummary = context.page?.section || 'General CRM';
  if (context.entity?.type === 'inquiry' && context.entity.data) {
    contextSummary = `Inquiry: ${context.entity.data.destination || context.entity.data.id.slice(0, 8)}`;
  } else if (context.entity?.type === 'traveler' && context.entity.data) {
    contextSummary = `Traveler: ${context.entity.data.displayName || context.entity.data.id.slice(0, 8)}`;
  } else if (context.entity?.type === 'booking' && context.entity.data) {
    contextSummary = `Booking: ${context.entity.data.bookingReference || context.entity.data.id.slice(0, 8)}`;
  } else if (context.entity?.type === 'conversation' && context.entity.data) {
    contextSummary = `Conversation: ${context.entity.data.channel || 'Chat'}`;
  }
  return contextSummary;
}
