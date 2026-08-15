import 'server-only';
import * as dns from 'dns';
import * as net from 'net';

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
 * Checks if an IPv4 or IPv6 address belongs to a private, loopback, link-local,
 * multicast, carrier-grade NAT, or cloud metadata network.
 */
export function isPrivateOrRestrictedIp(ipAddress: string): boolean {
  const ip = ipAddress.trim().toLowerCase();

  // 1. Validate if it is a valid IP
  const ipFamily = net.isIP(ip);
  if (ipFamily === 0) return true; // Not an IP or malformed -> treat as restricted

  // 2. IPv4 Checks
  if (ipFamily === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [a, b] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (Private RFC-1918)
    if (a === 10) return true;
    // 100.64.0.0/10 (Carrier-Grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-Local / Cloud Metadata e.g. AWS/GCP/Azure 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private RFC-1918: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && parts[2] === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 0 && parts[2] === 2) return true;
    // 192.88.99.0/24 (6to4 Relay Anycast)
    if (a === 192 && b === 88 && parts[2] === 99) return true;
    // 192.168.0.0/16 (Private RFC-1918)
    if (a === 192 && b === 168) return true;
    // 198.18.0.0/15 (Network Benchmark Tests)
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51 && parts[2] === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 (Reserved for future use: 240.0.0.0 - 255.255.255.254)
    if (a >= 240) return true;

    return false;
  }

  // 3. IPv6 Checks
  if (ipFamily === 6) {
    // Unspecified :: and Loopback ::1
    if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:0' || ip === '0:0:0:0:0:0:0:1') {
      return true;
    }

    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    if (ip.startsWith('::ffff:')) {
      const embeddedIpv4 = ip.replace('::ffff:', '');
      if (net.isIPv4(embeddedIpv4)) {
        return isPrivateOrRestrictedIp(embeddedIpv4);
      }
      return true;
    }

    // Unique Local Addresses ULA (fc00::/7 -> fc00... to fdff...)
    if (ip.startsWith('fc') || ip.startsWith('fd')) {
      return true;
    }

    // Link-Local unicast (fe80::/10 -> fe80... to febf...)
    if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
      return true;
    }

    // Multicast (ff00::/8)
    if (ip.startsWith('ff')) {
      return true;
    }

    // Discard (100::/64) & Documentation (2001:db8::/32)
    if (ip.startsWith('100:') || ip.startsWith('2001:db8:')) {
      return true;
    }

    return false;
  }

  return true;
}

/**
 * Validates URL structure, schemes, and hostnames synchronously.
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

  // Strip user credentials (e.g. user:pass@host)
  if (parsed.username || parsed.password) {
    return { safe: false, error: 'User credentials in URL are not permitted' };
  }

  const rawHostname = parsed.hostname.toLowerCase();
  // Strip enclosing brackets for IPv6
  const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']')
    ? rawHostname.slice(1, -1)
    : rawHostname;

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

  // If hostname is a literal IP address, check against restricted subnets
  if (net.isIP(hostname) && isPrivateOrRestrictedIp(hostname)) {
    return { safe: false, error: 'Private and internal IP ranges are not permitted' };
  }

  return { safe: true, url: parsed };
}

/**
 * Performs full SSRF validation including asynchronous DNS resolution.
 * Verifies that all IP addresses returned by DNS are safe public addresses.
 */
export async function validateCustomProviderUrlWithDns(
  urlStr: string
): Promise<{ safe: boolean; error?: string; url?: URL }> {
  const syncCheck = isSafeCustomProviderUrl(urlStr);
  if (!syncCheck.safe || !syncCheck.url) {
    return syncCheck;
  }

  const rawHostname = syncCheck.url.hostname.toLowerCase();
  const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']')
    ? rawHostname.slice(1, -1)
    : rawHostname;

  // If already an IP address, synchronous check already validated it
  if (net.isIP(hostname)) {
    return syncCheck;
  }

  // Resolve DNS addresses
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { safe: false, error: 'Hostname could not be resolved via DNS' };
    }

    for (const record of addresses) {
      if (isPrivateOrRestrictedIp(record.address)) {
        return {
          safe: false,
          error: `Destination resolves to a restricted/private IP address (${record.address})`,
        };
      }
    }
  } catch (dnsErr: unknown) {
    const msg = dnsErr instanceof Error ? dnsErr.message : 'DNS lookup failed';
    return { safe: false, error: `DNS resolution error: ${msg}` };
  }

  return syncCheck;
}
