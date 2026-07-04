import { describe, it, expect, beforeEach } from 'vitest';
import { InferenceManager } from '../inference/inference-manager';
import { DefaultHealthManager } from '../inference/health-manager';
import type { LLMProvider, CompletionOptions, CompletionResponse, ProviderCapabilities, ProviderHealth } from '../types';
import { ProviderUnavailableError, RateLimitError } from '../errors';

class MockProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private shouldFailWithRateLimit = false;
  private callsCount = 0;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  setRateLimitFailure(fail: boolean) {
    this.shouldFailWithRateLimit = fail;
  }

  getCallsCount() {
    return this.callsCount;
  }

  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    this.callsCount++;
    if (this.shouldFailWithRateLimit) {
      throw new RateLimitError(this.id, 100);
    }
    return {
      text: `Response from ${this.id} for model ${options.model}`,
      finishReason: 'stop',
      usage: { tokensIn: 10, tokensOut: 20, totalTokens: 30, estimatedCost: 0.001 },
      provider: this.id,
      model: options.model,
    };
  }

  async *stream(options: CompletionOptions) {
    yield { textDelta: `Stream from ${this.id}`, provider: this.id, model: options.model };
  }

  async embed() {
    return { embeddings: [[0.1, 0.2]], usage: { tokensIn: 5, totalTokens: 5 }, provider: this.id, model: 'embed' };
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsChat: true,
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonMode: true,
      supportsEmbeddings: true,
      supportsVision: false,
      supportedModels: [`${this.id}-model`],
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return this.getHealth();
  }

  getHealth(): ProviderHealth {
    return { status: 'healthy', availabilityPercentage: 100, modelAvailability: {} };
  }
}

describe('InferenceManager & HealthManager', () => {
  let manager: InferenceManager;
  let healthManager: DefaultHealthManager;
  let primaryMock: MockProvider;
  let fallbackMock: MockProvider;

  beforeEach(() => {
    healthManager = new DefaultHealthManager();
    manager = new InferenceManager(false, healthManager);
    primaryMock = new MockProvider('nvidia', 'NVIDIA Mock');
    fallbackMock = new MockProvider('openai', 'OpenAI Mock');
    manager.registerProvider(primaryMock);
    manager.registerProvider(fallbackMock);
  });

  it('should register and retrieve providers', () => {
    expect(manager.listProviderIds()).toContain('nvidia');
    expect(manager.listProviderIds()).toContain('openai');
    expect(manager.getProvider('nvidia')).toBe(primaryMock);
  });

  it('should throw ProviderUnavailableError for unregistered providers', () => {
    expect(() => manager.getProvider('non-existent')).toThrow(ProviderUnavailableError);
  });

  it('should execute completion against primary provider resolved from model or hint', async () => {
    const response = await manager.execute({
      model: 'meta/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(response.provider).toBe('nvidia');
    expect(primaryMock.getCallsCount()).toBe(1);
    expect(fallbackMock.getCallsCount()).toBe(0);
  });

  it('should automatically failover to secondary provider when primary fails with retryable error', async () => {
    primaryMock.setRateLimitFailure(true);

    const response = await manager.executeWithFallback(
      {
        model: 'meta/llama-3.3-70b-instruct',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      ['openai']
    );

    expect(primaryMock.getCallsCount()).toBe(1);
    expect(fallbackMock.getCallsCount()).toBe(1);
    expect(response.provider).toBe('openai');
  });

  it('should trip circuit breaker after failure threshold in HealthManager', () => {
    expect(healthManager.isAvailable('nvidia')).toBe(true);
    healthManager.recordFailure('nvidia', new Error('Fail 1'));
    healthManager.recordFailure('nvidia', new Error('Fail 2'));
    healthManager.recordFailure('nvidia', new Error('Fail 3'));

    expect(healthManager.isAvailable('nvidia')).toBe(false);
    expect(healthManager.getCircuitStatus('nvidia').state).toBe('open');
  });
});
