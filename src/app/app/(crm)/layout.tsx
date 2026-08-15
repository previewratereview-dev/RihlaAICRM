import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side Agency CRM Layout Boundary (Phase P1A).
 *
 * Runs before any /app/(crm)/* child page renders and:
 *  1. Resolves the authenticated Supabase user.
 *  2. If the user has role === 'super_admin', server redirects to /app/platform/dashboard
 *     enforcing two-way isolation (Platform Admin is not a CRM user).
 *  3. Otherwise allows the agency CRM user to proceed to the CRM view.
 */
export default async function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profileError && profile?.role === 'super_admin') {
    redirect('/app/platform/dashboard');
  }

  return <>{children}</>;
}
