/**
 * Phase AI-4C: Server Action Integration & Zero-LLM Tests
 * 
 * Classification: MOCKED SERVER/DATA ACCESS TEST & STATIC ASSERTION
 * Verifies server action authority enforcement, Super Admin fail-closed behavior,
 * and confirms zero LLM imports in AI-4C modules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock cookies
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

// Mock supabase server createClient
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockReturnValue({
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import {
  getTenantAttentionAction,
  getInquiryAttentionAction,
} from '@/app/actions/attention';

describe('AI-4C Server Actions: Authority & Isolation Boundary (Mandates 2, 32)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed when user is unauthenticated (401 boundary)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('No session'),
    });

    const result = await getTenantAttentionAction();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized: No active authenticated session');
  });

  it('fails closed when user profile is super_admin (403 boundary)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'usr-super' } },
      error: null,
    });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'usr-super', tenant_id: 'platform-admin', role: 'super_admin' },
            error: null,
          }),
        }),
      }),
    });

    const result = await getTenantAttentionAction();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Forbidden: Platform Super Admin cannot access Agency attention data');
  });

  it('fails closed for getInquiryAttentionAction when inquiryId is missing', async () => {
    const result = await getInquiryAttentionAction('');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Inquiry ID is required');
  });

  it('successfully returns tenant attention summary and signals for legitimate agency user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'usr-agent-1' } },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'usr-agent-1', tenant_id: 'agency-alpha', role: 'specialist', full_name: 'Agent One' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'inquiries') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    range: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'inq-1',
                          tenant_id: 'agency-alpha',
                          legacy_lead_id: null,
                          traveler_id: 'trav-1',
                          pipeline_stage: 'inquiry_received',
                          assigned_agent_id: null,
                          next_follow_up_at: null,
                          destination: 'Dubai',
                          expected_value: 50000,
                          currency: 'INR',
                          archived_at: null,
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'conversations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  range: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await getTenantAttentionAction();
    if (!result.success) {
      console.error('getTenantAttentionAction failed with error:', result.error);
    }

    expect(result.success).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary?.tenantId).toBe('agency-alpha');
    expect(result.summary?.signalsByType.UNASSIGNED_INQUIRY).toBe(1);
    expect(result.signals).toHaveLength(3);
  });
});

describe('AI-4C Zero-LLM Static Source Assertion (Mandates 16, 34)', () => {
  it('verifies AI-4C UI, hook, and server action modules contain ZERO LLM execution imports', () => {
    const filesToCheck = [
      'src/app/actions/attention.ts',
      'src/hooks/use-attention.ts',
      'src/components/attention/attention-badge.tsx',
      'src/components/attention/attention-drawer-section.tsx',
      'src/components/attention/dashboard-needs-attention.tsx',
      'src/components/attention/index.ts',
    ];

    for (const relPath of filesToCheck) {
      const fullPath = path.join(process.cwd(), relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf-8');

      // Zero LLM SDK imports or direct LLM execution calls
      expect(content).not.toMatch(/from ['"]openai['"]/);
      expect(content).not.toMatch(/from ['"]@anthropic-ai\/sdk['"]/);
      expect(content).not.toMatch(/from ['"]@google\/generative-ai['"]/);
      expect(content).not.toMatch(/executeAIRequest/);
      expect(content).not.toMatch(/callAIWithFallback/);
      expect(content).not.toMatch(/buildAiRuntime/);
    }
  });
});
