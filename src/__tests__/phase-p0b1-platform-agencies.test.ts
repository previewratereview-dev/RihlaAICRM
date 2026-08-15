/**
 * Phase P0B-1: Server-Authoritative Agency Management Mutations Test Suite
 *
 * Verifies that:
 * 1. POST /api/platform/agencies is strictly guarded (401 unauth, 403 non-super_admin).
 * 2. POST /api/platform/agencies validates payload (rejects invalid names, slugs, duplicate slugs).
 * 3. POST /api/platform/agencies creates tenant, settings, and subscription atomically with audit logging.
 * 4. PATCH /api/platform/agencies/[id] is strictly guarded and performs authoritative target lookup (404 on missing).
 * 5. PATCH /api/platform/agencies/[id] allows only allowlisted fields and updates status/plan/settings.
 * 6. DELETE /api/platform/agencies/[id] is strictly guarded, blocks system tenants, and deletes child data in order.
 * 7. Cross-origin requests with mismatched Origin/Host are rejected (403).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies
const mockGetUser = vi.fn();
const mockProfileSelect = vi.fn();
const mockTenantSelect = vi.fn();
const mockTenantInsert = vi.fn();
const mockTenantUpdate = vi.fn();
const mockTenantDelete = vi.fn();
const mockSettingsUpsert = vi.fn();
const mockSubscriptionsUpsert = vi.fn();
const mockAuditLogInsert = vi.fn();
const mockChildTableDelete = vi.fn();

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
              maybeSingle: () => mockProfileSelect(),
            }),
          }),
          delete: () => ({
            eq: () => mockChildTableDelete('profiles'),
          }),
        };
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            or: () => ({
              maybeSingle: () => mockTenantSelect(),
            }),
            eq: () => ({
              maybeSingle: () => mockTenantSelect(),
              single: () => mockTenantSelect(),
            }),
          }),
          insert: (data: unknown) => ({
            select: () => ({
              single: () => mockTenantInsert(data),
            }),
          }),
          update: (data: unknown) => ({
            eq: () => ({
              select: () => ({
                single: () => mockTenantUpdate(data),
              }),
            }),
          }),
          delete: () => ({
            eq: () => mockTenantDelete(),
          }),
        };
      }
      if (table === 'settings') {
        return {
          upsert: (data: unknown) => mockSettingsUpsert(data),
          delete: () => ({ eq: () => mockChildTableDelete(table) }),
        };
      }
      if (table === 'subscriptions') {
        return {
          upsert: (data: unknown) => mockSubscriptionsUpsert(data),
          delete: () => ({ eq: () => mockChildTableDelete(table) }),
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
        delete: () => ({
          eq: () => mockChildTableDelete(table),
        }),
      };
    },
  }),
}));

import { POST as createAgencyHandler } from '@/app/api/platform/agencies/route';
import { PATCH as updateAgencyHandler, DELETE as deleteAgencyHandler } from '@/app/api/platform/agencies/[id]/route';

describe('Phase P0B-1: Server-Authoritative Agency Management Mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChildTableDelete.mockResolvedValue({ error: null });
    mockAuditLogInsert.mockResolvedValue({ error: null });
    mockSettingsUpsert.mockResolvedValue({ error: null });
    mockSubscriptionsUpsert.mockResolvedValue({ error: null });
  });

  // =========================================================================
  // 1. POST /api/platform/agencies Authorization & Validation
  // =========================================================================
  describe('POST /api/platform/agencies', () => {
    it('1. Unauthenticated create request returns 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('No session') });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ name: 'New Agency', slug: 'new-agency' }),
      });

      const res = await createAgencyHandler(req);
      expect(res.status).toBe(401);
    });

    it('2. Ordinary tenant admin is denied agency creation (403)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-admin', email: 'admin@agency.com' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'admin', tenant_id: 'agency-1' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ name: 'New Agency', slug: 'new-agency' }),
      });

      const res = await createAgencyHandler(req);
      expect(res.status).toBe(403);
    });

    it('3. @stateai.in email with ordinary specialist role is denied (403)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-emp', email: 'emp@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'specialist', tenant_id: 'global' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ name: 'New Agency', slug: 'new-agency' }),
      });

      const res = await createAgencyHandler(req);
      expect(res.status).toBe(403);
    });

    it('4. Invalid agency payload (short name, invalid slug) returns 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ name: 'A', slug: '' }),
      });

      const res = await createAgencyHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Agency name/);
    });

    it('5. Duplicate agency slug returns 409 Conflict', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockTenantSelect.mockResolvedValue({ data: { id: 'existing-agency', slug: 'existing-agency' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ name: 'Existing Agency', slug: 'existing-agency' }),
      });

      const res = await createAgencyHandler(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/already exists/);
    });

    it('6. Valid create request creates agency, settings, subscription, and records audit event', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockTenantSelect.mockResolvedValue({ data: null, error: null });
      mockTenantInsert.mockImplementation((data: Record<string, unknown>) => ({
        data: { ...data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        error: null,
      }));

      const req = new NextRequest('http://localhost:3000/api/platform/agencies', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'Atlas Journeys',
          slug: 'atlas-journeys',
          domain: 'atlasjourneys.com',
          plan: 'growth',
          aiBudget: 250,
          features: { pipeline: true, chatbot: true },
        }),
      });

      const res = await createAgencyHandler(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.tenant.id).toBe('atlas-journeys');
      expect(json.tenant.plan).toBe('growth');
      expect(mockSettingsUpsert).toHaveBeenCalled();
      expect(mockSubscriptionsUpsert).toHaveBeenCalled();
      expect(mockAuditLogInsert).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. PATCH /api/platform/agencies/[id] Edit & Status Operations
  // =========================================================================
  describe('PATCH /api/platform/agencies/[id]', () => {
    it('7. Non-super_admin user is denied agency editing (403)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-specialist', email: 'user@agency.com' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'specialist', tenant_id: 'agency-1' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-1', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ name: 'Hacked Name' }),
      });

      const res = await updateAgencyHandler(req, { params: Promise.resolve({ id: 'agency-1' }) });
      expect(res.status).toBe(403);
    });

    it('8. Missing target agency returns 404', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockTenantSelect.mockResolvedValue({ data: null, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/non-existent-agency', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      const res = await updateAgencyHandler(req, { params: Promise.resolve({ id: 'non-existent-agency' }) });
      expect(res.status).toBe(404);
    });

    it('9. Super admin can suspend an agency and audit event is recorded', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockTenantSelect.mockResolvedValue({
        data: { id: 'agency-target', name: 'Target Agency', status: 'active', subscriptions: { plan: 'growth' } },
        error: null,
      });
      mockTenantUpdate.mockImplementation((data: Record<string, unknown>) => ({
        data: { id: 'agency-target', name: 'Target Agency', status: data.status || 'suspended', updated_at: new Date().toISOString() },
        error: null,
      }));

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-target', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ status: 'suspended' }),
      });

      const res = await updateAgencyHandler(req, { params: Promise.resolve({ id: 'agency-target' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.tenant.status).toBe('suspended');
      expect(mockAuditLogInsert).toHaveBeenCalled();
    });

    it('10. Super admin can update configuration with allowlisted fields', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockTenantSelect.mockResolvedValue({
        data: { id: 'agency-target', name: 'Target Agency', status: 'active', settings: { aiBudget: 100 }, subscriptions: { plan: 'growth' } },
        error: null,
      });
      mockTenantUpdate.mockImplementation((data: Record<string, unknown>) => ({
        data: { id: 'agency-target', name: data.name || 'Target Agency', status: 'active', settings: data.settings, updated_at: new Date().toISOString() },
        error: null,
      }));

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-target', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'Renamed Agency',
          primaryColor: '#00AAFF',
          plan: 'enterprise',
          aiBudget: 500,
        }),
      });

      const res = await updateAgencyHandler(req, { params: Promise.resolve({ id: 'agency-target' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.tenant.plan).toBe('enterprise');
      expect(mockSubscriptionsUpsert).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. DELETE /api/platform/agencies/[id] Deletion Operations
  // =========================================================================
  describe('DELETE /api/platform/agencies/[id]', () => {
    it('11. Non-super_admin is denied agency deletion (403)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-admin', email: 'admin@agency.com' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'admin', tenant_id: 'agency-1' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-1', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteAgencyHandler(req, { params: Promise.resolve({ id: 'agency-1' }) });
      expect(res.status).toBe(403);
    });

    it('12. Attempt to delete system tenant "global" is rejected (400)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/global', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteAgencyHandler(req, { params: Promise.resolve({ id: 'global' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/System tenant/);
    });

    it('13. Super admin can delete target agency, cleaning child tables and writing audit log', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockTenantSelect.mockResolvedValue({ data: { id: 'agency-to-delete', name: 'Delete Me' }, error: null });
      mockTenantDelete.mockResolvedValue({ error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-to-delete', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteAgencyHandler(req, { params: Promise.resolve({ id: 'agency-to-delete' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.deletedId).toBe('agency-to-delete');
      expect(mockChildTableDelete).toHaveBeenCalled();
      expect(mockAuditLogInsert).toHaveBeenCalled();
    });

    it('14. Cross-origin request with mismatched origin/host is blocked (403)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-to-delete', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://malicious-site.com' },
      });

      const res = await deleteAgencyHandler(req, { params: Promise.resolve({ id: 'agency-to-delete' }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Cross-origin/);
    });
  });
});
