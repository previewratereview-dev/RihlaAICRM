/**
 * StateAI AI Operating System (AIOS) — Health Manager & Circuit Breaker
 * 
 * Separates health monitoring, circuit breaking, latency tracking, and availability
 * evaluation from inference execution.
 */

import type { LLMProvider, ProviderHealth } from '../types';
import { defaultEventBus } from '../events';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface ProviderCircuitStatus {
  state: CircuitState;
  failuresCount: number;
  lastFailureTime?: number;
  successCountInHalfOpen: number;
}

export interface HealthManager {
  checkHealth(provider: LLMProvider): Promise<ProviderHealth>;
  checkAll(providers: Map<string, LLMProvider>): Promise<Record<string, ProviderHealth>>;
  recordSuccess(providerId: string, latencyMs: number): void;
  recordFailure(providerId: string, error: unknown): void;
  isAvailable(providerId: string): boolean;
  getCircuitStatus(providerId: string): ProviderCircuitStatus;
}

export class DefaultHealthManager implements HealthManager {
  private circuits: Map<string, ProviderCircuitStatus> = new Map();
  private healthCache: Map<string, ProviderHealth> = new Map();
  private readonly failureThreshold = 3;
  private readonly openTimeoutMs = 30000; // 30 seconds circuit open
  private readonly halfOpenSuccessThreshold = 2;

  constructor() {}

  async checkHealth(provider: LLMProvider): Promise<ProviderHealth> {
    const id = provider.id.toLowerCase();
    try {
      const health = await provider.healthCheck();
      this.healthCache.set(id, health);
      if (health.status === 'healthy') {
        this.recordSuccess(id, 0);
      }
      return health;
    } catch (err) {
      this.recordFailure(id, err);
      const unhealthy: ProviderHealth = {
        status: 'unhealthy',
        availabilityPercentage: 0,
        lastFailure: new Date(),
        lastErrorMessage: err instanceof Error ? err.message : String(err),
        modelAvailability: {},
      };
      this.healthCache.set(id, unhealthy);
      return unhealthy;
    }
  }

  async checkAll(providers: Map<string, LLMProvider>): Promise<Record<string, ProviderHealth>> {
    const results: Record<string, ProviderHealth> = {};
    const checks = Array.from(providers.entries()).map(async ([id, provider]) => {
      results[id] = await this.checkHealth(provider);
    });
    await Promise.all(checks);
    return results;
  }

  recordSuccess(providerId: string, latencyMs: number): void {
    const id = providerId.toLowerCase();
    const status = this.getCircuitStatus(id);

    if (status.state === 'half-open') {
      status.successCountInHalfOpen++;
      if (status.successCountInHalfOpen >= this.halfOpenSuccessThreshold) {
        status.state = 'closed';
        status.failuresCount = 0;
        status.successCountInHalfOpen = 0;
        defaultEventBus.publish('circuit.reset', { providerId: id }).catch(() => {});
      }
    } else if (status.state === 'closed') {
      status.failuresCount = 0;
    }
  }

  recordFailure(providerId: string, error: unknown): void {
    const id = providerId.toLowerCase();
    const status = this.getCircuitStatus(id);

    status.failuresCount++;
    status.lastFailureTime = Date.now();

    if (status.state === 'half-open' || status.failuresCount >= this.failureThreshold) {
      if (status.state !== 'open') {
        status.state = 'open';
        defaultEventBus.publish('circuit.tripped', {
          providerId: id,
          failuresCount: status.failuresCount,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
      }
    }
  }

  isAvailable(providerId: string): boolean {
    const id = providerId.toLowerCase();
    const status = this.getCircuitStatus(id);

    if (status.state === 'closed') return true;

    if (status.state === 'open') {
      const elapsed = Date.now() - (status.lastFailureTime || 0);
      if (elapsed >= this.openTimeoutMs) {
        // Transition to half-open to test availability
        status.state = 'half-open';
        status.successCountInHalfOpen = 0;
        return true;
      }
      return false;
    }

    // half-open allows limited trial traffic
    return true;
  }

  getCircuitStatus(providerId: string): ProviderCircuitStatus {
    const id = providerId.toLowerCase();
    if (!this.circuits.has(id)) {
      this.circuits.set(id, {
        state: 'closed',
        failuresCount: 0,
        successCountInHalfOpen: 0,
      });
    }
    return this.circuits.get(id)!;
  }
}

export const defaultHealthManager = new DefaultHealthManager();
