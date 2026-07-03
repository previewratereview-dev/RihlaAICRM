import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { callAIWithFallback, type AIResponse } from '@/lib/ai/ai-client';
import type { TenantSettings } from '@/lib/tenant/config';
import {
  resolveAICredentials,
  ConfigurationError,
  SpendCapExceededError,
  type AIProvider,
} from '@/lib/ai/credential-resolver';
import { buildAiRuntime, getSubscriptionBlockedMessage } from '@/lib/ai/runtime';
import { UsageStoreUnavailableError } from '@/lib/ai/usage-store';
import { logger } from '@/lib/logger';
import { open, type SealedSecret } from '@/lib/secrets/store';

function getAdminClient(fallback: SupabaseClient): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (serviceKey && url) {
    return createServiceClient(url, serviceKey);
  }
  return fallback;
}

function decryptIfNeeded(stored: unknown): string | undefined {
  if (!stored || typeof stored !== 'string') return undefined;
  try {
    const parsed = JSON.parse(stored) as SealedSecret;
    if (parsed.iv && parsed.authTag && parsed.ciphertext && typeof parsed.keyVersion === 'number') {
      return open(parsed) || undefined;
    }
  } catch {
    // Not encrypted JSON — treat as legacy plaintext value
  }
  return stored;
}

export interface TenantAIContext {
  tenantId: string;
  openaiKey?: string;
  anthropicKey?: string;
  systemPrompt: string;
  monthlyBudget: number;
  defaultModel: string;
  currentMonthlySpend: number;
  tenantAISettings: TenantSettings['ai'];
  customBaseUrl?: string;
  customApiKey?: string;
  useAnthropicFormat?: boolean;
}

