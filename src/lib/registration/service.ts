import 'server-only';

/**
 * Registration_Service — self-service sign-up and atomic tenant provisioning.
 *
 * Responsibilities covered by this task (Requirement 1):
 * - Validate every registration field before any write and report which field
 *   is invalid: email 5–254 chars and standard format, password 8–128 chars,
 *   agency name 2–100 chars. (1.2)
 * - Reject all registrations when the platform setting `allowNewTenants` is
 *   disabled, creating neither an Agency nor a User. (1.10)
 * - Enforce a registration rate limit of 5 requests / 60s per client source via
 *   the shared Rate_Limiter, rejecting the additional requests. (1.11)
 * - Provision the new Agency, its first Agency_Admin User, default system Roles,
 *   and a Free Subscription atomically through the `provision_agency()` RPC,
 *   all-or-nothing (1.1, 1.3, 1.4, 1.5, 1.7, 7.8), never assigning the literal
 *   `global` Tenant_Id (1.8), and rejecting a duplicate email (1.6).
 *
 * This module is server-only. Following the conventions of the sibling lib
 * services (`platform/service.ts`, `rbac/service.ts`, `billing/service.ts`),
 * the data-access port is injected so the core logic stays decoupled from
 * Supabase and is unit-testable without a live database. The default store
 * reads/writes through a service-role client (it must create auth users, read
 * platform settings, and invoke the `SECURITY DEFINER` provisioning RPC).
 *
 * The shared Rate_Limiter (`src/lib/rate-limit.ts`) is used directly: it already
 * fails closed when its backing store is unavailable (Requirement 9.12), so a
 * registration is rejected — never allowed unbounded — when the limiter cannot
 * be reached.
 */

import { checkRateLimit, buildRateLimitKey } from '../rate-limit';
import { verificationEmailTemplate } from '../emails/verification';
import { Resend } from 'resend';
import { randomBytes, randomInt } from 'crypto';
import { logger } from '../logger';

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (resendClient) return resendClient;
  resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

