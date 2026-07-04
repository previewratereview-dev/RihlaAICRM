/**
 * StateAI AI Operating System (AIOS) — Retry Utility
 * 
 * Reusable exponential backoff retry loop with jitter and retryable error checking.
 * Ensures serverless resilience without hanging threads indefinitely.
 */

import { AIOSError } from '../errors';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitter?: boolean;
  onRetry?: (attempt: number, error: unknown, nextDelayMs: number) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffFactor: 2,
  jitter: true,
};

/**
 * Determines whether an error should be retried.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AIOSError) {
    return error.retryable;
  }
  
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Network failures, connection resets, timeouts are retryable
    if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('network') || msg.includes('fetch failed')) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates the next backoff delay in milliseconds with optional jitter.
 */
export function calculateBackoff(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffFactor: number,
  jitter: boolean
): number {
  const baseDelay = initialDelayMs * Math.pow(backoffFactor, attempt);
  const cappedDelay = Math.min(baseDelay, maxDelayMs);
  
  if (!jitter) return cappedDelay;
  
  // Apply randomized jitter between 50% and 100% of cappedDelay
  return Math.floor(cappedDelay * (0.5 + Math.random() * 0.5));
}

/**
 * Executes an asynchronous task with exponential backoff retries.
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;

      if (attempt >= opts.maxRetries || !isRetryableError(error)) {
        throw error;
      }

      // Check if error explicitly specified a retryAfterMs (e.g., rate limits)
      let delayMs = calculateBackoff(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffFactor,
        opts.jitter
      );

      if (error instanceof AIOSError && error.retryAfterMs && error.retryAfterMs > 0) {
        delayMs = Math.min(error.retryAfterMs, opts.maxDelayMs);
      }

      if (opts.onRetry) {
        opts.onRetry(attempt + 1, error, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
