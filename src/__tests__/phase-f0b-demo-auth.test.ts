// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { useCRMStore } from '@/hooks/use-crm-store';
import { useNotificationStore } from '@/hooks/use-notification-store';
import type { Lead } from '@/types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase F0B: Secure Try Rihla / Demo Authentication Tests
 *
 * Covers:
 * A. Client source code scan: zero hardcoded demo credentials or plaintext passwords.
 * B. Client cannot submit arbitrary credentials to /api/auth/demo-session (400 Bad Request).
 * C. Missing server demo environment variables fail closed (503 Service Unavailable).
 * D. Invalid demo credentials fail closed (401 Unauthorized).
 * E. Missing demo user profile fails closed and terminates session using local scope (403 Forbidden).
 * F. Demo account with super_admin role fails closed and terminates session using local scope (403 Forbidden).
 * G. Demo account with mismatched tenant fails closed and terminates session using local scope (403 Forbidden).
 * H. Successful demo bootstrap for unauthenticated visitor returns destination /app, valid user, and tenant.
 * I. Existing verified demo session is safely reused without re-authenticating.
 * J. Existing REAL authenticated user session is NOT overwritten (409 Conflict with DEMO_REQUIRES_SIGN_OUT).
 * K. Rejected bootstrap leaves real user session intact (signOut is NOT called).
 * L. Demo exit/cleanup executes local-scoped logout and completely purges store & notifications.
 * M. F0A /app server boundary continues to reject unauthenticated requests.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

