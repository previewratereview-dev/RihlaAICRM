/**
 * Phase AI-4B: Server Attention Facts Loader Tests
 * 
 * Classification: MOCKED DATA ACCESS TEST & STATIC ASSERTION
 * Verifies server-side query construction, tenant scoping, Super Admin rejection,
 * pagination completeness, tied-timestamp message boundary handling, budget parser truth table,
 * traveler count normalization truth table, and DTO normalization.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateAttentionAuth,
  loadInquiryAttentionFact,
  loadConversationAttentionFacts,
  loadTenantAttentionFacts,
  getInquiryAttentionSignals,
  getTenantAttentionSummary,
  parseBudgetValue,
  parseTravelerCount,
} from '@/lib/attention/loader';

describe('AI-4B Server Facts Loader: Budget Parser Truth Table', () => {
  it('parses all required canonical and informal budget string formats', () => {
    // Exact requested cases:
    expect(parseBudgetValue('200000')).toEqual({ min: 200000, max: 200000 });
    expect(parseBudgetValue('1-2 lakh')).toEqual({ min: 100000, max: 200000 });
    expect(parseBudgetValue('2 lakh')).toEqual({ min: 200000, max: 200000 });
    expect(parseBudgetValue('50k')).toEqual({ min: 50000, max: 50000 });
    expect(parseBudgetValue('₹1.5L')).toEqual({ min: 150000, max: 150000 });
    expect(parseBudgetValue('unknown')).toEqual({ min: null, max: null });
    expect(parseBudgetValue('flexible')).toEqual({ min: null, max: null });
    expect(parseBudgetValue('')).toEqual({ min: null, max: null });
    expect(parseBudgetValue(null)).toEqual({ min: null, max: null });
    expect(parseBudgetValue(undefined)).toEqual({ min: null, max: null });
  });

  it('parses complex ranges, rupee symbols, and Lakh notations', () => {
    expect(parseBudgetValue('₹2,50,000')).toEqual({ min: 250000, max: 250000 });
    expect(parseBudgetValue('50k - 100k')).toEqual({ min: 50000, max: 100000 });
    expect(parseBudgetValue('1.5 Lakh - 2 Lakh')).toEqual({ min: 150000, max: 200000 });
    expect(parseBudgetValue('1.5L - 2.5L')).toEqual({ min: 150000, max: 250000 });
  });

  it('does NOT invent a numeric budget when parsing is ambiguous', () => {
    expect(parseBudgetValue('tbd')).toEqual({ min: null, max: null });
    expect(parseBudgetValue('n/a')).toEqual({ min: null, max: null });
    expect(parseBudgetValue('discuss with agent')).toEqual({ min: null, max: null });
    expect(parseBudgetValue('open')).toEqual({ min: null, max: null });
  });
});

describe('AI-4B Server Facts Loader: Traveler Count Truth Table (Mandates 4, 5, 7)', () => {
  it('parses structured integers and rejects ambiguous / free-text strings without guessing', () => {
    // Exact requested cases from Mandate 7:
    expect(parseTravelerCount(null)).toBeNull();
    expect(parseTravelerCount('')).toBeNull();
    expect(parseTravelerCount(' ')).toBeNull();
    expect(parseTravelerCount('1')).toBe(1);
    expect(parseTravelerCount('4')).toBe(4);
    expect(parseTravelerCount(' 4 ')).toBe(4);
    expect(parseTravelerCount('0')).toBeNull();
    expect(parseTravelerCount('-2')).toBeNull();
    expect(parseTravelerCount('abc')).toBeNull();
    expect(parseTravelerCount('4 travelers')).toBeNull();
    expect(parseTravelerCount('2 adults + 2 children')).toBeNull();
    expect(parseTravelerCount('2.5')).toBeNull();
  });

  it('handles numeric inputs strictly', () => {
    expect(parseTravelerCount(5)).toBe(5);
    expect(parseTravelerCount(0)).toBeNull();
    expect(parseTravelerCount(-3)).toBeNull();
    expect(parseTravelerCount(2.5)).toBeNull();
  });
});

describe('AI-4B Server Facts Loader: Expected Value Boundary (Mandate 3)', () => {
  it('parseBudgetValue ONLY takes budget string and NEVER uses expected_value or deal_value', () => {
    const loaderCode = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/attention/loader.ts'),
      'utf-8'
    );

    // Static assertion: parseBudgetValue signature takes only budgetString
    expect(loaderCode).toMatch(/export function parseBudgetValue\(\s*budgetString/);
    expect(loaderCode).not.toMatch(/export function parseBudgetValue\([^)]*expectedValue/);
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
  it('correctly loads canonical inquiry and joins legacy lead details with dual tenant check', async () => {
    let leadQueryTenantId: string | null = null;
    let inqArchivedCheck = false;

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'inquiries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn((col: string, val: unknown) => {
                    if (col === 'archived_at' && val === null) {
                      inqArchivedCheck = true;
                    }
                    return {
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
                    };
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn((col: string, val: string) => {
                if (col === 'tenant_id') {
                  leadQueryTenantId = val;
                }
                return {
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
                };
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;

    const fact = await loadInquiryAttentionFact(mockSupabase, 'agency-alpha', 'inq-uuid-1');

    expect(inqArchivedCheck).toBe(true); // Verifies archived filter in query
    expect(leadQueryTenantId).toBe('agency-alpha'); // Verifies tenant check on legacy lead join
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
  it('correctly tracks contact vs agent messages and ignores system messages with deterministic order', async () => {
    let orderedById = false;

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  order: vi.fn((col: string) => {
                    if (col === 'id') orderedById = true;
                    return Promise.resolve({
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
                    });
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      { id: 'msg-1', sender_type: 'contact', created_at: '2026-08-16T09:00:00Z' },
                      { id: 'msg-2', sender_type: 'system', created_at: '2026-08-16T09:01:00Z' }, // System alert -> must NOT count as reply
                    ],
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

    const facts = await loadConversationAttentionFacts(mockSupabase, 'agency-alpha', 'inq-101');

    expect(orderedById).toBe(true); // Verifies deterministic conversation ordering
    expect(facts).toHaveLength(1);
    expect(facts[0].conversationId).toBe('conv-101');
    expect(facts[0].latestContactAt).toBe('2026-08-16T09:00:00Z');
    expect(facts[0].latestAgentAfterContactAt).toBeNull(); // System message was ignored!
  });
});

describe('AI-4B Server Facts Loader: loadTenantAttentionFacts Pagination Completeness (Mandates 9 & 10)', () => {
  it('proves requested ranges [0, 999], [1000, 1999] with order(id) and zero duplication/truncation', async () => {
    const requestedRanges: { from: number; to: number }[] = [];
    let orderedByInqId = false;
    let orderedByConvId = false;

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'inquiries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn((col: string) => {
                      if (col === 'id') orderedByInqId = true;
                      return {
                        range: vi.fn().mockImplementation((from: number, to: number) => {
                          requestedRanges.push({ from, to });
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
                      };
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
                  order: vi.fn((col: string) => {
                    if (col === 'id') orderedByConvId = true;
                    return {
                      range: vi.fn().mockResolvedValue({ data: [], error: null }),
                    };
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
      }),
    } as unknown as SupabaseClient;

    const { inquiryFacts } = await loadTenantAttentionFacts(mockSupabase, 'agency-alpha');

    expect(orderedByInqId).toBe(true); // Mandatory deterministic order verified
    expect(orderedByConvId).toBe(true);
    expect(requestedRanges).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
    expect(inquiryFacts).toHaveLength(1250);

    // Verify zero boundary duplicates
    const idSet = new Set(inquiryFacts.map((f) => f.inquiryId));
    expect(idSet.size).toBe(1250);
  });
});

describe('AI-4B Server Facts Loader: Tied-Timestamp Message Boundary (Mandates 1, 2, 11)', () => {
  it('handles tied-timestamp page boundary around row 999/1000/1001 with unique id tie-breaker', async () => {
    const orderClauses: string[] = [];
    const requestedMessageRanges: { from: number; to: number }[] = [];

    // Total 1005 messages across boundary:
    // Messages 0 to 990: created_at 08:00 to 08:16
    // Messages 991 to 1004 (14 messages): all share the EXACT same created_at "2026-08-16T08:30:00.000Z"
    const allMessages = Array.from({ length: 1005 }, (_, i) => {
      const msgId = `msg-${String(i).padStart(4, '0')}`;
      const createdAt = i < 991 
        ? `2026-08-16T08:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`
        : '2026-08-16T08:30:00.000Z'; // TIED TIMESTAMP crossing 999/1000/1001 boundary!
      return {
        id: msgId,
        conversation_id: 'conv-tied-boundary',
        sender_type: i === 1004 ? 'agent' : 'contact',
        created_at: createdAt,
      };
    });

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'inquiries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      range: vi.fn().mockResolvedValue({ data: [], error: null }),
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
                    range: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'conv-tied-boundary',
                          tenant_id: 'agency-alpha',
                          inquiry_id: null,
                          legacy_lead_id: null,
                          channel: 'whatsapp',
                          status: 'open',
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                order: vi.fn((col1: string) => {
                  let currentClause = `${col1} `;
                  return {
                    order: vi.fn((col2: string) => {
                      currentClause += `${col2} `;
                      return {
                        order: vi.fn((col3: string) => {
                          currentClause += `${col3}`;
                          orderClauses.push(currentClause.trim());
                          return {
                            range: vi.fn().mockImplementation((from: number, to: number) => {
                              requestedMessageRanges.push({ from, to });
                              const slice = allMessages.slice(from, to + 1);
                              return Promise.resolve({ data: slice, error: null });
                            }),
                          };
                        }),
                      };
                    }),
                  };
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;

    const { conversationFacts } = await loadTenantAttentionFacts(mockSupabase, 'agency-alpha');

    // Asserts deterministic unique tuple ordering on every paginated request: conversation_id ASC, created_at ASC, id ASC
    expect(orderClauses).toEqual([
      'conversation_id created_at id',
      'conversation_id created_at id',
    ]);
    
    // Asserts exact page boundary ranges requested
    expect(requestedMessageRanges).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);

    expect(conversationFacts).toHaveLength(1);
    expect(conversationFacts[0].latestContactAt).toBe('2026-08-16T08:30:00.000Z');
    // Message 1004 (agent reply) was correctly received and processed from page 2
    expect(conversationFacts[0].latestAgentAfterContactAt).toBe('2026-08-16T08:30:00.000Z');
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
                  is: vi.fn().mockReturnValue({
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
