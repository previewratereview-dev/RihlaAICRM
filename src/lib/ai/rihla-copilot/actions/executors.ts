/**
 * CRM Copilot Action Mutation Executors (Phase AI-3A)
 * 
 * Deterministic, server-only mutation executors invoked ONLY upon explicit human confirmation.
 * Delegates execution to the atomic database RPC: public.execute_copilot_inquiry_action_atomic.
 * 
 * INVARIANTS:
 * - NOT exposed as model tools.
 * - Single atomic database transaction covers canonical Inquiry update, legacy Lead dual-write,
 *   single-use proposal execution receipt, and activity log insert.
 * - Proposal execution is transactionally single-use (duplicate proposal_id rejected with ALREADY_EXECUTED).
 * - Re-authenticates actor session, tenant boundary, and RBAC write permissions.
 * - Re-reads authoritative DB record and aborts on stale state (optimistic concurrency).
 * - Attributes audit log / activity to the authenticated human user.
 * - Zero external messaging (no email, WhatsApp, SMS).
 * - Zero financial or booking mutations.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/types/common';
import {
  type ActionProposalDTO,
  type ActionExecutionResult,
  type ActionType,
  type ValidInquiryStage,
  WRITABLE_ROLES,
  STAGE_LABELS,
} from './types';
import { verifyProposalSignature, isProposalExpired } from './signatures';

export interface AuthenticatedActor {
  userId: string;
  fullName: string;
  role: UserRole;
  tenantId: string;
}

/**
 * Maps Supabase RPC errors to sanitized, client-safe ActionExecutionResults.
 */
function mapRpcErrorToActionExecutionResult(
  actionType: ActionType,
  entityId: string,
  error: { message?: string; code?: string } | null
): ActionExecutionResult {
  const msg = error?.message || 'Database execution error';
  const code = error?.code || '';

  if (msg.includes('ALREADY_EXECUTED') || code === '23505') {
    return {
      success: false,
      actionType,
      entityId,
      message: 'This action proposal has already been executed. No changes made.',
      error: 'Proposal already executed',
      errorCode: 'ALREADY_EXECUTED',
    };
  }

  if (msg.includes('STALE_STATE') || code === 'P0001') {
    return {
      success: false,
      actionType,
      entityId,
      message: 'The record was modified after this action was prepared, or is already in the target state. Please review the latest record.',
      error: 'Stale state conflict',
      errorCode: 'STALE_STATE',
    };
  }

  if (msg.includes('FORBIDDEN') || code === '42501') {
    return {
      success: false,
      actionType,
      entityId,
      message: 'You do not have permission to execute this CRM action.',
      error: 'Forbidden',
      errorCode: 'FORBIDDEN',
    };
  }

  if (msg.includes('NOT_FOUND') || code === 'P0002') {
    return {
      success: false,
      actionType,
      entityId,
      message: 'Inquiry not found in current agency workspace.',
      error: 'Not found',
      errorCode: 'NOT_FOUND',
    };
  }

  if (msg.includes('INVALID_ARGUMENT') || code === '22023') {
    return {
      success: false,
      actionType,
      entityId,
      message: 'Invalid action arguments provided.',
      error: 'Invalid argument',
      errorCode: 'INVALID_ARGUMENT',
    };
  }

  return {
    success: false,
    actionType,
    entityId,
    message: 'Database error executing atomic CRM action.',
    error: 'Execution failed',
    errorCode: 'EXECUTION_FAILED',
  };
}

/**
 * Executes an action proposal after explicit human confirmation and full server revalidation.
 */
export async function executeConfirmedAction(
  actor: AuthenticatedActor,
  proposal: ActionProposalDTO,
  supabase: SupabaseClient
): Promise<ActionExecutionResult> {
  // 1. Revalidate Actor & Tenant
  if (!actor || !actor.userId || !actor.tenantId) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: proposal.entityId,
      message: 'Authentication is required to execute CRM actions.',
      error: 'Unauthenticated actor',
      errorCode: 'UNAUTHORIZED',
    };
  }

  // 2. Verify Exact Cryptographic Proposal Integrity Signature (HMAC)
  if (!verifyProposalSignature(proposal)) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: proposal.entityId,
      message: 'Action proposal integrity check failed. The proposal was tampered with, unsigned, or invalid.',
      error: 'Invalid proposal signature',
      errorCode: 'INVALID_SIGNATURE',
    };
  }

  // 3. Verify Bounded Proposal TTL (10 minutes)
  if (isProposalExpired(proposal)) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: proposal.entityId,
      message: 'Action proposal has expired (10 minute limit). Please request a fresh action.',
      error: 'Expired proposal',
      errorCode: 'EXPIRED_PROPOSAL',
    };
  }

  // 4. Revalidate RBAC (Viewer role cannot write, Super Admin cannot perform agency CRM writes)
  if (actor.role === 'super_admin') {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: proposal.entityId,
      message: 'Platform Super Admin cannot perform Agency CRM mutations.',
      error: 'Super Admin write blocked',
      errorCode: 'FORBIDDEN',
    };
  }

  if (!WRITABLE_ROLES.has(actor.role)) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: proposal.entityId,
      message: 'Your role (Viewer) has read-only access and cannot perform CRM mutations.',
      error: 'Insufficient RBAC permissions',
      errorCode: 'FORBIDDEN',
    };
  }

  // 5. Dispatch specific atomic server action executor
  switch (proposal.actionType) {
    case 'update_inquiry_stage':
      return await executeUpdateInquiryStage(actor, proposal, supabase);
    case 'assign_inquiry':
      return await executeAssignInquiry(actor, proposal, supabase);
    case 'set_inquiry_follow_up':
      return await executeSetInquiryFollowUp(actor, proposal, supabase);
    default:
      return {
        success: false,
        actionType: proposal.actionType,
        entityId: proposal.entityId,
        message: 'Unknown or unapproved action type.',
        error: 'Invalid action type',
        errorCode: 'INVALID_ARGUMENT',
      };
  }
}

