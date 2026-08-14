// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { DevTools } from '@/components/dev-tools';
import { DashboardView } from '@/components/dashboard-view';
import { AdminUserManagement } from '@/components/admin-user-management';
import { TeamView } from '@/components/team-view';
import type { Lead, User } from '@/types';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

vi.mock('@/lib/data/service', () => ({
  CRMDatabaseService: {
    isSupabaseEnabled: () => false,
  },
  dataService: {
    getLeads: vi.fn().mockResolvedValue([]),
    addLead: vi.fn().mockResolvedValue({ id: 'new-lead-1' }),
    updateLead: vi.fn().mockResolvedValue({}),
    deleteLead: vi.fn().mockResolvedValue(true),
    getAuditLogs: vi.fn().mockResolvedValue([]),
    getTenantBranding: vi.fn().mockResolvedValue({}),
    getIntegrationKeys: vi.fn().mockResolvedValue({}),
    getUsers: vi.fn().mockResolvedValue([]),
    createUser: vi.fn().mockResolvedValue({}),
    updateUser: vi.fn().mockResolvedValue({}),
    deleteUser: vi.fn().mockResolvedValue(true),
  },
}));

describe('Phase F1A: Product Truth & Shell Integrity', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    useCRMStore.getState().resetSessionState();
  });

  afterEach(() => {
    cleanup();
    process.env = { ...originalEnv };
  });

  // 1. Static Scan: Fabricated Metrics & Values Absent from Source Code
  it('A. Source code does not contain hardcoded 98.4% CSAT, "Recognized Revenue", or "2 days ago" login simulation', () => {
    const dashboardFile = path.join(process.cwd(), 'src/components/dashboard-view.tsx');
    const userMgmtFile = path.join(process.cwd(), 'src/components/admin-user-management.tsx');
    const teamViewFile = path.join(process.cwd(), 'src/components/team-view.tsx');
    const analyticsFile = path.join(process.cwd(), 'src/components/analytics-view.tsx');

    const dashboardContent = fs.readFileSync(dashboardFile, 'utf-8');
    const userMgmtContent = fs.readFileSync(userMgmtFile, 'utf-8');
    const teamViewContent = fs.readFileSync(teamViewFile, 'utf-8');
    const analyticsContent = fs.readFileSync(analyticsFile, 'utf-8');

    expect(dashboardContent).not.toMatch(/98\.4%/);
    expect(dashboardContent).not.toMatch(/Client CSAT/i);
    expect(dashboardContent).not.toMatch(/Recognized Revenue/i);
    expect(analyticsContent).not.toMatch(/Recognized Revenue/i);
    expect(userMgmtContent).not.toMatch(/2 days ago/);
    expect(userMgmtContent).not.toMatch(/<th>Status<\/th>/i);
    expect(teamViewContent).not.toMatch(/online now/i);
  });

  // 2. Dashboard KPI Card Calculations
  it('B. Dashboard renders real calculated metrics (Open Inquiries & Pipeline Value) without fabricated CSAT or Recognized Revenue', () => {
    const mockLeads: Lead[] = [
      {
        id: 'inq-1',
        fullName: 'Alice Walker',
        email: 'alice@example.com',
        phone: '+1234567890',
        status: 'inquiry_received',
        priority: 'high',
        dealValue: 5000,
        tenantId: 'tenant-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as Lead,
      {
        id: 'inq-2',
        fullName: 'Bob Smith',
        email: 'bob@example.com',
        phone: '+1234567891',
        status: 'booking_confirmed',
        priority: 'urgent',
        dealValue: 12000,
        tenantId: 'tenant-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as Lead,
      {
        id: 'inq-3',
        fullName: 'Charlie Davis',
        email: 'charlie@example.com',
        phone: '+1234567892',
        status: 'booking_lost',
        priority: 'low',
        dealValue: 3000,
        tenantId: 'tenant-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as Lead,
    ];

    useCRMStore.setState({
      leads: mockLeads,
      currentUser: { id: 'admin-1', role: 'admin', fullName: 'Admin User', email: 'admin@stateai.in', tenantId: 'tenant-1' } as User,
      dataLoading: false,
    });

    render(<DashboardView />);

    // Assert "Client CSAT", "98.4%", and "Recognized Revenue" are NOT present
    expect(screen.queryByText(/Client CSAT/i)).toBeNull();
    expect(screen.queryByText('98.4%')).toBeNull();
    expect(screen.queryByText(/Recognized Revenue/i)).toBeNull();

    // Assert truthful Open Inquiries & Pipeline Value cards are rendered
    expect(screen.getByText('Open Inquiries')).toBeDefined();
    expect(screen.getByText('Pipeline Value')).toBeDefined();
    expect(screen.getByText('Unique Travelers')).toBeDefined();
    expect(screen.getByText('Confirmed Trips')).toBeDefined();
    expect(screen.getByText('Conversion Rate')).toBeDefined();
  });

  // 3. DevTools Production Guard & Positioning
  it('C. DevTools does NOT render in production (NODE_ENV=production)', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const { container } = render(<DevTools />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('dev-tools-panel')).toBeNull();
    vi.unstubAllEnvs();
  });

  it('D. DevTools renders in development mode and is positioned at bottom-left', () => {
    vi.stubEnv('NODE_ENV', 'development');

    render(<DevTools />);
    const panel = screen.getByTestId('dev-tools-panel');
    expect(panel).toBeDefined();
    expect(panel.className).toContain('bottom-4');
    expect(panel.className).toContain('left-4');
    expect(panel.className).not.toContain('right-4');
    vi.unstubAllEnvs();
  });

  // 4. User Management Truthfulness (Status removed, Last Login dash & Permissions preserved)
  it('E. User Management removes unpersisted Status column and renders dash for unauthenticated last login', () => {
    const mockUsers: User[] = [
      {
        id: 'u-1',
        fullName: 'Jane Advisor',
        email: 'jane@agency.com',
        role: 'setter',
        tenantId: 'tenant-1',
        isOnline: false,
      } as unknown as User,
      {
        id: 'u-2',
        fullName: 'Mark Admin',
        email: 'mark@agency.com',
        role: 'admin',
        tenantId: 'tenant-1',
        isOnline: true,
      } as unknown as User,
    ];

    useCRMStore.setState({
      team: mockUsers,
      currentUser: mockUsers[1],
    });

    render(<AdminUserManagement />);

    // Assert "Online", "Offline", and unpersisted "Status" / "Active" header/cells are NOT present
    expect(screen.queryByText('Online')).toBeNull();
    expect(screen.queryByText('Offline')).toBeNull();
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByText('2 days ago')).toBeNull();
    expect(screen.queryByText('Just now')).toBeNull();

    // Assert Last Login is rendered truthfully as dash
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);

    // Assert Role and Permissions continue to render authoritatively
    expect(screen.getByText('setter')).toBeDefined();
    expect(screen.getByText('admin')).toBeDefined();
    expect(screen.getByText('Full Access')).toBeDefined();
    expect(screen.getByText('Standard')).toBeDefined();
  });

  // 5. Team View Presence Truthfulness
  it('F. Team view renders member count without claiming simulated online presence', () => {
    const mockUsers: User[] = [
      {
        id: 'u-1',
        fullName: 'Agent Alpha',
        email: 'alpha@agency.com',
        role: 'closer',
        tenantId: 'tenant-1',
      } as unknown as User,
      {
        id: 'u-2',
        fullName: 'Agent Beta',
        email: 'beta@agency.com',
        role: 'specialist',
        tenantId: 'tenant-1',
      } as unknown as User,
    ];

    useCRMStore.setState({
      team: mockUsers,
      currentUser: mockUsers[0],
    });

    render(<TeamView />);

    // Assert no simulated online count
    expect(screen.queryByText(/online/i)).toBeNull();
    expect(screen.getByText(/2 members/i)).toBeDefined();
  });
});
