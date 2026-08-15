import 'server-only';

/**
 * Resolves the authoritative trusted server application origin for administrative
 * recovery, password setup, and onboarding links.
 *
 * Security Invariants:
 * 1. Derives origin exclusively from authoritative server configuration (APP_URL or NEXT_PUBLIC_APP_URL).
 * 2. Parses with `new URL()` to validate scheme (http/https) and normalizes strictly to `.origin`.
 * 3. NEVER reads or derives recovery origins from client-controlled request headers (Host, X-Forwarded-*, Referer).
 * 4. Production Fail-Closed: If configured origin is absent/invalid in production (NODE_ENV === 'production'), returns null.
 * 5. Development/Test Fallback: Controlled fixed 'http://localhost:3000' fallback ONLY when NODE_ENV !== 'production'.
 */
export function getTrustedAppOrigin(): string | null {
  const rawUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;

  if (rawUrl && typeof rawUrl === 'string' && rawUrl.trim().length > 0) {
    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Malformed URL
    }
  }

  // In production, fail closed — never guess or derive from request headers
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  // Development & Test controlled default
  return 'http://localhost:3000';
}
