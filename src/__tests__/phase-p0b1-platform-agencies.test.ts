/**
 * Phase P0B-1: Server-Authoritative & Transactional Agency Management Mutations Test Suite
 *
 * Verifies that:
 * 1. POST /api/platform/agencies is strictly guarded (401 unauth, 403 non-super_admin).
 * 2. POST /api/platform/agencies validates payload and delegates to atomic RPC platform_create_agency_atomic.
 * 3. POST /api/platform/agencies handles slug conflict (409) and validation errors (400) without partial writes.
 * 4. PATCH /api/platform/agencies/[id] is strictly guarded and delegates to atomic RPC platform_edit_agency_atomic.
 * 5. PATCH /api/platform/agencies/[id] handles 404 on missing target agency.
 * 6. DELETE /api/platform/agencies/[id] is strictly guarded, blocks system tenants, and delegates to atomic RPC platform_delete_agency_atomic.
 * 7. Cross-origin requests with mismatched Origin/Host are rejected (403).
 * 8. Static schema verification: Migration 013 covers canonical Stage A entities (bookings, inquiries, traveler_profiles).
 * 9. Fail-closed contract: RPC failure returns sanitized server error without unsafe sequential fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
const mockGetUser = vi.fn();
const mockProfileSelect = vi.fn();
const mockRpc = vi.fn();

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

import { POST as createAgencyHandler } from '@/app/api/platform/agencies/route';
import { PATCH as updateAgencyHandler, DELETE as deleteAgencyHandler } from '@/app/api/platform/agencies/[id]/route';

describe('Phase P0B-1: Transactional Agency Management Mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. POST /api/platform/agencies Authorization, Validation & Atomic RPC
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
      expect(mockRpc).not.toHaveBeenCalled();
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
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('3. Invalid agency payload (short name, invalid slug) returns 400 without RPC call', async () => {
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
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('4. Duplicate agency slug returns 409 Conflict from atomic RPC', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockRpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'Conflict: An agency with slug already exists.' } });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ name: 'Existing Agency', slug: 'existing-agency' }),
      });

      const res = await createAgencyHandler(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/already exists/);
      expect(mockRpc).toHaveBeenCalledWith('platform_create_agency_atomic', expect.objectContaining({
        p_name: 'Existing Agency',
        p_slug: 'existing-agency',
      }));
    });

    it('5. Valid create request invokes platform_create_agency_atomic and returns 201', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockRpc.mockResolvedValue({
        data: {
          id: 'atlas-journeys',
          name: 'Atlas Journeys',
          slug: 'atlas-journeys',
          domain: 'atlasjourneys.com',
          plan: 'growth',
          status: 'active',
          settings: { aiBudget: 250, features: { pipeline: true, chatbot: true } },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        error: null,
      });

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
      expect(mockRpc).toHaveBeenCalledWith('platform_create_agency_atomic', expect.objectContaining({
        p_name: 'Atlas Journeys',
        p_slug: 'atlas-journeys',
        p_plan: 'growth',
        p_ai_budget: 250,
      }));
    });
  });

  // =========================================================================
  // 2. PATCH /api/platform/agencies/[id] Edit & Status Operations
  // =========================================================================
  describe('PATCH /api/platform/agencies/[id]', () => {
    it('6. Non-super_admin user is denied agency editing (403)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-specialist', email: 'user@agency.com' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'specialist', tenant_id: 'agency-1' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-1', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ name: 'Hacked Name' }),
      });

      const res = await updateAgencyHandler(req, { params: Promise.resolve({ id: 'agency-1' }) });
      expect(res.status).toBe(403);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('7. Missing target agency returns 404 from atomic edit RPC', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockRpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'Not found: Agency "non-existent" does not exist.' } });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/non-existent', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      const res = await updateAgencyHandler(req, { params: Promise.resolve({ id: 'non-existent' }) });
      expect(res.status).toBe(404);
      expect(mockRpc).toHaveBeenCalledWith('platform_edit_agency_atomic', expect.objectContaining({
        p_tenant_id: 'non-existent',
      }));
    });

    it('8. Super admin can edit configuration and status atomically via RPC', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockRpc.mockResolvedValue({
        data: {
          id: 'agency-target',
          name: 'Renamed Agency',
          slug: 'agency-target',
          status: 'suspended',
          plan: 'enterprise',
          primaryColor: '#00AAFF',
          updatedAt: new Date().toISOString(),
        },
        error: null,
      });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-target', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'Renamed Agency',
          primaryColor: '#00AAFF',
          plan: 'enterprise',
          status: 'suspended',
        }),
      });

      const res = await updateAgencyHandler(req, { params: Promise.resolve({ id: 'agency-target' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.tenant.plan).toBe('enterprise');
      expect(json.tenant.status).toBe('suspended');
      expect(mockRpc).toHaveBeenCalledWith('platform_edit_agency_atomic', expect.objectContaining({
        p_tenant_id: 'agency-target',
        p_name: 'Renamed Agency',
        p_primary_color: '#00AAFF',
        p_plan: 'enterprise',
        p_status: 'suspended',
      }));
    });
  });

  // =========================================================================
  // 3. DELETE /api/platform/agencies/[id] Atomic Deletion Operations
  // =========================================================================
  describe('DELETE /api/platform/agencies/[id]', () => {
    it('9. Non-super_admin is denied agency deletion (403)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-admin', email: 'admin@agency.com' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'admin', tenant_id: 'agency-1' }, error: null });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-1', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteAgencyHandler(req, { params: Promise.resolve({ id: 'agency-1' }) });
      expect(res.status).toBe(403);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('10. Attempt to delete system tenant "global" is rejected (400) before RPC', async () => {
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
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('11. Super admin can delete target agency atomically via platform_delete_agency_atomic', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockRpc.mockResolvedValue({
        data: { success: true, deletedId: 'agency-to-delete' },
        error: null,
      });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-to-delete', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteAgencyHandler(req, { params: Promise.resolve({ id: 'agency-to-delete' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.deletedId).toBe('agency-to-delete');
      expect(mockRpc).toHaveBeenCalledWith('platform_delete_agency_atomic', {
        p_tenant_id: 'agency-to-delete',
      });
    });

    it('12. RPC failure fails closed without sequential fallback', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super', email: 'super@stateai.in' } }, error: null });
      mockProfileSelect.mockResolvedValue({ data: { role: 'super_admin', tenant_id: 'global' }, error: null });
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'XX000', message: 'Database transaction lock timeout' },
      });

      const req = new NextRequest('http://localhost:3000/api/platform/agencies/agency-to-delete', {
        method: 'DELETE',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
      });

      const res = await deleteAgencyHandler(req, { params: Promise.resolve({ id: 'agency-to-delete' }) });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/Deletion failed/);
    });

    it('13. Cross-origin request with mismatched origin/host is blocked (403)', async () => {
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

  // =========================================================================
  // 4. Static Migration & Schema Integrity Checks
  // =========================================================================
  describe('Static Migration 013 Integrity', () => {
    it('14. Migration 013 explicitly includes canonical Stage A entities in delete sequence', () => {
      const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '013_platform_agency_lifecycle_rpcs.sql');
      expect(fs.existsSync(migrationPath)).toBe(true);

      const content = fs.readFileSync(migrationPath, 'utf8');

      // Canonical Stage A entities
      expect(content).toContain('DELETE FROM public.bookings WHERE tenant_id = p_tenant_id;');
      expect(content).toContain('DELETE FROM public.inquiries WHERE tenant_id = p_tenant_id;');
      expect(content).toContain('DELETE FROM public.traveler_profiles WHERE tenant_id = p_tenant_id;');

      // Order check: bookings before inquiries before traveler_profiles
      const bookingsIdx = content.indexOf('DELETE FROM public.bookings');
      const inquiriesIdx = content.indexOf('DELETE FROM public.inquiries');
      const travelersIdx = content.indexOf('DELETE FROM public.traveler_profiles');
      const tenantsIdx = content.indexOf('DELETE FROM public.tenants');

      expect(bookingsIdx).toBeLessThan(inquiriesIdx);
      expect(inquiriesIdx).toBeLessThan(travelersIdx);
      expect(travelersIdx).toBeLessThan(tenantsIdx);

      // Audit scoping under global
      expect(content).toContain("'global'");
      expect(content).toContain("'agency.deleted'");
      expect(content).toContain("'agency.created'");
    });
  });
});
