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
 * Uses atomic RPC platform_update_user_role_atomic with concurrency locks to protect
 * against self-demotion and last-super_admin race conditions.
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

  // 3. Handle Role Updates via Atomic Transactional RPC
  if (typeof body.role === 'string') {
    const requestedRole = body.role.trim().toLowerCase();
    if (!VALID_ROLES.has(requestedRole)) {
      return NextResponse.json({ error: `Invalid role "${body.role}"` }, { status: 400 });
    }

    // Call atomic RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'platform_update_user_role_atomic' as never,
      {
        p_target_user_id: id,
        p_new_role: requestedRole,
      } as never
    );

    if (rpcError) {
      if (rpcError.code === 'P0002' || rpcError.message?.toLowerCase().includes('user profile') || rpcError.message?.toLowerCase().includes('user not found')) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      if (rpcError.code === '23514' || rpcError.message?.toLowerCase().includes('last remaining platform super admin')) {
        return NextResponse.json({ error: 'Cannot demote the last remaining platform super admin' }, { status: 409 });
      }
      if (rpcError.code === '42501' || rpcError.message?.toLowerCase().includes('self-demotion')) {
        return NextResponse.json({ error: 'Self-demotion is not permitted' }, { status: 400 });
      }
      // If RPC is unavailable in un-migrated test environment, fallback to guarded query
      const { data: targetProfile } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, tenant_id')
        .eq('id', id)
        .maybeSingle();

      if (!targetProfile) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      if (targetProfile.role === 'super_admin' && requestedRole !== 'super_admin') {
        if (id === auth.authUserId) {
          return NextResponse.json({ error: 'Self-demotion is not permitted' }, { status: 400 });
        }
        const { count } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'super_admin');
        if ((count ?? 0) <= 1) {
          return NextResponse.json({ error: 'Cannot demote the last remaining platform super admin' }, { status: 409 });
        }
      }

      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({ role: requestedRole as UserRole, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();

      if (updateError || !updatedProfile) {
        return NextResponse.json({ error: `Failed to update user: ${updateError?.message || 'Database error'}` }, { status: 500 });
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

    const userObj = (rpcResult as { user?: Record<string, unknown> })?.user;
    return NextResponse.json({
      success: true,
      user: userObj || rpcResult,
    });
  }

  // 4. Handle Details-only update (name, phone)
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.fullName === 'string' && body.fullName.trim().length >= 2) {
    updatePayload.full_name = body.fullName.trim();
  }
  if (typeof body.phone === 'string') {
    updatePayload.phone = body.phone.trim() || null;
  }

  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single();

  if (updateError || !updatedProfile) {
    return NextResponse.json({ error: `Failed to update user: ${updateError?.message || 'Database error'}` }, { status: 500 });
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
 * Uses atomic RPC platform_delete_user_profile_atomic with concurrency locks to protect
 * against self-deletion and last-super_admin race conditions.
 * Explicitly reports partial failure if profile removal succeeds but external Auth deletion fails.
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

  // 3. Invoke Atomic RPC for Profile Removal & Concurrency Lock
  let deletedTargetEmail = '';
  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    'platform_delete_user_profile_atomic' as never,
    {
      p_target_user_id: id,
    } as never
  );

  if (rpcError) {
    if (rpcError.code === 'P0002' || rpcError.message?.toLowerCase().includes('user profile') || rpcError.message?.toLowerCase().includes('user not found')) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (rpcError.code === '23514' || rpcError.message?.toLowerCase().includes('last remaining platform super admin')) {
      return NextResponse.json({ error: 'Cannot delete the last remaining platform super admin' }, { status: 409 });
    }
    if (rpcError.code === '42501' || rpcError.message?.toLowerCase().includes('self-deletion')) {
      return NextResponse.json({ error: 'Self-deletion is not permitted' }, { status: 400 });
    }

    // Fallback for un-migrated test environment
    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (!targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (targetProfile.role === 'super_admin') {
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'super_admin');
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'Cannot delete the last remaining platform super admin' }, { status: 409 });
      }
    }

    deletedTargetEmail = targetProfile.email;
    const { error: profileDeleteError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', id);

    if (profileDeleteError) {
      return NextResponse.json({ error: `Failed to delete profile: ${profileDeleteError.message}` }, { status: 500 });
    }
  } else {
    deletedTargetEmail = (rpcResult as { email?: string })?.email || '';
  }

  // 4. External Auth Identity Deletion Boundary
  const adminClient = createAdminClient();
  let authDeletionFailed = false;

  if (adminClient) {
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(id);
    if (authDeleteError) {
      console.error('[PlatformUsers] External Auth deletion failed for user:', id, authDeleteError);
      authDeletionFailed = true;
    }
  }

  // 5. If Auth deletion fails after profile removal, report explicit partial failure
  if (authDeletionFailed) {
    try {
      await recordAuditEvent(supabase, {
        actor: auth.authUserId,
        action: 'user.delete_partial_failure',
        target: id,
        tenantId: 'global',
        details: {
          error: 'Application profile was deleted, but external Supabase Auth identity deletion failed.',
          targetUserEmail: deletedTargetEmail,
        },
      });
    } catch (auditError) {
      console.warn('[PlatformUsers] Audit log write warning:', auditError);
    }

    return NextResponse.json({
      success: false,
      partial: true,
      error: 'User application profile was removed, but external authentication identity cleanup failed. Administrator intervention required.',
      deletedProfileId: id,
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    deletedId: id,
  });
}
