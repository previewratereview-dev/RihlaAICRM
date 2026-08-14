import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * Phase F0B: Secure Server-Side Demo Session Bootstrap Endpoint
 *
 * Implements a server-only authentication path for "Try Rihla / Demo":
 * 1. Rejects client-supplied demo credentials.
 * 2. Inspects existing session:
 *    - If already authenticated as the verified demo user, reuses the session safely.
 *    - If authenticated as a real user, rejects with 409 DEMO_REQUIRES_SIGN_OUT without overwriting.
 * 3. If unauthenticated, authenticates against server-only demo credentials.
 * 4. Authoritatively validates identity against `public.profiles` (asserts tenant match, asserts NOT super_admin).
 * 5. Uses local-scoped signOut (`{ scope: 'local' }`) on verification failures to protect other concurrent demo visitors.
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

  // 1. Inspect existing session before establishing a demo session
  const { data: existingSessionData } = await supabase.auth.getUser();
  const existingUser = existingSessionData?.user;

  if (existingUser) {
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, tenant_id, role, full_name')
      .eq('id', existingUser.id)
      .single();

    const isAlreadyDemoUser =
      existingUser.email?.toLowerCase() === demoEmail.toLowerCase() &&
      existingProfile?.tenant_id === demoTenantId &&
      existingProfile?.role !== 'super_admin';

    if (isAlreadyDemoUser && existingProfile) {
      return NextResponse.json({
        success: true,
        destination: '/app',
        user: {
          id: existingUser.id,
          email: existingUser.email,
          fullName: existingProfile.full_name || 'Demo User',
          role: existingProfile.role,
          tenantId: existingProfile.tenant_id,
        },
      });
    }

    // Existing session belongs to a real user — fail closed, do not overwrite or sign out
    logger.warn('[DemoSession] Blocked demo bootstrap: active real user session present.', { userId: existingUser.id });
    return NextResponse.json(
      {
        success: false,
        code: 'DEMO_REQUIRES_SIGN_OUT',
        error: 'An active user session is already signed in. Please sign out of your account before starting the public demo.',
      },
      { status: 409 }
    );
  }

  // 2. Unauthenticated visitor — authenticate demo credentials
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

  // 3. Authoritative identity & tenant verification
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, full_name')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) {
    logger.error('[DemoSession] Demo user profile record not found in public.profiles.', { userId: authData.user.id });
    await supabase.auth.signOut({ scope: 'local' });
    return NextResponse.json(
      { success: false, error: 'Demo profile could not be verified.' },
      { status: 403 }
    );
  }

  // Security guard: Demo account MUST NOT hold super-admin permissions
  if (profile.role === 'super_admin') {
    logger.error('[DemoSession] Security violation: Demo user possesses super_admin role. Terminating session.', { userId: authData.user.id });
    await supabase.auth.signOut({ scope: 'local' });
    return NextResponse.json(
      { success: false, error: 'Security violation: Demo account cannot hold administrative privileges.' },
      { status: 403 }
    );
  }

  // Tenant boundary verification
  if (profile.tenant_id !== demoTenantId) {
    logger.error('[DemoSession] Tenant mismatch for demo user.', { actualTenant: profile.tenant_id, expectedTenant: demoTenantId });
    await supabase.auth.signOut({ scope: 'local' });
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