/**
 * Server Executor 1: Atomic Update Inquiry Stage
 */
export async function executeUpdateInquiryStage(
  _actor: AuthenticatedActor,
  proposal: ActionProposalDTO,
  supabase: SupabaseClient
): Promise<ActionExecutionResult> {
  const targetStage = proposal.proposedState.stage as ValidInquiryStage;
  if (!targetStage || !STAGE_LABELS[targetStage]) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: proposal.entityId,
      message: 'Invalid target pipeline stage.',
      error: 'Invalid target stage',
      errorCode: 'INVALID_ARGUMENT',
    };
  }

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('execute_copilot_inquiry_action_atomic', {
    p_proposal_id: proposal.proposalId,
    p_inquiry_id: proposal.entityId,
    p_action_type: 'update_inquiry_stage',
    p_expected_current_state: proposal.currentState || {},
    p_proposed_state: proposal.proposedState || {},
  });

  if (rpcErr) {
    return mapRpcErrorToActionExecutionResult('update_inquiry_stage', proposal.entityId, rpcErr);
  }

  if (!rpcResult || !rpcResult.success) {
    return {
      success: false,
      actionType: 'update_inquiry_stage',
      entityId: proposal.entityId,
      message: rpcResult?.message || 'Database error updating inquiry stage.',
      error: 'Execution failed',
      errorCode: 'EXECUTION_FAILED',
    };
  }

  const stageLabel = STAGE_LABELS[targetStage] || targetStage;
  return {
    success: true,
    actionType: 'update_inquiry_stage',
    entityId: proposal.entityId,
    message: `Stage successfully updated to **${stageLabel}**.`,
    newState: {
      stage: targetStage,
      stageLabel,
      updatedAt: rpcResult.newState?.updatedAt || new Date().toISOString(),
    },
  };
}

/**
 * Server Executor 2: Atomic Assign Inquiry
 */
export async function executeAssignInquiry(
  _actor: AuthenticatedActor,
  proposal: ActionProposalDTO,
  supabase: SupabaseClient
): Promise<ActionExecutionResult> {
  const targetAssigneeId = proposal.proposedState.assignedAgentId;
  if (!targetAssigneeId) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: proposal.entityId,
      message: 'Target assignee ID is required.',
      error: 'Missing assignee',
      errorCode: 'INVALID_ARGUMENT',
    };
  }

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('execute_copilot_inquiry_action_atomic', {
    p_proposal_id: proposal.proposalId,
    p_inquiry_id: proposal.entityId,
    p_action_type: 'assign_inquiry',
    p_expected_current_state: proposal.currentState || {},
    p_proposed_state: proposal.proposedState || {},
  });

  if (rpcErr) {
    return mapRpcErrorToActionExecutionResult('assign_inquiry', proposal.entityId, rpcErr);
  }

  if (!rpcResult || !rpcResult.success) {
    return {
      success: false,
      actionType: 'assign_inquiry',
      entityId: proposal.entityId,
      message: rpcResult?.message || 'Database error assigning inquiry.',
      error: 'Execution failed',
      errorCode: 'EXECUTION_FAILED',
    };
  }

  const assigneeName = proposal.proposedState.assignedAgentName || 'Team Member';
  return {
    success: true,
    actionType: 'assign_inquiry',
    entityId: proposal.entityId,
    message: `Inquiry successfully assigned to **${assigneeName}**.`,
    newState: {
      assignedAgentId: targetAssigneeId,
      assignedAgentName: assigneeName,
      updatedAt: rpcResult.newState?.updatedAt || new Date().toISOString(),
    },
  };
}

/**
 * Server Executor 3: Atomic Set Inquiry Next Follow-Up
 */
export async function executeSetInquiryFollowUp(
  _actor: AuthenticatedActor,
  proposal: ActionProposalDTO,
  supabase: SupabaseClient
): Promise<ActionExecutionResult> {
  const targetFollowUpAt = proposal.proposedState.nextFollowUpAt || null;

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('execute_copilot_inquiry_action_atomic', {
    p_proposal_id: proposal.proposalId,
    p_inquiry_id: proposal.entityId,
    p_action_type: 'set_inquiry_follow_up',
    p_expected_current_state: proposal.currentState || {},
    p_proposed_state: proposal.proposedState || {},
  });

  if (rpcErr) {
    return mapRpcErrorToActionExecutionResult('set_inquiry_follow_up', proposal.entityId, rpcErr);
  }

  if (!rpcResult || !rpcResult.success) {
    return {
      success: false,
      actionType: 'set_inquiry_follow_up',
      entityId: proposal.entityId,
      message: rpcResult?.message || 'Database error setting follow-up date.',
      error: 'Execution failed',
      errorCode: 'EXECUTION_FAILED',
    };
  }

  const formattedDate = targetFollowUpAt ? new Date(targetFollowUpAt).toLocaleString() : 'Cleared';
  return {
    success: true,
    actionType: 'set_inquiry_follow_up',
    entityId: proposal.entityId,
    message: `Follow-up successfully scheduled for **${formattedDate}**.`,
    newState: {
      nextFollowUpAt: targetFollowUpAt,
      updatedAt: rpcResult.newState?.updatedAt || new Date().toISOString(),
    },
  };
}
