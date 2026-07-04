/**
 * StateAI AI Operating System (AIOS) — Configuration
 * 
 * Centralized, type-safe configuration management for AIOS.
 * Supports API keys, base URLs, timeouts, retries, streaming, fallback providers,
 * temperature, max tokens, model defaults, and JSON mode.
 * 
 * STRICT RULE: Everything configurable. Nothing hardcoded in business logic or providers.
 */

import { z } from 'zod';
import { ProviderConfigurationError } from './errors';

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
  maxRetries: number;
  enabled: boolean;
  defaultHeaders?: Record<string, string>;
}

export const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  timeoutMs: z.number().positive(),
  maxRetries: z.number().min(0),
  enabled: z.boolean(),
  defaultHeaders: z.record(z.string(), z.string()).optional(),
});

export const AIOSConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema),
  defaults: z.object({
    chatModel: z.string().min(1),
    reasoningModel: z.string().min(1),
    embeddingModel: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().positive(),
    timeoutMs: z.number().positive(),
    maxRetries: z.number().min(0),
    streaming: z.boolean(),
    jsonMode: z.boolean(),
  }),
  fallbackProviders: z.array(z.string()),
});

export interface AIOSConfig {
  providers: {
    openai: ProviderConfig;
    nvidia: ProviderConfig;
    anthropic: ProviderConfig;
    glm: ProviderConfig;
    ollama: ProviderConfig;
    [key: string]: ProviderConfig;
  };
  defaults: {
    chatModel: string;
    reasoningModel: string;
    embeddingModel: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    maxRetries: number;
    streaming: boolean;
    jsonMode: boolean;
  };
  fallbackProviders: string[];
}

/**
 * Validate AIOS configuration against Zod schema at runtime.
 * Throws ProviderConfigurationError if configuration is malformed.
 */
export function validateAIOSConfig(config: unknown): AIOSConfig {
  const result = AIOSConfigSchema.safeParse(config);
  if (!result.success) {
    throw new ProviderConfigurationError(
      'system',
      `Invalid AIOS Configuration: ${result.error.issues.map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`).join(', ')}`
    );
  }
  return result.data as AIOSConfig;
}

/**
 * Default base configuration values.
 * Can be overridden via environment variables or runtime configuration updates.
 */
export const DEFAULT_AIOS_CONFIG: AIOSConfig = {
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      timeoutMs: Number(process.env.AIOS_TIMEOUT_MS) || 30000,
      maxRetries: Number(process.env.AIOS_MAX_RETRIES) || 2,
      enabled: !!process.env.OPENAI_API_KEY,
    },
    nvidia: {
      apiKey: process.env.NVIDIA_API_KEY,
      baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      timeoutMs: Number(process.env.AIOS_TIMEOUT_MS) || 30000,
      maxRetries: Number(process.env.AIOS_MAX_RETRIES) || 2,
      enabled: !!process.env.NVIDIA_API_KEY,
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      timeoutMs: Number(process.env.AIOS_TIMEOUT_MS) || 30000,
      maxRetries: Number(process.env.AIOS_MAX_RETRIES) || 2,
      enabled: !!process.env.ANTHROPIC_API_KEY,
    },
    glm: {
      apiKey: process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY,
      baseUrl: process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
      timeoutMs: Number(process.env.AIOS_TIMEOUT_MS) || 30000,
      maxRetries: Number(process.env.AIOS_MAX_RETRIES) || 2,
      enabled: !!(process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY),
    },
    ollama: {
      apiKey: 'ollama', // Ollama typically doesn't require an API key locally
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      timeoutMs: Number(process.env.AIOS_TIMEOUT_MS) || 60000, // Local inference might take longer
      maxRetries: Number(process.env.AIOS_MAX_RETRIES) || 1,
      enabled: process.env.OLLAMA_ENABLED === 'true' || process.env.NODE_ENV === 'development',
    },
  },
  defaults: {
    chatModel: process.env.AIOS_DEFAULT_CHAT_MODEL || 'gpt-4o-mini',
    reasoningModel: process.env.AIOS_DEFAULT_REASONING_MODEL || 'gpt-4o',
    embeddingModel: process.env.AIOS_DEFAULT_EMBEDDING_MODEL || 'text-embedding-3-small',
    temperature: Number(process.env.AIOS_DEFAULT_TEMPERATURE) || 0.7,
    maxTokens: Number(process.env.AIOS_DEFAULT_MAX_TOKENS) || 1024,
    timeoutMs: Number(process.env.AIOS_TIMEOUT_MS) || 30000,
    maxRetries: Number(process.env.AIOS_MAX_RETRIES) || 2,
    streaming: process.env.AIOS_DEFAULT_STREAMING === 'true',
    jsonMode: false,
  },
  fallbackProviders: (process.env.AIOS_FALLBACK_PROVIDERS || 'openai,anthropic,nvidia').split(',').map(s => s.trim()).filter(Boolean),
};

let activeConfig: AIOSConfig = validateAIOSConfig(JSON.parse(JSON.stringify(DEFAULT_AIOS_CONFIG)));

/**
 * Get the current active AIOS configuration.
 * Returns a defensive copy to prevent accidental mutation.
 */
export function getAIOSConfig(): AIOSConfig {
  return JSON.parse(JSON.stringify(activeConfig));
}

/**
 * Update AIOS configuration at runtime (e.g., from tenant settings or database overrides).
 * Performs a deep merge over the active configuration.
 */
export function updateAIOSConfig(overrides: Partial<AIOSConfig>): AIOSConfig {
  if (overrides.providers) {
    for (const [key, val] of Object.entries(overrides.providers)) {
      activeConfig.providers[key] = {
        ...activeConfig.providers[key],
        ...val,
      };
    }
  }
  if (overrides.defaults) {
    activeConfig.defaults = {
      ...activeConfig.defaults,
      ...overrides.defaults,
    };
  }
  if (overrides.fallbackProviders) {
    activeConfig.fallbackProviders = [...overrides.fallbackProviders];
  }
  validateAIOSConfig(activeConfig);
  return getAIOSConfig();
}

/**
 * Reset AIOS configuration back to default environment-based settings.
 */
export function resetAIOSConfig(): void {
  activeConfig = validateAIOSConfig(JSON.parse(JSON.stringify(DEFAULT_AIOS_CONFIG)));
}

/**
 * Resolve provider configuration by name.
 */
export function getProviderConfig(providerName: string): ProviderConfig {
  const cfg = activeConfig.providers[providerName.toLowerCase()];
  if (!cfg) {
    return {
      timeoutMs: activeConfig.defaults.timeoutMs,
      maxRetries: activeConfig.defaults.maxRetries,
      enabled: false,
    };
  }
  return { ...cfg };
}
