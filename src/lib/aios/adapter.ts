/**
 * StateAI AI Operating System (AIOS) — Migration Adapter Layer
 * 
 * Provides backward-compatible wrappers around AIOS Kernel & InferenceManager so existing
 * API routes and legacy services (`src/lib/ai/**`) can migrate gradually to AIOS
 * without modifying production endpoints or breaking existing functionality.
 */

import { defaultInferenceManager } from './inference';
import { defaultKernel } from './kernel';
import type { CompletionOptions, CompletionResponse, StreamingChunk, EmbeddingOptions, EmbeddingResponse } from './types';
import { enrichUsageWithCost } from './utils';
import { defaultModelRegistry } from './models';

export interface LegacyAIRequestOptions {
  model?: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
  fallbackProviders?: string[];
  tenantId?: string;
  userId?: string;
}

export interface LegacyAIResponse {
  text: string;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number;
}

/**
 * Adapter function mirroring legacy AI execution signatures while routing
 * through AIOS Kernel with automated failover, policy governance, and cost estimation.
 */
export async function executeAIOSRequest(options: LegacyAIRequestOptions): Promise<LegacyAIResponse> {
  const model = options.model || 'gpt-4o-mini';
  const messages = [];

  if (options.systemPrompt) {
    messages.push({ role: 'system' as const, content: options.systemPrompt });
  }
  messages.push({ role: 'user' as const, content: options.prompt });

  const completionOptions: CompletionOptions = {
    model,
    messages,
    maxTokens: options.maxTokens || 1024,
    temperature: options.temperature ?? 0.7,
    apiKey: options.apiKey,
    metadata: { fallbackProviders: options.fallbackProviders },
  };

  const response: CompletionResponse = await defaultKernel.execute({
    ...completionOptions,
    tenantId: options.tenantId,
    userId: options.userId,
  });

  const modelInfo = defaultModelRegistry.getModel(response.model);
  const usageWithCost = enrichUsageWithCost(response.usage, modelInfo?.costMetadata);

  return {
    text: response.text,
    model: response.model,
    provider: response.provider,
    tokensIn: usageWithCost.tokensIn,
    tokensOut: usageWithCost.tokensOut,
    estimatedCost: usageWithCost.estimatedCost || 0,
  };
}

/**
 * Streaming adapter function for gradual migration of SSE endpoints.
 */
export function streamAIOSRequest(options: LegacyAIRequestOptions): AsyncIterable<StreamingChunk> {
  const model = options.model || 'gpt-4o-mini';
  const messages = [];

  if (options.systemPrompt) {
    messages.push({ role: 'system' as const, content: options.systemPrompt });
  }
  messages.push({ role: 'user' as const, content: options.prompt });

  const completionOptions: CompletionOptions = {
    model,
    messages,
    maxTokens: options.maxTokens || 1024,
    temperature: options.temperature ?? 0.7,
    apiKey: options.apiKey,
  };

  return defaultKernel.stream({
    ...completionOptions,
    tenantId: options.tenantId,
    userId: options.userId,
  });
}

/**
 * Embedding adapter function for gradual migration of RAG indexing and searching.
 */
export async function embedAIOSRequest(text: string | string[], model = 'text-embedding-3-small', apiKey?: string): Promise<EmbeddingResponse> {
  const options: EmbeddingOptions = {
    model,
    input: text,
    apiKey,
  };
  return await defaultInferenceManager.embed(options);
}
