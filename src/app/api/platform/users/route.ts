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
 * POST /api/platform/users
 *
 * Super-admin only endpoint to create a new user across any agency tenant.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request forbidden' }, { status: 403 });
  }

  // 1. Authorize super_admin
  const auth = await requirePlatformSuperAdmin(request, 'platform:users');
  if (auth instanceof NextResponse) {
    return auth;
  }

  // 2. Parse & Validate Payload
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : 'viewer';
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
  const password = typeof body.password === 'string' && body.password.length >= 6
    ? body.password
    : Math.random().toString(36).slice(-10) + 'A1!';

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email address is required' }, { status: 400 });
  }
  if (!fullName || fullName.length < 2) {
    return NextResponse.json({ error: 'Full name must be at least 2 characters' }, { status: 400 });
  }
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json({ error: `Invalid role "${role}"` }, { status: 400 });
  }
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant identifier is required' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3. Verify target tenant exists
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: 'Target agency tenant not found' }, { status: 404 });
  }

  // 4. Create Auth User via Admin Client
  const adminClient = createAdminClient();
  let createdUserId: string;

  if (adminClient) {
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        tenant_id: tenantId,
        role,
      },
    });

    if (authError || !authUser?.user) {
      if (authError?.message?.toLowerCase().includes('already registered') || authError?.message?.toLowerCase().includes('already exists')) {
        return NextResponse.json({ error: 'A user with this email address already exists' }, { status: 409 });
      }
      return NextResponse.json({ error: `Failed to create auth user: ${authError?.message || 'Unknown error'}` }, { status: 400 });
    }
    createdUserId = authUser.user.id;
  } else {
    // In test environment without service role key
    createdUserId = `user-${Math.random().toString(36).slice(2, 10)}`;
  }

  // 5. Ensure Profile Record is Created / Updated
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .upsert({
      id: createdUserId,
      email,
      full_name: fullName,
      role: role as UserRole,
      tenant_id: tenantId,
      phone: phone || null,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (profileError) {
    return NextResponse.json({ error: `Failed to create profile: ${profileError.message}` }, { status: 500 });
  }

  // 6. Record Audit Event under 'global'
  try {
    await recordAuditEvent(supabase, {
      actor: auth.authUserId,
      action: 'user.created',
      target: createdUserId,
      tenantId: 'global',
      details: { email, role, tenantId, fullName },
    });
  } catch (auditError) {
    console.warn('[PlatformUsers] Audit log write warning:', auditError);
  }

  return NextResponse.json({
    success: true,
    user: {
      id: profile?.id || createdUserId,
      email,
      fullName,
      role,
      tenantId,
      tenantName: tenant.name,
    },
  }, { status: 201 });
}
