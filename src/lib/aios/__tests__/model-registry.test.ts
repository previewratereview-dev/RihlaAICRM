import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRegistry } from '../models/model-registry';
import { InvalidModelError } from '../errors';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry([]); // Start empty for clean testing
  });

  it('should register and retrieve a model specification', () => {
    registry.registerModel({
      id: 'test-model-70b',
      name: 'Test Model 70B',
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
      capabilityFlags: ['chat', 'reasoning'],
    });

    const model = registry.getModel('test-model-70b');
    expect(model).toBeDefined();
    expect(model?.name).toBe('Test Model 70B');
    expect(model?.provider).toBe('nvidia');
  });

  it('should unregister a model by ID', () => {
    registry.registerModel({
      id: 'temp-model',
      name: 'Temp Model',
      provider: 'ollama',
      supportsStreaming: true,
      supportsVision: false,
      supportsToolCalling: false,
      supportsJson: false,
      supportsEmbeddings: false,
      contextWindow: 4096,
      maxOutputTokens: 2048,
      costMetadata: { promptPer1k: 0, completionPer1k: 0, currency: 'USD' },
      speedMetadata: { tier: 'fast' },
      reasoningScore: 5,
      capabilityFlags: ['chat'],
    });

    expect(registry.getModel('temp-model')).toBeDefined();
    const removed = registry.unregisterModel('temp-model');
    expect(removed).toBe(true);
    expect(registry.getModel('temp-model')).toBeUndefined();
  });

  it('should throw InvalidModelError when getRequiredModel is called for missing model', () => {
    expect(() => registry.getRequiredModel('non-existent-model', 'openai')).toThrow(InvalidModelError);
  });

  it('should filter models by provider', () => {
    registry.registerModel({
      id: 'model-1', name: 'M1', provider: 'openai', supportsStreaming: true, supportsVision: false, supportsToolCalling: true, supportsJson: true, supportsEmbeddings: false, contextWindow: 8192, maxOutputTokens: 4096, costMetadata: { promptPer1k: 0, completionPer1k: 0, currency: 'USD' }, speedMetadata: { tier: 'fast' }, reasoningScore: 7, capabilityFlags: ['chat'],
    });
    registry.registerModel({
      id: 'model-2', name: 'M2', provider: 'anthropic', supportsStreaming: true, supportsVision: false, supportsToolCalling: true, supportsJson: true, supportsEmbeddings: false, contextWindow: 8192, maxOutputTokens: 4096, costMetadata: { promptPer1k: 0, completionPer1k: 0, currency: 'USD' }, speedMetadata: { tier: 'fast' }, reasoningScore: 7, capabilityFlags: ['chat'],
    });

    const openaiModels = registry.getModelsByProvider('openai');
    expect(openaiModels).toHaveLength(1);
    expect(openaiModels[0].id).toBe('model-1');
  });

  it('should filter models by capability flags and booleans', () => {
    registry.registerModel({
      id: 'vision-model', name: 'Vision', provider: 'openai', supportsStreaming: true, supportsVision: true, supportsToolCalling: true, supportsJson: true, supportsEmbeddings: false, contextWindow: 8192, maxOutputTokens: 4096, costMetadata: { promptPer1k: 0, completionPer1k: 0, currency: 'USD' }, speedMetadata: { tier: 'fast' }, reasoningScore: 7, capabilityFlags: ['chat', 'vision'],
    });
    registry.registerModel({
      id: 'text-model', name: 'Text', provider: 'openai', supportsStreaming: true, supportsVision: false, supportsToolCalling: true, supportsJson: true, supportsEmbeddings: false, contextWindow: 8192, maxOutputTokens: 4096, costMetadata: { promptPer1k: 0, completionPer1k: 0, currency: 'USD' }, speedMetadata: { tier: 'fast' }, reasoningScore: 7, capabilityFlags: ['chat'],
    });

    const visionModels = registry.getModelsByCapability({ vision: true });
    expect(visionModels).toHaveLength(1);
    expect(visionModels[0].id).toBe('vision-model');

    const chatModels = registry.getModelsByCapability({ flag: 'chat' });
    expect(chatModels).toHaveLength(2);
  });
});
