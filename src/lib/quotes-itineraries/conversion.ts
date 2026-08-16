/**
 * Phase AI-5B.4: Booking Conversion Service
 *
 * Handles:
 * - Governed explicit human-controlled Booking conversion from an active QuoteAcceptance
 * - Atomic transition of Inquiry pipeline stage to 'booking_confirmed'
 * - Financial handoff (paid_amount = NULL, balance_due = NULL, payment_status = 'unknown')
 * - Trip facts handoff from the accepted ItineraryVersion
 *
 * Invariants:
 * - Conversion is EXPLICIT (never automatic on acceptance).
 * - Only admin and manager roles can execute conversion (bookings:convert).
 * - Exactly one Booking EVER per Inquiry.
 * - Same-acceptance conversion is idempotent.
 * - Different-acceptance conversion conflicts (even if previous booking is cancelled).
 */

export interface BookingConversionDeps {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export interface BookingConversionResult {
  bookingId: string;
  bookingReference: string;
  quoteAcceptanceId: string;
  totalAmount: string;
  currency: string;
  bookingStatus: string;
  idempotent: boolean;
}

/**
 * Converts an active QuoteAcceptance into a confirmed Booking.
 * Requires bookings:convert permission (admin or manager only).
 */
export async function convertAcceptedQuoteToBooking(
  deps: BookingConversionDeps,
  tenantId: string,
  actorUserId: string,
  acceptanceId: string,
  assignedAgentId?: string | null
): Promise<BookingConversionResult> {
  const res = await deps.query(
    `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3, $4) as result`,
    [tenantId, actorUserId, acceptanceId, assignedAgentId || null]
  );

  const data = res.rows[0]?.result as Record<string, unknown>;
  return {
    bookingId: String(data.booking_id),
    bookingReference: String(data.booking_reference),
    quoteAcceptanceId: String(data.quote_acceptance_id),
    totalAmount: String(data.total_amount),
    currency: String(data.currency),
    bookingStatus: String(data.booking_status),
    idempotent: Boolean(data.idempotent),
  };
}
