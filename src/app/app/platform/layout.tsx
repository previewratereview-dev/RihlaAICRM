import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PlatformShell } from '@/components/platform/platform-shell';

/**
 * Server-side Platform Admin Layout Boundary (Phase P1A).
 *
 * Runs before any /app/platform/* child page renders and:
 *  1. Resolves the authenticated Supabase user.
 *  2. Verifies the user profile has role === 'super_admin'.
 *  3. Non-super_admin users are redirected to /app/dashboard (fail-closed).
 *  4. Renders the dedicated PlatformShell for authorized super admins.
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Local development fallback — if Supabase is not configured, permit rendering
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <PlatformShell>{children}</PlatformShell>;
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
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || profile.role !== 'super_admin') {
    redirect('/app/dashboard');
  }

  return <PlatformShell>{children}</PlatformShell>;
}
