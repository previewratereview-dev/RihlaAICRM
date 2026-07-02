import { estimateCost } from '@/lib/ai/pricing';
import type { TenantSettings } from '@/lib/tenant/config';

export interface BudgetDecision {
  allowed: boolean;
  reason?: string;
}

export function checkAIBudget({
  feature, // eslint-disable-line @typescript-eslint/no-unused-vars
  model,
  tokensIn,
  tokensOut,
  tenantAISettings,
  currentSpend = { daily: 0, monthly: 0 },
}: {
  feature: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  tenantAISettings?: TenantSettings['ai'];
  currentSpend?: { daily: number; monthly: number };
}): BudgetDecision {
  const budgets = tenantAISettings?.budgets;
  if (!budgets) {
    return { allowed: true };
  }

  const estimatedCost = estimateCost(model, tokensIn, tokensOut);

  if (typeof budgets.monthlyBudget === 'number' && currentSpend.monthly + estimatedCost > budgets.monthlyBudget) {
    return { allowed: false, reason: 'Monthly AI budget exceeded.' };
  }

  if (typeof budgets.dailyBudget === 'number' && currentSpend.daily + estimatedCost > budgets.dailyBudget) {
    return { allowed: false, reason: 'Daily AI budget exceeded.' };
  }

  if (typeof budgets.maxTokensPerRequest === 'number') {
    const totalTokens = tokensIn + tokensOut;
    if (totalTokens > budgets.maxTokensPerRequest) {
      return { allowed: false, reason: 'Request exceeds max tokens per request.' };
    }
  }

  return { allowed: true };
}