describe('Phase F0B: Secure Demo Authentication & Session Safety', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    useCRMStore.getState().resetSessionState();
    useNotificationStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  // A. Static code verification
  it('A. Client source code does not contain hardcoded demo passwords or credentials', () => {
    const registerClientFile = path.join(process.cwd(), 'src/app/register/client-page.tsx');
    const authSliceFile = path.join(process.cwd(), 'src/hooks/store/auth-slice.ts');

    const registerContent = fs.readFileSync(registerClientFile, 'utf-8');
    const authSliceContent = fs.readFileSync(authSliceFile, 'utf-8');

    // No hardcoded passwords or hardcoded demo login calls
    expect(registerContent).not.toMatch(/login\(['"]demo@/);
    expect(registerContent).not.toMatch(/Test@123/);
    expect(authSliceContent).not.toMatch(/demo@stateai\.in/);
  });

  // B. Reject client-supplied credentials
  it('B. Client cannot submit arbitrary demo email/password to demo-session endpoint', async () => {
    const { POST } = await import('@/app/api/auth/demo-session/route');

    const req = new NextRequest('http://localhost:3000/api/auth/demo-session', {
      method: 'POST',
      body: JSON.stringify({ email: 'attacker@evil.com', password: 'malicious-password' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/Client-supplied credentials are not permitted/i);
  });

  // C. Fail closed on missing server config
  it('C. Missing server demo configuration fails closed with 503', async () => {
    delete process.env.DEMO_USER_EMAIL;
    delete process.env.DEMO_USER_PASSWORD;
    delete process.env.DEMO_TENANT_ID;

    const { POST } = await import('@/app/api/auth/demo-session/route');

    const req = new NextRequest('http://localhost:3000/api/auth/demo-session', {
      method: 'POST',
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/Demo mode is not currently configured/i);
  });

  // D. Fail closed on invalid credentials
  it('D. Invalid demo credentials fail closed with 401', async () => {
    process.env.DEMO_USER_EMAIL = 'demo@example.com';
    process.env.DEMO_USER_PASSWORD = 'wrong-password';
    process.env.DEMO_TENANT_ID = 'demo-tenant';

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { user: null },
            error: new Error('Invalid login credentials'),
          }),
        },
      }),
    }));

    const { POST } = await import('@/app/api/auth/demo-session/route');
    const req = new NextRequest('http://localhost:3000/api/auth/demo-session', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/Demo authentication failed/i);
  });

  // E. Missing profile fails closed and terminates session using local scope
  it('E. Missing demo user profile fails closed with 403 and signs out with local scope', async () => {
    process.env.DEMO_USER_EMAIL = 'demo@example.com';
    process.env.DEMO_USER_PASSWORD = 'correct-password';
    process.env.DEMO_TENANT_ID = 'demo-tenant';

    const signOutMock = vi.fn().mockResolvedValue({ error: null });

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { user: { id: 'demo-user-id', email: 'demo@example.com' } },
            error: null,
          }),
          signOut: signOutMock,
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: new Error('Profile not found'),
              }),
            }),
          }),
        }),
      }),
    }));

    const { POST } = await import('@/app/api/auth/demo-session/route');
    const req = new NextRequest('http://localhost:3000/api/auth/demo-session', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/Demo profile could not be verified/i);
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
  });

  // F. Demo account with super_admin role fails closed with local scope
  it('F. Demo account with super_admin role fails closed with 403 and signs out with local scope', async () => {
    process.env.DEMO_USER_EMAIL = 'demo@example.com';
    process.env.DEMO_USER_PASSWORD = 'correct-password';
    process.env.DEMO_TENANT_ID = 'demo-tenant';

    const signOutMock = vi.fn().mockResolvedValue({ error: null });

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { user: { id: 'demo-user-id', email: 'demo@example.com' } },
            error: null,
          }),
          signOut: signOutMock,
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'demo-user-id', tenant_id: 'demo-tenant', role: 'super_admin' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));

    const { POST } = await import('@/app/api/auth/demo-session/route');
    const req = new NextRequest('http://localhost:3000/api/auth/demo-session', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/Demo account cannot hold administrative privileges/i);
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
  });

  // G. Demo account with mismatched tenant fails closed with local scope
  it('G. Demo account with mismatched tenant fails closed with 403 and signs out with local scope', async () => {
    process.env.DEMO_USER_EMAIL = 'demo@example.com';
    process.env.DEMO_USER_PASSWORD = 'correct-password';
    process.env.DEMO_TENANT_ID = 'expected-demo-tenant';

    const signOutMock = vi.fn().mockResolvedValue({ error: null });

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { user: { id: 'demo-user-id', email: 'demo@example.com' } },
            error: null,
          }),
          signOut: signOutMock,
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'demo-user-id', tenant_id: 'wrong-tenant-id', role: 'specialist' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));

    const { POST } = await import('@/app/api/auth/demo-session/route');
    const req = new NextRequest('http://localhost:3000/api/auth/demo-session', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/Demo tenant configuration mismatch/i);
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
  });

  // H. Successful demo bootstrap returns valid user and /app destination
  it('H. Successful demo bootstrap returns destination /app and valid non-admin user', async () => {
    process.env.DEMO_USER_EMAIL = 'demo@example.com';
    process.env.DEMO_USER_PASSWORD = 'correct-password';
    process.env.DEMO_TENANT_ID = 'demo-tenant-valid';

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { user: { id: 'demo-user-123', email: 'demo@example.com' } },
            error: null,
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'demo-user-123', tenant_id: 'demo-tenant-valid', role: 'specialist', full_name: 'Demo Specialist' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));

    const { POST } = await import('@/app/api/auth/demo-session/route');
    const req = new NextRequest('http://localhost:3000/api/auth/demo-session', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.destination).toBe('/app');
    expect(data.user.id).toBe('demo-user-123');
    expect(data.user.role).toBe('specialist');
    expect(data.user.tenantId).toBe('demo-tenant-valid');
  });

  // I. Safe reuse of already verified demo session
  it('I. Existing verified demo session is safely reused without re-authenticating', async () => {
    process.env.DEMO_USER_EMAIL = 'demo@example.com';
    process.env.DEMO_USER_PASSWORD = 'correct-password';
    process.env.DEMO_TENANT_ID = 'demo-tenant-valid';

    const signInWithPasswordMock = vi.fn();

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'demo-user-existing', email: 'demo@example.com' } },
            error: null,
          }),
          signInWithPassword: signInWithPasswordMock,
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'demo-user-existing', tenant_id: 'demo-tenant-valid', role: 'specialist', full_name: 'Existing Demo User' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));

    const { POST } = await import('@/app/api/auth/demo-session/route');
    const req = new NextRequest('http://localhost:3000/api/auth/demo-session', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.user.id).toBe('demo-user-existing');
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  // J & K. Existing real user session is NOT overwritten and remains intact
  it('J. Existing real authenticated user is NOT overwritten (409 Conflict with DEMO_REQUIRES_SIGN_OUT)', async () => {
    process.env.DEMO_USER_EMAIL = 'demo@example.com';
    process.env.DEMO_USER_PASSWORD = 'correct-password';
    process.env.DEMO_TENANT_ID = 'demo-tenant-valid';

    const signInWithPasswordMock = vi.fn();
    const signOutMock = vi.fn();

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'real-user-id', email: 'realagent@agencyabc.com' } },
            error: null,
          }),
          signInWithPassword: signInWithPasswordMock,
          signOut: signOutMock,
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'real-user-id', tenant_id: 'tenant-agency-abc', role: 'admin', full_name: 'Real Agency Admin' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));

    const { POST } = await import('@/app/api/auth/demo-session/route');
    const req = new NextRequest('http://localhost:3000/api/auth/demo-session', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.code).toBe('DEMO_REQUIRES_SIGN_OUT');
    expect(data.error).toMatch(/An active user session is already signed in/i);

    // Assert real user session was NOT overwritten and NOT signed out
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  // L. Demo session exit/cleanup uses local scope and completely purges state
  it('L. Exiting demo session executes local-scoped logout and completely purges store & notifications', async () => {
    useCRMStore.setState({
      currentUser: {
        id: 'demo-user-id',
        email: 'demo@example.com',
        fullName: 'Demo User',
        avatarUrl: '',
        role: 'specialist',
        tenantId: 'demo-tenant',
        isOnline: true,
      },
      tenantId: 'demo-tenant',
      leads: [{ id: 'demo-lead-1', fullName: 'Sample Lead', tenantId: 'demo-tenant' } as unknown as Lead],
    });

    useNotificationStore.setState({
      notifications: [{ id: 'n-demo', title: 'Demo Notification', body: '', type: 'task', read: false, createdAt: '' }],
    });

    const replaceMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { replace: replaceMock, pathname: '/register' },
      writable: true,
      configurable: true,
    });

    const adapterLogoutMock = vi.fn().mockResolvedValue(undefined);
    useCRMStore.getState().setAuthAdapter({
      login: vi.fn(),
      logout: adapterLogoutMock,
      loadSession: vi.fn(),
      user: null,
      loading: false,
    });

    // Invoke logout with local scope and no hard redirect (for preview exit)
    await useCRMStore.getState().logout({ scope: 'local', redirect: false });

    expect(useCRMStore.getState().currentUser).toBeNull();
    expect(useCRMStore.getState().tenantId).toBeNull();
    expect(useCRMStore.getState().leads).toHaveLength(0);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(adapterLogoutMock).toHaveBeenCalledWith({ scope: 'local' });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  // M. F0A /app server boundary rejects unauthenticated access
  it('M. F0A /app server layout continues to reject unauthenticated requests', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co';

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: new Error('No session'),
          }),
        },
      }),
    }));

    const AppLayout = (await import('../app/app/layout')).default;

    try {
      await AppLayout({ children: 'Protected Content' });
    } catch (e: unknown) {
      expect((e as Error).message).toBe('NEXT_REDIRECT:/login');
    }

    expect(redirectMock).toHaveBeenCalledWith('/login');
  });
});
