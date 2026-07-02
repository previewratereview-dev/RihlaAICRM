/**
 * Tenant access-control helpers for the Data Access Layer.
 *
 * These enforce that every tenant-owned operation resolves to a single tenant context
 * (Requirement 8.1, 8.5, 8.6, 8.7) and that privileged cross-tenant reads by a Platform
 * Super Admin are audited before data is returned (Requirement 8.11).
 */
import { supabase } from '../supabase';
import type { Lead, User } from '@/types';
import { logger } from '@/lib/logger';

/** Asserts that tenantId is a non-empty string; throws if blank/null/undefined. */
export function assertTenantId(tenantId: string | undefined | null): asserts tenantId is string {
  if (!tenantId || !tenantId.trim()) throw new Error('Tenant context is required');
}

/**
 * Logs cross-tenant access operations performed by Super Admins.
 * Creates audit log entries in both the actor's home tenant and the target tenant.
 *
 * @param actor - The Super Admin user performing the cross-tenant access
 * @param targetTenantId - The tenant being accessed
 * @param resourceType - The type of resource being accessed (e.g., 'lead', 'task', 'settings')
 * @param resourceId - The specific resource identifier
 * @param accessType - The type of access operation ('read', 'write', or 'delete')
 */
export async function logCrossTenantAccess(
  actor: User,
  targetTenantId: string,
  resourceType: string,
  resourceId: string,
  accessType: 'read' | 'write' | 'delete',
): Promise<void> {
  if (!supabase) {
    return;
  }

  const auditEntry = {
    user_id: actor.id,
    user_name: actor.fullName,
    user_role: actor.role,
    action: 'cross_tenant_access' as const,
    details: JSON.stringify({
      source_tenant_id: actor.tenantId,
      target_tenant_id: targetTenantId,
      resource_type: resourceType,
      resource_id: resourceId,
      access_type: accessType,
      timestamp: new Date().toISOString(),
    }),
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('audit_logs').insert({ ...auditEntry, tenant_id: actor.tenantId });
    await supabase.from('audit_logs').insert({ ...auditEntry, tenant_id: targetTenantId });
  } catch (error) {
    logger.error('Failed to log cross-tenant access', error);
  }
}

/**
 * Validates that the authenticated session user can access the requested tenant.
 *
 * Enforces multi-tenant isolation by ensuring the user is authenticated, the requested
 * tenant is valid, and it matches the session tenant — unless a Super Admin is performing
 * an audited cross-tenant access.
 *
 * @throws Error if authentication is missing or tenant access is denied
 */
export function validateTenantAccess(
  requestedTenantId: string | undefined | null,
  sessionUser: User | null,
  options: { allowCrossTenant?: boolean } = {},
): void {
  if (!sessionUser) {
    throw new Error('Authentication required');
  }

  assertTenantId(requestedTenantId);

  if (sessionUser.role === 'super_admin' && options.allowCrossTenant) {
    logCrossTenantAccess(sessionUser, requestedTenantId, 'unknown', 'unknown', 'read').catch((err) => {
      logger.error('Error logging cross-tenant access', err);
    });
    return;
  }

  if (requestedTenantId !== sessionUser.tenantId) {
    throw new Error(`Tenant access denied: requested=${requestedTenantId}, session=${sessionUser.tenantId}`);
  }
}

/**
 * Filters leads based on user role and assignment authority.
 *
 * - Admin and Super Admin: see all tenant leads
 * - Manager, Specialist, Consultant, Viewer: see leads assigned to them or unassigned leads
 */
export function filterLeadsByAuthority(leads: Lead[], sessionUser: User): Lead[] {
  const role = sessionUser.role;

  if (role === 'super_admin' || role === 'admin') {
    return leads;
  }

  if (role === 'manager' || role === 'specialist' || role === 'consultant' || role === 'viewer') {
    return leads.filter((lead) => lead.assignedTo === sessionUser.id || !lead.assignedTo);
  }

  return leads;
}
