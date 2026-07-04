import { describe, it, expect } from 'vitest';
import {
  normalizeProviderError,
  ProviderAuthenticationError,
  RateLimitError,
  TimeoutError,
  ProviderUnavailableError,
  InvalidModelError,
  ProviderInternalError,
  ParsingError,
} from '../errors';

describe('Error Normalization', () => {
  it('should return existing AIOSError untouched', () => {
    const original = new RateLimitError('openai', 10000);
    const normalized = normalizeProviderError('openai', original);
    expect(normalized).toBe(original);
  });

  it('should normalize HTTP 401/403 into ProviderAuthenticationError', () => {
    const err = { status: 401, message: 'Invalid API key provided' };
    const normalized = normalizeProviderError('nvidia', err);
    expect(normalized).toBeInstanceOf(ProviderAuthenticationError);
    expect(normalized.code).toBe('AUTHENTICATION_FAILED');
    expect(normalized.provider).toBe('nvidia');
  });

  it('should normalize HTTP 429 into RateLimitError and parse retry-after header', () => {
    const err = {
      status: 429,
      message: 'Too Many Requests',
      headers: { 'retry-after': '15' },
    };
    const normalized = normalizeProviderError('anthropic', err);
    expect(normalized).toBeInstanceOf(RateLimitError);
    expect(normalized.retryable).toBe(true);
    expect(normalized.retryAfterMs).toBe(15000);
  });

  it('should normalize timeout/abort messages into TimeoutError', () => {
    const err = new Error('The request timed out after 30000ms');
    const normalized = normalizeProviderError('openai', err);
    expect(normalized).toBeInstanceOf(TimeoutError);
    expect(normalized.code).toBe('TIMEOUT');
  });

  it('should normalize model not found errors into InvalidModelError', () => {
    const err = { status: 400, message: 'The model gpt-5 does not exist' };
    const normalized = normalizeProviderError('openai', err);
    expect(normalized).toBeInstanceOf(InvalidModelError);
    expect(normalized.retryable).toBe(false);
  });

  it('should normalize 503 connection refused into ProviderUnavailableError', () => {
    const err = { status: 503, message: 'Service Temporarily Unavailable' };
    const normalized = normalizeProviderError('glm', err);
    expect(normalized).toBeInstanceOf(ProviderUnavailableError);
    expect(normalized.retryable).toBe(true);
  });

  it('should normalize JSON parse errors into ParsingError', () => {
    const err = new Error('Unexpected token < in JSON at position 0');
    const normalized = normalizeProviderError('ollama', err);
    expect(normalized).toBeInstanceOf(ParsingError);
    expect(normalized.code).toBe('PARSING_ERROR');
  });

  it('should default 500 errors to ProviderInternalError', () => {
    const err = { status: 500, message: 'Internal Server Error' };
    const normalized = normalizeProviderError('anthropic', err);
    expect(normalized).toBeInstanceOf(ProviderInternalError);
    expect(normalized.retryable).toBe(true);
  });
});
