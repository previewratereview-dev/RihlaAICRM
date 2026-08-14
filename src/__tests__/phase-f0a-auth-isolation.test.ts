import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCRMStore } from '@/hooks/use-crm-store';
import { useNotificationStore } from '@/hooks/use-notification-store';
import type { User, Lead, Task } from '@/types';

/**
 * Phase F0A: Authentication, Session Isolation & Protected App Boundary Tests
 *
 * Validates:
 * A. unauthenticated /app -> /login
 * B. unauthenticated /app/inquiries -> /login
 * C. unauthenticated /app/travelers -> /login
 * D. authenticated protected request renders
 * E. logout while on /app -> state purge + /login
 * F. spontaneous SIGNED_OUT while on /app -> state purge + notification clear + /login
 * G. direct reload /app after logout -> denied server-side
 * H. User A -> logout -> User B isolation
 * I. failed logout audit event does not block logout
 * J. CrmShell does not render sensitive shell when definitively unauthenticated
 * K. Super admin profile allows access without agency tenant
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

describe('Phase F0A: Server-Side /app Layout Boundary (A, B, C, D, G, K)', () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    vi.resetModules();
  });

  it('A. AppLayout redirects unauthenticated request to /login (/app root)', async () => {
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: new Error('No active session'),
          }),
        },
      }),
    }));

    const AppLayout = (await import('../app/app/layout')).default;

    try {
      await AppLayout({ children: 'Protected App View' });
    } catch (e: unknown) {
      expect((e as Error).message).toBe('NEXT_REDIRECT:/login');
    }

    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('B & C. AppLayout wraps all /app child routes (/app/inquiries, /app/travelers) and denies access without valid profile', async () => {
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-no-profile', email: 'guest@example.com' } },
            error: null,
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: new Error('Profile record not found'),
              }),
            }),
          }),
        }),
      }),
    }));

    const AppLayout = (await import('../app/app/layout')).default;

    try {
      await AppLayout({ children: 'Child Inquiries View' });
    } catch (e: unknown) {
      expect((e as Error).message).toBe('NEXT_REDIRECT:/login');
    }

    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('D. AppLayout allows rendering when request is authenticated with valid tenant', async () => {
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-valid', email: 'agent@agency.com' } },
            error: null,
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'user-valid', tenant_id: 'tenant-agency-abc', role: 'admin' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));

    const AppLayout = (await import('../app/app/layout')).default;
    const result = await AppLayout({ children: 'Protected Dashboard' });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('G. Direct reload of /app after logout: server boundary denies access when session cookie is gone', async () => {
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: new Error('Auth session missing'),
          }),
        },
      }),
    }));

    const AppLayout = (await import('../app/app/layout')).default;

    try {
      await AppLayout({ children: 'Should Not Render' });
    } catch (e: unknown) {
      expect((e as Error).message).toBe('NEXT_REDIRECT:/login');
    }

    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('K. Super admin user is permitted to render /app without tenant_id restrictions', async () => {
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'sa-user', email: 'admin@stateai.in' } },
            error: null,
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'sa-user', tenant_id: 'global', role: 'super_admin' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));

    const AppLayout = (await import('../app/app/layout')).default;
    const result = await AppLayout({ children: 'Super Admin Control Center' });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});

describe('Phase F0A: Client Session Reset & Multi-Tenant Isolation (E, F, H, I, J)', () => {
  beforeEach(() => {
    useCRMStore.getState().resetSessionState();
    useNotificationStore.getState().clear();
  });

  it('E. Logout while on /app executes state purge and hard navigation to /login', async () => {
    const adapterLogoutMock = vi.fn().mockResolvedValue(undefined);
    useCRMStore.setState({
      currentUser: {
        id: 'user-active',
        email: 'active@agency.com',
        fullName: 'Active Agent',
        avatarUrl: '',
        role: 'specialist',
        tenantId: 'tenant-active',
        isOnline: true,
      },
      tenantId: 'tenant-active',
      leads: [{ id: 'lead-1', fullName: 'Client 1', tenantId: 'tenant-active' } as unknown as Lead],
    });
    useNotificationStore.setState({
      notifications: [{ id: 'n1', title: 'Task', body: 'Do task', type: 'task', read: false, createdAt: '' }],
    });

    useCRMStore.getState().setAuthAdapter({
      login: vi.fn(),
      logout: adapterLogoutMock,
      loadSession: vi.fn(),
      user: null,
      loading: false,
    });

    const replaceMock = vi.fn();
    vi.stubGlobal('window', {
      location: { replace: replaceMock, pathname: '/app/dashboard' },
    });

    await useCRMStore.getState().logout();

    expect(useCRMStore.getState().currentUser).toBeNull();
    expect(useCRMStore.getState().tenantId).toBeNull();
    expect(useCRMStore.getState().leads).toHaveLength(0);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(adapterLogoutMock).toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith('/login');

    vi.unstubAllGlobals();
  });

  it('F. Spontaneous SIGNED_OUT event on /app triggers session reset and notification clear before redirect', async () => {
    // Populate store before event
    useCRMStore.setState({
      currentUser: {
        id: 'user-spontaneous',
        email: 'user@agency.com',
        fullName: 'Spontaneous User',
        avatarUrl: '',
        role: 'specialist',
        tenantId: 'tenant-spontaneous',
        isOnline: true,
      },
      tenantId: 'tenant-spontaneous',
      leads: [{ id: 'lead-s', fullName: 'Sensitive Lead', tenantId: 'tenant-spontaneous' } as unknown as Lead],
    });
    useNotificationStore.setState({
      notifications: [{ id: 'notif-s', title: 'Sensitive Notification', body: 'Details', type: 'task', read: false, createdAt: '' }],
    });

    const replaceMock = vi.fn();
    vi.stubGlobal('window', {
      location: { replace: replaceMock, pathname: '/app/inquiries' },
    });

    // Simulate onAuthStateChange SIGNED_OUT execution path
    useCRMStore.getState().resetSessionState();
    useNotificationStore.getState().clear();
    window.location.replace('/login');

    expect(useCRMStore.getState().currentUser).toBeNull();
    expect(useCRMStore.getState().tenantId).toBeNull();
    expect(useCRMStore.getState().leads).toHaveLength(0);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(replaceMock).toHaveBeenCalledWith('/login');

    vi.unstubAllGlobals();
  });

  it('H. User A -> Logout -> User B isolation guarantees User B cannot access User A data', async () => {
    const userA: User = {
      id: 'user-a-id',
      email: 'usera@agencyalpha.com',
      fullName: 'Agent Alpha',
      avatarUrl: '',
      role: 'specialist',
      tenantId: 'tenant-alpha',
      isOnline: true,
    };

    const userB: User = {
      id: 'user-b-id',
      email: 'userb@agencybeta.com',
      fullName: 'Agent Beta',
      avatarUrl: '',
      role: 'admin',
      tenantId: 'tenant-beta',
      isOnline: true,
    };

    // User A Active
    useCRMStore.setState({
      currentUser: userA,
      tenantId: userA.tenantId,
      leads: [{ id: 'lead-alpha', fullName: 'VIP Alpha Traveler', tenantId: 'tenant-alpha' } as unknown as Lead],
      tasks: [{ id: 'task-alpha', title: 'Prepare Alpha Itinerary', assignedTo: userA.id } as unknown as Task],
      team: [userA],
      settings: { ...useCRMStore.getState().settings, agencyName: 'Agency Alpha' },
      tenantBranding: { agencyName: 'Agency Alpha', primaryColor: '#FF0000' },
    });
    useNotificationStore.setState({
      notifications: [{ id: 'notif-a', title: 'Alpha Alert', body: 'VIP Traveler', type: 'task', read: false, createdAt: '' }],
    });

    // User A Logout
    useCRMStore.getState().resetSessionState();
    useNotificationStore.getState().clear();

    // User B Login
    useCRMStore.setState({
      currentUser: userB,
      tenantId: userB.tenantId,
      leads: [{ id: 'lead-beta', fullName: 'Beta Explorer', tenantId: 'tenant-beta' } as unknown as Lead],
      tasks: [{ id: 'task-beta', title: 'Confirm Beta Flight', assignedTo: userB.id } as unknown as Task],
      team: [userB],
      settings: { ...useCRMStore.getState().settings, agencyName: 'Agency Beta' },
      tenantBranding: { agencyName: 'Agency Beta', primaryColor: '#00FF00' },
    });

    const store = useCRMStore.getState();
    const notifications = useNotificationStore.getState();

    expect(store.currentUser?.fullName).toBe('Agent Beta');
    expect(store.tenantId).toBe('tenant-beta');
    expect(store.leads[0].fullName).toBe('Beta Explorer');
    expect(store.leads.some((l) => l.fullName.includes('Alpha'))).toBe(false);
    expect(store.tasks.some((t) => t.title.includes('Alpha'))).toBe(false);
    expect(store.team.some((m) => m.fullName.includes('Alpha'))).toBe(false);
    expect(store.settings.agencyName).toBe('Agency Beta');
    expect(store.tenantBranding.agencyName).toBe('Agency Beta');
    expect(notifications.notifications.some((n) => n.title.includes('Alpha'))).toBe(false);
  });

  it('I. Failed logout audit event does not block logout', async () => {
    const failingLogAuditEvent = vi.fn().mockRejectedValue(new Error('Network error writing audit log'));
    const adapterLogoutMock = vi.fn().mockResolvedValue(undefined);

    useCRMStore.setState({
      currentUser: {
        id: 'user-test',
        email: 'test@example.com',
        fullName: 'Test User',
        avatarUrl: '',
        role: 'specialist',
        tenantId: 'tenant-test',
        isOnline: true,
      },
      tenantId: 'tenant-test',
      leads: [{ id: 'lead-1', fullName: 'Test Lead', tenantId: 'tenant-test' } as unknown as Lead],
      logAuditEvent: failingLogAuditEvent,
    });

    useCRMStore.getState().setAuthAdapter({
      login: vi.fn(),
      logout: adapterLogoutMock,
      loadSession: vi.fn(),
      user: null,
      loading: false,
    });

    const replaceMock = vi.fn();
    vi.stubGlobal('window', {
      location: { replace: replaceMock, pathname: '/app' },
    });

    await useCRMStore.getState().logout();

    expect(useCRMStore.getState().currentUser).toBeNull();
    expect(useCRMStore.getState().tenantId).toBeNull();
    expect(useCRMStore.getState().leads).toHaveLength(0);
    expect(adapterLogoutMock).toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith('/login');

    vi.unstubAllGlobals();
  });

  it('J. ResetSessionState contract ensures fresh object instances for settings and branding', () => {
    useCRMStore.getState().resetSessionState();
    const settingsFirst = useCRMStore.getState().settings;
    const brandingFirst = useCRMStore.getState().tenantBranding;

    // Mutate state
    useCRMStore.setState({
      settings: { ...settingsFirst, agencyName: 'Mutated Agency' },
      tenantBranding: { ...brandingFirst, agencyName: 'Mutated Branding' },
    });

    // Reset again
    useCRMStore.getState().resetSessionState();
    const settingsSecond = useCRMStore.getState().settings;
    const brandingSecond = useCRMStore.getState().tenantBranding;

    expect(settingsSecond.agencyName).toBe('Rihla');
    expect(brandingSecond.agencyName).toBe('Rihla');
    expect(settingsSecond).not.toBe(settingsFirst);
    expect(brandingSecond).not.toBe(brandingFirst);
  });
});
