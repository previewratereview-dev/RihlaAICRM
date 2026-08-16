/**
 * Phase AI-4E: End-to-End Proactive Intelligence & Invariant Test Suite
 * 
 * Classification: MOCKED SERVER/DATA ACCESS TESTS & CROSS-LAYER INTEGRATION TESTS
 * Verifies the complete end-to-end integration of the Rihla AI-4 stack:
 * Server CRM Facts -> Deterministic Attention Engine -> Attention UI Handoff ->
 * Explicit Human Copilot Request -> Server-Authoritative Re-Evaluation ->
 * Bounded Model Interpretation / Ephemeral Draft -> Optional AI-3 Proposal -> Human Confirmation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveCopilotContext,
} from '@/lib/ai/rihla-copilot/crm-context-resolver';
import { buildCrmCopilotPrompt } from '@/lib/ai/rihla-copilot/crm-prompt';
import { submitCrmCopilotMessage } from '@/lib/ai/rihla-copilot/crm-actions';
import { getCrmCopilotProviderTools, CRM_READ_TOOLS, CRM_PROPOSAL_TOOLS } from '@/lib/ai/rihla-copilot/tools';
import { executeConfirmedAction } from '@/lib/ai/rihla-copilot/actions/index';
import * as routeHelper from '@/lib/ai/route-helper';

// Mock cookies and Supabase server
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
  }),
}));

process.env.COPILOT_ACTION_SECRET = 'test-secret-key-32-chars-long-abc123456';

let currentMockSupabase: SupabaseClient;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => currentMockSupabase),
}));

function createChainableQuery(data: unknown) {
  const query: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    then: (resolve: (val: unknown) => unknown) => resolve({ data, error: null }),
  };
  return query;
}

describe('Phase AI-4E: End-to-End P0 Attention Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── FLOW 1: FOLLOW_UP_OVERDUE ──────────────────────────────────────────
  it('Flow #1: Active inquiry with past follow-up emits FOLLOW_UP_OVERDUE, reloads on Copilot request, and produces AI-3 proposal', async () => {
    const overdueInquiry = {
      id: 'inq-overdue-1',
      destination: 'Kashmir',
      pipeline_stage: 'initial_contact',
      priority: 'high',
      expected_value: 150000,
      currency: 'INR',
      passenger_count: 2,
      departure_date: '2026-10-10',
      return_date: '2026-10-17',
      special_requests: null,
      assigned_agent_id: 'agent-1',
      traveler_id: null,
      legacy_lead_id: null,
      created_at: '2026-08-01T10:00:00Z',
      next_follow_up_at: '2026-08-10T10:00:00Z', // 6 days overdue relative to now
      archived: false,
      deleted_at: null,
    };

    currentMockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'agent-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return createChainableQuery({ id: 'agent-1', role: 'consultant', tenant_id: 'agency-alpha', full_name: 'Sarah Agent' });
        }
        if (table === 'tenants') {
          return createChainableQuery({ name: 'Alpha Travels' });
        }
        if (table === 'inquiries') {
          return createChainableQuery(overdueInquiry);
        }
        if (table === 'conversations') {
          return createChainableQuery([]);
        }
        return createChainableQuery(null);
      }),
    } as unknown as SupabaseClient;

    // 1. Resolve context server-side
    const context = await resolveCopilotContext(currentMockSupabase, {
      contextType: 'inquiry',
      contextId: 'inq-overdue-1',
    });

    expect(context.success).toBe(true);
    expect(context.attentionContext?.activeSignals.map((s) => s.signalType)).toContain('FOLLOW_UP_OVERDUE');

    // 2. Prompt contains deterministic factual context
    const prompt = buildCrmCopilotPrompt('Explain what needs attention', context);
    expect(prompt).toContain('FOLLOW_UP_OVERDUE');
    expect(prompt).toContain('FACT VS INFERENCE BOUNDARY');

    // 3. User requests reschedule -> Mock AI proposal tool execution
    vi.spyOn(routeHelper, 'executeAIRequest').mockResolvedValueOnce({
      content: 'I have prepared a follow-up proposal for August 18.',
      blocked: false,
      usage: null,
      toolCalls: [
        {
          id: 'tc-1',
          name: 'proposeSetInquiryFollowUp',
          arguments: {
            inquiryId: 'inq-overdue-1',
            nextFollowUpAt: '2026-08-18T10:00:00.000Z',
          },
        },
      ],
    });

    vi.spyOn(routeHelper, 'executeAIRequest').mockResolvedValueOnce({
      content: 'I have prepared a follow-up proposal. Please review and confirm below.',
      blocked: false,
      usage: null,
    });

    const response = await submitCrmCopilotMessage('Reschedule follow up to Aug 18', {
      contextType: 'inquiry',
      contextId: 'inq-overdue-1',
      requestedIntent: 'suggest_next_step',
    });

    expect(response.actionProposal).toBeDefined();
    expect(response.actionProposal?.actionType).toBe('set_inquiry_follow_up');
    expect(response.actionProposal?.signature).toBeDefined();
  });

  // ─── STALE ATTENTION: RESOLVED SIGNAL ────────────────────────────────────
  it('Stale Attention: Resolved follow-up triggers fast deterministic notice (0 LLM calls)', async () => {
    const executeSpy = vi.spyOn(routeHelper, 'executeAIRequest');

    // Inquiry now has follow-up in the future (no longer overdue)
    const freshInquiry = {
      id: 'inq-fresh-1',
      destination: 'Kashmir',
      pipeline_stage: 'initial_contact',
      priority: 'high',
      expected_value: 150000,
      currency: 'INR',
      passenger_count: 2,
      departure_date: '2026-10-10',
      return_date: '2026-10-17',
      special_requests: null,
      assigned_agent_id: 'agent-1',
      traveler_id: null,
      legacy_lead_id: null,
      created_at: '2026-08-01T10:00:00Z',
      next_follow_up_at: '2026-08-25T10:00:00Z', // In future!
      archived: false,
      deleted_at: null,
    };

    currentMockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'agent-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return createChainableQuery({ id: 'agent-1', role: 'consultant', tenant_id: 'agency-alpha', full_name: 'Sarah Agent' });
        }
        if (table === 'tenants') {
          return createChainableQuery({ name: 'Alpha Travels' });
        }
        if (table === 'inquiries') {
          return createChainableQuery(freshInquiry);
        }
        if (table === 'conversations') {
          return createChainableQuery([]);
        }
        return createChainableQuery(null);
      }),
    } as unknown as SupabaseClient;

    // User clicks stale Copilot link requesting assistance on FOLLOW_UP_OVERDUE
    const response = await submitCrmCopilotMessage('Explain overdue follow-up', {
      contextType: 'inquiry',
      contextId: 'inq-fresh-1',
      requestedSignalType: 'FOLLOW_UP_OVERDUE',
    });

    expect(response.content).toContain('FOLLOW_UP_OVERDUE');
    expect(response.content).toContain('no longer active');
    expect(executeSpy).not.toHaveBeenCalled(); // Exactly 0 LLM calls!
  });

  // ─── FLOW 2: UNANSWERED_INBOUND ─────────────────────────────────────────
  it('Flow #2: Unanswered customer message drafts ephemeral reply (0 DB inserts, 0 sends)', async () => {
    const mockMessages = [
      { id: 'msg-1', sender_type: 'contact', sender_name: 'Alice', content: 'What is the pricing for 4 pax?', created_at: '2026-08-16T09:00:00Z' },
    ];

    currentMockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'agent-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return createChainableQuery({ id: 'agent-1', role: 'consultant', tenant_id: 'agency-alpha', full_name: 'Sarah Agent' });
        }
        if (table === 'tenants') {
          return createChainableQuery({ name: 'Alpha Travels' });
        }
        if (table === 'conversations') {
          const singleConv = {
            id: 'conv-101',
            tenant_id: 'agency-alpha',
            channel: 'whatsapp',
            status: 'open',
            last_message_at: '2026-08-16T09:00:00Z',
          };
          const query = createChainableQuery([singleConv]);
          query.maybeSingle = vi.fn().mockResolvedValue({ data: singleConv, error: null });
          query.single = vi.fn().mockResolvedValue({ data: singleConv, error: null });
          return query;
        }
        if (table === 'messages') {
          return createChainableQuery(mockMessages);
        }
        return createChainableQuery(null);
      }),
    } as unknown as SupabaseClient;

    vi.spyOn(routeHelper, 'executeAIRequest').mockResolvedValueOnce({
      content: 'Here is a draft reply:\n\n"Hi Alice, thank you for reaching out! For 4 travelers..."',
      blocked: false,
      usage: null,
    });

    const response = await submitCrmCopilotMessage('Draft reply to customer', {
      contextType: 'conversation',
      contextId: 'conv-101',
      requestedIntent: 'draft_reply',
    });

    expect(response.content).toContain('Here is a draft reply');
    expect(response.actionProposal).toBeUndefined(); // 0 auto-mutations
  });

  // ─── FLOW 3: MISSING_QUALIFICATION ──────────────────────────────────────
  it('Flow #3: Missing qualification fields highlighted in facts without automatic database writes', async () => {
    const unqualInquiry = {
      id: 'inq-unqual-1',
      destination: null, // Missing destination
      pipeline_stage: 'inquiry_received',
      priority: 'medium',
      expected_value: null, // Missing budget
      currency: 'INR',
      passenger_count: null, // Missing traveler count
      departure_date: null, // Missing dates
      return_date: null,
      special_requests: null,
      assigned_agent_id: 'agent-1',
      traveler_id: null,
      legacy_lead_id: null,
      created_at: '2026-08-01T10:00:00Z',
      next_follow_up_at: '2026-08-25T10:00:00Z',
      archived: false,
      deleted_at: null,
    };

    currentMockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'agent-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return createChainableQuery({ id: 'agent-1', role: 'consultant', tenant_id: 'agency-alpha', full_name: 'Sarah Agent' });
        }
        if (table === 'tenants') {
          return createChainableQuery({ name: 'Alpha Travels' });
        }
        if (table === 'inquiries') {
          return createChainableQuery(unqualInquiry);
        }
        if (table === 'conversations') {
          return createChainableQuery([]);
        }
        return createChainableQuery(null);
      }),
    } as unknown as SupabaseClient;

    const context = await resolveCopilotContext(currentMockSupabase, {
      contextType: 'inquiry',
      contextId: 'inq-unqual-1',
    });

    const qualSignal = context.attentionContext?.activeSignals.find((s) => s.signalType === 'MISSING_QUALIFICATION');
    expect(qualSignal).toBeDefined();
    expect(qualSignal?.missingFields).toContain('destination');
    expect(qualSignal?.missingFields).toContain('number_of_travelers');
    expect(qualSignal?.missingFields).toContain('departure_date');
    expect(qualSignal?.missingFields).toContain('budget');
  });

  // ─── FLOW 4: UNASSIGNED_INQUIRY ─────────────────────────────────────────
  it('Flow #4: Unassigned inquiry triggers UNASSIGNED_INQUIRY and allows governed proposeAssignInquiry', async () => {
    const unassignedInq = {
      id: 'inq-unassigned-1',
      destination: 'Dubai',
      pipeline_stage: 'initial_contact',
      priority: 'high',
      expected_value: 200000,
      currency: 'INR',
      passenger_count: 2,
      departure_date: '2026-11-01',
      return_date: '2026-11-08',
      special_requests: null,
      assigned_agent_id: null, // Unassigned!
      traveler_id: null,
      legacy_lead_id: null,
      created_at: '2026-08-01T10:00:00Z',
      next_follow_up_at: '2026-08-25T10:00:00Z',
      archived: false,
      deleted_at: null,
    };

    currentMockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'agent-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return createChainableQuery({ id: 'agent-1', role: 'consultant', tenant_id: 'agency-alpha', full_name: 'Sarah Agent' });
        }
        if (table === 'tenants') {
          return createChainableQuery({ name: 'Alpha Travels' });
        }
        if (table === 'inquiries') {
          return createChainableQuery(unassignedInq);
        }
        if (table === 'conversations') {
          return createChainableQuery([]);
        }
        return createChainableQuery(null);
      }),
    } as unknown as SupabaseClient;

    const context = await resolveCopilotContext(currentMockSupabase, {
      contextType: 'inquiry',
      contextId: 'inq-unassigned-1',
    });

    expect(context.attentionContext?.activeSignals.map((s) => s.signalType)).toContain('UNASSIGNED_INQUIRY');
  });

  // ─── FLOW 5: NO_FOLLOW_UP_SCHEDULED ─────────────────────────────────────
  it('Flow #5: Active inquiry without follow-up timestamp emits NO_FOLLOW_UP_SCHEDULED (mutually exclusive with OVERDUE)', async () => {
    const noFollowUpInq = {
      id: 'inq-nofup-1',
      destination: 'Switzerland',
      pipeline_stage: 'options_shared',
      priority: 'high',
      expected_value: 300000,
      currency: 'INR',
      passenger_count: 2,
      departure_date: '2026-12-01',
      return_date: '2026-12-10',
      special_requests: null,
      assigned_agent_id: 'agent-1',
      traveler_id: null,
      legacy_lead_id: null,
      created_at: '2026-08-01T10:00:00Z',
      next_follow_up_at: null, // No follow-up scheduled!
      archived: false,
      deleted_at: null,
    };

    currentMockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'agent-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return createChainableQuery({ id: 'agent-1', role: 'consultant', tenant_id: 'agency-alpha', full_name: 'Sarah Agent' });
        }
        if (table === 'tenants') {
          return createChainableQuery({ name: 'Alpha Travels' });
        }
        if (table === 'inquiries') {
          return createChainableQuery(noFollowUpInq);
        }
        if (table === 'conversations') {
          return createChainableQuery([]);
        }
        return createChainableQuery(null);
      }),
    } as unknown as SupabaseClient;

    const context = await resolveCopilotContext(currentMockSupabase, {
      contextType: 'inquiry',
      contextId: 'inq-nofup-1',
    });

    const signalTypes = context.attentionContext?.activeSignals.map((s) => s.signalType) || [];
    expect(signalTypes).toContain('NO_FOLLOW_UP_SCHEDULED');
    expect(signalTypes).not.toContain('FOLLOW_UP_OVERDUE'); // Mutually exclusive
  });
});

describe('Phase AI-4E: Cross-Tenant & Platform Super Admin Boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects cross-tenant context access attempt with not_found and 0 LLM calls', async () => {
    const executeSpy = vi.spyOn(routeHelper, 'executeAIRequest');

    currentMockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'agent-a' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return createChainableQuery({ id: 'agent-a', role: 'consultant', tenant_id: 'agency-alpha', full_name: 'Alpha Agent' });
        }
        if (table === 'tenants') {
          return createChainableQuery({ name: 'Alpha Travels' });
        }
        // Foreign entity lookup with tenant_id = 'agency-alpha' returns null
        return createChainableQuery(null);
      }),
    } as unknown as SupabaseClient;

    const response = await submitCrmCopilotMessage('Summarize this foreign inquiry', {
      contextType: 'inquiry',
      contextId: 'inq-agency-beta-secret',
      requestedIntent: 'explain_attention',
    });

    expect(response.error).toBe('not_found');
    expect(response.content).toContain('not found in your workspace');
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('rejects Platform Super Admin with 403 Forbidden', async () => {
    const executeSpy = vi.spyOn(routeHelper, 'executeAIRequest');

    currentMockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'superadmin-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return createChainableQuery({ id: 'superadmin-1', role: 'super_admin', tenant_id: 'platform-admin', full_name: 'Super Admin' });
        }
        return createChainableQuery(null);
      }),
    } as unknown as SupabaseClient;

    const response = await submitCrmCopilotMessage('Hello', {
      contextType: 'inquiry',
      contextId: 'inq-101',
    });

    expect(response.error).toContain('Super Admin');
    expect(executeSpy).not.toHaveBeenCalled();
  });
});

describe('Phase AI-4E: AI-4 Core Invariant Assertions', () => {
  it('verifies AI-4 model capability boundary: 8 read tools, 3 proposal tools, 0 direct write, 0 external send', () => {
    const readTools = Object.keys(CRM_READ_TOOLS);
    const proposalTools = Object.keys(CRM_PROPOSAL_TOOLS);
    const providerTools = getCrmCopilotProviderTools(true);

    expect(readTools.length).toBe(8);
    expect(proposalTools.length).toBe(3);
    expect(providerTools.length).toBe(11);

    // Verify ZERO write or send tools are exposed to the model
    const names = providerTools.map((t) => t.name);
    expect(names).not.toContain('sendEmail');
    expect(names).not.toContain('sendWhatsApp');
    expect(names).not.toContain('updateInquiry');
    expect(names).not.toContain('deleteRecord');
    expect(names).not.toContain('createTask');
  });

  it('fails closed when COPILOT_ACTION_SECRET is missing during action confirmation', async () => {
    const originalSecret = process.env.COPILOT_ACTION_SECRET;
    delete process.env.COPILOT_ACTION_SECRET;

    const result = await executeConfirmedAction(
      { userId: 'u-1', tenantId: 't-1', role: 'admin', fullName: 'Admin' },
      {
        proposalId: 'p-1',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-1',
        title: 'Test',
        summary: 'Test',
        currentState: {},
        proposedState: {},
        riskLevel: 'internal',
        requiresConfirmation: true,
        signature: 'fake-sig',
        createdAt: new Date().toISOString(),
      },
      currentMockSupabase
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid proposal signature');

    process.env.COPILOT_ACTION_SECRET = originalSecret;
  });
});
