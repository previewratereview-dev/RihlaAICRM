/**
 * CRM Copilot Action Proposal Tools (Phase AI-3)
 * 
 * Model-visible proposal capabilities that construct structured ActionProposalDTOs.
 * 
 * INVARIANTS:
 * - ZERO business mutations (0 inserts, 0 updates, 0 deletes, 0 RPC mutations).
 * - Reads current state to populate accurate before/after details.
 * - Proposal object owns execution semantics.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TrustedExecutionContext, ToolResult, ToolDefinition } from '../tools/types';
import {
  type ActionProposalDTO,
  type ValidInquiryStage,
  STAGE_LABELS,
  ProposeUpdateInquiryStageSchema,
  ProposeAssignInquirySchema,
  ProposeSetInquiryFollowUpSchema,
} from './types';
import { signProposal, isActionSigningConfigured } from './signatures';

export interface ProposalOutput {
  proposal: ActionProposalDTO;
  summaryText: string;
}

/**
 * Model tool: Propose moving an inquiry to a new pipeline stage.
 * Pure read-only proposal creation.
 */
export const proposeUpdateInquiryStageTool: ToolDefinition<typeof ProposeUpdateInquiryStageSchema, ProposalOutput> = {
  name: 'proposeUpdateInquiryStage',
  description: 'Propose moving an inquiry to a new pipeline stage. Renders a confirmation card to the user. ZERO mutations occur until the user explicitly confirms.',
  parameters: ProposeUpdateInquiryStageSchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<ProposalOutput>> => {
    if (!isActionSigningConfigured()) {
      return {
        success: false,
        error: 'CRM action proposals are temporarily unavailable because COPILOT_ACTION_SECRET is not configured on the server.',
      };
    }
    try {
      const inquiryId = params.inquiryId.trim();
      const targetStage = params.proposedStage as ValidInquiryStage;

      // 1. Read current inquiry state
      const { data: inq, error } = await supabase
        .from('inquiries')
        .select('id, destination, pipeline_stage, traveler_id')
        .eq('id', inquiryId)
        .eq('tenant_id', context.tenantId)
        .maybeSingle();

      if (error) {
        console.error('[Copilot Proposal Error] proposeUpdateInquiryStage query:', error.message);
        return { success: false, error: 'Unable to retrieve inquiry for stage proposal.' };
      }

      if (!inq) {
        return { success: false, error: 'Inquiry not found in current workspace.' };
      }

      const currentStage = (inq.pipeline_stage || 'inquiry_received') as ValidInquiryStage;
      const currentStageLabel = STAGE_LABELS[currentStage] || currentStage;
      const proposedStageLabel = STAGE_LABELS[targetStage] || targetStage;

      // Fetch traveler display name if available
      let travelerName = 'Traveler';
      if (inq.traveler_id) {
        const { data: trav } = await supabase
          .from('traveler_profiles')
          .select('display_name')
          .eq('id', inq.traveler_id)
          .eq('tenant_id', context.tenantId)
          .maybeSingle();
        if (trav?.display_name) travelerName = trav.display_name;
      }

      const destTitle = inq.destination ? `${inq.destination} — ${travelerName}` : travelerName;
      const proposalId = `prop-stage-${Date.now()}-${inquiryId.slice(0, 8)}`;

      const proposal: ActionProposalDTO = {
        proposalId,
        actionType: 'update_inquiry_stage',
        entityType: 'inquiry',
        entityId: inq.id,
        title: `Update Stage: ${destTitle}`,
        summary: `Move inquiry from "${currentStageLabel}" to "${proposedStageLabel}".`,
        currentState: {
          stage: currentStage,
          stageLabel: currentStageLabel,
        },
        proposedState: {
          stage: targetStage,
          stageLabel: proposedStageLabel,
        },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };
      proposal.signature = signProposal(proposal);

      return {
        success: true,
        data: {
          proposal,
          summaryText: `I have prepared a proposal to move this inquiry to **${proposedStageLabel}**. Please review the confirmation card above and click Confirm to execute.`,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[Copilot Proposal Exception] proposeUpdateInquiryStage:', msg);
      return { success: false, error: 'Unable to prepare stage update proposal.' };
    }
  },
};

/**
 * Model tool: Propose assigning an inquiry to a team member.
 * Pure read-only proposal creation.
 */
export const proposeAssignInquiryTool: ToolDefinition<typeof ProposeAssignInquirySchema, ProposalOutput> = {
  name: 'proposeAssignInquiry',
  description: 'Propose assigning an inquiry to a team member in the workspace. Renders a confirmation card to the user. ZERO mutations occur until the user confirms.',
  parameters: ProposeAssignInquirySchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<ProposalOutput>> => {
    if (!isActionSigningConfigured()) {
      return {
        success: false,
        error: 'CRM action proposals are temporarily unavailable because COPILOT_ACTION_SECRET is not configured on the server.',
      };
    }
    try {
      const inquiryId = params.inquiryId.trim();
      const assigneeUserId = params.assigneeUserId.trim();

      // 1. Read current inquiry state
      const { data: inq, error: inqErr } = await supabase
        .from('inquiries')
        .select('id, destination, assigned_agent_id, traveler_id')
        .eq('id', inquiryId)
        .eq('tenant_id', context.tenantId)
        .maybeSingle();

      if (inqErr || !inq) {
        return { success: false, error: 'Inquiry not found in current workspace.' };
      }

      // 2. Read proposed assignee profile
      const { data: newAssignee, error: userErr } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', assigneeUserId)
        .eq('tenant_id', context.tenantId)
        .maybeSingle();

      if (userErr || !newAssignee) {
        return { success: false, error: 'Target assignee not found in current agency workspace.' };
      }

      // 3. Read current assignee profile if present
      let currentAssigneeName = 'Unassigned';
      if (inq.assigned_agent_id) {
        const { data: curUser } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', inq.assigned_agent_id)
          .eq('tenant_id', context.tenantId)
          .maybeSingle();
        if (curUser?.full_name) currentAssigneeName = curUser.full_name;
      }

      const proposalId = `prop-assign-${Date.now()}-${inquiryId.slice(0, 8)}`;
      const newAssigneeName = newAssignee.full_name || 'Team Member';

      const proposal: ActionProposalDTO = {
        proposalId,
        actionType: 'assign_inquiry',
        entityType: 'inquiry',
        entityId: inq.id,
        title: `Assign Inquiry: ${inq.destination || 'Trip'}`,
        summary: `Reassign inquiry from ${currentAssigneeName} to ${newAssigneeName}.`,
        currentState: {
          assignedAgentId: inq.assigned_agent_id || null,
          assignedAgentName: currentAssigneeName,
        },
        proposedState: {
          assignedAgentId: newAssignee.id,
          assignedAgentName: newAssigneeName,
        },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };
      proposal.signature = signProposal(proposal);

      return {
        success: true,
        data: {
          proposal,
          summaryText: `I have prepared a proposal to assign this inquiry to **${newAssigneeName}**. Please review the confirmation card above and click Confirm.`,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[Copilot Proposal Exception] proposeAssignInquiry:', msg);
      return { success: false, error: 'Unable to prepare assignment proposal.' };
    }
  },
};

/**
 * Model tool: Propose setting or changing the next follow-up date for an inquiry.
 * Pure read-only proposal creation.
 */
export const proposeSetInquiryFollowUpTool: ToolDefinition<typeof ProposeSetInquiryFollowUpSchema, ProposalOutput> = {
  name: 'proposeSetInquiryFollowUp',
  description: 'Propose setting, rescheduling, or clearing the follow-up datetime for an inquiry. Renders a confirmation card. ZERO mutations occur until the user confirms.',
  parameters: ProposeSetInquiryFollowUpSchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<ProposalOutput>> => {
    if (!isActionSigningConfigured()) {
      return {
        success: false,
        error: 'CRM action proposals are temporarily unavailable because COPILOT_ACTION_SECRET is not configured on the server.',
      };
    }
    try {
      const inquiryId = params.inquiryId.trim();
      const nextFollowUpAt = params.nextFollowUpAt ? new Date(params.nextFollowUpAt).toISOString() : null;

      const { data: inq, error } = await supabase
        .from('inquiries')
        .select('id, destination, next_follow_up_at')
        .eq('id', inquiryId)
        .eq('tenant_id', context.tenantId)
        .maybeSingle();

      if (error || !inq) {
        return { success: false, error: 'Inquiry not found in current workspace.' };
      }

      const proposalId = `prop-followup-${Date.now()}-${inquiryId.slice(0, 8)}`;
      const currentFormatted = inq.next_follow_up_at ? new Date(inq.next_follow_up_at).toLocaleString() : 'Not scheduled';
      const proposedFormatted = nextFollowUpAt ? new Date(nextFollowUpAt).toLocaleString() : 'Clear follow-up';

      const proposal: ActionProposalDTO = {
        proposalId,
        actionType: 'set_inquiry_follow_up',
        entityType: 'inquiry',
        entityId: inq.id,
        title: `Set Follow-Up: ${inq.destination || 'Inquiry'}`,
        summary: `Change follow-up from "${currentFormatted}" to "${proposedFormatted}".`,
        currentState: {
          nextFollowUpAt: inq.next_follow_up_at || null,
        },
        proposedState: {
          nextFollowUpAt,
        },
        riskLevel: 'internal',
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };
      proposal.signature = signProposal(proposal);

      return {
        success: true,
        data: {
          proposal,
          summaryText: `I have prepared a proposal to schedule follow-up for **${proposedFormatted}**. Please review the confirmation card above and click Confirm.`,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[Copilot Proposal Exception] proposeSetInquiryFollowUp:', msg);
      return { success: false, error: 'Unable to prepare follow-up proposal.' };
    }
  },
};
