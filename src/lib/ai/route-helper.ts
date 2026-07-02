import type { SupabaseClient } from '@supabase/supabase-js';
import { callAIWithFallback, type AIResponse } from '@/lib/ai/ai-client';
import type { TenantSettings } from '@/lib/tenant/config';
import {
  resolveAICredentials,
  ConfigurationError,
  SpendCapExceededError,
  type AIProvider,
} from '@/lib/ai/credential-resolver';
import { buildAiRuntime } from '@/lib/ai/runtime';
import { UsageStoreUnavailableError } from '@/lib/ai/usage-store';
import { logger } from '@/lib/logger';

export interface TenantAIContext {
  tenantId: string;
  openaiKey?: string;
  anthropicKey?: string;
  systemPrompt: string;
  monthlyBudget: number;
  defaultModel: string;
  currentMonthlySpend: number;
  tenantAISettings: TenantSettings['ai'];
}

export async function resolveTenantAIContext(
  supabase: SupabaseClient,
  tenantId: string
): Promise<TenantAIContext> {
  // NOTE: No `process.env` AI-key fallback here. AI credentials are resolved
  // strictly by tier via the credential resolver (Requirements 4.8, 4.9); this
  // context only carries non-secret tenant AI configuration plus the tenant's
  // own keys (if any) for budget/model resolution.
  let openaiKey: string | undefined;
  let anthropicKey: string | undefined;
  let monthlyBudget = 100;
  let defaultModel = 'gpt-4o-mini';
  let systemPrompt = '';

  const { data: settingsRow } = await supabase
    .from('settings')
    .select('openai_key, anthropic_key, ai_budgets, system_prompt')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (settingsRow) {
    openaiKey = settingsRow.openai_key || undefined;
    anthropicKey = settingsRow.anthropic_key || undefined;
    systemPrompt = settingsRow.system_prompt || '';
    const budgets = settingsRow.ai_budgets as { monthlyBudget?: number; defaultModel?: string } | null;
    if (budgets?.monthlyBudget) monthlyBudget = budgets.monthlyBudget;
    if (budgets?.defaultModel) defaultModel = budgets.defaultModel;
  }

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data: usageRows } = await supabase
    .from('ai_usage')
    .select('cost_estimate')
    .eq('tenant_id', tenantId)
    .gte('created_at', monthStart);

  const currentMonthlySpend = (usageRows || []).reduce(
    (sum, row) => sum + Number(row.cost_estimate || 0),
    0
  );

  const tenantAISettings: TenantSettings['ai'] = {
    defaultModel,
    apiKeys: { openai: openaiKey, anthropic: anthropicKey },
    budgets: { monthlyBudget },
  };

  return {
    tenantId,
    openaiKey,
    anthropicKey,
    systemPrompt,
    monthlyBudget,
    defaultModel,
    currentMonthlySpend,
    tenantAISettings,
  };
}

export function injectSystemPrompt(systemPrompt: string, userPrompt: string): string {
  if (!systemPrompt.trim()) return userPrompt;
  return `${systemPrompt.trim()}\n\n---\n\n${userPrompt}`;
}

export interface AIRequestResult {
  content: string;
  usage: AIResponse | null;
  blocked: boolean;
  /** Why the request was blocked, when `blocked` is true. */
  blockReason?: 'limit' | 'spend_cap' | 'configuration' | 'service_unavailable' | 'budget';
}

const FALLBACK_MESSAGE =
  "I'm here to help! Let me connect you with one of our travel specialists.";

