/**
 * Subscription / Entitlement Service — plan catalog, effective limits, and the
 * one-active-subscription-per-tenant invariant.
 *
 * Responsibilities covered by this task (Requirement 4):
 * - Define three Plans (Free, Pro, Premium), each with explicit Usage_Limits
 *   for users, storage, AI calls, reports, and automation rules. (4.1)
 * - Model that every Agency is associated with exactly one active Subscription
 *   referencing exactly one Plan, and provide the invariant guard used when
 *   provisioning or loading subscriptions. (4.2)
 * - Resolve the *effective* Usage_Limits for a Subscription, treating past-due
 *   or expired Subscriptions as the Free Plan. (4.11)
 *
 * This module is server-side only. Following the conventions of the other lib
 * services (e.g. `secrets/store.ts`), data access is injected so the core
 * logic stays pure and testable without a live database.
 */

/** Subscription tiers offered by the platform (Requirement 4.1). */
export type PlanTier = 'free' | 'pro' | 'premium';

/** Lifecycle status of a Subscription (Requirement 4.11). */
export type SubscriptionStatus = 'active' | 'past_due' | 'expired';

/**
 * Quantified caps imposed by a Plan (Requirement 4.1).
 * - `users`            — maximum number of Users (count).
 * - `storageGb`        — storage cap in gigabytes.
 * - `aiCalls`          — AI usage allowance per billing period (count).
 * - `reports`          — reports allowance per billing period (count).
 * - `automationRules`  — maximum automation rules (count).
 */
export interface UsageLimits {
  users: number;
  storageGb: number;
  aiCalls: number;
  reports: number;
  automationRules: number;
}

/** Per-billing-period usage counters tracked against {@link UsageLimits}. */
export interface UsageCounters {
  users: number;
  storageGb: number;
  aiCalls: number;
  reports: number;
  automationRules: number;
}

/** Feature entitlement flags carried by a Plan. */
export interface PlanFeatures {
  /** Tenant supplies and uses its own AI provider keys (Pro and above). */
  customAiKeys: boolean;
  /** Tenant may use multiple configured AI providers (Pro and above). */
  multiProviderAi: boolean;
  /** Platform-managed AI keys + premium models (Premium only). */
  platformManagedAi: boolean;
  /** Access to premium AI models (Premium only). */
  premiumModels: boolean;
  /** Advanced analytics / reporting features (Pro and above). */
  advancedAnalytics: boolean;
}

/** A subscription Plan: a tier with its Usage_Limits and feature entitlements. */
export interface Plan {
  tier: PlanTier;
  limits: UsageLimits;
  features: PlanFeatures;
}

/**
 * The record binding a Tenant to a Plan (Requirement 4.2). Mirrors the
 * `subscriptions` table: `tenant_id` is the primary key, guaranteeing at most
 * one Subscription row per Tenant at the database layer.
 */
export interface Subscription {
  tenantId: string;
  tier: PlanTier;
  status: SubscriptionStatus;
  usage: UsageCounters;
  periodStart: string;
}

/**
 * The canonical Plan catalog. This is the source of truth for Usage_Limits and
 * is upserted into the `plans` table by {@link seedPlans}. A value of
 * {@link UNLIMITED} denotes no cap on that dimension.
 *
 * (Requirement 4.1)
 */
export const PLANS: Readonly<Record<PlanTier, Plan>> = Object.freeze({
  free: {
    tier: 'free',
    limits: {
      users: 1,
      storageGb: 1,
      aiCalls: 100,
      reports: 5,
      automationRules: 3,
    },
    features: {
      customAiKeys: false,
      multiProviderAi: false,
      platformManagedAi: false,
      premiumModels: false,
      advancedAnalytics: false,
    },
  },
  pro: {
    tier: 'pro',
    limits: {
      users: 20,
      storageGb: 50,
      aiCalls: 10_000,
      reports: 100,
      automationRules: 50,
    },
    features: {
      customAiKeys: true,
      multiProviderAi: true,
      platformManagedAi: false,
      premiumModels: false,
      advancedAnalytics: true,
    },
  },
  premium: {
    tier: 'premium',
    limits: {
      users: 20,
      storageGb: 500,
      aiCalls: 100_000,
      reports: 1_000,
      automationRules: 500,
    },
    features: {
      customAiKeys: true,
      multiProviderAi: true,
      platformManagedAi: true,
      premiumModels: true,
      advancedAnalytics: true,
    },
  },
});

