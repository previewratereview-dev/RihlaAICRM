import { describe, it, expect } from 'vitest';
import { container, AIOSContainer } from '../container';
import { AIKernel } from '../kernel';
import { InferenceManager } from '../inference';
import { DefaultEventBus } from '../events';

describe('AIOSContainer (Dependency Injection)', () => {
  it('should resolve default production instances', () => {
    expect(container.resolveKernel()).toBeInstanceOf(AIKernel);
    expect(container.resolveInferenceManager()).toBeInstanceOf(InferenceManager);
    expect(container.resolveEventBus()).toBeDefined();
    expect(container.resolveHealthManager()).toBeDefined();
    expect(container.resolvePolicyEngine()).toBeDefined();
    expect(container.resolveTelemetry()).toBeDefined();
  });

  it('should allow binding custom subsystem overrides for testing', () => {
    const testContainer = new AIOSContainer();
    const mockBus = new DefaultEventBus();
    testContainer.bindEventBus(mockBus);

    expect(testContainer.resolveEventBus()).toBe(mockBus);
  });
});
