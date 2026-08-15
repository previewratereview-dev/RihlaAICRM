import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformSuperAdmin } from '@/lib/auth/api-guard';
import { recordAuditEvent } from '@/lib/security/audit-log';

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
 * POST /api/platform/users/[id]/password-reset
 *
 * Super-admin only endpoint to initiate a password recovery flow for any platform user.
 * Tokens are never exposed to the client.
 */
export async function POST(
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

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 2. Authoritative target lookup
  const { data: targetProfile, error: fetchError } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, tenant_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !targetProfile || !targetProfile.email) {
    return NextResponse.json({ error: 'User not found or lacks email address' }, { status: 404 });
  }

  const host = request.headers.get('host') || 'localhost:3000';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  const redirectUrl = `${protocol}://${host}/login`;

  // 3. Initiate recovery link via Admin Client or standard reset
  const adminClient = createAdminClient();
  if (adminClient) {
    try {
      await adminClient.auth.admin.generateLink({
        type: 'recovery',
        email: targetProfile.email,
        options: {
          redirectTo: redirectUrl,
        },
      });
    } catch (authError) {
      console.warn('[PlatformUsers] Auth admin password reset link generation warning:', authError);
    }
  } else {
    // Session-client fallback for test/dev environments
    await supabase.auth.resetPasswordForEmail(targetProfile.email, {
      redirectTo: redirectUrl,
    });
  }

  // 4. Record Audit Event under 'global' (Never logging tokens or passwords)
  try {
    await recordAuditEvent(supabase, {
      actor: auth.authUserId,
      action: 'user.password_reset_initiated',
      target: id,
      tenantId: 'global',
      details: {
        targetUserEmail: targetProfile.email,
        targetUserName: targetProfile.full_name,
      },
    });
  } catch (auditError) {
    console.warn('[PlatformUsers] Audit log write warning:', auditError);
  }

  return NextResponse.json({
    success: true,
    message: `Password reset initiated for ${targetProfile.email}`,
  });
}
