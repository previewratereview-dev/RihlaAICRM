import { callOpenAI } from '@/lib/ai/providers/openai';
import { callAnthropic } from '@/lib/ai/providers/anthropic';
import { estimateCost } from './pricing';
import { checkAIBudget, type BudgetDecision } from './guard';

export interface AIResponse {
  text: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costEstimate: number;
}

export interface AICallOptions {
  provider?: 'openai' | 'anthropic';
  model?: string;
  maxTokens?: number;
  feature: string;
  tenantAISettings?: import('@/lib/tenant/config').TenantSettings['ai'];
  currentSpend?: { daily: number; monthly: number };
  prompt: string;
}

export async function callAI(options: AICallOptions): Promise<AIResponse> {
  const {
    provider = 'openai',
    model,
    maxTokens = 1024,
    feature,
    tenantAISettings,
    currentSpend,
    prompt,
  } = options;

  const resolvedModel = model || tenantAISettings?.defaultModel || 'gpt-4o-mini';

  // Estimate token count from prompt length (rough: ~4 chars per token)
  const estimatedTokensIn = Math.ceil(prompt.length / 4);
  const estimatedTokensOut = maxTokens;

  const budgetCheck: BudgetDecision = checkAIBudget({
    feature,
    model: resolvedModel,
    tokensIn: estimatedTokensIn,
    tokensOut: estimatedTokensOut,
    tenantAISettings,
    currentSpend,
  });

  if (!budgetCheck.allowed) {
    throw new Error(budgetCheck.reason || 'AI budget blocked.');
  }

  const apiKey = provider === 'anthropic'
    ? tenantAISettings?.apiKeys?.anthropic
    : tenantAISettings?.apiKeys?.openai;

  if (!apiKey) {
    throw new Error('Missing AI API key for tenant.');
  }

  let result;
  if (provider === 'anthropic') {
    result = await callAnthropic({ apiKey, model: resolvedModel, prompt, maxTokens });
  } else {
    result = await callOpenAI({ apiKey, model: resolvedModel, prompt, maxTokens });
  }

  const costEstimate = estimateCost(result.model, result.tokensIn, result.tokensOut);
  trackUsage(feature, result.tokensIn + result.tokensOut, costEstimate);

  return {
    text: result.text,
    provider: result.provider,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costEstimate,
  };
}

/** Try OpenAI first, then Anthropic as fallback. */
export async function callAIWithFallback(options: Omit<AICallOptions, 'provider'>): Promise<AIResponse> {
  const providers: Array<'openai' | 'anthropic'> = ['openai', 'anthropic'];
  let lastError: Error | null = null;

  for (const provider of providers) {
    const apiKey = provider === 'anthropic'
      ? options.tenantAISettings?.apiKeys?.anthropic
      : options.tenantAISettings?.apiKeys?.openai;

    if (!apiKey) continue;

    try {
      return await callAI({ ...options, provider });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.toLowerCase().includes('budget')) throw lastError;
    }
  }

  throw lastError || new Error('No AI provider available.');
}

// In-memory usage tracker for the AI Usage Dashboard
const usageStore: Record<string, { requests: number; tokens: number; cost: number }> = {};

function trackUsage(feature: string, tokens: number, cost: number) {
  if (!usageStore[feature]) {
    usageStore[feature] = { requests: 0, tokens: 0, cost: 0 };
  }
  usageStore[feature].requests += 1;
  usageStore[feature].tokens += tokens;
  usageStore[feature].cost += cost;
}

export const aiClient = {
  callAI,
  callAIWithFallback,
  trackUsage,
  /**
   * Simplified call interface: prompt string, feature name, max tokens.
   * Returns the generated text string.
   */
  call: async (prompt: string, feature: string, maxTokens: number = 150): Promise<string> => {
    const response = await callAI({
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens,
      feature,
      prompt,
    });
    return response.text;
  },
  getBudgetStatus: () => {
    const totalCost = Object.values(usageStore).reduce((sum, u) => sum + u.cost, 0);
    const monthlyBudget = 100; // Default budget; override from tenant settings
    const currentSpend = totalCost;
    const remaining = Math.max(0, monthlyBudget - currentSpend);
    const percentageUsed = monthlyBudget > 0 ? (currentSpend / monthlyBudget) * 100 : 0;
    return {
      monthlyBudget,
      currentSpend,
      remaining,
      percentageUsed,
      isExhausted: currentSpend >= monthlyBudget,
      isNearLimit: !(currentSpend >= monthlyBudget) && percentageUsed > 80,
    };
  },
  getUsageByFeature: () => ({ ...usageStore }),
};
