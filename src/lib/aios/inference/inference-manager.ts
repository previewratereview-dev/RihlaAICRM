/**
 * StateAI AI Operating System (AIOS) — Inference Manager (Formerly ProviderManager)
 * 
 * Central orchestrator responsible for managing provider lifecycle, routing requests,
 * executing automated failover / fallback across inference modalities (Chat, Embedding, Vision, etc.).
 * 
 * Delegates health tracking and circuit breaking to HealthManager.
 * Publishes lifecycle telemetry to EventBus.
 */

import type {
  LLMProvider,
  CompletionOptions,
  CompletionResponse,
  StreamingChunk,
  EmbeddingOptions,
  EmbeddingResponse,
  ProviderCapabilities,
  ProviderHealth,
  ModelInfo,
} from '../types';
import {
  ProviderUnavailableError,
  InvalidModelError,
} from '../errors';
import { getAIOSConfig } from '../config';
import { defaultModelRegistry } from '../models';
import { OpenAICompatibleProvider, AnthropicProvider } from '../providers';
import { defaultEventBus } from '../events';
import { defaultHealthManager, type HealthManager } from './health-manager';

export class InferenceManager {
  private providers: Map<string, LLMProvider> = new Map();
  private healthManager: HealthManager;

  constructor(autoRegisterDefaults = true, healthManager: HealthManager = defaultHealthManager) {
    this.healthManager = healthManager;
    if (autoRegisterDefaults) {
      this.registerDefaultProviders();
    }
  }

  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  unregisterProvider(id: string): boolean {
    return this.providers.delete(id.toLowerCase());
  }

  getProvider(id: string): LLMProvider {
    const lowerId = id.toLowerCase();
    const provider = this.providers.get(lowerId);
    if (!provider) {
      throw new ProviderUnavailableError(id, `Provider '${id}' is not registered in InferenceManager`);
    }
    if (!this.healthManager.isAvailable(lowerId)) {
      throw new ProviderUnavailableError(id, `Provider '${id}' circuit breaker is OPEN due to repeated failures`);
    }
    return provider;
  }

  listProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  async execute(options: CompletionOptions): Promise<CompletionResponse> {
    const provider = this.resolveProviderForModel(options.model, options.metadata?.provider as string);
    const startTime = Date.now();

    try {
      await defaultEventBus.publish('provider.started', { provider: provider.id, model: options.model });
      const response = await provider.complete(options);
      const latencyMs = Date.now() - startTime;
      
      this.healthManager.recordSuccess(provider.id, latencyMs);
      await defaultEventBus.publish('provider.finished', { provider: provider.id, model: options.model, latencyMs, usage: response.usage });
      
      return response;
    } catch (err) {
      this.healthManager.recordFailure(provider.id, err);
      await defaultEventBus.publish('provider.failed', { provider: provider.id, model: options.model, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async executeWithFallback(
    options: CompletionOptions,
    fallbackProviderIds?: string[]
  ): Promise<CompletionResponse> {
    const primaryProvider = this.resolveProviderForModel(options.model, options.metadata?.provider as string);
    const config = getAIOSConfig();
    const fallbacks = fallbackProviderIds || config.fallbackProviders;

    const attemptedProviders: string[] = [primaryProvider.id];
    let lastError: unknown;
    const startTime = Date.now();

    try {
      if (this.healthManager.isAvailable(primaryProvider.id)) {
        await defaultEventBus.publish('provider.started', { provider: primaryProvider.id, model: options.model });
        const response = await primaryProvider.complete(options);
        this.healthManager.recordSuccess(primaryProvider.id, Date.now() - startTime);
        await defaultEventBus.publish('provider.finished', { provider: primaryProvider.id, model: options.model, usage: response.usage });
        return response;
      } else {
        throw new ProviderUnavailableError(primaryProvider.id, `Circuit open for ${primaryProvider.id}`);
      }
    } catch (err) {
      lastError = err;
      this.healthManager.recordFailure(primaryProvider.id, err);
      await defaultEventBus.publish('provider.failed', { provider: primaryProvider.id, model: options.model, error: err instanceof Error ? err.message : String(err) });
      
      if (typeof err === 'object' && err !== null && 'retryable' in err && !(err as { retryable?: boolean }).retryable) {
        throw err;
      }
    }

    // Try fallback providers
    for (const fallbackId of fallbacks) {
      const lowerId = fallbackId.toLowerCase();
      if (attemptedProviders.includes(lowerId)) continue;
      
      const fallbackProvider = this.providers.get(lowerId);
      if (!fallbackProvider || !this.healthManager.isAvailable(lowerId)) continue;

      attemptedProviders.push(lowerId);
      const fallbackModel = this.resolveEquivalentModel(options.model, lowerId);
      if (!fallbackModel) continue;

      const fbStartTime = Date.now();
      try {
        await defaultEventBus.publish('provider.started', { provider: lowerId, model: fallbackModel.id, isFallback: true });
        const fallbackOptions: CompletionOptions = { ...options, model: fallbackModel.id };
        const response = await fallbackProvider.complete(fallbackOptions);
        
        this.healthManager.recordSuccess(lowerId, Date.now() - fbStartTime);
        await defaultEventBus.publish('provider.finished', { provider: lowerId, model: fallbackModel.id, usage: response.usage, isFallback: true });
        return response;
      } catch (fallbackErr) {
        lastError = fallbackErr;
        this.healthManager.recordFailure(lowerId, fallbackErr);
        await defaultEventBus.publish('provider.failed', { provider: lowerId, model: fallbackModel.id, error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) });
      }
    }

    throw lastError;
  }

  stream(options: CompletionOptions): AsyncIterable<StreamingChunk> {
    const provider = this.resolveProviderForModel(options.model, options.metadata?.provider as string);
    return provider.stream(options);
  }

  async embed(options: EmbeddingOptions): Promise<EmbeddingResponse> {
    const provider = this.resolveProviderForModel(options.model);
    return await provider.embed(options);
  }

  async healthCheck(): Promise<Record<string, ProviderHealth>> {
    return await this.healthManager.checkAll(this.providers);
  }

  getHealth(): Record<string, ProviderHealth> {
    const results: Record<string, ProviderHealth> = {};
    for (const [id, provider] of this.providers.entries()) {
      results[id] = provider.getHealth();
    }
    return results;
  }

  getAvailableModels(): ModelInfo[] {
    const activeProviderIds = new Set(this.listProviderIds());
    return defaultModelRegistry.listModels(m => activeProviderIds.has(m.provider.toLowerCase()) && this.healthManager.isAvailable(m.provider));
  }

  getCapabilities(providerId: string): ProviderCapabilities {
    const provider = this.getProvider(providerId);
    return provider.getCapabilities();
  }

  private resolveProviderForModel(modelId: string, explicitProviderId?: string): LLMProvider {
    if (explicitProviderId) {
      return this.getProvider(explicitProviderId);
    }

    const modelInfo = defaultModelRegistry.getModel(modelId);
    if (modelInfo) {
      return this.getProvider(modelInfo.provider);
    }

    const lower = modelId.toLowerCase();
    if (lower.startsWith('gpt-') || lower.startsWith('text-embedding-')) return this.getProvider('openai');
    if (lower.startsWith('claude-')) return this.getProvider('anthropic');
    if (lower.includes('llama') || lower.includes('mistral') || lower.includes('nemotron')) {
      if (this.providers.has('nvidia')) return this.getProvider('nvidia');
      if (this.providers.has('ollama')) return this.getProvider('ollama');
    }
    if (lower.startsWith('glm-')) return this.getProvider('glm');

    throw new InvalidModelError('unknown', modelId);
  }

  private resolveEquivalentModel(originalModelId: string, targetProviderId: string): ModelInfo | undefined {
    const originalInfo = defaultModelRegistry.getModel(originalModelId);
    const targetModels = defaultModelRegistry.getModelsByProvider(targetProviderId);

    if (targetModels.length === 0) return undefined;
    if (!originalInfo) return targetModels[0];

    const matches = targetModels.filter(m => {
      if (originalInfo.supportsVision && !m.supportsVision) return false;
      if (originalInfo.supportsToolCalling && !m.supportsToolCalling) return false;
      if (originalInfo.supportsJson && !m.supportsJson) return false;
      return true;
    });

    if (matches.length === 0) return targetModels[0];
    matches.sort((a, b) => Math.abs(a.reasoningScore - originalInfo.reasoningScore) - Math.abs(b.reasoningScore - originalInfo.reasoningScore));
    return matches[0];
  }

  private registerDefaultProviders(): void {
    const config = getAIOSConfig();

    if (config.providers.openai.enabled) {
      this.registerProvider(new OpenAICompatibleProvider({ id: 'openai', name: 'OpenAI', apiKey: config.providers.openai.apiKey, baseUrl: config.providers.openai.baseUrl || 'https://api.openai.com/v1' }));
    }
    if (config.providers.nvidia.enabled) {
      this.registerProvider(new OpenAICompatibleProvider({ id: 'nvidia', name: 'NVIDIA AI Foundation', apiKey: config.providers.nvidia.apiKey, baseUrl: config.providers.nvidia.baseUrl || 'https://integrate.api.nvidia.com/v1' }));
    }
    if (config.providers.anthropic.enabled) {
      this.registerProvider(new AnthropicProvider({ apiKey: config.providers.anthropic.apiKey, baseUrl: config.providers.anthropic.baseUrl || 'https://api.anthropic.com' }));
    }
    if (config.providers.glm.enabled) {
      this.registerProvider(new OpenAICompatibleProvider({ id: 'glm', name: 'GLM / Zhipu AI', apiKey: config.providers.glm.apiKey, baseUrl: config.providers.glm.baseUrl || 'https://open.bigmodel.cn/api/paas/v4' }));
    }
    if (config.providers.ollama.enabled) {
      this.registerProvider(new OpenAICompatibleProvider({ id: 'ollama', name: 'Ollama Local', apiKey: 'ollama', baseUrl: config.providers.ollama.baseUrl || 'http://localhost:11434/v1' }));
    }
  }
}

export const defaultInferenceManager = new InferenceManager(true);
