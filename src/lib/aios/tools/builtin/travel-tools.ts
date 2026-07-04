/**
 * StateAI AI Operating System (AIOS) — Built-in Travel CRM Tools
 * 
 * Vertical-specific tools for Travel CRM: flight searching, hotel booking,
 * itinerary modification, and cancellation with full Dry-Run and Undo support.
 */

import { z } from 'zod';
import type { AIOSTool, DryRunResult, ToolResultEnvelope } from '../types';

export const SearchFlightsInputSchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  departureDate: z.string(),
  passengers: z.number().int().positive().default(1),
});

export type SearchFlightsInput = z.infer<typeof SearchFlightsInputSchema>;

export const searchFlightsTool: AIOSTool<SearchFlightsInput, { flights: Array<{ flightNo: string; price: number; airline: string }> }> = {
  id: 'travel.search_flights',
  version: { major: 1, minor: 0, patch: 0, tag: 'latest' },
  name: 'Search Flights',
  description: 'Searches real-time airline inventory for available flights.',
  category: 'travel',
  industry: 'Travel CRM',
  riskLevel: 'low',
  requiredPermissions: ['travel:read'],
  estimatedCost: 0.0005,
  estimatedLatency: 450,
  supportsStreaming: false,
  supportsDryRun: false, // Read-only query tool
  supportsBatch: false,
  supportsUndo: false,
  supportsMCP: true,
  executionMode: 'http',
  inputSchema: SearchFlightsInputSchema,
  outputSchema: z.object({
    flights: z.array(z.object({ flightNo: z.string(), price: z.number(), airline: z.string() })),
  }),

  async execute(input, _context): Promise<ToolResultEnvelope<{ flights: Array<{ flightNo: string; price: number; airline: string }> }>> {
    const mockFlights = [
      { flightNo: 'AI-101', price: 450, airline: 'Air India' },
      { flightNo: 'EK-502', price: 620, airline: 'Emirates' },
    ];
    return {
      success: true,
      data: { flights: mockFlights },
      summary: `Found 2 available flights from ${input.origin} to ${input.destination} on ${input.departureDate}`,
      warnings: [],
      errors: [],
      metrics: { latencyMs: 410, tokensUsed: 80, costUsd: 0.0005 },
      audit: { toolId: 'travel.search_flights', version: '1.0.0', traceId: _context.traceId, timestamp: new Date() },
      nextSuggestions: ['Book preferred flight', 'Check hotel availability in destination'],
    };
  },
};

export const BookHotelInputSchema = z.object({
  hotelId: z.string().min(1),
  guestName: z.string().min(2),
  checkInDate: z.string(),
  checkOutDate: z.string(),
  rooms: z.number().int().positive().default(1),
});

export type BookHotelInput = z.infer<typeof BookHotelInputSchema>;

