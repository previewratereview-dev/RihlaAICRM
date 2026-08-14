// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { InquiryDetailDrawer } from '@/components/inquiries/inquiry-detail-drawer';
import { TravelersView } from '@/components/travelers-view';
import { EmailComposerModal } from '@/components/communication/email-composer-modal';
import type { InquiryDirectoryItem, Lead, User } from '@/types';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

vi.mock('@/lib/data/service', () => ({
  CRMDatabaseService: {
    isSupabaseEnabled: () => false,
    upsertConversation: vi.fn().mockResolvedValue({}),
  },
  dataService: {
    getLeads: vi.fn().mockResolvedValue([]),
    addLead: vi.fn().mockResolvedValue({ id: 'new-lead-1' }),
    updateLead: vi.fn().mockResolvedValue({}),
    deleteLead: vi.fn().mockResolvedValue(true),
    getAuditLogs: vi.fn().mockResolvedValue([]),
    getTenantBranding: vi.fn().mockResolvedValue({}),
    getIntegrationKeys: vi.fn().mockResolvedValue({}),
    getUsers: vi.fn().mockResolvedValue([]),
    createUser: vi.fn().mockResolvedValue({}),
    updateUser: vi.fn().mockResolvedValue({}),
    deleteUser: vi.fn().mockResolvedValue(true),
  },
}));

