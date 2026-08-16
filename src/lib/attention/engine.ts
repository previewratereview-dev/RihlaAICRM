/**
 * Phase AI-4B: Pure Deterministic Attention Engine
 * 
 * ZERO external side effects, ZERO Supabase imports, ZERO AI SDK dependencies.
 * Evaluates normalized CRM facts against strict business invariants.
 */

import {
  ACTIVE_INQUIRY_STAGES,
  type ActiveInquiryStage,
  type AttentionSignal,
  type AttentionSignalType,
  type AttentionSeverity,
  type NormalizedInquiryFact,
  type NormalizedConversationFact,
  type QualificationFieldKey,
  type TenantAttentionSummary,
} from './types';

/** Priority rank for deterministic signal ordering (lower rank = higher priority). */
const SIGNAL_PRIORITY_RANK: Record<AttentionSignalType, number> = {
  UNANSWERED_INBOUND: 1,
  FOLLOW_UP_OVERDUE: 2,
  UNASSIGNED_INQUIRY: 3,
  NO_FOLLOW_UP_SCHEDULED: 4,
  MISSING_QUALIFICATION: 5,
};

/**
 * Checks whether an inquiry stage is an active pipeline stage.
 */
export function isActiveInquiryStage(stage: string): stage is ActiveInquiryStage {
  return (ACTIVE_INQUIRY_STAGES as readonly string[]).includes(stage);
}

/**
 * Normalizes input date/timestamp to UTC milliseconds.
 */
function parseEvaluationTime(evaluatedAt: Date | string): number {
  if (evaluatedAt instanceof Date) {
    return evaluatedAt.getTime();
  }
  const parsed = Date.parse(evaluatedAt);
  if (isNaN(parsed)) {
    return Date.now();
  }
  return parsed;
}

/**
 * Pure evaluation of attention signals for a single Inquiry fact.
 * Returns an ordered array of AttentionSignal descriptors.
 */
