/**
 * Server-Authoritative CRM Copilot Context Resolver (Phase AI-1)
 * 
 * Resolves safe, bounded, tenant-scoped CRM context for Rihla Copilot.
 * - Authenticates session via Supabase server auth
 * - Derives authoritative tenant_id and role from profiles
 * - Fails closed for Super Admin (P1A boundary)
 * - Resolves canonical records from public.inquiries, public.traveler_profiles,
 *   public.bookings, public.conversations
 * - Preserves null/zero financial semantics and minimizes PII
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type CopilotContextType = 'none' | 'inquiry' | 'traveler' | 'booking' | 'conversation';

export interface ClientContextHint {
  pathname?: string;
  contextType?: CopilotContextType;
  contextId?: string | null;
}

export interface UserContextDTO {
  userId: string;
  fullName: string;
  role: string;
  email?: string;
}

export interface AgencyContextDTO {
  tenantId: string;
  agencyName?: string;
}

export interface PageContextDTO {
  pathname: string;
  section: string;
}

export interface InquirySummaryDTO {
  id: string;
  destination: string | null;
  stage: string | null;
  priority: string | null;
  expectedValue: number | null;
  currency: string;
  travelersCount: number | null;
  departureDate: string | null;
  returnDate: string | null;
  requirements: string | null;
  assignedAgentId: string | null;
  createdAt: string | null;
  linkedTraveler?: {
    id: string;
    displayName: string | null;
    emailAvailable: boolean;
    phoneAvailable: boolean;
  } | null;
}

export interface TravelerSummaryDTO {
  id: string;
  displayName: string | null;
  preferredLanguage: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  createdAt: string | null;
}

export interface BookingSummaryDTO {
  id: string;
  bookingReference: string | null;
  bookingStatus: string | null;
  paymentStatus: string | null;
  departureDate: string | null;
  returnDate: string | null;
  passengerCount: number | null;
  totalAmount: number | null;
  paidAmount: number | null;
  balanceDue: number | null;
  financialDataComplete: boolean;
  inquiryId: string | null;
  travelerId: string | null;
}

export interface ConversationSummaryDTO {
  id: string;
  channel: string | null;
  status: string | null;
  lastMessageAt: string | null;
  recentMessages: Array<{
    senderType: string;
    senderName: string;
    content: string;
    createdAt: string;
  }>;
}

export type EntityContextDTO =
  | { type: 'inquiry'; data: InquirySummaryDTO | null; recordUnavailable?: boolean }
  | { type: 'traveler'; data: TravelerSummaryDTO | null; recordUnavailable?: boolean }
  | { type: 'booking'; data: BookingSummaryDTO | null; recordUnavailable?: boolean }
  | { type: 'conversation'; data: ConversationSummaryDTO | null; recordUnavailable?: boolean }
  | { type: 'none'; data: null };

export interface CopilotContextResolution {
  success: boolean;
  error?: string;
  user?: UserContextDTO;
  agency?: AgencyContextDTO;
  page?: PageContextDTO;
  entity?: EntityContextDTO;
  currentDate?: string;
}

/**
 * Maps pathname to human-readable CRM section
 */
function mapPathnameToSection(pathname: string): string {
  if (pathname.startsWith('/app/inquiries')) return 'Inquiries';
  if (pathname.startsWith('/app/pipeline')) return 'Pipeline';
  if (pathname.startsWith('/app/travelers')) return 'Travelers';
  if (pathname.startsWith('/app/bookings')) return 'Bookings';
  if (pathname.startsWith('/app/conversations')) return 'Conversations';
  if (pathname.startsWith('/app/calendar')) return 'Calendar';
  if (pathname.startsWith('/app/tasks')) return 'Tasks';
  if (pathname.startsWith('/app/analytics')) return 'Analytics';
  if (pathname.startsWith('/app/settings')) return 'Settings';
  if (pathname.startsWith('/app/dashboard') || pathname === '/app') return 'Dashboard';
  return 'CRM Shell';
}

