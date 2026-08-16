import { describe, it, expect } from 'vitest';
import {
  generateShareToken,
  hashShareToken,
  shapeCustomerItineraryDTO,
  shapeCustomerQuoteDTO,
  DEFAULT_SHARE_EXPIRY_DAYS,
  getDefaultShareExpiry,
  validateShareExpiry,
  getCanonicalAppUrl,
  buildShareUrl,
  issueItineraryShare,
  issueQuoteShare,
} from '../lib/quotes-itineraries/sharing';
import type { CustomerItineraryDTO, CustomerQuoteDTO } from '../lib/quotes-itineraries/types';

/**
 * Phase AI-5B.3: Sharing Service & Customer DTO Leakage Protection Tests
 *
 * Validates:
 * 1. Cryptographic token generation (256-bit, uniqueness)
 * 2. SHA-256 hashing determinism
 * 3. CustomerItineraryDTO recursive internal-data stripping
 * 4. CustomerQuoteDTO recursive internal-data stripping
 * 5. Edge cases (empty data, malformed inputs)
 */
describe('Phase AI-5B.3: Sharing Service & Customer DTO Leakage Protection', () => {
  // ==========================================================================
  // CRYPTOGRAPHIC TOKEN GENERATION
  // ==========================================================================
  describe('Token Generation & Hashing', () => {
    it('generates 64-character hex token (256-bit)', () => {
      const token = generateShareToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(token.length).toBe(64);
    });

    it('generates unique tokens on successive calls', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateShareToken());
      }
      expect(tokens.size).toBe(100);
    });

    it('produces deterministic SHA-256 hash', () => {
      const token = 'a'.repeat(64);
      const hash1 = hashShareToken(token);
      const hash2 = hashShareToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different hashes for different tokens', () => {
      const hash1 = hashShareToken('a'.repeat(64));
      const hash2 = hashShareToken('b'.repeat(64));
      expect(hash1).not.toBe(hash2);
    });

    it('token and hash are never the same value', () => {
      const token = generateShareToken();
      const hash = hashShareToken(token);
      expect(token).not.toBe(hash);
    });
  });

  // ==========================================================================
  // CUSTOMER ITINERARY DTO — RECURSIVE INTERNAL DATA STRIPPING
  // ==========================================================================
  describe('CustomerItineraryDTO Leakage Protection', () => {
    it('strips supplierName and internalNotes from items', () => {
      const dto: CustomerItineraryDTO = shapeCustomerItineraryDTO({
        title: 'Dubai Trip',
        destination_summary: 'UAE',
        start_date: '2026-03-01',
        end_date: '2026-03-05',
        duration_days: 5,
        passenger_count: 2,
        days: [
          {
            dayNumber: 1,
            date: '2026-03-01',
            title: 'Arrival',
            summary: 'Welcome day',
            items: [
              {
                itemType: 'transfer',
                title: 'Airport Pickup',
                description: 'From DXB',
                location: 'Dubai Airport',
                startTime: '14:00',
                endTime: '15:00',
                supplierName: 'SECRET_SUPPLIER_NAME',
                internalNotes: 'TOP_SECRET_INTERNAL_NOTE',
              },
            ],
          },
        ],
        inclusions: ['Breakfast'],
        exclusions: ['Lunch'],
      });

      // Verify basic fields present
      expect(dto.title).toBe('Dubai Trip');
      expect(dto.destinationSummary).toBe('UAE');
      expect(dto.days).toHaveLength(1);
      expect(dto.days[0].items).toHaveLength(1);

      // Verify customer-safe fields ARE present
      const item = dto.days[0].items[0];
      expect(item.itemType).toBe('transfer');
      expect(item.title).toBe('Airport Pickup');
      expect(item.description).toBe('From DXB');
      expect(item.location).toBe('Dubai Airport');
      expect(item.startTime).toBe('14:00');
      expect(item.endTime).toBe('15:00');

      // CRITICAL: Verify internal fields are STRIPPED
      const itemAsAny = item as Record<string, unknown>;
      expect(itemAsAny.supplierName).toBeUndefined();
      expect(itemAsAny.internalNotes).toBeUndefined();
      expect(itemAsAny.supplier_name).toBeUndefined();
      expect(itemAsAny.internal_notes).toBeUndefined();
    });

    it('handles snake_case DB fields correctly', () => {
      const dto = shapeCustomerItineraryDTO({
        title: 'Test',
        destination_summary: null,
        start_date: null,
        end_date: null,
        duration_days: null,
        passenger_count: null,
        days: [
          {
            day_number: 1,
            title: 'Day One',
            items: [
              { item_type: 'activity', title: 'Tour', start_time: '09:00', end_time: '12:00' },
            ],
          },
        ],
        inclusions: [],
        exclusions: [],
      });

      expect(dto.days[0].dayNumber).toBe(1);
      expect(dto.days[0].items[0].itemType).toBe('activity');
      expect(dto.days[0].items[0].startTime).toBe('09:00');
    });

    it('handles empty days array', () => {
      const dto = shapeCustomerItineraryDTO({
        title: 'Empty',
        destination_summary: null,
        start_date: null,
        end_date: null,
        duration_days: null,
        passenger_count: null,
        days: [],
        inclusions: [],
        exclusions: [],
      });
      expect(dto.days).toHaveLength(0);
    });

    it('handles null/undefined days gracefully', () => {
      const dto = shapeCustomerItineraryDTO({
        title: 'Null Days',
        destination_summary: null,
        start_date: null,
        end_date: null,
        duration_days: null,
        passenger_count: null,
        days: null as unknown,
        inclusions: null as unknown,
        exclusions: null as unknown,
      });
      expect(dto.days).toHaveLength(0);
      expect(dto.inclusions).toHaveLength(0);
      expect(dto.exclusions).toHaveLength(0);
    });

    it('full JSON serialization contains zero internal fields', () => {
      const dto = shapeCustomerItineraryDTO({
        title: 'Full Leak Check',
        destination_summary: null,
        start_date: null,
        end_date: null,
        duration_days: null,
        passenger_count: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day',
            items: [
              {
                itemType: 'hotel',
                title: 'Stay',
                supplierName: 'LEAKED_SUPPLIER',
                internalNotes: 'LEAKED_NOTE',
                supplier_name: 'LEAKED_SUPPLIER_SNAKE',
                internal_notes: 'LEAKED_NOTE_SNAKE',
              },
            ],
          },
        ],
        inclusions: [],
        exclusions: [],
      });

      const json = JSON.stringify(dto);
      expect(json).not.toContain('LEAKED_SUPPLIER');
      expect(json).not.toContain('LEAKED_NOTE');
      expect(json).not.toContain('supplierName');
      expect(json).not.toContain('internalNotes');
      expect(json).not.toContain('supplier_name');
      expect(json).not.toContain('internal_notes');
    });
  });

  // ==========================================================================
  // CUSTOMER QUOTE DTO — RECURSIVE INTERNAL DATA STRIPPING
  // ==========================================================================
  describe('CustomerQuoteDTO Leakage Protection', () => {
    it('strips supplier costs, margins, and markups from line items', () => {
      const dto: CustomerQuoteDTO = shapeCustomerQuoteDTO({
        quote_number: 'QT-2026-0001',
        version_number: 1,
        currency: 'INR',
        line_items: [
          {
            id: 'item-1',
            title: 'Desert Safari',
            description: 'Evening safari',
            category: 'activity',
            quantity: 2,
            unitPrice: '15000.00',
            totalPrice: '30000.00',
            supplierCost: '10000.00',
            supplierName: 'SECRET_TOUR_OPERATOR',
            markupAmount: '5000.00',
            marginAmount: '5000.00',
            marginPct: 33.33,
            markupPct: 50,
          },
        ],
        subtotal: '30000.00',
        discount_amount: '0.00',
        tax_amount: '0.00',
        grand_total: '30000.00',
        valid_until: '2026-12-31',
        terms_and_conditions: 'Non-refundable',
        customer_notes: 'Enjoy!',
        is_acceptable: true,
        itinerary: {
          title: 'Dubai',
          destination_summary: 'UAE',
          start_date: null,
          end_date: null,
          duration_days: null,
          passenger_count: null,
          days: [],
          inclusions: [],
          exclusions: [],
        },
      });

      // Verify customer-visible fields ARE present
      const item = dto.lineItems[0];
      expect(item.title).toBe('Desert Safari');
      expect(item.description).toBe('Evening safari');
      expect(item.category).toBe('activity');
      expect(item.quantity).toBe(2);
      expect(item.unitPrice).toBe('15000.00');
      expect(item.totalPrice).toBe('30000.00');

      // CRITICAL: Verify internal pricing is STRIPPED
      const itemAsAny = item as Record<string, unknown>;
      expect(itemAsAny.supplierCost).toBeUndefined();
      expect(itemAsAny.supplierName).toBeUndefined();
      expect(itemAsAny.markupAmount).toBeUndefined();
      expect(itemAsAny.marginAmount).toBeUndefined();
      expect(itemAsAny.marginPct).toBeUndefined();
      expect(itemAsAny.markupPct).toBeUndefined();
      expect(itemAsAny.id).toBeUndefined();

      // Verify top-level fields
      expect(dto.quoteNumber).toBe('QT-2026-0001');
      expect(dto.grandTotal).toBe('30000.00');
      expect(dto.isAcceptable).toBe(true);
      expect(dto.itinerary.title).toBe('Dubai');
    });

    it('strips internal pricing in snake_case format too', () => {
      const dto = shapeCustomerQuoteDTO({
        quote_number: 'QT-2026-0002',
        version_number: 1,
        currency: 'INR',
        line_items: [
          {
            title: 'Hotel',
            category: 'accommodation',
            quantity: 3,
            unit_price: '8000.00',
            total_price: '24000.00',
            supplier_cost: '5000.00',
            supplier_name: 'LEAKED_HOTEL_CHAIN',
            markup_amount: '3000.00',
            margin_amount: '3000.00',
          },
        ],
        subtotal: '24000.00',
        discount_amount: '0.00',
        tax_amount: '0.00',
        grand_total: '24000.00',
        is_acceptable: false,
        itinerary: null,
      });

      const item = dto.lineItems[0];
      expect(item.unitPrice).toBe('8000.00');
      expect(item.totalPrice).toBe('24000.00');

      // Verify ALL internal fields stripped in serialized output
      const json = JSON.stringify(dto);
      expect(json).not.toContain('LEAKED_HOTEL_CHAIN');
      expect(json).not.toContain('supplier_cost');
      expect(json).not.toContain('supplierCost');
      expect(json).not.toContain('supplier_name');
      expect(json).not.toContain('supplierName');
      expect(json).not.toContain('markup_amount');
      expect(json).not.toContain('markupAmount');
      expect(json).not.toContain('margin_amount');
      expect(json).not.toContain('marginAmount');
    });

    it('does NOT leak internal_cost_total or gross_margin_amount', () => {
      const rawData = {
        quote_number: 'QT-2026-0003',
        version_number: 1,
        currency: 'INR',
        line_items: [{ title: 'Test', category: 'other', quantity: 1, unitPrice: '100.00', totalPrice: '100.00' }],
        subtotal: '100.00',
        discount_amount: '0.00',
        tax_amount: '0.00',
        grand_total: '100.00',
        internal_cost_total: '50.00',
        gross_margin_amount: '50.00',
        is_acceptable: true,
        itinerary: null,
      };

      // The DTO shaper ignores these fields entirely
      const dto = shapeCustomerQuoteDTO(rawData as Parameters<typeof shapeCustomerQuoteDTO>[0]);
      const json = JSON.stringify(dto);
      expect(json).not.toContain('internal_cost_total');
      expect(json).not.toContain('internalCostTotal');
      expect(json).not.toContain('gross_margin_amount');
      expect(json).not.toContain('grossMarginAmount');
    });

    it('provides default itinerary when itinerary data is null', () => {
      const dto = shapeCustomerQuoteDTO({
        quote_number: 'QT-2026-0004',
        version_number: 1,
        currency: 'INR',
        line_items: [],
        subtotal: '0.00',
        discount_amount: '0.00',
        tax_amount: '0.00',
        grand_total: '0.00',
        is_acceptable: false,
        itinerary: null,
      });

      expect(dto.itinerary).toBeDefined();
      expect(dto.itinerary.title).toBe('');
      expect(dto.itinerary.days).toHaveLength(0);
    });

    it('recursively strips itinerary internal data within quote', () => {
      const dto = shapeCustomerQuoteDTO({
        quote_number: 'QT-2026-0005',
        version_number: 1,
        currency: 'INR',
        line_items: [],
        subtotal: '0.00',
        discount_amount: '0.00',
        tax_amount: '0.00',
        grand_total: '0.00',
        is_acceptable: true,
        itinerary: {
          title: 'Trip',
          destination_summary: null,
          start_date: null,
          end_date: null,
          duration_days: null,
          passenger_count: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day',
              items: [
                {
                  itemType: 'transfer',
                  title: 'Ride',
                  supplierName: 'NESTED_LEAKED_SUPPLIER',
                  internalNotes: 'NESTED_LEAKED_NOTE',
                },
              ],
            },
          ],
          inclusions: [],
          exclusions: [],
        },
      });

      const json = JSON.stringify(dto);
      expect(json).not.toContain('NESTED_LEAKED_SUPPLIER');
      expect(json).not.toContain('NESTED_LEAKED_NOTE');
      expect(json).not.toContain('supplierName');
      expect(json).not.toContain('internalNotes');
    });
  });

  // ==========================================================================
  // EXPIRY & CANONICAL URL BUILDER TESTS
  // ==========================================================================
  describe('Share Expiry & Canonical URL Helpers', () => {
    it('DEFAULT_SHARE_EXPIRY_DAYS is 30 days', () => {
      expect(DEFAULT_SHARE_EXPIRY_DAYS).toBe(30);
    });

    it('getDefaultShareExpiry produces a date ~30 days in future', () => {
      const now = Date.now();
      const expiry = getDefaultShareExpiry();
      const diffDays = (expiry.getTime() - now) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(29.9);
      expect(diffDays).toBeLessThanOrEqual(30.1);
    });

    it('validateShareExpiry accepts valid future Date', () => {
      const future = new Date(Date.now() + 86400_000);
      expect(validateShareExpiry(future)).toBe(future);
    });

    it('validateShareExpiry rejects past Date', () => {
      const past = new Date(Date.now() - 86400_000);
      expect(() => validateShareExpiry(past)).toThrow(/VALIDATION_ERROR.*future/);
    });

    it('validateShareExpiry rejects invalid Date', () => {
      expect(() => validateShareExpiry(new Date('invalid-date'))).toThrow(/VALIDATION_ERROR.*valid Date/);
    });

    it('getCanonicalAppUrl returns non-empty origin without trailing slash', () => {
      const url = getCanonicalAppUrl();
      expect(url).toBeDefined();
      expect(url).toMatch(/^https?:\/\//);
      expect(url.endsWith('/')).toBe(false);
    });

    it('buildShareUrl generates canonical capability URL', () => {
      const token = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const itinUrl = buildShareUrl('itinerary', token);
      expect(itinUrl).toContain(`/p/itinerary/${token}`);

      const quoteUrl = buildShareUrl('quote', token);
      expect(quoteUrl).toContain(`/p/quote/${token}`);
    });
  });

  // ==========================================================================
  // SERVICE LAYER ISSUANCE & MULTIPLE SHARE SEMANTICS
  // ==========================================================================
  describe('Service Layer Issuance & Multi-Share Semantics', () => {
    it('issueItineraryShare defaults to 30-day expiry when custom expiry omitted', async () => {
      const mockQuery = async (_sql: string, params: unknown[]) => {
        const expiresAtParam = params[4] as string;
        const diffDays = (new Date(expiresAtParam).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeGreaterThan(29.9);
        return { rows: [{ result: { share_id: 'mock-share-1' } }] };
      };

      const res = await issueItineraryShare(
        { query: mockQuery },
        'tenant-1',
        'user-1',
        'ver-1'
      );

      expect(res.shareId).toBe('mock-share-1');
      expect(res.rawToken).toMatch(/^[a-f0-9]{64}$/);
      expect(res.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(res.shareUrl).toContain(`/p/itinerary/${res.rawToken}`);
    });

    it('multiple share issuance produces distinct capabilities with independent tokens', async () => {
      let callCount = 0;
      const mockQuery = async () => {
        callCount++;
        return { rows: [{ result: { share_id: `mock-share-${callCount}` } }] };
      };

      const share1 = await issueQuoteShare(
        { query: mockQuery },
        'tenant-1',
        'user-1',
        'quote-ver-1'
      );

      const share2 = await issueQuoteShare(
        { query: mockQuery },
        'tenant-1',
        'user-1',
        'quote-ver-1'
      );

      expect(share1.shareId).toBe('mock-share-1');
      expect(share2.shareId).toBe('mock-share-2');
      expect(share1.rawToken).not.toBe(share2.rawToken);
      expect(share1.tokenHash).not.toBe(share2.tokenHash);
      expect(share1.shareUrl).not.toBe(share2.shareUrl);
    });
  });
});
