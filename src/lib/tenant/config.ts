export interface TenantBranding {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  font?: string;
}

export interface TenantAISettings {
  systemPrompt?: string;
  defaultModel?: string;
  language?: string;
  /** Custom base URL for any OpenAI-compatible API (Groq, OpenRouter, Ollama, vLLM, etc.) */
  customBaseUrl?: string;
  /** API key for the custom provider */
  customApiKey?: string;
  /** Set to true when using Anthropic's native API format instead of OpenAI-compatible */
  useAnthropicFormat?: boolean;
  /** @deprecated Use customApiKey instead */
  apiKeys?: {
    openai?: string;
    anthropic?: string;
  };
  budgets?: {
    monthlyBudget?: number;
    dailyBudget?: number;
    maxTokensPerRequest?: number;
    maxRequestsPerMinute?: number;
  };
}

export interface TenantFeatures {
  pipeline?: boolean;
  chatbot?: boolean;
  analytics?: boolean;
  payments?: boolean;
  email?: boolean;
  whatsapp?: boolean;
  sms?: boolean;
}

export interface TenantIntegrations {
  email?: boolean;
  whatsapp?: boolean;
  sms?: boolean;
  stripe?: boolean;
  calendar?: boolean;
}

export interface TenantSettings {
  branding: TenantBranding;
  ai: TenantAISettings;
  features: TenantFeatures;
  integrations: TenantIntegrations;
}

export const defaultTenantSettings: TenantSettings = {
  branding: {},
  ai: {
    defaultModel: 'gpt-4o-mini',
    language: 'en',
  },
  features: {
    pipeline: true,
    chatbot: true,
    analytics: true,
    payments: false,
    email: true,
    whatsapp: true,
    sms: false,
  },
  integrations: {
    email: true,
    whatsapp: true,
    sms: false,
    stripe: false,
    calendar: false,
  },
};