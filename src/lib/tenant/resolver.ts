export type TenantSource = 'subdomain' | 'header' | 'user_profile' | 'default';

export interface TenantResolution {
  tenantId: string;
  source: TenantSource;
}

export function resolveTenantFromSubdomain(host: string | null): string | null {
  if (!host) return null;
  const [, ...parts] = host.split('.');
  if (parts.length >= 2) {
    const possible = parts[0];
    if (possible && possible !== 'www' && possible !== 'api') {
      return possible;
    }
  }
  return null;
}

export function resolveTenantFromRequest(
  options: {
    host?: string | null;
    header?: string | null;
    sessionTenantId?: string | null;
    allowMismatch?: boolean;
    fallback?: string;
  } = {}
): TenantResolution {
  const host = options.host ?? null;
  const header = options.header ?? null;
  const sessionTenantId = options.sessionTenantId ?? null;
  const allowMismatch = options.allowMismatch ?? false;
  const fallback = options.fallback ?? 'global';

  // If we have an authenticated session, use that as authoritative source
  if (sessionTenantId) {
    // Extract tenant from subdomain and header for validation
    const fromSubdomain = resolveTenantFromSubdomain(host);
    const fromHeader = header?.trim() || null;

    // If allowMismatch is false, validate that extracted tenant matches session
    if (!allowMismatch) {
      if (fromSubdomain && fromSubdomain !== sessionTenantId) {
        throw new Error(
          `Tenant mismatch: subdomain=${fromSubdomain}, session=${sessionTenantId}`
        );
      }
      if (fromHeader && fromHeader !== sessionTenantId) {
        throw new Error(
          `Tenant mismatch: header=${fromHeader}, session=${sessionTenantId}`
        );
      }
    }

    return { tenantId: sessionTenantId, source: 'user_profile' };
  }

  // Unauthenticated flow: extract from subdomain/header
  const fromSubdomain = resolveTenantFromSubdomain(host);
  if (fromSubdomain) {
    return { tenantId: fromSubdomain, source: 'subdomain' };
  }

  if (header && header.trim().length > 0) {
    return { tenantId: header.trim(), source: 'header' };
  }

  // If fallback is 'global' and !allowMismatch, throw error
  if (fallback === 'global' && !allowMismatch) {
    throw new Error('Tenant resolution failed: no valid tenant source and global fallback not allowed');
  }

  return { tenantId: fallback, source: 'default' };
}