function generateOTP(): string {
  return randomInt(100000, 999999).toString();
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** Registration request, mirroring the design's `RegistrationInput`. */
export interface RegistrationInput {
  /** 5–254 chars, standard email format. */
  email: string;
  /** 8–128 chars. */
  password: string;
  /** 2–100 chars. */
  agencyName: string;
  /** IP or client id, used for the per-source registration rate limit. */
  clientSource: string;
}

/** The field a registration error refers to (design's `RegistrationResult`). */
export type RegistrationErrorField =
  | 'email'
  | 'password'
  | 'agencyName'
  | 'rate'
  | 'registration_closed';

/** Outcome of {@link register}, mirroring the design's `RegistrationResult`. */
export interface RegistrationResult {
  ok: boolean;
  tenantId?: string;
  userId?: string;
  token?: string;
  error?: { field?: RegistrationErrorField; message: string };
}

/** Result of {@link validateRegistration}. */
export interface ValidationResult {
  valid: boolean;
  /** The first field that failed validation, when `valid` is false. */
  field?: 'email' | 'password' | 'agencyName';
  /** Human-readable reason the field is invalid. */
  message?: string;
}

/** Field length bounds (Requirement 1.1, 1.2). */
export const EMAIL_MIN = 5;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const AGENCY_NAME_MIN = 2;
export const AGENCY_NAME_MAX = 100;

/** Registration rate limit: 5 requests per 60-second window per source (1.11). */
export const REGISTRATION_RATE_LIMIT = 5;
export const REGISTRATION_RATE_WINDOW_MS = 60_000;

/**
 * Standard-format email check. Requires a single `@`, a non-empty local part
 * with no whitespace, and a domain containing at least one dot with a non-empty
 * top-level label. Deliberately conservative — full RFC 5322 is not required by
 * the acceptance criteria, only a "standard email format". (1.1, 1.2)
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a registration input without performing any write.
 *
 * Checks each field against its length and format constraints and returns the
 * first offending field so the caller can tell the user exactly what to fix.
 * Validation order (email, password, agency name) is irrelevant when a single
 * field is invalid; with multiple invalid fields the first in that order is
 * reported. (1.2)
 */
export function validateRegistration(input: RegistrationInput): ValidationResult {
  const email = input?.email ?? '';
  const password = input?.password ?? '';
  const agencyName = input?.agencyName ?? '';

  if (email.length < EMAIL_MIN || email.length > EMAIL_MAX) {
    return {
      valid: false,
      field: 'email',
      message: `Email must be between ${EMAIL_MIN} and ${EMAIL_MAX} characters.`,
    };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return {
      valid: false,
      field: 'email',
      message: 'Email must be a valid email address.',
    };
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return {
      valid: false,
      field: 'password',
      message: `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
    };
  }
  if (agencyName.length < AGENCY_NAME_MIN || agencyName.length > AGENCY_NAME_MAX) {
    return {
      valid: false,
      field: 'agencyName',
      message: `Agency name must be between ${AGENCY_NAME_MIN} and ${AGENCY_NAME_MAX} characters.`,
    };
  }
  return { valid: true };
}

/**
 * Raised by a {@link RegistrationStore} when the supplied email already belongs
 * to an existing User (either rejected at the auth layer or by the unique
 * profiles.email constraint inside `provision_agency`). Surfaced to the caller
 * as an `email`-field error. (1.6)
 */
export class DuplicateEmailError extends Error {
  constructor(message = 'Email already registered') {
    super(message);
    this.name = 'DuplicateEmailError';
  }
}

/**
 * Raised by a {@link RegistrationStore} when provisioning fails or exceeds its
 * time budget. The store is responsible for ensuring nothing is half-created
 * (the RPC is all-or-nothing and any orphaned auth user is cleaned up). (1.3)
 */
export class ProvisioningError extends Error {
  constructor(message = 'Provisioning did not complete') {
    super(message);
    this.name = 'ProvisioningError';
  }
}

/**
 * Data-access port for registration. Injected so the service is decoupled from
 * Supabase and unit-testable without a live database, mirroring the loader/store
 * pattern used by the sibling services.
 */
export interface RegistrationStore {
  /**
   * Whether new tenant registrations are currently accepted, read from the
   * `allowNewTenants` platform setting. (1.10)
   */
  isRegistrationAllowed(): Promise<boolean>;
  /**
   * Atomically provision a new Agency and its first Agency_Admin for a valid,
   * unique email. Implementations MUST guarantee all-or-nothing semantics:
   * create the auth user, invoke `provision_agency`, and on any failure leave
   * neither an Agency nor a User behind. (1.1, 1.3)
   *
   * MUST throw {@link DuplicateEmailError} when the email already exists (1.6)
   * and {@link ProvisioningError} for any other provisioning failure (1.3).
   */
  provision(input: {
    email: string;
    password: string;
    agencyName: string;
  }): Promise<{ tenantId: string; userId: string; token: string }>;
}

let injectedStore: RegistrationStore | null = null;

/**
 * Register the {@link RegistrationStore} used by {@link register}. Kept
 * injectable for isolated server use and testing; passing `null` restores the
 * default service-role-backed store.
 */
export function setRegistrationStore(store: RegistrationStore | null): void {
  injectedStore = store;
}

function storeOrDefault(): RegistrationStore {
  return injectedStore ?? getDefaultStore();
}

/**
 * Handle a self-service registration request.
 *
 * Order of operations (design §1):
 *   1. Validate all fields; reject naming the offending field. (1.2)
 *   2. Reject when `allowNewTenants` is disabled. (1.10)
 *   3. Enforce the 5-req/60s per-source rate limit via the shared Rate_Limiter,
 *      failing closed when the limiter is unavailable. (1.11, 9.12)
 *   4. Provision atomically (Agency + Agency_Admin + system Roles + Free
 *      Subscription) with a non-`global` Tenant_Id, rejecting a duplicate
 *      email. (1.1, 1.4–1.8, 7.8)
 *
 * Returns a {@link RegistrationResult}; on any rejection no Agency and no User
 * are created.
 */
export async function register(input: RegistrationInput): Promise<RegistrationResult> {
  // 1. Field validation before any write. (1.2)
  const validation = validateRegistration(input);
  if (!validation.valid) {
    return {
      ok: false,
      error: {
        field: validation.field,
        message: validation.message ?? 'Invalid registration input.',
      },
    };
  }

  const store = storeOrDefault();

  // 2. Platform gate: reject all registrations when disabled. (1.10)
  let allowed: boolean;
  try {
    allowed = await store.isRegistrationAllowed();
  } catch {
    // Fail closed: if we cannot confirm registrations are open, do not provision.
    return {
      ok: false,
      error: {
        field: 'registration_closed',
        message: 'New registrations are not currently accepted.',
      },
    };
  }
  if (!allowed) {
    return {
      ok: false,
      error: {
        field: 'registration_closed',
        message: 'New registrations are not currently accepted.',
      },
    };
  }

  // 3. Per-source rate limit: 5 requests / 60s. Fails closed when the shared
  //    store is unavailable (Requirement 9.12). (1.11)
  const rateKey = buildRateLimitKey({ scope: 'registration', ip: input.clientSource });
  const rate = await checkRateLimit(
    rateKey,
    REGISTRATION_RATE_LIMIT,
    REGISTRATION_RATE_WINDOW_MS,
  );
  if (!rate.allowed) {
    return {
      ok: false,
      error: {
        field: 'rate',
        message: rate.storeUnavailable
          ? 'Registration is temporarily unavailable. Please try again shortly.'
          : 'Registration rate limit exceeded. Please try again later.',
      },
    };
  }

  // 4. Atomic provisioning. (1.1, 1.3–1.8, 7.8)
  try {
    const { tenantId, userId, token } = await store.provision({
      email: input.email,
      password: input.password,
      agencyName: input.agencyName,
    });
    return { ok: true, tenantId, userId, token };
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return {
        ok: false,
        error: { field: 'email', message: 'This email is already registered.' },
      };
    }
    // Any other failure (including a timed-out transaction) rolls back to no
    // Agency and no User; surface a generic provisioning error. (1.3)
    return {
      ok: false,
      error: { message: 'Provisioning did not complete. Please try again.' },
    };
  }
}

/**
 * Default {@link RegistrationStore} backed by a Supabase service-role client.
 *
 * Lazily imports `@supabase/supabase-js` and reads the service-role credentials
 * from the environment so modules that only need the pure helpers
 * ({@link validateRegistration}) are not coupled to the Supabase client. The
 * service-role path is required: it creates auth users, reads `platform_settings`,
 * and invokes the `SECURITY DEFINER` `provision_agency` RPC.
 */
function getDefaultStore(): RegistrationStore {
  async function client() {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new ProvisioningError('Supabase service-role configuration is missing');
    }
    return createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Heuristic: does an auth-layer error indicate the email already exists? */
  function isDuplicateEmail(message: string | undefined): boolean {
    if (!message) return false;
    const m = message.toLowerCase();
    return (
      m.includes('already registered') ||
      m.includes('already exists') ||
      m.includes('already been registered') ||
      m.includes('duplicate') ||
      m.includes('email_already_registered') ||
      m.includes('unique')
    );
  }

  return {
    async isRegistrationAllowed(): Promise<boolean> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('platform_settings')
        .select('allow_new_tenants')
        .eq('id', 'platform')
        .maybeSingle();
      // Default to allowing when the row is absent (fresh install), matching
      // the platform-settings default (`allow_new_tenants DEFAULT true`).
      if (error || !data) return true;
      return data.allow_new_tenants !== false;
    },

    async provision({ email, password, agencyName }): Promise<{ tenantId: string; userId: string; token: string }> {
      const supabase = await client();

      // Create the auth user first so concurrent duplicate emails are rejected
      // at the auth layer (unique email). (1.6)
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
      });
      if (createErr || !created?.user) {
        if (isDuplicateEmail(createErr?.message)) {
          throw new DuplicateEmailError();
        }
        throw new ProvisioningError('Failed to create the user account.');
      }

      const authUserId = created.user.id;

      // Invoke the all-or-nothing provisioning RPC (Agency + Agency_Admin +
      // system Roles + Free Subscription, ≤10s budget). (1.1, 1.3, 1.7, 7.8)
      const { data, error } = await supabase.rpc('provision_agency', {
        p_auth_user_id: authUserId,
        p_email: email,
        p_agency_name: agencyName,
      });

      if (error) {
        // Roll back the orphaned auth user so nothing is half-created. (1.3)
        await supabase.auth.admin.deleteUser(authUserId).catch(() => undefined);
        if (isDuplicateEmail(error.message)) {
          throw new DuplicateEmailError();
        }
        throw new ProvisioningError('Provisioning transaction failed.');
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.tenant_id || !row.user_id) {
        await supabase.auth.admin.deleteUser(authUserId).catch(() => undefined);
        throw new ProvisioningError('Provisioning returned no tenant.');
      }

      // Generate OTP and token for verification
      const otp = generateOTP();
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

      // Store OTP in database
      const { error: otpError } = await supabase
        .from('email_verification_otps')
        .insert({
          user_id: authUserId,
          email,
          otp,
          token,
          expires_at: expiresAt,
        });

      if (otpError) {
        logger.error('Failed to store verification OTP', otpError);
      }

      // Send verification email via Resend
      try {
        const confirmUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?token=${token}&email=${encodeURIComponent(email)}`;
        const htmlContent = verificationEmailTemplate(otp, confirmUrl);
        const resend = getResendClient();
        await resend.emails.send({
          from: 'State AI <noreply@stateai.in>',
          to: email,
          subject: 'Verify your email address',
          html: htmlContent,
        });
        logger.info('Verification email sent', { email: email.replace(/(.{2}).*(@.*)/, '$1***$2') });
      } catch (emailErr) {
        // Log but don't fail registration - user can request resend later
        logger.error('Failed to send verification email', emailErr);
      }

      return { tenantId: String(row.tenant_id), userId: String(row.user_id), token };
    },
  };
}
