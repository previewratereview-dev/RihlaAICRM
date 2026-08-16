import { describe, it, expect } from 'vitest';
import {
  ItineraryItemSchema,
  ItineraryDaySchema,
  ItineraryDaysArraySchema,
  QuoteLineItemInputSchema,
  QuoteLineItemsInputArraySchema,
  QuoteAcceptanceSubmissionSchema,
  DecimalStringSchema,
} from '@/lib/quotes-itineraries/schemas';

describe('AI-5B.1 Zod Schemas & Domain Structural Validation', () => {
  describe('DecimalStringSchema', () => {
    it('accepts valid decimal currency strings', () => {
      expect(DecimalStringSchema.safeParse('150000.00').success).toBe(true);
      expect(DecimalStringSchema.safeParse('0.00').success).toBe(true);
      expect(DecimalStringSchema.safeParse('250.5').success).toBe(true);
      expect(DecimalStringSchema.safeParse('100').success).toBe(true);
    });

    it('rejects negative or malformed money strings', () => {
      expect(DecimalStringSchema.safeParse('-150.00').success).toBe(false);
      expect(DecimalStringSchema.safeParse('abc').success).toBe(false);
      expect(DecimalStringSchema.safeParse('150.000').success).toBe(false);
      expect(DecimalStringSchema.safeParse('$150.00').success).toBe(false);
      expect(DecimalStringSchema.safeParse('').success).toBe(false);
    });
  });

  describe('ItineraryItemSchema', () => {
    it('accepts valid activity item', () => {
      const result = ItineraryItemSchema.safeParse({
        itemType: 'activity',
        title: 'Burj Khalifa Observation Deck',
        description: 'Level 124 + 125 prime hours',
        location: 'Downtown Dubai',
        startTime: '16:00',
        endTime: '18:00',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBeDefined();
      }
    });

    it('rejects invalid itemType', () => {
      const result = ItineraryItemSchema.safeParse({
        itemType: 'invalid_type',
        title: 'Unknown activity',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty title', () => {
      const result = ItineraryItemSchema.safeParse({
        itemType: 'flight',
        title: '   ',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ItineraryDaySchema', () => {
    it('accepts valid itinerary day with items', () => {
      const result = ItineraryDaySchema.safeParse({
        dayNumber: 1,
        date: '2026-10-01',
        title: 'Arrival & Welcome Dinner',
        summary: 'Private transfer from airport followed by dinner.',
        items: [
          {
            itemType: 'transfer',
            title: 'Airport Transfer',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects negative or zero dayNumber', () => {
      expect(
        ItineraryDaySchema.safeParse({
          dayNumber: 0,
          title: 'Day 0',
          items: [],
        }).success
      ).toBe(false);
    });
  });

  describe('ItineraryDaysArraySchema', () => {
    it('accepts sequential days starting from 1', () => {
      const days = [
        {
          dayNumber: 1,
          date: '2026-10-01',
          title: 'Arrival & Check-in',
          items: [
            {
              itemType: 'transfer' as const,
              title: 'Airport Transfer to Hotel',
            },
          ],
        },
        {
          dayNumber: 2,
          date: '2026-10-02',
          title: 'City Exploration',
          items: [
            {
              itemType: 'activity' as const,
              title: 'Historical Old Town Tour',
            },
          ],
        },
      ];
      const result = ItineraryDaysArraySchema.safeParse(days);
      expect(result.success).toBe(true);
    });

    it('rejects non-sequential or out-of-order day numbers', () => {
      const days = [
        {
          dayNumber: 1,
          title: 'Day 1',
          items: [],
        },
        {
          dayNumber: 3, // gap!
          title: 'Day 3',
          items: [],
        },
      ];
      const result = ItineraryDaysArraySchema.safeParse(days);
      expect(result.success).toBe(false);
    });

    it('rejects malformed date format', () => {
      const days = [
        {
          dayNumber: 1,
          date: '01/10/2026', // wrong format
          title: 'Day 1',
          items: [],
        },
      ];
      const result = ItineraryDaysArraySchema.safeParse(days);
      expect(result.success).toBe(false);
    });
  });

  describe('QuoteLineItemInputSchema & Array', () => {
    it('accepts valid line item input with positive integer quantity and decimal string prices', () => {
      const result = QuoteLineItemInputSchema.safeParse({
        title: '5-Star Hotel (4 Nights)',
        category: 'accommodation',
        quantity: 2,
        unitPrice: '45000.00',
        supplierCost: '35000.00',
        supplierName: 'Direct Contract',
      });
      expect(result.success).toBe(true);
    });

    it('rejects zero or negative quantity', () => {
      expect(
        QuoteLineItemInputSchema.safeParse({
          title: 'Transfer',
          category: 'transfer',
          quantity: 0,
          unitPrice: '5000.00',
        }).success
      ).toBe(false);

      expect(
        QuoteLineItemInputSchema.safeParse({
          title: 'Transfer',
          category: 'transfer',
          quantity: -1,
          unitPrice: '5000.00',
        }).success
      ).toBe(false);
    });

    it('rejects fractional quantity in P0', () => {
      expect(
        QuoteLineItemInputSchema.safeParse({
          title: 'Guide Hours',
          category: 'activity',
          quantity: 2.5,
          unitPrice: '2000.00',
        }).success
      ).toBe(false);
    });

    it('rejects invalid category', () => {
      expect(
        QuoteLineItemInputSchema.safeParse({
          title: 'Flight',
          category: 'unknown_category',
          quantity: 1,
          unitPrice: '10000.00',
        }).success
      ).toBe(false);
    });

    it('rejects empty line item array', () => {
      expect(QuoteLineItemsInputArraySchema.safeParse([]).success).toBe(false);
    });
  });

  describe('QuoteAcceptanceSubmissionSchema', () => {
    it('accepts valid traveler acceptance submission', () => {
      const result = QuoteAcceptanceSubmissionSchema.safeParse({
        travelerName: 'Sarah Jenkins',
        travelerEmail: 'sarah.jenkins@example.com',
        acceptanceType: 'traveler_portal',
        acceptedGrandTotal: '175000.00',
        currency: 'INR',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email address', () => {
      const result = QuoteAcceptanceSubmissionSchema.safeParse({
        travelerName: 'Sarah Jenkins',
        travelerEmail: 'not-an-email',
        acceptanceType: 'traveler_portal',
        acceptedGrandTotal: '175000.00',
        currency: 'INR',
      });
      expect(result.success).toBe(false);
    });

    it('rejects unauthorized acceptance type', () => {
      const result = QuoteAcceptanceSubmissionSchema.safeParse({
        travelerName: 'Sarah Jenkins',
        travelerEmail: 'sarah@example.com',
        acceptanceType: 'automated_bot',
        acceptedGrandTotal: '175000.00',
        currency: 'INR',
      });
      expect(result.success).toBe(false);
    });
  });
});
