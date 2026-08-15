/**
 * CRM Copilot Governed Action Types (Phase AI-3)
 * 
 * Strict separation between model-visible proposal capabilities
 * and deterministic server-only mutation executors.
 */
import { z } from 'zod';
import type { UserRole } from '@/types/common';

export type ActionType = 'update_inquiry_stage' | 'assign_inquiry' | 'set_inquiry_follow_up';

export const VALID_INQUIRY_STAGES = [
  'inquiry_received',
  'initial_contact',
  'options_shared',
  'consultation_booked',
  'itinerary_sent',
  'follow_up',
  'customizing_package',
  'booking_confirmed',
  'booking_lost',
] as const;

export type ValidInquiryStage = (typeof VALID_INQUIRY_STAGES)[number];

export const STAGE_LABELS: Record<ValidInquiryStage, string> = {
  inquiry_received: 'Inquiry Received',
  initial_contact: 'Initial Contact',
  options_shared: 'Options Shared',
  consultation_booked: 'Consultation Booked',
  itinerary_sent: 'Itinerary Sent',
  follow_up: 'Follow-Up',
  customizing_package: 'Customizing Package',
  booking_confirmed: 'Booking Confirmed',
  booking_lost: 'Booking Lost',
};

// Zod schemas for proposal tools (model-visible)
export const ProposeUpdateInquiryStageSchema = z.object({
  inquiryId: z.string().min(1, 'Inquiry ID is required'),
  proposedStage: z.enum(VALID_INQUIRY_STAGES),
  reason: z.string().optional(),
});

export const ProposeAssignInquirySchema = z.object({
  inquiryId: z.string().min(1, 'Inquiry ID is required'),
  assigneeUserId: z.string().min(1, 'Assignee user ID is required'),
  reason: z.string().optional(),
});

export const ProposeSetInquiryFollowUpSchema = z.object({
  inquiryId: z.string().min(1, 'Inquiry ID is required'),
  nextFollowUpAt: z.string().nullable(), // ISO 8601 string or null to clear
  reason: z.string().optional(),
});

export interface ActionProposalDTO {
  proposalId: string;
  actionType: ActionType;
  entityType: 'inquiry';
  entityId: string;
  title: string;
  summary: string;
  currentState: {
    stage?: string;
    stageLabel?: string;
    assignedAgentId?: string | null;
    assignedAgentName?: string | null;
    nextFollowUpAt?: string | null;
  };
  proposedState: {
    stage?: string;
    stageLabel?: string;
    assignedAgentId?: string | null;
    assignedAgentName?: string | null;
    nextFollowUpAt?: string | null;
  };
  riskLevel: 'internal';
  requiresConfirmation: true;
  createdAt: string;
}

export interface ActionExecutionResult {
  success: boolean;
  actionType: ActionType;
  entityId: string;
  message: string;
  newState?: Record<string, unknown>;
  error?: string;
  errorCode?: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'STALE_STATE' | 'INVALID_ARGUMENT' | 'EXECUTION_FAILED';
}

export const WRITABLE_ROLES: Set<UserRole> = new Set([
  'admin',
  'manager',
  'specialist',
  'setter',
  'closer',
  'consultant',
]);
