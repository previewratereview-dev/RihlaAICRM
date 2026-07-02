/**
 * Shared AI usage store — durable, cross-instance AI usage counters.
 *
 * Requirements covered (Requirement 9, Security Baseline):
 * - 9.9  Track AI usage in shared persistent state so usage counters survive
 *        serverless cold starts and stay consistent across instances. Counters
 *        previously lived in process memory / were re-summed from the `ai_usage`
 *        log per request; this store keeps durable per-(tenant, period,
 *        dimension) counters backed by the `ai_usage_counters` table.
 * - 9.12 Fail closed: when the shared store is unavailable (or not configured),
 *        every read/increment raises {@link UsageStoreUnavailableError} so the
 *        caller denies the request with a service-unavailable response rather
 *        than proceeding unbounded with unknown usage.
 *
 * Design notes:
 * - The persistence backend is abstracted behind {@link UsageCounterStore} and
 *   injected (mirroring the loader/writer injection in `billing/service.ts` and
 *   the client injection in `security/audit-log.ts`). This keeps the core logic
 *   pure and testable and lets the backing store (Postgres counter table today,
 *   Redis or another shared store tomorrow) be swapped without touching callers.
 * - This module performs no wiring into AI routes; that is done separately
 *   (task 15.1). It only provides the store abstraction, the canonical key
 *   builder, the fail-closed wrapper, and a Postgres-backed implementation.
 *
 * Server-only: AI usage counters are never read or mutated from the browser.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A usage dimension tracked per billing period.
 * - `calls` — number of AI requests in the period (maps to the `aiCalls`
 *   Usage_Limit in `billing/service.ts`).
 * - `cost`  — platform-managed AI spend in the period (used to enforce the
 *   Premium monthly spend cap).
 */
export type UsageDimension = 'calls' | 'cost';

/** Identifies a single durable counter. */
export interface UsageCounterRef {
  tenantId: string;
  /** Billing-period identifier, e.g. `2026-06` or a subscription period id. */
  period: string;
  dimension: UsageDimension;
}

/**
 * Abstract shared-state backend for usage counters. Implementations MUST be
 * backed by durable state shared across serverless instances (Requirement 9.9)
 * and MUST perform atomic increments so concurrent instances do not lose
 * updates.
 *
 * Any failure to reach the backing store MUST reject (throw / reject the
 * promise); the {@link AiUsageStore} wrapper converts such failures into a
 * fail-closed {@link UsageStoreUnavailableError} (Requirement 9.12).
 */
export interface UsageCounterStore {
  /**
   * Atomically add `amount` to the counter identified by `key` and return the
   * resulting total. `amount` may be fractional (e.g. for `cost`).
   */
  increment(key: string, amount: number, ref: UsageCounterRef): Promise<number>;
  /** Return the current value of the counter, or `0` if it does not yet exist. */
  get(key: string, ref: UsageCounterRef): Promise<number>;
}

/**
 * Raised whenever the shared usage store cannot be reached or is not
 * configured. Callers (and the route layer) treat this as a fail-closed signal:
 * deny the request and return a service-unavailable (HTTP 503) response rather
 * than allowing the AI request to proceed with unknown usage (Requirement 9.12).
 */
export class UsageStoreUnavailableError extends Error {
  /** Stable code so the route layer can map this to a 503 response. */
  readonly code = 'AI_USAGE_STORE_UNAVAILABLE';
  /** The underlying cause, when one is available. */
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'UsageStoreUnavailableError';
    this.cause = cause;
  }
}

/** Raised when a counter reference is structurally invalid. */
export class UsageStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageStoreError';
  }
}

function requireNonEmpty(value: string | undefined | null, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new UsageStoreError(`Usage counter requires a non-empty ${field}`);
  }
  return value;
}

function validateRef(ref: UsageCounterRef): UsageCounterRef {
  return {
    tenantId: requireNonEmpty(ref.tenantId, 'tenantId'),
    period: requireNonEmpty(ref.period, 'period'),
    dimension: requireNonEmpty(ref.dimension, 'dimension') as UsageDimension,
  };
}

/**
 * Build the canonical, collision-free key for a counter. The pieces are joined
 * with a delimiter that cannot appear inside the tenant/period/dimension values
 * used by the system; values are still encoded defensively.
 */
export function usageCounterKey(ref: UsageCounterRef): string {
  const { tenantId, period, dimension } = validateRef(ref);
  return [tenantId, period, dimension].map((p) => encodeURIComponent(p)).join('|');
}

/**
 * High-level, fail-closed facade over a {@link UsageCounterStore}. All reads and
 * increments either return durable shared-state values (Requirement 9.9) or
 * raise {@link UsageStoreUnavailableError} (Requirement 9.12) — they never
 * silently fall back to a permissive default.
 */
