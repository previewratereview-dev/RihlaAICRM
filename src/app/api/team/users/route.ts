import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { can } from '@/lib/permissions';

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Validates the Bearer token from the Authorization header using the service
 * role client (which can verify JWTs without needing cookies).
 */
async function getCallerFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token) return null;

  const admin = getAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('role, tenant_id, full_name, email')
    .eq('id', user.id)
    .single();

  if (!profile?.tenant_id || profile.tenant_id === 'global') return null;

  return {
    id: user.id,
    email: user.email ?? profile.email ?? '',
    role: (profile.role as string) ?? 'viewer',
    tenantId: profile.tenant_id as string,
  };
}

/**
 * POST /api/team/users
 * Creates a new team member (auth user + profile) using the Supabase service role.
 * Only agency admins with settings:users:write permission may call this.
 */
export async function POST(request: NextRequest) {
  const caller = await getCallerFromToken(request);
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!can(caller.role, 'settings:users:write')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { fullName, email, role, phone, password } = body as {
    fullName?: string;
    email?: string;
    role?: string;
    phone?: string;
    password?: string;
  };

  if (!fullName || !email || !password) {
    return NextResponse.json({ error: 'fullName, email and password are required.' }, { status: 400 });
  }

  const admin = getAdminClient();

  // Create the auth user (email_confirm: true so they can log in immediately)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role: role ?? 'specialist',
      tenant_id: caller.tenantId,
    },
  });

  if (authError || !authData?.user) {
    console.error('[POST /api/team/users] Auth user creation failed:', authError);
    return NextResponse.json(
      { error: authError?.message ?? 'Failed to create user.' },
      { status: 400 }
    );
  }

  // Upsert the profile row (an auto-trigger may have already created it)
  const { error: profileError } = await admin.from('profiles').upsert({
    id: authData.user.id,
    tenant_id: caller.tenantId,
    email,
    full_name: fullName,
    role: role ?? 'specialist',
    phone: phone ?? null,
    is_online: false,
  });

  if (profileError) {
    // Roll back — delete the auth user we just created
    await admin.auth.admin.deleteUser(authData.user.id);
    console.error('[POST /api/team/users] Profile upsert failed:', profileError);
    return NextResponse.json(
      { error: profileError.message ?? 'Failed to create user profile.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: authData.user.id }, { status: 201 });
}

/**
 * DELETE /api/team/users?id=<userId>
 * Deletes a team member's auth user and profile.
 */
export async function DELETE(request: NextRequest) {
  const caller = await getCallerFromToken(request);
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!can(caller.role, 'settings:users:write')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('id');

  if (!userId) {
    return NextResponse.json({ error: 'Missing user id.' }, { status: 400 });
  }

  if (userId === caller.id) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
  }

  const admin = getAdminClient();

  // Verify the target user belongs to the caller's tenant
  const { data: profile } = await admin
    .from('profiles')
    .select('tenant_id')
    .eq('id', userId)
    .single();

  if (!profile || profile.tenant_id !== caller.tenantId) {
    return NextResponse.json({ error: 'User not found in your agency.' }, { status: 404 });
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