export function evaluateInquiryAttention(
  fact: NormalizedInquiryFact,
  evaluatedAt: Date | string = new Date()
): AttentionSignal[] {
  // Terminal or archived inquiries suppress all P0 attention signals
  if (fact.isArchived) {
    return [];
  }

  if (!isActiveInquiryStage(fact.pipelineStage)) {
    return [];
  }

  const evalTimeMs = parseEvaluationTime(evaluatedAt);
  const evalIso = new Date(evalTimeMs).toISOString();
  const signals: AttentionSignal[] = [];

  // 1. Follow-up evaluation (Mutually exclusive: OVERDUE vs NO_FOLLOW_UP_SCHEDULED)
  if (fact.nextFollowUpAt && fact.nextFollowUpAt.trim() !== '') {
    const followUpTimeMs = Date.parse(fact.nextFollowUpAt);
    if (!isNaN(followUpTimeMs) && followUpTimeMs < evalTimeMs) {
      signals.push({
        id: `sig-overdue-${fact.inquiryId}`,
        signalType: 'FOLLOW_UP_OVERDUE',
        entityType: 'inquiry',
        entityId: fact.inquiryId,
        tenantId: fact.tenantId,
        severity: 'warning',
        title: 'Follow-up Overdue',
        reasons: [
          `Follow-up was scheduled for ${new Date(followUpTimeMs).toISOString()} and is now overdue.`,
        ],
        suggestedActions: [
          {
            actionId: 'view_inquiry',
            label: 'View Inquiry',
            actionType: 'navigate',
            payload: { inquiryId: fact.inquiryId },
          },
          {
            actionId: 'propose_follow_up',
            label: 'Reschedule Follow-up',
            actionType: 'propose_action',
            payload: { inquiryId: fact.inquiryId },
          },
        ],
        detectedAt: evalIso,
      });
    }
  } else {
    // nextFollowUpAt is null or empty
    signals.push({
      id: `sig-nofollowup-${fact.inquiryId}`,
      signalType: 'NO_FOLLOW_UP_SCHEDULED',
      entityType: 'inquiry',
      entityId: fact.inquiryId,
      tenantId: fact.tenantId,
      severity: 'info',
      title: 'No Follow-up Scheduled',
      reasons: [
        'No next follow-up date has been scheduled for this active inquiry.',
      ],
      suggestedActions: [
        {
          actionId: 'view_inquiry',
          label: 'View Inquiry',
          actionType: 'navigate',
          payload: { inquiryId: fact.inquiryId },
        },
        {
          actionId: 'propose_follow_up',
          label: 'Set Follow-up Date',
          actionType: 'propose_action',
          payload: { inquiryId: fact.inquiryId },
        },
      ],
      detectedAt: evalIso,
    });
  }

  // 2. Unassigned Inquiry evaluation
  if (!fact.assignedAgentId || fact.assignedAgentId.trim() === '') {
    signals.push({
      id: `sig-unassigned-${fact.inquiryId}`,
      signalType: 'UNASSIGNED_INQUIRY',
      entityType: 'inquiry',
      entityId: fact.inquiryId,
      tenantId: fact.tenantId,
      severity: 'warning',
      title: 'Unassigned Inquiry',
      reasons: [
        'This active inquiry is not assigned to any travel specialist.',
      ],
      suggestedActions: [
        {
          actionId: 'view_inquiry',
          label: 'View Inquiry',
          actionType: 'navigate',
          payload: { inquiryId: fact.inquiryId },
        },
        {
          actionId: 'propose_assignment',
          label: 'Assign Specialist',
          actionType: 'propose_action',
          payload: { inquiryId: fact.inquiryId },
        },
      ],
      detectedAt: evalIso,
    });
  }

  // 3. Missing Qualification evaluation
  const missingFields: QualificationFieldKey[] = [];

  // Destination: missing if null or whitespace-only
  if (!fact.destination || fact.destination.trim() === '') {
    missingFields.push('destination');
  }

  // Departure Date: missing if null or whitespace-only
  if (!fact.departureDate || fact.departureDate.trim() === '') {
    missingFields.push('departure_date');
  }

  // Number of Travelers: missing if null, NaN, or <= 0
  if (
    fact.numberOfTravelers === null ||
    fact.numberOfTravelers === undefined ||
    isNaN(fact.numberOfTravelers) ||
    fact.numberOfTravelers <= 0
  ) {
    missingFields.push('number_of_travelers');
  }

  // Budget: missing ONLY when both budgetMin and budgetMax are null/NaN
  const hasMin =
    fact.budgetMin !== null &&
    fact.budgetMin !== undefined &&
    !isNaN(fact.budgetMin) &&
    fact.budgetMin > 0;
  const hasMax =
    fact.budgetMax !== null &&
    fact.budgetMax !== undefined &&
    !isNaN(fact.budgetMax) &&
    fact.budgetMax > 0;

  if (!hasMin && !hasMax) {
    missingFields.push('budget');
  }

  if (missingFields.length > 0) {
    signals.push({
      id: `sig-missingqual-${fact.inquiryId}`,
      signalType: 'MISSING_QUALIFICATION',
      entityType: 'inquiry',
      entityId: fact.inquiryId,
      tenantId: fact.tenantId,
      severity: 'info',
      title: 'Incomplete Trip Qualification',
      reasons: [
        `Missing critical qualification details: ${missingFields.join(', ')}.`,
      ],
      missingFields,
      suggestedActions: [
        {
          actionId: 'view_inquiry',
          label: 'Complete Details',
          actionType: 'navigate',
          payload: { inquiryId: fact.inquiryId, missingFields },
        },
      ],
      detectedAt: evalIso,
    });
  }

  return sortAttentionSignals(signals);
}

/**
 * Pure evaluation of attention signals for a single Conversation fact.
 * Returns an AttentionSignal or null if no attention is required.
 */