/** The tier applied to past-due or expired Subscriptions (Requirement 4.11). */
export const FALLBACK_TIER: PlanTier = 'free';

/**
 * Error raised when the one-active-subscription-per-tenant invariant is
 * violated (Requirement 4.2).
 */
export class SubscriptionInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionInvariantError';
  }
}

/** Return the immutable Plan definition for a tier (Requirement 4.1). */
export function getPlan(tier: PlanTier): Plan {
  const plan = PLANS[tier];
  if (!plan) {
    throw new SubscriptionInvariantError(`Unknown plan tier: ${String(tier)}`);
  }
  return plan;
}

/** Return the Usage_Limits declared by a Plan tier (Requirement 4.1). */
export function limitsForTier(tier: PlanTier): UsageLimits {
  return getPlan(tier).limits;
}

/**
 * Resolve the *effective* tier for a Subscription. A past-due or expired
 * Subscription is treated as Free; an active Subscription keeps its own tier.
 * (Requirement 4.11)
 */
export function effectiveTier(sub: Pick<Subscription, 'tier' | 'status'>): PlanTier {
  if (sub.status === 'past_due' || sub.status === 'expired') {
    return FALLBACK_TIER;
  }
  return sub.tier;
}

/**
 * Resolve the *effective* Usage_Limits for a Subscription. Past-due or expired
 * Subscriptions resolve to the Free Plan's limits; active Subscriptions resolve
 * to their own Plan's limits. (Requirement 4.11)
 */
export function effectiveLimits(sub: Pick<Subscription, 'tier' | 'status'>): UsageLimits {
  return limitsForTier(effectiveTier(sub));
}

/**
 * Loads the Subscription rows currently stored for a Tenant. Injected to keep
 * this module decoupled from the data-access layer (mirrors the resolver
 * pattern in `secrets/store.ts`). Returning more than one row indicates a
 * data-integrity problem and is rejected by {@link assertSingleSubscription}.
 */
export type SubscriptionLoader = (
  tenantId: string,
) => Promise<Subscription[]> | Subscription[];

/**
 * Persists the Plan catalog. Injected so {@link seedPlans} can write the
 * canonical {@link PLANS} into the `plans` table without this module importing
 * the data-access layer directly.
 */
export type PlanWriter = (plans: Plan[]) => Promise<void> | void;

let injectedSubscriptionLoader: SubscriptionLoader | null = null;

/** Register the loader used to read Subscriptions for a Tenant. */
export function setSubscriptionLoader(loader: SubscriptionLoader | null): void {
  injectedSubscriptionLoader = loader;
}

/**
 * Enforce the one-active-subscription-per-tenant invariant on a set of loaded
 * rows and return the single Subscription, or `null` when none exists.
 * (Requirement 4.2)
 *
 * - Zero rows ⇒ `null` (the Tenant has no Subscription yet).
 * - Exactly one row ⇒ that Subscription.
 * - More than one row, or more than one with an active status ⇒ invariant
 *   violation.
 */
export function assertSingleSubscription(
  tenantId: string,
  subscriptions: Subscription[],
): Subscription | null {
  const own = subscriptions.filter((s) => s.tenantId === tenantId);

  if (own.length === 0) {
    return null;
  }

  if (own.length > 1) {
    throw new SubscriptionInvariantError(
      `Tenant ${tenantId} has ${own.length} subscriptions; expected exactly one`,
    );
  }

  const activeCount = own.filter((s) => s.status === 'active').length;
  if (activeCount > 1) {
    throw new SubscriptionInvariantError(
      `Tenant ${tenantId} has ${activeCount} active subscriptions; expected at most one`,
    );
  }

  return own[0];
}

/**
 * Load the single Subscription for a Tenant via the injected loader, enforcing
 * the one-active-subscription-per-tenant invariant. (Requirement 4.2)
 */
