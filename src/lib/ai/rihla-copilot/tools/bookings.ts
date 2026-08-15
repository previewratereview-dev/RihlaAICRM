/**
 * CRM Copilot Booking Read Tools (Phase AI-2)
 * 
 * Bounded booking lookup strictly scoped by server tenant context.
 * Strictly preserves null vs 0 financial truth and avoids calling booking totals platform revenue.
 * Sanitizes all error messages to prevent database/SQL leakage.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type TrustedExecutionContext,
  type ToolResult,
  type ToolDefinition,
  GetBookingDetailsSchema,
} from './types';
import type { BookingSummaryDTO } from '../crm-context-resolver';

export const getBookingDetailsTool: ToolDefinition<typeof GetBookingDetailsSchema, BookingSummaryDTO> = {
  name: 'getBookingDetails',
  description: 'Retrieve details for a specific booking by booking ID or booking reference code in the current agency.',
  parameters: GetBookingDetailsSchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<BookingSummaryDTO>> => {
    try {
      const { bookingId, bookingReference } = params;
      if (!bookingId && !bookingReference) {
        return { success: false, error: 'Must provide either bookingId or bookingReference.' };
      }

      let query = supabase
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
        .eq('tenant_id', context.tenantId)
        .is('archived_at', null);

      if (bookingId) {
        query = query.eq('id', bookingId.trim());
      } else if (bookingReference) {
        query = query.eq('booking_reference', bookingReference.trim());
      }

      const { data: booking, error } = await query.maybeSingle();

      if (error) {
        console.error('[Copilot Tool Internal Error] getBookingDetails:', error.message);
        return { success: false, error: 'Unable to retrieve booking details.' };
      }

      if (!booking) {
        return { success: false, error: 'Booking not found in current workspace.' };
      }

      const dto: BookingSummaryDTO = {
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
      };

      return { success: true, data: dto };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[Copilot Tool Internal Exception] getBookingDetails:', msg);
      return { success: false, error: 'Unable to retrieve booking details.' };
    }
  },
};
