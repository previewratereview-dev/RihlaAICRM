/**
 * StateAI AI Operating System (AIOS) — Resource Manager
 * 
 * Centralized governance for token budgets, rate limits, concurrency control,
 * and provider quotas across multi-tenant SaaS executions.
 */

export interface TenantResourceQuota {
  readonly tenantId: string;
  readonly maxTokensPerMinute: number;
  readonly maxConcurrentInferences: number;
  readonly monthlyUsdBudget: number;
  currentTokensThisMinute: number;
  currentConcurrentInferences: number;
  currentMonthlyUsdSpend: number;
}

export interface ResourceManager {
  checkTokenBudget(tenantId: string, estimatedTokens: number): boolean | Promise<boolean>;
  recordTokenUsage(tenantId: string, tokensUsed: number, costUsd: number): void | Promise<void>;
  acquireConcurrency(tenantId: string): boolean | Promise<boolean>;
  releaseConcurrency(tenantId: string): void | Promise<void>;
  getQuota(tenantId: string): TenantResourceQuota;
  setQuota(quota: Partial<TenantResourceQuota> & { tenantId: string }): void;
}

export class DefaultResourceManager implements ResourceManager {
  private quotas: Map<string, TenantResourceQuota> = new Map();

  constructor() {
    // Default global fallback quota
    this.setQuota({
      tenantId: 'global',
      maxTokensPerMinute: 100000,
      maxConcurrentInferences: 50,
      monthlyUsdBudget: 1000,
    });
  }

  getQuota(tenantId: string): TenantResourceQuota {
    if (!this.quotas.has(tenantId)) {
      this.setQuota({
        tenantId,
        maxTokensPerMinute: 50000,
        maxConcurrentInferences: 20,
        monthlyUsdBudget: 200,
      });
    }
    return this.quotas.get(tenantId)!;
  }

  setQuota(quota: Partial<TenantResourceQuota> & { tenantId: string }): void {
    const existing = this.quotas.get(quota.tenantId) || {
      tenantId: quota.tenantId,
      maxTokensPerMinute: 50000,
      maxConcurrentInferences: 20,
      monthlyUsdBudget: 200,
      currentTokensThisMinute: 0,
      currentConcurrentInferences: 0,
      currentMonthlyUsdSpend: 0,
    };

    this.quotas.set(quota.tenantId, {
      ...existing,
      ...quota,
    });
  }

  checkTokenBudget(tenantId: string, estimatedTokens: number): boolean {
    const quota = this.getQuota(tenantId);
    if (quota.currentTokensThisMinute + estimatedTokens > quota.maxTokensPerMinute) {
      return false;
    }
    if (quota.currentMonthlyUsdSpend >= quota.monthlyUsdBudget) {
      return false;
    }
    return true;
  }

  recordTokenUsage(tenantId: string, tokensUsed: number, costUsd: number): void {
    const quota = this.getQuota(tenantId);
    quota.currentTokensThisMinute += tokensUsed;
    quota.currentMonthlyUsdSpend += costUsd;
  }

  acquireConcurrency(tenantId: string): boolean {
    const quota = this.getQuota(tenantId);
    if (quota.currentConcurrentInferences >= quota.maxConcurrentInferences) {
      return false;
    }
    quota.currentConcurrentInferences++;
    return true;
  }

  releaseConcurrency(tenantId: string): void {
    const quota = this.getQuota(tenantId);
    if (quota.currentConcurrentInferences > 0) {
      quota.currentConcurrentInferences--;
    }
  }
}

export const defaultResourceManager = new DefaultResourceManager();