export async function getSubscription(tenantId: string): Promise<Subscription | null> {
  if (!injectedSubscriptionLoader) {
    throw new SubscriptionInvariantError('No subscription loader configured');
  }
  const rows = await injectedSubscriptionLoader(tenantId);
  return assertSingleSubscription(tenantId, rows);
}

/**
 * Resolve the effective Usage_Limits for a Tenant: loads its single
 * Subscription and applies the past-due/expired ⇒ Free rule. A Tenant with no
 * Subscription is treated as Free. (Requirements 4.2, 4.11)
 */
export async function effectiveLimitsForTenant(tenantId: string): Promise<UsageLimits> {
  const sub = await getSubscription(tenantId);
  if (!sub) {
    return limitsForTier(FALLBACK_TIER);
  }
  return effectiveLimits(sub);
}

/**
 * Seed (upsert) the canonical Plan catalog into the `plans` table via the
 * injected writer. Idempotent at the call site: writers should upsert on the
 * `tier` primary key. (Requirement 4.1)
 */
export async function seedPlans(writer: PlanWriter): Promise<void> {
  await writer(Object.values(PLANS).map((p) => ({ ...p })));
}

/* -------------------------------------------------------------------------- *
 * Pre-commit usage-limit checks (Requirements 4.3, 3.1)
 *
 * A Tenant action that would exceed a Usage_Limit must be blocked *before* any
 * state change is committed: the check runs inside the same write transaction
 * as the mutation, and on exceed it leaves the Tenant's data unchanged and
 * returns a limit-exceeded decision that names the exceeded dimension.
 * -------------------------------------------------------------------------- */

/** Outcome of a usage-limit check. */
export type LimitDecisionStatus = 'allowed' | 'exceeded';

/**
 * The result of evaluating whether an action of size `delta` may proceed on a
 * single Usage_Limit dimension. (Requirements 4.3, 3.1)
 *
 * - `allowed`     — `true` when the action fits within the effective limit.
 * - `status`      — `'allowed'` or `'exceeded'`, mirroring `allowed`.
 * - `dimension`   — the Usage_Limit dimension that was evaluated; when blocked,
 *                   this is the *exceeded* dimension the response must identify.
 * - `limit`       — the effective cap for the dimension (per the effective Plan).
 * - `current`     — the Tenant's current usage on the dimension.
 * - `requested`   — the projected usage after the action (`current + delta`).
 * - `delta`       — the requested change.
 */
export interface LimitDecision {
  allowed: boolean;
  status: LimitDecisionStatus;
  dimension: keyof UsageLimits;
  limit: number;
  current: number;
  requested: number;
  delta: number;
}

/**
 * Error raised to abort an in-flight write transaction when a usage-limit would
 * be exceeded. Throwing this *before* issuing any mutation guarantees the
 * transaction is rolled back / never commits, leaving the Tenant's data
 * unchanged. (Requirement 4.3)
 */
export class LimitExceededError extends Error {
  readonly dimension: keyof UsageLimits;
  readonly limit: number;
  readonly current: number;
  readonly requested: number;
  readonly decision: LimitDecision;

  constructor(decision: LimitDecision) {
    super(
      `Usage limit exceeded for "${String(decision.dimension)}": ` +
        `${decision.requested} would exceed the limit of ${decision.limit} ` +
        `(current ${decision.current})`,
    );
    this.name = 'LimitExceededError';
    this.dimension = decision.dimension;
    this.limit = decision.limit;
    this.current = decision.current;
    this.requested = decision.requested;
    this.decision = decision;
  }
}

/**
 * Pure decision function: given the effective limits, current usage, and a
 * requested delta on a single dimension, decide whether the action fits.
 * (Requirements 4.3, 3.1)
 *
 * A non-finite limit (e.g. `Infinity`) denotes "no cap" and is never exceeded.
 * Reducing usage (negative `delta`) is always allowed since it cannot exceed a
 * cap. An action is blocked only when the projected usage strictly exceeds the
 * limit.
 */
