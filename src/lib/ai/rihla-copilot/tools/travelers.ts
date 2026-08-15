/**
 * CRM Copilot Traveler Read Tools (Phase AI-2)
 * 
 * Bounded traveler lookup and traveler history read tools.
 * Enforces PII minimization (no passport/unrestricted notes) and financial truth.
 * Successful booking statuses: confirmed, in_progress, completed.
 * Sanitizes all error messages to prevent database/SQL leakage.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type TrustedExecutionContext,
  type ToolResult,
  type ToolDefinition,
  SearchTravelersSchema,
  GetTravelerHistorySchema,
} from './types';
import type { TravelerSummaryDTO } from '../crm-context-resolver';

export interface TravelerSearchResultItem {
  id: string;
  displayName: string;
  preferredLanguage: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  createdAt: string | null;
}

export interface TravelerHistoryDTO {
  traveler: TravelerSummaryDTO;
  inquiries: Array<{
    id: string;
    destination: string | null;
    stage: string | null;
    expectedOpportunityValue: string;
    departureDate: string | null;
    createdAt: string | null;
  }>;
  bookings: Array<{
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
  }>;
  summary: {
    totalInquiriesCount: number;
    totalBookingsCount: number;
    successfulBookingsCount: number;
    hasPriorBookings: boolean;
  };
}

const SUCCESSFUL_BOOKING_STATUSES = new Set(['confirmed', 'in_progress', 'completed', 'closed_won']);

export const searchTravelersTool: ToolDefinition<typeof SearchTravelersSchema, TravelerSearchResultItem[]> = {
  name: 'searchTravelers',
  description: 'Search for travelers/clients in the agency workspace by name or search term. Maximum 5 results. Returns PII-minimized identity.',
  parameters: SearchTravelersSchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<TravelerSearchResultItem[]>> => {
    try {
      const limit = Math.min(params.limit || 5, 5);
      const query = params.query.trim();

      const { data: travelers, error } = await supabase
        .from('traveler_profiles')
        .select('id, display_name, preferred_language, email, phone, created_at')
        .eq('tenant_id', context.tenantId)
        .ilike('display_name', `%${query}%`)
        .order('display_name', { ascending: true })
        .limit(limit + 1);

      if (error) {
        console.error('[Copilot Tool Internal Error] searchTravelers:', error.message);
        return { success: false, error: 'Unable to search travelers.' };
      }

      const rows = travelers || [];
      const hasMore = rows.length > limit;
      const results = rows.slice(0, limit);

      const items: TravelerSearchResultItem[] = results.map((t) => ({
        id: t.id,
        displayName: t.display_name || 'Unnamed Traveler',
        preferredLanguage: t.preferred_language || null,
        hasEmail: !!t.email,
        hasPhone: !!t.phone,
        createdAt: t.created_at || null,
      }));

      return {
        success: true,
        data: items,
        count: items.length,
        hasMore,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[Copilot Tool Internal Exception] searchTravelers:', msg);
      return { success: false, error: 'Unable to search travelers.' };
    }
  },
};

export const getTravelerHistoryTool: ToolDefinition<typeof GetTravelerHistorySchema, TravelerHistoryDTO> = {
  name: 'getTravelerHistory',
  description: 'Retrieve full travel history for a specific traveler, including past inquiries, confirmed/cancelled bookings, and booking counts.',
  parameters: GetTravelerHistorySchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<TravelerHistoryDTO>> => {
    try {
      const travelerId = params.travelerId.trim();

      // 1. Fetch Traveler Profile
      const { data: traveler, error: travErr } = await supabase
        .from('traveler_profiles')
        .select('id, display_name, preferred_language, email, phone, created_at')
        .eq('id', travelerId)
        .eq('tenant_id', context.tenantId)
        .maybeSingle();

      if (travErr) {
        console.error('[Copilot Tool Internal Error] getTravelerHistory profile query:', travErr.message);
        return { success: false, error: 'Unable to retrieve traveler history.' };
      }

      if (!traveler) {
        return { success: false, error: 'Traveler not found in current workspace.' };
      }

      const travelerDto: TravelerSummaryDTO = {
        id: traveler.id,
        displayName: traveler.display_name || null,
        preferredLanguage: traveler.preferred_language || null,
        hasEmail: !!traveler.email,
        hasPhone: !!traveler.phone,
        createdAt: traveler.created_at || null,
      };

      // 2. Fetch Inquiries for this traveler
      const { data: inqs, error: inqsErr } = await supabase
        .from('inquiries')
        .select('id, destination, pipeline_stage, expected_value, currency, departure_date, created_at')
        .eq('traveler_id', travelerId)
        .eq('tenant_id', context.tenantId)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(10);

      if (inqsErr) {
        console.error('[Copilot Tool Internal Error] getTravelerHistory inquiries query:', inqsErr.message);
      }

      const inquiryItems = (inqs || []).map((i) => ({
        id: i.id,
        destination: i.destination || null,
        stage: i.pipeline_stage || null,
        expectedOpportunityValue: i.expected_value !== null && i.expected_value !== undefined
          ? `${i.currency || 'INR'} ${i.expected_value}`
          : 'Not specified',
        departureDate: i.departure_date || null,
        createdAt: i.created_at || null,
      }));

      // 3. Fetch Bookings for this traveler
      const { data: bookings, error: bkErr } = await supabase
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
          financial_data_complete
        `)
        .eq('traveler_id', travelerId)
        .eq('tenant_id', context.tenantId)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(10);

      if (bkErr) {
        console.error('[Copilot Tool Internal Error] getTravelerHistory bookings query:', bkErr.message);
      }

      const bookingItems = (bookings || []).map((b) => ({
        id: b.id,
        bookingReference: b.booking_reference || null,
        bookingStatus: b.booking_status || null,
        paymentStatus: b.payment_status || null,
        departureDate: b.departure_date || null,
        returnDate: b.return_date || null,
        passengerCount: b.passenger_count !== null && b.passenger_count !== undefined ? Number(b.passenger_count) : null,
        totalAmount: b.total_amount !== null && b.total_amount !== undefined ? Number(b.total_amount) : null,
        paidAmount: b.paid_amount !== null && b.paid_amount !== undefined ? Number(b.paid_amount) : null,
        balanceDue: b.balance_due !== null && b.balance_due !== undefined ? Number(b.balance_due) : null,
        financialDataComplete: Boolean(b.financial_data_complete),
      }));

      // Successful booking statuses: confirmed, in_progress, completed
      const successfulCount = bookingItems.filter(
        (b) => b.bookingStatus && SUCCESSFUL_BOOKING_STATUSES.has(b.bookingStatus.toLowerCase())
      ).length;

      const historyDto: TravelerHistoryDTO = {
        traveler: travelerDto,
        inquiries: inquiryItems,
        bookings: bookingItems,
        summary: {
          totalInquiriesCount: inquiryItems.length,
          totalBookingsCount: bookingItems.length,
          successfulBookingsCount: successfulCount,
          hasPriorBookings: successfulCount > 0,
        },
      };

      return { success: true, data: historyDto };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[Copilot Tool Internal Exception] getTravelerHistory:', msg);
      return { success: false, error: 'Unable to retrieve traveler history.' };
    }
  },
};
