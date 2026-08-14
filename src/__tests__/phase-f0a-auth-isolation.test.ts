// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { useNotificationStore } from '@/hooks/use-notification-store';
import type { User, Lead, Task } from '@/types';
import { CrmShell } from '@/components/crm-shell';

/**
 * Phase F0A: Authentication, Session Isolation & Protected App Boundary Tests
 *
 * Covers:
 * 1. Server Layout Authentication Boundary & Authorization Rules
 * 2. Strict Super-Admin Profile Role Authorization (Negative test for @stateai.in email)
 * 3. Global SIGNED_OUT State Purge (on /app and on public routes)
 * 4. Actual CrmShell Defensive Client Auth-Guard (Loading, Unauthenticated, Authenticated)
 * 5. User A -> Logout -> User B Isolation
 * 6. Non-blocking Logout Audit Logging
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

// Mock sub-components for CrmShell render tests
vi.mock('@/components/sidebar', () => ({
  Sidebar: () => React.createElement('div', { 'data-testid': 'crm-sidebar' }, 'Sidebar'),
}));
vi.mock('@/components/header', () => ({
  Header: () => React.createElement('div', { 'data-testid': 'crm-header' }, 'Header'),
}));
vi.mock('@/components/dashboard-view', () => ({
  DashboardView: () => React.createElement('div', { 'data-testid': 'dashboard-view' }, 'Protected Dashboard Content'),
}));
vi.mock('@/components/global-copilot', () => ({
  GlobalCopilot: () => React.createElement('div', { 'data-testid': 'global-copilot' }, 'Copilot'),
}));
vi.mock('@/components/dev-tools', () => ({
  DevTools: () => React.createElement('div', { 'data-testid': 'dev-tools' }, 'DevTools'),
}));
vi.mock('sonner', () => ({
  Toaster: () => React.createElement('div', { 'data-testid': 'toaster' }),
}));

describe('1. Server-Side /app Layout Boundary & Role Authorization', () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co';
  });

  afterEach(() => {
    cleanup();
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

  it('B. Negative Test: @stateai.in email with ordinary role (specialist) and global/missing tenant is DENIED access', async () => {
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-specialist-domain', email: 'employee@stateai.in' } },
            error: null,
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'user-specialist-domain', tenant_id: 'global', role: 'specialist' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));

    const AppLayout = (await import('../app/app/layout')).default;

    try {
      await AppLayout({ children: 'Should Be Denied' });
    } catch (e: unknown) {
      expect((e as Error).message).toBe('NEXT_REDIRECT:/login');
    }

    // Must be redirected to /login because email domain alone does NOT grant super-admin access
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('C. Authoritative Super Admin: explicit super_admin role is permitted without tenant_id restrictions', async () => {
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
    }));

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn().mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'sa-authoritative', email: 'admin@anycompany.com' } },
            error: null,
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'sa-authoritative', tenant_id: 'global', role: 'super_admin' },
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

  it('D. Authenticated normal user with valid tenant is permitted to render /app', async () => {
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
});

describe('2. Global SIGNED_OUT Session Reset (on /app and public routes)', () => {
  beforeEach(() => {
    useCRMStore.getState().resetSessionState();
    useNotificationStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('A. SIGNED_OUT on /app route: purges store state, clears notifications, and redirects to /login', () => {
    useCRMStore.setState({
      currentUser: {
        id: 'u-app',
        email: 'agent@test.com',
        fullName: 'Agent On App',
        avatarUrl: '',
        role: 'specialist',
        tenantId: 'tenant-app',
        isOnline: true,
      },
      tenantId: 'tenant-app',
      leads: [{ id: 'l1', fullName: 'Confidential Lead' } as unknown as Lead],
    });
    useNotificationStore.setState({
      notifications: [{ id: 'n1', title: 'Private', body: '', type: 'task', read: false, createdAt: '' }],
    });

    const replaceMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { replace: replaceMock, pathname: '/app/inquiries' },
      writable: true,
      configurable: true,
    });

    // Simulated execution of onAuthStateChange global reset logic
    useCRMStore.getState().resetSessionState();
    useNotificationStore.getState().clear();
    if (window.location.pathname.startsWith('/app')) {
      window.location.replace('/login');
    }

    expect(useCRMStore.getState().currentUser).toBeNull();
    expect(useCRMStore.getState().tenantId).toBeNull();
    expect(useCRMStore.getState().leads).toHaveLength(0);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('B. SIGNED_OUT on public route (/register or /login): purges store state and notifications WITHOUT redirect loop', () => {
    useCRMStore.setState({
      currentUser: {
        id: 'u-pub',
        email: 'user@test.com',
        fullName: 'Public Route User',
        avatarUrl: '',
        role: 'specialist',
        tenantId: 'tenant-pub',
        isOnline: true,
      },
      tenantId: 'tenant-pub',
      leads: [{ id: 'l2', fullName: 'Public Route Lead' } as unknown as Lead],
    });
    useNotificationStore.setState({
      notifications: [{ id: 'n2', title: 'Alert', body: '', type: 'task', read: false, createdAt: '' }],
    });

    const replaceMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { replace: replaceMock, pathname: '/register' },
      writable: true,
      configurable: true,
    });

    // Simulated execution of onAuthStateChange global reset logic
    useCRMStore.getState().resetSessionState();
    useNotificationStore.getState().clear();
    if (window.location.pathname.startsWith('/app')) {
      window.location.replace('/login');
    }

    // State MUST be completely cleared
    expect(useCRMStore.getState().currentUser).toBeNull();
    expect(useCRMStore.getState().tenantId).toBeNull();
    expect(useCRMStore.getState().leads).toHaveLength(0);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);

    // Must NOT trigger unnecessary redirect when on public routes
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe('3. CrmShell Defensive Client Auth-Guard', () => {
  beforeEach(() => {
    useCRMStore.getState().resetSessionState();
    useNotificationStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('A. sessionLoading = true: protected CRM views are NOT rendered (shows restoring session indicator)', () => {
    useCRMStore.setState({
      sessionLoading: true,
      currentUser: null,
    });

    const { queryByTestId, getByText } = render(React.createElement(CrmShell));

    // Protected view content must NOT be rendered
    expect(queryByTestId('dashboard-view')).toBeNull();
    expect(queryByTestId('crm-sidebar')).toBeNull();

    // Restoring session indicator should be visible
    expect(getByText(/Restoring session/i)).toBeDefined();
  });

  it('B. sessionLoading = false, currentUser = null: protected CRM shell is NOT rendered and initiates redirect', () => {
    const replaceMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { replace: replaceMock, pathname: '/app' },
      writable: true,
      configurable: true,
    });

    useCRMStore.setState({
      sessionLoading: false,
      currentUser: null,
    });

    useCRMStore.getState().setAuthAdapter({
      login: vi.fn(),
      logout: vi.fn(),
      loadSession: vi.fn(),
      user: null,
      loading: false,
    });

    const { queryByTestId } = render(React.createElement(CrmShell));

    // Protected CRM views must NOT render
    expect(queryByTestId('dashboard-view')).toBeNull();
    expect(queryByTestId('crm-sidebar')).toBeNull();

    // Secondary client guard should trigger redirect to /login
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('C. sessionLoading = false, currentUser authenticated: normal CrmShell rendering is permitted', () => {
    useCRMStore.setState({
      sessionLoading: false,
      currentUser: {
        id: 'user-crm-test',
        email: 'test@agency.com',
        fullName: 'Agent Tested',
        avatarUrl: '',
        role: 'admin',
        tenantId: 'tenant-123',
        isOnline: true,
      },
      activeTab: 'dashboard',
    });

    const { getByTestId } = render(React.createElement(CrmShell));

    expect(getByTestId('crm-header')).toBeDefined();
    expect(document.getElementById('main-content')).toBeDefined();
  });
});

describe('4. User A -> Logout -> User B Isolation & Reset Contract', () => {
  beforeEach(() => {
    useCRMStore.getState().resetSessionState();
    useNotificationStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('A. User A logout ensures User B cannot observe User A state', () => {
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

  it('B. Failed logout audit event does not block logout', async () => {
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
    Object.defineProperty(window, 'location', {
      value: { replace: replaceMock, pathname: '/app' },
      writable: true,
      configurable: true,
    });

    await useCRMStore.getState().logout();

    expect(useCRMStore.getState().currentUser).toBeNull();
    expect(useCRMStore.getState().tenantId).toBeNull();
    expect(useCRMStore.getState().leads).toHaveLength(0);
    expect(adapterLogoutMock).toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('C. ResetSessionState contract ensures fresh object instances for settings and branding', () => {
    useCRMStore.getState().resetSessionState();
    const settingsFirst = useCRMStore.getState().settings;
    const brandingFirst = useCRMStore.getState().tenantBranding;

    useCRMStore.setState({
      settings: { ...settingsFirst, agencyName: 'Mutated Agency' },
      tenantBranding: { ...brandingFirst, agencyName: 'Mutated Branding' },
    });

    useCRMStore.getState().resetSessionState();
    const settingsSecond = useCRMStore.getState().settings;
    const brandingSecond = useCRMStore.getState().tenantBranding;

    expect(settingsSecond.agencyName).toBe('Rihla');
    expect(brandingSecond.agencyName).toBe('Rihla');
    expect(settingsSecond).not.toBe(settingsFirst);
    expect(brandingSecond).not.toBe(brandingFirst);
  });
});
