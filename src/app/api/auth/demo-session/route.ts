import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * Phase F0B: Secure Server-Side Demo Session Bootstrap Endpoint
 *
 * Implements a server-only authentication path for "Try Rihla / Demo":
 * 1. Reads server-only credentials (DEMO_USER_EMAIL, DEMO_USER_PASSWORD, DEMO_TENANT_ID).
 * 2. Never accepts or processes client-supplied demo credentials.
 * 3. Authenticates against Supabase and sets session cookies via Supabase SSR.
 * 4. Authoritatively validates the authenticated user against `public.profiles`.
 * 5. Asserts the user belongs to `DEMO_TENANT_ID` and does NOT hold `super_admin` role.
 * 6. Fails closed and destroys the attempted session if any check fails.
 */
export async function POST(request: NextRequest) {
  // Reject requests attempting to supply client-side credentials
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body === 'object' && ('email' in body || 'password' in body)) {
      return NextResponse.json(
        { success: false, error: 'Client-supplied credentials are not permitted for demo bootstrap.' },
        { status: 400 }
      );
    }
  } catch {
    // Proceed with server configuration if body is empty or non-JSON
  }

  const demoEmail = process.env.DEMO_USER_EMAIL;
  const demoPassword = process.env.DEMO_USER_PASSWORD;
  const demoTenantId = process.env.DEMO_TENANT_ID;

  if (!demoEmail || !demoPassword || !demoTenantId) {
    logger.warn('[DemoSession] Server demo configuration is missing (DEMO_USER_EMAIL, DEMO_USER_PASSWORD, or DEMO_TENANT_ID).');
    return NextResponse.json(
      { success: false, error: 'Demo mode is not currently configured on the server.' },
      { status: 503 }
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: demoEmail,
    password: demoPassword,
  });

  if (authError || !authData.user) {
    logger.warn('[DemoSession] Failed to authenticate demo user.', { error: authError?.message });
    return NextResponse.json(
      { success: false, error: 'Demo authentication failed. Please try again later.' },
      { status: 401 }
    );
  }

  // Authoritative identity & tenant verification
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, full_name')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) {
    logger.error('[DemoSession] Demo user profile record not found in public.profiles.', { userId: authData.user.id });
    await supabase.auth.signOut();
    return NextResponse.json(
      { success: false, error: 'Demo profile could not be verified.' },
      { status: 403 }
    );
  }

  // Security guard: Demo account MUST NOT hold super-admin or platform privileges
  if (profile.role === 'super_admin' || profile.role === 'platform_super_admin') {
    logger.error('[DemoSession] Security violation: Demo user possesses super_admin role. Terminating session.', { userId: authData.user.id });
    await supabase.auth.signOut();
    return NextResponse.json(
      { success: false, error: 'Security violation: Demo account cannot hold administrative privileges.' },
      { status: 403 }
    );
  }

  // Tenant boundary verification
  if (profile.tenant_id !== demoTenantId) {
    logger.error('[DemoSession] Tenant mismatch for demo user.', { actualTenant: profile.tenant_id, expectedTenant: demoTenantId });
    await supabase.auth.signOut();
    return NextResponse.json(
      { success: false, error: 'Demo tenant configuration mismatch.' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    destination: '/app',
    user: {
      id: authData.user.id,
      email: authData.user.email,
      fullName: profile.full_name || 'Demo User',
      role: profile.role,
      tenantId: profile.tenant_id,
    },
  });
}
