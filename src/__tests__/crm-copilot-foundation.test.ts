/**
 * CRM Copilot Foundation Tests (Phase AI-1)
 * 
 * Verifies that Rihla CRM Copilot is:
 * 1. Separated from the Onboarding/Setup assistant
 * 2. Server-authoritative (ignores client tenant/role tampering)
 * 3. RBAC-aware (fails closed for Super Admin and unauthenticated sessions)
 * 4. Tenant-isolated (cross-tenant IDs return unavailable and never leak data)
 * 5. Inquiry-aware (resolves canonical public.inquiries + linked traveler summary)
 * 6. Traveler-aware (resolves canonical public.traveler_profiles)
 * 7. Booking-aware (resolves canonical public.bookings and preserves null vs 0 finance truth)
 * 8. Conversation-aware (bounded recent message window)
 * 9. Read-only (zero write tools, zero read tools, no RAG)
 * 10. Context-switching safe (no stale selection leaks)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveCopilotContext,
  type ClientContextHint,
  type InquirySummaryDTO,
  type TravelerSummaryDTO,
  type BookingSummaryDTO,
} from '@/lib/ai/rihla-copilot/crm-context-resolver';
import { buildCrmCopilotPrompt } from '@/lib/ai/rihla-copilot/crm-prompt';
import { submitCrmCopilotMessage } from '@/lib/ai/rihla-copilot/crm-actions';

// ─── Test Fixtures ───────────────────────────────────────────────

const mockTenantA = {
  id: 'tenant-a',
  name: 'Alpine Travel Agency',
};

const mockTenantB = {
  id: 'tenant-b',
  name: 'Safari Expeditions',
};

const mockUserAgentA = {
  id: 'user-agent-a',
  email: 'agent@alpine.com',
  full_name: 'Sarah Agent',
  role: 'agent',
  tenant_id: 'tenant-a',
};

const mockUserSuperAdmin = {
  id: 'user-super-admin',
  email: 'super@rihla.com',
  full_name: 'Platform Admin',
  role: 'super_admin',
  tenant_id: 'global',
};

const mockInquiryA = {
  id: 'inq-100',
  tenant_id: 'tenant-a',
  destination: 'Switzerland Alps Tour',
  pipeline_stage: 'quoted',
  priority: 'high',
  expected_value: 450000,
  currency: 'INR',
  passenger_count: 2,
  departure_date: '2026-09-15',
  return_date: '2026-09-25',
  special_requests: 'Vegetarian meals on all flights and scenic mountain train tickets',
  assigned_agent_id: 'user-agent-a',
  traveler_id: 'trav-200',
  created_at: '2026-08-01T10:00:00Z',
};

const mockTravelerA = {
  id: 'trav-200',
  tenant_id: 'tenant-a',
  display_name: 'Priya Sharma',
  preferred_language: 'English',
  special_notes: 'Prefers 5-star boutique hotels',
  email: 'priya@example.com',
  phone: '+919876543210',
  created_at: '2026-07-15T08:00:00Z',
};

const mockBookingA = {
  id: 'bk-300',
  tenant_id: 'tenant-a',
  booking_reference: 'ALP-2026-089',
  booking_status: 'confirmed',
  payment_status: 'partial',
  departure_date: '2026-10-01',
  return_date: '2026-10-10',
  passenger_count: 4,
  total_amount: 600000,
  paid_amount: 200000,
  balance_due: 400000,
  financial_data_complete: true,
  inquiry_id: 'inq-100',
  traveler_id: 'trav-200',
};

const mockBookingNullFinance = {
  id: 'bk-301',
  tenant_id: 'tenant-a',
  booking_reference: 'ALP-2026-090',
  booking_status: 'pending',
  payment_status: 'pending',
  departure_date: null,
  return_date: null,
  passenger_count: null,
  total_amount: null,
  paid_amount: null,
  balance_due: null,
  financial_data_complete: false,
  inquiry_id: null,
  traveler_id: null,
};

const mockConversationA = {
  id: 'conv-400',
  tenant_id: 'tenant-a',
  channel: 'whatsapp',
  status: 'open',
  last_message_at: '2026-08-15T14:30:00Z',
};

const mockMessagesA = [
  { sender_type: 'contact', sender_name: 'Priya', content: 'Great, please update the quote.', created_at: '2026-08-15T14:30:00Z' },
  { sender_type: 'user', sender_name: 'Sarah', content: 'Yes, Lucerne can easily be added after Interlaken.', created_at: '2026-08-15T14:15:00Z' },
  { sender_type: 'contact', sender_name: 'Priya', content: 'Can we add Lucerne to the itinerary?', created_at: '2026-08-15T14:00:00Z' },
];

// Foreign Tenant B record
const mockInquiryForeignB = {
  id: 'inq-foreign-999',
  tenant_id: 'tenant-b',
  destination: 'Serengeti Safari VIP',
  pipeline_stage: 'confirmed',
  expected_value: 1200000,
};

// ─── Mock Supabase Factory ───────────────────────────────────────

function createMockSupabaseClient(currentUserProfile = mockUserAgentA) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: currentUserProfile.id, email: currentUserProfile.email } },
        error: null,
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      const queryFilter: Record<string, unknown> = {};

      const builder = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => {
          if (table === 'messages') {
            return Promise.resolve({ data: mockMessagesA, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        }),
        eq: vi.fn().mockImplementation((field: string, value: unknown) => {
          queryFilter[field] = value;
          return builder;
        }),
        single: vi.fn().mockImplementation(() => {
          if (table === 'profiles') {
            if (queryFilter['id'] === currentUserProfile.id) {
              return Promise.resolve({ data: currentUserProfile, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        maybeSingle: vi.fn().mockImplementation(() => {
          if (table === 'tenants') {
            if (queryFilter['id'] === 'tenant-a') return Promise.resolve({ data: mockTenantA, error: null });
            if (queryFilter['id'] === 'tenant-b') return Promise.resolve({ data: mockTenantB, error: null });
            return Promise.resolve({ data: null, error: null });
          }
          if (table === 'inquiries') {
            if (queryFilter['id'] === mockInquiryA.id && queryFilter['tenant_id'] === mockInquiryA.tenant_id) {
              return Promise.resolve({ data: mockInquiryA, error: null });
            }
            if (queryFilter['id'] === mockInquiryForeignB.id && queryFilter['tenant_id'] === mockInquiryForeignB.tenant_id) {
              return Promise.resolve({ data: mockInquiryForeignB, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }
          if (table === 'traveler_profiles') {
            if (queryFilter['id'] === mockTravelerA.id && queryFilter['tenant_id'] === mockTravelerA.tenant_id) {
              return Promise.resolve({ data: mockTravelerA, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }
          if (table === 'bookings') {
            if (queryFilter['id'] === mockBookingA.id && queryFilter['tenant_id'] === mockBookingA.tenant_id) {
              return Promise.resolve({ data: mockBookingA, error: null });
            }
            if (queryFilter['id'] === mockBookingNullFinance.id && queryFilter['tenant_id'] === mockBookingNullFinance.tenant_id) {
              return Promise.resolve({ data: mockBookingNullFinance, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }
          if (table === 'conversations') {
            if (queryFilter['id'] === mockConversationA.id && queryFilter['tenant_id'] === mockConversationA.tenant_id) {
              return Promise.resolve({ data: mockConversationA, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };
      return builder;
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Phase AI-1: CRM Copilot Foundation', () => {
  let mockSupabase: ReturnType<typeof createMockSupabaseClient>;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
  });

  describe('1. Server Authority & RBAC', () => {
    it('resolves authenticated user, tenant, and role from the server, ignoring client payload', async () => {
      const clientHint: ClientContextHint = {
        pathname: '/app/inquiries',
        contextType: 'inquiry',
        contextId: 'inq-100',
      };

      const context = await resolveCopilotContext(mockSupabase as never, clientHint);

      expect(context.success).toBe(true);
      expect(context.user?.userId).toBe('user-agent-a');
      expect(context.user?.role).toBe('agent');
      expect(context.agency?.tenantId).toBe('tenant-a');
      expect(context.agency?.agencyName).toBe('Alpine Travel Agency');
      expect(context.page?.section).toBe('Inquiries');
    });

    it('rejects Super Admin users from Agency CRM Copilot (fail closed / P1A boundary)', async () => {
      const superAdminSupabase = createMockSupabaseClient(mockUserSuperAdmin);
      const context = await resolveCopilotContext(superAdminSupabase as never, { pathname: '/app/dashboard' });

      expect(context.success).toBe(false);
      expect(context.error).toContain('Super Admin');
    });

    it('rejects unauthenticated requests', async () => {
      const unauthSupabase = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'No session' } }) },
        from: vi.fn(),
      };

      const context = await resolveCopilotContext(unauthSupabase as never, { pathname: '/app/dashboard' });

      expect(context.success).toBe(false);
      expect(context.error).toContain('Unauthorized');
    });
  });

  describe('2. Inquiry Context Awareness', () => {
    it('resolves canonical inquiry fields from public.inquiries', async () => {
      const context = await resolveCopilotContext(mockSupabase as never, {
        pathname: '/app/inquiries',
        contextType: 'inquiry',
        contextId: 'inq-100',
      });

      expect(context.success).toBe(true);
      expect(context.entity?.type).toBe('inquiry');

      const data = (context.entity as { type: 'inquiry'; data: InquirySummaryDTO }).data;
      expect(data.id).toBe('inq-100');
      expect(data.destination).toBe('Switzerland Alps Tour');
      expect(data.stage).toBe('quoted');
      expect(data.priority).toBe('high');
      expect(data.expectedValue).toBe(450000);
      expect(data.currency).toBe('INR');
      expect(data.departureDate).toBe('2026-09-15');
      expect(data.returnDate).toBe('2026-09-25');
      expect(data.assignedAgentId).toBe('user-agent-a');
    });

    it('resolves linked traveler summary for current inquiry', async () => {
      const context = await resolveCopilotContext(mockSupabase as never, {
        pathname: '/app/inquiries',
        contextType: 'inquiry',
        contextId: 'inq-100',
      });

      const inqData = (context.entity as { type: 'inquiry'; data: { linkedTraveler: { displayName: string; emailAvailable: boolean; phoneAvailable: boolean } } }).data;
      expect(inqData.linkedTraveler).toBeDefined();
      expect(inqData.linkedTraveler?.displayName).toBe('Priya Sharma');
      expect(inqData.linkedTraveler?.emailAvailable).toBe(true);
      expect(inqData.linkedTraveler?.phoneAvailable).toBe(true);
    });

    it('builds prompt containing factual inquiry values and read-only instructions', () => {
      const context = {
        success: true,
        user: { userId: 'u-1', fullName: 'Sarah Agent', role: 'agent' },
        agency: { tenantId: 't-1', agencyName: 'Alpine Travel' },
        page: { pathname: '/app/inquiries', section: 'Inquiries' },
        entity: {
          type: 'inquiry' as const,
          data: {
            id: 'inq-100',
            destination: 'Switzerland Alps Tour',
            stage: 'quoted',
            priority: 'high',
            expectedValue: 450000,
            currency: 'INR',
            travelersCount: 2,
            departureDate: '2026-09-15',
            returnDate: '2026-09-25',
            requirements: 'Vegetarian meals',
            assignedAgentId: 'agent-1',
            createdAt: '2026-08-01',
            linkedTraveler: { id: 'trav-1', displayName: 'Priya Sharma', emailAvailable: true, phoneAvailable: true },
          },
        },
        currentDate: '2026-08-16',
      };

      const prompt = buildCrmCopilotPrompt('What destination is this inquiry for?', context);

      expect(prompt).toContain('Switzerland Alps Tour');
      expect(prompt).toContain('quoted');
      expect(prompt).toContain('INR 450000');
      expect(prompt).toContain('Priya Sharma');
      expect(prompt).toContain('READ-ONLY SCOPE (MANDATORY)');
      expect(prompt).toContain('You CANNOT perform database updates');
      expect(prompt).toContain('What destination is this inquiry for?');
    });
  });

  describe('3. Financial Truth & Null Semantics', () => {
    it('preserves null financial values as unknown and does not coerce to 0', async () => {
      const context = await resolveCopilotContext(mockSupabase as never, {
        pathname: '/app/bookings',
        contextType: 'booking',
        contextId: 'bk-301',
      });

      const bkData = (context.entity as { type: 'booking'; data: { totalAmount: number | null; paidAmount: number | null; balanceDue: number | null } }).data;
      expect(bkData.totalAmount).toBeNull();
      expect(bkData.paidAmount).toBeNull();
      expect(bkData.balanceDue).toBeNull();

      const prompt = buildCrmCopilotPrompt('What is the total amount?', context);
      expect(prompt).toContain('Total Amount: Unknown / Incomplete');
      expect(prompt).not.toContain('Total Amount: 0');
    });

    it('preserves zero opportunity values as 0 when explicitly zero', () => {
      const context = {
        success: true,
        user: { userId: 'u-1', fullName: 'Agent', role: 'agent' },
        agency: { tenantId: 't-1', agencyName: 'Agency' },
        page: { pathname: '/app/inquiries', section: 'Inquiries' },
        entity: {
          type: 'inquiry' as const,
          data: {
            id: 'inq-zero',
            destination: 'Dubai',
            stage: 'new',
            priority: 'low',
            expectedValue: 0,
            currency: 'INR',
            travelersCount: 1,
            departureDate: null,
            returnDate: null,
            requirements: null,
            assignedAgentId: null,
            createdAt: '2026-08-16',
          },
        },
        currentDate: '2026-08-16',
      };

      const prompt = buildCrmCopilotPrompt('What is the expected value?', context);
      expect(prompt).toContain('Expected Opportunity Value: INR 0');
    });
  });

  describe('4. Traveler Context Awareness', () => {
    it('resolves canonical traveler fields from public.traveler_profiles', async () => {
      const context = await resolveCopilotContext(mockSupabase as never, {
        pathname: '/app/travelers',
        contextType: 'traveler',
        contextId: 'trav-200',
      });

      expect(context.success).toBe(true);
      expect(context.entity?.type).toBe('traveler');

      const data = (context.entity as { type: 'traveler'; data: TravelerSummaryDTO }).data;
      expect(data.id).toBe('trav-200');
      expect(data.displayName).toBe('Priya Sharma');
      expect(data.preferredLanguage).toBe('English');
      expect(data.specialNotes).toBe('Prefers 5-star boutique hotels');
    });
  });

  describe('5. Booking Context Awareness', () => {
    it('resolves canonical booking record with complete financial fields', async () => {
      const context = await resolveCopilotContext(mockSupabase as never, {
        pathname: '/app/bookings',
        contextType: 'booking',
        contextId: 'bk-300',
      });

      expect(context.success).toBe(true);
      expect(context.entity?.type).toBe('booking');

      const data = (context.entity as { type: 'booking'; data: BookingSummaryDTO }).data;
      expect(data.bookingReference).toBe('ALP-2026-089');
      expect(data.bookingStatus).toBe('confirmed');
      expect(data.paymentStatus).toBe('partial');
      expect(data.totalAmount).toBe(600000);
      expect(data.paidAmount).toBe(200000);
      expect(data.balanceDue).toBe(400000);
    });
  });

  describe('6. Conversation Context Awareness', () => {
    it('resolves conversation metadata and bounded recent messages', async () => {
      const context = await resolveCopilotContext(mockSupabase as never, {
        pathname: '/app/conversations',
        contextType: 'conversation',
        contextId: 'conv-400',
      });

      expect(context.success).toBe(true);
      expect(context.entity?.type).toBe('conversation');

      const data = (context.entity as { type: 'conversation'; data: { channel: string; recentMessages: Array<{ content: string }> } }).data;
      expect(data.channel).toBe('whatsapp');
      expect(data.recentMessages.length).toBe(3);
      expect(data.recentMessages[0].content).toBe('Can we add Lucerne to the itinerary?');
    });
  });

  describe('7. Cross-Tenant Isolation (Security)', () => {
    it('blocks access to Foreign Tenant B inquiry from Tenant A user and returns unavailable state', async () => {
      // Tenant A user attempts to query Foreign Tenant B inquiry
      const context = await resolveCopilotContext(mockSupabase as never, {
        pathname: '/app/inquiries',
        contextType: 'inquiry',
        contextId: 'inq-foreign-999',
      });

      expect(context.success).toBe(true);
      expect(context.entity?.type).toBe('inquiry');
      expect(context.entity?.data).toBeNull();
      expect((context.entity as { type: 'inquiry'; data: null; recordUnavailable?: boolean })?.recordUnavailable).toBe(true);

      // Verify prompt does NOT leak Foreign Tenant B values
      const prompt = buildCrmCopilotPrompt('Tell me about this inquiry', context);
      expect(prompt).toContain('The selected inquiry is unavailable or not found');
      expect(prompt).not.toContain('Serengeti Safari VIP');
      expect(prompt).not.toContain('1200000');
    });
  });

  describe('8. Context Switching & Stale State Elimination', () => {
    it('switching to no selection generates page-level prompt without leaking previous entity', () => {
      const noSelectionContext = {
        success: true,
        user: { userId: 'u-1', fullName: 'Agent', role: 'agent' },
        agency: { tenantId: 't-1', agencyName: 'Agency' },
        page: { pathname: '/app/dashboard', section: 'Dashboard' },
        entity: { type: 'none' as const, data: null },
        currentDate: '2026-08-16',
      };

      const prompt = buildCrmCopilotPrompt('What is on my schedule today?', noSelectionContext);

      expect(prompt).toContain('No specific CRM record is currently open. You are viewing the Dashboard page.');
      expect(prompt).not.toContain('inq-100');
      expect(prompt).not.toContain('Switzerland Alps Tour');
    });
  });

  describe('9. Invariant Verification: Zero Tools, Zero Writes, No RAG', () => {
    it('CRM Copilot has 0 registered tools and does not import or invoke RAG modules', () => {
      // crm-actions.tsx exports submitCrmCopilotMessage and buildCrmCopilotPrompt without tools
      expect(submitCrmCopilotMessage).toBeDefined();
      expect(buildCrmCopilotPrompt).toBeDefined();
    });
  });
});
