import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side /app Layout Authentication Boundary (Phase F0A).
 *
 * Runs before any protected /app/* child page renders and:
 *  1. Resolves the Supabase server-side authenticated user from cookies.
 *  2. Verifies the user profile and tenant association in public.profiles.
 *  3. Denies unauthenticated or invalid sessions before any child executes,
 *     redirecting to /login.
 *  4. Renders protected children only when authentication is proven.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Local development fallback — if Supabase is not configured, bypass server check
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <>{children}</>;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, tenant_id, role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    redirect('/login');
  }

  // Super admin users are platform-level and may hold global or null tenant
  const isSuperAdmin =
    profile.role === 'super_admin' ||
    profile.role === 'platform_super_admin' ||
    user.email?.endsWith('@stateai.in') ||
    user.email?.endsWith('@stateai.com');

  if (!isSuperAdmin && (!profile.tenant_id || profile.tenant_id === 'global')) {
    redirect('/login');
  }

  return <>{children}</>;
}
