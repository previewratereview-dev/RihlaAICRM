/**
 * Phase AI-4B: Deterministic Attention Engine Types
 * 
 * Defines normalized fact DTOs, signal descriptors, and attention summaries.
 * Pure data representations with zero runtime side effects.
 */

export const ACTIVE_INQUIRY_STAGES = [
  'inquiry_received',
  'initial_contact',
  'options_shared',
  'consultation_booked',
  'itinerary_sent',
  'follow_up',
  'customizing_package',
] as const;

export type ActiveInquiryStage = (typeof ACTIVE_INQUIRY_STAGES)[number];

export const TERMINAL_INQUIRY_STAGES = [
  'booking_confirmed',
  'booking_lost',
] as const;

export type TerminalInquiryStage = (typeof TERMINAL_INQUIRY_STAGES)[number];

export type InquiryStage = ActiveInquiryStage | TerminalInquiryStage | (string & {});

export type AttentionSignalType =
  | 'FOLLOW_UP_OVERDUE'
  | 'UNANSWERED_INBOUND'
  | 'MISSING_QUALIFICATION'
  | 'UNASSIGNED_INQUIRY'
  | 'NO_FOLLOW_UP_SCHEDULED';

export type AttentionSeverity = 'warning' | 'info';

export type AttentionEntityType = 'inquiry' | 'conversation';

export type AttentionActionType =
  | 'navigate'
  | 'open_copilot'
  | 'compose_reply'
  | 'propose_action';

export interface AttentionActionDescriptor {
  actionId: string;
  label: string;
  actionType: AttentionActionType;
  payload?: Record<string, unknown>;
}

export type QualificationFieldKey =
  | 'destination'
  | 'departure_date'
  | 'number_of_travelers'
  | 'budget';

export interface NormalizedInquiryFact {
  inquiryId: string;
  tenantId: string;
  legacyLeadId: string | null;
  travelerId: string | null;
  pipelineStage: string;
  assignedAgentId: string | null;
  nextFollowUpAt: string | null; // ISO-8601 UTC timestamp or null
  destination: string | null;
  departureDate: string | null;
  returnDate: string | null;
  numberOfTravelers: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  expectedValue: number | null;
  currency: string;
  tripType: string | null;
  isArchived: boolean;
}

export interface NormalizedConversationFact {
  conversationId: string;
  inquiryId: string | null;
  legacyLeadId: string | null;
  tenantId: string;
  channel: string;
  status: 'open' | 'closed' | string;
  latestContactAt: string | null; // ISO-8601 UTC timestamp of latest customer message
  latestAgentAfterContactAt: string | null; // ISO-8601 UTC timestamp of agent reply after latest contact
}

export interface AttentionSignal {
  id: string;
  signalType: AttentionSignalType;
  entityType: AttentionEntityType;
  entityId: string;
  inquiryId?: string;
  tenantId: string;
  severity: AttentionSeverity;
  title: string;
  reasons: string[];
  missingFields?: QualificationFieldKey[];
  suggestedActions: AttentionActionDescriptor[];
  detectedAt: string; // ISO-8601 UTC timestamp of evaluation
}

export interface TenantAttentionSummary {
  tenantId: string;
  evaluatedAt: string;
  totalActiveInquiries: number;
  totalOpenConversations: number;
  signalsCount: number;
  signalsByType: Record<AttentionSignalType, number>;
  signalsBySeverity: Record<AttentionSeverity, number>;
  signals: AttentionSignal[];
}
