'use server';

/**
 * CRM Copilot Server Actions (Phase AI-1)
 * 
 * Server-authoritative, read-only CRM Copilot handler.
 * - Authenticates session server-side
 * - Resolves tenant-safe context via resolveCopilotContext
 * - Uses established AI runtime governance (executeAIRequest / BYOK / usage tracking)
 * - Exposes ZERO write tools, ZERO read tools, and ZERO onboarding tools
 */
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { executeAIRequest } from '@/lib/ai/route-helper';
import {
  resolveCopilotContext,
  type ClientContextHint,
} from './crm-context-resolver';
import { buildCrmCopilotPrompt } from './crm-prompt';

export interface CrmCopilotResponse {
  id: string;
  content: string;
  contextSummary?: string;
  error?: string;
}

/**
 * Server Action: Submit a user query to CRM Copilot.
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

  // Resolve server-authoritative context
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

  const prompt = buildCrmCopilotPrompt(query, context);

  try {
    const aiResult = await executeAIRequest({
      supabase,
      tenantId,
      feature: 'crm_copilot',
      prompt,
      maxTokens: 600,
      userId,
    });

    if (aiResult.blocked) {
      return {
        id: `blocked-${Date.now()}`,
        content: aiResult.content || 'AI assistant is currently unavailable for this workspace.',
        error: aiResult.blockReason || 'blocked',
      };
    }

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

    return {
      id: `resp-${Date.now()}`,
      content: aiResult.content,
      contextSummary,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[CRM Copilot] Error executing request:', errorMsg);
    return {
      id: `err-${Date.now()}`,
      content: 'Sorry, I encountered an issue processing your request. Please try again.',
      error: errorMsg,
    };
  }
}
