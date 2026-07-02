/**
 * Property tests for src/lib/permissions.ts
 *
 * Property 1 — Permission_Matrix completeness
 *   Validates: Requirements 1.5, 2.1–2.7
 *
 * Property 2 — can() correctness
 *   Validates: Requirements 2.9, 2.10, 2.11
 */

import { describe, it, expect } from 'vitest';
import { Permission_Matrix, can } from '@/lib/permissions';
import type { Permission } from '@/lib/permissions';

// ---------------------------------------------------------------------------
// Property 1: Permission_Matrix completeness
// Validates: Requirements 1.5, 2.1–2.7
// ---------------------------------------------------------------------------
describe('Permission_Matrix completeness', () => {
  const canonicalRoles = [
    'super_admin',
    'admin',
    'manager',
    'specialist',
    'consultant',
    'viewer',
  ] as const;

  it('every canonical role is present in the matrix', () => {
    for (const role of canonicalRoles) {
      expect(Permission_Matrix).toHaveProperty(role);
    }
  });

  it('every canonical role maps to a non-empty permissions array', () => {
    for (const role of canonicalRoles) {
      expect(Permission_Matrix[role].length).toBeGreaterThan(0);
    }
  });

  it('super_admin has all 22 permissions', () => {
    const allPermissions: Permission[] = [
      'leads:read', 'leads:write', 'leads:delete',
      'tasks:read', 'tasks:write',
      'conversations:read', 'conversations:write',
      'team:read', 'team:write',
      'analytics:read',
      'settings:profile:write', 'settings:agency:read', 'settings:agency:write',
      'settings:ai:write', 'settings:integrations:write',
      'settings:users:write', 'settings:audit:read',
      'platform:tenants:write', 'platform:users:write',
      'platform:analytics:read', 'platform:settings:write',
      'platform:impersonate',
    ];
    for (const perm of allPermissions) {
      expect(Permission_Matrix['super_admin']).toContain(perm);
    }
  });

  it('admin has no platform:* permissions', () => {
    const adminPerms = Permission_Matrix['admin'];
    const platformPerms = adminPerms.filter(p => p.startsWith('platform:'));
    expect(platformPerms).toHaveLength(0);
  });

  it('viewer has only read-level and profile-write permissions', () => {
    const viewerPerms = Permission_Matrix['viewer'];
    const expected: Permission[] = [
      'leads:read', 'tasks:read', 'conversations:read',
      'analytics:read', 'settings:profile:write',
    ];
    expect(viewerPerms.sort()).toEqual(expected.sort());
  });
});

// ---------------------------------------------------------------------------
// Property 2: can() correctness
// Validates: Requirements 2.9, 2.10, 2.11
// ---------------------------------------------------------------------------
describe('can() correctness', () => {
  it('returns true for valid role-permission combinations in the matrix', () => {
    expect(can('super_admin', 'platform:impersonate')).toBe(true);
    expect(can('admin', 'leads:write')).toBe(true);
    expect(can('manager', 'analytics:read')).toBe(true);
    expect(can('specialist', 'conversations:write')).toBe(true);
    expect(can('consultant', 'leads:read')).toBe(true);
    expect(can('viewer', 'leads:read')).toBe(true);
  });

  it('returns false for permissions not in the role matrix', () => {
    expect(can('viewer', 'leads:write')).toBe(false);
    expect(can('viewer', 'platform:impersonate')).toBe(false);
    expect(can('specialist', 'platform:impersonate')).toBe(false);
    expect(can('manager', 'settings:users:write')).toBe(false);
    expect(can('consultant', 'conversations:write')).toBe(false);
  });

  it('returns false for legacy role strings (setter, closer, member)', () => {
    // Legacy roles are in the type but have empty permission arrays
    expect(can('setter', 'leads:read')).toBe(false);
    expect(can('closer', 'leads:read')).toBe(false);
    // 'member' is not in UserRole type but should gracefully return false
    expect(can('member', 'leads:read')).toBe(false);
  });

  it('returns false for completely unrecognised role strings', () => {
    expect(can('hacker', 'leads:read')).toBe(false);
    expect(can('', 'leads:read')).toBe(false);
    expect(can('ADMIN', 'leads:read')).toBe(false);
  });

  it('cross-product: every valid role-permission pair matches matrix membership', () => {
    const roles = ['super_admin', 'admin', 'manager', 'specialist', 'consultant', 'viewer'] as const;
    const allPermissions: Permission[] = [
      'leads:read', 'leads:write', 'leads:delete',
      'tasks:read', 'tasks:write',
      'conversations:read', 'conversations:write',
      'team:read', 'team:write',
      'analytics:read',
      'settings:profile:write', 'settings:agency:read', 'settings:agency:write',
      'settings:ai:write', 'settings:integrations:write',
      'settings:users:write', 'settings:audit:read',
      'platform:tenants:write', 'platform:users:write',
      'platform:analytics:read', 'platform:settings:write',
      'platform:impersonate',
    ];

    for (const role of roles) {
      for (const permission of allPermissions) {
        const expected = Permission_Matrix[role].includes(permission);
        expect(can(role, permission)).toBe(expected);
      }
    }
  });
});