export function decideLimit(
  dimension: keyof UsageLimits,
  limits: UsageLimits,
  currentUsage: number,
  delta: number,
): LimitDecision {
  const limit = limits[dimension];
  const current = currentUsage;
  const requested = current + delta;

  const allowed = !Number.isFinite(limit) || requested <= limit;

  return {
    allowed,
    status: allowed ? 'allowed' : 'exceeded',
    dimension,
    limit,
    current,
    requested,
    delta,
  };
}

/**
 * Evaluate whether an action of size `delta` on `dimension` may proceed for a
 * Tenant, using its single Subscription's effective limits and current usage.
 * This performs no mutation — it is the read-and-decide step intended to run
 * *before* any state change inside a write transaction. (Requirements 4.3, 3.1)
 *
 * A Tenant with no Subscription is treated as Free with zero usage on the
 * dimension. Past-due / expired Subscriptions resolve to Free limits via
 * {@link effectiveLimits}.
 *
 * Super admins bypass all billing limits.
 */
export async function checkLimit(
  tenantId: string,
  dimension: keyof UsageLimits,
  delta: number,
  role?: string,
): Promise<LimitDecision> {
  if (role === 'super_admin') {
    return { allowed: true, status: 'allowed', dimension, limit: Infinity, current: 0, requested: 0, delta: 0 };
  }

  const sub = await getSubscription(tenantId);

  if (!sub) {
    const limits = limitsForTier(FALLBACK_TIER);
    return decideLimit(dimension, limits, 0, delta);
  }

  const limits = effectiveLimits(sub);
  const current = sub.usage[dimension];
  return decideLimit(dimension, limits, current, delta);
}

/**
 * Limit-enforcing variant of {@link checkLimit} intended to be called at the
 * top of a write transaction: it throws {@link LimitExceededError} when the
 * action would exceed the limit, aborting the transaction before any mutation
 * runs so the Tenant's data is left unchanged. Returns the (allowed) decision
 * otherwise. (Requirement 4.3)
 *
 * Super admins bypass all billing limits.
 */
export async function enforceLimit(
  tenantId: string,
  dimension: keyof UsageLimits,
  delta: number,
  role?: string,
): Promise<LimitDecision> {
  const decision = await checkLimit(tenantId, dimension, delta, role);
  if (!decision.allowed) {
    throw new LimitExceededError(decision);
  }
  return decision;
}

/**
 * Run a usage-limit check immediately before a mutation, executing the mutation
 * only when the check passes. This binds the pre-commit check and the state
 * change together: on exceed, `mutate` is never invoked, so no state change
 * occurs and the returned decision names the exceeded dimension; otherwise the
 * mutation runs and its result is returned alongside the decision.
 * (Requirements 4.3, 3.1)
 *
 * Callers that manage an explicit database transaction should invoke this
 * inside that transaction so the read and the conditional write share one
 * atomic, pre-commit scope.
 *
 * Super admins bypass all billing limits.
 */
export async function commitWithLimitCheck<T>(
  tenantId: string,
  dimension: keyof UsageLimits,
  delta: number,
  mutate: () => Promise<T> | T,
  role?: string,
): Promise<{ decision: LimitDecision; result?: T }> {
  const decision = await checkLimit(tenantId, dimension, delta, role);
  if (!decision.allowed) {
    return { decision };
  }
  const result = await mutate();
  return { decision, result };
}

// ---------------------------------------------------------------------------
// Feature entitlement, plan downgrade, and billing-period reset (Task 4.3)
//
// Adds the entitlement, downgrade, and period-rollover behavior on top of the
// plan catalog and effective-limit logic above. Pure helpers carry the core
// logic so they remain testable without a database; the async wrappers persist
// through an injected writer, mirroring the loader pattern used elsewhere in
// this module.
//
// Requirements covered:
// - 4.7 / 4.14: Free (and any non-entitled) tiers gate Pro/Premium features and
//   return a feature-not-entitled response.
// - 4.10: A downgrade applies the new Plan's limits/entitlements, preserves
//   existing data, and blocks usage-increasing actions until usage is within
//   the new limit.
// - 4.13: A new billing period resets the per-period usage counters.
// ---------------------------------------------------------------------------

/**
 * A feature entitlement flag carried by a Plan (a key of {@link PlanFeatures}),
 * e.g. `'platformManagedAi'` or `'advancedAnalytics'`.
 */
