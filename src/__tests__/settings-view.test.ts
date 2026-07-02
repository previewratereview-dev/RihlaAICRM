import { describe, it, expect } from 'vitest';
import { can } from '@/lib/permissions';
import type { Permission } from '@/types/common';

/**
 * Property 11: Settings tab visibility per role
 * Validates: Requirements 8.2, 8.3, 8.4
 */
describe('Settings tab visibility per role', () => {
  // Mirrors the tabs definition in settings-view.tsx
  const tabs: Array<{ id: string; permission?: Permission }> = [
    { id: 'agency' },
    { id: 'profile' },
    { id: 'notifications' },
    { id: 'ai', permission: 'settings:ai:write' },
    { id: 'faq', permission: 'settings:ai:write' },
    { id: 'ai_usage', permission: 'settings:ai:write' },
    { id: 'integrations', permission: 'settings:integrations:write' },
    { id: 'users', permission: 'settings:users:write' },
    { id: 'audit', permission: 'settings:audit:read' },
  ];

  function getVisibleTabs(role: string) {
    return tabs.filter(t => !t.permission || can(role, t.permission)).map(t => t.id);
  }

  it('admin sees all tabs', () => {
    const visible = getVisibleTabs('admin');
    expect(visible).toHaveLength(9);
  });

  it('manager sees agency, profile, notifications (no audit or admin tabs)', () => {
    const visible = getVisibleTabs('manager');
    expect(visible).toContain('agency');
    expect(visible).toContain('profile');
    expect(visible).toContain('notifications');
    expect(visible).not.toContain('audit');
    expect(visible).not.toContain('users');
    expect(visible).not.toContain('integrations');
    expect(visible).not.toContain('ai');
    // Manager should see exactly 3 tabs: agency, profile, notifications
    expect(visible).toHaveLength(3);
  });

  it('specialist sees only profile and notifications (no permissioned tabs)', () => {
    const visible = getVisibleTabs('specialist');
    expect(visible).toContain('agency');
    expect(visible).toContain('profile');
    expect(visible).toContain('notifications');
    expect(visible).not.toContain('ai');
    expect(visible).not.toContain('users');
    expect(visible).not.toContain('audit');
  });

  it('viewer sees only profile and notifications (no permissioned tabs)', () => {
    const visible = getVisibleTabs('viewer');
    expect(visible).toContain('agency');
    expect(visible).toContain('profile');
    expect(visible).toContain('notifications');
    expect(visible).not.toContain('ai');
    expect(visible).not.toContain('users');
  });
});

/**
 * Property 12: Agency edit fields hidden without permission
 * Validates: Requirement 8.6
 */
describe('Agency edit fields hidden without permission', () => {
  it('settings-view.tsx uses can() for permission gating', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../components/settings-view.tsx'),
      'utf-8'
    );

    // Must import can
    expect(source).toMatch(/import.*can.*from.*permissions/);
    // Must NOT contain isAdmin
    expect(source).not.toMatch(/const\s+isAdmin/);
    // Must use can() for section guards
    expect(source).toMatch(/can\(role,/);
  });
});