export async function resolveTenantAIContext(
  supabase: SupabaseClient,
  tenantId: string
): Promise<TenantAIContext> {
  const adminDb = getAdminClient(supabase);
  let openaiKey: string | undefined;
  let anthropicKey: string | undefined;
  let monthlyBudget = 100;
  let defaultModel = 'gpt-4o-mini';
  let systemPrompt = '';

  const { data: settingsRow } = await adminDb
    .from('settings')
    .select('openai_key, anthropic_key, ai_budgets, system_prompt, ai_base_url, ai_api_key, ai_model, ai_use_anthropic_format')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (settingsRow) {
    systemPrompt = settingsRow.system_prompt || '';
    const budgets = settingsRow.ai_budgets as { monthlyBudget?: number; defaultModel?: string } | null;
    if (budgets?.monthlyBudget) monthlyBudget = budgets.monthlyBudget;

    // Only allow custom provider keys or custom models if global super admin
    if (tenantId === 'global') {
      openaiKey = decryptIfNeeded(settingsRow.openai_key);
      anthropicKey = decryptIfNeeded(settingsRow.anthropic_key);
      if (budgets?.defaultModel) defaultModel = budgets.defaultModel;
    }
  }

  // Read custom provider config from settings if global
  let customBaseUrl: string | undefined;
  let customApiKey: string | undefined;
  let useAnthropicFormat = false;
  if (settingsRow && tenantId === 'global') {
    customBaseUrl = settingsRow.ai_base_url || undefined;
    customApiKey = decryptIfNeeded(settingsRow.ai_api_key);
    useAnthropicFormat = settingsRow.ai_use_anthropic_format || false;
    if (settingsRow.ai_model) defaultModel = settingsRow.ai_model;
  }

  // For all agencies (or if global didn't configure custom endpoint), use global platform settings
  if (tenantId !== 'global' || !customBaseUrl || !customApiKey || defaultModel === 'gpt-4o-mini') {
    const { data: platformRow } = await adminDb
      .from('platform_settings')
      .select('default_ai_model, settings')
      .eq('id', 'platform')
      .maybeSingle();

    if (platformRow) {
      const pSettings = (platformRow.settings as Record<string, unknown>) || {};
      if ((tenantId !== 'global' || !customBaseUrl) && typeof pSettings.defaultAiBaseUrl === 'string' && pSettings.defaultAiBaseUrl) {
        customBaseUrl = pSettings.defaultAiBaseUrl;
      }
      if ((tenantId !== 'global' || !customApiKey) && typeof pSettings.defaultAiApiKey === 'string' && pSettings.defaultAiApiKey) {
        customApiKey = decryptIfNeeded(pSettings.defaultAiApiKey);
      }
      if ((tenantId !== 'global' || !settingsRow?.ai_use_anthropic_format) && typeof pSettings.aiUseAnthropicFormat === 'boolean') {
        useAnthropicFormat = pSettings.aiUseAnthropicFormat;
      }
      if (
        (tenantId !== 'global' || defaultModel === 'gpt-4o-mini' || !settingsRow?.ai_model) &&
        typeof platformRow.default_ai_model === 'string' &&
        platformRow.default_ai_model
      ) {
        defaultModel = platformRow.default_ai_model;
      }
    }
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
    customBaseUrl,
    customApiKey,
    useAnthropicFormat,
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
    customBaseUrl,
    customApiKey,
    useAnthropicFormat,
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
  const { customBaseUrl, customApiKey, useAnthropicFormat } = ctx;
  const fullPrompt = injectSystemPrompt(ctx.systemPrompt, prompt);

  // Wire the tier-aware credential resolver, per-period limits, and the durable
  // shared usage store to this request's Supabase client (Requirements 4, 9.9).
  const runtime = await buildAiRuntime(supabase, tenantId);

  // Requirement 1: Lock AI features behind subscription for all agencies.
  if (tenantId !== 'global' && runtime.tier === 'free') {
    const blockedMsg = getSubscriptionBlockedMessage(runtime);
    console.log(`[AI Request Blocked] Tenant ${tenantId} locked behind subscription (${runtime.subscriptionStatus}).`);
    return {
      content: blockedMsg,
      usage: null,
      blocked: true,
      blockReason: 'configuration',
    };
  }

  // 1. Enforce the per-period AI usage limit BEFORE doing any work. Reads the
  //    durable shared counter; fail closed if the store is unavailable (9.12).
  //    Skip limit enforcement if using custom API credentials or global super admin.
  if (!customApiKey && tenantId !== 'global') {
    try {
      const withinLimit = await runtime.usageStore.wouldStayWithin(
        runtime.callsRef,
        runtime.aiCallLimit,
        1,
      );
      if (!withinLimit) {
        console.log(`[AI Request Blocked] Tenant ${tenantId} reached AI usage limit.`);
        return {
          content:
            "Your plan's AI usage limit for this period has been reached. A travel specialist will help you shortly.",
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
  }

  // 2. Check for a custom provider key (ai_api_key column) first — skip the
  //    old credential resolver entirely when a custom base URL is configured.
  let resolvedBaseUrl = customBaseUrl || 'https://api.openai.com/v1';
  let resolvedApiKey = customApiKey || '';
  let aiModel = ctx.defaultModel || 'gpt-4o-mini';

  if (!resolvedApiKey) {
    // No custom provider configured — fall back to old credential resolution
    const apiKeys: { openai?: string; anthropic?: string } = {};
    const providers: AIProvider[] = ['openai', 'anthropic'];
    for (const provider of providers) {
      try {
        const resolution = await resolveAICredentials(tenantId, provider, runtime.resolverDeps);
        apiKeys[provider as 'openai' | 'anthropic'] = resolution.apiKey;
      } catch (err) {
        if (err instanceof SpendCapExceededError) {
          console.log(`[AI Request Blocked] Spend cap exceeded for tenant ${tenantId}`);
          return {
            content:
              'Our AI assistant has reached its monthly limit for your plan. A travel specialist will help you shortly.',
            usage: null,
            blocked: true,
            blockReason: 'spend_cap',
          };
        }
        if (err instanceof ConfigurationError) {
          continue;
        }
        throw err;
      }
    }

    if (!apiKeys.openai && !apiKeys.anthropic) {
      console.log(`[AI Request Blocked] No API keys configured for tenant ${tenantId}`);
      return {
        content: FALLBACK_MESSAGE,
        usage: null,
        blocked: true,
        blockReason: 'configuration',
      };
    }

    // Determine which provider to use from old resolution
    if (apiKeys.openai) {
      resolvedApiKey = apiKeys.openai;
      resolvedBaseUrl = 'https://api.openai.com/v1';
      aiModel = ctx.defaultModel || 'gpt-4o-mini';
    } else if (apiKeys.anthropic) {
      resolvedApiKey = apiKeys.anthropic;
      resolvedBaseUrl = 'https://api.anthropic.com';
      aiModel = ctx.defaultModel || 'claude-3-5-sonnet-20241022';
    }
  }

  // Requirement 2: Allow caller to override the model ONLY if global super admin
  const finalModel = tenantId === 'global' ? (model || aiModel) : aiModel;

  console.log(`\n=================== [AI REQUEST INITIATED] ===================`);
  console.log(`Feature: ${feature} | Tenant: ${tenantId} | Endpoint: ${resolvedBaseUrl} | Model: ${finalModel}`);
  console.log(`Prompt sent to AI:\n${fullPrompt}`);
  console.log(`==============================================================\n`);

  const aiSettings: TenantSettings['ai'] = {
    defaultModel: finalModel,
    apiKeys: resolvedApiKey ? { openai: resolvedApiKey } : {},
    budgets: { monthlyBudget: ctx.monthlyBudget },
    customBaseUrl: resolvedBaseUrl,
    customApiKey: resolvedApiKey,
    useAnthropicFormat,
  };

  try {
    const result = await callAIWithFallback({
      model: finalModel,
      maxTokens,
      feature,
      prompt: fullPrompt,
      tenantAISettings: aiSettings,
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

    console.log(`\n=================== [AI RESPONSE SUCCESS] ===================`);
    console.log(`Model Used: ${result.model} | Provider: ${result.provider}`);
    console.log(`Tokens In: ${result.tokensIn} | Tokens Out: ${result.tokensOut} | Cost: $${result.costEstimate}`);
    console.log(`Generated Response:\n${result.text}`);
    console.log(`=============================================================\n`);

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
      model: finalModel,
      tokens_in: 0,
      tokens_out: 0,
      cost_estimate: 0,
      status: blocked ? 'blocked' : 'error',
    });

    console.log(`\n==================== [AI RESPONSE ERROR / BLOCKED] ====================`);
    console.log(`Error Message:`, message);
    console.log(`Blocked:`, blocked);
    console.log(`Fallback Response returned to UI:`, blocked ? 'Our AI assistant has reached its monthly budget limit...' : FALLBACK_MESSAGE);
    console.log(`=======================================================================\n`);

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
