/**
 * Phase AI-4B: Server Attention Facts Loader Tests
 * 
 * Classification: MOCKED DATA ACCESS TEST
 * Verifies server-side query construction, tenant scoping, Super Admin rejection,
 * pagination completeness, and DTO normalization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateAttentionAuth,
  loadInquiryAttentionFact,
  loadConversationAttentionFacts,
  loadTenantAttentionFacts,
  getInquiryAttentionSignals,
  getTenantAttentionSummary,
  parseBudgetValue,
} from '@/lib/attention/loader';

describe('AI-4B Server Facts Loader: Budget Parser', () => {
  it('parses numeric values, ranges, lakh/k notation correctly', () => {
    expect(parseBudgetValue('₹2,50,000', null)).toEqual({ min: 250000, max: 250000 });
    expect(parseBudgetValue('50k - 100k', null)).toEqual({ min: 50000, max: 100000 });
    expect(parseBudgetValue('1.5 Lakh - 2 Lakh', null)).toEqual({ min: 150000, max: 200000 });
    expect(parseBudgetValue(null, 300000)).toEqual({ min: 300000, max: 300000 });
    expect(parseBudgetValue('', null)).toEqual({ min: null, max: null });
    expect(parseBudgetValue(null, null)).toEqual({ min: null, max: null });
  });
});

describe('AI-4B Server Facts Loader: Authentication & Authority Boundary', () => {
  it('fails closed for Super Admin profile (403 boundary)', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'usr-super' } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'usr-super', tenant_id: 'platform-admin', role: 'super_admin' },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await validateAttentionAuth(mockSupabase);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Forbidden: Platform Super Admin cannot access Agency attention data');
  });

  it('fails closed for unauthenticated session (401 boundary)', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('No session'),
        }),
      },
    } as unknown as SupabaseClient;

    const result = await validateAttentionAuth(mockSupabase);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized: No active authenticated session');
  });

  it('fails closed for global or blank tenant scope', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'usr-agent' } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'usr-agent', tenant_id: 'global', role: 'specialist' },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await validateAttentionAuth(mockSupabase);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Forbidden: Valid agency tenant context required');
  });

  it('grants access for legitimate agency specialist with valid tenant', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'usr-agent-1' } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'usr-agent-1', tenant_id: 'agency-alpha', role: 'specialist', full_name: 'Tariq Agent' },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await validateAttentionAuth(mockSupabase);
    expect(result.success).toBe(true);
    expect(result.auth).toEqual({
      userId: 'usr-agent-1',
      tenantId: 'agency-alpha',
      role: 'specialist',
      fullName: 'Tariq Agent',
    });
  });
});

describe('AI-4B Server Facts Loader: loadInquiryAttentionFact', () => {
  it('correctly loads canonical inquiry and joins legacy lead details', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'inquiries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'inq-uuid-1',
                      tenant_id: 'agency-alpha',
                      legacy_lead_id: 'lead-legacy-1',
                      traveler_id: 'trav-uuid-1',
                      pipeline_stage: 'initial_contact',
                      assigned_agent_id: 'agent-uuid-1',
                      next_follow_up_at: '2026-08-16T10:00:00Z',
                      destination: 'Kashmir',
                      expected_value: 120000,
                      currency: 'INR',
                      archived_at: null,
                    },
                    error: null,
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
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      departure_date: '2026-09-15',
                      return_date: '2026-09-22',
                      number_of_travelers: '3',
                      budget: '₹1,00,000 - ₹1,50,000',
                      trip_type: 'Family Leisure',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;

    const fact = await loadInquiryAttentionFact(mockSupabase, 'agency-alpha', 'inq-uuid-1');

    expect(fact).not.toBeNull();
    expect(fact?.inquiryId).toBe('inq-uuid-1');
    expect(fact?.tenantId).toBe('agency-alpha');
    expect(fact?.destination).toBe('Kashmir');
    expect(fact?.departureDate).toBe('2026-09-15');
    expect(fact?.returnDate).toBe('2026-09-22');
    expect(fact?.numberOfTravelers).toBe(3);
    expect(fact?.budgetMin).toBe(100000);
    expect(fact?.budgetMax).toBe(150000);
    expect(fact?.expectedValue).toBe(120000);
  });
});

describe('AI-4B Server Facts Loader: loadConversationAttentionFacts', () => {
  it('correctly tracks contact vs agent messages and ignores system messages', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                or: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conv-101',
                      tenant_id: 'agency-alpha',
                      inquiry_id: 'inq-101',
                      legacy_lead_id: 'lead-101',
                      channel: 'whatsapp',
                      status: 'open',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    { sender_type: 'contact', created_at: '2026-08-16T09:00:00Z' },
                    { sender_type: 'system', created_at: '2026-08-16T09:01:00Z' }, // System alert -> must NOT count as reply
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;

    const facts = await loadConversationAttentionFacts(mockSupabase, 'agency-alpha', 'inq-101');

    expect(facts).toHaveLength(1);
    expect(facts[0].conversationId).toBe('conv-101');
    expect(facts[0].latestContactAt).toBe('2026-08-16T09:00:00Z');
    expect(facts[0].latestAgentAfterContactAt).toBeNull(); // System message was ignored!
  });
});

describe('AI-4B Server Facts Loader: loadTenantAttentionFacts Pagination Completeness', () => {
  it('paginates beyond 1000 items in chunks without truncation', async () => {
    let callCount = 0;

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'inquiries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    range: vi.fn().mockImplementation((from: number, to: number) => {
                      callCount++;
                      if (from === 0) {
                        // First page returns 1000 items
                        const batch = Array.from({ length: 1000 }, (_, i) => ({
                          id: `inq-${i}`,
                          tenant_id: 'agency-alpha',
                          legacy_lead_id: null,
                          traveler_id: `trav-${i}`,
                          pipeline_stage: 'inquiry_received',
                          assigned_agent_id: null,
                          next_follow_up_at: null,
                          destination: 'Goa',
                          expected_value: 50000,
                          currency: 'INR',
                          archived_at: null,
                        }));
                        return Promise.resolve({ data: batch, error: null });
                      } else {
                        // Second page returns 250 items (total 1250)
                        const batch = Array.from({ length: 250 }, (_, i) => ({
                          id: `inq-${1000 + i}`,
                          tenant_id: 'agency-alpha',
                          legacy_lead_id: null,
                          traveler_id: `trav-${1000 + i}`,
                          pipeline_stage: 'inquiry_received',
                          assigned_agent_id: null,
                          next_follow_up_at: null,
                          destination: 'Goa',
                          expected_value: 50000,
                          currency: 'INR',
                          archived_at: null,
                        }));
                        return Promise.resolve({ data: batch, error: null });
                      }
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
                  range: vi.fn().mockResolvedValue({ data: [], error: null }),
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
      }),
    } as unknown as SupabaseClient;

    const { inquiryFacts } = await loadTenantAttentionFacts(mockSupabase, 'agency-alpha');

    expect(callCount).toBe(2); // Proves paginated retrieval loop was executed
    expect(inquiryFacts).toHaveLength(1250); // Total loaded exceeds 1000 limit
  });
});

describe('AI-4B Server Facts Loader: High-Level Helper Integration', () => {
  it('getInquiryAttentionSignals resolves facts and evaluates pure signals', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'inquiries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'inq-eval-1',
                      tenant_id: 'agency-alpha',
                      legacy_lead_id: null,
                      traveler_id: 'trav-1',
                      pipeline_stage: 'inquiry_received',
                      assigned_agent_id: null, // UNASSIGNED_INQUIRY
                      next_follow_up_at: null, // NO_FOLLOW_UP_SCHEDULED
                      destination: null, // MISSING_QUALIFICATION
                      expected_value: null,
                      currency: 'INR',
                      archived_at: null,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;

    const signals = await getInquiryAttentionSignals(
      mockSupabase,
      'agency-alpha',
      'inq-eval-1',
      '2026-08-16T12:00:00Z'
    );

    expect(signals).toHaveLength(3);
    expect(signals.map((s) => s.signalType)).toEqual([
      'UNASSIGNED_INQUIRY',
      'NO_FOLLOW_UP_SCHEDULED',
      'MISSING_QUALIFICATION',
    ]);
  });
});
