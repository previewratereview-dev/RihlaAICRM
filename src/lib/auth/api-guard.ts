import 'server-only';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { isPlatformSuperAdmin } from '@/lib/platform/service';
import type { UserRole, Permission } from '@/types/common';
import { NextResponse, type NextRequest } from 'next/server';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  tenantId: string;
  avatarUrl: string;
}

export type AuthResult = { user: SessionUser; tenantId: string };

/**
 * The set of platform-level capabilities reserved for the Platform_Super_Admin.
 *
 * These are operations on the platform itself, not on any single tenant:
 * managing / suspending / deleting Agencies, platform billing and analytics,
 * feature flags, system health, and platform settings. Authority over every
 * one of these is identical — the request is authorized if and only if the
 * requester is a Platform_Super_Admin — so the capability is accepted purely
 * for documentation and audit clarity at the call site. (Requirement 2.3)
 */
export type PlatformCapability =
  | 'agencies:manage'
  | 'agencies:suspend'
  | 'agencies:delete'
  | 'platform:billing'
  | 'platform:analytics'
  | 'platform:feature-flags'
  | 'platform:system-health'
  | 'platform:settings';

/**
 * Result of a successful platform-capability authorization. A Platform_Super_Admin
 * holds no tenant membership, so this intentionally carries no `tenantId`. (2.1, 2.9)
 */
export type PlatformAuthResult = { authUserId: string; email: string };

const LEGACY_ROLE_MAP: Record<string, UserRole> = {
  setter: 'specialist',
  closer: 'specialist',
  member: 'viewer',
};

function normaliseRole(raw: string): UserRole {
  return (LEGACY_ROLE_MAP[raw] ?? raw) as UserRole;
}

/**
 * Validates the JWT session and returns the SessionUser + tenantId.
 * The SessionUser object includes full profile information (id, email, fullName, role, tenantId)
 * for use with database service tenant validation.
 * Returns a 401 NextResponse if unauthenticated.
 */
export async function requireAuth(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _request: NextRequest
): Promise<AuthResult | NextResponse> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Profile lookup
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, tenant_id, full_name, email, avatar_url')
    .eq('id', user.id)
    .single();

  // Requirement 1.9: the tenant is derived strictly from the persisted profile
  // and a missing tenant is an authorization error — it is NEVER defaulted to
  // the legacy literal `global`. The legacy `global` value is likewise not a
  // resolvable tenant for authorization, so it is rejected here.
  if (!profile?.tenant_id || profile.tenant_id === 'global') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = normaliseRole(profile.role || 'viewer');
  const fullName = profile.full_name || profile.email || user.email || 'Unknown User';

  return {
    user: { 
      id: user.id, 
      email: user.email ?? profile.email ?? '', 
      fullName,
      role,
      tenantId: profile.tenant_id,
      avatarUrl: profile.avatar_url || ''
    },
    tenantId: profile.tenant_id,
  };
}

/**
 * Calls requireAuth then checks can(role, permission).
 * Returns a 403 NextResponse if the user lacks the permission.
 */
export async function requirePermission(
  request: NextRequest,
  permission: Permission
): Promise<AuthResult | NextResponse> {
  const result = await requireAuth(request);
  if (result instanceof NextResponse) return result;

  if (!can(result.user.role, permission)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return result;
}

/**
 * Authorizes a platform-level capability for the current request.
 *
 * Platform capabilities — managing, suspending, or deleting Agencies; platform
 * billing; platform analytics; feature flags; system health; platform settings —
 * are authorized **only** when the requester is a Platform_Super_Admin, resolved
 * from the platform identity record (`platform_admins`) via
 * {@link isPlatformSuperAdmin}, never from a tenant-scoped `profiles.role`. (2.2, 2.3)
 *
 * This path deliberately does not go through {@link requireAuth}: a
 * Platform_Super_Admin holds no tenant membership (and therefore no
 * `profiles.tenant_id`), and is authenticated through a session independent of
 * any tenant. (2.1, 2.9) It authenticates the session, then performs the
 * platform-identity check.
 *
 * Authorization is a pure read — it commits no writes — so a denied request
 * produces no state change and returns a 403 authorization error. A
 * Tenant-scoped User (authenticated but absent from `platform_admins`) is denied
 * exactly as an unauthenticated requester is, beyond the initial 401. (2.4, 3.6)
 *
 * @param capability the platform capability being requested; accepted for
 *   call-site clarity and auditability. The authorization decision is the same
 *   for every platform capability, so it does not alter the outcome.
 */
export async function requirePlatformSuperAdmin(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _request: NextRequest,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _capability?: PlatformCapability
): Promise<PlatformAuthResult | NextResponse> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve platform authority strictly from the platform identity record.
  // Any authenticated-but-non-platform requester (i.e. a tenant-scoped user) is
  // denied here with no state change. (2.3, 2.4, 3.6)
  const isPlatform = await isPlatformSuperAdmin(user.id);
  if (!isPlatform) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { authUserId: user.id, email: user.email ?? '' };
}