export type Feature = keyof PlanFeatures;

/**
 * The per-billing-period usage dimensions that are reset on rollover. AI usage
 * and reports are defined as per-billing-period counts (Requirement 4.1),
 * whereas `users`, `storageGb`, and `automationRules` represent persistent
 * resource consumption and are preserved across periods.
 */
export const PERIOD_SCOPED_DIMENSIONS: readonly (keyof UsageCounters)[] = Object.freeze([
  'aiCalls',
  'reports',
]);

/**
 * Error raised when a caller demands a feature the effective Plan does not
 * grant. Carries the offending feature and tier so callers can build a
 * feature-not-entitled response. (Requirements 4.7, 4.14)
 */
export class FeatureNotEntitledError extends Error {
  readonly feature: Feature;
  readonly tier: PlanTier;

  constructor(tier: PlanTier, feature: Feature) {
    super(`Feature '${String(feature)}' is not entitled for the '${tier}' plan`);
    this.name = 'FeatureNotEntitledError';
    this.feature = feature;
    this.tier = tier;
  }
}

/** The outcome of a feature-entitlement check (Requirements 4.7, 4.14). */
export interface EntitlementDecision {
  entitled: boolean;
  tier: PlanTier;
  feature: Feature;
  /** Present only when `entitled` is false; a feature-not-entitled message. */
  reason?: string;
}

/**
 * Persists a full Subscription row. Injected so downgrade and period-reset can
 * write back without this module importing the data-access layer (mirrors
 * {@link SubscriptionLoader}). Writers should upsert on the `tenantId` key.
 */
export type SubscriptionWriter = (sub: Subscription) => Promise<void> | void;

let injectedSubscriptionWriter: SubscriptionWriter | null = null;

/** Register the writer used to persist Subscription changes. */
export function setSubscriptionWriter(writer: SubscriptionWriter | null): void {
  injectedSubscriptionWriter = writer;
}

async function persistSubscription(sub: Subscription): Promise<void> {
  if (!injectedSubscriptionWriter) {
    throw new SubscriptionInvariantError('No subscription writer configured');
  }
  await injectedSubscriptionWriter(sub);
}

/**
 * Whether a Plan tier grants a feature. This is the raw, tier-level check used
 * by {@link Plan.features}; it does not account for Subscription status. Use
 * {@link isFeatureEntitledForSubscription} when past-due/expired downgrades
 * must apply. (Requirements 4.7, 4.14)
 */
export function isFeatureEntitled(tier: PlanTier, feature: Feature): boolean {
  return getPlan(tier).features[feature] === true;
}

/**
 * Whether a Subscription's *effective* Plan grants a feature. Past-due or
 * expired Subscriptions resolve to Free via {@link effectiveTier}, so their
 * Pro/Premium features are gated. (Requirements 4.7, 4.11, 4.14)
 */
export function isFeatureEntitledForSubscription(
  sub: Pick<Subscription, 'tier' | 'status'>,
  feature: Feature,
): boolean {
  return isFeatureEntitled(effectiveTier(sub), feature);
}

/**
 * Build an {@link EntitlementDecision} for a tier/feature pair, returning a
 * feature-not-entitled reason when the feature is gated. (Requirements 4.7, 4.14)
 */
export function checkFeatureEntitlement(tier: PlanTier, feature: Feature): EntitlementDecision {
  const entitled = isFeatureEntitled(tier, feature);
  return {
    entitled,
    tier,
    feature,
    reason: entitled
      ? undefined
      : `feature-not-entitled: '${String(feature)}' is not available on the '${tier}' plan`,
  };
}

/**
 * Resolve whether a Tenant's effective Plan grants a feature, applying the
 * past-due/expired ⇒ Free rule and treating a Tenant with no Subscription as
 * Free. (Requirements 4.7, 4.11, 4.14)
 */
export async function isFeatureEntitledForTenant(
  tenantId: string,
  feature: Feature,
): Promise<boolean> {
  const sub = await getSubscription(tenantId);
  const tier = sub ? effectiveTier(sub) : FALLBACK_TIER;
  return isFeatureEntitled(tier, feature);
}

