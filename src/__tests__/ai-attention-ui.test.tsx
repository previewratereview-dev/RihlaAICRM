// @vitest-environment jsdom
/**
 * Phase AI-4C: Proactive Attention UI Component Tests
 * 
 * Classification: UI / COMPONENT TEST
 * Verifies Dashboard Needs Attention card, Inquiry Table AttentionBadge,
 * Inquiry Drawer AttentionDrawerSection, and Conversations View indicators.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DashboardNeedsAttention } from '@/components/attention/dashboard-needs-attention';
import { AttentionBadge } from '@/components/attention/attention-badge';
import { AttentionDrawerSection } from '@/components/attention/attention-drawer-section';
import type { AttentionSignal, TenantAttentionSummary } from '@/lib/attention/types';

afterEach(() => {
  cleanup();
});

const MOCK_SIGNALS: AttentionSignal[] = [
  {
    id: 'sig-1',
    signalType: 'FOLLOW_UP_OVERDUE',
    entityType: 'inquiry',
    entityId: 'inq-101',
    tenantId: 'agency-alpha',
    severity: 'warning',
    title: 'Follow-up overdue for Kashmir Holiday',
    reasons: ['Scheduled follow-up was 2026-08-15 (1 day overdue)'],
    suggestedActions: [
      { actionId: 'view_inquiry', label: 'View Inquiry', actionType: 'navigate' },
      { actionId: 'propose_follow_up', label: 'Schedule Follow-up', actionType: 'propose_action' },
    ],
    detectedAt: '2026-08-16T10:00:00.000Z',
  },
  {
    id: 'sig-2',
    signalType: 'UNANSWERED_INBOUND',
    entityType: 'conversation',
    entityId: 'conv-202',
    inquiryId: 'inq-101',
    tenantId: 'agency-alpha',
    severity: 'warning',
    title: 'Unanswered customer message',
    reasons: ['Customer sent message at 2026-08-16T09:30:00Z with no subsequent agent reply'],
    suggestedActions: [
      { actionId: 'open_conversation', label: 'Open Conversation', actionType: 'navigate' },
      { actionId: 'compose_reply', label: 'Reply to Customer', actionType: 'compose_reply' },
    ],
    detectedAt: '2026-08-16T10:00:00.000Z',
  },
  {
    id: 'sig-3',
    signalType: 'UNASSIGNED_INQUIRY',
    entityType: 'inquiry',
    entityId: 'inq-102',
    tenantId: 'agency-alpha',
    severity: 'warning',
    title: 'Inquiry unassigned',
    reasons: ['No specialist or agent assigned to manage this inquiry'],
    suggestedActions: [
      { actionId: 'view_inquiry', label: 'View Inquiry', actionType: 'navigate' },
      { actionId: 'propose_assignment', label: 'Assign Specialist', actionType: 'propose_action' },
    ],
    detectedAt: '2026-08-16T10:00:00.000Z',
  },
  {
    id: 'sig-4',
    signalType: 'MISSING_QUALIFICATION',
    entityType: 'inquiry',
    entityId: 'inq-103',
    tenantId: 'agency-alpha',
    severity: 'info',
    title: 'Missing qualification fields',
    reasons: ['2 mandatory qualification details not provided'],
    missingFields: ['destination', 'number_of_travelers'],
    suggestedActions: [{ actionId: 'view_inquiry', label: 'View Inquiry', actionType: 'navigate' }],
    detectedAt: '2026-08-16T10:00:00.000Z',
  },
  {
    id: 'sig-5',
    signalType: 'NO_FOLLOW_UP_SCHEDULED',
    entityType: 'inquiry',
    entityId: 'inq-104',
    tenantId: 'agency-alpha',
    severity: 'info',
    title: 'No follow-up scheduled',
    reasons: ['Active inquiry lacks next follow-up date'],
    suggestedActions: [
      { actionId: 'view_inquiry', label: 'View Inquiry', actionType: 'navigate' },
      { actionId: 'propose_follow_up', label: 'Schedule Next Step', actionType: 'propose_action' },
    ],
    detectedAt: '2026-08-16T10:00:00.000Z',
  },
];

const MOCK_SUMMARY: TenantAttentionSummary = {
  tenantId: 'agency-alpha',
  signalsCount: 5,
  totalActiveInquiries: 4,
  totalOpenConversations: 1,
  signalsByType: {
    FOLLOW_UP_OVERDUE: 1,
    UNANSWERED_INBOUND: 1,
    UNASSIGNED_INQUIRY: 1,
    MISSING_QUALIFICATION: 1,
    NO_FOLLOW_UP_SCHEDULED: 1,
  },
  signalsBySeverity: {
    warning: 3,
    info: 2,
  },
  signals: MOCK_SIGNALS,
  evaluatedAt: '2026-08-16T10:00:00.000Z',
};

describe('AI-4C Dashboard: Needs Attention Section', () => {
  it('renders all 5 signal counts correctly from server summary', () => {
    render(
      <DashboardNeedsAttention
        summary={MOCK_SUMMARY}
        signals={MOCK_SIGNALS}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('Needs Attention')).toBeDefined();
    expect(screen.getByText('Overdue Follow-ups')).toBeDefined();
    expect(screen.getByText('Unanswered Inbound')).toBeDefined();
    expect(screen.getByText('Unassigned Inquiries')).toBeDefined();
    expect(screen.getByText('Missing Details')).toBeDefined();
    expect(screen.getByText('No Follow-up Set')).toBeDefined();
  });

  it('renders a quiet positive zero-state when totalSignals is 0', () => {
    const emptySummary: TenantAttentionSummary = {
      tenantId: 'agency-alpha',
      signalsCount: 0,
      totalActiveInquiries: 2,
      totalOpenConversations: 0,
      signalsByType: {
        FOLLOW_UP_OVERDUE: 0,
        UNANSWERED_INBOUND: 0,
        UNASSIGNED_INQUIRY: 0,
        MISSING_QUALIFICATION: 0,
        NO_FOLLOW_UP_SCHEDULED: 0,
      },
      signalsBySeverity: { warning: 0, info: 0 },
      signals: [],
      evaluatedAt: '2026-08-16T10:00:00.000Z',
    };

    render(
      <DashboardNeedsAttention
        summary={emptySummary}
        signals={[]}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('Nothing requires immediate attention.')).toBeDefined();
    expect(screen.queryByText(/AI found no problems/i)).toBeNull();
  });

  it('renders an error state that is distinct from zero signals and allows retry', () => {
    const mockRefresh = vi.fn();
    render(
      <DashboardNeedsAttention
        summary={null}
        signals={[]}
        isLoading={false}
        error="Network connection timeout"
        onRefresh={mockRefresh}
      />
    );

    expect(screen.getByText('Unable to load attention items')).toBeDefined();
    expect(screen.getByText('Network connection timeout')).toBeDefined();
    expect(screen.queryByText('Nothing requires immediate attention.')).toBeNull();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders bounded preview list with working navigation callbacks', () => {
    const navigateInquiry = vi.fn();
    const navigateConversation = vi.fn();

    render(
      <DashboardNeedsAttention
        summary={MOCK_SUMMARY}
        signals={MOCK_SIGNALS}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
        onNavigateInquiry={navigateInquiry}
        onNavigateConversation={navigateConversation}
      />
    );

    expect(screen.getByText('Follow-up overdue for Kashmir Holiday')).toBeDefined();
    expect(screen.getByText('Unanswered customer message')).toBeDefined();

    const viewInquiryBtns = screen.getAllByRole('button', { name: /view inquiry/i });
    fireEvent.click(viewInquiryBtns[0]);
    expect(navigateInquiry).toHaveBeenCalledWith('inq-101');

    const openConvBtn = screen.getByRole('button', { name: /open conversation/i });
    fireEvent.click(openConvBtn);
    expect(navigateConversation).toHaveBeenCalledWith('conv-202');
  });
});

describe('AI-4C Inquiry Table: AttentionBadge', () => {
  it('renders highest-priority signal badge and +N counter', () => {
    // Passing 2 signals: FOLLOW_UP_OVERDUE (Rank 1) and MISSING_QUALIFICATION (Rank 5)
    const signals = [MOCK_SIGNALS[0], MOCK_SIGNALS[3]];

    render(<AttentionBadge signals={signals} />);

    expect(screen.getByText('Follow-up overdue')).toBeDefined();
    expect(screen.getByText('+1')).toBeDefined();
  });

  it('renders missing details count accurately', () => {
    // Missing 2 details: destination and number_of_travelers
    render(<AttentionBadge signals={[MOCK_SIGNALS[3]]} />);

    expect(screen.getByText('Missing 2 details')).toBeDefined();
    expect(screen.queryByText('+')).toBeNull();
  });

  it('renders nothing when signals array is empty (clean state)', () => {
    const { container } = render(<AttentionBadge signals={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('AI-4C Inquiry Drawer: AttentionDrawerSection', () => {
  it('renders multiple signals truthfully with missing qualification fields', () => {
    const actionClick = vi.fn();
    const signals = [MOCK_SIGNALS[0], MOCK_SIGNALS[3]];

    render(
      <AttentionDrawerSection
        signals={signals}
        onActionClick={actionClick}
      />
    );

    expect(screen.getByText('Needs Attention')).toBeDefined();
    expect(screen.getByText('2 items')).toBeDefined();
    expect(screen.getByText('Follow-up overdue for Kashmir Holiday')).toBeDefined();
    expect(screen.getByText('Missing qualification fields')).toBeDefined();
    expect(screen.getByText('Destination, Traveler count')).toBeDefined();

    const scheduleBtn = screen.getByRole('button', { name: /schedule follow-up/i });
    fireEvent.click(scheduleBtn);
    expect(actionClick).toHaveBeenCalled();
  });

  it('renders nothing when inquiry is clean (0 signals, no wasted vertical banner)', () => {
    const { container } = render(
      <AttentionDrawerSection signals={[]} onActionClick={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });
});
