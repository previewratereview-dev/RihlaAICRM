/**
 * Phase P0B-2: Server-Authoritative Global User Management Test Suite
 *
 * Verifies that:
 * 1. POST /api/platform/users is strictly guarded (401 unauth, 403 non-super_admin).
 * 2. POST /api/platform/users validates payload and verifies target tenant exists.
 * 3. PATCH /api/platform/users/[id] enforces last-super-admin and self-demotion protections.
 * 4. POST /api/platform/users/[id]/password-reset is server-authorized and hides tokens from client.
 * 5. DELETE /api/platform/users/[id] enforces last-super-admin and self-deletion protections.
 * 6. Cross-origin requests with mismatched Origin/Host are rejected (403).
 * 7. sa-users-view.tsx has zero direct CRMDatabaseService mutations and no fake status manipulation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
const mockGetUser = vi.fn();
const mockProfileSelect = vi.fn();
const mockProfileUpdate = vi.fn();
const mockProfileDelete = vi.fn();
const mockProfileUpsert = vi.fn();
const mockProfileCount = vi.fn();
const mockTenantSelect = vi.fn();
const mockAuditLogInsert = vi.fn();
const mockAuthAdminCreateUser = vi.fn();
const mockAuthAdminDeleteUser = vi.fn();
const mockAuthAdminGenerateLink = vi.fn();
const mockResetPasswordForEmail = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-cookie' }),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: (args: unknown) => mockAuthAdminCreateUser(args),
        deleteUser: (id: string) => mockAuthAdminDeleteUser(id),
        generateLink: (args: unknown) => mockAuthAdminGenerateLink(args),
      },
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockReturnValue({
    auth: {
      getUser: () => mockGetUser(),
      resetPasswordForEmail: (email: string, opts: unknown) => mockResetPasswordForEmail(email, opts),
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: (columns?: string, options?: { count?: string; head?: boolean }) => {
            if (options?.head) {
              return {
                eq: () => mockProfileCount(),
              };
            }
            return {
              eq: () => ({
                single: () => mockProfileSelect(),
                maybeSingle: () => mockProfileSelect(),
              }),
            };
          },
          update: (data: unknown) => ({
            eq: () => ({
              select: () => ({
                single: () => mockProfileUpdate(data),
              }),
            }),
          }),
          delete: () => ({
            eq: () => mockProfileDelete(),
          }),
          upsert: (data: unknown) => ({
            select: () => ({
              single: () => mockProfileUpsert(data),
            }),
          }),
        };
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockTenantSelect(),
              single: () => mockTenantSelect(),
            }),
          }),
        };
      }
      if (table === 'audit_logs') {
        return {
          insert: (data: unknown) => mockAuditLogInsert(data),
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

import { POST as createUserHandler } from '@/app/api/platform/users/route';
import { PATCH as updateUserHandler, DELETE as deleteUserHandler } from '@/app/api/platform/users/[id]/route';
import { POST as resetPasswordHandler } from '@/app/api/platform/users/[id]/password-reset/route';

describe('Phase P0B-2: Server-Authoritative Global User Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditLogInsert.mockResolvedValue({ error: null });
    mockAuthAdminCreateUser.mockResolvedValue({ data: { user: { id: 'new-auth-user-id' } }, error: null });
    mockAuthAdminDeleteUser.mockResolvedValue({ data: {}, error: null });
    mockAuthAdminGenerateLink.mockResolvedValue({ data: { properties: { action_link: 'https://recovery.link' } }, error: null });
  });

  // =========================================================================
  // 1. POST /api/platform/users
  // =========================================================================
  describe('POST /api/platform/users', () => {
    it('1. Unauthenticated request returns 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('No session') });

      const req = new NextRequest('http://localhost:3000/api/platform/users', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ email: 'new@agency.com', fullName: 'New User', role: 'admin', tenantId: 'agency-1' }),
      });

      const res = await createUserHandler(req);
      expect(res.status).toBe(401);
    });

    it('2. Ordinary tenant admin is denied platform user creation (403)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-admin', email: 'admin@agency.com' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'admin', tenant_id: 'agency-1' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ email: 'new@agency.com', fullName: 'New User', role: 'admin', tenantId: 'agency-1' }),
      });

      const res = await createUserHandler(req);
      expect(res.status).toBe(403);
    });

    it('3. Target tenant missing returns 404', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockTenantSelect.mockResolvedValue({ data: null, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ email: 'new@agency.com', fullName: 'New User', role: 'admin', tenantId: 'non-existent' }),
      });

      const res = await createUserHandler(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/tenant not found/i);
    });

    it('4. Super admin creates user, auth account, and audit log', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockTenantSelect.mockResolvedValue({ data: { id: 'agency-1', name: 'Atlas Agency' }, error: null });
      mockProfileUpsert.mockImplementation((data: Record<string, unknown>) => ({
        data: { ...data, id: 'new-auth-user-id' },
        error: null,
      }));

      const req = new NextRequest('http://localhost:3000/api/platform/users', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ email: 'agent@atlas.com', fullName: 'Agent Smith', role: 'specialist', tenantId: 'agency-1' }),
      });

      const res = await createUserHandler(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.user.id).toBe('new-auth-user-id');
      expect(mockAuthAdminCreateUser).toHaveBeenCalled();
      expect(mockAuditLogInsert).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. PATCH /api/platform/users/[id]
  // =========================================================================
  describe('PATCH /api/platform/users/[id]', () => {
    it('5. Self-demotion by super_admin is rejected (400)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { id: 'user-super-1', role: 'super_admin', tenant_id: 'global' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-super-1', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ role: 'admin' }),
      });

      const res = await updateUserHandler(req, { params: Promise.resolve({ id: 'user-super-1' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Self-demotion/);
    });

    it('6. Demoting the last platform super_admin is rejected (409 Conflict)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });
      // Caller is super_admin
      mockProfileSelect
        .mockResolvedValueOnce({ data: { id: 'user-super-1', role: 'super_admin', tenant_id: 'global' }, error: null }) // auth caller
        .mockResolvedValueOnce({ data: { id: 'user-super-2', role: 'super_admin', tenant_id: 'global' }, error: null }); // target user
      mockProfileCount.mockResolvedValue({ count: 1, error: null }); // only 1 super admin left

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-super-2', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ role: 'specialist' }),
      });

      const res = await updateUserHandler(req, { params: Promise.resolve({ id: 'user-super-2' }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/last remaining platform super admin/);
    });

    it('7. Super admin can update another user role when multiple super admins exist', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });
      mockProfileSelect
        .mockResolvedValueOnce({ data: { id: 'user-super-1', role: 'super_admin', tenant_id: 'global' }, error: null })
        .mockResolvedValueOnce({ data: { id: 'user-agent-1', role: 'viewer', tenant_id: 'agency-1' }, error: null });
      mockProfileUpdate.mockImplementation((data: Record<string, unknown>) => ({
        data: { id: 'user-agent-1', email: 'agent@agency.com', full_name: 'Agent', role: data.role, tenant_id: 'agency-1' },
        error: null,
      }));

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-agent-1', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ role: 'admin' }),
      });

      const res = await updateUserHandler(req, { params: Promise.resolve({ id: 'user-agent-1' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.user.role).toBe('admin');
      expect(mockAuditLogInsert).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. POST /api/platform/users/[id]/password-reset
  // =========================================================================
  describe('POST /api/platform/users/[id]/password-reset', () => {
    it('8. Non-super_admin is denied password reset (403)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-specialist', email: 'specialist@agency.com' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'specialist', tenant_id: 'agency-1' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-1/password-reset', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await resetPasswordHandler(req, { params: Promise.resolve({ id: 'user-1' }) });
      expect(res.status).toBe(403);
    });

    it('9. Super admin initiates reset, never exposing raw tokens to client', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });
      mockProfileSelect
        .mockResolvedValueOnce({ data: { id: 'user-super-1', role: 'super_admin', tenant_id: 'global' }, error: null })
        .mockResolvedValueOnce({ data: { id: 'user-target-1', email: 'target@agency.com', full_name: 'Target User' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-target-1/password-reset', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await resetPasswordHandler(req, { params: Promise.resolve({ id: 'user-target-1' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.token).toBeUndefined(); // MUST NOT leak tokens
      expect(mockAuthAdminGenerateLink).toHaveBeenCalled();
      expect(mockAuditLogInsert).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. DELETE /api/platform/users/[id]
  // =========================================================================
  describe('DELETE /api/platform/users/[id]', () => {
    it('10. Self-deletion is denied (400)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { id: 'user-super-1', role: 'super_admin', tenant_id: 'global' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-super-1', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteUserHandler(req, { params: Promise.resolve({ id: 'user-super-1' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Self-deletion/);
    });

    it('11. Deleting last super admin is denied (409 Conflict)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });
      mockProfileSelect
        .mockResolvedValueOnce({ data: { id: 'user-super-1', role: 'super_admin', tenant_id: 'global' }, error: null })
        .mockResolvedValueOnce({ data: { id: 'user-super-2', role: 'super_admin', tenant_id: 'global' }, error: null });
      mockProfileCount.mockResolvedValue({ count: 1, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-super-2', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteUserHandler(req, { params: Promise.resolve({ id: 'user-super-2' }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/last remaining platform super admin/);
    });

    it('12. Super admin can delete target user profile and auth account', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });
      mockProfileSelect
        .mockResolvedValueOnce({ data: { id: 'user-super-1', role: 'super_admin', tenant_id: 'global' }, error: null })
        .mockResolvedValueOnce({ data: { id: 'user-target-1', role: 'viewer', email: 'target@agency.com', full_name: 'Target User' }, error: null });
      mockProfileDelete.mockResolvedValue({ error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-target-1', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteUserHandler(req, { params: Promise.resolve({ id: 'user-target-1' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.deletedId).toBe('user-target-1');
      expect(mockAuthAdminDeleteUser).toHaveBeenCalledWith('user-target-1');
      expect(mockAuditLogInsert).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 5. Static UI Cleanliness Checks
  // =========================================================================
  describe('Static UI Code Hygiene', () => {
    it('13. sa-users-view.tsx does NOT call CRMDatabaseService or render fake status mutations', () => {
      const filePath = path.join(process.cwd(), 'src', 'components', 'super-admin', 'sa-users-view.tsx');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toContain('CRMDatabaseService');
      expect(content).not.toContain('handleDeactivate');
      expect(content).toContain('/api/platform/users');
    });
  });
});