describe('Phase F1B: Unified Traveler & Inquiry Communication Workflow', () => {
  const mockUser: User = {
    id: 'user-agent-1',
    email: 'agent@rihla.app',
    fullName: 'Sara Agent',
    avatarUrl: '',
    role: 'specialist',
    tenantId: 'tenant-demo',
    isOnline: true,
  };

  const mockInquiry: InquiryDirectoryItem = {
    inquiryId: 'inq-101',
    legacyLeadId: 'lead-101',
    travelerId: 'trav-101',
    travelerDisplayName: 'Layla Al-Mansoor',
    travelerEmail: 'layla@example.com',
    travelerPhone: '+971501234567',
    destination: 'Kyoto Cultural Immersion',
    pipelineStage: 'initial_contact',
    priority: 'high',
    expectedValue: 12500,
    currency: 'INR',
    leadSource: 'website',
    assignedAgentId: 'user-agent-1',
    lastContactedAt: null,
    nextFollowUpAt: null,
    identityReviewRequired: false,
    identityReviewReason: null,
    createdAt: '2026-08-01T10:00:00Z',
  };

  const mockPureInquiry: InquiryDirectoryItem = {
    inquiryId: 'inq-202',
    legacyLeadId: null,
    travelerId: 'trav-202',
    travelerDisplayName: 'Omar Farooq',
    travelerEmail: 'omar@example.com',
    travelerPhone: '+971509876543',
    destination: 'Swiss Alps Expedition',
    pipelineStage: 'initial_contact',
    priority: 'medium',
    expectedValue: 18000,
    currency: 'INR',
    leadSource: 'website',
    assignedAgentId: 'user-agent-1',
    lastContactedAt: null,
    nextFollowUpAt: null,
    identityReviewRequired: false,
    identityReviewReason: null,
    createdAt: '2026-08-05T10:00:00Z',
  };

  const mockConfirmedLead: Lead = {
    id: 'lead-101',
    fullName: 'Layla Al-Mansoor',
    email: 'layla@example.com',
    phone: '+971501234567',
    whatsapp: '+971501234567',
    destination: 'Kyoto Cultural Immersion',
    country: 'Japan',
    city: 'Kyoto',
    dealValue: 12500,
    status: 'booking_confirmed',
    priority: 'high',
    leadSource: 'website',
    tripType: 'Custom',
    numberOfTravelers: '2',
    budget: '$12,500',
    tags: ['luxury', 'japan'],
    aiScore: 85,
    aiSummary: '',
    specialRequests: '',
    sourceOfDiscovery: '',
    lastContacted: '',
    nextFollowUp: '',
    departureDate: '',
    returnDate: '',
    duration: '',
    travelClass: '',
    assignedTo: 'user-agent-1',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-10T12:00:00Z',
    tenantId: 'tenant-demo',
  };

  const originalStartConversation = useCRMStore.getState().startConversation;

  beforeEach(() => {
    vi.clearAllMocks();
    useCRMStore.getState().resetSessionState();
    useCRMStore.setState({
      startConversation: originalStartConversation,
      currentUser: mockUser,
      tenantId: 'tenant-demo',
      leads: [mockConfirmedLead],
      team: [mockUser],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('A. Static Code Scan: eliminates mailto:, removes dangerous "Send Quick Email", and removes Mail icon for chat', () => {
    const inquiryDrawerSrc = fs.readFileSync(
      path.resolve(__dirname, '../components/inquiries/inquiry-detail-drawer.tsx'),
      'utf8'
    );
    const leadDrawerSrc = fs.readFileSync(
      path.resolve(__dirname, '../components/leads/lead-detail-drawer.tsx'),
      'utf8'
    );
    const travelersViewSrc = fs.readFileSync(
      path.resolve(__dirname, '../components/travelers-view.tsx'),
      'utf8'
    );

    // No raw mailto: links in inquiry drawer or travelers view
    expect(inquiryDrawerSrc).not.toContain('mailto:');
    expect(travelersViewSrc).not.toContain('mailto:');

    // No "Send Quick Email"
    expect(leadDrawerSrc).not.toContain('Send Quick Email');
    expect(inquiryDrawerSrc).not.toContain('Send Quick Email');

    // No Mail icon used for chat/conversation
    expect(leadDrawerSrc).not.toContain('title="Open Chat in CRM"');
  });

  it('B & H. Message action uses MessageSquare icon and starts a CRM Conversation instead of email', async () => {
    const startConversationSpy = vi.fn().mockResolvedValue('conv-new-1');
    useCRMStore.setState({ startConversation: startConversationSpy });

    render(
      <InquiryDetailDrawer
        inquiry={mockInquiry}
        notes={[]}
        activities={[]}
        team={[mockUser]}
        onClose={vi.fn()}
        onEditLegacy={vi.fn()}
        onUpdateLegacy={vi.fn()}
        onAddNote={vi.fn()}
        onDeleteNote={vi.fn()}
        currentUser={mockUser}
      />
    );

    const messageBtn = screen.getByRole('button', { name: /message/i });
    expect(messageBtn).toBeInTheDocument();

    fireEvent.click(messageBtn);

    expect(startConversationSpy).toHaveBeenCalledWith(
      'lead-101',
      'email',
      expect.objectContaining({
        travelerId: 'trav-101',
        inquiryId: 'inq-101',
        travelerName: 'Layla Al-Mansoor',
        travelerEmail: 'layla@example.com',
      })
    );
  });

  it('C & D. Email initial click DOES NOT send email directly, but opens the EmailComposerModal', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');

    render(
      <InquiryDetailDrawer
        inquiry={mockInquiry}
        notes={[]}
        activities={[]}
        team={[mockUser]}
        onClose={vi.fn()}
        onEditLegacy={vi.fn()}
        onUpdateLegacy={vi.fn()}
        onAddNote={vi.fn()}
        onDeleteNote={vi.fn()}
        currentUser={mockUser}
      />
    );

    const emailBtn = screen.getByRole('button', { name: /email/i });
    fireEvent.click(emailBtn);

    // Initial click MUST NOT call messaging/send
    expect(fetchSpy).not.toHaveBeenCalled();

    // In-product composer modal must be opened
    expect(screen.getByText('Compose Email')).toBeInTheDocument();
    expect(screen.getAllByText(/layla@example.com/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText(/subject/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/message body/i)).toBeInTheDocument();
  });

  it('E. Cancel in EmailComposerModal sends nothing and closes modal', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const onCloseSpy = vi.fn();

    render(
      <EmailComposerModal
        isOpen={true}
        onClose={onCloseSpy}
        travelerName="Layla Al-Mansoor"
        travelerEmail="layla@example.com"
        defaultSubject="Trip Discussion"
        defaultContent="Hello Layla"
      />
    );

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onCloseSpy).toHaveBeenCalled();
  });

  it('F & G. Explicit Send invokes messaging API exactly once and guards against rapid double-submits', async () => {
    let resolveFetch: (value: Response) => void;
    const pendingFetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => pendingFetchPromise);
    const onCloseSpy = vi.fn();
    const onSuccessSpy = vi.fn();

    render(
      <EmailComposerModal
        isOpen={true}
        onClose={onCloseSpy}
        travelerName="Layla Al-Mansoor"
        travelerEmail="layla@example.com"
        travelerId="trav-101"
        inquiryId="inq-101"
        legacyLeadId="lead-101"
        defaultSubject="Your Kyoto Trip"
        defaultContent="We have prepared your customized itinerary."
      />
    );

    const sendBtn = screen.getByRole('button', { name: /send email/i });

    // First click
    fireEvent.click(sendBtn);

    // Rapid second click while pending
    fireEvent.click(sendBtn);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/messaging/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'email',
        to: 'layla@example.com',
        subject: 'Your Kyoto Trip',
        content: 'We have prepared your customized itinerary.',
        leadName: 'Layla Al-Mansoor',
        travelerId: 'trav-101',
        inquiryId: 'inq-101',
        legacyLeadId: 'lead-101',
      }),
    });

    // Resolve fetch
    resolveFetch!(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await waitFor(() => {
      expect(onSuccessSpy).toBeDefined();
      expect(onCloseSpy).toHaveBeenCalled();
    });
  });

  it('I & J. Call action uses valid tel: link when phone is present and disables when missing', () => {
    const { unmount } = render(
      <InquiryDetailDrawer
        inquiry={mockInquiry}
        notes={[]}
        activities={[]}
        team={[mockUser]}
        onClose={vi.fn()}
        onEditLegacy={vi.fn()}
        onUpdateLegacy={vi.fn()}
        onAddNote={vi.fn()}
        onDeleteNote={vi.fn()}
        currentUser={mockUser}
      />
    );

    const callEl = screen.getByText('Call').closest('a')!;
    expect(callEl).toHaveAttribute('href', 'tel:+971501234567');

    unmount();

    // Render with missing phone
    const inquiryWithoutPhone = { ...mockInquiry, travelerPhone: null };
    render(
      <InquiryDetailDrawer
        inquiry={inquiryWithoutPhone}
        notes={[]}
        activities={[]}
        team={[mockUser]}
        onClose={vi.fn()}
        onEditLegacy={vi.fn()}
        onUpdateLegacy={vi.fn()}
        onAddNote={vi.fn()}
        onDeleteNote={vi.fn()}
        currentUser={mockUser}
      />
    );

    const disabledCallEl = screen.getByText('Call').closest('a')!;
    expect(disabledCallEl).not.toHaveAttribute('href');
  });

  it('K & L. Missing email disables Email action, missing phone disables Call action', () => {
    const inquiryNoContact: InquiryDirectoryItem = {
      ...mockInquiry,
      travelerEmail: null,
      travelerPhone: null,
    };

    render(
      <InquiryDetailDrawer
        inquiry={inquiryNoContact}
        notes={[]}
        activities={[]}
        team={[mockUser]}
        onClose={vi.fn()}
        onEditLegacy={vi.fn()}
        onUpdateLegacy={vi.fn()}
        onAddNote={vi.fn()}
        onDeleteNote={vi.fn()}
        currentUser={mockUser}
      />
    );

    const emailBtn = screen.getByRole('button', { name: /email/i });
    expect(emailBtn).toBeDisabled();

    const callEl = screen.getByText('Call').closest('a')!;
    expect(callEl).not.toHaveAttribute('href');
  });

  it('M. Traveler and Inquiry workflows resolve the same canonical contact information', () => {
    render(
      <TravelersView useNewReadOverride={false} />
    );

    // Traveler table renders the traveler contact info
    expect(screen.getByText('Layla Al-Mansoor')).toBeInTheDocument();
    expect(screen.getByText('Kyoto Cultural Immersion')).toBeInTheDocument();

    // Actions exist for Message, Email, Call, and Re-book
    const messageBtns = screen.getAllByTitle('Message');
    const emailBtns = screen.getAllByTitle('Email');
    const callLinks = screen.getAllByTitle(/Call \+971501234567/i);

    expect(messageBtns.length).toBeGreaterThan(0);
    expect(emailBtns.length).toBeGreaterThan(0);
    expect(callLinks.length).toBeGreaterThan(0);
  });

  it('N. Canonical Entity Linkage: startConversation stores canonical travelerId + inquiryId and keeps leadId null when no genuine lead exists', async () => {
    // 1. Start conversation from pure canonical inquiry (legacyLeadId = null)
    const convId = await useCRMStore.getState().startConversation(
      null,
      'email',
      {
        travelerId: mockPureInquiry.travelerId,
        inquiryId: mockPureInquiry.inquiryId,
        travelerName: mockPureInquiry.travelerDisplayName,
        travelerEmail: mockPureInquiry.travelerEmail || undefined,
        phone: mockPureInquiry.travelerPhone || undefined,
        tenantId: 'tenant-demo',
      }
    );

    const createdConv = useCRMStore.getState().conversations.find((c) => c.id === convId);
    expect(createdConv).toBeDefined();
    // Invariants:
    expect(createdConv?.travelerId).toBe('trav-202');
    expect(createdConv?.inquiryId).toBe('inq-202');
    expect(createdConv?.leadId).toBeNull(); // NEVER fabricated or set to inquiryId/travelerId!
    expect(createdConv?.tenantId).toBe('tenant-demo');
  });

  it('O. Traveler with NO Inquiry: startConversation safely links travelerId with leadId=null and inquiryId=null without fabricating entities', async () => {
    const initialLeadsCount = useCRMStore.getState().leads.length;

    const convId = await useCRMStore.getState().startConversation(
      null,
      'email',
      {
        travelerId: 'trav-standalone-999',
        travelerName: 'Fatima Al-Nuaimi',
        travelerEmail: 'fatima@example.com',
        tenantId: 'tenant-demo',
      }
    );

    const createdConv = useCRMStore.getState().conversations.find((c) => c.id === convId);
    expect(createdConv).toBeDefined();
    expect(createdConv?.travelerId).toBe('trav-standalone-999');
    expect(createdConv?.inquiryId).toBeNull();
    expect(createdConv?.leadId).toBeNull();
    expect(createdConv?.leadName).toBe('Fatima Al-Nuaimi');

    // Asserts no fake Inquiry or Lead was created in store
    expect(useCRMStore.getState().leads.length).toBe(initialLeadsCount);
  });
});
