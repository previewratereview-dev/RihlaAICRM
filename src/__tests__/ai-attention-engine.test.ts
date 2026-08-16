/**
 * Phase AI-4B: Pure Deterministic Attention Engine Tests
 * 
 * Classification: PURE UNIT TEST & STATIC ASSERTION
 * ZERO Supabase connection, ZERO network, ZERO LLM dependencies.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  evaluateInquiryAttention,
  evaluateConversationAttention,
  evaluateTenantAttention,
  sortAttentionSignals,
  isActiveInquiryStage,
} from '@/lib/attention/engine';
import type {
  NormalizedInquiryFact,
  NormalizedConversationFact,
  AttentionSignal,
} from '@/lib/attention/types';

describe('AI-4B Pure Attention Engine: Pipeline Stage Helper', () => {
  it('correctly classifies canonical active stages', () => {
    expect(isActiveInquiryStage('inquiry_received')).toBe(true);
    expect(isActiveInquiryStage('initial_contact')).toBe(true);
    expect(isActiveInquiryStage('options_shared')).toBe(true);
    expect(isActiveInquiryStage('consultation_booked')).toBe(true);
    expect(isActiveInquiryStage('itinerary_sent')).toBe(true);
    expect(isActiveInquiryStage('follow_up')).toBe(true);
    expect(isActiveInquiryStage('customizing_package')).toBe(true);
  });

  it('rejects terminal and non-canonical stages from active set', () => {
    expect(isActiveInquiryStage('booking_confirmed')).toBe(false);
    expect(isActiveInquiryStage('booking_lost')).toBe(false);
    expect(isActiveInquiryStage('closed_won')).toBe(false);
    expect(isActiveInquiryStage('closed_lost')).toBe(false);
    expect(isActiveInquiryStage('new')).toBe(false);
    expect(isActiveInquiryStage('action_required')).toBe(false);
  });
});

describe('AI-4B Pure Attention Engine: Signal #1 FOLLOW_UP_OVERDUE', () => {
  const EVAL_TIME = '2026-08-16T12:00:00.000Z';

  const baseFact: NormalizedInquiryFact = {
    inquiryId: 'inq-101',
    tenantId: 'tenant-agency-1',
    legacyLeadId: 'lead-101',
    travelerId: 'trav-101',
    pipelineStage: 'inquiry_received',
    assignedAgentId: 'agent-101',
    nextFollowUpAt: '2026-08-16T10:00:00.000Z', // 2 hours in the past
    destination: 'Maldives',
    departureDate: '2026-10-01',
    returnDate: '2026-10-08',
    numberOfTravelers: 2,
    budgetMin: 150000,
    budgetMax: 200000,
    expectedValue: 180000,
    currency: 'INR',
    tripType: 'Luxury Leisure',
    isArchived: false,
  };

  it('emits FOLLOW_UP_OVERDUE for active inquiry with past follow-up timestamp', () => {
    const signals = evaluateInquiryAttention(baseFact, EVAL_TIME);
    const overdue = signals.find((s) => s.signalType === 'FOLLOW_UP_OVERDUE');

    expect(overdue).toBeDefined();
    expect(overdue?.severity).toBe('warning');
    expect(overdue?.title).toBe('Follow-up Overdue');
    expect(overdue?.reasons[0]).toContain('2026-08-16T10:00:00.000Z');
    expect(overdue?.suggestedActions).toHaveLength(2);
    expect(overdue?.suggestedActions[0].actionType).toBe('navigate');
    expect(overdue?.suggestedActions[1].actionType).toBe('propose_action');
  });

  it('does NOT emit FOLLOW_UP_OVERDUE when follow-up is in the future', () => {
    const futureFact = { ...baseFact, nextFollowUpAt: '2026-08-16T14:00:00.000Z' };
    const signals = evaluateInquiryAttention(futureFact, EVAL_TIME);
    expect(signals.find((s) => s.signalType === 'FOLLOW_UP_OVERDUE')).toBeUndefined();
  });

  it('does NOT emit FOLLOW_UP_OVERDUE when follow-up is at exact evaluation time', () => {
    const exactFact = { ...baseFact, nextFollowUpAt: EVAL_TIME };
    const signals = evaluateInquiryAttention(exactFact, EVAL_TIME);
    expect(signals.find((s) => s.signalType === 'FOLLOW_UP_OVERDUE')).toBeUndefined();
  });

  it('does NOT emit FOLLOW_UP_OVERDUE when nextFollowUpAt is null (delegated to NO_FOLLOW_UP_SCHEDULED)', () => {
    const nullFollowUpFact = { ...baseFact, nextFollowUpAt: null };
    const signals = evaluateInquiryAttention(nullFollowUpFact, EVAL_TIME);
    expect(signals.find((s) => s.signalType === 'FOLLOW_UP_OVERDUE')).toBeUndefined();
    expect(signals.find((s) => s.signalType === 'NO_FOLLOW_UP_SCHEDULED')).toBeDefined();
  });

  it('suppresses FOLLOW_UP_OVERDUE for terminal inquiries (booking_confirmed / booking_lost)', () => {
    const confirmedFact = { ...baseFact, pipelineStage: 'booking_confirmed' };
    const lostFact = { ...baseFact, pipelineStage: 'booking_lost' };

    expect(evaluateInquiryAttention(confirmedFact, EVAL_TIME)).toHaveLength(0);
    expect(evaluateInquiryAttention(lostFact, EVAL_TIME)).toHaveLength(0);
  });

  it('suppresses FOLLOW_UP_OVERDUE for archived inquiries', () => {
    const archivedFact = { ...baseFact, isArchived: true };
    expect(evaluateInquiryAttention(archivedFact, EVAL_TIME)).toHaveLength(0);
  });
});

describe('AI-4B Pure Attention Engine: Signal #2 NO_FOLLOW_UP_SCHEDULED', () => {
  const EVAL_TIME = '2026-08-16T12:00:00.000Z';

  const baseFact: NormalizedInquiryFact = {
    inquiryId: 'inq-102',
    tenantId: 'tenant-agency-1',
    legacyLeadId: 'lead-102',
    travelerId: 'trav-102',
    pipelineStage: 'initial_contact',
    assignedAgentId: 'agent-101',
    nextFollowUpAt: null,
    destination: 'Dubai',
    departureDate: '2026-11-15',
    returnDate: null,
    numberOfTravelers: 4,
    budgetMin: 300000,
    budgetMax: 400000,
    expectedValue: 350000,
    currency: 'INR',
    tripType: 'Family Vacation',
    isArchived: false,
  };

  it('emits NO_FOLLOW_UP_SCHEDULED when nextFollowUpAt is null', () => {
    const signals = evaluateInquiryAttention(baseFact, EVAL_TIME);
    const noFollowUp = signals.find((s) => s.signalType === 'NO_FOLLOW_UP_SCHEDULED');

    expect(noFollowUp).toBeDefined();
    expect(noFollowUp?.severity).toBe('info');
    expect(noFollowUp?.title).toBe('No Follow-up Scheduled');
    expect(noFollowUp?.reasons[0]).toContain('No next follow-up date has been scheduled');
  });

  it('does NOT emit NO_FOLLOW_UP_SCHEDULED when a follow-up is scheduled', () => {
    const scheduledFact = { ...baseFact, nextFollowUpAt: '2026-08-18T10:00:00.000Z' };
    const signals = evaluateInquiryAttention(scheduledFact, EVAL_TIME);
    expect(signals.find((s) => s.signalType === 'NO_FOLLOW_UP_SCHEDULED')).toBeUndefined();
  });

  it('an inquiry NEVER emits both FOLLOW_UP_OVERDUE and NO_FOLLOW_UP_SCHEDULED simultaneously', () => {
    const testCases: NormalizedInquiryFact[] = [
      { ...baseFact, nextFollowUpAt: null },
      { ...baseFact, nextFollowUpAt: '2026-08-15T00:00:00.000Z' }, // Past
      { ...baseFact, nextFollowUpAt: '2026-08-20T00:00:00.000Z' }, // Future
    ];

    for (const tc of testCases) {
      const signals = evaluateInquiryAttention(tc, EVAL_TIME);
      const hasOverdue = signals.some((s) => s.signalType === 'FOLLOW_UP_OVERDUE');
      const hasNoFollowUp = signals.some((s) => s.signalType === 'NO_FOLLOW_UP_SCHEDULED');
      expect(hasOverdue && hasNoFollowUp).toBe(false);
    }
  });

  it('suppresses NO_FOLLOW_UP_SCHEDULED for terminal and archived inquiries', () => {
    const terminalFact = { ...baseFact, pipelineStage: 'booking_confirmed' };
    const archivedFact = { ...baseFact, isArchived: true };

    expect(evaluateInquiryAttention(terminalFact, EVAL_TIME)).toHaveLength(0);
    expect(evaluateInquiryAttention(archivedFact, EVAL_TIME)).toHaveLength(0);
  });
});

describe('AI-4B Pure Attention Engine: Signal #3 UNASSIGNED_INQUIRY', () => {
  const EVAL_TIME = '2026-08-16T12:00:00.000Z';

  const baseFact: NormalizedInquiryFact = {
    inquiryId: 'inq-103',
    tenantId: 'tenant-agency-1',
    legacyLeadId: 'lead-103',
    travelerId: 'trav-103',
    pipelineStage: 'options_shared',
    assignedAgentId: null,
    nextFollowUpAt: '2026-08-20T10:00:00.000Z',
    destination: 'Bali',
    departureDate: '2026-09-10',
    returnDate: null,
    numberOfTravelers: 2,
    budgetMin: 200000,
    budgetMax: null,
    expectedValue: 200000,
    currency: 'INR',
    tripType: 'Honeymoon',
    isArchived: false,
  };

  it('emits UNASSIGNED_INQUIRY when assignedAgentId is null', () => {
    const signals = evaluateInquiryAttention(baseFact, EVAL_TIME);
    const unassigned = signals.find((s) => s.signalType === 'UNASSIGNED_INQUIRY');

    expect(unassigned).toBeDefined();
    expect(unassigned?.severity).toBe('warning');
    expect(unassigned?.title).toBe('Unassigned Inquiry');
    expect(unassigned?.suggestedActions).toHaveLength(2);
  });

  it('emits UNASSIGNED_INQUIRY when assignedAgentId is whitespace', () => {
    const blankFact = { ...baseFact, assignedAgentId: '   ' };
    const signals = evaluateInquiryAttention(blankFact, EVAL_TIME);
    expect(signals.find((s) => s.signalType === 'UNASSIGNED_INQUIRY')).toBeDefined();
  });

  it('does NOT emit UNASSIGNED_INQUIRY when assignedAgentId is a valid UUID', () => {
    const assignedFact = { ...baseFact, assignedAgentId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' };
    const signals = evaluateInquiryAttention(assignedFact, EVAL_TIME);
    expect(signals.find((s) => s.signalType === 'UNASSIGNED_INQUIRY')).toBeUndefined();
  });

  it('suppresses UNASSIGNED_INQUIRY for terminal and archived inquiries', () => {
    const terminalFact = { ...baseFact, pipelineStage: 'booking_lost' };
    const archivedFact = { ...baseFact, isArchived: true };

    expect(evaluateInquiryAttention(terminalFact, EVAL_TIME)).toHaveLength(0);
    expect(evaluateInquiryAttention(archivedFact, EVAL_TIME)).toHaveLength(0);
  });
});

describe('AI-4B Pure Attention Engine: Signal #4 MISSING_QUALIFICATION', () => {
  const EVAL_TIME = '2026-08-16T12:00:00.000Z';

  const fullyQualifiedFact: NormalizedInquiryFact = {
    inquiryId: 'inq-104',
    tenantId: 'tenant-agency-1',
    legacyLeadId: 'lead-104',
    travelerId: 'trav-104',
    pipelineStage: 'consultation_booked',
    assignedAgentId: 'agent-101',
    nextFollowUpAt: '2026-08-20T10:00:00.000Z',
    destination: 'Switzerland',
    departureDate: '2026-12-20',
    returnDate: null, // Legitimately optional in AI-4B
    numberOfTravelers: 3,
    budgetMin: 500000,
    budgetMax: 700000,
    expectedValue: 600000,
    currency: 'INR',
    tripType: 'Winter Holiday',
    isArchived: false,
  };

  it('does NOT emit MISSING_QUALIFICATION when all 4 core qualification fields are present', () => {
    const signals = evaluateInquiryAttention(fullyQualifiedFact, EVAL_TIME);
    expect(signals.find((s) => s.signalType === 'MISSING_QUALIFICATION')).toBeUndefined();
  });

  it('flags missing destination when null or whitespace', () => {
    const missingDest = { ...fullyQualifiedFact, destination: '   ' };
    const signals = evaluateInquiryAttention(missingDest, EVAL_TIME);
    const signal = signals.find((s) => s.signalType === 'MISSING_QUALIFICATION');

    expect(signal).toBeDefined();
    expect(signal?.missingFields).toEqual(['destination']);
    expect(signal?.severity).toBe('info');
  });

  it('flags missing departure date when null or empty', () => {
    const missingDep = { ...fullyQualifiedFact, departureDate: null };
    const signals = evaluateInquiryAttention(missingDep, EVAL_TIME);
    const signal = signals.find((s) => s.signalType === 'MISSING_QUALIFICATION');

    expect(signal).toBeDefined();
    expect(signal?.missingFields).toEqual(['departure_date']);
  });

  it('flags invalid or zero traveler count (0, -1, NaN, null)', () => {
    const zeroTravelers = { ...fullyQualifiedFact, numberOfTravelers: 0 };
    const nullTravelers = { ...fullyQualifiedFact, numberOfTravelers: null };

    expect(evaluateInquiryAttention(zeroTravelers, EVAL_TIME)[0].missingFields).toContain('number_of_travelers');
    expect(evaluateInquiryAttention(nullTravelers, EVAL_TIME)[0].missingFields).toContain('number_of_travelers');
  });

  it('accepts partial budget (budgetMin only or budgetMax only)', () => {
    const minOnly = { ...fullyQualifiedFact, budgetMin: 150000, budgetMax: null };
    const maxOnly = { ...fullyQualifiedFact, budgetMin: null, budgetMax: 250000 };

    expect(evaluateInquiryAttention(minOnly, EVAL_TIME).find((s) => s.signalType === 'MISSING_QUALIFICATION')).toBeUndefined();
    expect(evaluateInquiryAttention(maxOnly, EVAL_TIME).find((s) => s.signalType === 'MISSING_QUALIFICATION')).toBeUndefined();
  });

  it('flags budget as missing ONLY when BOTH budgetMin and budgetMax are null/NaN', () => {
    const noBudget = { ...fullyQualifiedFact, budgetMin: null, budgetMax: null };
    const signals = evaluateInquiryAttention(noBudget, EVAL_TIME);
    const signal = signals.find((s) => s.signalType === 'MISSING_QUALIFICATION');

    expect(signal).toBeDefined();
    expect(signal?.missingFields).toEqual(['budget']);
  });

  it('emits ONE aggregated MISSING_QUALIFICATION signal with all missing fields', () => {
    const totallyEmptyFact: NormalizedInquiryFact = {
      ...fullyQualifiedFact,
      destination: null,
      departureDate: null,
      numberOfTravelers: null,
      budgetMin: null,
      budgetMax: null,
    };

    const signals = evaluateInquiryAttention(totallyEmptyFact, EVAL_TIME);
    const qualSignals = signals.filter((s) => s.signalType === 'MISSING_QUALIFICATION');

    expect(qualSignals).toHaveLength(1);
    expect(qualSignals[0].missingFields).toEqual([
      'destination',
      'departure_date',
      'number_of_travelers',
      'budget',
    ]);
  });

  it('suppresses MISSING_QUALIFICATION for terminal and archived inquiries', () => {
    const terminalFact = {
      ...fullyQualifiedFact,
      destination: null,
      pipelineStage: 'booking_confirmed',
    };
    expect(evaluateInquiryAttention(terminalFact, EVAL_TIME)).toHaveLength(0);
  });
});

describe('AI-4B Pure Attention Engine: Signal #5 UNANSWERED_INBOUND', () => {
  const EVAL_TIME = '2026-08-16T12:00:00.000Z';

  const baseConv: NormalizedConversationFact = {
    conversationId: 'conv-201',
    inquiryId: 'inq-101',
    legacyLeadId: 'lead-101',
    tenantId: 'tenant-agency-1',
    channel: 'whatsapp',
    status: 'open',
    latestContactAt: '2026-08-16T10:00:00.000Z',
    latestAgentAfterContactAt: null,
  };

  it('emits UNANSWERED_INBOUND when customer sent a message and agent has not replied', () => {
    const signal = evaluateConversationAttention(baseConv, EVAL_TIME);

    expect(signal).not.toBeNull();
    expect(signal?.signalType).toBe('UNANSWERED_INBOUND');
    expect(signal?.entityType).toBe('conversation');
    expect(signal?.entityId).toBe('conv-201');
    expect(signal?.inquiryId).toBe('inq-101');
    expect(signal?.severity).toBe('warning');
    expect(signal?.title).toBe('Unanswered Customer Message');
    expect(signal?.suggestedActions).toHaveLength(2);
  });

  it('does NOT emit UNANSWERED_INBOUND when an agent has replied after the latest contact message', () => {
    const answeredConv: NormalizedConversationFact = {
      ...baseConv,
      latestContactAt: '2026-08-16T10:00:00.000Z',
      latestAgentAfterContactAt: '2026-08-16T10:15:00.000Z',
    };
    const signal = evaluateConversationAttention(answeredConv, EVAL_TIME);
    expect(signal).toBeNull();
  });

  it('emits UNANSWERED_INBOUND when customer sends a NEW message after a prior agent reply', () => {
    // New customer message at 11:00 AM, previous agent reply was at 10:15 AM (so latestAgentAfterContactAt reset to null)
    const newInboundConv: NormalizedConversationFact = {
      ...baseConv,
      latestContactAt: '2026-08-16T11:00:00.000Z',
      latestAgentAfterContactAt: null,
    };
    const signal = evaluateConversationAttention(newInboundConv, EVAL_TIME);
    expect(signal).not.toBeNull();
    expect(signal?.signalType).toBe('UNANSWERED_INBOUND');
  });

  it('does NOT emit UNANSWERED_INBOUND when no customer message has ever arrived', () => {
    const emptyConv: NormalizedConversationFact = {
      ...baseConv,
      latestContactAt: null,
      latestAgentAfterContactAt: null,
    };
    const signal = evaluateConversationAttention(emptyConv, EVAL_TIME);
    expect(signal).toBeNull();
  });

  it('does NOT emit UNANSWERED_INBOUND for closed conversations', () => {
    const closedConv: NormalizedConversationFact = {
      ...baseConv,
      status: 'closed',
    };
    const signal = evaluateConversationAttention(closedConv, EVAL_TIME);
    expect(signal).toBeNull();
  });
});

describe('AI-4B Pure Attention Engine: Signal Interaction & Deterministic Sorting', () => {
  const EVAL_TIME = '2026-08-16T12:00:00.000Z';

  it('evaluates multiple distinct signals for an unassigned, unscheduled, unqualified inquiry in exact order', () => {
    const multiSignalFact: NormalizedInquiryFact = {
      inquiryId: 'inq-999',
      tenantId: 'tenant-agency-1',
      legacyLeadId: null,
      travelerId: 'trav-999',
      pipelineStage: 'inquiry_received',
      assignedAgentId: null, // UNASSIGNED_INQUIRY (priority 3)
      nextFollowUpAt: null, // NO_FOLLOW_UP_SCHEDULED (priority 4)
      destination: null, // MISSING_QUALIFICATION (priority 5)
      departureDate: null,
      returnDate: null,
      numberOfTravelers: null,
      budgetMin: null,
      budgetMax: null,
      expectedValue: null,
      currency: 'INR',
      tripType: null,
      isArchived: false,
    };

    const signals = evaluateInquiryAttention(multiSignalFact, EVAL_TIME);

    expect(signals.map((s) => s.signalType)).toEqual([
      'UNASSIGNED_INQUIRY',
      'NO_FOLLOW_UP_SCHEDULED',
      'MISSING_QUALIFICATION',
    ]);
  });

  it('sorts heterogeneous inquiry and conversation signals deterministically', () => {
    const signals: AttentionSignal[] = [
      {
        id: 'sig-1',
        signalType: 'MISSING_QUALIFICATION',
        entityType: 'inquiry',
        entityId: 'inq-A',
        tenantId: 't1',
        severity: 'info',
        title: 'Missing Qual',
        reasons: [],
        suggestedActions: [],
        detectedAt: EVAL_TIME,
      },
      {
        id: 'sig-2',
        signalType: 'UNANSWERED_INBOUND',
        entityType: 'conversation',
        entityId: 'conv-B',
        tenantId: 't1',
        severity: 'warning',
        title: 'Unanswered',
        reasons: [],
        suggestedActions: [],
        detectedAt: EVAL_TIME,
      },
      {
        id: 'sig-3',
        signalType: 'FOLLOW_UP_OVERDUE',
        entityType: 'inquiry',
        entityId: 'inq-C',
        tenantId: 't1',
        severity: 'warning',
        title: 'Overdue',
        reasons: [],
        suggestedActions: [],
        detectedAt: EVAL_TIME,
      },
      {
        id: 'sig-4',
        signalType: 'UNASSIGNED_INQUIRY',
        entityType: 'inquiry',
        entityId: 'inq-D',
        tenantId: 't1',
        severity: 'warning',
        title: 'Unassigned',
        reasons: [],
        suggestedActions: [],
        detectedAt: EVAL_TIME,
      },
    ];

    const sorted = sortAttentionSignals(signals);

    expect(sorted.map((s) => s.signalType)).toEqual([
      'UNANSWERED_INBOUND',
      'FOLLOW_UP_OVERDUE',
      'UNASSIGNED_INQUIRY',
      'MISSING_QUALIFICATION',
    ]);
  });

  it('evaluates tenant attention summary across all facts and aggregates metrics', () => {
    const inqFacts: NormalizedInquiryFact[] = [
      {
        inquiryId: 'inq-1',
        tenantId: 'tenant-A',
        legacyLeadId: null,
        travelerId: 'trav-1',
        pipelineStage: 'inquiry_received',
        assignedAgentId: null, // UNASSIGNED_INQUIRY
        nextFollowUpAt: '2026-08-16T08:00:00.000Z', // FOLLOW_UP_OVERDUE
        destination: 'Maldives',
        departureDate: '2026-10-01',
        returnDate: null,
        numberOfTravelers: 2,
        budgetMin: 200000,
        budgetMax: 250000,
        expectedValue: 200000,
        currency: 'INR',
        tripType: null,
        isArchived: false,
      },
      {
        inquiryId: 'inq-2',
        tenantId: 'tenant-A',
        legacyLeadId: null,
        travelerId: 'trav-2',
        pipelineStage: 'booking_confirmed', // Terminal -> ignored
        assignedAgentId: null,
        nextFollowUpAt: null,
        destination: null,
        departureDate: null,
        returnDate: null,
        numberOfTravelers: null,
        budgetMin: null,
        budgetMax: null,
        expectedValue: 500000,
        currency: 'INR',
        tripType: null,
        isArchived: false,
      },
      {
        inquiryId: 'inq-3',
        tenantId: 'tenant-B', // Foreign tenant -> ignored for tenant-A
        legacyLeadId: null,
        travelerId: 'trav-3',
        pipelineStage: 'inquiry_received',
        assignedAgentId: null,
        nextFollowUpAt: null,
        destination: null,
        departureDate: null,
        returnDate: null,
        numberOfTravelers: null,
        budgetMin: null,
        budgetMax: null,
        expectedValue: null,
        currency: 'INR',
        tripType: null,
        isArchived: false,
      },
    ];

    const convFacts: NormalizedConversationFact[] = [
      {
        conversationId: 'conv-1',
        inquiryId: 'inq-1',
        legacyLeadId: null,
        tenantId: 'tenant-A',
        channel: 'whatsapp',
        status: 'open',
        latestContactAt: '2026-08-16T11:30:00.000Z', // UNANSWERED_INBOUND
        latestAgentAfterContactAt: null,
      },
    ];

    const summary = evaluateTenantAttention('tenant-A', inqFacts, convFacts, EVAL_TIME);

    expect(summary.tenantId).toBe('tenant-A');
    expect(summary.totalActiveInquiries).toBe(1);
    expect(summary.totalOpenConversations).toBe(1);
    expect(summary.signalsCount).toBe(3); // 1 conv (UNANSWERED_INBOUND) + 2 inq (FOLLOW_UP_OVERDUE, UNASSIGNED_INQUIRY)
    expect(summary.signalsByType.UNANSWERED_INBOUND).toBe(1);
    expect(summary.signalsByType.FOLLOW_UP_OVERDUE).toBe(1);
    expect(summary.signalsByType.UNASSIGNED_INQUIRY).toBe(1);
    expect(summary.signalsByType.NO_FOLLOW_UP_SCHEDULED).toBe(0);
    expect(summary.signalsByType.MISSING_QUALIFICATION).toBe(0);
    expect(summary.signalsBySeverity.warning).toBe(3);
    expect(summary.signalsBySeverity.info).toBe(0);
  });
});

describe('AI-4B Static Safety Invariants: Zero-LLM & Zero-Persistence', () => {
  const engineCode = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/attention/engine.ts'),
    'utf-8'
  );
  const typesCode = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/attention/types.ts'),
    'utf-8'
  );
  const loaderCode = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/attention/loader.ts'),
    'utf-8'
  );

  it('engine.ts contains ZERO Supabase, fetch, AI, or external side effects', () => {
    expect(engineCode).not.toContain('@supabase');
    expect(engineCode).not.toContain('fetch(');
    expect(engineCode).not.toContain('executeAIRequest');
    expect(engineCode).not.toContain('OpenAI');
    expect(engineCode).not.toContain('Anthropic');
    expect(engineCode).not.toContain('GoogleGenerativeAI');
    expect(engineCode).not.toContain('process.env');
  });

  it('loader.ts contains ZERO AI/LLM dependencies', () => {
    expect(loaderCode).not.toContain('executeAIRequest');
    expect(loaderCode).not.toContain('OpenAI');
    expect(loaderCode).not.toContain('Anthropic');
    expect(loaderCode).not.toContain('GoogleGenerativeAI');
    expect(loaderCode).not.toContain('generateText');
    expect(loaderCode).not.toContain('streamUI');
  });

  it('attention module contains ZERO write mutations (insert, update, delete, upsert)', () => {
    expect(loaderCode).not.toMatch(/\.insert\(/);
    expect(loaderCode).not.toMatch(/\.update\(/);
    expect(loaderCode).not.toMatch(/\.delete\(/);
    expect(loaderCode).not.toMatch(/\.upsert\(/);
    expect(engineCode).not.toMatch(/\.insert\(/);
  });

  it('loader.ts does NOT query message content body (protects privacy & memory)', () => {
    expect(loaderCode).not.toMatch(/\.select\(['"][^'"]*\bcontent\b[^'"]*['"]\)/);
  });
});
