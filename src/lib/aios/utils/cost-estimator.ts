/**
 * StateAI AI Operating System (AIOS) — Cost Estimator Interface & Utility
 * 
 * Vendor-neutral cost estimator interface and implementation.
 * Calculates financial cost based on token usage and model pricing metadata.
 */

import type { CostMetadata, Usage } from '../types';

export interface CostEstimator {
  estimateCost(usage: { tokensIn: number; tokensOut: number }, pricing: CostMetadata): number;
}

export class DefaultCostEstimator implements CostEstimator {
  /**
   * Calculates estimated cost in currency units (default USD) rounded to 6 decimal places.
   * pricing.promptPer1k is cost per 1,000 prompt tokens.
   * pricing.completionPer1k is cost per 1,000 completion tokens.
   */
  estimateCost(usage: { tokensIn: number; tokensOut: number }, pricing: CostMetadata): number {
    const promptCost = (usage.tokensIn / 1000) * pricing.promptPer1k;
    const completionCost = (usage.tokensOut / 1000) * pricing.completionPer1k;
    const total = promptCost + completionCost;
    return Number(total.toFixed(6));
  }
}

export const defaultCostEstimator = new DefaultCostEstimator();

/**
 * Helper function to enrich usage object with estimated cost.
 */
export function enrichUsageWithCost(usage: { tokensIn: number; tokensOut: number }, pricing?: CostMetadata): Usage {
  const totalTokens = usage.tokensIn + usage.tokensOut;
  if (!pricing) {
    return { ...usage, totalTokens };
  }
  const estimatedCost = defaultCostEstimator.estimateCost(usage, pricing);
  return {
    ...usage,
    totalTokens,
    estimatedCost,
  };
}
