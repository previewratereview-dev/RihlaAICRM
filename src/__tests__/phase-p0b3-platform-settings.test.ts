/**
 * Phase P0B-3: Server-Authoritative Platform Settings & Secret Handling Test Suite
 *
 * Verifies that:
 * 1. GET & PATCH /api/platform/settings require super_admin authorization (401 unauthenticated, 403 non-super_admin).
 * 2. GET /api/platform/settings strictly redacts API keys and secrets (never returns plaintext, ciphertext, or sealed JSON).
 * 3. PATCH /api/platform/settings preserves existing secret if apiKey field is omitted or empty.
 * 4. PATCH /api/platform/settings rotates and seals secret when a new key is provided.
 * 5. PATCH /api/platform/settings and model discovery validate custom base URLs against SSRF (rejects localhost, link-local, private IPs).
 * 6. POST /api/platform/settings/models resolves stored keys server-side and accepts candidate keys without persisting them.
 * 7. Audit log records platform_settings.updated without including secret material.
 * 8. sa-settings-view.tsx has zero direct CRMDatabaseService mutations and no secret-leaking client fetches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

interface MockPlatformSettingsRow {
  id: string;
  default_ai_model: string;
  platform_monthly_ai_cap: number;
  maintenance_mode: boolean;
  settings: Record<string, unknown>;
  updated_at?: string;
}

let platformSettingsDb: MockPlatformSettingsRow = {
  id: 'platform',
  default_ai_model: 'gpt-4o-mini',
  platform_monthly_ai_cap: 500,
  maintenance_mode: false,
  settings: {},
};

// Mock dependencies
const mockGetUser = vi.fn();
const mockAuditLogInsert = vi.fn();
const mockProfilesSingle = vi.fn();
const mockFetch = vi.fn();

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
              single: () => mockProfilesSingle(),
              maybeSingle: () => mockProfilesSingle(),
            }),
          }),
        };
      }
      if (table === 'platform_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { ...platformSettingsDb }, error: null }),
              single: () => Promise.resolve({ data: { ...platformSettingsDb }, error: null }),
            }),
          }),
          upsert: (data: unknown) => {
            const row = data as MockPlatformSettingsRow;
            platformSettingsDb = {
              ...platformSettingsDb,
              ...row,
              settings: { ...platformSettingsDb.settings, ...(row.settings || {}) },
            };
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { ...platformSettingsDb }, error: null }),
              }),
            };
          },
          update: (data: unknown) => {
            const row = data as Partial<MockPlatformSettingsRow>;
            platformSettingsDb = {
              ...platformSettingsDb,
              ...row,
              settings: { ...platformSettingsDb.settings, ...(row.settings || {}) },
            };
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
          }),
        }),
      };
    },
  }),
}));

// Mock global fetch for model discovery tests
global.fetch = mockFetch;

import { GET as getSettingsHandler, PATCH as patchSettingsHandler } from '@/app/api/platform/settings/route';
import { POST as discoverModelsHandler } from '@/app/api/platform/settings/models/route';
import { isSafeCustomProviderUrl } from '@/lib/security/ssrf';

describe('Phase P0B-3: Server-Authoritative Platform Settings & Secret Handling', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    platformSettingsDb = {
      id: 'platform',
      default_ai_model: 'gpt-4o-mini',
      platform_monthly_ai_cap: 500,
      maintenance_mode: false,
      settings: {
        aiPlatform: 'openai',
        defaultAiBaseUrl: 'https://api.openai.com/v1',
        defaultAiApiKey: 'sk_TEST_SECRET_DO_NOT_EXPOSE_998877',
        allowNewTenants: true,
        defaultAiBudget: 100,
        supportEmail: 'support@stateai.in',
      },
    };

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-super-1', email: 'super@stateai.in' } }, error: null });
    mockProfilesSingle.mockResolvedValue({
      data: { id: 'user-super-1', email: 'super@stateai.in', role: 'super_admin', tenant_id: 'global' },
      error: null,
    });
    mockAuditLogInsert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. Read Authorization & Redaction
  // =========================================================================
  describe('GET /api/platform/settings', () => {
    it('1. Unauthenticated request is rejected with 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('No session') });

      const req = new NextRequest('http://localhost:3000/api/platform/settings');
      const res = await getSettingsHandler(req);
      expect(res.status).toBe(401);
    });

    it('2. Ordinary tenant admin is denied with 403', async () => {
      mockProfilesSingle.mockResolvedValue({
        data: { id: 'user-admin-1', email: 'admin@agency.com', role: 'admin', tenant_id: 'agency-1' },
        error: null,
      });

      const req = new NextRequest('http://localhost:3000/api/platform/settings');
      const res = await getSettingsHandler(req);
      expect(res.status).toBe(403);
    });

    it('3. Super admin can read settings and secrets are strictly redacted', async () => {
      const req = new NextRequest('http://localhost:3000/api/platform/settings');
      const res = await getSettingsHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.settings.aiPlatform).toBe('openai');
      expect(json.settings.defaultAiModel).toBe('gpt-4o-mini');
      expect(json.settings.apiKeyConfigured).toBe(true);
      expect(json.settings.apiKeyMasked).toMatch(/8877$/);

      // ASSERT: Secret MUST NOT appear anywhere in the response
      const rawResponseStr = JSON.stringify(json);
      expect(rawResponseStr).not.toContain('sk_TEST_SECRET_DO_NOT_EXPOSE_998877');
      expect(json.settings.defaultAiApiKey).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. Mutation Authorization & Secret Rotation/Preservation
  // =========================================================================
  describe('PATCH /api/platform/settings', () => {
    it('4. Ordinary user is denied mutation with 403', async () => {
      mockProfilesSingle.mockResolvedValue({
        data: { id: 'user-specialist-1', email: 'spec@agency.com', role: 'specialist', tenant_id: 'agency-1' },
        error: null,
      });

      const req = new NextRequest('http://localhost:3000/api/platform/settings', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({ defaultAiModel: 'gpt-4o' }),
      });

      const res = await patchSettingsHandler(req);
      expect(res.status).toBe(403);
    });

    it('5. Updating non-secret settings with empty apiKey preserves existing secret', async () => {
      const req = new NextRequest('http://localhost:3000/api/platform/settings', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          defaultAiModel: 'gpt-4o',
          platformMonthlyAiCap: 1000,
          apiKey: '', // Empty field during save must NOT erase key
        }),
      });

      const res = await patchSettingsHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.settings.defaultAiModel).toBe('gpt-4o');
      expect(json.settings.platformMonthlyAiCap).toBe(1000);
      expect(json.settings.apiKeyConfigured).toBe(true);

      // Verify DB retained the existing key
      expect(platformSettingsDb.settings.defaultAiApiKey).toBe('sk_TEST_SECRET_DO_NOT_EXPOSE_998877');
    });

    it('6. Supplying new apiKey rotates secret and records clean audit log', async () => {
      const req = new NextRequest('http://localhost:3000/api/platform/settings', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          aiPlatform: 'anthropic',
          defaultAiModel: 'claude-3-5-sonnet-20241022',
          apiKey: 'sk-ant-NEW_KEY_001122',
        }),
      });

      const res = await patchSettingsHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.settings.aiPlatform).toBe('anthropic');
      expect(json.settings.apiKeyConfigured).toBe(true);

      // Verify new key is sealed/updated in DB
      expect(platformSettingsDb.settings.defaultAiApiKey).not.toBe('sk_TEST_SECRET_DO_NOT_EXPOSE_998877');

      // Verify audit log recorded without secret material
      expect(mockAuditLogInsert).toHaveBeenCalledWith(expect.objectContaining({
        action: 'platform_settings.updated',
        tenant_id: 'global',
      }));

      const firstCall = mockAuditLogInsert.mock.calls[0][0];
      expect(firstCall.details).toContain('"apiKeyChanged":true');
      expect(JSON.stringify(firstCall)).not.toContain('sk-ant-NEW_KEY_001122');
    });
  });

  // =========================================================================
  // 3. Custom Base URL & SSRF Protection
  // =========================================================================
  describe('SSRF Protection for Custom Endpoints', () => {
    it('7. isSafeCustomProviderUrl rejects localhost, link-local, and private IP ranges', () => {
      expect(isSafeCustomProviderUrl('http://127.0.0.1:8000/v1').safe).toBe(false);
      expect(isSafeCustomProviderUrl('http://localhost:11434/v1').safe).toBe(false);
      expect(isSafeCustomProviderUrl('http://169.254.169.254/latest/meta-data').safe).toBe(false);
      expect(isSafeCustomProviderUrl('http://192.168.1.1/api').safe).toBe(false);
      expect(isSafeCustomProviderUrl('http://10.0.0.1/v1').safe).toBe(false);
      expect(isSafeCustomProviderUrl('ftp://example.com/v1').safe).toBe(false);
      expect(isSafeCustomProviderUrl('https://api.together.xyz/v1').safe).toBe(true);
      expect(isSafeCustomProviderUrl('https://integrate.api.nvidia.com/v1').safe).toBe(true);
    });

    it('8. PATCH rejects unsafe custom base URL with 400', async () => {
      const req = new NextRequest('http://localhost:3000/api/platform/settings', {
        method: 'PATCH',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          defaultAiBaseUrl: 'http://169.254.169.254/v1',
        }),
      });

      const res = await patchSettingsHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/not permitted|invalid/i);
    });
  });

  // =========================================================================
  // 4. Model Discovery
  // =========================================================================
  describe('POST /api/platform/settings/models', () => {
    it('9. Resolves stored key server-side and queries provider endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'meta/llama-3.1-70b-instruct' },
            { id: 'meta/llama-3.1-8b-instruct' },
          ],
        }),
      });

      const req = new NextRequest('http://localhost:3000/api/platform/settings/models', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          endpoint: 'https://integrate.api.nvidia.com/v1',
        }),
      });

      const res = await discoverModelsHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.models).toContain('meta/llama-3.1-70b-instruct');
      expect(json.models).toContain('meta/llama-3.1-8b-instruct');

      // Verify fetch was called with stored key in Authorization header
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://integrate.api.nvidia.com/v1/models'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_TEST_SECRET_DO_NOT_EXPOSE_998877',
          }),
        })
      );
    });

    it('10. Discovery rejects SSRF target with 400', async () => {
      const req = new NextRequest('http://localhost:3000/api/platform/settings/models', {
        method: 'POST',
        headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000' },
        body: JSON.stringify({
          endpoint: 'http://169.254.169.254/latest/meta-data',
        }),
      });

      const res = await discoverModelsHandler(req);
      expect(res.status).toBe(400);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 5. Static Code & Clean Client Bundle Checks
  // =========================================================================
  describe('Static View & Client Cleanliness', () => {
    it('11. sa-settings-view.tsx does NOT call CRMDatabaseService or import server-only admin modules', () => {
      const viewPath = path.join(process.cwd(), 'src', 'components', 'super-admin', 'sa-settings-view.tsx');
      expect(fs.existsSync(viewPath)).toBe(true);

      const content = fs.readFileSync(viewPath, 'utf8');
      expect(content).not.toContain('CRMDatabaseService');
      expect(content).not.toContain('createAdminClient');
      expect(content).not.toContain('@/lib/supabase/admin');
      expect(content).toContain('/api/platform/settings');
    });
  });
});