export const bookHotelTool: AIOSTool<BookHotelInput, { bookingId: string; confirmed: boolean }> = {
  id: 'travel.book_hotel',
  version: { major: 1, minor: 0, patch: 0, tag: 'latest' },
  name: 'Book Hotel Room',
  description: 'Reserves hotel accommodation for a travel CRM client.',
  category: 'travel',
  industry: 'Travel CRM',
  riskLevel: 'medium',
  requiredPermissions: ['travel:write', 'bookings:create'],
  estimatedCost: 0.002,
  estimatedLatency: 600,
  supportsStreaming: false,
  supportsDryRun: true,
  supportsBatch: false,
  supportsUndo: true,
  supportsMCP: true,
  executionMode: 'http',
  inputSchema: BookHotelInputSchema,
  outputSchema: z.object({ bookingId: z.string(), confirmed: z.boolean() }),

  async execute(input, _context): Promise<ToolResultEnvelope<{ bookingId: string; confirmed: boolean }>> {
    const bId = `h_book_${Math.random().toString(36).substring(2, 9)}`;
    return {
      success: true,
      data: { bookingId: bId, confirmed: true },
      summary: `Successfully booked hotel ${input.hotelId} for ${input.guestName} (Booking ID: ${bId})`,
      warnings: [],
      errors: [],
      metrics: { latencyMs: 580, tokensUsed: 120, costUsd: 0.002 },
      audit: { toolId: 'travel.book_hotel', version: '1.0.0', traceId: _context.traceId, timestamp: new Date() },
      nextSuggestions: ['Send confirmation email with voucher', 'Add booking to client calendar'],
    };
  },

  async dryRun(input): Promise<DryRunResult> {
    return {
      recordsModified: 1,
      affectedIds: [`hotel_${input.hotelId}_inventory`],
      validationErrors: [],
      estimatedDurationMs: 600,
      summary: `Will reserve ${input.rooms} room(s) at hotel ${input.hotelId} for ${input.guestName}`,
    };
  },

  async undo(_input, _context, previousResult): Promise<ToolResultEnvelope<any>> {
    const bookingId = previousResult.data?.bookingId || 'unknown';
    return {
      success: true,
      summary: `Undone: Cancelled hotel booking ${bookingId} without penalty`,
      warnings: [],
      errors: [],
      metrics: { latencyMs: 350 },
      audit: { toolId: 'travel.book_hotel', version: '1.0.0', traceId: _context.traceId, timestamp: new Date(), undone: true },
      nextSuggestions: [],
    };
  },
};

export const CancelBookingInputSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(3),
  refundRequested: z.boolean().default(true),
});

export type CancelBookingInput = z.infer<typeof CancelBookingInputSchema>;

export const cancelBookingTool: AIOSTool<CancelBookingInput, { bookingId: string; cancelled: boolean; refundAmountUsd: number }> = {
  id: 'travel.cancel_booking',
  version: { major: 1, minor: 0, patch: 0, tag: 'latest' },
  name: 'Cancel Travel Booking',
  description: 'Cancels a confirmed flight or hotel booking and initiates refund processing.',
  category: 'travel',
  industry: 'Travel CRM',
  riskLevel: 'high',
  requiredPermissions: ['travel:delete', 'bookings:cancel'],
  estimatedCost: 0.005,
  estimatedLatency: 800,
  supportsStreaming: false,
  supportsDryRun: true,
  supportsBatch: false,
  supportsUndo: true,
  supportsMCP: false,
  executionMode: 'http',
  inputSchema: CancelBookingInputSchema,
  outputSchema: z.object({ bookingId: z.string(), cancelled: z.boolean(), refundAmountUsd: z.number() }),

  async execute(input, _context): Promise<ToolResultEnvelope<{ bookingId: string; cancelled: boolean; refundAmountUsd: number }>> {
    return {
      success: true,
      data: { bookingId: input.bookingId, cancelled: true, refundAmountUsd: 450 },
      summary: `Cancelled booking ${input.bookingId}. Refund of $450 initiated.`,
      warnings: ['Cancellation fee of $50 applied according to tariff policy'],
      errors: [],
      metrics: { latencyMs: 750, tokensUsed: 150, costUsd: 0.005 },
      audit: { toolId: 'travel.cancel_booking', version: '1.0.0', traceId: _context.traceId, timestamp: new Date() },
      nextSuggestions: ['Send cancellation credit note to customer'],
    };
  },

  async dryRun(input): Promise<DryRunResult> {
    return {
      recordsModified: 2,
      affectedIds: [input.bookingId, `ledger_${input.bookingId}`],
      validationErrors: [],
      estimatedDurationMs: 800,
      summary: `Will cancel booking ${input.bookingId} and process refund of approx $450 (less $50 fee)`,
    };
  },

  async undo(input, _context): Promise<ToolResultEnvelope<any>> {
    return {
      success: true,
      summary: `Undone: Reinstated booking ${input.bookingId} and halted refund processing`,
      warnings: ['Reinstated subject to airline/hotel inventory verification'],
      errors: [],
      metrics: { latencyMs: 500 },
      audit: { toolId: 'travel.cancel_booking', version: '1.0.0', traceId: _context.traceId, timestamp: new Date(), undone: true },
      nextSuggestions: [],
    };
  },
};
