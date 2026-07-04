/**
 * StateAI AI Operating System (AIOS) — Model Registry (Moved to models/)
 * 
 * Authoritative registry of LLM model capabilities, pricing, context windows,
 * speed tiers, and feature flags. Leverages CapabilityRegistry.
 * 
 * STRICT RULE: The rest of AIOS must never hardcode models.
 */

import type { ModelInfo } from '../types';
import { InvalidModelError } from '../errors';
import { defaultCapabilityRegistry } from '../capabilities';

export class ModelRegistry {
  private models: Map<string, ModelInfo> = new Map();

  constructor(initialModels?: ModelInfo[]) {
    if (initialModels) {
      for (const m of initialModels) {
        this.registerModel(m);
      }
    } else {
      this.registerDefaultModels();
    }
  }

  registerModel(info: ModelInfo): void {
    this.models.set(info.id.toLowerCase(), { ...info });
  }

  unregisterModel(id: string): boolean {
    return this.models.delete(id.toLowerCase());
  }

  getModel(id: string): ModelInfo | undefined {
    return this.models.get(id.toLowerCase());
  }

  getRequiredModel(id: string, provider = 'unknown'): ModelInfo {
    const model = this.getModel(id);
    if (!model) {
      throw new InvalidModelError(provider, id);
    }
    return model;
  }

  listModels(filter?: (model: ModelInfo) => boolean): ModelInfo[] {
    const all = Array.from(this.models.values()).map(m => ({ ...m }));
    if (!filter) return all;
    return all.filter(filter);
  }

  getModelsByProvider(providerId: string): ModelInfo[] {
    return this.listModels(m => m.provider.toLowerCase() === providerId.toLowerCase());
  }

  getModelsByCapability(options: {
    streaming?: boolean;
    toolCalling?: boolean;
    vision?: boolean;
    json?: boolean;
    embeddings?: boolean;
    flag?: string;
  }): ModelInfo[] {
    return this.listModels(m => {
      if (options.streaming !== undefined && m.supportsStreaming !== options.streaming) return false;
      if (options.toolCalling !== undefined && m.supportsToolCalling !== options.toolCalling) return false;
      if (options.vision !== undefined && m.supportsVision !== options.vision) return false;
      if (options.json !== undefined && m.supportsJson !== options.json) return false;
      if (options.embeddings !== undefined && m.supportsEmbeddings !== options.embeddings) return false;
      if (options.flag && !m.capabilityFlags.includes(options.flag) && !defaultCapabilityRegistry.hasCapability(options.flag)) return false;
      return true;
    });
  }

