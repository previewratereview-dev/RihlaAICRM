'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, UserRole } from '@/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

const LEGACY_ROLE_MAP: Record<string, UserRole> = {
  setter: 'specialist',
  closer: 'specialist',
  member: 'viewer',
};

function normaliseRole(raw: string): UserRole {
  return (LEGACY_ROLE_MAP[raw] ?? raw) as UserRole;
}

/**
 * Error shown when an authenticated session has no agency association. The
 * tenant is derived strictly from the persisted profile and is never defaulted
 * to the legacy `global` tenant. (Requirement 1.9)
 */
const NO_TENANT_ERROR =
  'Your account is not associated with an agency. Please contact your administrator.';

/**
 * Resolve the tenant id from the persisted profile record. Returns null when no
 * usable tenant is present — a missing tenant must surface as an error rather
 * than being silently defaulted to `global`. (Requirement 1.9)
 */
function resolveTenantId(profile: Record<string, unknown> | null | undefined): string | null {
  const raw = (profile?.tenant_id as string) ?? '';
  if (!raw || raw === 'global') return null;
  return raw;
}

function mapSupabaseUser(raw: Record<string, unknown>): User {
  const userMeta = raw.user_metadata as Record<string, unknown> | undefined;
  return {
    id: raw.id as string,
    email: raw.email as string,
    fullName: (raw.full_name as string) || (userMeta?.full_name as string) || (raw.email as string)?.split('@')[0] || 'User',
    role: normaliseRole(((userMeta?.role as string) || (raw.role as string) || 'viewer')),
    // Tenant is derived from the persisted profile (passed in via user_metadata)
    // and is validated by the caller before this maps to a usable session. (1.9)
    tenantId: (raw.tenant_id as string) || (userMeta?.tenant_id as string) || '',
    avatarUrl: (raw.avatar_url as string) || (userMeta?.avatar_url as string) || '',
    isOnline: true,
  };
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  const supabase = createClient();

  const loadSession = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    // Local Mode — no Supabase session to restore; require fresh login
    const isLocalMode = !process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (isLocalMode) {
      setState({ user: null, loading: false, error: null });
      return;
    }

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setState({ user: null, loading: false, error: null });
      } else {
        const sessionUser = data.session.user;
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', sessionUser.id)
          .single();

        if (profileError) {
          setState({ user: null, loading: false, error: profileError.message });
          return;
        }
        // Derive the tenant strictly from the persisted profile; a missing
        // tenant is an error, never defaulted to `global`. (1.9)
        if (!resolveTenantId(profile)) {
          setState({ user: null, loading: false, error: NO_TENANT_ERROR });
          return;
        }
        setState({ user: mapSupabaseUser({ ...sessionUser, user_metadata: profile } as Record<string, unknown>), loading: false, error: null });
      }
    } catch (e: unknown) {
      setState({ user: null, loading: false, error: (e instanceof Error ? e.message : 'Session restore failed') });
    }
  }, [supabase]);

  const login = useCallback(
    async (email: string, password: string) => {
      setState((s) => ({ ...s, loading: true, error: null }));

      // Local Mode fallback — localStorage-based mock auth
      const isLocalMode = !process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (isLocalMode) {
        try {
          const team: User[] =
            typeof window !== 'undefined'
              ? JSON.parse(localStorage.getItem('crm_team') || '[]')
              : [];

          let matchedMember: User | undefined = team.find(
            (m: User) => m.email.toLowerCase() === email.toLowerCase()
          );

          // No hardcoded seed accounts — all users must be provisioned
          // through Supabase Auth or the invitation flow.

          if (!matchedMember) {
            const msg = 'Invalid credentials. Check your email or password.';
            setState((p) => ({ ...p, loading: false, error: msg }));
            return { success: false, error: msg };
          }

          if (matchedMember.status === 'deactivated') {
            const msg = 'Your account has been deactivated.';
            setState((p) => ({ ...p, loading: false, error: msg }));
            return { success: false, error: msg };
          }

          const seedPassword = process.env.NEXT_PUBLIC_SEED_PASSWORD;
          if (!seedPassword) {
            const msg = 'Seed password not configured. Set NEXT_PUBLIC_SEED_PASSWORD in .env.local';
            setState((p) => ({ ...p, loading: false, error: msg }));
            return { success: false, error: msg };
          }
          const expectedPassword = seedPassword;

          if (password !== expectedPassword) {
            const msg = 'Invalid credentials. Check your email or password.';
            setState((p) => ({ ...p, loading: false, error: msg }));
            return { success: false, error: msg };
          }

          const user: User = { ...matchedMember, isOnline: true };
          setState({ user, loading: false, error: null });
          return { success: true, error: null, user };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Login failed';
          setState((p) => ({ ...p, loading: false, error: msg }));
          return { success: false, error: msg };
        }
      }

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error || !data.user) {
          const message = error?.message || 'Invalid credentials.';
          setState((p) => ({ ...p, loading: false, error: message }));
          return { success: false, error: message };
        }

        let profileData = null;
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (profileError || !profile) {
          // The profile is the authoritative source of tenant membership; it is
          // created by provisioning (provision_agency) or the invitation flow,
          // never fabricated client-side with a `global` tenant. A missing
          // profile is therefore a hard error rather than a silent default. (1.9)
          const message = profileError?.message
            || 'Your account is not fully set up yet. Please contact your administrator.';
          setState((p) => ({ ...p, loading: false, error: message }));
          return { success: false, error: message };
        }

        // Derive the tenant strictly from the persisted profile; reject a
        // missing/`global` tenant instead of defaulting. (1.9)
        // Exception: super_admin users are platform-level and don't belong to any tenant.
        const profileRole = normaliseRole(((profile.role as string) || 'viewer'));
        if (profileRole !== 'super_admin' && !resolveTenantId(profile)) {
          setState((p) => ({ ...p, loading: false, error: NO_TENANT_ERROR }));
          return { success: false, error: NO_TENANT_ERROR };
        }
        profileData = profile;

        // IMPORTANT: Pass profile role explicitly to avoid being overridden by
        // data.user.role which is the Supabase JWT role ("authenticated").
        const user = mapSupabaseUser({
          ...data.user,
          user_metadata: profileData,
          role: profile.role,
        } as Record<string, unknown>);
        setState({ user, loading: false, error: null });
        return { success: true, error: null, user };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Login failed';
        setState((p) => ({ ...p, loading: false, error: message }));
        return { success: false, error: message };
      }
    },
    [supabase]
  );

  const logout = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    // Local Mode — just clear state, no Supabase session to sign out
    const isLocalMode = !process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (isLocalMode) {
      setState({ user: null, loading: false, error: null });
      return;
    }

    try {
      await supabase.auth.signOut();
      setState({ user: null, loading: false, error: null });
    } catch (e: unknown) {
      setState((p) => ({ ...p, loading: false, error: e instanceof Error ? e.message : 'Logout failed' }));
    }
  }, [supabase]);

  useEffect(() => {
    loadSession();

    // In Local Mode there is no Supabase session — skip subscription
    const isLocalMode = !process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (isLocalMode) return;

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        setState({ user: null, loading: false, error: null });
        return;
      }

      let profileData = null;
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (profileError || !profile) {
        // No client-side profile fabrication: a missing profile is an error,
        // never a silently created `global`-tenant profile. (1.9)
        setState({
          user: null,
          loading: false,
          error: profileError?.message
            || 'Your account is not fully set up yet. Please contact your administrator.',
        });
        return;
      }

      // Derive the tenant strictly from the persisted profile. (1.9)
      if (!resolveTenantId(profile)) {
        setState({ user: null, loading: false, error: NO_TENANT_ERROR });
        return;
      }
      profileData = profile;

      setState({ user: mapSupabaseUser({ ...session.user, user_metadata: profileData } as Record<string, unknown>), loading: false, error: null });
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, [loadSession, supabase]);

  return useMemo(() => ({
    user: state.user,
    loading: state.loading,
    error: state.error,
    login,
    logout,
    loadSession,
    isAuthenticated: !!state.user,
  }), [state.user, state.loading, state.error, login, logout, loadSession]);
}