/** The result of applying a Plan change to a Subscription (Requirement 4.10). */
export interface PlanChangeResult {
  /** The Subscription with the new tier applied and usage/data preserved. */
  subscription: Subscription;
  /**
   * Dimensions whose preserved usage now exceeds the new effective limits.
   * Usage-increasing actions on these dimensions are blocked until usage falls
   * back within the limit.
   */
  exceededDimensions: (keyof UsageLimits)[];
}

/**
 * Apply a Plan change (e.g. a downgrade) to a Subscription. The new tier is
 * applied for subsequent limit/entitlement checks, while existing usage
 * counters — and therefore the underlying data they account for — are preserved
 * unchanged. The returned `exceededDimensions` names every dimension whose
 * current usage exceeds the new Plan's effective limits. (Requirement 4.10)
 */
export function applyPlanChange(sub: Subscription, newTier: PlanTier): PlanChangeResult {
  const subscription: Subscription = {
    ...sub,
    tier: newTier,
    usage: { ...sub.usage },
  };

  const limits = effectiveLimits(subscription);
  const exceededDimensions = (Object.keys(limits) as (keyof UsageLimits)[]).filter(
    (dim) => subscription.usage[dim] > limits[dim],
  );

  return { subscription, exceededDimensions };
}

/**
 * Whether a usage-increasing action of `delta` on `dimension` is allowed under
 * a Subscription's current effective limits. Non-increasing actions (`delta`
 * ≤ 0) are always allowed; an increase is permitted only when the resulting
 * usage stays within the effective limit. After a downgrade this blocks
 * increases beyond the new, lower limit while leaving existing data intact.
 * (Requirement 4.10)
 */
export function isUsageIncreaseAllowed(
  sub: Pick<Subscription, 'tier' | 'status' | 'usage'>,
  dimension: keyof UsageLimits,
  delta: number,
): boolean {
  if (delta <= 0) {
    return true;
  }
  const limit = effectiveLimits(sub)[dimension];
  return sub.usage[dimension] + delta <= limit;
}

/**
 * Load a Tenant's Subscription, apply a Plan change, and persist it. Existing
 * data is preserved; the new limits and entitlements apply to subsequent
 * actions, and usage-increasing actions are blocked while usage exceeds the new
 * limits (see {@link isUsageIncreaseAllowed}). (Requirement 4.10)
 */
export async function changePlan(
  tenantId: string,
  newTier: PlanTier,
): Promise<PlanChangeResult> {
  const sub = await getSubscription(tenantId);
  if (!sub) {
    throw new SubscriptionInvariantError(
      `Cannot change plan: tenant ${tenantId} has no subscription`,
    );
  }
  const result = applyPlanChange(sub, newTier);
  await persistSubscription(result.subscription);
  return result;
}

/**
 * Return a copy of usage counters with the per-billing-period dimensions
 * ({@link PERIOD_SCOPED_DIMENSIONS}) reset to zero, preserving the persistent
 * dimensions (`users`, `storageGb`, `automationRules`). (Requirement 4.13)
 */
export function resetUsageCounters(usage: UsageCounters): UsageCounters {
  const reset: UsageCounters = { ...usage };
  for (const dim of PERIOD_SCOPED_DIMENSIONS) {
    reset[dim] = 0;
  }
  return reset;
}

/**
 * Roll a Subscription into a new billing period: reset the per-period usage
 * counters and stamp the new period start. Pure; the underlying data and
 * persistent counters are preserved. (Requirement 4.13)
 */
export function rolloverPeriod(sub: Subscription, periodStart: string): Subscription {
  return {
    ...sub,
    usage: resetUsageCounters(sub.usage),
    periodStart,
  };
}

/**
 * Begin a new billing period for a Tenant: load its Subscription, reset the
 * per-billing-period usage counters to zero, set the new period start, and
 * persist. A Tenant with no Subscription is a no-op. (Requirement 4.13)
 */
export async function resetPeriodCounters(
  tenantId: string,
  now: Date = new Date(),
): Promise<void> {
  const sub = await getSubscription(tenantId);
  if (!sub) {
    return;
  }
  const rolled = rolloverPeriod(sub, now.toISOString());
  await persistSubscription(rolled);
}