  private registerDefaultModels(): void {
    const defaults: ModelInfo[] = [
      {
        id: 'meta/llama-3.3-70b-instruct',
        name: 'Llama 3.3 70B Instruct (NVIDIA)',
        provider: 'nvidia',
        supportsStreaming: true,
        supportsVision: false,
        supportsToolCalling: true,
        supportsJson: true,
        supportsEmbeddings: false,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        costMetadata: { promptPer1k: 0.0006, completionPer1k: 0.0008, currency: 'USD' },
        speedMetadata: { tier: 'fast', averageTokensPerSecond: 85 },
        reasoningScore: 8,
        capabilityFlags: ['chat', 'reasoning', 'function_calling', 'streaming', 'json'],
      },
      {
        id: 'mistralai/mistral-large-2-instruct',
        name: 'Mistral Large 2 (NVIDIA)',
        provider: 'nvidia',
        supportsStreaming: true,
        supportsVision: false,
        supportsToolCalling: true,
        supportsJson: true,
        supportsEmbeddings: false,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        costMetadata: { promptPer1k: 0.002, completionPer1k: 0.006, currency: 'USD' },
        speedMetadata: { tier: 'balanced', averageTokensPerSecond: 60 },
        reasoningScore: 9,
        capabilityFlags: ['chat', 'reasoning', 'function_calling', 'multilingual', 'streaming', 'json'],
      },
      {
        id: 'nvidia/nemotron-4-340b-instruct',
        name: 'Nemotron 4 340B Instruct',
        provider: 'nvidia',
        supportsStreaming: true,
        supportsVision: false,
        supportsToolCalling: true,
        supportsJson: true,
        supportsEmbeddings: false,
        contextWindow: 4096,
        maxOutputTokens: 4096,
        costMetadata: { promptPer1k: 0.003, completionPer1k: 0.009, currency: 'USD' },
        speedMetadata: { tier: 'heavy', averageTokensPerSecond: 40 },
        reasoningScore: 9,
        capabilityFlags: ['chat', 'reasoning', 'enterprise_accurate', 'streaming', 'json'],
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'openai',
        supportsStreaming: true,
        supportsVision: true,
        supportsToolCalling: true,
        supportsJson: true,
        supportsEmbeddings: false,
        contextWindow: 128000,
        maxOutputTokens: 16384,
        costMetadata: { promptPer1k: 0.00015, completionPer1k: 0.0006, currency: 'USD' },
        speedMetadata: { tier: 'fast', averageTokensPerSecond: 100 },
        reasoningScore: 7,
        capabilityFlags: ['chat', 'vision', 'function_calling', 'fast', 'streaming', 'json'],
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        supportsStreaming: true,
        supportsVision: true,
        supportsToolCalling: true,
        supportsJson: true,
        supportsEmbeddings: false,
        contextWindow: 128000,
        maxOutputTokens: 16384,
        costMetadata: { promptPer1k: 0.0025, completionPer1k: 0.01, currency: 'USD' },
        speedMetadata: { tier: 'balanced', averageTokensPerSecond: 75 },
        reasoningScore: 9,
        capabilityFlags: ['chat', 'vision', 'function_calling', 'reasoning', 'streaming', 'json'],
      },
      {
        id: 'text-embedding-3-small',
        name: 'Text Embedding 3 Small',
        provider: 'openai',
        supportsStreaming: false,
        supportsVision: false,
        supportsToolCalling: false,
        supportsJson: false,
        supportsEmbeddings: true,
        contextWindow: 8191,
        maxOutputTokens: 0,
        costMetadata: { promptPer1k: 0.00002, completionPer1k: 0, currency: 'USD' },
        speedMetadata: { tier: 'fast' },
        reasoningScore: 0,
        capabilityFlags: ['embeddings'],
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        supportsStreaming: true,
        supportsVision: true,
        supportsToolCalling: true,
        supportsJson: true,
        supportsEmbeddings: false,
        contextWindow: 200000,
        maxOutputTokens: 8192,
        costMetadata: { promptPer1k: 0.003, completionPer1k: 0.015, currency: 'USD' },
        speedMetadata: { tier: 'balanced', averageTokensPerSecond: 65 },
        reasoningScore: 10,
        capabilityFlags: ['chat', 'vision', 'function_calling', 'reasoning', 'coding', 'streaming', 'json'],
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        provider: 'anthropic',
        supportsStreaming: true,
        supportsVision: true,
        supportsToolCalling: true,
        supportsJson: true,
        supportsEmbeddings: false,
        contextWindow: 200000,
        maxOutputTokens: 4096,
        costMetadata: { promptPer1k: 0.00025, completionPer1k: 0.00125, currency: 'USD' },
        speedMetadata: { tier: 'fast', averageTokensPerSecond: 110 },
        reasoningScore: 7,
        capabilityFlags: ['chat', 'vision', 'function_calling', 'fast', 'streaming', 'json'],
      },
      {
        id: 'glm-4',
        name: 'GLM 4',
        provider: 'glm',
        supportsStreaming: true,
        supportsVision: false,
        supportsToolCalling: true,
        supportsJson: true,
        supportsEmbeddings: false,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        costMetadata: { promptPer1k: 0.0014, completionPer1k: 0.0014, currency: 'USD' },
        speedMetadata: { tier: 'balanced' },
        reasoningScore: 8,
        capabilityFlags: ['chat', 'function_calling', 'streaming', 'json'],
      },
      {
        id: 'llama3.1:8b',
        name: 'Llama 3.1 8B (Local)',
        provider: 'ollama',
        supportsStreaming: true,
        supportsVision: false,
        supportsToolCalling: true,
        supportsJson: true,
        supportsEmbeddings: false,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        costMetadata: { promptPer1k: 0, completionPer1k: 0, currency: 'USD' },
        speedMetadata: { tier: 'fast' },
        reasoningScore: 7,
        capabilityFlags: ['chat', 'local', 'free', 'function_calling', 'streaming', 'json'],
      },
    ];

    for (const model of defaults) {
      this.registerModel(model);
    }
  }
}

export const defaultModelRegistry = new ModelRegistry();
