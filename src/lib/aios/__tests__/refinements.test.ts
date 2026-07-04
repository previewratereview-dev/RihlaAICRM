import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defaultResourceManager, DefaultResourceManager } from '../resources';
import { defaultPluginManager, DefaultPluginManager, type AIOSPlugin } from '../plugins';
import { defaultHookManager, HookManager } from '../kernel/hooks';
import { defaultPolicyEngine } from '../policies';
import { validateAIOSConfig, DEFAULT_AIOS_CONFIG } from '../config';
import { ProviderConfigurationError } from '../errors';

describe('Milestone 1.5 Final Refinements', () => {
  describe('ResourceManager (Refinement 4)', () => {
    let rm: DefaultResourceManager;

    beforeEach(() => {
      rm = new DefaultResourceManager();
    });

    it('should track token budget and deny execution when limit is exceeded', () => {
      rm.setQuota({ tenantId: 'test-tenant', maxTokensPerMinute: 1000, maxConcurrentInferences: 5, monthlyUsdBudget: 10 });
      expect(rm.checkTokenBudget('test-tenant', 500)).toBe(true);

      rm.recordTokenUsage('test-tenant', 800, 1);
      expect(rm.checkTokenBudget('test-tenant', 500)).toBe(false);
    });

    it('should enforce concurrency limits', () => {
      rm.setQuota({ tenantId: 'test-tenant', maxTokensPerMinute: 10000, maxConcurrentInferences: 2, monthlyUsdBudget: 10 });
      expect(rm.acquireConcurrency('test-tenant')).toBe(true);
      expect(rm.acquireConcurrency('test-tenant')).toBe(true);
      expect(rm.acquireConcurrency('test-tenant')).toBe(false); // 3rd should fail

      rm.releaseConcurrency('test-tenant');
      expect(rm.acquireConcurrency('test-tenant')).toBe(true); // Should succeed after release
    });
  });

  describe('Plugin Extension API (Refinement 3)', () => {
    it('should register and trigger lifecycle hooks on plugins', async () => {
      const pm = new DefaultPluginManager();
      const onLoadMock = vi.fn();
      const onUnloadMock = vi.fn();

      const mockPlugin: AIOSPlugin = {
        id: 'voice-extension',
        name: 'Voice Processing Plugin',
        version: { major: 1, minor: 0, patch: 0 },
        register: vi.fn(),
        onLoad: onLoadMock,
        onUnload: onUnloadMock,
      };

      await pm.registerPlugin(mockPlugin);
      expect(pm.getPlugin('voice-extension')).toBe(mockPlugin);

      await pm.loadAll();
      expect(onLoadMock).toHaveBeenCalledTimes(1);

      await pm.unregisterPlugin('voice-extension');
      expect(onUnloadMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Execution Hooks (Refinement 8)', () => {
    it('should invoke registered hooks before and after provider execution', async () => {
      const hm = new HookManager();
      const beforeProviderMock = vi.fn();
      const afterProviderMock = vi.fn();

      hm.registerHooks({
        beforeProvider: beforeProviderMock,
        afterProvider: afterProviderMock,
      });

      const mockContext: any = { traceId: 'trace_123', tenantId: 'tenant_1' };
      await hm.beforeProvider(mockContext, 'openai', 'gpt-4o');
      await hm.afterProvider(mockContext, 'openai', 'gpt-4o', 150);

      expect(beforeProviderMock).toHaveBeenCalledWith(mockContext, 'openai', 'gpt-4o');
      expect(afterProviderMock).toHaveBeenCalledWith(mockContext, 'openai', 'gpt-4o', 150);
    });
  });

  describe('Configuration Schema Validation (Refinement 9)', () => {
    it('should validate correct default config without errors', () => {
      expect(() => validateAIOSConfig(DEFAULT_AIOS_CONFIG)).not.toThrow();
    });

    it('should throw ProviderConfigurationError when config is malformed', () => {
      const badConfig: any = {
        providers: {
          openai: { timeoutMs: -500, maxRetries: 2, enabled: true }, // Negative timeout is invalid
        },
        defaults: {},
        fallbackProviders: [],
      };

      expect(() => validateAIOSConfig(badConfig)).toThrow(ProviderConfigurationError);
    });
  });

  describe('Sequential Business Policy Categories (Refinement 5)', () => {
    it('should list rules filtered by category', () => {
      expect(defaultPolicyEngine.listRules('security').length).toBeGreaterThan(0);
      expect(defaultPolicyEngine.listRules('compliance').length).toBeGreaterThan(0);
      expect(defaultPolicyEngine.listRules('operational').length).toBeGreaterThan(0);
      expect(defaultPolicyEngine.listRules('business').length).toBeGreaterThan(0);
    });
  });
});
