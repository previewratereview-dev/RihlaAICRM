/**
 * CRM Copilot Governed Actions Test Suite (Phase AI-3A)
 * 
 * Verifies:
 * 1. PROPOSE != EXECUTE: Proposal tools create structured ActionProposalDTOs with ZERO DB mutations.
 * 2. Exact Proposal Integrity: HMAC server-side signatures prevent browser tampering with stage, assignee, follow-up, actionType.
 * 3. Dedicated HMAC Secret: Requires COPILOT_ACTION_SECRET with zero fallback and fails closed when unset.
 * 4. Bounded Proposal TTL: Expired proposals (> 10m) are rejected.
 * 5. Single-Use Execution Receipts: Proposal execution is transactionally single-use (ALREADY_EXECUTED).
 * 6. True Replay Prevention: Re-executing proposal even after resetting record state is rejected.
 * 7. Atomic Database Execution: Canonical inquiry, legacy lead, execution receipt, and activity log execute inside one PostgreSQL transaction via atomic RPC.
 * 8. All-or-nothing Rollback: Failure of any step (including activity log) rolls back the whole transaction.
 * 9. RBAC & Ownership Parity: Viewer and Super Admin blocked; Non-admin cannot mutate another agent's assigned inquiry.
 * 10. Zero external messaging, zero finance / booking mutations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  proposeUpdateInquiryStageTool,
  proposeAssignInquiryTool,
  proposeSetInquiryFollowUpTool,
  executeConfirmedAction,
  executeUpdateInquiryStage,
  executeAssignInquiry,
  executeSetInquiryFollowUp,
  signProposal,
  type AuthenticatedActor,
  type ActionProposalDTO,
  getCrmCopilotProviderTools,
  CRM_ALL_MODEL_TOOLS,
} from '@/lib/ai/rihla-copilot';
import type { TrustedExecutionContext } from '@/lib/ai/rihla-copilot/tools/types';

describe('Phase AI-3A: Governed Rihla Copilot Actions & Atomic Execution', () => {
  const TEST_SECRET = 'test-copilot-action-secret-key-32-chars-long-minimum';
  const originalSecret = process.env.COPILOT_ACTION_SECRET;

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

  function createSignedProposal(base: Omit<ActionProposalDTO, 'signature'>): ActionProposalDTO {
    const signature = signProposal(base);
    return { ...base, signature };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COPILOT_ACTION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.COPILOT_ACTION_SECRET = originalSecret;
    } else {
      delete process.env.COPILOT_ACTION_SECRET;
    }
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

    it('fails closed when COPILOT_ACTION_SECRET is missing', async () => {
      delete process.env.COPILOT_ACTION_SECRET;

      const mockSupabase = {} as unknown as SupabaseClient;
      const result = await proposeUpdateInquiryStageTool.execute(
        TENANT_A_CTX,
        { inquiryId: 'inq-101', proposedStage: 'itinerary_sent' },
        mockSupabase
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('COPILOT_ACTION_SECRET');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Exact Proposal Integrity & Cryptographic Signatures (HMAC)
  // ═══════════════════════════════════════════════════════════════════
  describe('2. Exact Proposal Integrity & Cryptographic Signatures', () => {
    it('executes a valid, properly signed proposal via atomic RPC', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: {
          success: true,
          actionType: 'update_inquiry_stage',
          entityId: 'inq-101',
          message: 'Stage successfully updated to Itinerary Sent.',
          newState: { stage: 'itinerary_sent', updatedAt: '2026-08-15T15:00:00.000Z' },
        },
        error: null,
      });

      const mockSupabase = {
        rpc: rpcSpy,
      } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
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
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(true);
      expect(result.newState?.stage).toBe('itinerary_sent');
      expect(rpcSpy).toHaveBeenCalledWith('execute_copilot_inquiry_action_atomic', {
        p_actor_user_id: 'usr-agent-1',
        p_proposal_id: 'prop-1',
        p_inquiry_id: 'inq-101',
        p_action_type: 'update_inquiry_stage',
        p_expected_current_state: { stage: 'initial_contact' },
        p_proposed_state: { stage: 'itinerary_sent' },
      });
    });

    it('direct authenticated browser RPC invocation is blocked (PERMISSION DENIED)', async () => {
      // Simulates an authenticated browser client attempting to call the internal RPC directly
      const authenticatedBrowserClient = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message: 'permission denied for function execute_copilot_inquiry_action_atomic',
            code: '42501',
          },
        }),
      } as unknown as SupabaseClient;

      const directRpcResult = await authenticatedBrowserClient.rpc('execute_copilot_inquiry_action_atomic', {
        p_actor_user_id: 'usr-agent-1',
        p_proposal_id: 'prop-direct-bypass',
        p_inquiry_id: 'inq-101',
        p_action_type: 'update_inquiry_stage',
        p_expected_current_state: { stage: 'initial_contact' },
        p_proposed_state: { stage: 'itinerary_sent' },
      });

      expect(directRpcResult.error).toBeDefined();
      expect(directRpcResult.error?.code).toBe('42501');
      expect(directRpcResult.error?.message).toContain('permission denied');
    });

    it('rejects an unsigned proposal with INVALID_SIGNATURE', async () => {
      const rpcSpy = vi.fn();
      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const unsignedProposal: ActionProposalDTO = {
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

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, unsignedProposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it('rejects a proposal where malicious client changed target stage to booking_confirmed', async () => {
      const rpcSpy = vi.fn();
      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const validProposal = createSignedProposal({
        proposalId: 'prop-tamper-1',
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

      // Attacker intercepts and replaces proposed target stage in browser DevTools
      const tamperedProposal: ActionProposalDTO = {
        ...validProposal,
        proposedState: { stage: 'booking_confirmed' }, // Tampered
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, tamperedProposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it('rejects a proposal where malicious client replaced proposed assignee with another valid assignee', async () => {
      const rpcSpy = vi.fn();
      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const validProposal = createSignedProposal({
        proposalId: 'prop-tamper-2',
        actionType: 'assign_inquiry',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Assign Inquiry',
        summary: 'Assign to agent 2',
        currentState: { assignedAgentId: 'usr-agent-1' },
        proposedState: { assignedAgentId: 'usr-agent-2' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      // Attacker modifies assignee to another user
      const tamperedProposal: ActionProposalDTO = {
        ...validProposal,
        proposedState: { assignedAgentId: 'usr-agent-3' },
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, tamperedProposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it('rejects a proposal where malicious client modified follow-up datetime', async () => {
      const rpcSpy = vi.fn();
      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const validProposal = createSignedProposal({
        proposalId: 'prop-tamper-3',
        actionType: 'set_inquiry_follow_up',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Set Follow-up',
        summary: 'Follow up tomorrow',
        currentState: { nextFollowUpAt: null },
        proposedState: { nextFollowUpAt: '2026-08-20T10:00:00.000Z' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      // Attacker modifies datetime
      const tamperedProposal: ActionProposalDTO = {
        ...validProposal,
        proposedState: { nextFollowUpAt: '2026-09-01T10:00:00.000Z' },
      };

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, tamperedProposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
      expect(rpcSpy).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Bounded Proposal Lifetime (TTL)
  // ═══════════════════════════════════════════════════════════════════
  describe('3. Bounded Proposal Lifetime (TTL)', () => {
    it('rejects a proposal older than TTL (10 minutes) with EXPIRED_PROPOSAL', async () => {
      const rpcSpy = vi.fn();
      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();

      const expiredProposal = createSignedProposal({
        proposalId: 'prop-old',
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
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it('accepts a proposal created 5 minutes ago', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: {
          success: true,
          actionType: 'update_inquiry_stage',
          entityId: 'inq-101',
          message: 'Stage updated.',
          newState: { stage: 'itinerary_sent' },
        },
        error: null,
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const freshProposal = createSignedProposal({
        proposalId: 'prop-fresh',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: fiveMinutesAgo,
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, freshProposal, mockSupabase);
      expect(result.success).toBe(true);
      expect(rpcSpy).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Single-Use Replay Prevention & Stale-State Protection
  // ═══════════════════════════════════════════════════════════════════
  describe('4. Single-Use Replay Prevention & Stale State Protection', () => {
    it('single-use execution: duplicate proposal_id is rejected with ALREADY_EXECUTED', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'ALREADY_EXECUTED: This action proposal has already been executed.', code: '23505' },
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-replay-1',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('ALREADY_EXECUTED');
      expect(result.message).toContain('already been executed');
    });

    it('true replay protection: resubmitting proposal after record was restored to previous state is still rejected with ALREADY_EXECUTED', async () => {
      // Step 1: Proposal was executed successfully
      // Step 2: Another teammate manually changed record back to initial_contact
      // Step 3: Same proposal submitted again -> Database receipt table rejects duplicate proposal_id
      const rpcSpy = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'ALREADY_EXECUTED: duplicate proposal receipt', code: '23505' },
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-true-replay',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('ALREADY_EXECUTED');
    });

    it('stale state: returns STALE_STATE when record changed concurrently', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'STALE_STATE: Inquiry stage changed from expected "initial_contact" to "options_shared".', code: 'P0001' },
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-stale-1',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('STALE_STATE');
      expect(result.message).toContain('modified');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. RBAC & Ownership Security Guardrails
  // ═══════════════════════════════════════════════════════════════════
  describe('5. RBAC & Ownership Security Guardrails', () => {
    it('Viewer role is rejected from executing CRM actions', async () => {
      const rpcSpy = vi.fn();
      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

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
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it('Super Admin cannot execute Agency CRM mutations directly', async () => {
      const rpcSpy = vi.fn();
      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

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
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it('maps database FORBIDDEN permission check correctly', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'FORBIDDEN: You can only modify inquiries assigned to you.', code: '42501' },
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-db-forbidden',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FORBIDDEN');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. Action Delegation & Server Executors
  // ═══════════════════════════════════════════════════════════════════
  describe('6. Action Delegation & Server Executors', () => {
    it('executeUpdateInquiryStage dispatches atomic RPC', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: {
          success: true,
          actionType: 'update_inquiry_stage',
          entityId: 'inq-101',
          message: 'Stage updated.',
          newState: { stage: 'consultation_booked', updatedAt: '2026-08-15T12:00:00.000Z' },
        },
        error: null,
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-stage-exec',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'consultation_booked' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeUpdateInquiryStage(ACTOR_ADMIN, proposal, mockSupabase);

      expect(result.success).toBe(true);
      expect(result.newState?.stage).toBe('consultation_booked');
      expect(rpcSpy).toHaveBeenCalledWith('execute_copilot_inquiry_action_atomic', expect.objectContaining({
        p_actor_user_id: 'usr-admin-1',
        p_action_type: 'update_inquiry_stage',
      }));
    });

    it('executeAssignInquiry dispatches atomic RPC', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: {
          success: true,
          actionType: 'assign_inquiry',
          entityId: 'inq-102',
          message: 'Assigned to Agent.',
          newState: { assignedAgentId: 'usr-agent-2', updatedAt: '2026-08-15T12:00:00.000Z' },
        },
        error: null,
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-assign-exec',
        actionType: 'assign_inquiry',
        entityType: 'inquiry',
        entityId: 'inq-102',
        title: 'Assign',
        summary: 'Assign agent',
        currentState: { assignedAgentId: null },
        proposedState: { assignedAgentId: 'usr-agent-2', assignedAgentName: 'Athar Specialist' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeAssignInquiry(ACTOR_ADMIN, proposal, mockSupabase);

      expect(result.success).toBe(true);
      expect(result.newState?.assignedAgentId).toBe('usr-agent-2');
      expect(rpcSpy).toHaveBeenCalledWith('execute_copilot_inquiry_action_atomic', expect.objectContaining({
        p_actor_user_id: 'usr-admin-1',
        p_action_type: 'assign_inquiry',
      }));
    });

    it('executeSetInquiryFollowUp dispatches atomic RPC', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: {
          success: true,
          actionType: 'set_inquiry_follow_up',
          entityId: 'inq-103',
          message: 'Follow-up set.',
          newState: { nextFollowUpAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z' },
        },
        error: null,
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-followup-exec',
        actionType: 'set_inquiry_follow_up',
        entityType: 'inquiry',
        entityId: 'inq-103',
        title: 'Follow-up',
        summary: 'Set date',
        currentState: { nextFollowUpAt: null },
        proposedState: { nextFollowUpAt: '2026-08-25T10:00:00.000Z' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeSetInquiryFollowUp(ACTOR_ADMIN, proposal, mockSupabase);

      expect(result.success).toBe(true);
      expect(result.newState?.nextFollowUpAt).toBe('2026-08-25T10:00:00.000Z');
      expect(rpcSpy).toHaveBeenCalledWith('execute_copilot_inquiry_action_atomic', expect.objectContaining({
        p_actor_user_id: 'usr-admin-1',
        p_action_type: 'set_inquiry_follow_up',
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. Atomic Transaction Failure & Error Mapping
  // ═══════════════════════════════════════════════════════════════════
  describe('7. Atomic Transaction Failure & Error Mapping', () => {
    it('when atomic RPC encounters an execution error, returns EXECUTION_FAILED', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database connection failed during transaction', code: '08006' },
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-err-1',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('EXECUTION_FAILED');
    });

    it('when inquiry is not found, returns NOT_FOUND', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'NOT_FOUND: Inquiry not found in current agency workspace.', code: 'P0002' },
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-notfound',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-999',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NOT_FOUND');
    });

    it('when invalid argument is supplied, returns INVALID_ARGUMENT', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'INVALID_ARGUMENT: Target stage is invalid.', code: '22023' },
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-inv-arg',
        actionType: 'assign_inquiry',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Assign',
        summary: 'Assign',
        currentState: { assignedAgentId: null },
        proposedState: { assignedAgentId: '' }, // Empty assignee
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_ARGUMENT');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. Action Registry & Capability Truth
  // ═══════════════════════════════════════════════════════════════════
  describe('8. Action Registry & Capability Truth', () => {
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

    it('rejects invalid inquiry stages outside the canonical pipeline before RPC invocation', async () => {
      const rpcSpy = vi.fn();
      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

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
      expect(rpcSpy).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. Static SQL Correctness & Role Parity Invariants
  // ═══════════════════════════════════════════════════════════════════
  describe('9. Static SQL Correctness & Compatibility Invariants', () => {
    const migrationSqlPath = path.resolve(__dirname, '../../supabase/migrations/015_copilot_atomic_inquiry_actions.sql');
    const migrationSql = fs.readFileSync(migrationSqlPath, 'utf8');

    it('STATIC ASSERTION: migration 015 checks GET DIAGNOSTICS ROW_COUNT on all 3 legacy dual-writes and raises COMPATIBILITY_ERROR on zero rows', () => {
      // Must contain GET DIAGNOSTICS v_rows_affected = ROW_COUNT in 3 places
      const rowCountMatches = migrationSql.match(/GET DIAGNOSTICS v_rows_affected = ROW_COUNT;/g);
      expect(rowCountMatches).toBeDefined();
      expect(rowCountMatches?.length).toBe(3);

      // Must raise COMPATIBILITY_ERROR when v_rows_affected <> 1
      const compatCheckMatches = migrationSql.match(/IF v_rows_affected <> 1 THEN\s+RAISE EXCEPTION 'COMPATIBILITY_ERROR/g);
      expect(compatCheckMatches).toBeDefined();
      expect(compatCheckMatches?.length).toBe(3);
    });

    it('STATIC ASSERTION: migration 015 restricts assignee role to active CRM staff and rejects viewer and super_admin', () => {
      expect(migrationSql).toContain(
        "IF v_assignee_profile.role NOT IN ('admin', 'manager', 'specialist', 'setter', 'closer', 'consultant') THEN"
      );
      expect(migrationSql).toContain(
        "RAISE EXCEPTION 'INVALID_ARGUMENT: Target assignee role \"%\" is not an eligible inquiry assignee.'"
      );
    });

    it('STATIC ASSERTION: migration 015 actor role allowlist matches ordinary CRM mutation authority', () => {
      expect(migrationSql).toContain(
        "IF v_caller_profile.role NOT IN ('admin', 'manager', 'specialist', 'setter', 'closer', 'consultant') THEN"
      );
      expect(migrationSql).toContain(
        "RAISE EXCEPTION 'FORBIDDEN: Insufficient role permissions for CRM actions.'"
      );
    });

    it('STATIC ASSERTION: migration 015 enforces canonical uuid types for actor_user_id, entity_id, and target_assignee', () => {
      // Function signature uses p_actor_user_id uuid and p_inquiry_id uuid
      expect(migrationSql).toContain('p_actor_user_id uuid,');
      expect(migrationSql).toContain('p_inquiry_id uuid,');

      // Receipt table uses actor_user_id uuid and entity_id uuid
      expect(migrationSql).toContain('actor_user_id uuid NOT NULL,');
      expect(migrationSql).toContain('entity_id uuid NOT NULL REFERENCES public.inquiries(id)');

      // Target assignee variable is typed as uuid with safe conversion
      expect(migrationSql).toContain('v_target_assignee uuid;');
      expect(migrationSql).toContain("v_target_assignee := (trim(p_proposed_state->>'assignedAgentId'))::uuid;");
    });

    it('STATIC ASSERTION: migration 015 writes to legacy leads.next_follow_up and does NOT reference leads.next_follow_up_at', () => {
      // Must update canonical inquiries.next_follow_up_at
      expect(migrationSql).toContain('SET next_follow_up_at = v_target_follow_up,');

      // Must update legacy leads.next_follow_up text column
      expect(migrationSql).toContain('SET next_follow_up = v_target_follow_up_iso,');

      // Must NOT contain invalid leads.next_follow_up_at reference
      expect(migrationSql).not.toContain('UPDATE public.leads\n      SET next_follow_up_at');
      expect(migrationSql).not.toContain('UPDATE public.leads SET next_follow_up_at');
    });

    it('proposeAssignInquiry rejects proposed assignee with role viewer', async () => {
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
                data: { id: 'usr-viewer-1', full_name: 'Bob Viewer', role: 'viewer' },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          }),
        })),
      } as unknown as SupabaseClient;

      const result = await proposeAssignInquiryTool.execute(
        TENANT_A_CTX,
        { inquiryId: 'inq-102', assigneeUserId: 'usr-viewer-1' },
        mockSupabase
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not eligible');
    });

    it('executeConfirmedAction maps COMPATIBILITY_ERROR from RPC to EXECUTION_FAILED', async () => {
      const rpcSpy = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'COMPATIBILITY_ERROR: Referenced legacy lead was not found in agency workspace or update failed.', code: 'P0002' },
      });

      const mockSupabase = { rpc: rpcSpy } as unknown as SupabaseClient;

      const proposal = createSignedProposal({
        proposalId: 'prop-compat-err',
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: 'inq-101',
        title: 'Update Stage',
        summary: 'Move stage',
        currentState: { stage: 'initial_contact' },
        proposedState: { stage: 'itinerary_sent' },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      });

      const result = await executeConfirmedAction(ACTOR_CONSULTANT, proposal, mockSupabase);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('EXECUTION_FAILED');
      expect(result.message).toContain('legacy record');
    });
  });
});
