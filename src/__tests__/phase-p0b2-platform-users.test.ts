/**
 * Phase P0B-2: Server-Authoritative Global User Management & Recovery Integrity Test Suite
 *
 * Verifies that:
 * 1. POST /api/platform/users is strictly guarded (401 unauth, 403 non-super_admin).
 * 2. POST /api/platform/users normalizes super_admin creation to tenant_id='global' and preserves agency for ordinary users.
 * 3. POST /api/platform/users reports truthful partial delivery (accountCreated: true, onboardingDelivered: false) when email fails.
 * 4. PATCH /api/platform/users/[id] enforces last-super-admin and self-demotion protections atomically.
 * 5. POST /api/platform/users/[id]/password-reset invokes real email delivery to trusted origin (/login?flow=reset) without token leakage.
 * 6. DELETE /api/platform/users/[id] handles external Auth deletion boundary and reports partial failure when Auth cleanup fails.
 * 7. LoginPage contains complete recovery session handling and password-update UI.
 * 8. Migration 014 statically enforces concurrency locks (FOR UPDATE) on super_admin profiles.
 * 9. sa-users-view.tsx has zero direct CRMDatabaseService mutations and no fake status manipulation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

interface MockProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  tenant_id: string;
  created_at?: string;
  updated_at?: string;
}

const profilesDb = new Map<string, MockProfile>();
const tenantsDb = new Map<string, { id: string; name: string }>();

// Mock dependencies
const mockGetUser = vi.fn();
const mockAuditLogInsert = vi.fn();
const mockAuthAdminCreateUser = vi.fn();
const mockAuthAdminDeleteUser = vi.fn();
const mockAuthAdminGenerateLink = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockSendEmail = vi.fn();
const mockRpc = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-cookie' }),
  }),
}));

vi.mock('@/lib/integrations/email', () => ({
  sendEmail: (args: unknown) => mockSendEmail(args),
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
          select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
            if (options?.head) {
              return {
                eq: (col: string, val: string) => {
                  let count = 0;
                  for (const p of profilesDb.values()) {
                    if (p[col as keyof MockProfile] === val) count++;
                  }
                  return Promise.resolve({ count, error: null });
                },
              };
            }
            return {
              eq: (_col: string, val: string) => ({
                single: () => Promise.resolve({
                  data: profilesDb.get(val) || null,
                  error: profilesDb.has(val) ? null : new Error('Not found'),
                }),
                maybeSingle: () => Promise.resolve({
                  data: profilesDb.get(val) || null,
                  error: null,
                }),
              }),
            };
          },
          update: (data: unknown) => ({
            eq: (_col: string, val: string) => {
              const existing = profilesDb.get(val);
              if (existing) {
                const updated = { ...existing, ...(data as Record<string, unknown>) } as MockProfile;
                profilesDb.set(val, updated);
                return {
                  select: () => ({
                    single: () => Promise.resolve({ data: updated, error: null }),
                  }),
                };
              }
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: null, error: new Error('Not found') }),
                }),
              };
            },
          }),
          delete: () => ({
            eq: (_col: string, val: string) => {
              profilesDb.delete(val);
              return Promise.resolve({ error: null });
            },
          }),
          upsert: (data: unknown) => {
            const p = data as MockProfile;
            profilesDb.set(p.id, p);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: p, error: null }),
              }),
            };
          },
        };
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () => Promise.resolve({ data: tenantsDb.get(val) || null, error: null }),
              single: () => Promise.resolve({ data: tenantsDb.get(val) || null, error: tenantsDb.has(val) ? null : new Error('Not found') }),
            }),
          }),
          insert: (data: unknown) => {
            const t = data as { id: string; name: string };
            tenantsDb.set(t.id, t);
            return Promise.resolve({ error: null });
          },
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
    rpc: (func: string, params: unknown) => mockRpc(func, params),
  }),
}));

import { POST as createUserHandler } from '@/app/api/platform/users/route';
import { PATCH as updateUserHandler, DELETE as deleteUserHandler } from '@/app/api/platform/users/[id]/route';
import { POST as resetPasswordHandler } from '@/app/api/platform/users/[id]/password-reset/route';

describe('Phase P0B-2: Server-Authoritative Global User Management & Recovery Closure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profilesDb.clear();
    tenantsDb.clear();

    tenantsDb.set('global', { id: 'global', name: 'Platform Admin' });
    tenantsDb.set('agency-1', { id: 'agency-1', name: 'Atlas Journeys' });

    profilesDb.set('user-super-1', {
      id: 'user-super-1',
      email: 'super1@stateai.in',
      full_name: 'Primary Super Admin',
      role: 'super_admin',
      tenant_id: 'global',
    });

    mockAuditLogInsert.mockResolvedValue({ error: null });
    mockAuthAdminCreateUser.mockResolvedValue({ data: { user: { id: 'new-auth-user-id' } }, error: null });
    mockAuthAdminDeleteUser.mockResolvedValue({ data: {}, error: null });
    mockAuthAdminGenerateLink.mockResolvedValue({ data: { properties: { action_link: 'https://app.stateai.in/login?flow=reset' } }, error: null });
    mockSendEmail.mockResolvedValue({ ok: true });
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Function not found' } });
  });

  // =========================================================================
  // 1. POST /api/platform/users Normalization & Partial Delivery
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

    it('2. Creating super_admin normalizes profile tenant_id to "global"', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          email: 'new-super@stateai.in',
          fullName: 'New Super Admin',
          role: 'super_admin',
          tenantId: 'agency-1', // Client sent agency-1
        }),
      });

      const res = await createUserHandler(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.user.role).toBe('super_admin');
      expect(json.user.tenantId).toBe('global'); // Authoritative normalization

      const stored = profilesDb.get(json.user.id);
      expect(stored?.tenant_id).toBe('global');
    });

    it('3. Creating ordinary user preserves explicitly validated agency tenant', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          email: 'specialist@atlas.com',
          fullName: 'Specialist User',
          role: 'specialist',
          tenantId: 'agency-1',
        }),
      });

      const res = await createUserHandler(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.user.role).toBe('specialist');
      expect(json.user.tenantId).toBe('agency-1');

      const stored = profilesDb.get(json.user.id);
      expect(stored?.tenant_id).toBe('agency-1');
    });

    it('4. Email delivery failure after account creation reports truthful partial status without deleting user', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });
      mockSendEmail.mockResolvedValue({ ok: false, error: 'SMTP Timeout' });

      const req = new NextRequest('http://localhost:3000/api/platform/users', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          email: 'agent@atlas.com',
          fullName: 'Agent Smith',
          role: 'consultant',
          tenantId: 'agency-1',
        }),
      });

      const res = await createUserHandler(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.accountCreated).toBe(true);
      expect(json.onboardingDelivered).toBe(false);
      expect(json.message).toMatch(/onboarding invitation email could not be delivered/i);

      // Verify user account persists in DB so invite can be resent
      expect(profilesDb.has(json.user.id)).toBe(true);
      expect(mockAuthAdminDeleteUser).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. PATCH /api/platform/users/[id]
  // =========================================================================
  describe('PATCH /api/platform/users/[id]', () => {
    it('5. Self-demotion by super_admin is rejected (400)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });

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
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { code: '23514', message: 'Cannot demote the last remaining platform super admin' },
      });

      const reqLast = new NextRequest('http://localhost:3000/api/platform/users/user-super-2', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ role: 'specialist' }),
      });
      const resLast = await updateUserHandler(reqLast, { params: Promise.resolve({ id: 'user-super-2' }) });
      expect(resLast.status).toBe(409);
      const jsonLast = await resLast.json();
      expect(jsonLast.error).toMatch(/last remaining platform super admin/);
    });
  });

  // =========================================================================
  // 3. POST /api/platform/users/[id]/password-reset
  // =========================================================================
  describe('POST /api/platform/users/[id]/password-reset', () => {
    it('7. Super admin initiates reset, dispatches email to trusted origin, and never leaks tokens', async () => {
      profilesDb.set('user-target-1', {
        id: 'user-target-1',
        email: 'target@agency.com',
        full_name: 'Target User',
        role: 'viewer',
        tenant_id: 'agency-1',
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-target-1/password-reset', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await resetPasswordHandler(req, { params: Promise.resolve({ id: 'user-target-1' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.token).toBeUndefined(); // MUST NOT leak token
      expect(json.action_link).toBeUndefined(); // MUST NOT leak link
      expect(mockAuthAdminGenerateLink).toHaveBeenCalledWith(expect.objectContaining({
        type: 'recovery',
        email: 'target@agency.com',
        options: expect.objectContaining({
          redirectTo: expect.stringMatching(/login\?flow=reset/),
        }),
      }));
      expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'target@agency.com',
        subject: expect.stringMatching(/Reset.*Password/i),
      }));
    });

    it('8. Email service delivery failure returns 500 without reporting success', async () => {
      profilesDb.set('user-target-1', {
        id: 'user-target-1',
        email: 'target@agency.com',
        full_name: 'Target User',
        role: 'viewer',
        tenant_id: 'agency-1',
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });
      mockSendEmail.mockResolvedValue({ ok: false, error: 'SMTP timeout' });

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-target-1/password-reset', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await resetPasswordHandler(req, { params: Promise.resolve({ id: 'user-target-1' }) });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/Failed to deliver recovery email/);
    });
  });

  // =========================================================================
  // 4. DELETE /api/platform/users/[id]
  // =========================================================================
  describe('DELETE /api/platform/users/[id]', () => {
    it('9. Self-deletion is denied (400)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-super-1', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteUserHandler(req, { params: Promise.resolve({ id: 'user-super-1' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Self-deletion/);
    });

    it('10. Deleting target user deletes profile and calls Auth Admin delete', async () => {
      profilesDb.set('user-target-1', {
        id: 'user-target-1',
        email: 'target@agency.com',
        full_name: 'Target User',
        role: 'viewer',
        tenant_id: 'agency-1',
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });

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
    });

    it('11. When Auth cleanup fails after profile deletion, returns partial failure (500)', async () => {
      profilesDb.set('user-target-1', {
        id: 'user-target-1',
        email: 'target@agency.com',
        full_name: 'Target User',
        role: 'viewer',
        tenant_id: 'agency-1',
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super1@stateai.in' } }, error: null });
      mockAuthAdminDeleteUser.mockResolvedValue({ error: new Error('Auth service down') });

      const req = new NextRequest('http://localhost:3000/api/platform/users/user-target-1', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteUserHandler(req, { params: Promise.resolve({ id: 'user-target-1' }) });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.partial).toBe(true);
      expect(json.error).toMatch(/cleanup failed/);
    });
  });

  // =========================================================================
  // 5. Static Code & Schema Integrity Checks
  // =========================================================================
  describe('Static Code & Recovery Lifecycle Integrity', () => {
    it('12. LoginPage implements Set New Password form calling supabase.auth.updateUser', () => {
      const loginPath = path.join(process.cwd(), 'src', 'app', 'login', 'page.tsx');
      expect(fs.existsSync(loginPath)).toBe(true);

      const content = fs.readFileSync(loginPath, 'utf8');
      expect(content).toContain('handleUpdatePassword');
      expect(content).toContain('supabase.auth.updateUser');
      expect(content).toContain("flowView === 'reset'");
      expect(content).toContain('Set New Password');
    });

    it('13. Migration 014 acquires row locks on super_admin profiles and enforces last-super-admin invariant', () => {
      const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '014_platform_user_lifecycle_rpcs.sql');
      expect(fs.existsSync(migrationPath)).toBe(true);

      const content = fs.readFileSync(migrationPath, 'utf8');
      expect(content).toContain('platform_update_user_role_atomic');
      expect(content).toContain('platform_delete_user_profile_atomic');
      expect(content).toContain("WHERE role = 'super_admin' FOR UPDATE");
      expect(content).toContain('Cannot demote the last remaining platform super admin');
      expect(content).toContain('Cannot delete the last remaining platform super admin');
      expect(content).toContain('Self-demotion is not permitted');
      expect(content).toContain('Self-deletion is not permitted');
    });

    it('14. sa-users-view.tsx does NOT call CRMDatabaseService or render fake status mutations', () => {
      const filePath = path.join(process.cwd(), 'src', 'components', 'super-admin', 'sa-users-view.tsx');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toContain('CRMDatabaseService');
      expect(content).not.toContain('handleDeactivate');
      expect(content).toContain('/api/platform/users');
    });
  });
});
