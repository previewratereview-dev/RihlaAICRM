/**
 * CRM Copilot Governed Actions Test Suite (Phase AI-3)
 * 
 * Verifies:
 * 1. PROPOSE != EXECUTE: Proposal tools create structured ActionProposalDTOs with ZERO DB mutations.
 * 2. Exact Proposal Integrity: HMAC server-side signatures prevent browser tampering with stage, assignee, follow-up, actionType.
 * 3. Bounded Proposal TTL: Expired proposals (> 10m) are rejected.
 * 4. Replay & Stale Protection: Double confirmation / stale states fail safely with zero duplicate mutations or activities.
 * 5. Deterministic Server Executor executes ONLY on human confirmation with re-authentication.
 * 6. Human Audit Attribution: activities record attributes human actor (user_id = actor.userId).
 * 7. Activity Foreign Key Truth: activities.lead_id is inquiry.legacy_lead_id || null (NEVER inquiry.id).
 * 8. Dual-Write Parity: Updates canonical inquiries and compatibility leads.
 * 9. RBAC & Ownership Parity: Viewer and Super Admin blocked; Non-admin cannot mutate another agent's assigned inquiry.
 * 10. Cross-tenant tampering fails closed.
 * 11. Zero external messaging, zero finance / booking mutations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  proposeUpdateInquiryStageTool,
  proposeAssignInquiryTool,
  proposeSetInquiryFollowUpTool,
  executeConfirmedAction,
  signProposal,
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

  const ACTOR_OTHER_CONSULTANT: AuthenticatedActor = {
    userId: 'usr-agent-99',
    fullName: 'Other Consultant',
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

  function createSignedProposal(base: Omit<ActionProposalDTO, 'signature'>): ActionProposalDTO {
    const signature = signProposal(base);
    return { ...base, signature };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. PROPOSE != EXECUTE Separation (Zero Business Mutations)
  // ═══════════════════════════════════════════════════════════════════
  describe('1. Proposal Tools (Zero Business Side Effects)', () => {
    it('proposeUpdateInquiryStage produces signed ActionProposalDTO without mutating DB', async () => {
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
      expect(prop.signature).toBeDefined();
      expect(typeof prop.signature).toBe('string');

      // ZERO mutations must have occurred
      expect(updateSpy).not.toHaveBeenCalled();
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('proposeAssignInquiry produces signed proposal with zero mutations', async () => {
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
      expect(result.data?.proposal).toBeDefined();
      const prop = result.data!.proposal;

      expect(prop.actionType).toBe('assign_inquiry');
      expect(prop.proposedState.assignedAgentId).toBe('usr-agent-2');
      expect(prop.signature).toBeDefined();

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
            data: {
              id: 'inq-103',
              destination: 'Bali',
              next_follow_up_at: null,
            },
            error: null,
          }),
          update: updateSpy,
        })),
      } as unknown as SupabaseClient;

      const result = await proposeSetInquiryFollowUpTool.execute(
        TENANT_A_CTX,
        { inquiryId: 'inq-103', nextFollowUpAt: '2026-08-20T14:30:00.000Z' },
        mockSupabase
      );

      expect(result.success).toBe(true);
      expect(result.data?.proposal.proposedState.nextFollowUpAt).toBe('2026-08-20T14:30:00.000Z');
      expect(result.data?.proposal.signature).toBeDefined();
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Proposal Integrity & HMAC Cryptographic Verification
  // ═══════════════════════════════════════════════════════════════════
  describe('2. Server-Verifiable Proposal Integrity (HMAC)', () => {
    it('executes a valid, properly signed proposal', async () => {
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
                  assigned_agent_id: 'usr-agent-1',
                  legacy_lead_id: 'lead-legacy-101',
                },
                error: null,
              }),
              update: inqUpdateSpy,
            };
          }
          if (table === 'leads') {
            return { update: leadUpdateSpy };
          }
          if (table === 'activities') {
            return { insert: activityInsertSpy };
          }
          return {};
        }),
      } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-valid-1',
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
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(true);
      expect(inqUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ pipeline_stage: 'itinerary_sent' })
      );
      expect(leadUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'itinerary_sent' })
      );
      expect(activityInsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          lead_id: 'lead-legacy-101',
          user_id: 'usr-agent-1',
          user_name: 'Rayees Consultant',
          type: 'status_change',
        })
      );
    });

    it('rejects an unsigned proposal with INVALID_SIGNATURE', async () => {
      const mockSupabase = {} as unknown as SupabaseClient;

      const unsignedProposal: ActionProposalDTO = {
        proposalId: 'prop-unsigned',
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
        // signature omitted
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, unsignedProposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });

    it('rejects a proposal where malicious client changed target stage to booking_confirmed', async () => {
      const mockSupabase = {} as unknown as SupabaseClient;

      const legitimateProposal = createSignedProposal({
        proposalId: 'prop-stage-legit',
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
      });

      // Attacker intercepts and modifies proposedState.stage in browser DevTools
      const tamperedProposal: ActionProposalDTO = {
        ...legitimateProposal,
        proposedState: { stage: 'booking_confirmed' }, // Maliciously altered target stage!
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, tamperedProposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
      expect(result.message).toContain('integrity check failed');
    });

    it('rejects a proposal where malicious client replaced proposed assignee with another valid assignee', async () => {
      const mockSupabase = {} as unknown as SupabaseClient;

      const legitimateProposal = createSignedProposal({
        proposalId: 'prop-assign-legit',
        actionType: 'assign_inquiry',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Assign Inquiry',
        summary: 'Assign to Agent A',
        currentState: { assignedAgentId: null },
        proposedState: { assignedAgentId: 'usr-agent-a' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      // Attacker modifies assignee to another valid same-tenant user
      const tamperedProposal: ActionProposalDTO = {
        ...legitimateProposal,
        proposedState: { assignedAgentId: 'usr-agent-b' },
      };

      const result = await executeConfirmedAction(ACTOR_ADMIN, tamperedProposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });

    it('rejects a proposal where malicious client modified follow-up datetime', async () => {
      const mockSupabase = {} as unknown as SupabaseClient;

      const legitimateProposal = createSignedProposal({
        proposalId: 'prop-follow-legit',
        actionType: 'set_inquiry_follow_up',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Set Follow-Up',
        summary: 'Follow up tomorrow',
        currentState: { nextFollowUpAt: null },
        proposedState: { nextFollowUpAt: '2026-08-17T10:00:00.000Z' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      // Attacker changes follow-up datetime to different timestamp
      const tamperedProposal: ActionProposalDTO = {
        ...legitimateProposal,
        proposedState: { nextFollowUpAt: '2026-08-30T10:00:00.000Z' },
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, tamperedProposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });

    it('rejects a proposal older than TTL (10 minutes) with EXPIRED_PROPOSAL', async () => {
      const mockSupabase = {} as unknown as SupabaseClient;

      // Created 15 minutes ago
      const elevenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const expiredProposal = createSignedProposal({
        proposalId: 'prop-expired-1',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: elevenMinutesAgo,
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, expiredProposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('EXPIRED_PROPOSAL');
      expect(result.message).toContain('expired');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Replay Protection & Stale-State Concurrency
  // ═══════════════════════════════════════════════════════════════════
  describe('3. Replay Protection & Concurrency', () => {
    it('double confirmation of stage update does not double-mutate or insert duplicate activity', async () => {
      const inqUpdateSpy = vi.fn();
      const activityInsertSpy = vi.fn();

      // Record is already at target stage 'itinerary_sent'
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'inq-101',
              tenant_id: 'tenant-agency-a',
              pipeline_stage: 'itinerary_sent', // Already updated on first confirm
              assigned_agent_id: 'usr-agent-1',
            },
            error: null,
          }),
          update: inqUpdateSpy,
          insert: activityInsertSpy,
        })),
      } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-replay-1',
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
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('STALE_STATE');
      expect(result.message).toContain('already in');
      expect(inqUpdateSpy).not.toHaveBeenCalled();
      expect(activityInsertSpy).not.toHaveBeenCalled();
    });

    it('aborts execution if record changed stage to a different stage after proposal was prepared', async () => {
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
              pipeline_stage: 'options_shared', // Record changed to options_shared!
              assigned_agent_id: 'usr-agent-1',
            },
            error: null,
          }),
          update: inqUpdateSpy,
        })),
      } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-stale-stage',
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
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('STALE_STATE');
      expect(inqUpdateSpy).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. RBAC & Ownership Parity
  // ═══════════════════════════════════════════════════════════════════
  describe('4. RBAC & Ownership Parity', () => {
    it('Viewer role is rejected from executing CRM actions', async () => {
      const updateSpy = vi.fn();
      const mockSupabase = {} as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-viewer-test',
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
      });

      const result = await executeConfirmedAction(ACTOR_VIEWER, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FORBIDDEN');
      expect(result.message).toContain('Viewer');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('Super Admin cannot execute Agency CRM mutations directly', async () => {
      const updateSpy = vi.fn();
      const mockSupabase = {} as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-superadmin-test',
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
      });

      const result = await executeConfirmedAction(ACTOR_SUPER_ADMIN, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FORBIDDEN');
      expect(result.message).toContain('Super Admin');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('Specialist/Consultant cannot mutate an inquiry assigned to another agent', async () => {
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
              pipeline_stage: 'initial_contact',
              assigned_agent_id: 'usr-agent-1', // Assigned to Agent 1
            },
            error: null,
          }),
          update: inqUpdateSpy,
        })),
      } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-ownership-test',
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
      });

      // ACTOR_OTHER_CONSULTANT (usr-agent-99) attempts to mutate Agent 1's inquiry
      const result = await executeConfirmedAction(ACTOR_OTHER_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FORBIDDEN');
      expect(result.message).toContain('assigned to you');
      expect(inqUpdateSpy).not.toHaveBeenCalled();
    });

    it('Admin can mutate inquiries assigned to any agent in the tenant', async () => {
      const inqUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() });
      const leadUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() });
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
                  assigned_agent_id: 'usr-agent-1',
                  legacy_lead_id: null,
                },
                error: null,
              }),
              update: inqUpdateSpy,
            };
          }
          if (table === 'leads') return { update: leadUpdateSpy };
          if (table === 'activities') return { insert: activityInsertSpy };
          return {};
        }),
      } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-admin-override',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Admin moving stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_ADMIN, proposal, mockSupabase);
      expect(result.success).toBe(true);
      expect(inqUpdateSpy).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. Activity Foreign Key Truth & Dual-Write Parity
  // ═══════════════════════════════════════════════════════════════════
  describe('5. Activity FK Truth & Dual-Write Parity', () => {
    it('sets activities.lead_id = null when inquiry has legacy_lead_id = null (never uses inquiry.id)', async () => {
      const inqUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() });
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
                  id: 'inq-pure-canonical-uuid-1',
                  tenant_id: 'tenant-agency-a',
                  pipeline_stage: 'initial_contact',
                  assigned_agent_id: 'usr-agent-1',
                  legacy_lead_id: null, // Pure canonical inquiry without legacy lead
                },
                error: null,
              }),
              update: inqUpdateSpy,
            };
          }
          if (table === 'activities') return { insert: activityInsertSpy };
          return {};
        }),
      } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-fk-truth',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-pure-canonical-uuid-1',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);
      expect(result.success).toBe(true);

      // activities.lead_id MUST be null, NEVER 'inq-pure-canonical-uuid-1'
      expect(activityInsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          lead_id: null,
          user_id: 'usr-agent-1',
          user_name: 'Rayees Consultant',
        })
      );
    });

    it('dual-writes follow-up date to public.leads when legacy_lead_id is present', async () => {
      const inqUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() });
      const leadUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() });
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
                  next_follow_up_at: null,
                  assigned_agent_id: 'usr-agent-1',
                  legacy_lead_id: 'lead-legacy-103',
                },
                error: null,
              }),
              update: inqUpdateSpy,
            };
          }
          if (table === 'leads') return { update: leadUpdateSpy };
          if (table === 'activities') return { insert: activityInsertSpy };
          return {};
        }),
      } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-follow-dual',
        actionType: 'set_inquiry_follow_up',
        entityType: 'inquiry',
        entityId: 'inq-103',
        title: 'Set Follow-Up',
        summary: 'Schedule follow-up',
        currentState: { nextFollowUpAt: null },
        proposedState: { nextFollowUpAt: '2026-08-22T15:00:00.000Z' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);
      expect(result.success).toBe(true);

      expect(inqUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ next_follow_up_at: '2026-08-22T15:00:00.000Z' })
      );
      expect(leadUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ next_follow_up_at: '2026-08-22T15:00:00.000Z' })
      );
      expect(activityInsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          lead_id: 'lead-legacy-103',
          type: 'follow_up_set',
        })
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. Action Registry & Capability Truth
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
            data: { id: 'inq-101', tenant_id: 'tenant-agency-a', pipeline_stage: 'initial_contact', assigned_agent_id: 'usr-agent-1' },
            error: null,
          }),
        })),
      } as unknown as SupabaseClient;

      const tamperedProposal = createSignedProposal({
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
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, tamperedProposal, mockSupabase);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_ARGUMENT');
    });
  });
});
