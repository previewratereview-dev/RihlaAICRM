import { Lead, User } from '@/types';
import { PipelineInquiryViewModel, InquiryPriority, PIPELINE_STAGES } from '@/types/pipeline';
import { differenceInDays } from 'date-fns';

export function getInquiryDisplayName(lead: Lead): string {
  return (
    lead.fullName?.trim() ||
    lead.travelerName?.trim() ||
    lead.contact?.name?.trim() ||
    lead.email?.split('@')[0] ||
    'Unnamed traveler'
  );
}

export function mapLeadToPipelineInquiry(
  lead: Lead,
  team: User[]
): PipelineInquiryViewModel {
  const stage = PIPELINE_STAGES.find((s) => s.id === lead.status);
  const assignee = team.find((u) => u.id === lead.assignedTo);

  // Default missing priority to medium
  const priority = (lead.priority?.toLowerCase() as InquiryPriority) || 'medium';
  
  // Calculate time in stage
  const enteredStageAt = lead.updatedAt; // Assuming updatedAt is when they entered the stage for now
  const daysInStage = enteredStageAt ? differenceInDays(new Date(), new Date(enteredStageAt)) : null;
  const timeInStageLabel = daysInStage !== null ? `${daysInStage}d` : '0d';

  // Overdue follow up logic
  const nextFollowUpAt = lead.nextFollowUp || null;

  // Preserve actual 0 vs unknown (null/undefined)
  const expectedValue = typeof lead.dealValue === 'number' && !isNaN(lead.dealValue) ? lead.dealValue : null;

  return {
    id: lead.id,
    displayName: getInquiryDisplayName(lead),
    destination: lead.destination || null,
    stageId: lead.status,
    stageName: stage?.label || lead.status,
    priority,
    expectedValue,
    currency: 'INR',
    enteredStageAt,
    timeInStageLabel,
    assignedAgent: assignee
      ? {
          id: assignee.id,
          name: assignee.fullName,
          avatarUrl: assignee.avatarUrl,
        }
      : null,
    nextFollowUpAt,
    lastActivityAt: lead.lastContactDate || lead.lastContacted || null,
  };
}
