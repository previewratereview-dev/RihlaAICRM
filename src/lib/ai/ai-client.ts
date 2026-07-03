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
  model?: string;
  maxTokens?: number;
  feature: string;
  tenantAISettings?: import('@/lib/tenant/config').TenantSettings['ai'];
  currentSpend?: { daily: number; monthly: number };
  prompt: string;
}

export async function callAI(options: AICallOptions): Promise<AIResponse> {
  const {
    model,
    maxTokens = 1024,
    feature,
    tenantAISettings,
    currentSpend,
    prompt,
  } = options;

  const resolvedModel = model || tenantAISettings?.defaultModel || 'gpt-4o-mini';

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

  // Resolve API key — try customApiKey first, then fall back to tenant stored keys
  let apiKey = tenantAISettings?.customApiKey;
  if (!apiKey) {
    apiKey = tenantAISettings?.apiKeys?.openai;
  }

  if (!apiKey) {
    throw new Error('Missing AI API key. Add your API key in Settings > AI Config.');
  }

  // Resolve base URL — use custom base URL if set, otherwise default to OpenAI
  const baseUrl = tenantAISettings?.customBaseUrl || 'https://api.openai.com/v1';

  // Anthropic uses a different API format — detect from base URL or explicit flag
  const useAnthropicFormat = tenantAISettings?.useAnthropicFormat || baseUrl.includes('anthropic');

  let result;
  if (useAnthropicFormat) {
    result = await callAnthropic({ apiKey, model: resolvedModel, prompt, maxTokens });
  } else {
    result = await callOpenAI({ apiKey, model: resolvedModel, prompt, maxTokens, baseUrl });
  }

  const costEstimate = estimateCost(result.model, result.tokensIn, result.tokensOut);
  trackUsage(feature, result.tokensIn + result.tokensOut, costEstimate);

  return {
    text: result.text,
    provider: useAnthropicFormat ? 'anthropic' : result.provider,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costEstimate,
  };
}

export async function callAIWithFallback(options: Omit<AICallOptions, 'provider'>): Promise<AIResponse> {
  // Single provider — use whatever the tenant has configured
  // Fallback only applies if the call fails
  try {
    return await callAI(options);
  } catch (err) {
    const lastError = err instanceof Error ? err : new Error(String(err));
    if (lastError.message.toLowerCase().includes('budget')) throw lastError;
    throw lastError;
  }
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
      maxTokens,
      feature,
      prompt,
    });
    return response.text;
  },
  getBudgetStatus: () => {
    const totalCost = Object.values(usageStore).reduce((sum, u) => sum + u.cost, 0);
    const monthlyBudget = 100;
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
