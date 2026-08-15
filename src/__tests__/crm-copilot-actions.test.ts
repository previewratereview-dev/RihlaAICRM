/**
 * CRM Copilot Governed Actions Test Suite (Phase AI-3)
 * 
 * Verifies:
 * 1. PROPOSE != EXECUTE: Proposal tools create structured ActionProposalDTOs with ZERO DB mutations.
 * 2. Deterministic Server Executor executes ONLY on human confirmation with re-authentication.
 * 3. Human Audit Attribution: activities record attributes human actor (user_id = actor.userId).
 * 4. RBAC: Viewer role cannot mutate; Super Admin cannot mutate Agency CRM.
 * 5. Cross-tenant tampering fails closed.
 * 6. Target value & action type tampering rejected.
 * 7. Stale proposal / optimistic concurrency conflicts fail safely.
 * 8. Follow-up normalization & clearing.
 * 9. Zero external messaging, zero finance / booking mutations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  proposeUpdateInquiryStageTool,
  proposeAssignInquiryTool,
  proposeSetInquiryFollowUpTool,
  executeConfirmedAction,
  type AuthenticatedActor,
  type ActionProposalDTO,
  getCrmCopilotProviderTools,
  CRM_ALL_MODEL_TOOLS,
} from '@/lib/ai/rihla-copilot';
import type { TrustedExecutionContext } from '@/lib/ai/rihla-copilot/tools/types';

describe('Phase AI-3: Governed Rihla Copilot Actions', () => {
  const TENANT_A_CTX: TrustedExecutionContext = {
    userId: 'usr-agent-1',
    tenantId: 'tenant-agency-a',
    role: 'agent',
    fullName: 'Rayees Agent',
  };

  const ACTOR_ADMIN: AuthenticatedActor = {
    userId: 'usr-admin-1',
    fullName: 'Rayees Admin',
    role: 'admin',
    tenantId: 'tenant-agency-a',
  };

  const ACTOR_CONSULTANT: AuthenticatedActor = {
    userId: 'usr-agent-1',
    fullName: 'Rayees Consultant',
    role: 'consultant',
    tenantId: 'tenant-agency-a',
  };

  const ACTOR_VIEWER: AuthenticatedActor = {
    userId: 'usr-viewer-1',
    fullName: 'Bob Viewer',
    role: 'viewer',
    tenantId: 'tenant-agency-a',
  };

  const ACTOR_SUPER_ADMIN: AuthenticatedActor = {
    userId: 'usr-super-1',
    fullName: 'Alice SuperAdmin',
    role: 'super_admin',
    tenantId: 'tenant-agency-a',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. PROPOSE != EXECUTE Separation (Zero Business Mutations)
  // ═══════════════════════════════════════════════════════════════════
  describe('1. Proposal Tools (Zero Business Side Effects)', () => {
    it('proposeUpdateInquiryStage produces structured ActionProposalDTO without mutating DB', async () => {
      const updateSpy = vi.fn();
      const insertSpy = vi.fn();

      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'inq-101',
              destination: 'Maldives',
              pipeline_stage: 'initial_contact',
              traveler_id: 'trav-1',
            },
            error: null,
          }),
          update: updateSpy,
          insert: insertSpy,
        })),
      } as unknown as SupabaseClient;

      const result = await proposeUpdateInquiryStageTool.execute(
        TENANT_A_CTX,
        { inquiryId: 'inq-101', proposedStage: 'itinerary_sent' },
        mockSupabase
      );

      expect(result.success).toBe(true);
      expect(result.data?.proposal).toBeDefined();
      const prop = result.data!.proposal;

      expect(prop.actionType).toBe('update_inquiry_stage');
      expect(prop.entityId).toBe('inq-101');
      expect(prop.currentState.stage).toBe('initial_contact');
      expect(prop.proposedState.stage).toBe('itinerary_sent');
      expect(prop.requiresConfirmation).toBe(true);

      // ZERO mutations must have occurred
      expect(updateSpy).not.toHaveBeenCalled();
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('proposeAssignInquiry produces structured proposal with zero mutations', async () => {
      const updateSpy = vi.fn();
      const insertSpy = vi.fn();

      const mockSupabase = {
        from: vi.fn((table: string) => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockImplementation(() => {
            if (table === 'inquiries') {
              return Promise.resolve({
                data: { id: 'inq-102', destination: 'Dubai', assigned_agent_id: null },
                error: null,
              });
            }
            if (table === 'profiles') {
              return Promise.resolve({
                data: { id: 'usr-agent-2', full_name: 'Athar Specialist', role: 'specialist' },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          }),
          update: updateSpy,
          insert: insertSpy,
        })),
      } as unknown as SupabaseClient;

      const result = await proposeAssignInquiryTool.execute(
        TENANT_A_CTX,
        { inquiryId: 'inq-102', assigneeUserId: 'usr-agent-2' },
        mockSupabase
      );

      expect(result.success).toBe(true);
      expect(result.data?.proposal.actionType).toBe('assign_inquiry');
      expect(result.data?.proposal.proposedState.assignedAgentId).toBe('usr-agent-2');
      expect(result.data?.proposal.proposedState.assignedAgentName).toBe('Athar Specialist');

      // ZERO mutations
      expect(updateSpy).not.toHaveBeenCalled();
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('proposeSetInquiryFollowUp normalizes ISO date with zero mutations', async () => {
      const updateSpy = vi.fn();

      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'inq-103', destination: 'Bali', next_follow_up_at: null },
            error: null,
          }),
          update: updateSpy,
        })),
      } as unknown as SupabaseClient;

      const result = await proposeSetInquiryFollowUpTool.execute(
        TENANT_A_CTX,
        { inquiryId: 'inq-103', nextFollowUpAt: '2026-08-20T10:00:00.000Z' },
        mockSupabase
      );

      expect(result.success).toBe(true);
      expect(result.data?.proposal.actionType).toBe('set_inquiry_follow_up');
      expect(result.data?.proposal.proposedState.nextFollowUpAt).toBe('2026-08-20T10:00:00.000Z');
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Deterministic Server Action Executor & Audit Attribution
  // ═══════════════════════════════════════════════════════════════════
  describe('2. Server Confirmation Executor & Human Audit Attribution', () => {
    it('executes stage update on human confirmation and logs human as audit actor', async () => {
      const inqUpdateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
      });
      const leadUpdateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
      });
      const activityInsertSpy = vi.fn().mockResolvedValue({ error: null });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'inquiries') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'inq-101',
                  tenant_id: 'tenant-agency-a',
                  pipeline_stage: 'initial_contact',
                  legacy_lead_id: 'lead-legacy-101',
                },
                error: null,
              }),
              update: inqUpdateSpy,
            };
          }
          if (table === 'leads') {
            return {
              update: leadUpdateSpy,
            };
          }
          if (table === 'activities') {
            return {
              insert: activityInsertSpy,
            };
          }
          return {};
        }),
      } as unknown as SupabaseClient;

      const proposal: ActionProposalDTO = {
        proposalId: 'prop-1',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move to itinerary_sent',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(true);
      expect(result.actionType).toBe('update_inquiry_stage');
      expect(inqUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ pipeline_stage: 'itinerary_sent' })
      );
      expect(leadUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'itinerary_sent' })
      );

      // Audit activity must be attributed to the HUMAN ACTOR, not AI
      expect(activityInsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'usr-agent-1',
          user_name: 'Rayees Consultant',
          type: 'status_change',
          tenant_id: 'tenant-agency-a',
        })
      );
    });

    it('executes assignment on human confirmation and logs human as audit actor', async () => {
      const inqUpdateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
      });
      const activityInsertSpy = vi.fn().mockResolvedValue({ error: null });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'inquiries') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'inq-102',
                  tenant_id: 'tenant-agency-a',
                  assigned_agent_id: null,
                  legacy_lead_id: null,
                },
                error: null,
              }),
              update: inqUpdateSpy,
            };
          }
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'usr-agent-2', full_name: 'Athar Specialist', role: 'specialist' },
                error: null,
              }),
            };
          }
          if (table === 'activities') {
            return {
              insert: activityInsertSpy,
            };
          }
          return {};
        }),
      } as unknown as SupabaseClient;

      const proposal: ActionProposalDTO = {
        proposalId: 'prop-assign-1',
        actionType: 'assign_inquiry',
        entityType: 'inquiry',
        entityId: 'inq-102',
        title: 'Assign Inquiry',
        summary: 'Assign to Athar',
        currentState: { assignedAgentId: null, assignedAgentName: 'Unassigned' },
        proposedState: { assignedAgentId: 'usr-agent-2', assignedAgentName: 'Athar Specialist' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_ADMIN, proposal, mockSupabase);

      expect(result.success).toBe(true);
      expect(inqUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ assigned_agent_id: 'usr-agent-2' })
      );
      expect(activityInsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'usr-admin-1',
          user_name: 'Rayees Admin',
          type: 'assigned',
        })
      );
    });

    it('executes follow-up update and supports clearing follow-up with null', async () => {
      const inqUpdateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
      });
      const activityInsertSpy = vi.fn().mockResolvedValue({ error: null });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'inquiries') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'inq-103',
                  tenant_id: 'tenant-agency-a',
                  next_follow_up_at: '2026-08-18T10:00:00.000Z',
                  legacy_lead_id: null,
                },
                error: null,
              }),
              update: inqUpdateSpy,
            };
          }
          if (table === 'activities') {
            return {
              insert: activityInsertSpy,
            };
          }
          return {};
        }),
      } as unknown as SupabaseClient;

      const proposal: ActionProposalDTO = {
        proposalId: 'prop-follow-clear',
        actionType: 'set_inquiry_follow_up',
        entityType: 'inquiry',
        entityId: 'inq-103',
        title: 'Clear Follow-Up',
        summary: 'Clear scheduled follow-up',
        currentState: { nextFollowUpAt: '2026-08-18T10:00:00.000Z' },
        proposedState: { nextFollowUpAt: null },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(true);
      expect(inqUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ next_follow_up_at: null })
      );
      expect(activityInsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'follow_up_set',
          user_id: 'usr-agent-1',
        })
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. RBAC Enforcement (Viewer & Super Admin cannot mutate)
  // ═══════════════════════════════════════════════════════════════════
  describe('3. RBAC & Role Authority', () => {
    it('Viewer role is rejected from executing CRM actions', async () => {
      const updateSpy = vi.fn();
      const mockSupabase = {
        from: vi.fn(() => ({
          update: updateSpy,
        })),
      } as unknown as SupabaseClient;

      const proposal: ActionProposalDTO = {
        proposalId: 'prop-2',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move to itinerary_sent',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_VIEWER, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FORBIDDEN');
      expect(result.message).toContain('Viewer');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('Super Admin cannot execute Agency CRM mutations directly', async () => {
      const updateSpy = vi.fn();
      const mockSupabase = {
        from: vi.fn(() => ({
          update: updateSpy,
        })),
      } as unknown as SupabaseClient;

      const proposal: ActionProposalDTO = {
        proposalId: 'prop-3',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move to itinerary_sent',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_SUPER_ADMIN, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FORBIDDEN');
      expect(result.message).toContain('Super Admin');
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Cross-Tenant Tampering Prevention
  // ═══════════════════════════════════════════════════════════════════
  describe('4. Cross-Tenant Tampering', () => {
    it('fails closed when attempting to mutate an inquiry belonging to another tenant', async () => {
      const updateSpy = vi.fn();
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null, // Scoped lookup by actor.tenantId fails to find cross-tenant record
            error: null,
          }),
          update: updateSpy,
        })),
      } as unknown as SupabaseClient;

      const proposal: ActionProposalDTO = {
        proposalId: 'prop-4',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-agency-b-999',
        title: 'Update Stage',
        summary: 'Move to itinerary_sent',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NOT_FOUND');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('fails closed when attempting to assign inquiry to an assignee from another tenant', async () => {
      const inqUpdateSpy = vi.fn();
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'inquiries') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'inq-101', tenant_id: 'tenant-agency-a' },
                error: null,
              }),
              update: inqUpdateSpy,
            };
          }
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: null, // Cross-tenant assignee profile not found in actor's tenant!
                error: null,
              }),
            };
          }
          return {};
        }),
      } as unknown as SupabaseClient;

      const proposal: ActionProposalDTO = {
        proposalId: 'prop-cross-assign',
        actionType: 'assign_inquiry',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Assign Cross-Tenant User',
        summary: 'Assign test',
        currentState: { assignedAgentId: null },
        proposedState: { assignedAgentId: 'usr-cross-agency-b' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_ARGUMENT');
      expect(inqUpdateSpy).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. Stale-State / Concurrency Protection
  // ═══════════════════════════════════════════════════════════════════
  describe('5. Stale-State Conflict Protection', () => {
    it('aborts execution if record changed stage after proposal was prepared', async () => {
      const inqUpdateSpy = vi.fn();

      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'inq-101',
              tenant_id: 'tenant-agency-a',
              pipeline_stage: 'options_shared', // Record has already changed from initial_contact!
            },
            error: null,
          }),
          update: inqUpdateSpy,
        })),
      } as unknown as SupabaseClient;

      const proposal: ActionProposalDTO = {
        proposalId: 'prop-5',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move to itinerary_sent',
        currentState: { stage: 'initial_contact' }, // Stale expected state
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('STALE_STATE');
      expect(result.message).toContain('changed');
      expect(inqUpdateSpy).not.toHaveBeenCalled();
    });

    it('aborts execution if assignee was changed concurrently after proposal creation', async () => {
      const inqUpdateSpy = vi.fn();

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'inquiries') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'inq-101',
                  tenant_id: 'tenant-agency-a',
                  assigned_agent_id: 'usr-agent-3-concurrent', // Concurrently modified!
                },
                error: null,
              }),
              update: inqUpdateSpy,
            };
          }
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'usr-agent-2', full_name: 'Athar Specialist' },
                error: null,
              }),
            };
          }
          return {};
        }),
      } as unknown as SupabaseClient;

      const proposal: ActionProposalDTO = {
        proposalId: 'prop-stale-assign',
        actionType: 'assign_inquiry',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Assign Inquiry',
        summary: 'Assign test',
        currentState: { assignedAgentId: null }, // Expected unassigned, but now assigned to agent 3
        proposedState: { assignedAgentId: 'usr-agent-2' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('STALE_STATE');
      expect(inqUpdateSpy).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. Action Registry & Tool Boundary
  // ═══════════════════════════════════════════════════════════════════
  describe('6. Action Registry & Capability Truth', () => {
    it('provides exactly 8 read tools + 3 proposal tools and ZERO model-visible write tools', () => {
      const providerTools = getCrmCopilotProviderTools(true);
      expect(providerTools).toHaveLength(11);

      const allToolNames = Object.keys(CRM_ALL_MODEL_TOOLS);
      expect(allToolNames).toEqual([
        'searchInquiries',
        'getInquiryDetails',
        'searchTravelers',
        'getTravelerHistory',
        'getBookingDetails',
        'listTasks',
        'getRecentActivity',
        'searchAgencyKnowledge',
        'proposeUpdateInquiryStage',
        'proposeAssignInquiry',
        'proposeSetInquiryFollowUp',
      ]);

      // Zero direct write or mutation tools exposed to LLM
      expect(allToolNames).not.toContain('updateInquiryStage');
      expect(allToolNames).not.toContain('assignInquiry');
      expect(allToolNames).not.toContain('setInquiryFollowUp');
      expect(allToolNames).not.toContain('executeSQL');
    });

    it('rejects invalid inquiry stages outside the canonical pipeline', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'inq-101', tenant_id: 'tenant-agency-a', pipeline_stage: 'initial_contact' },
            error: null,
          }),
        })),
      } as unknown as SupabaseClient;

      const tamperedProposal: ActionProposalDTO = {
        proposalId: 'prop-6',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Tampered Stage',
        summary: 'Invalid stage test',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'arbitrary_tampered_stage' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, tamperedProposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_ARGUMENT');
    });

    it('rejects unknown or unapproved action types', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'inq-101', tenant_id: 'tenant-agency-a' },
            error: null,
          }),
        })),
      } as unknown as SupabaseClient;

      const tamperedProposal = {
        proposalId: 'prop-tampered-action',
        actionType: 'delete_inquiry' as unknown as import('@/lib/ai/rihla-copilot').ActionType,
        entityType: 'inquiry' as const,
        entityId: 'inq-101',
        title: 'Delete Inquiry',
        summary: 'Delete test',
        currentState: {},
        proposedState: {},
        riskLevel: 'internal' as const,
        requiresConfirmation: true as const,
        createdAt: new Date().toISOString(),
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, tamperedProposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_ARGUMENT');
    });
  });
});