/**
 * Resolves authoritative Copilot Context on the server.
 */
export async function resolveCopilotContext(
  supabase: SupabaseClient,
  clientHint: ClientContextHint,
  overrideAuth?: { userId: string; tenantId: string; role: string; fullName: string }
): Promise<CopilotContextResolution> {
  let userId: string;
  let tenantId: string;
  let role: string;
  let fullName: string;

  if (overrideAuth) {
    userId = overrideAuth.userId;
    tenantId = overrideAuth.tenantId;
    role = overrideAuth.role;
    fullName = overrideAuth.fullName;
  } else {
    // 1. Authenticate user session
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return {
        success: false,
        error: 'Unauthorized: No active authenticated session',
      };
    }

    userId = authData.user.id;

    // 2. Fetch authoritative profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, tenant_id, role, full_name, email')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return {
        success: false,
        error: 'Unauthorized: User profile not found',
      };
    }

    tenantId = profile.tenant_id || 'global';
    role = profile.role || 'viewer';
    fullName = profile.full_name || profile.email || 'Agent';
  }

  // 3. Super Admin Rejection (P1A boundary) — Platform admins cannot access Agency CRM Copilot
  if (role === 'super_admin') {
    return {
      success: false,
      error: 'Forbidden: Platform Super Admin cannot access Agency CRM Copilot',
    };
  }

  if (!tenantId || tenantId === 'global') {
    return {
      success: false,
      error: 'Forbidden: Valid agency tenant required',
    };
  }

  // 4. Resolve Agency Name
  let agencyName = 'Agency CRM';
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantData?.name) {
    agencyName = tenantData.name;
  }

  const pathname = clientHint.pathname || '/app/dashboard';
  const page: PageContextDTO = {
    pathname,
    section: mapPathnameToSection(pathname),
  };

  const user: UserContextDTO = {
    userId,
    fullName,
    role,
  };

  const agency: AgencyContextDTO = {
    tenantId,
    agencyName,
  };

  // 5. Resolve Entity Context if requested
  const contextType = clientHint.contextType || 'none';
  const contextId = clientHint.contextId?.trim();

  let entity: EntityContextDTO = { type: 'none', data: null };

  if (contextType === 'inquiry' && contextId) {
    // Canonical public.inquiries query, strictly tenant-scoped
    const { data: inquiry, error: inqErr } = await supabase
      .from('inquiries')
      .select(`
        id,
        destination,
        pipeline_stage,
        priority,
        expected_value,
        currency,
        passenger_count,
        departure_date,
        return_date,
        special_requests,
        assigned_agent_id,
        traveler_id,
        created_at
      `)
      .eq('id', contextId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (inqErr || !inquiry) {
      entity = { type: 'inquiry', data: null, recordUnavailable: true };
    } else {
      let linkedTraveler: InquirySummaryDTO['linkedTraveler'] = null;
      if (inquiry.traveler_id) {
        const { data: traveler } = await supabase
          .from('traveler_profiles')
          .select('id, display_name, email, phone')
          .eq('id', inquiry.traveler_id)
          .eq('tenant_id', tenantId)
          .maybeSingle();

        if (traveler) {
          linkedTraveler = {
            id: traveler.id,
            displayName: traveler.display_name || null,
            emailAvailable: !!traveler.email,
            phoneAvailable: !!traveler.phone,
          };
        }
      }

      entity = {
        type: 'inquiry',
        data: {
          id: inquiry.id,
          destination: inquiry.destination || null,
          stage: inquiry.pipeline_stage || null,
          priority: inquiry.priority || null,
          expectedValue: inquiry.expected_value !== null && inquiry.expected_value !== undefined ? Number(inquiry.expected_value) : null,
          currency: inquiry.currency || 'INR',
          travelersCount: inquiry.passenger_count !== null && inquiry.passenger_count !== undefined ? Number(inquiry.passenger_count) : null,
          departureDate: inquiry.departure_date || null,
          returnDate: inquiry.return_date || null,
          requirements: inquiry.special_requests || null,
          assignedAgentId: inquiry.assigned_agent_id || null,
          createdAt: inquiry.created_at || null,
          linkedTraveler,
        },
      };
    }
  } else if (contextType === 'traveler' && contextId) {
    // Canonical public.traveler_profiles query, strictly tenant-scoped (PII-minimized)
    const { data: traveler, error: travErr } = await supabase
      .from('traveler_profiles')
      .select('id, display_name, preferred_language, email, phone, created_at')
      .eq('id', contextId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (travErr || !traveler) {
      entity = { type: 'traveler', data: null, recordUnavailable: true };
    } else {
      entity = {
        type: 'traveler',
        data: {
          id: traveler.id,
          displayName: traveler.display_name || null,
          preferredLanguage: traveler.preferred_language || null,
          hasEmail: !!traveler.email,
          hasPhone: !!traveler.phone,
          createdAt: traveler.created_at || null,
        },
      };
    }
  } else if (contextType === 'booking' && contextId) {
    // Canonical public.bookings query, strictly tenant-scoped
    const { data: booking, error: bkErr } = await supabase
      .from('bookings')
      .select(`
        id,
        booking_reference,
        booking_status,
        payment_status,
        departure_date,
        return_date,
        passenger_count,
        total_amount,
        paid_amount,
        balance_due,
        financial_data_complete,
        inquiry_id,
        traveler_id
      `)
      .eq('id', contextId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (bkErr || !booking) {
      entity = { type: 'booking', data: null, recordUnavailable: true };
    } else {
      entity = {
        type: 'booking',
        data: {
          id: booking.id,
          bookingReference: booking.booking_reference || null,
          bookingStatus: booking.booking_status || null,
          paymentStatus: booking.payment_status || null,
          departureDate: booking.departure_date || null,
          returnDate: booking.return_date || null,
          passengerCount: booking.passenger_count !== null && booking.passenger_count !== undefined ? Number(booking.passenger_count) : null,
          totalAmount: booking.total_amount !== null && booking.total_amount !== undefined ? Number(booking.total_amount) : null,
          paidAmount: booking.paid_amount !== null && booking.paid_amount !== undefined ? Number(booking.paid_amount) : null,
          balanceDue: booking.balance_due !== null && booking.balance_due !== undefined ? Number(booking.balance_due) : null,
          financialDataComplete: Boolean(booking.financial_data_complete),
          inquiryId: booking.inquiry_id || null,
          travelerId: booking.traveler_id || null,
        },
      };
    }
  } else if (contextType === 'conversation' && contextId) {
    // Canonical public.conversations query, strictly tenant-scoped
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id, channel, status, last_message_at')
      .eq('id', contextId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (convErr || !conversation) {
      entity = { type: 'conversation', data: null, recordUnavailable: true };
    } else {
      // Fetch up to 5 recent messages for bounded window
      const { data: msgRows } = await supabase
        .from('messages')
        .select('sender_type, sender_name, content, created_at')
        .eq('conversation_id', contextId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(5);

      const recentMessages = (msgRows || [])
        .reverse()
        .map((m) => ({
          senderType: m.sender_type || 'user',
          senderName: m.sender_name || 'User',
          content: m.content || '',
          createdAt: m.created_at || '',
        }));

      entity = {
        type: 'conversation',
        data: {
          id: conversation.id,
          channel: conversation.channel || null,
          status: conversation.status || null,
          lastMessageAt: conversation.last_message_at || null,
          recentMessages,
        },
      };
    }
  }

  return {
    success: true,
    user,
    agency,
    page,
    entity,
    currentDate: new Date().toISOString().split('T')[0],
  };
}
