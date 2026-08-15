import 'server-only';

const PRIVATE_IP_REGEX = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|0\.0\.0\.0|::1|fc00:|fe80:)/i;
const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'instance-data',
  '169.254.169.254',
]);

/**
 * Validates a custom AI provider base URL against SSRF and private-network access.
 *
 * Enforces:
 * - Valid URL structure
 * - http / https schemes ONLY
 * - Rejection of localhost, loopback, link-local, private RFC-1918 ranges, and cloud metadata services
 * - In production (NODE_ENV === 'production'): enforces HTTPS
 */
export function isSafeCustomProviderUrl(urlStr: string): { safe: boolean; error?: string; url?: URL } {
  if (!urlStr || typeof urlStr !== 'string') {
    return { safe: false, error: 'URL is required' };
  }

  let parsed: URL;
  try {
    const raw = urlStr.trim();
    if (raw.includes('://')) {
      parsed = new URL(raw);
    } else {
      parsed = new URL(`https://${raw}`);
    }
  } catch {
    return { safe: false, error: 'Malformed URL' };
  }

  // Scheme validation: strictly http / https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, error: 'Only HTTP and HTTPS protocols are allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // In production, require HTTPS
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    return { safe: false, error: 'Custom provider URLs must use HTTPS in production' };
  }

  // Reject forbidden hostnames
  if (
    FORBIDDEN_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { safe: false, error: 'Localhost and internal hostnames are not permitted' };
  }

  // Reject private and link-local IP addresses
  if (PRIVATE_IP_REGEX.test(hostname)) {
    return { safe: false, error: 'Private and internal IP ranges are not permitted' };
  }

  return { safe: true, url: parsed };
}
