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
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { open, type SealedSecret } from '@/lib/secrets/store';

function getAdminClient(fallback: SupabaseClient): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (serviceKey && url) {
    return createServiceClient(url, serviceKey);
  }
  return fallback;
}
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
    .select('tenant_id, plan, status, current_period_start')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    tenantId: String(data.tenant_id),
    tier: (data.plan as PlanTier) ?? 'free',
    status: (data.status as SubscriptionStatus) ?? 'active',
    usage: zeroCounters(), // Usage not tracked on this table currently
    periodStart: String(data.current_period_start ?? new Date().toISOString()),
  };
}

function decryptKeyIfNeeded(stored: unknown): string | null {
  if (!stored || typeof stored !== 'string') return null;
  try {
    const parsed = JSON.parse(stored) as SealedSecret;
    if (parsed.iv && parsed.authTag && parsed.ciphertext && typeof parsed.keyVersion === 'number') {
      return open(parsed) || null;
    }
  } catch {
    // Not encrypted JSON — treat as legacy plaintext value
  }
  return stored;
}

/**
 * Resolve a platform-managed API key for a provider (Premium/Pro tiers).
 * Strictly reads from `platform_settings` table or superadmin `global` settings row.
 * Never falls back to `process.env` / `env.local`.
 */
async function resolvePlatformKey(supabase: SupabaseClient, provider: AIProvider): Promise<string | null> {
  const adminDb = getAdminClient(supabase);
  // 1. Check platform_settings first
  const { data: platformRow } = await adminDb
    .from('platform_settings')
    .select('settings')
    .eq('id', 'platform')
    .maybeSingle();

  if (platformRow && platformRow.settings) {
    const pSettings = platformRow.settings as Record<string, unknown>;
    if (typeof pSettings.defaultAiApiKey === 'string' && pSettings.defaultAiApiKey) {
      const decrypted = decryptKeyIfNeeded(pSettings.defaultAiApiKey);
      if (decrypted) return decrypted;
    }
  }

  // 2. Fall back to Super Admin settings row (tenant_id = 'global')
  const column = provider === 'anthropic' ? 'anthropic_key' : provider === 'openai' ? 'openai_key' : 'ai_api_key';
  const { data: settingsRow } = await adminDb
    .from('settings')
    .select(column)
    .eq('tenant_id', 'global')
    .maybeSingle();

  if (settingsRow) {
    const raw = (settingsRow as Record<string, unknown>)[column];
    if (typeof raw === 'string' && raw) {
      const decrypted = decryptKeyIfNeeded(raw);
      if (decrypted) return decrypted;
    }
  }

  return null;
}

/**
 * Resolve a tenant's configured API key for a provider.
 * For paid agencies, agencies inherit the Super Admin configured platform model & provider.
 */
async function resolveTenantKey(
  supabase: SupabaseClient,
  tenantId: string,
  provider: AIProvider,
): Promise<string | null> {
  if (provider !== 'openai' && provider !== 'anthropic') {
    return resolvePlatformKey(supabase, provider);
  }

  const column = provider === 'anthropic' ? 'anthropic_key' : 'openai_key';
  const { data, error } = await supabase
    .from('settings')
    .select(column)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!error && data) {
    const value = (data as Record<string, unknown>)[column];
    if (typeof value === 'string' && value.length > 0) {
      const decrypted = decryptKeyIfNeeded(value);
      if (decrypted) return decrypted;
    }
  }

  // For paid agencies without custom keys, use the superadmin configured platform key
  return resolvePlatformKey(supabase, provider);
}

/** Read the platform-managed monthly AI spend cap from `platform_settings`. */
async function resolveMonthlyCap(supabase: SupabaseClient): Promise<number> {
  const adminDb = getAdminClient(supabase);
  const { data, error } = await adminDb
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
  /** The raw subscription status or 'none' if no subscription row exists. */
  subscriptionStatus: SubscriptionStatus | 'none';
}

/**
 * Returns a polite, professional message explaining why AI features are locked
 * based on whether the agency is on a Free tier or an expired/past-due subscription.
 */
export function getSubscriptionBlockedMessage(runtime: {
  tier: PlanTier;
  subscriptionStatus: SubscriptionStatus | 'none';
}): string {
  if (runtime.subscriptionStatus === 'expired' || runtime.subscriptionStatus === 'past_due') {
    return "Your agency's subscription has ended or is past due. To resume access to our AI features, please renew or update your subscription. Thank you!";
  }
  return "Our AI features are exclusive to subscribed agencies. Please upgrade your agency to a Starter, Pro, or Premium subscription to unlock AI-powered tools and assistants. We look forward to supporting your growth!";
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
  const subscriptionStatus: SubscriptionStatus | 'none' = sub ? sub.status : 'none';

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
    platformKey: (provider) => resolvePlatformKey(supabase, provider),
    spend,
  };

  return {
    usageStore,
    resolverDeps,
    callsRef,
    costRef,
    aiCallLimit: limits.aiCalls,
    tier,
    subscriptionStatus,
  };
}
