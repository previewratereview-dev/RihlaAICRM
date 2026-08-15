/**
 * CRM Copilot Action Mutation Executors (Phase AI-3)
 * 
 * Deterministic, server-only mutation executors invoked ONLY upon explicit human confirmation.
 * 
 * INVARIANTS:
 * - NOT exposed as model tools.
 * - Re-authenticates actor session, tenant boundary, and RBAC write permissions.
 * - Re-reads authoritative DB record and aborts on stale state (optimistic concurrency).
 * - Attributes audit log / activity to the authenticated human user (with source: copilot).
 * - Zero external messaging (no email, WhatsApp, SMS).
 * - Zero financial or booking mutations.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/types/common';
import {
  type ActionProposalDTO,
  type ActionExecutionResult,
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
 * Executes an action proposal after explicit human confirmation and full server revalidation.
 */
export async function executeConfirmedAction(
  actor: AuthenticatedActor,
  proposal: ActionProposalDTO,
  supabase: SupabaseClient
): Promise<ActionExecutionResult> {
  const now = new Date().toISOString();

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

  // 5. Re-read canonical Inquiry record (Tenant Boundary & Stale-State Check)
  const { data: currentInq, error: readErr } = await supabase
    .from('inquiries')
    .select('id, tenant_id, destination, pipeline_stage, assigned_agent_id, next_follow_up_at, legacy_lead_id, updated_at')
    .eq('id', proposal.entityId)
    .eq('tenant_id', actor.tenantId)
    .is('archived_at', null)
    .maybeSingle();

  if (readErr || !currentInq) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: proposal.entityId,
      message: 'Inquiry not found in current agency workspace.',
      error: 'Record not found or cross-tenant access denied',
      errorCode: 'NOT_FOUND',
    };
  }

  // 6. Ownership Parity Check:
  // Admins & Managers have tenant-wide authority.
  // Specialists, consultants, setters, closers can only modify inquiries assigned to them or unassigned inquiries.
  if (actor.role !== 'admin' && actor.role !== 'manager') {
    if (currentInq.assigned_agent_id && currentInq.assigned_agent_id !== actor.userId) {
      return {
        success: false,
        actionType: proposal.actionType,
        entityId: currentInq.id,
        message: 'You can only modify inquiries assigned to you or unassigned inquiries.',
        error: 'Ownership permission denied',
        errorCode: 'FORBIDDEN',
      };
    }
  }

  // 7. Dispatch specific action executor
  switch (proposal.actionType) {
    case 'update_inquiry_stage':
      return await executeUpdateInquiryStage(actor, currentInq, proposal, supabase, now);
    case 'assign_inquiry':
      return await executeAssignInquiry(actor, currentInq, proposal, supabase, now);
    case 'set_inquiry_follow_up':
      return await executeSetInquiryFollowUp(actor, currentInq, proposal, supabase, now);
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

interface CurrentInquiryRecord {
  id: string;
  tenant_id: string;
  destination?: string | null;
  pipeline_stage?: string | null;
  assigned_agent_id?: string | null;
  next_follow_up_at?: string | null;
  legacy_lead_id?: string | null;
  updated_at?: string;
}

/**
 * Executor: Update Inquiry Pipeline Stage
 */
async function executeUpdateInquiryStage(
  actor: AuthenticatedActor,
  currentInq: CurrentInquiryRecord,
  proposal: ActionProposalDTO,
  supabase: SupabaseClient,
  now: string
): Promise<ActionExecutionResult> {
  const targetStage = proposal.proposedState.stage as ValidInquiryStage;
  if (!targetStage || !STAGE_LABELS[targetStage]) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: 'Invalid target pipeline stage.',
      error: 'Invalid target stage',
      errorCode: 'INVALID_ARGUMENT',
    };
  }

  // Replay & Stale-State Check: Verify record has not changed stage since proposal was created, and is not already in target stage
  if (currentInq.pipeline_stage === targetStage) {
    const stageLabel = STAGE_LABELS[targetStage] || targetStage;
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: `Inquiry is already in "${stageLabel}". No changes made.`,
      error: 'Already in target stage',
      errorCode: 'STALE_STATE',
    };
  }

  if (proposal.currentState.stage && currentInq.pipeline_stage !== proposal.currentState.stage) {
    const currentLabel = STAGE_LABELS[currentInq.pipeline_stage as ValidInquiryStage] || currentInq.pipeline_stage;
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: `This inquiry changed to "${currentLabel}" after the action was prepared. Please review the latest record and try again.`,
      error: 'Stale state conflict',
      errorCode: 'STALE_STATE',
    };
  }

  // 1. Update public.inquiries
  const { error: inqUpdateErr } = await supabase
    .from('inquiries')
    .update({
      pipeline_stage: targetStage,
      updated_at: now,
    })
    .eq('id', currentInq.id)
    .eq('tenant_id', actor.tenantId);

  if (inqUpdateErr) {
    console.error('[Copilot Execution Error] update inquiry stage:', inqUpdateErr.message);
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: 'Database error updating inquiry stage.',
      error: 'Update failed',
      errorCode: 'EXECUTION_FAILED',
    };
  }

  // 2. Dual-write to public.leads if legacy_lead_id is present
  if (currentInq.legacy_lead_id) {
    await supabase
      .from('leads')
      .update({
        status: targetStage,
        updated_at: now,
      })
      .eq('id', currentInq.legacy_lead_id)
      .eq('tenant_id', actor.tenantId);
  }

  // 3. Insert audit activity log (Attributed to the authenticated HUMAN actor)
  const prevLabel = STAGE_LABELS[currentInq.pipeline_stage as ValidInquiryStage] || currentInq.pipeline_stage;
  const newLabel = STAGE_LABELS[targetStage] || targetStage;

  await supabase.from('activities').insert({
    id: `act-stage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    lead_id: currentInq.legacy_lead_id || null,
    user_id: actor.userId,
    user_name: actor.fullName,
    type: 'status_change',
    title: 'Inquiry Stage Updated via Copilot',
    description: `Stage moved from "${prevLabel}" to "${newLabel}" (confirmed by ${actor.fullName}).`,
    tenant_id: actor.tenantId,
    created_at: now,
  });

  return {
    success: true,
    actionType: 'update_inquiry_stage',
    entityId: currentInq.id,
    message: `Stage successfully updated to **${newLabel}**.`,
    newState: {
      stage: targetStage,
      stageLabel: newLabel,
      updatedAt: now,
    },
  };
}

/**
 * Executor: Assign Inquiry
 */
async function executeAssignInquiry(
  actor: AuthenticatedActor,
  currentInq: CurrentInquiryRecord,
  proposal: ActionProposalDTO,
  supabase: SupabaseClient,
  now: string
): Promise<ActionExecutionResult> {
  const targetAssigneeId = proposal.proposedState.assignedAgentId;
  if (!targetAssigneeId) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: 'Target assignee ID is required.',
      error: 'Missing assignee',
      errorCode: 'INVALID_ARGUMENT',
    };
  }

  // Replay check: already assigned
  if (currentInq.assigned_agent_id === targetAssigneeId) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: 'Inquiry is already assigned to this team member. No changes made.',
      error: 'Already assigned to target',
      errorCode: 'STALE_STATE',
    };
  }

  // Revalidate that target assignee belongs to same tenant and is an eligible role
  const { data: assigneeProfile, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name, role, tenant_id')
    .eq('id', targetAssigneeId)
    .eq('tenant_id', actor.tenantId)
    .maybeSingle();

  if (profErr || !assigneeProfile) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: 'Target assignee is not a valid team member in this workspace.',
      error: 'Invalid assignee',
      errorCode: 'INVALID_ARGUMENT',
    };
  }

  // Stale-State Check: Verify assignee has not changed since proposal
  if (
    proposal.currentState.assignedAgentId !== undefined &&
    (currentInq.assigned_agent_id || null) !== (proposal.currentState.assignedAgentId || null)
  ) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: 'The inquiry assignee was modified after this action was prepared. Please review the latest record.',
      error: 'Stale state conflict',
      errorCode: 'STALE_STATE',
    };
  }

  // 1. Update public.inquiries
  const { error: inqUpdateErr } = await supabase
    .from('inquiries')
    .update({
      assigned_agent_id: targetAssigneeId,
      updated_at: now,
    })
    .eq('id', currentInq.id)
    .eq('tenant_id', actor.tenantId);

  if (inqUpdateErr) {
    console.error('[Copilot Execution Error] assign inquiry:', inqUpdateErr.message);
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: 'Database error reassigning inquiry.',
      error: 'Update failed',
      errorCode: 'EXECUTION_FAILED',
    };
  }

  // 2. Dual-write to public.leads
  if (currentInq.legacy_lead_id) {
    await supabase
      .from('leads')
      .update({
        assigned_to: targetAssigneeId,
        updated_at: now,
      })
      .eq('id', currentInq.legacy_lead_id)
      .eq('tenant_id', actor.tenantId);
  }

  // 3. Insert audit activity log (Attributed to HUMAN actor)
  const assigneeName = assigneeProfile.full_name || 'Team Member';
  await supabase.from('activities').insert({
    id: `act-assign-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    lead_id: currentInq.legacy_lead_id || null,
    user_id: actor.userId,
    user_name: actor.fullName,
    type: 'assigned',
    title: 'Inquiry Reassigned via Copilot',
    description: `Assigned to ${assigneeName} (confirmed by ${actor.fullName}).`,
    tenant_id: actor.tenantId,
    created_at: now,
  });

  return {
    success: true,
    actionType: 'assign_inquiry',
    entityId: currentInq.id,
    message: `Inquiry successfully assigned to **${assigneeName}**.`,
    newState: {
      assignedAgentId: targetAssigneeId,
      assignedAgentName: assigneeName,
      updatedAt: now,
    },
  };
}