export class AiUsageStore {
  constructor(private readonly store: UsageCounterStore) {}

  /**
   * Atomically record `amount` units of usage and return the new period total.
   * Throws {@link UsageStoreUnavailableError} if the shared store is
   * unreachable, so the caller fails closed (Requirement 9.12).
   */
  async record(ref: UsageCounterRef, amount: number): Promise<number> {
    const validated = validateRef(ref);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new UsageStoreError(`Usage amount must be a non-negative finite number, got ${amount}`);
    }
    const key = usageCounterKey(validated);
    try {
      return await this.store.increment(key, amount, validated);
    } catch (err) {
      throw new UsageStoreUnavailableError(
        'AI usage store is unavailable; failing closed on usage record',
        err,
      );
    }
  }

  /**
   * Read the current usage total for the period. Throws
   * {@link UsageStoreUnavailableError} when the shared store is unreachable so
   * callers cannot proceed with an unknown (and therefore unbounded) count
   * (Requirement 9.12).
   */
  async current(ref: UsageCounterRef): Promise<number> {
    const validated = validateRef(ref);
    const key = usageCounterKey(validated);
    try {
      return await this.store.get(key, validated);
    } catch (err) {
      throw new UsageStoreUnavailableError(
        'AI usage store is unavailable; failing closed on usage read',
        err,
      );
    }
  }

  /**
   * Whether recording `amount` more units would keep usage within `limit`.
   * Reads current usage from shared state first (and therefore fails closed if
   * the store is down). A non-finite `limit` denotes "no cap" and is always
   * within limit.
   */
  async wouldStayWithin(ref: UsageCounterRef, limit: number, amount = 1): Promise<boolean> {
    if (!Number.isFinite(limit)) {
      return true;
    }
    const used = await this.current(ref);
    return used + amount <= limit;
  }
}

// ---------------------------------------------------------------------------
// Injectable singleton — mirrors the loader/writer injection used by sibling
// services. When no store is configured the facade fails closed rather than
// allowing AI requests through unbounded (Requirement 9.12).
// ---------------------------------------------------------------------------

let injectedStore: UsageCounterStore | null = null;

/** Register (or clear) the shared store backing the AI usage counters. */
export function setUsageStore(store: UsageCounterStore | null): void {
  injectedStore = store;
}

/**
 * Resolve the configured {@link AiUsageStore}. Throws
 * {@link UsageStoreUnavailableError} when no store has been configured so the
 * absence of a shared store is itself a fail-closed condition (Requirement 9.12)
 * rather than a silent allow.
 */
export function getUsageStore(): AiUsageStore {
  if (!injectedStore) {
    throw new UsageStoreUnavailableError('No AI usage store configured; failing closed');
  }
  return new AiUsageStore(injectedStore);
}

// ---------------------------------------------------------------------------
// Postgres-backed implementation (durable shared state — Requirement 9.9).
//
// Backed by the `ai_usage_counters` table and the atomic
// `increment_ai_usage_counter` RPC added in migration 008. The Supabase client
// is injected so this works with either the server session client (RLS) or a
// service-role client (service-role / background paths), consistent with
// `security/audit-log.ts`.
// ---------------------------------------------------------------------------

const RPC_INCREMENT = 'increment_ai_usage_counter';
const COUNTERS_TABLE = 'ai_usage_counters';

/**
 * Create a {@link UsageCounterStore} backed by the durable `ai_usage_counters`
 * Postgres table. Increments use the atomic `increment_ai_usage_counter` RPC so
 * concurrent serverless instances cannot lose updates. Any database error is
 * surfaced as a rejection, which the {@link AiUsageStore} facade converts into
 * a fail-closed {@link UsageStoreUnavailableError}.
 */
export function createSupabaseUsageStore(client: SupabaseClient): UsageCounterStore {
  return {
    async increment(key: string, amount: number, ref: UsageCounterRef): Promise<number> {
      const { data, error } = await client.rpc(RPC_INCREMENT, {
        p_key: key,
        p_tenant_id: ref.tenantId,
        p_period: ref.period,
        p_dimension: ref.dimension,
        p_amount: amount,
      });
      if (error) {
        throw new Error(`ai_usage_counters increment failed: ${error.message}`);
      }
      return Number(data ?? 0);
    },

    async get(key: string): Promise<number> {
      const { data, error } = await client
        .from(COUNTERS_TABLE)
        .select('amount')
        .eq('counter_key', key)
        .maybeSingle();
      if (error) {
        throw new Error(`ai_usage_counters read failed: ${error.message}`);
      }
      return Number(data?.amount ?? 0);
    },
  };
}
