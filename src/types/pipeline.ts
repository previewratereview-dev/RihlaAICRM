import { LeadStatus } from './lead';

export interface PipelineStage {
  id: LeadStatus;
  label: string;
  color: string;
  count: number;
  totalValue: number;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: 'inquiry_received', label: 'Inquiry Received', color: '#6366F1', count: 0, totalValue: 0 },
  { id: 'initial_contact', label: 'Initial Contact', color: '#8B5CF6', count: 0, totalValue: 0 },
  { id: 'options_shared', label: 'Options Shared', color: '#3B82F6', count: 0, totalValue: 0 },
  { id: 'consultation_booked', label: 'Consultation Booked', color: '#06B6D4', count: 0, totalValue: 0 },
  { id: 'itinerary_sent', label: 'Itinerary Sent', color: '#F59E0B', count: 0, totalValue: 0 },
  { id: 'follow_up', label: 'Follow-Up', color: '#F97316', count: 0, totalValue: 0 },
  { id: 'customizing_package', label: 'Customizing Package', color: '#EC4899', count: 0, totalValue: 0 },
  { id: 'booking_confirmed', label: 'Booking Confirmed', color: '#22C55E', count: 0, totalValue: 0 },
  { id: 'booking_lost', label: 'Booking Lost', color: '#EF4444', count: 0, totalValue: 0 },
];

export type InquiryPriority = 'urgent' | 'high' | 'medium' | 'low';

export type PipelineInquiryViewModel = {
  id: string;
  displayName: string;
  destination: string | null;
  stageId: string;
  stageName: string;
  priority: InquiryPriority;
  expectedValue: number | null;
  currency: string;
  enteredStageAt: string | null;
  timeInStageLabel: string;
  assignedAgent: {
    id: string;
    name: string;
    avatarUrl?: string;
  } | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
};
