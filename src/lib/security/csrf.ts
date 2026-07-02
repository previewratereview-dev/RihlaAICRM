/**
 * CSRF Protection — Double-Submit Cookie Pattern.
 *
 * State-changing routes (POST/PUT/DELETE/PATCH) require a valid CSRF token
 * in the `x-csrf-token` header. The token is a signed, timestamped HMAC
 * that expires after 1 hour. Tokens are generated per-session and stored
 * in an httpOnly cookie.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const SECRET: string = process.env.CSRF_SECRET || process.env.NEXTAUTH_SECRET || '';
if (!SECRET) {
  throw new Error('CSRF_SECRET or NEXTAUTH_SECRET environment variable is required');
}
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hmac(data: string): string {
  return createHmac('sha256', SECRET).update(data).digest('hex');
}

/**
 * Generate a new CSRF token. The token encodes a timestamp and its HMAC
 * so we can verify authenticity and expiry without server-side state.
 */
export function generateCsrfToken(): string {
  const nonce = randomBytes(16).toString('hex');
  const ts = Date.now();
  const payload = `${nonce}:${ts}`;
  const sig = hmac(payload);
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

/**
 * Validate a CSRF token. Returns true if the token is authentic and
 * not expired. Uses timing-safe comparison to prevent timing attacks.
 */
export function validateCsrfToken(token: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return false;

    const [nonce, tsStr, sig] = parts;
    const ts = parseInt(tsStr, 10);
    if (isNaN(ts)) return false;

    // Check expiry
    if (Date.now() - ts > TOKEN_TTL_MS) return false;

    // Verify HMAC
    const payload = `${nonce}:${tsStr}`;
    const expectedSig = hmac(payload);
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedBuf.length) return false;

    return timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}
