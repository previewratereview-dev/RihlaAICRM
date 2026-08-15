import 'server-only';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
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

const VALID_ROLES = new Set<UserRole>([
  'super_admin',
  'admin',
  'manager',
  'specialist',
  'setter',
  'closer',
  'consultant',
  'viewer',
]);

const LEGACY_ROLE_MAP: Record<string, UserRole> = {
  setter: 'specialist',
  closer: 'specialist',
  member: 'viewer',
};

function normaliseRole(raw: string): UserRole {
  const mapped = LEGACY_ROLE_MAP[raw] ?? raw;
  return VALID_ROLES.has(mapped as UserRole) ? (mapped as UserRole) : 'viewer';
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

  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user) {
    console.error(`[requireAuth] 401 Unauthorized: No authenticated Supabase session. Error:`, error?.message);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Profile lookup
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, tenant_id, full_name, email, avatar_url')
    .eq('id', user.id)
    .single();

  const role = normaliseRole(profile?.role || 'viewer');
  const tenantId = profile?.tenant_id || 'global';

  const fullName = profile?.full_name || profile?.email || user.email || 'Unknown User';

  return {
    user: { 
      id: user.id, 
      email: user.email ?? profile?.email ?? '', 
      fullName,
      role,
      tenantId,
      avatarUrl: profile?.avatar_url || ''
    },
    tenantId,
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
 * are authorized **only** when the requester is a Super Admin holding the
 * persisted profile role `super_admin` in `public.profiles`.
 */
export async function requirePlatformSuperAdmin(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _request: NextRequest,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _capability?: PlatformCapability
): Promise<PlatformAuthResult | NextResponse> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { authUserId: user.id, email: user.email ?? '' };
}
