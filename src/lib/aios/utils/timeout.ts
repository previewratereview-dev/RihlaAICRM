/**
 * StateAI AI Operating System (AIOS) — Timeout Utility
 * 
 * Reusable timeout wrapper using AbortController and TimeoutError.
 * 100% async safe, serverless friendly, prevents memory leaks by cleaning up timers.
 */

import { TimeoutError } from '../errors';

export interface TimeoutOptions {
  timeoutMs: number;
  provider?: string;
  signal?: AbortSignal;
}

/**
 * Wraps an async promise or function with a strict timeout and optional external AbortSignal.
 */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, provider = 'unknown', signal: externalSignal } = options;

  if (timeoutMs <= 0) {
    // If timeout is disabled (<= 0), just execute with external signal or dummy
    const controller = new AbortController();
    if (externalSignal) {
      if (externalSignal.aborted) {
        throw new TimeoutError(provider, timeoutMs, new Error('External signal already aborted'));
      }
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
    }
    return task(controller.signal);
  }

  const controller = new AbortController();
  let timerId: NodeJS.Timeout | undefined;

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      throw new TimeoutError(provider, timeoutMs, new Error('External signal already aborted'));
    }
    externalSignal.addEventListener('abort', onExternalAbort);
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      controller.abort(new TimeoutError(provider, timeoutMs));
      reject(new TimeoutError(provider, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([task(controller.signal), timeoutPromise]);
    return result;
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw error;
    }
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new TimeoutError(provider, timeoutMs, error);
    }
    throw error;
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
