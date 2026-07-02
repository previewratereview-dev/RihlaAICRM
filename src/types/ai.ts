export interface AIScore {
  score: number;
  maxScore: number;
  percentage: number;
  breakdown: ScoreBreakdown[];
  calculatedAt: string;
  model?: string;
}

export interface ScoreBreakdown {
  label: string;
  points: number;
  reason: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  quickReplies?: string[];
}

export interface ChatResponse {
  message: string;
  quickReplies?: string[];
  escalateToHuman: boolean;
  confidence: number;
}

export interface AIUsageStats {
  month: string;
  feature: string;
  tokensUsed: number;
  cost: number;
  requests: number;
}

export interface AIConfig {
  enabled: boolean;
  provider: 'openai' | 'google' | 'groq' | 'fallback';
  model: string;
  monthlyBudget: number;
  currentSpend: number;
  maxTokensPerRequest: number;
}