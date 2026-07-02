/**
 * Session manager — server-validated session lifetime policy (Requirement 9.1).
 *
 * Enforces two independent expiry rules with defaults:
 *  - Inactivity timeout: a session is invalid once its idle time (time since the
 *    last observed activity) exceeds 30 minutes.
 *  - Absolute lifetime: a session is invalid once its total age (time since the
 *    session began) exceeds 24 hours.
 *
 * After either threshold is crossed the System must require re-authentication
 * (Requirement 9.1). This module is intentionally pure and free of Node- or
 * Edge-specific APIs so it can run inside `middleware.ts` (Edge runtime),
 * server components, and unit/property tests without modification.
 *
 * Property 42 (design.md): a session is valid *if and only if* its idle time
 * does not exceed 30 minutes and its total age does not exceed 24 hours.
 */

/** Default inactivity timeout: 30 minutes, expressed in milliseconds. */
export const DEFAULT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** Default absolute session lifetime: 24 hours, expressed in milliseconds. */
export const DEFAULT_ABSOLUTE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Cookie used to carry the server-validated session activity anchors. */
export const SESSION_ACTIVITY_COOKIE = 'sb-session-activity';

/** Configurable session lifetime policy. */
export interface SessionPolicy {
  /** Maximum permitted idle time before the session expires (ms). */
  inactivityTimeoutMs: number;
  /** Maximum permitted total session age before it expires (ms). */
  absoluteLifetimeMs: number;
}

/** The default session policy: 30-min inactivity, 24-hour absolute lifetime. */
export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  inactivityTimeoutMs: DEFAULT_INACTIVITY_TIMEOUT_MS,
  absoluteLifetimeMs: DEFAULT_ABSOLUTE_LIFETIME_MS,
};

/**
 * The two timestamps that anchor a session's validity, both epoch milliseconds.
 * `startedAt` anchors the absolute-lifetime rule; `lastActivityAt` anchors the
 * inactivity rule.
 */
export interface SessionActivity {
  startedAt: number;
  lastActivityAt: number;
}

/** Why a session was deemed invalid. */
export type SessionExpiryReason = 'inactivity' | 'absolute_lifetime' | 'malformed';

/** Result of evaluating a session against the policy. */
export interface SessionEvaluation {
  valid: boolean;
  reason: SessionExpiryReason | null;
}

/** Begin a new session anchored at `now` (both anchors equal). */
export function startSession(now: number): SessionActivity {
  return { startedAt: now, lastActivityAt: now };
}

/**
 * Record activity on an existing session, advancing only the inactivity anchor.
 * The absolute-lifetime anchor (`startedAt`) is preserved.
 */
export function touchSession(activity: SessionActivity, now: number): SessionActivity {
  return { startedAt: activity.startedAt, lastActivityAt: now };
}

function isWellFormed(activity: SessionActivity, now: number): boolean {
  const { startedAt, lastActivityAt } = activity;
  if (!Number.isFinite(startedAt) || !Number.isFinite(lastActivityAt)) return false;
  if (startedAt < 0 || lastActivityAt < 0) return false;
  // Activity can never precede the session start, nor occur in the future.
  if (lastActivityAt < startedAt) return false;
  if (startedAt > now || lastActivityAt > now) return false;
  return true;
}

/**
 * Evaluate whether a session is still valid at instant `now`.
 *
 * A session is valid if and only if both:
 *  - its idle time (`now - lastActivityAt`) does not exceed the inactivity
 *    timeout, and
 *  - its total age (`now - startedAt`) does not exceed the absolute lifetime.
 *
 * The absolute-lifetime rule is checked first so an old-but-recently-active
 * session is reported as `absolute_lifetime` rather than `inactivity`.
 */
export function evaluateSession(
  activity: SessionActivity,
  now: number,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
): SessionEvaluation {
  if (!isWellFormed(activity, now)) {
    return { valid: false, reason: 'malformed' };
  }

  const age = now - activity.startedAt;
  if (age > policy.absoluteLifetimeMs) {
    return { valid: false, reason: 'absolute_lifetime' };
  }

  const idle = now - activity.lastActivityAt;
  if (idle > policy.inactivityTimeoutMs) {
    return { valid: false, reason: 'inactivity' };
  }

  return { valid: true, reason: null };
}

/**
 * HMAC-SHA256 signing for session cookies. Prevents tampering with
 * session activity timestamps. The secret is derived from the
 * session cookie name and a server-side environment variable.
 */
function getSigningSecret(): string {
  return process.env.SESSION_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback-dev-secret-do-not-use-in-production';
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(data, secret);
  return expected === signature;
}

/** Serialise session anchors into a compact, HMAC-signed cookie value. */
export async function serializeActivity(activity: SessionActivity): Promise<string> {
  const payload = `${activity.startedAt}.${activity.lastActivityAt}`;
  const sig = await hmacSign(payload, getSigningSecret());
  return `${payload}.${sig}`;
}

/**
 * Parse a signed cookie value back into session anchors, or `null` if
 * the signature is invalid or the payload is malformed.
 */
export async function parseActivity(raw: string | undefined | null): Promise<SessionActivity | null> {
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [startedStr, lastStr, signature] = parts;
  const payload = `${startedStr}.${lastStr}`;
  const valid = await hmacVerify(payload, signature, getSigningSecret());
  if (!valid) return null;
  const startedAt = Number(startedStr);
  const lastActivityAt = Number(lastStr);
  if (!Number.isFinite(startedAt) || !Number.isFinite(lastActivityAt)) return null;
  return { startedAt, lastActivityAt };
}