export async function executeAIRequest({
  supabase,
  tenantId,
  feature,
  prompt,
  model,
  maxTokens = 150,
  userId,
}: {
  supabase: SupabaseClient;
  tenantId: string;
  feature: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  userId?: string | null;
}): Promise<AIRequestResult> {
  const ctx = await resolveTenantAIContext(supabase, tenantId);
  const resolvedModel = model || ctx.defaultModel;
  const fullPrompt = injectSystemPrompt(ctx.systemPrompt, prompt);

  // Wire the tier-aware credential resolver, per-period limits, and the durable
  // shared usage store to this request's Supabase client (Requirements 4, 9.9).
  const runtime = await buildAiRuntime(supabase, tenantId);

  // 1. Enforce the per-period AI usage limit BEFORE doing any work. Reads the
  //    durable shared counter; fail closed if the store is unavailable (9.12).
  try {
    const withinLimit = await runtime.usageStore.wouldStayWithin(
      runtime.callsRef,
      runtime.aiCallLimit,
      1,
    );
    if (!withinLimit) {
      return {
        content:
          'Your plan’s AI usage limit for this period has been reached. A travel specialist will help you shortly.',
        usage: null,
        blocked: true,
        blockReason: 'limit',
      };
    }
  } catch (err) {
    if (err instanceof UsageStoreUnavailableError) {
      return {
        content: FALLBACK_MESSAGE,
        usage: null,
        blocked: true,
        blockReason: 'service_unavailable',
      };
    }
    throw err;
  }

  // 2. Resolve AI credentials strictly by tier — never a `process.env` fallback
  //    for non-Premium tenants. Premium resolution also enforces the platform
  //    monthly spend cap (Requirements 4.4, 4.6, 4.8, 4.9, 4.12).
  const apiKeys: { openai?: string; anthropic?: string } = {};
  const providers: AIProvider[] = ['openai', 'anthropic'];
  for (const provider of providers) {
    try {
      const resolution = await resolveAICredentials(tenantId, provider, runtime.resolverDeps);
      apiKeys[provider as 'openai' | 'anthropic'] = resolution.apiKey;
    } catch (err) {
      if (err instanceof SpendCapExceededError) {
        return {
          content:
            'Our AI assistant has reached its monthly limit for your plan. A travel specialist will help you shortly.',
          usage: null,
          blocked: true,
          blockReason: 'spend_cap',
        };
      }
      if (err instanceof ConfigurationError) {
        // This provider isn't configured/entitled for the tenant; try the next.
        continue;
      }
      throw err;
    }
  }

  // 3. No resolvable credentials ⇒ configuration error; do NOT process with
  //    platform/environment keys (Requirement 4.9).
  if (!apiKeys.openai && !apiKeys.anthropic) {
    return {
      content: FALLBACK_MESSAGE,
      usage: null,
      blocked: true,
      blockReason: 'configuration',
    };
  }

  const tenantAISettings: TenantSettings['ai'] = {
    defaultModel: ctx.defaultModel,
    apiKeys,
    budgets: { monthlyBudget: ctx.monthlyBudget },
  };

  try {
    const result = await callAIWithFallback({
      model: resolvedModel,
      maxTokens,
      feature,
      prompt: fullPrompt,
      tenantAISettings,
      currentSpend: { daily: 0, monthly: ctx.currentMonthlySpend },
    });

    // 4. Record usage in the durable shared store: one call + its cost
    //    (Requirement 9.9 / Premium spend-cap accounting 4.12).
    try {
      await runtime.usageStore.record(runtime.callsRef, 1);
      if (result.costEstimate > 0) {
        await runtime.usageStore.record(runtime.costRef, result.costEstimate);
      }
    } catch (recordErr) {
      if (!(recordErr instanceof UsageStoreUnavailableError)) throw recordErr;
      // Usage already produced; keep the durable ai_usage log below.
      logger.error('Failed to record AI usage in shared store');
    }

    await supabase.from('ai_usage').insert({
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tenant_id: tenantId,
      user_id: userId ?? null,
      feature,
      provider: result.provider,
      model: result.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_estimate: result.costEstimate,
      status: 'success',
    });

    return { content: result.text, usage: result, blocked: false };
  } catch (aiError) {
    const message = aiError instanceof Error ? aiError.message : 'AI request failed';
    const blocked = message.toLowerCase().includes('budget');

    await supabase.from('ai_usage').insert({
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tenant_id: tenantId,
      user_id: userId ?? null,
      feature,
      provider: 'openai',
      model: resolvedModel,
      tokens_in: 0,
      tokens_out: 0,
      cost_estimate: 0,
      status: blocked ? 'blocked' : 'error',
    });

    return {
      content: blocked
        ? 'Our AI assistant has reached its monthly budget limit. A travel specialist will help you shortly.'
        : FALLBACK_MESSAGE,
      usage: null,
      blocked,
      blockReason: blocked ? 'budget' : undefined,
    };
  }
}