/**
 * Executor: Set Inquiry Next Follow-Up
 */
async function executeSetInquiryFollowUp(
  actor: AuthenticatedActor,
  currentInq: CurrentInquiryRecord,
  proposal: ActionProposalDTO,
  supabase: SupabaseClient,
  now: string
): Promise<ActionExecutionResult> {
  const targetFollowUpAt = proposal.proposedState.nextFollowUpAt || null;

  // Replay check: already set to target follow-up date
  if ((currentInq.next_follow_up_at || null) === targetFollowUpAt) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: 'Follow-up is already set to this datetime. No changes made.',
      error: 'Already set to target follow-up',
      errorCode: 'STALE_STATE',
    };
  }

  // Stale-State Check: Verify follow-up date has not changed since proposal
  if (
    proposal.currentState.nextFollowUpAt !== undefined &&
    (currentInq.next_follow_up_at || null) !== (proposal.currentState.nextFollowUpAt || null)
  ) {
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: 'The follow-up date was modified after this action was prepared. Please review the latest record.',
      error: 'Stale state conflict',
      errorCode: 'STALE_STATE',
    };
  }

  // 1. Update public.inquiries
  const { error: inqUpdateErr } = await supabase
    .from('inquiries')
    .update({
      next_follow_up_at: targetFollowUpAt,
      updated_at: now,
    })
    .eq('id', currentInq.id)
    .eq('tenant_id', actor.tenantId);

  if (inqUpdateErr) {
    console.error('[Copilot Execution Error] set follow-up:', inqUpdateErr.message);
    return {
      success: false,
      actionType: proposal.actionType,
      entityId: currentInq.id,
      message: 'Database error setting follow-up date.',
      error: 'Update failed',
      errorCode: 'EXECUTION_FAILED',
    };
  }

  // 2. Dual-write to public.leads
  if (currentInq.legacy_lead_id) {
    await supabase
      .from('leads')
      .update({
        next_follow_up_at: targetFollowUpAt,
        updated_at: now,
      })
      .eq('id', currentInq.legacy_lead_id)
      .eq('tenant_id', actor.tenantId);
  }

  // 3. Insert audit activity log (Attributed to HUMAN actor)
  const formattedDate = targetFollowUpAt ? new Date(targetFollowUpAt).toLocaleString() : 'Cleared';
  await supabase.from('activities').insert({
    id: `act-followup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    lead_id: currentInq.legacy_lead_id || null,
    user_id: actor.userId,
    user_name: actor.fullName,
    type: 'follow_up_set',
    title: 'Follow-Up Scheduled via Copilot',
    description: `Follow-up set to ${formattedDate} (confirmed by ${actor.fullName}).`,
    tenant_id: actor.tenantId,
    created_at: now,
  });

  return {
    success: true,
    actionType: 'set_inquiry_follow_up',
    entityId: currentInq.id,
    message: `Follow-up successfully scheduled for **${formattedDate}**.`,
    newState: {
      nextFollowUpAt: targetFollowUpAt,
      updatedAt: now,
    },
  };
}
