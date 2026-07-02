/**
 * AI Credential Resolver — resolves which AI provider API key to use for a
 * Tenant's AI request, based strictly on the Tenant's effective subscription
 * tier. Replaces the env-fallback logic in `route-helper.ts` (wired in task
 * 15.1, not here).
 *
 * Responsibilities (Requirement 4):
 * - Premium ⇒ a platform-managed key, subject to the platform monthly AI spend
 *   cap; once the cap is reached, further requests are blocked. (4.6, 4.12)
 * - Pro ⇒ the Tenant's own decrypted provider key from the Secret_Store; Pro
 *   may configure multiple providers (OpenAI, Anthropic, Gemini, Groq,
 *   OpenRouter). (4.4, 4.5)
 * - Any other effective tier (Free, or a past-due / expired Subscription that
 *   resolves to Free) ⇒ a ConfigurationError. (4.7, 4.11)
 * - For any non-Premium Tenant the resolver NEVER falls back to `process.env`
 *   AI keys; a Tenant with no configured credentials and no entitlement to
 *   platform-managed keys yields a configuration error rather than silently
 *   using platform keys. (4.8, 4.9)
 *
 * This module is server-side only. Following the conventions of the sibling
 * services (`billing/service.ts`, `secrets/store.ts`), all data access is
 * injected so the core decision logic stays pure and testable without a live
 * database, Secret_Store, or environment configuration.
 */

import {
  effectiveTier,
  getSubscription,
  type PlanTier,
} from '@/lib/billing/service';

/**
 * AI providers supported for per-Tenant credential resolution
 * (Requirement 4.5).
 */
export type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'groq' | 'openrouter';

/** The canonical set of supported providers (Requirement 4.5). */
export const SUPPORTED_AI_PROVIDERS: readonly AIProvider[] = Object.freeze([
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'openrouter',
]);

/** The origin of a resolved AI credential. */
export type AICredentialSource = 'tenant' | 'platform';

/** A resolved AI credential ready for a server-side provider call. */
export interface AICredentialResolution {
  provider: AIProvider;
  /** The decrypted/plaintext API key. Server-side use only; never returned to a client. */
  apiKey: string;
  source: AICredentialSource;
}

/**
 * Error raised when no AI credential can be resolved for a Tenant: a
 * non-Premium Tenant with no configured key, or a Tenant not entitled to
 * platform-managed keys. Carries no secret material (Requirement 4.9, 6.8).
 */
export class ConfigurationError extends Error {
  readonly tenantId: string;
  readonly provider: AIProvider;

  constructor(message: string, tenantId: string, provider: AIProvider) {
    super(message);
    this.name = 'ConfigurationError';
    this.tenantId = tenantId;
    this.provider = provider;
  }
}

/**
 * Error raised when a Premium Tenant has reached the platform-managed monthly
 * AI spend cap; further AI requests are blocked for the billing period
 * (Requirement 4.12).
 */
export class SpendCapExceededError extends Error {
  readonly tenantId: string;
  readonly currentSpend: number;
  readonly monthlyCap: number;

  constructor(tenantId: string, currentSpend: number, monthlyCap: number) {
    super(
      `Platform monthly AI spend cap reached for tenant ${tenantId} ` +
        `(${currentSpend} >= ${monthlyCap})`,
    );
    this.name = 'SpendCapExceededError';
    this.tenantId = tenantId;
    this.currentSpend = currentSpend;
    this.monthlyCap = monthlyCap;
  }
}

/**
 * Resolves a Tenant's effective subscription tier. Injected so the resolver
 * stays decoupled from the data layer; defaults to the billing service, which
 * applies the past-due/expired ⇒ Free rule. (Requirements 4.6, 4.11)
 */
export type TierResolver = (tenantId: string) => Promise<PlanTier> | PlanTier;

/**
 * Resolves a Tenant's own configured (decrypted) API key for a provider, or
 * `null` when the Tenant has not configured one. Implementations decrypt via
 * the Secret_Store server-side and must never expose plaintext to a client.
 */
export type TenantKeyResolver = (
  tenantId: string,
  provider: AIProvider,
) => Promise<string | null> | string | null;

/**
 * Resolves the platform-managed key for a provider, used only for Premium
 * Tenants. Returns `null` when the platform has no key configured for the
 * provider. (Requirement 4.6)
 */
export type PlatformKeyResolver = (
  provider: AIProvider,
) => Promise<string | null> | string | null;

/** The Tenant's current platform-managed AI spend and the applicable cap. */
export interface SpendStatus {
  currentMonthlySpend: number;
  monthlyCap: number;
}

/**
 * Resolves the platform-managed monthly spend status for a Premium Tenant,
 * used to enforce the spend cap. (Requirement 4.12)
 */
export type SpendResolver = (tenantId: string) => Promise<SpendStatus> | SpendStatus;

const defaultTierResolver: TierResolver = async (tenantId) => {
  const sub = await getSubscription(tenantId);
  // No Subscription ⇒ treated as Free (billing service convention).
  if (!sub) return 'free';
  return effectiveTier(sub);
};

let tierResolver: TierResolver = defaultTierResolver;
let tenantKeyResolver: TenantKeyResolver | null = null;
let platformKeyResolver: PlatformKeyResolver | null = null;
let spendResolver: SpendResolver | null = null;

