import { describe, it, expect } from 'vitest';
import {
  canonicalizeJson,
  hashCanonicalSnapshot,
  createAcceptanceSnapshot,
  recordPortalQuoteAcceptance,
  recordStaffQuoteAcceptance,
  voidQuoteAcceptance,
  AcceptanceSnapshot,
} from '../lib/quotes-itineraries/acceptance';
import { convertAcceptedQuoteToBooking } from '../lib/quotes-itineraries/conversion';
import { can } from '../lib/permissions';

describe('Phase AI-5B.4 Commercial Acceptance Unit Tests', () => {
  // ==========================================================================
  // 1. CANONICAL JSON SERIALIZATION & DETERMINISTIC HASHING
  // ==========================================================================
  describe('Canonical JSON Serialization & SHA-256 Hashing', () => {
    it('produces identical output for objects with different key insertion orders', () => {
      const objA = { b: 2, a: 1, c: { z: 26, y: 25 } };
      const objB = { a: 1, c: { y: 25, z: 26 }, b: 2 };

      const canonA = canonicalizeJson(objA);
      const canonB = canonicalizeJson(objB);

      expect(canonA).toBe(canonB);
      expect(canonA).toBe('{"a":1,"b":2,"c":{"y":25,"z":26}}');
    });

    it('handles arrays, primitives, and nulls correctly', () => {
      expect(canonicalizeJson(null)).toBe('null');
      expect(canonicalizeJson(123)).toBe('123');
      expect(canonicalizeJson('hello')).toBe('"hello"');
      expect(canonicalizeJson([3, 1, 2])).toBe('[3,1,2]');
      expect(canonicalizeJson([{ b: 2, a: 1 }, { d: 4, c: 3 }])).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
    });

    it('computes 64-char lowercase hex SHA-256 hash', () => {
      const snapshot: AcceptanceSnapshot = {
        snapshotSchemaVersion: 1,
        quote: {
          quoteNumber: 'QT-2026-0001',
          versionNumber: 1,
          currency: 'INR',
          lineItems: [
            {
              title: 'Luxury Villa',
              description: '3 nights stay',
              category: 'accommodation',
              quantity: 1,
              unitPrice: '50000.00',
              totalPrice: '50000.00',
            },
          ],
          subtotal: '50000.00',
          discountAmount: '0.00',
          taxAmount: '2500.00',
          grandTotal: '52500.00',
          validUntil: '2026-12-31',
          termsAndConditions: 'Standard terms',
          customerNotes: 'Welcome',
        },
        itinerary: {
          title: 'Goa Holiday',
          destinationSummary: 'Goa',
          startDate: '2026-11-01',
          endDate: '2026-11-04',
          durationDays: 4,
          passengerCount: 2,
          days: [
            {
              dayNumber: 1,
              date: '2026-11-01',
              title: 'Arrival',
              summary: 'Airport pickup',
              items: [
                {
                  itemType: 'transfer',
                  title: 'Private Taxi',
                  description: 'To resort',
                  location: 'GOI Airport',
                  startTime: '10:00',
                  endTime: '11:00',
                },
              ],
            },
          ],
          inclusions: ['Breakfast'],
          exclusions: ['Flights'],
        },
      };

      const hash1 = hashCanonicalSnapshot(snapshot);
      const hash2 = hashCanonicalSnapshot(JSON.parse(JSON.stringify(snapshot)));

      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash1).toBe(hash2);

      // Mutating one character changes hash
      const snapshotMutated = JSON.parse(JSON.stringify(snapshot));
      snapshotMutated.quote.customerNotes = 'Welcome!';
      const hashMutated = hashCanonicalSnapshot(snapshotMutated);
      expect(hashMutated).not.toBe(hash1);
    });
  });

  // ==========================================================================
  // 2. ACCEPTANCE SNAPSHOT SANITIZATION & SENTINEL LEAKAGE TESTS
  // ==========================================================================
  describe('Dedicated AcceptanceSnapshot Contract', () => {
    it('creates AcceptanceSnapshot strictly excluding internal secrets, margins, and transient portal state', () => {
      const rawQuote = {
        quoteNumber: 'QT-2026-0042',
        versionNumber: 2,
        currency: 'USD',
        lineItems: [
          {
            title: 'Safari Drive',
            description: 'Private 4x4',
            category: 'activity',
            quantity: 2,
            unitPrice: '300.00',
            totalPrice: '600.00',
            supplierCost: '150.00',
            supplier_cost: '150.00',
            supplierName: 'SECRET_SUPPLIER_CO',
            supplier_name: 'SECRET_SUPPLIER_CO',
            markupAmount: '150.00',
            marginPct: '50.00',
            internalNotes: 'SECRET_INTERNAL_NOTE',
          },
        ],
        subtotal: '600.00',
        discountAmount: '50.00',
        taxAmount: '30.00',
        grandTotal: '580.00',
        validUntil: '2026-10-15',
        termsAndConditions: 'Strict 48h cancellation',
        customerNotes: 'Please arrive 15m early',
        // Internal/transient fields that must be excluded:
        isAcceptable: true,
        is_acceptable: true,
        internalCostTotal: '300.00',
        internal_cost_total: '300.00',
        grossMarginAmount: '280.00',
        gross_margin_amount: '280.00',
        shareId: 'share-uuid-secret',
        token: 'raw-token-secret-123456789012345678901234567890',
        tokenHash: 'hash-secret',
        expiresAt: '2026-12-31T00:00:00Z',
        revokedAt: null,
        firstViewedAt: '2026-08-01T00:00:00Z',
        lastViewedAt: '2026-08-02T00:00:00Z',
        viewCount: 5,
        itinerary: {
          title: 'Serengeti Migration',
          destinationSummary: 'Tanzania',
          startDate: '2026-09-01',
          endDate: '2026-09-07',
          durationDays: 7,
          passengerCount: 2,
          days: [
            {
              dayNumber: 1,
              title: 'Arrival in Arusha',
              summary: 'Transfer to lodge',
              items: [
                {
                  itemType: 'transfer',
                  title: 'Airport Meet & Greet',
                  description: 'Welcome sign',
                  location: 'JRO',
                  supplierName: 'SECRET_TRANSFER_SUPPLIER',
                  internalNotes: 'DRIVER_PHONE_SECRET',
                },
              ],
            },
          ],
          inclusions: ['All game drives', 'Park fees'],
          exclusions: ['International flights', 'Tips'],
        },
      };

      const snapshot = createAcceptanceSnapshot(rawQuote);

      // Verify snapshot structure
      expect(snapshot.snapshotSchemaVersion).toBe(1);
      expect(snapshot.quote.quoteNumber).toBe('QT-2026-0042');
      expect(snapshot.quote.grandTotal).toBe('580.00');

      // Canonical string and serialized snapshot
      const serialized = JSON.stringify(snapshot);

      // Prove ZERO occurrence of supplier secrets
      expect(serialized).not.toContain('SECRET_SUPPLIER_CO');
      expect(serialized).not.toContain('SECRET_TRANSFER_SUPPLIER');
      expect(serialized).not.toContain('SECRET_INTERNAL_NOTE');
      expect(serialized).not.toContain('DRIVER_PHONE_SECRET');
      expect(serialized).not.toContain('supplierCost');
      expect(serialized).not.toContain('supplier_cost');
      expect(serialized).not.toContain('supplierName');
      expect(serialized).not.toContain('supplier_name');
      expect(serialized).not.toContain('internalCostTotal');
      expect(serialized).not.toContain('grossMarginAmount');
      expect(serialized).not.toContain('markupAmount');
      expect(serialized).not.toContain('marginPct');

      // Prove ZERO occurrence of transient portal / share state
      expect(serialized).not.toContain('isAcceptable');
      expect(serialized).not.toContain('is_acceptable');
      expect(serialized).not.toContain('share-uuid-secret');
      expect(serialized).not.toContain('raw-token-secret');
      expect(serialized).not.toContain('expiresAt');
      expect(serialized).not.toContain('firstViewedAt');
      expect(serialized).not.toContain('lastViewedAt');
      expect(serialized).not.toContain('viewCount');

      const hash = hashCanonicalSnapshot(snapshot);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ==========================================================================
  // 3. INPUT VALIDATION & FAST-FAIL DEFENSES
  // ==========================================================================
  describe('Input Validation & Boundary Defenses', () => {
    const mockQuery = async () => ({ rows: [] });

    it('rejects invalid share token format before database call', async () => {
      await expect(
        recordPortalQuoteAcceptance(
          { query: mockQuery },
          'short-token',
          { travelerName: 'Jane', travelerEmail: 'jane@example.com', confirmed: true },
          '127.0.0.1',
          'Agent'
        )
      ).rejects.toThrow('INVALID_TOKEN: Malformed token');
    });

    it('rejects unconfirmed acceptance attempt', async () => {
      const validToken = 'a'.repeat(43);
      await expect(
        recordPortalQuoteAcceptance(
          { query: mockQuery },
          validToken,
          { travelerName: 'Jane', travelerEmail: 'jane@example.com', confirmed: false },
          '127.0.0.1',
          'Agent'
        )
      ).rejects.toThrow('Explicit commercial confirmation is required');
    });

    it('rejects empty traveler name', async () => {
      const validToken = 'a'.repeat(43);
      await expect(
        recordPortalQuoteAcceptance(
          { query: mockQuery },
          validToken,
          { travelerName: '   ', travelerEmail: 'jane@example.com', confirmed: true },
          '127.0.0.1',
          'Agent'
        )
      ).rejects.toThrow('Traveler name is required');
    });

    it('rejects invalid traveler email format', async () => {
      const validToken = 'a'.repeat(43);
      await expect(
        recordPortalQuoteAcceptance(
          { query: mockQuery },
          validToken,
          { travelerName: 'Jane', travelerEmail: 'not-an-email', confirmed: true },
          '127.0.0.1',
          'Agent'
        )
      ).rejects.toThrow('A valid email address is required');
    });

    it('rejects invalid staff acceptance method', async () => {
      await expect(
        recordStaffQuoteAcceptance(
          { query: mockQuery },
          'tenant-1',
          'user-1',
          'qv-1',
          { method: 'carrier_pigeon' as unknown as 'email' }
        )
      ).rejects.toThrow('Invalid staff acceptance method: carrier_pigeon');
    });

    it('rejects empty void reason', async () => {
      await expect(
        voidQuoteAcceptance(
          { query: mockQuery },
          'tenant-1',
          'user-1',
          'qa-1',
          '   '
        )
      ).rejects.toThrow('void_reason is required and cannot be empty');
    });
  });

  // ==========================================================================
  // 4. PERMISSION MATRIX FOR COMMERCIAL ACCEPTANCE & BOOKING CONVERSION
  // ==========================================================================
  describe('Role-Based Governance Matrix', () => {
    it('verifies quotes:acceptance:record permission', () => {
      expect(can('admin', 'quotes:acceptance:record')).toBe(true);
      expect(can('manager', 'quotes:acceptance:record')).toBe(true);
      expect(can('consultant', 'quotes:acceptance:record')).toBe(true);
      expect(can('specialist', 'quotes:acceptance:record')).toBe(true);
      expect(can('viewer', 'quotes:acceptance:record')).toBe(false);
      expect(can('super_admin', 'quotes:acceptance:record')).toBe(false);
    });

    it('verifies quotes:acceptance:void permission', () => {
      expect(can('admin', 'quotes:acceptance:void')).toBe(true);
      expect(can('manager', 'quotes:acceptance:void')).toBe(true);
      expect(can('consultant', 'quotes:acceptance:void')).toBe(false);
      expect(can('specialist', 'quotes:acceptance:void')).toBe(false);
      expect(can('viewer', 'quotes:acceptance:void')).toBe(false);
      expect(can('super_admin', 'quotes:acceptance:void')).toBe(false);
    });

    it('verifies bookings:convert permission', () => {
      expect(can('admin', 'bookings:convert')).toBe(true);
      expect(can('manager', 'bookings:convert')).toBe(true);
      expect(can('consultant', 'bookings:convert')).toBe(false);
      expect(can('specialist', 'bookings:convert')).toBe(false);
      expect(can('viewer', 'bookings:convert')).toBe(false);
      expect(can('super_admin', 'bookings:convert')).toBe(false);
    });
  });
});
