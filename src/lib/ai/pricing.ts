export interface ModelPricing {
  promptPer1k: number;
  completionPer1k: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  'gpt-4o': { promptPer1k: 0.0025, completionPer1k: 0.01 },
  'gpt-4-turbo': { promptPer1k: 0.01, completionPer1k: 0.03 },
  'claude-3-haiku': { promptPer1k: 0.00025, completionPer1k: 0.00125 },
  'claude-3-sonnet': { promptPer1k: 0.003, completionPer1k: 0.015 },
  'claude-3-5-sonnet': { promptPer1k: 0.003, completionPer1k: 0.015 },
};

export function estimateCost(model: string, tokensIn: number, tokensOut: number) {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-4o-mini'];
  const cost = (tokensIn / 1000) * pricing.promptPer1k + (tokensOut / 1000) * pricing.completionPer1k;
  return Number(cost.toFixed(6));
}