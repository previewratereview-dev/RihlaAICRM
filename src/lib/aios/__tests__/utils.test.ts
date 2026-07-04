import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableError } from '../utils/retry';
import { withTimeout } from '../utils/timeout';
import { repairJson, stripMarkdownFences } from '../utils/json-repair';
import { parseStructuredOutput } from '../utils/parser';
import { ApproximateTokenCounter } from '../utils/token-counter';
import { DefaultCostEstimator } from '../utils/cost-estimator';
import { TimeoutError, RateLimitError, ProviderAuthenticationError } from '../errors';

describe('AIOS Utilities', () => {
  describe('Retry Logic', () => {
    it('should retry on transient errors up to maxRetries', async () => {
      let attempts = 0;
      const task = async () => {
        attempts++;
        if (attempts < 3) {
          throw new RateLimitError('openai', 10); // Short retry after for test speed
        }
        return 'success';
      };

      const result = await withRetry(task, { maxRetries: 3, initialDelayMs: 10, jitter: false });
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should not retry non-retryable errors like authentication failures', async () => {
      let attempts = 0;
      const task = async () => {
        attempts++;
        throw new ProviderAuthenticationError('nvidia');
      };

      await expect(withRetry(task, { maxRetries: 3, initialDelayMs: 10 })).rejects.toThrow(ProviderAuthenticationError);
      expect(attempts).toBe(1);
    });
  });

  describe('Timeout Wrapper', () => {
    it('should complete task if within timeout threshold', async () => {
      const result = await withTimeout(
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return 'done';
        },
        { timeoutMs: 1000, provider: 'openai' }
      );
      expect(result).toBe('done');
    });

    it('should throw TimeoutError when task exceeds threshold', async () => {
      await expect(
        withTimeout(
          async (signal) => {
            await new Promise((r) => setTimeout(r, 200));
            return 'too late';
          },
          { timeoutMs: 20, provider: 'anthropic' }
        )
      ).rejects.toThrow(TimeoutError);
    });
  });

  describe('JSON Repair & Structured Output Parser', () => {
    it('should strip markdown code fences', () => {
      const input = '```json\n{"name": "Alice"}\n```';
      expect(stripMarkdownFences(input)).toBe('{"name": "Alice"}');
    });

    it('should repair trailing commas and unclosed braces', () => {
      const malformed = '{"name": "Bob", "age": 30, ';
      const repaired = repairJson(malformed);
      const parsed = JSON.parse(repaired);
      expect(parsed.name).toBe('Bob');
      expect(parsed.age).toBe(30);
    });

    it('should parse structured output and apply schema validation', () => {
      const mockSchema = {
        safeParse: (data: unknown) => {
          if (typeof data === 'object' && data !== null && 'role' in data) {
            return { success: true as const, data };
          }
          return { success: false as const, error: 'Missing role' };
        },
        parse: (data: unknown) => data,
      };

      const input = '```json\n{"role": "admin", "permissions": ["all"], }\n```';
      const parsed = parseStructuredOutput(input, mockSchema, 'test');
      expect(parsed).toEqual({ role: 'admin', permissions: ['all'] });
    });
  });

  describe('Token Counter & Cost Estimator', () => {
    it('should approximate tokens using 4 chars per token rule', () => {
      const counter = new ApproximateTokenCounter();
      expect(counter.countTokens('Hello World! This is a test string.')).toBeGreaterThan(0);
      expect(counter.countMessageTokens([{ role: 'user', content: 'Hello' }])).toBeGreaterThan(4);
    });

    it('should estimate cost accurately based on model pricing metadata', () => {
      const estimator = new DefaultCostEstimator();
      const pricing = { promptPer1k: 0.0025, completionPer1k: 0.01, currency: 'USD' };
      const cost = estimator.estimateCost({ tokensIn: 1000, tokensOut: 500 }, pricing);
      expect(cost).toBe(0.0075); // 0.0025 + (0.5 * 0.01) = 0.0075
    });
  });
});
