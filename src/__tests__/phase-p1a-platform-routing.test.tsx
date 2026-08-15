// @vitest-environment jsdom
/**
 * Phase P1A: Platform Routing, Shell Isolation & Impersonation Decommissioning Test Suite
 *
 * Verifies that:
 * 1. Two-Way Server Context Boundary:
 *    - /app/platform/* layout permits super_admin and server-redirects non-super_admin to /app/dashboard.
 *    - /app/(crm)/* layout permits CRM users and server-redirects super_admin to /app/platform/dashboard.
 *    - Unauthenticated sessions redirect to /login.
 * 2. Dedicated App Router Platform Routes:
 *    - All 7 Platform pages exist and export valid React components.
 * 3. PlatformShell Isolation:
 *    - PlatformShell mounts PlatformSidebar, PlatformHeader, and children.
 *    - PlatformShell strictly excludes Agency CRM controls (GlobalSearch, GlobalCopilot, Open Inquiries, Paywall).
 * 4. View As & Impersonation Decommissioning:
 *    - Impersonation state, timer, and action are completely removed.
 *    - getActiveTenantId strictly binds to tenantId.
 *    - platform:impersonate capability is removed.
 * 5. Scoped Platform Data Hydration:
 *    - super_admin syncData loads only platform datasets without downloading tenant CRM entities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { getActiveTenantId } from '@/hooks/store/helpers';
import type { User } from '@/types/common';

// Mock Next.js navigation
const mockRedirect = vi.fn();
const mockPush = vi.fn();
let mockPathname = '/app/platform/dashboard';

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => mockPathname,
}));

// Mock Supabase server client
const mockGetUser = vi.fn();
const mockProfileSelect = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-cookie' }),
  }),
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
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));

// Mock database service
vi.mock('@/lib/db-service', () => ({
  CRMDatabaseService: {
    isSupabaseEnabled: () => false,
    getTenants: vi.fn().mockResolvedValue([]),
    getTenantsWithStats: vi.fn().mockResolvedValue([]),
    getAllPlatformUsers: vi.fn().mockResolvedValue([]),
    getGlobalAuditLogs: vi.fn().mockResolvedValue([]),
    getGlobalAnalytics: vi.fn().mockResolvedValue({
      totalTenants: 0,
      activeTenants: 0,
      suspendedTenants: 0,
      totalLeads: 0,
      totalUsers: 0,
      totalAiSpend: 0,
      totalConversations: 0,
      aiCallsThisMonth: 0,
    }),
    getTeamMembers: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({}),
    getLeads: vi.fn().mockResolvedValue([]),
    getTasks: vi.fn().mockResolvedValue([]),
    getConversations: vi.fn().mockResolvedValue([]),
    getAuditLogs: vi.fn().mockResolvedValue([]),
  },
}));

describe('Phase P1A: Platform Routing & Shell Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/app/platform/dashboard';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co';
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // 1. Two-Way Server Context Boundary Tests
  // ---------------------------------------------------------------------------
  describe('1. Two-Way Server Context Layout Boundaries', () => {
    it('A. PlatformLayout allows authenticated super_admin user', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'super-admin-id' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin' }, error: null });

      const PlatformLayout = (await import('../app/app/platform/layout')).default;
      const result = await PlatformLayout({ children: React.createElement('div', { 'data-testid': 'platform-content' }, 'Platform Area') });

      expect(mockRedirect).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('B. PlatformLayout server-redirects authenticated ordinary agency user to /app/dashboard', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-user-id' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'admin' }, error: null });

      const PlatformLayout = (await import('../app/app/platform/layout')).default;

      await expect(
        PlatformLayout({ children: React.createElement('div', null, 'Content') })
      ).rejects.toThrow('NEXT_REDIRECT:/app/dashboard');

      expect(mockRedirect).toHaveBeenCalledWith('/app/dashboard');
    });

    it('C. PlatformLayout redirects unauthenticated request to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('No session') });

      const PlatformLayout = (await import('../app/app/platform/layout')).default;

      await expect(
        PlatformLayout({ children: React.createElement('div', null, 'Content') })
      ).rejects.toThrow('NEXT_REDIRECT:/login');

      expect(mockRedirect).toHaveBeenCalledWith('/login');
    });

    it('D. CrmLayout allows normal agency CRM user', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'agent-user-id' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'agent' }, error: null });

      const CrmLayout = (await import('../app/app/(crm)/layout')).default;
      const result = await CrmLayout({ children: React.createElement('div', { 'data-testid': 'crm-content' }, 'CRM Area') });

      expect(mockRedirect).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('E. CrmLayout server-redirects super_admin to /app/platform/dashboard (two-way isolation)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'super-admin-id' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin' }, error: null });

      const CrmLayout = (await import('../app/app/(crm)/layout')).default;

      await expect(
        CrmLayout({ children: React.createElement('div', null, 'Content') })
      ).rejects.toThrow('NEXT_REDIRECT:/app/platform/dashboard');

      expect(mockRedirect).toHaveBeenCalledWith('/app/platform/dashboard');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Real Next.js App Router Platform Routes
  // ---------------------------------------------------------------------------
  describe('2. Real Next.js App Router Platform Routes Exist', () => {
    it('A. /app/platform/page.tsx redirects to /app/platform/dashboard', async () => {
      const PlatformRoot = (await import('../app/app/platform/page')).default;
      expect(() => PlatformRoot()).toThrow('NEXT_REDIRECT:/app/platform/dashboard');
      expect(mockRedirect).toHaveBeenCalledWith('/app/platform/dashboard');
    });

    it('B. /app/platform/dashboard/page.tsx exports valid component', async () => {
      const DashboardPage = (await import('../app/app/platform/dashboard/page')).default;
      expect(typeof DashboardPage).toBe('function');
    });

    it('C. /app/platform/agencies/page.tsx exports valid component', async () => {
      const AgenciesPage = (await import('../app/app/platform/agencies/page')).default;
      expect(typeof AgenciesPage).toBe('function');
    });

    it('D. /app/platform/users/page.tsx exports valid component', async () => {
      const UsersPage = (await import('../app/app/platform/users/page')).default;
      expect(typeof UsersPage).toBe('function');
    });

    it('E. /app/platform/analytics/page.tsx exports valid component', async () => {
      const AnalyticsPage = (await import('../app/app/platform/analytics/page')).default;
      expect(typeof AnalyticsPage).toBe('function');
    });

    it('F. /app/platform/ai/page.tsx exports valid component', async () => {
      const AIPage = (await import('../app/app/platform/ai/page')).default;
      expect(typeof AIPage).toBe('function');
    });

    it('G. /app/platform/audit/page.tsx exports valid component', async () => {
      const AuditPage = (await import('../app/app/platform/audit/page')).default;
      expect(typeof AuditPage).toBe('function');
    });

    it('H. /app/platform/settings/page.tsx exports valid component', async () => {
      const SettingsPage = (await import('../app/app/platform/settings/page')).default;
      expect(typeof SettingsPage).toBe('function');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. PlatformShell Isolation Tests
  // ---------------------------------------------------------------------------
  describe('3. PlatformShell Isolation', () => {
    it('A. PlatformShell renders Platform navigation items and excludes CRM elements', async () => {
      useCRMStore.setState({
        currentUser: {
          id: 'sa-1',
          fullName: 'Super Admin',
          email: 'admin@platform.com',
          role: 'super_admin',
          tenantId: 'global',
          avatarUrl: '',
        } as User,
        sessionLoading: false,
        dataLoading: false,
        sidebarExpanded: true,
      });

      const { PlatformShell } = await import('@/components/platform/platform-shell');
      render(
        <PlatformShell>
          <div data-testid="test-child">Child View</div>
        </PlatformShell>
      );

      // Must render Platform Sidebar Items and Header Breadcrumbs
      expect(screen.getAllByText('Platform Overview').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Agency Management')).toBeDefined();
      expect(screen.getByText('Global Users')).toBeDefined();
      expect(screen.getByText('Platform Settings')).toBeDefined();

      // Must render Breadcrumb in Platform Header
      expect(screen.getByText('Platform')).toBeDefined();

      // Must render child view
      expect(screen.getByTestId('test-child')).toBeDefined();

      // Must NOT render Agency CRM features in PlatformShell
      expect(screen.queryByText('Open Inquiries')).toBeNull();
      expect(screen.queryByText('AI Online')).toBeNull();
      expect(screen.queryByText('Past Travelers')).toBeNull();
      expect(screen.queryByText('Booking Pipeline')).toBeNull();
    });

    it('B. CrmShell does not include SuperAdmin views in its lazy-load map', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const crmShellSource = fs.readFileSync(
        path.resolve(__dirname, '../components/crm-shell.tsx'),
        'utf-8'
      );

      expect(crmShellSource).not.toMatch(/SuperAdminDashboardView/);
      expect(crmShellSource).not.toMatch(/SuperAdminTenantsView/);
      expect(crmShellSource).not.toMatch(/SuperAdminUsersView/);
      expect(crmShellSource).not.toMatch(/SuperAdminAnalyticsView/);
      expect(crmShellSource).not.toMatch(/SuperAdminAIGovernanceView/);
      expect(crmShellSource).not.toMatch(/SuperAdminAuditView/);
      expect(crmShellSource).not.toMatch(/SuperAdminSettingsView/);
      expect(crmShellSource).not.toMatch(/case 'sa_/);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. View As & Impersonation Removal Tests
  // ---------------------------------------------------------------------------
  describe('4. View As & Impersonation Decommissioning', () => {
    it('A. Impersonation state and actions are absent from useCRMStore', () => {
      const state = useCRMStore.getState() as unknown as Record<string, unknown>;
      expect(state.impersonateTenantId).toBeUndefined();
      expect(state.impersonateTenantName).toBeUndefined();
      expect(state.impersonationStartedAt).toBeUndefined();
      expect(state.impersonationRemainingMs).toBeUndefined();
      expect(state.setImpersonateTenant).toBeUndefined();
    });

    it('B. getActiveTenantId strictly binds to real tenant context', () => {
      expect(getActiveTenantId({ tenantId: 'agency-alpha' })).toBe('agency-alpha');
      expect(() => getActiveTenantId({ tenantId: null })).toThrow('Tenant context is required');
    });

    it('C. View As button is absent from SuperAdminTenantsView source', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const source = fs.readFileSync(
        path.resolve(__dirname, '../components/super-admin/sa-tenants-view.tsx'),
        'utf-8'
      );

      expect(source).not.toMatch(/View As/);
      expect(source).not.toMatch(/setImpersonateTenant/);
    });

    it('D. Impersonation banner is absent from Header component', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const headerSource = fs.readFileSync(
        path.resolve(__dirname, '../components/header.tsx'),
        'utf-8'
      );

      expect(headerSource).not.toMatch(/Viewing as tenant/);
      expect(headerSource).not.toMatch(/Exit impersonation/);
      expect(headerSource).not.toMatch(/impersonateTenantId/);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Scoped Platform Data Hydration Tests
  // ---------------------------------------------------------------------------
  describe('5. Scoped Platform Data Hydration', () => {
    it('A. super_admin syncData hydrates only platform datasets and skips tenant CRM entities', async () => {
      const { CRMDatabaseService } = await import('@/lib/db-service');

      useCRMStore.setState({
        currentUser: {
          id: 'super-admin-1',
          role: 'super_admin',
          fullName: 'Super Admin',
          email: 'admin@platform.com',
          tenantId: 'global',
          avatarUrl: '',
        } as User,
        dataLoading: false,
      });

      await useCRMStore.getState().syncData();

      // Platform read methods must be called
      expect(CRMDatabaseService.getTenants).toHaveBeenCalled();
      expect(CRMDatabaseService.getTenantsWithStats).toHaveBeenCalled();
      expect(CRMDatabaseService.getAllPlatformUsers).toHaveBeenCalled();
      expect(CRMDatabaseService.getGlobalAuditLogs).toHaveBeenCalledWith(150);

      // Tenant CRM read methods must NOT be called
      expect(CRMDatabaseService.getLeads).not.toHaveBeenCalled();
      expect(CRMDatabaseService.getTasks).not.toHaveBeenCalled();
      expect(CRMDatabaseService.getConversations).not.toHaveBeenCalled();
    });
  });
});
