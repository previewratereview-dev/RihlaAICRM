import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformSuperAdmin } from '@/lib/auth/api-guard';
import { recordAuditEvent } from '@/lib/security/audit-log';
import type { UserRole } from '@/types/common';

const VALID_ROLES = new Set<string>([
  'super_admin',
  'admin',
  'manager',
  'consultant',
  'specialist',
  'setter',
  'closer',
  'viewer',
]);

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

/**
 * PATCH /api/platform/users/[id]
 *
 * Super-admin only endpoint to update a user's role or details across any tenant.
 * Protects against self-demotion and demoting the last platform super admin.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request forbidden' }, { status: 403 });
  }

  // 1. Authorize super_admin
  const auth = await requirePlatformSuperAdmin(request, 'platform:users');
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { id } = await params;
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return NextResponse.json({ error: 'Invalid or missing user identifier' }, { status: 400 });
  }

  // 2. Parse & Validate Payload
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3. Authoritative target lookup
  const { data: targetProfile, error: fetchError } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, tenant_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !targetProfile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // 4. Role Change Protections
  if (typeof body.role === 'string') {
    const requestedRole = body.role.trim().toLowerCase();
    if (!VALID_ROLES.has(requestedRole)) {
      return NextResponse.json({ error: `Invalid role "${body.role}"` }, { status: 400 });
    }

    // Check if modifying a super_admin role
    if (targetProfile.role === 'super_admin' && requestedRole !== 'super_admin') {
      // Protection 1: Self-demotion denied
      if (id === auth.authUserId) {
        return NextResponse.json({ error: 'Self-demotion is not permitted' }, { status: 400 });
      }

      // Protection 2: Last super admin protection
      const { count, error: countError } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'super_admin');

      if (countError || (count ?? 0) <= 1) {
        return NextResponse.json({ error: 'Cannot demote the last remaining platform super admin' }, { status: 409 });
      }
    }

    updatePayload.role = requestedRole as UserRole;
  }

  if (typeof body.fullName === 'string' && body.fullName.trim().length >= 2) {
    updatePayload.full_name = body.fullName.trim();
  }
  if (typeof body.phone === 'string') {
    updatePayload.phone = body.phone.trim() || null;
  }

  // 5. Update Profile Record
  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single();

  if (updateError || !updatedProfile) {
    return NextResponse.json({ error: `Failed to update user: ${updateError?.message || 'Unknown database error'}` }, { status: 500 });
  }

  // 6. Record Audit Event under 'global'
  try {
    await recordAuditEvent(supabase, {
      actor: auth.authUserId,
      action: 'user.updated',
      target: id,
      tenantId: 'global',
      details: {
        previousRole: targetProfile.role,
        newRole: updatedProfile.role,
        updatedFields: Object.keys(updatePayload),
      },
    });
  } catch (auditError) {
    console.warn('[PlatformUsers] Audit log write warning:', auditError);
  }

  return NextResponse.json({
    success: true,
    user: {
      id: updatedProfile.id,
      email: updatedProfile.email,
      fullName: updatedProfile.full_name,
      role: updatedProfile.role,
      tenantId: updatedProfile.tenant_id,
      updatedAt: updatedProfile.updated_at,
    },
  });
}

/**
 * DELETE /api/platform/users/[id]
 *
 * Super-admin only endpoint to delete a user profile and auth account.
 * Protects against self-deletion and deleting the last platform super admin.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request forbidden' }, { status: 403 });
  }

  // 1. Authorize super_admin
  const auth = await requirePlatformSuperAdmin(request, 'platform:users');
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { id } = await params;
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return NextResponse.json({ error: 'Invalid or missing user identifier' }, { status: 400 });
  }

  // 2. Protection: Self-deletion denied
  if (id === auth.authUserId) {
    return NextResponse.json({ error: 'Self-deletion is not permitted' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3. Authoritative target lookup
  const { data: targetProfile, error: fetchError } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, tenant_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !targetProfile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // 4. Protection: Last super admin deletion denied
  if (targetProfile.role === 'super_admin') {
    const { count, error: countError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'super_admin');

    if (countError || (count ?? 0) <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last remaining platform super admin' }, { status: 409 });
    }
  }

  // 5. Delete Profile record
  const { error: profileDeleteError } = await supabase
    .from('profiles')
    .delete()
    .eq('id', id);

  if (profileDeleteError) {
    return NextResponse.json({ error: `Failed to delete profile: ${profileDeleteError.message}` }, { status: 500 });
  }

  // 6. Delete Auth User if admin client configured
  const adminClient = createAdminClient();
  if (adminClient) {
    try {
      await adminClient.auth.admin.deleteUser(id);
    } catch (authError) {
      console.warn('[PlatformUsers] Auth admin user delete warning:', authError);
    }
  }

  // 7. Record Audit Event under 'global'
  try {
    await recordAuditEvent(supabase, {
      actor: auth.authUserId,
      action: 'user.deleted',
      target: id,
      tenantId: 'global',
      details: {
        deletedUserEmail: targetProfile.email,
        deletedUserName: targetProfile.full_name,
        deletedUserRole: targetProfile.role,
      },
    });
  } catch (auditError) {
    console.warn('[PlatformUsers] Audit log write warning:', auditError);
  }

  return NextResponse.json({
    success: true,
    deletedId: id,
  });
}