export function evaluateConversationAttention(
  fact: NormalizedConversationFact,
  evaluatedAt: Date | string = new Date()
): AttentionSignal | null {
  // Closed conversations suppress unanswered inbound alerts
  if (fact.status !== 'open') {
    return null;
  }

  // If no contact message ever arrived, nothing is unanswered
  if (!fact.latestContactAt || fact.latestContactAt.trim() === '') {
    return null;
  }

  // If an agent replied strictly after the latest customer message, it is answered
  if (
    fact.latestAgentAfterContactAt &&
    fact.latestAgentAfterContactAt.trim() !== ''
  ) {
    const contactTime = Date.parse(fact.latestContactAt);
    const agentTime = Date.parse(fact.latestAgentAfterContactAt);
    if (!isNaN(contactTime) && !isNaN(agentTime) && agentTime > contactTime) {
      return null;
    }
  }

  const evalTimeMs = parseEvaluationTime(evaluatedAt);
  const evalIso = new Date(evalTimeMs).toISOString();

  return {
    id: `sig-unanswered-${fact.conversationId}`,
    signalType: 'UNANSWERED_INBOUND',
    entityType: 'conversation',
    entityId: fact.conversationId,
    inquiryId: fact.inquiryId ?? undefined,
    tenantId: fact.tenantId,
    severity: 'warning',
    title: 'Unanswered Customer Message',
    reasons: [
      `Customer sent a message on ${fact.channel || 'chat'} at ${new Date(
        fact.latestContactAt
      ).toISOString()} and has not received an agent reply.`,
    ],
    suggestedActions: [
      {
        actionId: 'open_conversation',
        label: 'Open Conversation',
        actionType: 'navigate',
        payload: {
          conversationId: fact.conversationId,
          inquiryId: fact.inquiryId,
        },
      },
      {
        actionId: 'compose_reply',
        label: 'Compose Reply',
        actionType: 'compose_reply',
        payload: {
          conversationId: fact.conversationId,
          inquiryId: fact.inquiryId,
        },
      },
    ],
    detectedAt: evalIso,
  };
}

/**
 * Deterministically sorts attention signals using standard priority ranking:
 * 1. UNANSWERED_INBOUND
 * 2. FOLLOW_UP_OVERDUE
 * 3. UNASSIGNED_INQUIRY
 * 4. NO_FOLLOW_UP_SCHEDULED
 * 5. MISSING_QUALIFICATION
 * Secondary sort: entityId ascending for stable determinism.
 */
export function sortAttentionSignals(signals: AttentionSignal[]): AttentionSignal[] {
  return [...signals].sort((a, b) => {
    const rankA = SIGNAL_PRIORITY_RANK[a.signalType] ?? 99;
    const rankB = SIGNAL_PRIORITY_RANK[b.signalType] ?? 99;

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    return a.entityId.localeCompare(b.entityId);
  });
}

/**
 * Pure evaluation of a full tenant collection of facts.
 * Generates aggregated attention metrics and sorted signals list.
 */
export function evaluateTenantAttention(
  tenantId: string,
  inquiryFacts: NormalizedInquiryFact[],
  conversationFacts: NormalizedConversationFact[],
  evaluatedAt: Date | string = new Date()
): TenantAttentionSummary {
  const evalTimeMs = parseEvaluationTime(evaluatedAt);
  const evalIso = new Date(evalTimeMs).toISOString();

  const signals: AttentionSignal[] = [];

  // Evaluate all inquiry facts
  for (const inq of inquiryFacts) {
    if (inq.tenantId === tenantId) {
      const inqSignals = evaluateInquiryAttention(inq, evaluatedAt);
      signals.push(...inqSignals);
    }
  }

  // Evaluate all conversation facts
  for (const conv of conversationFacts) {
    if (conv.tenantId === tenantId) {
      const convSignal = evaluateConversationAttention(conv, evaluatedAt);
      if (convSignal) {
        signals.push(convSignal);
      }
    }
  }

  const sortedSignals = sortAttentionSignals(signals);

  const signalsByType: Record<AttentionSignalType, number> = {
    FOLLOW_UP_OVERDUE: 0,
    UNANSWERED_INBOUND: 0,
    MISSING_QUALIFICATION: 0,
    UNASSIGNED_INQUIRY: 0,
    NO_FOLLOW_UP_SCHEDULED: 0,
  };

  const signalsBySeverity: Record<AttentionSeverity, number> = {
    warning: 0,
    info: 0,
  };

  for (const sig of sortedSignals) {
    signalsByType[sig.signalType] = (signalsByType[sig.signalType] || 0) + 1;
    signalsBySeverity[sig.severity] = (signalsBySeverity[sig.severity] || 0) + 1;
  }

  const activeInquiriesCount = inquiryFacts.filter(
    (f) => f.tenantId === tenantId && !f.isArchived && isActiveInquiryStage(f.pipelineStage)
  ).length;

  const openConversationsCount = conversationFacts.filter(
    (f) => f.tenantId === tenantId && f.status === 'open'
  ).length;

  return {
    tenantId,
    evaluatedAt: evalIso,
    totalActiveInquiries: activeInquiriesCount,
    totalOpenConversations: openConversationsCount,
    signalsCount: sortedSignals.length,
    signalsByType,
    signalsBySeverity,
    signals: sortedSignals,
  };
}
