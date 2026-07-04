/**
 * StateAI AI Operating System (AIOS) — Error Hierarchy
 * 
 * Standardized error classes that all LLM providers must normalize to.
 * Ensures consistent error handling, retries, and circuit breaking across AIOS.
 */

import type { ProviderError as IProviderError } from '../types';

export abstract class AIOSError extends Error implements IProviderError {
  readonly code: string;
  readonly provider: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly rawError?: unknown;

  constructor(
    message: string,
    options: {
      code: string;
      provider: string;
      statusCode?: number;
      retryable?: boolean;
      retryAfterMs?: number;
      rawError?: unknown;
    }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code;
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.rawError = options.rawError;
  }
}

export class ProviderUnavailableError extends AIOSError {
  constructor(provider: string, message = `Provider ${provider} is currently unavailable`, rawError?: unknown) {
    super(message, {
      code: 'PROVIDER_UNAVAILABLE',
      provider,
      statusCode: 503,
      retryable: true,
      retryAfterMs: 5000,
      rawError,
    });
  }
}

export class InvalidModelError extends AIOSError {
  constructor(provider: string, model: string, rawError?: unknown) {
    super(`Model '${model}' is invalid or not supported by provider '${provider}'`, {
      code: 'INVALID_MODEL',
      provider,
      statusCode: 400,
      retryable: false,
      rawError,
    });
  }
}

export class TimeoutError extends AIOSError {
  constructor(provider: string, timeoutMs: number, rawError?: unknown) {
    super(`Request to provider '${provider}' timed out after ${timeoutMs}ms`, {
      code: 'TIMEOUT',
      provider,
      statusCode: 408,
      retryable: true,
      retryAfterMs: 2000,
      rawError,
    });
  }
}

export class RateLimitError extends AIOSError {
  constructor(provider: string, retryAfterMs?: number, rawError?: unknown) {
    super(`Rate limit exceeded for provider '${provider}'`, {
      code: 'RATE_LIMIT_EXCEEDED',
      provider,
      statusCode: 429,
      retryable: true,
      retryAfterMs: retryAfterMs ?? 5000,
      rawError,
    });
  }
}

export class ProviderAuthenticationError extends AIOSError {
  constructor(provider: string, message = `Authentication failed for provider '${provider}'`, rawError?: unknown) {
    super(message, {
      code: 'AUTHENTICATION_FAILED',
      provider,
      statusCode: 401,
      retryable: false,
      rawError,
    });
  }
}

export class ProviderConfigurationError extends AIOSError {
  constructor(provider: string, message: string, rawError?: unknown) {
    super(`Configuration error for provider '${provider}': ${message}`, {
      code: 'CONFIGURATION_ERROR',
      provider,
      statusCode: 400,
      retryable: false,
      rawError,
    });
  }
}

export class ProviderInternalError extends AIOSError {
  constructor(provider: string, statusCode?: number, message?: string, rawError?: unknown) {
    super(message || `Internal error reported by provider '${provider}'`, {
      code: 'PROVIDER_INTERNAL_ERROR',
      provider,
      statusCode: statusCode ?? 500,
      retryable: true,
      retryAfterMs: 3000,
      rawError,
    });
  }
}

export class ParsingError extends AIOSError {
  constructor(provider: string, message: string, rawError?: unknown) {
    super(`Failed to parse response from provider '${provider}': ${message}`, {
      code: 'PARSING_ERROR',
      provider,
      statusCode: 502,
      retryable: false,
      rawError,
    });
  }
}

/**
 * Helper to normalize arbitrary error objects from external SDKs/APIs into AIOSError hierarchy.
 */
export function normalizeProviderError(provider: string, err: unknown): AIOSError {
  if (err instanceof AIOSError) {
    return err;
  }

  const message = err instanceof Error 
    ? err.message 
    : typeof err === 'object' && err !== null && 'message' in err
    ? String((err as { message?: unknown }).message)
    : String(err);
  const lowerMsg = message.toLowerCase();

  // Check HTTP status code if attached
  const status = typeof err === 'object' && err !== null && 'status' in err 
    ? Number((err as { status?: unknown }).status)
    : typeof err === 'object' && err !== null && 'statusCode' in err
    ? Number((err as { statusCode?: unknown }).statusCode)
    : undefined;

  if (status === 401 || status === 403 || lowerMsg.includes('auth') || lowerMsg.includes('api key') || lowerMsg.includes('unauthorized')) {
    return new ProviderAuthenticationError(provider, message, err);
  }

  if (status === 429 || lowerMsg.includes('rate limit') || lowerMsg.includes('quota') || lowerMsg.includes('too many requests')) {
    const retryAfter = typeof err === 'object' && err !== null && 'headers' in err && typeof (err as { headers?: Record<string, string> }).headers === 'object'
      ? Number((err as { headers?: Record<string, string> }).headers?.['retry-after']) * 1000
      : 5000;
    return new RateLimitError(provider, !isNaN(retryAfter) && retryAfter > 0 ? retryAfter : 5000, err);
  }

  if (status === 408 || status === 504 || lowerMsg.includes('timeout') || lowerMsg.includes('abort') || lowerMsg.includes('timed out')) {
    return new TimeoutError(provider, 30000, err);
  }

  if (status === 400 && (lowerMsg.includes('model') || lowerMsg.includes('does not exist') || lowerMsg.includes('not found'))) {
    return new InvalidModelError(provider, 'unknown', err);
  }

  if (status === 503 || lowerMsg.includes('unavailable') || lowerMsg.includes('connection refused') || lowerMsg.includes('econnrefused')) {
    return new ProviderUnavailableError(provider, message, err);
  }

  if (status && status >= 500) {
    return new ProviderInternalError(provider, status, message, err);
  }

  if (lowerMsg.includes('json') || lowerMsg.includes('parse') || lowerMsg.includes('unexpected token')) {
    return new ParsingError(provider, message, err);
  }

  return new ProviderInternalError(provider, status ?? 500, message, err);
}
