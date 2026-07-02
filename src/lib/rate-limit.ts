/**
 * Rate_Limiter — shared-store fixed-window rate limiting.
 *
 * Responsibilities (Requirement 9):
 * - Enforce a fixed-window limit (default 100 requests / 60s) keyed per-User
 *   plus Tenant_Id for authenticated requests, or per source IP for
 *   unauthenticated requests (9.7).
 * - Use a shared external store rather than per-instance in-memory state so
 *   limits are consistent across serverless instances and survive cold starts
 *   (9.8). The store sits behind the {@link RateLimitStore} interface so the
 *   implementation (Postgres-backed counter, Upstash Redis, ...) can be
 *   swapped without touching callers.
 * - Fail closed: when the shared store is unavailable the request is denied
 *   with a service-unavailable signal rather than proceeding unbounded (9.12).
 *
 * This module is server-only. The default store is a Postgres-backed atomic
 * counter (see migration 008_rate_limit_counters.sql) accessed through the
 * Supabase service-role client.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Default fixed-window limit and window size (Requirement 9.7). */
export const DEFAULT_RATE_LIMIT = 100;
export const DEFAULT_WINDOW_MS = 60_000;

/** Outcome of incrementing the counter for a key in the current window. */
export interface RateLimitOutcome {
  /** Post-increment hit count within the current window. */
  count: number;
  /** Epoch milliseconds at which the current window resets. */
  resetAt: number;
}

/**
 * Shared counter store abstraction. Implementations MUST perform the increment
 * atomically so concurrent requests across instances cannot under-count, and
 * MUST throw when the backing store is unavailable so the caller can fail
 * closed (Requirement 9.8, 9.12).
 */
export interface RateLimitStore {
  /**
   * Atomically register one hit for {@link key} within the current fixed
   * window of {@link windowMs} and return the post-increment count and the
   * window reset time. Throws if the store is unavailable.
   */
  hit(key: string, windowMs: number): Promise<RateLimitOutcome>;
}

/** Result of a rate-limit check returned to route handlers. */
export interface RateLimitResult {
  /** Whether the request is within the limit and may proceed. */
  allowed: boolean;
  /** Configured limit for the window. */
  limit: number;
  /** Remaining requests in the current window (0 when over limit or denied). */
  remaining: number;
  /** Milliseconds until the window resets; set when denied. */
  retryAfterMs?: number;
  /**
   * True when the request was denied because the shared store was unavailable.
   * Callers SHOULD translate this into a 503 service-unavailable response
   * (fail closed, Requirement 9.12); a plain over-limit denial is a 429.
   */
  storeUnavailable?: boolean;
}

/** Error raised by a {@link RateLimitStore} when the backing store fails. */
export class RateLimitStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitStoreError';
  }
}

/**
 * Postgres-backed fixed-window store. Uses the Supabase service-role client to
 * invoke the atomic `rate_limit_hit` RPC. Throws {@link RateLimitStoreError}
 * when the store is not configured or the RPC fails, so callers fail closed.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  private client: SupabaseClient | null = null;

  private getClient(): SupabaseClient {
    if (this.client) return this.client;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new RateLimitStoreError('Rate-limit store is not configured');
    }

    this.client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return this.client;
  }

  async hit(key: string, windowMs: number): Promise<RateLimitOutcome> {
    const { data, error } = await this.getClient().rpc('rate_limit_hit', {
      p_key: key,
      p_window_ms: windowMs,
    });

    if (error) {
      throw new RateLimitStoreError(`Rate-limit store error: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.hit_count !== 'number' || row.reset_at == null) {
      throw new RateLimitStoreError('Rate-limit store returned an invalid result');
    }

    return { count: row.hit_count, resetAt: Number(row.reset_at) };
  }
}

let activeStore: RateLimitStore = new PostgresRateLimitStore();

/**
 * Swap the shared store implementation (e.g. Upstash Redis in production, or an
 * in-memory fake in tests). Passing `null` restores the default Postgres store.
 */
export function setRateLimitStore(store: RateLimitStore | null): void {
  activeStore = store ?? new PostgresRateLimitStore();
}

/** Parameters for deriving a rate-limit key (Requirement 9.7). */
export interface RateLimitKeyParams {
  /** Route or action scope, e.g. `'ai-complete'`. */
  scope: string;
  /** Authenticated user id, if any. */
  userId?: string | null;
  /** Tenant id of the authenticated user, if any. */
  tenantId?: string | null;
  /** Source IP for unauthenticated requests. */
  ip?: string | null;
}

/**
 * Build the rate-limit key: keyed per-User plus Tenant_Id for authenticated
 * requests, and per source IP for unauthenticated requests (Requirement 9.7).
 */
export function buildRateLimitKey({ scope, userId, tenantId, ip }: RateLimitKeyParams): string {
  if (userId && tenantId) {
    return `${scope}:u:${tenantId}:${userId}`;
  }
  return `${scope}:ip:${ip && ip.trim() ? ip.trim() : 'anonymous'}`;
}

/**
 * Check and consume one unit of the rate limit for {@link key} within a fixed
 * window. Returns `allowed: false` with `storeUnavailable: true` when the
 * shared store cannot be reached (fail closed, Requirement 9.12), or
 * `allowed: false` with a `retryAfterMs` when the window limit is exceeded
 * (Requirement 9.7).
 */
export async function checkRateLimit(
  key: string,
  limit: number = DEFAULT_RATE_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<RateLimitResult> {
  try {
    const { count, resetAt } = await activeStore.hit(key, windowMs);
    const allowed = count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterMs: allowed ? undefined : Math.max(0, resetAt - Date.now()),
    };
  } catch {
    // Fail closed: deny rather than allow unbounded when the store is down.
    return {
      allowed: false,
      limit,
      remaining: 0,
      storeUnavailable: true,
      retryAfterMs: windowMs,
    };
  }
}