/** Register the resolver used to determine a Tenant's effective tier. */
export function setTierResolver(resolver: TierResolver | null): void {
  tierResolver = resolver ?? defaultTierResolver;
}

/** Register the resolver used to read a Tenant's own (decrypted) provider key. */
export function setTenantKeyResolver(resolver: TenantKeyResolver | null): void {
  tenantKeyResolver = resolver;
}

/** Register the resolver used to read platform-managed provider keys (Premium). */
export function setPlatformKeyResolver(resolver: PlatformKeyResolver | null): void {
  platformKeyResolver = resolver;
}

/** Register the resolver used to read a Premium Tenant's monthly spend status. */
export function setSpendResolver(resolver: SpendResolver | null): void {
  spendResolver = resolver;
}

/**
 * Per-call resolver dependencies. When provided to {@link resolveAICredentials}
 * these override the module-level (globally injected) resolvers for that call
 * only. This lets request handlers bind resolution to a request-scoped Supabase
 * client without mutating shared global state across concurrent requests, while
 * preserving the global-injection convention used by the unit tests.
 */
export interface ResolverDeps {
  tier?: TierResolver;
  tenantKey?: TenantKeyResolver;
  platformKey?: PlatformKeyResolver;
  spend?: SpendResolver;
}

function assertSupportedProvider(provider: AIProvider, tenantId: string): void {
  if (!SUPPORTED_AI_PROVIDERS.includes(provider)) {
    throw new ConfigurationError(
      `Unsupported AI provider: ${String(provider)}`,
      tenantId,
      provider,
    );
  }
}

/**
 * Resolve the AI credential a Tenant must use for a provider, based on its
 * effective subscription tier.
 *
 * - Premium ⇒ platform-managed key. Before returning, the platform monthly
 *   spend cap is enforced; if the cap is reached a {@link SpendCapExceededError}
 *   is thrown. If the platform has no key configured for the provider a
 *   {@link ConfigurationError} is thrown. (4.6, 4.12)
 * - Pro ⇒ the Tenant's own decrypted key for the provider. If none is
 *   configured a {@link ConfigurationError} is thrown — never a fall back to
 *   platform/env keys. (4.4, 4.5, 4.8, 4.9)
 * - Free / past-due / expired (effective tier `free`) ⇒ a
 *   {@link ConfigurationError}; the resolver never falls back to `process.env`
 *   AI keys for these Tenants. (4.7, 4.8, 4.9, 4.11)
 */
export async function resolveAICredentials(
  tenantId: string,
  provider: AIProvider,
  deps?: ResolverDeps,
): Promise<AICredentialResolution> {
  assertSupportedProvider(provider, tenantId);

  const resolveTier = deps?.tier ?? tierResolver;
  const tier = await resolveTier(tenantId);

  if (tier === 'premium') {
    return resolvePremium(tenantId, provider, deps);
  }

  if (tier === 'pro') {
    return resolvePro(tenantId, provider, deps);
  }

  // Free / past-due / expired ⇒ no entitlement to platform keys and no
  // env fallback (Requirements 4.7, 4.8, 4.9, 4.11).
  throw new ConfigurationError(
    `Tenant ${tenantId} (tier: ${tier}) has no entitlement to AI credentials ` +
      `for provider ${provider}; configure a paid plan or provide credentials`,
    tenantId,
    provider,
  );
}

async function resolvePremium(
  tenantId: string,
  provider: AIProvider,
  deps?: ResolverDeps,
): Promise<AICredentialResolution> {
  const resolveSpend = deps?.spend ?? spendResolver;
  const resolvePlatformKey = deps?.platformKey ?? platformKeyResolver;

  // Enforce the platform-managed monthly spend cap before returning a key
  // (Requirement 4.12). Fail closed if the spend status cannot be resolved.
  if (!resolveSpend) {
    throw new ConfigurationError(
      `Cannot verify platform AI spend cap for tenant ${tenantId}`,
      tenantId,
      provider,
    );
  }

  const { currentMonthlySpend, monthlyCap } = await resolveSpend(tenantId);
  if (currentMonthlySpend >= monthlyCap) {
    throw new SpendCapExceededError(tenantId, currentMonthlySpend, monthlyCap);
  }

  if (!resolvePlatformKey) {
    throw new ConfigurationError(
      `No platform-managed AI key available for provider ${provider}`,
      tenantId,
      provider,
    );
  }

  const apiKey = await resolvePlatformKey(provider);
  if (!apiKey) {
    throw new ConfigurationError(
      `No platform-managed AI key configured for provider ${provider}`,
      tenantId,
      provider,
    );
  }

  return { provider, apiKey, source: 'platform' };
}

async function resolvePro(
  tenantId: string,
  provider: AIProvider,
  deps?: ResolverDeps,
): Promise<AICredentialResolution> {
  const resolveTenantKey = deps?.tenantKey ?? tenantKeyResolver;

  // Pro tenants must supply their own keys; never fall back to platform/env
  // keys (Requirements 4.4, 4.8, 4.9).
  if (!resolveTenantKey) {
    throw new ConfigurationError(
      `No AI credentials configured for provider ${provider}`,
      tenantId,
      provider,
    );
  }

  const apiKey = await resolveTenantKey(tenantId, provider);
  if (!apiKey) {
    throw new ConfigurationError(
      `No AI credentials configured for provider ${provider}`,
      tenantId,
      provider,
    );
  }

  return { provider, apiKey, source: 'tenant' };
}
