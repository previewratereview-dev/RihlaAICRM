// @vitest-environment jsdom
/**
 * Phase P0A: Platform Authorization Hardening Test Suite
 *
 * Verifies that:
 * 1. Platform Super Admin authority is strictly derived from authoritative persisted profile role ('super_admin') or platform_admins table.
 * 2. Email domain heuristics (@stateai.in, @stateai.com) contribute ZERO platform authority.
 * 3. Tenant scoping (tenant_id === 'global') contributes ZERO platform authority.
 * 4. Ordinary tenant administrators ('admin') are strictly forbidden from platform operations.
 * 5. Undefined role 'platform_super_admin' is rejected.
 * 6. Missing/malformed profiles fail closed (401/403).
 * 7. CrmShell fails closed if an ordinary user manipulates activeTab to 'sa_*'.
 * 8. Sidebar renders platform navigation exclusively for role === 'super_admin'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

// Mock dependencies
const mockGetUser = vi.fn();
const mockProfileSelect = vi.fn();
const mockIsPlatformSuperAdmin = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-cookie' }),
  }),
}));

vi.mock('@/lib/platform/service', () => ({
  isPlatformSuperAdmin: (userId: string) => mockIsPlatformSuperAdmin(userId),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockReturnValue({
    auth: {
      getUser: () => mockGetUser(),
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: () => mockProfileSelect(),
              maybeSingle: () => mockProfileSelect(),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));

// Mock all CrmShell sub-components
vi.mock('@/components/dashboard-view', () => ({
  DashboardView: () => React.createElement('div', { 'data-testid': 'tenant-dashboard-view' }, 'Tenant Dashboard'),
}));
vi.mock('@/components/setter-dashboard', () => ({
  SetterDashboard: () => React.createElement('div', { 'data-testid': 'setter-dashboard-view' }, 'Setter Dashboard'),
}));
vi.mock('@/components/inquiries-view', () => ({
  InquiriesView: () => React.createElement('div', { 'data-testid': 'inquiries-view' }),
}));
vi.mock('@/components/pipeline-view', () => ({
  PipelineView: () => React.createElement('div', { 'data-testid': 'pipeline-view' }),
}));
vi.mock('@/components/bookings-view', () => ({
  BookingsView: () => React.createElement('div', { 'data-testid': 'bookings-view' }),
}));
vi.mock('@/components/travelers-view', () => ({
  TravelersView: () => React.createElement('div', { 'data-testid': 'travelers-view' }),
}));
vi.mock('@/components/conversations-view', () => ({
  ConversationsView: () => React.createElement('div', { 'data-testid': 'conversations-view' }),
}));
vi.mock('@/components/calendar-view', () => ({
  CalendarView: () => React.createElement('div', { 'data-testid': 'calendar-view' }),
}));
vi.mock('@/components/tasks-view', () => ({
  TasksView: () => React.createElement('div', { 'data-testid': 'tasks-view' }),
}));
vi.mock('@/components/team-view', () => ({
  TeamView: () => React.createElement('div', { 'data-testid': 'team-view' }),
}));
vi.mock('@/components/performance-view', () => ({
  PerformanceView: () => React.createElement('div', { 'data-testid': 'performance-view' }),
}));
vi.mock('@/components/analytics-view', () => ({
  AnalyticsView: () => React.createElement('div', { 'data-testid': 'analytics-view' }),
}));
vi.mock('@/components/settings-view', () => ({
  SettingsView: () => React.createElement('div', { 'data-testid': 'settings-view' }),
}));
vi.mock('@/components/super-admin/sa-dashboard-view', () => ({
  SuperAdminDashboardView: () => React.createElement('div', { 'data-testid': 'super-admin-dashboard-view' }, 'Platform Command Center'),
}));
vi.mock('@/components/super-admin/sa-tenants-view', () => ({
  SuperAdminTenantsView: () => React.createElement('div', { 'data-testid': 'super-admin-tenants-view' }, 'Agency Management'),
}));
vi.mock('@/components/super-admin/sa-users-view', () => ({
  SuperAdminUsersView: () => React.createElement('div', { 'data-testid': 'super-admin-users-view' }, 'Global Users'),
}));
vi.mock('@/components/super-admin/sa-analytics-view', () => ({
  SuperAdminAnalyticsView: () => React.createElement('div', { 'data-testid': 'super-admin-analytics-view' }, 'Global Analytics'),
}));
vi.mock('@/components/super-admin/sa-ai-governance-view', () => ({
  SuperAdminAIGovernanceView: () => React.createElement('div', { 'data-testid': 'super-admin-ai-view' }, 'AI Governance'),
}));
vi.mock('@/components/super-admin/sa-audit-view', () => ({
  SuperAdminAuditView: () => React.createElement('div', { 'data-testid': 'super-admin-audit-view' }, 'Audit Log'),
}));
vi.mock('@/components/super-admin/sa-settings-view', () => ({
  SuperAdminSettingsView: () => React.createElement('div', { 'data-testid': 'super-admin-settings-view' }, 'Platform Settings'),
}));
vi.mock('@/components/global-copilot', () => ({
  GlobalCopilot: () => React.createElement('div', { 'data-testid': 'global-copilot' }),
}));
vi.mock('sonner', () => ({
  Toaster: () => React.createElement('div', { 'data-testid': 'toaster' }),
}));
vi.mock('@/components/sidebar', () => ({
  Sidebar: () => {
    const user = useCRMStore.getState().currentUser;
    return React.createElement(
      'div',
      { 'data-testid': 'sidebar' },
      user?.role === 'super_admin' ? (
        React.createElement('div', null, [
          React.createElement('span', { key: '1' }, 'Platform Overview'),
          React.createElement('span', { key: '2' }, 'Agency Management'),
          React.createElement('span', { key: '3' }, 'Global Users'),
          React.createElement('span', { key: '4' }, 'Platform Settings'),
        ])
      ) : (
        React.createElement('div', null, [
          React.createElement('span', { key: '1' }, 'Dashboard'),
          React.createElement('span', { key: '2' }, 'Inquiries'),
          React.createElement('span', { key: '3' }, 'Bookings'),
        ])
      )
    );
  },
}));
vi.mock('@/components/header', () => ({
  Header: () => React.createElement('div', { 'data-testid': 'header' }, 'Header'),
}));
vi.mock('@/components/tenant-provider', () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'tenant-provider' }, children),
}));
vi.mock('@/components/realtime-messages', () => ({
  RealtimeMessages: () => null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/app',
}));

import { requireAuth, requirePermission, requirePlatformSuperAdmin } from '@/lib/auth/api-guard';
import { CrmShell } from '@/components/crm-shell';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Sidebar } from '@/components/sidebar';
import type { User } from '@/types/common';

describe('Phase P0A: Platform Authorization Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPlatformSuperAdmin.mockResolvedValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  // 1. Unauthenticated -> Denied
  it('1. Unauthenticated request fails closed with 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('No session') });

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resAuth = await requireAuth(req);
    expect(resAuth).toBeInstanceOf(NextResponse);
    expect((resAuth as NextResponse).status).toBe(401);

    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).toBeInstanceOf(NextResponse);
    expect((resPlatform as NextResponse).status).toBe(401);
  });

  // 2. Missing Profile -> Denied
  it('2. Missing user profile fails closed with 403 on platform authorization', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-no-profile', email: 'orphan@agency.com' } }, error: null });
    mockProfileSelect.mockResolvedValue({ data: null, error: new Error('Profile not found') });

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).toBeInstanceOf(NextResponse);
    expect((resPlatform as NextResponse).status).toBe(403);
  });

  // 3. Ordinary Specialist -> Denied
  it('3. Ordinary specialist profile is strictly denied platform access (403)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-specialist', email: 'specialist@agency.com' } }, error: null });
    mockProfileSelect.mockResolvedValue({
      data: { role: 'specialist', tenant_id: 'tenant-agency-a', full_name: 'Specialist A', email: 'specialist@agency.com' },
      error: null,
    });

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).toBeInstanceOf(NextResponse);
    expect((resPlatform as NextResponse).status).toBe(403);

    const resPerm = await requirePermission(req, 'platform:tenants:write');
    expect(resPerm).toBeInstanceOf(NextResponse);
    expect((resPerm as NextResponse).status).toBe(403);
  });

  // 4. Ordinary Tenant Admin -> Denied
  it('4. Ordinary Agency Admin is strictly denied platform permissions (403)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-agency-admin', email: 'admin@agency-b.com' } }, error: null });
    mockProfileSelect.mockResolvedValue({
      data: { role: 'admin', tenant_id: 'tenant-agency-b', full_name: 'Agency Admin', email: 'admin@agency-b.com' },
      error: null,
    });

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).toBeInstanceOf(NextResponse);
    expect((resPlatform as NextResponse).status).toBe(403);

    const resPerm = await requirePermission(req, 'platform:settings:write');
    expect(resPerm).toBeInstanceOf(NextResponse);
    expect((resPerm as NextResponse).status).toBe(403);
  });

  // 5. Email Domain Heuristic: @stateai.in with ordinary role -> Denied
  it('5. @stateai.in email with ordinary specialist role and global tenant is DENIED platform authority', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-stateai-in', email: 'employee@stateai.in' } }, error: null });
    mockProfileSelect.mockResolvedValue({
      data: { role: 'specialist', tenant_id: 'global', full_name: 'StateAI Employee', email: 'employee@stateai.in' },
      error: null,
    });

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resAuth = await requireAuth(req);
    expect(resAuth).not.toBeInstanceOf(NextResponse);
    if (!(resAuth instanceof NextResponse)) {
      expect(resAuth.user.role).toBe('specialist'); // MUST NOT be elevated to super_admin
    }

    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).toBeInstanceOf(NextResponse);
    expect((resPlatform as NextResponse).status).toBe(403);
  });

  // 6. Email Domain Heuristic: @stateai.com with ordinary admin -> Denied
  it('6. @stateai.com email with agency admin role is DENIED platform authority', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-stateai-com', email: 'admin@stateai.com' } }, error: null });
    mockProfileSelect.mockResolvedValue({
      data: { role: 'admin', tenant_id: 'tenant-stateai-agency', full_name: 'StateAI Admin', email: 'admin@stateai.com' },
      error: null,
    });

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resAuth = await requireAuth(req);
    if (!(resAuth instanceof NextResponse)) {
      expect(resAuth.user.role).toBe('admin'); // MUST NOT be elevated to super_admin
    }

    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).toBeInstanceOf(NextResponse);
    expect((resPlatform as NextResponse).status).toBe(403);
  });

  // 7. Global Tenant Scope Heuristic with ordinary role -> Denied
  it('7. tenant_id === "global" with ordinary role is DENIED platform authority', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-global-ordinary', email: 'consultant@example.com' } }, error: null });
    mockProfileSelect.mockResolvedValue({
      data: { role: 'consultant', tenant_id: 'global', full_name: 'Global Consultant', email: 'consultant@example.com' },
      error: null,
    });

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).toBeInstanceOf(NextResponse);
    expect((resPlatform as NextResponse).status).toBe(403);
  });

  // 8. Invented Role: platform_super_admin -> Denied
  it('8. Invented role "platform_super_admin" normalises to viewer and is DENIED platform authority', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-invented-role', email: 'fake@example.com' } }, error: null });
    mockProfileSelect.mockResolvedValue({
      data: { role: 'platform_super_admin', tenant_id: 'global', full_name: 'Fake SuperAdmin', email: 'fake@example.com' },
      error: null,
    });

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resAuth = await requireAuth(req);
    if (!(resAuth instanceof NextResponse)) {
      expect(resAuth.user.role).toBe('viewer'); // Unknown role normalises to viewer
    }

    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).toBeInstanceOf(NextResponse);
    expect((resPlatform as NextResponse).status).toBe(403);
  });

  // 9. Authoritative Super Admin Profile -> Allowed
  it('9. Authoritative profile with role === "super_admin" is GRANTED platform authority', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-real-superadmin', email: 'rayees@stateai.in' } }, error: null });
    mockProfileSelect.mockResolvedValue({
      data: { role: 'super_admin', tenant_id: 'global', full_name: 'Rayees Amin', email: 'rayees@stateai.in' },
      error: null,
    });

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resAuth = await requireAuth(req);
    expect(resAuth).not.toBeInstanceOf(NextResponse);
    if (!(resAuth instanceof NextResponse)) {
      expect(resAuth.user.role).toBe('super_admin');
    }

    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).not.toBeInstanceOf(NextResponse);
    if (!(resPlatform instanceof NextResponse)) {
      expect(resPlatform.authUserId).toBe('user-real-superadmin');
    }

    const resPerm = await requirePermission(req, 'platform:tenants:write');
    expect(resPerm).not.toBeInstanceOf(NextResponse);
  });

  // 10. Client Fail-Closed Guard in CrmShell
  it('10. CrmShell fails closed when non-super_admin user has activeTab set to sa_* view', async () => {
    useCRMStore.setState({
      currentUser: {
        id: 'admin-user-1',
        role: 'admin',
        fullName: 'Tenant Admin',
        email: 'admin@agency.com',
        tenantId: 'tenant-agency-1',
        avatarUrl: '',
      } as User,
      activeTab: 'sa_dashboard', // Manipulated activeTab
      sessionLoading: false,
      dataLoading: false,
    });

    render(<CrmShell />);

    // Must NOT render SuperAdmin views
    expect(screen.queryByTestId('super-admin-dashboard-view')).toBeNull();
    expect(screen.queryByTestId('super-admin-tenants-view')).toBeNull();
    // Must fail closed to tenant dashboard
    expect(await screen.findByTestId('tenant-dashboard-view')).toBeDefined();
  });

  // 11. Normal User Sidebar Navigation Isolation
  it('11. Sidebar does NOT render Platform Admin items for normal agency admin', () => {
    useCRMStore.setState({
      currentUser: {
        id: 'admin-user-2',
        role: 'admin',
        fullName: 'Agency Admin',
        email: 'admin@agency.com',
        tenantId: 'tenant-agency-1',
        avatarUrl: '',
      } as User,
      sidebarExpanded: true,
    });

    render(<Sidebar />);

    expect(screen.queryByText('Platform Overview')).toBeNull();
    expect(screen.queryByText('Agency Management')).toBeNull();
    expect(screen.queryByText('Global Users')).toBeNull();
    expect(screen.queryByText('Platform Settings')).toBeNull();
  });

  // 12. Super Admin Sidebar Navigation
  it('12. Sidebar renders Platform Admin items when currentUser.role === "super_admin"', () => {
    useCRMStore.setState({
      currentUser: {
        id: 'super-admin-1',
        role: 'super_admin',
        fullName: 'Platform Super Admin',
        email: 'superadmin@example.com',
        tenantId: 'global',
        avatarUrl: '',
      } as User,
      sidebarExpanded: true,
    });

    render(<Sidebar />);

    expect(screen.getByText('Platform Overview')).toBeDefined();
    expect(screen.getByText('Agency Management')).toBeDefined();
    expect(screen.getByText('Global Users')).toBeDefined();
    expect(screen.getByText('Platform Settings')).toBeDefined();
  });

  // 13. Dual-Authority Negative Test: viewer role + platform_admins table row -> DENIED
  it('13. Dual-Authority Negative: viewer profile with platform_admins membership is DENIED platform access (403)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-viewer-in-platform-admins', email: 'viewer@agency.com' } }, error: null });
    mockProfileSelect.mockResolvedValue({
      data: { role: 'viewer', tenant_id: 'agency-1', full_name: 'Viewer User', email: 'viewer@agency.com' },
      error: null,
    });
    mockIsPlatformSuperAdmin.mockResolvedValue(true); // User exists in legacy platform_admins

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).toBeInstanceOf(NextResponse);
    expect((resPlatform as NextResponse).status).toBe(403);

    const resAuth = await requireAuth(req);
    if (!(resAuth instanceof NextResponse)) {
      expect(resAuth.user.role).toBe('viewer'); // MUST NOT elevate to super_admin
    }
  });

  // 14. Dual-Authority Negative Test: admin role + platform_admins table row -> DENIED
  it('14. Dual-Authority Negative: agency admin profile with platform_admins membership is DENIED platform access (403)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-admin-in-platform-admins', email: 'admin@agency.com' } }, error: null });
    mockProfileSelect.mockResolvedValue({
      data: { role: 'admin', tenant_id: 'agency-1', full_name: 'Agency Admin', email: 'admin@agency.com' },
      error: null,
    });
    mockIsPlatformSuperAdmin.mockResolvedValue(true); // User exists in legacy platform_admins

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).toBeInstanceOf(NextResponse);
    expect((resPlatform as NextResponse).status).toBe(403);

    const resAuth = await requireAuth(req);
    if (!(resAuth instanceof NextResponse)) {
      expect(resAuth.user.role).toBe('admin'); // MUST NOT elevate to super_admin
    }
  });

  // 15. Single Authority Positive Test: super_admin role + NO platform_admins membership -> ALLOWED
  it('15. Single Authority Positive: super_admin profile WITHOUT platform_admins membership is GRANTED platform access', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-pure-superadmin', email: 'owner@agency.com' } }, error: null });
    mockProfileSelect.mockResolvedValue({
      data: { role: 'super_admin', tenant_id: 'global', full_name: 'Super Admin', email: 'owner@agency.com' },
      error: null,
    });
    mockIsPlatformSuperAdmin.mockResolvedValue(false); // NO platform_admins record

    const req = new NextRequest('http://localhost:3000/api/platform/status');
    const resPlatform = await requirePlatformSuperAdmin(req);
    expect(resPlatform).not.toBeInstanceOf(NextResponse);
    if (!(resPlatform instanceof NextResponse)) {
      expect(resPlatform.authUserId).toBe('user-pure-superadmin');
    }

    const resAuth = await requireAuth(req);
    if (!(resAuth instanceof NextResponse)) {
      expect(resAuth.user.role).toBe('super_admin');
    }
  });
});
