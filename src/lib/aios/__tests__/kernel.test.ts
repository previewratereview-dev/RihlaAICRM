import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIKernel } from '../kernel/ai-kernel';
import { InferenceManager } from '../inference/inference-manager';
import { DefaultPolicyEngine } from '../policies';
import { DefaultFeatureFlagManager } from '../security';
import { DefaultEventBus } from '../events';
import { ConsoleTelemetry } from '../telemetry';
import { ProviderConfigurationError } from '../errors';
import type { LLMProvider } from '../types';

class DummyProvider implements LLMProvider {
  readonly id = 'openai';
  readonly name = 'Dummy OpenAI';
  async complete(options: any) {
    return {
      text: 'Kernel execution success',
      finishReason: 'stop' as const,
      usage: { tokensIn: 5, tokensOut: 10, totalTokens: 15 },
      provider: 'openai',
      model: options.model,
    };
  }
  async *stream() { yield { textDelta: 'chunk', provider: 'openai', model: 'gpt-4o-mini' }; }
  async embed() { return { embeddings: [[0]], usage: { tokensIn: 1, totalTokens: 1 }, provider: 'openai', model: 'embed' }; }
  getCapabilities() { return { supportsChat: true, supportsStreaming: true, supportsToolCalling: true, supportsJsonMode: true, supportsEmbeddings: true, supportsVision: true, supportedModels: ['gpt-4o-mini'] }; }
  async healthCheck() { return this.getHealth(); }
  getHealth() { return { status: 'healthy' as const, availabilityPercentage: 100, modelAvailability: {} }; }
}

describe('AIKernel', () => {
  let kernel: AIKernel;
  let inferenceManager: InferenceManager;
  let policyEngine: DefaultPolicyEngine;
  let featureFlags: DefaultFeatureFlagManager;
  let eventBus: DefaultEventBus;

  beforeEach(() => {
    inferenceManager = new InferenceManager(false);
    inferenceManager.registerProvider(new DummyProvider());
    policyEngine = new DefaultPolicyEngine(true);
    featureFlags = new DefaultFeatureFlagManager();
    eventBus = new DefaultEventBus();
    kernel = new AIKernel(inferenceManager, policyEngine, featureFlags, eventBus, new ConsoleTelemetry());
  });

  it('should execute inference successfully through Kernel', async () => {
    const response = await kernel.execute({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hello' }],
      tenantId: 'tenant-123',
    });

    expect(response.text).toBe('Kernel execution success');
  });

  it('should deny execution when PolicyEngine forbids action without HITL/privilege', async () => {
    await expect(
      kernel.execute({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Delete customer' }],
        action: 'delete_record',
        metadata: { userRole: 'viewer' },
      })
    ).rejects.toThrow(ProviderConfigurationError);
  });

  it('should allow execution when PolicyEngine conditions are met', async () => {
    const response = await kernel.execute({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Send email' }],
      action: 'send_email',
      metadata: { autonomousApproved: true },
    });

    expect(response.text).toBe('Kernel execution success');
  });

  it('should broadcast kernel and inference lifecycle events to EventBus', async () => {
    const eventsReceived: string[] = [];
    eventBus.subscribe('*', (evt) => {
      eventsReceived.push(evt.type);
    });

    await kernel.execute({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Test events' }],
    });

    expect(eventsReceived).toContain('kernel.started');
    expect(eventsReceived).toContain('inference.started');
    expect(eventsReceived).toContain('inference.completed');
    expect(eventsReceived).toContain('kernel.completed');
  });
});
