/**
 * AI runtime wiring — binds the pure, dependency-injected AI services
 * (`credential-resolver.ts`, `billing/service.ts`, `usage-store.ts`) to a
 * request-scoped Supabase client so the API routes can resolve credentials,
 * enforce per-period limits + the Premium spend cap, and record usage in the
 * shared durable store.
 *
 * Everything here is request-scoped (no global mutable state) so concurrent
 * serverless invocations cannot leak one request's Supabase client into
 * another's resolution. Server-only.
 *
 * Requirements covered (wiring for Requirement 4 + 9.9):
 * - 4.8 / 4.9 — non-Premium tenants never fall back to environment AI keys; a
 *   tenant with no entitlement/credentials yields a configuration error.
 * - 4.12      — Premium tenants are subject to the platform monthly spend cap.
 * - 9.9       — AI usage counters are recorded in durable shared state.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  effectiveTier,
  effectiveLimits,
  limitsForTier,
  type PlanTier,
  type SubscriptionStatus,
  type Subscription,
  type UsageCounters,
} from '@/lib/billing/service';
import {
  type AIProvider,
  type ResolverDeps,
  type SpendStatus,
} from '@/lib/ai/credential-resolver';
import {
  AiUsageStore,
  createSupabaseUsageStore,
  type UsageCounterRef,
} from '@/lib/ai/usage-store';

/** Default platform monthly AI spend cap used when none is configured. */
const DEFAULT_PLATFORM_AI_CAP = 500;

/** Zeroed usage counters used when a subscription row has none. */
function zeroCounters(): UsageCounters {
  return { users: 0, storageGb: 0, aiCalls: 0, reports: 0, automationRules: 0 };
}

/**
 * The current billing-period identifier (`YYYY-MM`), matching the month-based
 * spend window the AI usage store and spend cap reason about.
 */
export function currentBillingPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Load a tenant's single Subscription row from the `subscriptions` table.
 * Returns `null` when none exists (the tenant is then treated as Free).
 */
export async function loadSubscription(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tenant_id, tier, status, usage, period_start')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !data) return null;

  const usage = (data.usage as Partial<UsageCounters> | null) ?? {};
  return {
    tenantId: String(data.tenant_id),
    tier: (data.tier as PlanTier) ?? 'free',
    status: (data.status as SubscriptionStatus) ?? 'active',
    usage: { ...zeroCounters(), ...usage },
    periodStart: String(data.period_start ?? new Date().toISOString()),
  };
}

/**
 * Resolve a tenant's own configured API key for a provider from the tenant's
 * `settings` row. This is the tenant's *own* key (Pro tier), never a shared
 * environment value. Providers without a stored column yield `null`.
 */
async function resolveTenantKey(
  supabase: SupabaseClient,
  tenantId: string,
  provider: AIProvider,
): Promise<string | null> {
  if (provider !== 'openai' && provider !== 'anthropic') {
    // Only openai/anthropic keys are persisted today; other providers are
    // treated as not-configured rather than falling back to anything shared.
    return null;
  }

  const column = provider === 'anthropic' ? 'anthropic_key' : 'openai_key';
  const { data, error } = await supabase
    .from('settings')
    .select(column)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !data) return null;
  const value = (data as Record<string, unknown>)[column];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Resolve a platform-managed API key for a provider (Premium tier only). These
 * are the platform's own keys, sourced from the platform environment; they are
 * used exclusively for Premium tenants and never as a fallback for non-Premium
 * tenants (the credential resolver enforces that).
 */
function resolvePlatformKey(provider: AIProvider): string | null {
  switch (provider) {
    case 'openai':
      return process.env.PLATFORM_OPENAI_API_KEY || process.env.OPENAI_API_KEY || null;
    case 'anthropic':
      return process.env.PLATFORM_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || null;
    case 'gemini':
      return process.env.PLATFORM_GEMINI_API_KEY || process.env.GEMINI_API_KEY || null;
    case 'groq':
      return process.env.PLATFORM_GROQ_API_KEY || process.env.GROQ_API_KEY || null;
    case 'openrouter':
      return process.env.PLATFORM_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || null;
    default:
      return null;
  }
}

/** Read the platform-managed monthly AI spend cap from `platform_settings`. */
async function resolveMonthlyCap(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('platform_monthly_ai_cap')
    .eq('id', 'platform')
    .maybeSingle();

  if (error || !data) return DEFAULT_PLATFORM_AI_CAP;
  const cap = Number(data.platform_monthly_ai_cap);
  return Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_PLATFORM_AI_CAP;
}

/**
 * A fully-wired AI runtime context for a single request: a durable usage store,
 * the resolver dependencies (tier/tenant-key/platform-key/spend) bound to the
 * request's Supabase client, and the per-period counter references and limit.
 */
export interface AiRuntimeContext {
  usageStore: AiUsageStore;
  resolverDeps: ResolverDeps;
  callsRef: UsageCounterRef;
  costRef: UsageCounterRef;
  /** Effective per-period AI call allowance for the tenant's current plan. */
  aiCallLimit: number;
  /** The tenant's effective subscription tier. */
  tier: PlanTier;
}

/**
 * Build the request-scoped AI runtime context for a tenant: loads the
 * subscription to derive the effective tier + per-period AI limit, wires the
 * credential resolver dependencies against the request's Supabase client, and
 * constructs the durable shared usage store.
 */
export async function buildAiRuntime(
  supabase: SupabaseClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<AiRuntimeContext> {
  const sub = await loadSubscription(supabase, tenantId);
  const tier = sub ? effectiveTier(sub) : 'free';
  const limits = sub ? effectiveLimits(sub) : limitsForTier('free');

  const period = currentBillingPeriod(now);
  const callsRef: UsageCounterRef = { tenantId, period, dimension: 'calls' };
  const costRef: UsageCounterRef = { tenantId, period, dimension: 'cost' };

  const usageStore = new AiUsageStore(createSupabaseUsageStore(supabase));

  const spend = async (t: string): Promise<SpendStatus> => {
    const [monthlyCap, currentMonthlySpend] = await Promise.all([
      resolveMonthlyCap(supabase),
      usageStore.current({ tenantId: t, period, dimension: 'cost' }),
    ]);
    return { currentMonthlySpend, monthlyCap };
  };

  const resolverDeps: ResolverDeps = {
    tier: () => tier,
    tenantKey: (t, provider) => resolveTenantKey(supabase, t, provider),
    platformKey: (provider) => resolvePlatformKey(provider),
    spend,
  };

  return {
    usageStore,
    resolverDeps,
    callsRef,
    costRef,
    aiCallLimit: limits.aiCalls,
    tier,
  };
}
