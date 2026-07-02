import { NextResponse, type NextRequest } from 'next/server';
import { getTenantContextFromRequest } from './context';

/**
 * Resolves the server-side `tenantId` for a Service_Role_Route (workflows, ai/copilot,
 * ai/embed, webhooks) and background/automation jobs.
 *
 * Service-role routes use the Supabase service role and therefore bypass RLS, so they MUST
 * apply an explicit, server-resolved tenant scope to every query (Requirement 8.4). The tenant
 * is resolved from the authenticated, server-validated session and is never trusted from the
 * client (Requirement 8.5). Any client-supplied tenant hint (subdomain or `x-tenant-id` header)
 * that disagrees with the session tenant is rejected as a mismatch, and a request that cannot be
 * associated with a resolved tenant is denied with an authorization error (Requirement 8.6).
 *
 * Returns the resolved `{ tenantId }` or a 403 {@link NextResponse} the caller should return
 * as-is.
 */
export function resolveServiceRouteTenant(
  request: NextRequest,
  sessionTenantId: string | null | undefined,
): { tenantId: string } | NextResponse {
  // No resolvable tenant from the session => deny (8.6).
  if (!sessionTenantId || !sessionTenantId.trim()) {
    return NextResponse.json({ error: 'Tenant context could not be resolved' }, { status: 403 });
  }

  try {
    const context = getTenantContextFromRequest({
      host: request.headers.get('host'),
      header: request.headers.get('x-tenant-id'),
      sessionTenantId,
      allowMismatch: false,
    });

    if (!context.tenantId || !context.tenantId.trim()) {
      return NextResponse.json({ error: 'Tenant context could not be resolved' }, { status: 403 });
    }

    return { tenantId: context.tenantId };
  } catch {
    // A client/session tenant mismatch (subdomain or header) is an authorization failure (8.5).
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }
}
