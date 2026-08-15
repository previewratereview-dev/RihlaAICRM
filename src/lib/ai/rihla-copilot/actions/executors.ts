/**
 * CRM Copilot Action Mutation Executors (Phase AI-3A)
 * 
 * Deterministic, server-only mutation executors invoked ONLY upon explicit human confirmation.
 * Delegates execution to the atomic database RPC: public.execute_copilot_inquiry_action_atomic
 * using a server-only service_role transport client.
 * 
 * INVARIANTS:
 * - NOT exposed as model tools.
 * - Single atomic database transaction covers canonical Inquiry update, legacy Lead dual-write,
 *   single-use proposal execution receipt, and activity log insert.
 * - RPC execution privilege is restricted to service_role (REVOKED from authenticated and anon).
 * - Direct browser invocation of the RPC is impossible and fails with permission denied.
 * - Server Action derives actor.userId from verified session and passes it as p_actor_user_id.
 * - Database independently validates actor profile, role, tenant, and inquiry ownership.
 * - Zero external messaging (no email, WhatsApp, SMS).
 * - Zero financial or booking mutations.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
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
 * Resolves the server-only admin/service_role Supabase client.
 */
function resolveExecutionClient(customClient?: SupabaseClient): SupabaseClient | null {
  if (customClient) return customClient;
  return createAdminClient();
}

/**
 * Executes an action proposal after explicit human confirmation and full server revalidation.
 */
export async function executeConfirmedAction(
  actor: AuthenticatedActor,
  proposal: ActionProposalDTO,
  adminSupabase?: SupabaseClient
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

  const client = resolveExecutionClient(adminSupabase);
  if (!client) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: proposal.entityId,
      message: 'Internal server configuration error: execution client unavailable.',
      error: 'Admin client unavailable',
      errorCode: 'EXECUTION_FAILED',
    };
  }

  // 5. Dispatch specific atomic server action executor
  switch (proposal.actionType) {
    case 'update_inquiry_stage':
      return await executeUpdateInquiryStage(actor, proposal, client);
    case 'assign_inquiry':
      return await executeAssignInquiry(actor, proposal, client);
    case 'set_inquiry_follow_up':
      return await executeSetInquiryFollowUp(actor, proposal, client);
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
  actor: AuthenticatedActor,
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
    p_actor_user_id: actor.userId,
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
  actor: AuthenticatedActor,
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
    p_actor_user_id: actor.userId,
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
  actor: AuthenticatedActor,
  proposal: ActionProposalDTO,
  supabase: SupabaseClient
): Promise<ActionExecutionResult> {
  const targetFollowUpAt = proposal.proposedState.nextFollowUpAt || null;

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('execute_copilot_inquiry_action_atomic', {
    p_actor_user_id: actor.userId,
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
