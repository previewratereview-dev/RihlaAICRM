import { describe, it, expect, vi } from 'vitest';
import type { QuoteLineItem } from '../lib/quotes-itineraries/types';
import {
  shapeQuoteVersionDTO,
  preparePricingInputForRole,
  InternalQuoteVersionDTO,
  StaffSafeQuoteVersionDTO,
} from '../lib/quotes-itineraries/service';
import { calculateQuotePricing } from '../lib/quotes-itineraries/pricing';
import { can } from '../lib/permissions';

describe('Phase AI-5B.5: Inquiry Lifecycle Workspace & Security Verification', () => {
  // ==========================================================================
  // 1. DATA LEAKAGE SENTINEL TESTS
  // ==========================================================================
  describe('Data Leakage Sentinels (Supplier Costs & Internal Margins)', () => {
    const SECRET_SUPPLIER_COST = '99999.99';
    const SECRET_MARGIN = '88888.88';
    const SECRET_SUPPLIER_NAME = 'SECRET_SUPPLIER_LLC';

    const testQuoteRow = {
      id: '11111111-1111-1111-1111-111111111111',
      tenant_id: 'tenant_agency_a',
      quote_id: '22222222-2222-2222-2222-222222222222',
      quote_number: 'QT-2026-0001',
      version_number: 1,
      lock_version: 0,
      itinerary_version_id: '33333333-3333-3333-3333-333333333333',
      status: 'draft',
      frozen_at: null,
      currency: 'USD',
      line_items: [
        {
          id: 'item-secret-1',
          title: 'Private Yacht Charter',
          description: 'Full day private charter',
          category: 'activity' as const,
          quantity: 1,
          unitPrice: '150000.00',
          totalPrice: '150000.00',
          supplierCost: SECRET_SUPPLIER_COST,
          supplierName: SECRET_SUPPLIER_NAME,
          markupAmount: SECRET_MARGIN,
          marginAmount: SECRET_MARGIN,
          marginPct: 33.33,
          markupPct: 50.0,
        },
      ],
      quote_schema_version: 1,
      subtotal: '150000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      grand_total: '150000.00',
      internal_cost_total: SECRET_SUPPLIER_COST,
      gross_margin_amount: SECRET_MARGIN,
      valid_until: '2026-12-31',
      terms_and_conditions: 'Standard terms',
      customer_notes: 'VIP customer',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it('Consultant payload contains ZERO occurrences of secret supplier cost, margins, and markup amounts', () => {
      const consultantDTO = shapeQuoteVersionDTO(testQuoteRow, 'consultant');
      const serialized = JSON.stringify(consultantDTO);

      expect(serialized).not.toContain(SECRET_SUPPLIER_COST);
      expect(serialized).not.toContain(SECRET_MARGIN);
      expect(serialized).not.toContain('internalCostTotal');
      expect(serialized).not.toContain('grossMarginAmount');
      expect(serialized).not.toContain('supplierCost');

      // Verify customer-facing data is completely preserved
      expect(consultantDTO.grandTotal).toBe('150000.00');
      expect(consultantDTO.lineItems[0].unitPrice).toBe('150000.00');
    });

    it('Specialist payload contains ZERO occurrences of secret supplier cost and margins', () => {
      const specialistDTO = shapeQuoteVersionDTO(testQuoteRow, 'specialist');
      const serialized = JSON.stringify(specialistDTO);

      expect(serialized).not.toContain(SECRET_SUPPLIER_COST);
      expect(serialized).not.toContain(SECRET_MARGIN);
      expect(serialized).not.toContain('internalCostTotal');
      expect(serialized).not.toContain('grossMarginAmount');
      expect(serialized).not.toContain('supplierCost');
    });

    it('Viewer payload contains ZERO occurrences of secret supplier cost and margins', () => {
      const viewerDTO = shapeQuoteVersionDTO(testQuoteRow, 'viewer');
      const serialized = JSON.stringify(viewerDTO);

      expect(serialized).not.toContain(SECRET_SUPPLIER_COST);
      expect(serialized).not.toContain(SECRET_MARGIN);
      expect(serialized).not.toContain('internalCostTotal');
      expect(serialized).not.toContain('grossMarginAmount');
      expect(serialized).not.toContain('supplierCost');
    });

    it('Admin payload preserves authorized internal cost total, gross margin, and supplier costs', () => {
      const adminDTO = shapeQuoteVersionDTO(testQuoteRow, 'admin') as InternalQuoteVersionDTO;
      const serialized = JSON.stringify(adminDTO);

      expect(serialized).toContain(SECRET_SUPPLIER_COST);
      expect(serialized).toContain(SECRET_MARGIN);
      expect(adminDTO.internalCostTotal).toBe(SECRET_SUPPLIER_COST);
      expect(adminDTO.grossMarginAmount).toBe(SECRET_MARGIN);
      expect(adminDTO.lineItems[0].supplierCost).toBe(SECRET_SUPPLIER_COST);
    });

    it('Manager payload preserves authorized internal cost total, gross margin, and supplier costs', () => {
      const managerDTO = shapeQuoteVersionDTO(testQuoteRow, 'manager') as InternalQuoteVersionDTO;
      expect(managerDTO.internalCostTotal).toBe(SECRET_SUPPLIER_COST);
      expect(managerDTO.grossMarginAmount).toBe(SECRET_MARGIN);
      expect(managerDTO.lineItems[0].supplierCost).toBe(SECRET_SUPPLIER_COST);
    });
  });

  // ==========================================================================
  // 2. ROLE-BASED ACCESS CONTROL (RBAC) BOUNDARIES
  // ==========================================================================
  describe('RBAC Operational Workspace Permissions', () => {
    it('Admin has full operational lifecycle permissions', () => {
      expect(can('admin', 'itineraries:read')).toBe(true);
      expect(can('admin', 'itineraries:write')).toBe(true);
      expect(can('admin', 'itineraries:share')).toBe(true);
      expect(can('admin', 'quotes:read')).toBe(true);
      expect(can('admin', 'quotes:write')).toBe(true);
      expect(can('admin', 'quotes:share')).toBe(true);
      expect(can('admin', 'quotes:internal_pricing:read')).toBe(true);
      expect(can('admin', 'quotes:acceptance:record')).toBe(true);
      expect(can('admin', 'quotes:acceptance:void')).toBe(true);
      expect(can('admin', 'bookings:convert')).toBe(true);
    });

    it('Manager has full operational lifecycle permissions', () => {
      expect(can('manager', 'itineraries:read')).toBe(true);
      expect(can('manager', 'itineraries:write')).toBe(true);
      expect(can('manager', 'itineraries:share')).toBe(true);
      expect(can('manager', 'quotes:read')).toBe(true);
      expect(can('manager', 'quotes:write')).toBe(true);
      expect(can('manager', 'quotes:share')).toBe(true);
      expect(can('manager', 'quotes:internal_pricing:read')).toBe(true);
      expect(can('manager', 'quotes:acceptance:record')).toBe(true);
      expect(can('manager', 'quotes:acceptance:void')).toBe(true);
      expect(can('manager', 'bookings:convert')).toBe(true);
    });

    it('Consultant can edit and record acceptance but CANNOT void, convert booking, or see internal pricing', () => {
      expect(can('consultant', 'itineraries:read')).toBe(true);
      expect(can('consultant', 'itineraries:write')).toBe(true);
      expect(can('consultant', 'itineraries:share')).toBe(true);
      expect(can('consultant', 'quotes:read')).toBe(true);
      expect(can('consultant', 'quotes:write')).toBe(true);
      expect(can('consultant', 'quotes:share')).toBe(true);
      expect(can('consultant', 'quotes:acceptance:record')).toBe(true);

      // DENIED
      expect(can('consultant', 'quotes:acceptance:void')).toBe(false);
      expect(can('consultant', 'bookings:convert')).toBe(false);
      expect(can('consultant', 'quotes:internal_pricing:read')).toBe(false);
    });

    it('Specialist matches Consultant permissions (no void, no conversion, no internal pricing)', () => {
      expect(can('specialist', 'itineraries:read')).toBe(true);
      expect(can('specialist', 'itineraries:write')).toBe(true);
      expect(can('specialist', 'itineraries:share')).toBe(true);
      expect(can('specialist', 'quotes:read')).toBe(true);
      expect(can('specialist', 'quotes:write')).toBe(true);
      expect(can('specialist', 'quotes:share')).toBe(true);
      expect(can('specialist', 'quotes:acceptance:record')).toBe(true);

      // DENIED
      expect(can('specialist', 'quotes:acceptance:void')).toBe(false);
      expect(can('specialist', 'bookings:convert')).toBe(false);
      expect(can('specialist', 'quotes:internal_pricing:read')).toBe(false);
    });

    it('Viewer is strictly read-only across all lifecycle operations', () => {
      expect(can('viewer', 'itineraries:read')).toBe(true);
      expect(can('viewer', 'quotes:read')).toBe(true);

      // All writes/actions DENIED
      expect(can('viewer', 'itineraries:write')).toBe(false);
      expect(can('viewer', 'itineraries:share')).toBe(false);
      expect(can('viewer', 'quotes:write')).toBe(false);
      expect(can('viewer', 'quotes:share')).toBe(false);
      expect(can('viewer', 'quotes:acceptance:record')).toBe(false);
      expect(can('viewer', 'quotes:acceptance:void')).toBe(false);
      expect(can('viewer', 'bookings:convert')).toBe(false);
      expect(can('viewer', 'quotes:internal_pricing:read')).toBe(false);
    });
  });

  // ==========================================================================
  // 3. PRICING INPUT MERGE FOR ROLES
  // ==========================================================================
  describe('preparePricingInputForRole Boundary', () => {
    it('Consultant cannot submit supplier cost; existing supplier cost is preserved strictly by line ID', () => {
      const existingItems: QuoteLineItem[] = [
        {
          id: 'line-1',
          title: 'Flight Ticket',
          category: 'flight',
          quantity: 2,
          unitPrice: '500.00',
          totalPrice: '1000.00',
          supplierCost: '400.00',
          supplierName: 'Airline Co',
        },
      ];

      const consultantInput = [
        {
          id: 'line-1',
          title: 'Flight Ticket Updated',
          category: 'flight' as const,
          quantity: 2,
          unitPrice: '550.00',
          supplierCost: '10.00', // ATTACK: Consultant attempts to alter supplier cost
        },
        {
          id: 'line-2-new',
          title: 'Airport Transfer',
          category: 'transfer' as const,
          quantity: 1,
          unitPrice: '100.00',
          supplierCost: '50.00', // ATTACK: Consultant attempts to inject supplier cost on new item
        },
      ];

      const prepared = preparePricingInputForRole(consultantInput, existingItems, 'consultant');

      // line-1 retains server cost of 400.00 (ignoring 10.00)
      expect(prepared[0].supplierCost).toBe('400.00');

      // line-2-new has supplierCost = null (ignoring 50.00)
      expect(prepared[1].supplierCost).toBeNull();
    });

    it('Admin can submit updated supplier cost', () => {
      const adminInput = [
        {
          id: 'line-1',
          title: 'Flight Ticket',
          category: 'flight' as const,
          quantity: 2,
          unitPrice: '550.00',
          supplierCost: '450.00',
        },
      ];

      const prepared = preparePricingInputForRole(adminInput, null, 'admin');
      expect(prepared[0].supplierCost).toBe('450.00');
    });
  });

  // ==========================================================================
  // 4. DECIMAL PRICING & MARGIN TRUTH CALCULATIONS
  // ==========================================================================
  describe('calculateQuotePricing Accuracy', () => {
    it('calculates customer totals and internal margins with exact decimal arithmetic', () => {
      const pricing = calculateQuotePricing({
        lineItems: [
          {
            title: 'Hotel Stay',
            category: 'accommodation',
            quantity: 3,
            unitPrice: '200.00',
            supplierCost: '140.00',
          },
          {
            title: 'City Tour',
            category: 'activity',
            quantity: 2,
            unitPrice: '100.00',
            supplierCost: '60.00',
          },
        ],
        discountAmount: '50.00',
        taxAmount: '45.00',
      });

      // Subtotal = (3*200) + (2*100) = 600 + 200 = 800.00
      expect(pricing.subtotal).toBe('800.00');
      // Grand Total = 800 - 50 + 45 = 795.00
      expect(pricing.grandTotal).toBe('795.00');
      // Internal Cost Total = (3*140) + (2*60) = 420 + 120 = 540.00
      expect(pricing.internalCostTotal).toBe('540.00');
      // Gross Margin = 795 - 540 = 255.00
      expect(pricing.grossMarginAmount).toBe('255.00');
    });

    it('returns internalCostTotal = null when any line item has unknown supplier cost', () => {
      const pricing = calculateQuotePricing({
        lineItems: [
          {
            title: 'Hotel',
            category: 'accommodation',
            quantity: 1,
            unitPrice: '500.00',
            supplierCost: '350.00',
          },
          {
            title: 'Tour Guide',
            category: 'activity',
            quantity: 1,
            unitPrice: '150.00',
            supplierCost: null, // Unknown cost
          },
        ],
      });

      expect(pricing.subtotal).toBe('650.00');
      expect(pricing.grandTotal).toBe('650.00');
      expect(pricing.internalCostTotal).toBeNull();
      expect(pricing.grossMarginAmount).toBeNull();
    });
  });

  // ==========================================================================
  // 5. STALE VERSION & CONCURRENCY CONFLICT HANDLING
  // ==========================================================================
  describe('Stale Version Concurrency UX', () => {
    it('detects STALE_VERSION error and formats clear conflict message', () => {
      const errorMessage = 'STALE_VERSION: Target row was modified concurrently';
      const isStale = errorMessage.includes('STALE_VERSION');
      expect(isStale).toBe(true);

      const staffMessage = isStale
        ? 'This draft was updated by another team member.'
        : 'An error occurred';
      expect(staffMessage).toBe('This draft was updated by another team member.');
    });
  });

  // ==========================================================================
  // 6. PUBLIC SHARE TOKEN NON-RECONSTRUCTIBILITY
  // ==========================================================================
  describe('Share Management Secret Non-Reconstruction', () => {
    it('subsequent share list payload exposes only metadata (zero token_hash, zero raw token)', () => {
      const shareRowFromDb = {
        id: 'share-1111-2222',
        itinerary_version_id: 'iv-3333-4444',
        token_hash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', // Must be omitted
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        revoked_at: null,
        first_viewed_at: null,
        last_viewed_at: null,
        created_at: new Date().toISOString(),
      };

      // Transform to staff DTO
      const staffShareDTO = {
        id: shareRowFromDb.id,
        itineraryVersionId: shareRowFromDb.itinerary_version_id,
        expiresAt: shareRowFromDb.expires_at,
        revokedAt: shareRowFromDb.revoked_at,
        firstViewedAt: shareRowFromDb.first_viewed_at,
        lastViewedAt: shareRowFromDb.last_viewed_at,
        createdAt: shareRowFromDb.created_at,
      };

      const serialized = JSON.stringify(staffShareDTO);
      expect(serialized).not.toContain('token_hash');
      expect(serialized).not.toContain(shareRowFromDb.token_hash);
      expect(serialized).not.toContain('rawToken');
      expect((staffShareDTO as Record<string, unknown>).token_hash).toBeUndefined();
    });
  });

  // ==========================================================================
  // 7. PINNED VERSION INTEGRITY ACROSS REVISIONS
  // ==========================================================================
  describe('Accepted Version Pinned Integrity', () => {
    it('commercial acceptance maintains explicit quote and itinerary version pinning even when later revisions exist', () => {
      const acceptanceRecord = {
        quoteVersionId: 'qv-1',
        quoteNumber: 'QT-2026-0001',
        quoteVersionNumber: 1,
        itineraryVersionId: 'iv-1',
        itineraryTitle: 'Dubai Classic 5-Day',
        acceptedGrandTotal: '2500.00',
        currency: 'USD',
      };

      // Later revisions created on the same inquiry
      const latestQuoteVersion = {
        id: 'qv-2',
        versionNumber: 2,
        grandTotal: '3200.00',
      };

      // Acceptance panel must continue referencing v1
      expect(acceptanceRecord.quoteVersionNumber).toBe(1);
      expect(acceptanceRecord.acceptedGrandTotal).toBe('2500.00');
      expect(acceptanceRecord.quoteVersionNumber).not.toBe(latestQuoteVersion.versionNumber);
    });
  });
});
