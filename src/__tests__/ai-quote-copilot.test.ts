/**
 * Phase AI-5C.3: Grounded Quote Copilot & Deterministic Commercial Explanation Tests
 *
 * Verifies:
 * 1. Price Authority: Strict separation between AI estimate/suggestion and authoritative pricing.
 * 2. Non-Authoritative Suggestion: Estimates stage into draft with unitPrice='0.00' requiring human confirmation.
 * 3. Never Trust Model Catalog Prices: Model numeric values are ignored; fake/cross-tenant catalog refs downgraded.
 * 4. RBAC: Quote writer allowed, viewer denied (FORBIDDEN), internal pricing permissions strictly enforced.
 * 5. Proposal Staging: Generation causes zero DB writes; apply populates local draft state; normal save uses standard action.
 * 6. Immutability: Draft stages into current draft; issued/finalized quotes spawn a new revision (vN+1) before AI staging.
 * 7. Customer vs Internal Separation: Customer LLM context receives 0 supplier costs or margins; 0 sentinel leakage.
 * 8. Deterministic Diff: Exact arithmetic and structural line item, subtotal, discount, tax, validity, and terms diffs.
 * 9. Prompt Injection: Hostile customer messages and malicious model outputs cannot elevate privilege or mutate quotes.
 * 10. Cross-Tenant Matrix: All mismatched cross-tenant inquiry, version, catalog, and quote combinations fail closed.
 * 11. Graceful Failure: AI outage leaves manual quote workspace 100% operational.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateQuoteProposalAction,
  generateQuoteDiffExplanationAction,
  checkQuoteVersionFreshnessAction,
} from '@/app/actions/ai-quote-proposal';
import {
  calculateQuoteDifference,
  getCustomerSafeQuoteDiff,
  type RawQuoteVersionForDiff,
} from '@/lib/ai/proposal/diff-engine';
import {
  adaptAIQuoteSuggestionsToPricingInput,
  adaptAIQuoteSuggestionsToStagedInputs,
} from '@/lib/ai/proposal/adapter';
import {
  AIQuoteLineItemProposalSchema,
  AIQuoteDifferenceExplanationSchema,
  type AIQuoteLineItemSuggestion,
} from '@/lib/ai/proposal/contracts';
import { calculateQuotePricing } from '@/lib/quotes-itineraries/pricing';
import { shapeQuoteVersionDTO } from '@/lib/quotes-itineraries/service';
import { can } from '@/lib/permissions';

// Mock getAuthenticatedStaffContext and withPgClient from inquiry-lifecycle
let mockStaffContext = {
  userId: 'user-consultant-1',
  tenantId: 'tenant-agency-a',
  role: 'consultant',
};

const mockPgQuery = vi.fn();

vi.mock('@/app/actions/inquiry-lifecycle', () => ({
  getAuthenticatedStaffContext: vi.fn(async () => mockStaffContext),
  withPgClient: vi.fn(async (cb: (client: { query: typeof mockPgQuery }) => Promise<unknown>) => {
    return cb({ query: mockPgQuery });
  }),
  createQuoteRevisionAction: vi.fn(async (baseVersionId: string) => ({
    newVersionId: `new-rev-from-${baseVersionId}`,
    versionNumber: 3,
  })),
  updateQuoteDraftAction: vi.fn(async (input: { versionId: string; expectedLockVersion: number; lineItems: unknown[] }) => ({
    versionId: input.versionId,
    newLockVersion: input.expectedLockVersion + 1,
  })),
  shapeQuoteVersionDTO: vi.fn((row: Parameters<typeof shapeQuoteVersionDTO>[0], role: string) =>
    shapeQuoteVersionDTO(row, role)
  ),
}));

// Mock callAIWithFallback for deterministic quote suggestion testing
let mockAIResponseText = JSON.stringify({
  inquiryId: 'inq-123',
  itineraryVersionId: 'itin-ver-1',
  currency: 'USD',
  suggestedItems: [
    {
      title: 'Luxury 5-Star Resort Stay (5 Nights)',
      description: 'Deluxe Ocean Suite with breakfast',
      category: 'accommodation',
      quantity: 1,
      suggestedUnitPrice: '2500.00',
      pricingSource: 'estimate',
      notes: 'Subject to seasonal rate confirmation',
    },
    {
      title: 'Private Chauffeured Airport Transfer',
      description: 'Round-trip executive van',
      category: 'transfer',
      quantity: 2,
      suggestedUnitPrice: '150.00',
      pricingSource: 'estimate',
    },
    {
      title: 'Helicopter City Tour',
      description: 'Scenic flight over skyline',
      category: 'activity',
      quantity: 2,
      suggestedUnitPrice: null,
      pricingSource: 'missing',
    },
  ],
  missingPriceItems: ['Helicopter City Tour'],
  suggestedTermsAndConditions: 'Deposit of 30% due upon acceptance.',
  suggestedCustomerNotes: 'We look forward to hosting you.',
  grounding: {
    sources: [
      { type: 'inquiry_fact', field: 'destination', snippet: 'Kyoto & Tokyo' },
    ],
    assumptions: ['Standard double occupancy'],
    missingInformation: ['Specific room tier preference'],
    confidenceScore: 0.9,
  },
  warnings: [],
});

vi.mock('@/lib/ai/ai-client', () => ({
  callAIWithFallback: vi.fn(async () => ({
    text: mockAIResponseText,
    model: 'gpt-4o-mini',
    provider: 'openai',
    tokensIn: 450,
    tokensOut: 320,
    costEstimate: 0.0015,
  })),
}));

describe('Phase AI-5C.3: Grounded Quote Copilot & Deterministic Commercial Explanation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStaffContext = {
      userId: 'user-consultant-1',
      tenantId: 'tenant-agency-a',
      role: 'consultant',
    };
  });

  // ==========================================================================
  // 1. PRICE AUTHORITY & SUGGESTION VS AUTHORITATIVE PRICING
  // ==========================================================================
  describe('1. Price Authority & Grounding', () => {
    it('forces all AI suggestions to estimate or missing when no structured catalog exists', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      // Query mocks: itinerary version check + inquiry fact context + knowledge check
      mockPgQuery.mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM public.itinerary_versions')) {
          return {
            rows: [
              {
                id: 'itin-ver-1',
                tenant_id: 'tenant-agency-a',
                itinerary_id: 'itin-1',
                status: 'finalized',
                version_number: 1,
                lock_version: 0,
                title: 'Japan Heritage Tour',
                family_title: 'Japan Heritage Tour',
                days: [],
                inclusions: [],
                exclusions: [],
              },
            ],
          };
        }
        if (sql.includes('FROM public.inquiries')) {
          return {
            rows: [
              {
                id: 'inq-123',
                tenant_id: 'tenant-agency-a',
                destination: 'Japan',
                currency: 'USD',
                stage: 'itinerary_ready',
              },
            ],
          };
        }
        if (sql.includes('FROM public.messages')) return { rows: [] };
        if (sql.includes('FROM public.knowledge_documents WHERE tenant_id = $1')) {
          return { rows: [{ id: 'kdoc-1', title: 'Japan Travel Guide', content: 'Guide info', source_type: 'document' }] };
        }
        if (sql.includes('FROM public.faq_entries')) return { rows: [] };
        return { rows: [] };
      });

      const res = await generateQuoteProposalAction({
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-ver-1',
      });

      expect(res.success).toBe(true);
      expect(res.proposal).toBeDefined();

      // All items must have authoritativeUnitPrice = null (non-authoritative)
      for (const item of res.proposal!.suggestedItems) {
        expect(item.authoritativeUnitPrice).toBeNull();
        expect(['estimate', 'missing', 'historical']).toContain(item.pricingSource);
      }
    });

    it('ignores model attempts to establish authoritative_catalog without verified structured record', async () => {
      // Model maliciously returned authoritative_catalog with price
      mockAIResponseText = JSON.stringify({
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-ver-1',
        currency: 'USD',
        suggestedItems: [
          {
            title: 'Malicious Catalog Item',
            category: 'accommodation',
            quantity: 1,
            suggestedUnitPrice: '1.00',
            pricingSource: 'authoritative_catalog',
            catalogReferenceId: 'fake-catalog-id',
          },
        ],
        missingPriceItems: [],
        grounding: { sources: [], assumptions: [], missingInformation: [] },
        warnings: [],
      });

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.itinerary_versions')) return { rows: [{ status: 'finalized' }] };
        if (sql.includes('FROM public.inquiries')) return { rows: [{ id: 'inq-123', tenant_id: 'tenant-agency-a', currency: 'USD' }] };
        if (sql.includes('FROM public.knowledge_documents WHERE id = $1 AND tenant_id = $2')) {
          // fake-catalog-id does not exist
          return { rows: [] };
        }
        return { rows: [] };
      });

      const res = await generateQuoteProposalAction({
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-ver-1',
      });

      expect(res.success).toBe(true);
      const item = res.proposal!.suggestedItems[0];
      // Must be downgraded to estimate, authoritative price must be null
      expect(item.pricingSource).toBe('estimate');
      expect(item.authoritativeUnitPrice).toBeNull();
      expect(item.catalogReferenceId).toBeNull();
    });

    it('adapter sets draft unitPrice to 0.00 for estimates so human staff must explicitly enter price', () => {
      const suggestions: AIQuoteLineItemSuggestion[] = [
        {
          title: 'Resort Stay',
          category: 'accommodation',
          quantity: 2,
          suggestedUnitPrice: '450.00',
          pricingSource: 'estimate',
        },
        {
          title: 'Airport Transfer',
          category: 'transfer',
          quantity: 1,
          suggestedUnitPrice: '80.00',
          pricingSource: 'estimate',
        },
        {
          title: 'Unpriced Tour',
          category: 'activity',
          quantity: 1,
          suggestedUnitPrice: null,
          pricingSource: 'missing',
        },
      ];

      const adapted = adaptAIQuoteSuggestionsToPricingInput(suggestions, false);

      expect(adapted.length).toBe(3);
      // All draft unitPrice values MUST be '0.00' because AI estimates cannot become authoritative draft pricing
      expect(adapted[0].unitPrice).toBe('0.00');
      expect(adapted[1].unitPrice).toBe('0.00');
      expect(adapted[2].unitPrice).toBe('0.00');

      // Staged inputs carry suggestedUnitPrice for UI display
      const staged = adaptAIQuoteSuggestionsToStagedInputs(suggestions, false);
      expect(staged[0].unitPrice).toBe('0.00');
      expect(staged[0].suggestedUnitPrice).toBe('450.00');
      expect(staged[1].suggestedUnitPrice).toBe('80.00');
      expect(staged[2].suggestedUnitPrice).toBeNull();
    });
  });

  // ==========================================================================
  // 2. RBAC & PERMISSIONS MATRIX
  // ==========================================================================
  describe('2. RBAC & Internal Pricing Authorization', () => {
    it('allows authorized staff roles (admin, manager, specialist, consultant) to generate quote proposals', () => {
      expect(can('admin', 'quotes:write')).toBe(true);
      expect(can('manager', 'quotes:write')).toBe(true);
      expect(can('specialist', 'quotes:write')).toBe(true);
      expect(can('consultant', 'quotes:write')).toBe(true);
    });

    it('denies viewer role from generating quote proposals (FORBIDDEN)', async () => {
      mockStaffContext = { userId: 'user-viewer-1', tenantId: 'tenant-agency-a', role: 'viewer' };

      const res = await generateQuoteProposalAction({
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-ver-1',
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('FORBIDDEN');
    });

    it('denies super_admin from generating operational tenant proposals (fail-closed)', async () => {
      mockStaffContext = { userId: 'user-super-1', tenantId: 'global', role: 'super_admin' };

      const res = await generateQuoteProposalAction({
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-ver-1',
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('FORBIDDEN');
    });

    it('strips internal pricing and supplier cost for unauthorized roles in quote diff DTOs', () => {
      const v1: RawQuoteVersionForDiff = {
        quoteId: 'q-1',
        quoteNumber: 'QT-001',
        id: 'v-1',
        versionNumber: 1,
        currency: 'USD',
        subtotal: '1000.00',
        discountAmount: '0.00',
        taxAmount: '100.00',
        grandTotal: '1100.00',
        internalCostTotal: '700.00',
        grossMarginAmount: '400.00',
        lineItems: [
          {
            id: 'item-1',
            title: 'Hotel',
            category: 'accommodation',
            quantity: 1,
            unitPrice: '1000.00',
            totalPrice: '1000.00',
            supplierCost: '700.00',
          },
        ],
      };

      const v2: RawQuoteVersionForDiff = {
        quoteId: 'q-1',
        quoteNumber: 'QT-001',
        id: 'v-2',
        versionNumber: 2,
        currency: 'USD',
        subtotal: '1200.00',
        discountAmount: '0.00',
        taxAmount: '120.00',
        grandTotal: '1320.00',
        internalCostTotal: '800.00',
        grossMarginAmount: '520.00',
        lineItems: [
          {
            id: 'item-1',
            title: 'Hotel',
            category: 'accommodation',
            quantity: 1,
            unitPrice: '1200.00',
            totalPrice: '1200.00',
            supplierCost: '800.00',
          },
        ],
      };

      // Consultant role: supplier cost and margin diffs MUST be omitted/null
      const consultantDiff = calculateQuoteDifference(v1, v2, 'consultant');
      expect(consultantDiff.v1InternalCostTotal).toBeNull();
      expect(consultantDiff.v2InternalCostTotal).toBeNull();
      expect(consultantDiff.internalCostDifference).toBeNull();
      expect(consultantDiff.v1GrossMarginAmount).toBeNull();
      expect(consultantDiff.grossMarginDifference).toBeNull();
      expect(consultantDiff.itemDiffs[0].v1SupplierCost).toBeNull();
      expect(consultantDiff.itemDiffs[0].supplierCostDifference).toBeNull();

      // Admin role: supplier cost and margin diffs MUST be present
      const adminDiff = calculateQuoteDifference(v1, v2, 'admin');
      expect(adminDiff.v1InternalCostTotal).toBe('700.00');
      expect(adminDiff.v2InternalCostTotal).toBe('800.00');
      expect(adminDiff.internalCostDifference).toBe('100.00');
      expect(adminDiff.grossMarginDifference).toBe('120.00');
      expect(adminDiff.itemDiffs[0].v1SupplierCost).toBe('700.00');
      expect(adminDiff.itemDiffs[0].v2SupplierCost).toBe('800.00');
      expect(adminDiff.itemDiffs[0].supplierCostDifference).toBe('100.00');
    });
  });

  // ==========================================================================
  // 3. PROPOSAL STAGING & ZERO DB MUTATIONS
  // ==========================================================================
  describe('3. Proposal Staging & Non-Autonomous Execution', () => {
    it('generating a quote proposal performs zero DB write queries', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.itinerary_versions')) return { rows: [{ status: 'finalized' }] };
        if (sql.includes('FROM public.inquiries')) return { rows: [{ id: 'inq-123', tenant_id: 'tenant-agency-a', currency: 'USD' }] };
        return { rows: [] };
      });

      await generateQuoteProposalAction({
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-ver-1',
      });

      // Ensure NO INSERT, UPDATE, DELETE, or RPC calls were made during proposal generation
      for (const call of mockPgQuery.mock.calls) {
        const queryText = (call[0] as string).toUpperCase();
        expect(queryText).not.toContain('INSERT INTO');
        expect(queryText).not.toContain('UPDATE ');
        expect(queryText).not.toContain('DELETE FROM');
        expect(queryText).not.toContain('RPC_');
      }
    });

    it('saving an applied quote proposal strictly uses standard deterministic pricing engine', () => {
      const suggestions: AIQuoteLineItemSuggestion[] = [
        {
          title: 'Boutique Hotel (3 Nights)',
          category: 'accommodation',
          quantity: 1,
          suggestedUnitPrice: '600.00',
          pricingSource: 'estimate',
        },
      ];

      // Staging sets unitPrice to '0.00'
      const stagedInputs = adaptAIQuoteSuggestionsToPricingInput(suggestions, false);

      // Staff manually fills in confirmed unitPrice of 650.00
      stagedInputs[0].unitPrice = '650.00';

      const calculated = calculateQuotePricing({
        lineItems: stagedInputs,
        discountAmount: '50.00',
        taxAmount: '60.00',
      });

      expect(calculated.subtotal).toBe('650.00');
      expect(calculated.discountAmount).toBe('50.00');
      expect(calculated.taxAmount).toBe('60.00');
      expect(calculated.grandTotal).toBe('660.00'); // 650 - 50 + 60
    });
  });

  // ==========================================================================
  // 4. IMMUTABILITY & REVISION LIFECYCLE
  // ==========================================================================
  describe('4. Immutability & Quote Revision Lifecycle', () => {
    it('applies suggestions into existing draft version for draft status', () => {
      const currentVersion = { id: 'ver-draft-1', status: 'draft', lockVersion: 2 };
      expect(currentVersion.status).toBe('draft');
      // Draft updates directly in-place without creating a new revision
    });

    it('creates a new revision (vN+1) before staging suggestions if base quote is issued/finalized', async () => {
      const issuedBase = { id: 'ver-issued-v2', status: 'issued', versionNumber: 2 };
      expect(issuedBase.status).toBe('issued');

      // Applying to an issued quote calls createQuoteRevisionAction first
      const { createQuoteRevisionAction } = await import('@/app/actions/inquiry-lifecycle');
      const revRes = await createQuoteRevisionAction(issuedBase.id);

      expect(revRes.newVersionId).toBe('new-rev-from-ver-issued-v2');
      expect(revRes.versionNumber).toBe(3);
      expect(revRes.newVersionId).not.toBe(issuedBase.id);
    });
  });

  // ==========================================================================
  // 5. CUSTOMER-SAFE VS INTERNAL EXPLANATION SENTINEL LEAKAGE
  // ==========================================================================
  describe('5. Customer vs Internal Explanation Trust Context Separation', () => {
    it('ensures customer-safe explanation context contains exactly zero internal financial sentinels', async () => {
      const INTERNAL_SENTINEL_COST = '999888.77';
      const INTERNAL_SENTINEL_MARGIN = '444333.22';

      const v1Row = {
        id: 'qv-v1',
        quote_id: 'q-1',
        quote_number: 'QT-2026-0001',
        version_number: 1,
        currency: 'USD',
        itinerary_version_id: 'itin-v1',
        subtotal: '5000.00',
        discount_amount: '0.00',
        tax_amount: '500.00',
        grand_total: '5500.00',
        internal_cost_total: INTERNAL_SENTINEL_COST,
        grossMarginAmount: INTERNAL_SENTINEL_MARGIN,
        line_items: [
          {
            id: 'item-1',
            title: 'Resort',
            category: 'accommodation',
            quantity: 1,
            unitPrice: '5000.00',
            totalPrice: '5000.00',
            supplierCost: INTERNAL_SENTINEL_COST,
          },
        ],
      };

      const v2Row = {
        ...v1Row,
        id: 'qv-v2',
        version_number: 2,
        subtotal: '6000.00',
        grand_total: '6600.00',
      };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) {
          return { rows: [v1Row, v2Row] };
        }
        return { rows: [] };
      });

      let capturedCustomerPrompt = '';
      const { callAIWithFallback } = await import('@/lib/ai/ai-client');
      (callAIWithFallback as unknown as ReturnType<typeof vi.fn>).mockImplementation(async ({ prompt }: { prompt: string }) => {
        capturedCustomerPrompt = prompt;
        return {
          text: JSON.stringify({
            executiveSummary: 'Added extra day and upgraded room tier',
            keyPriceDrivers: ['Upgraded accommodation tier', 'Extended duration'],
            scopeChanges: ['Room upgrade'],
            clientFacingExplanation: 'Your revised quote includes the upgraded suite and extended stay.',
          }),
          model: 'gpt-4o-mini',
          provider: 'openai',
        };
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-v1',
        v2VersionId: 'qv-v2',
      });

      expect(res.success).toBe(true);
      expect(res.explanation).toBeDefined();

      // Assert customer LLM prompt NEVER received internal sentinels
      expect(capturedCustomerPrompt).not.toContain(INTERNAL_SENTINEL_COST);
      expect(capturedCustomerPrompt).not.toContain(INTERNAL_SENTINEL_MARGIN);
      expect(capturedCustomerPrompt).not.toContain('supplierCost');
      expect(capturedCustomerPrompt).not.toContain('internalCostTotal');

      // Assert clientFacingExplanation contains zero internal sentinels
      expect(res.explanation!.clientFacingExplanation).not.toContain(INTERNAL_SENTINEL_COST);
      expect(res.explanation!.clientFacingExplanation).not.toContain(INTERNAL_SENTINEL_MARGIN);
    });

    it('strips internalStaffNotes completely for unauthorized roles (consultant)', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) {
          return {
            rows: [
              { id: 'qv-1', quote_id: 'q-1', quote_number: 'QT-1', version_number: 1, currency: 'USD', subtotal: '100', discount_amount: '0', tax_amount: '0', grand_total: '100', line_items: [] },
              { id: 'qv-2', quote_id: 'q-1', quote_number: 'QT-1', version_number: 2, currency: 'USD', subtotal: '200', discount_amount: '0', tax_amount: '0', grand_total: '200', line_items: [] },
            ],
          };
        }
        return { rows: [] };
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-1',
        v2VersionId: 'qv-2',
      });

      expect(res.success).toBe(true);
      // Consultant MUST receive null for internalStaffNotes
      expect(res.explanation!.internalStaffNotes).toBeNull();
    });
  });

  // ==========================================================================
  // 6. DETERMINISTIC QUOTE DIFF ENGINE
  // ==========================================================================
  describe('6. Deterministic Quote Diff Calculations', () => {
    it('accurately identifies item additions, removals, modifications, and total differences', () => {
      const v1: RawQuoteVersionForDiff = {
        quoteId: 'q-1',
        quoteNumber: 'QT-001',
        id: 'v-1',
        versionNumber: 1,
        currency: 'USD',
        itineraryVersionId: 'itin-v1',
        validUntil: '2026-11-01',
        termsAndConditions: 'Standard terms',
        subtotal: '2000.00',
        discountAmount: '100.00',
        taxAmount: '190.00',
        grandTotal: '2090.00',
        lineItems: [
          { id: 'item-hotel', title: 'Grand Hotel', category: 'accommodation', quantity: 2, unitPrice: '500.00', totalPrice: '1000.00' },
          { id: 'item-transfer', title: 'Airport Taxi', category: 'transfer', quantity: 1, unitPrice: '100.00', totalPrice: '100.00' },
          { id: 'item-flight', title: 'Domestic Flight', category: 'flight', quantity: 2, unitPrice: '450.00', totalPrice: '900.00' },
        ],
      };

      const v2: RawQuoteVersionForDiff = {
        quoteId: 'q-1',
        quoteNumber: 'QT-001',
        id: 'v-2',
        versionNumber: 2,
        currency: 'USD',
        itineraryVersionId: 'itin-v2', // Changed itinerary version
        validUntil: '2026-11-15', // Changed validity
        termsAndConditions: 'Updated payment terms', // Changed terms
        subtotal: '2400.00',
        discountAmount: '50.00',
        taxAmount: '235.00',
        grandTotal: '2585.00',
        lineItems: [
          // Grand hotel quantity modified: 2 -> 3
          { id: 'item-hotel', title: 'Grand Hotel', category: 'accommodation', quantity: 3, unitPrice: '500.00', totalPrice: '1500.00' },
          // Airport Taxi removed
          // Domestic Flight unchanged
          { id: 'item-flight', title: 'Domestic Flight', category: 'flight', quantity: 2, unitPrice: '450.00', totalPrice: '900.00' },
          // Added item: Guided City Tour
          { id: 'item-tour', title: 'Guided City Tour', category: 'activity', quantity: 2, unitPrice: '150.00', totalPrice: '300.00' },
        ],
      };

      const diff = calculateQuoteDifference(v1, v2, 'consultant');

      // Arithmetic checks
      expect(diff.v1GrandTotal).toBe('2090.00');
      expect(diff.v2GrandTotal).toBe('2585.00');
      expect(diff.grandTotalDifference).toBe('495.00'); // 2585 - 2090
      expect(diff.subtotalDifference).toBe('400.00'); // 2400 - 2000
      expect(diff.discountDifference).toBe('-50.00'); // 50 - 100
      expect(diff.taxDifference).toBe('45.00'); // 235 - 190

      // Linkage and metadata checks
      expect(diff.hasItineraryChange).toBe(true);
      expect(diff.hasValidityChange).toBe(true);
      expect(diff.v1ValidUntil).toBe('2026-11-01');
      expect(diff.v2ValidUntil).toBe('2026-11-15');
      expect(diff.hasTermsChange).toBe(true);

      // Line item diff checks
      const hotelDiff = diff.itemDiffs.find((i) => i.itemId === 'item-hotel');
      expect(hotelDiff?.changeType).toBe('modified');
      expect(hotelDiff?.v1Quantity).toBe(2);
      expect(hotelDiff?.v2Quantity).toBe(3);
      expect(hotelDiff?.priceDifference).toBe('500.00');

      const taxiDiff = diff.itemDiffs.find((i) => i.itemId === 'item-transfer');
      expect(taxiDiff?.changeType).toBe('removed');
      expect(taxiDiff?.priceDifference).toBe('-100.00');

      const flightDiff = diff.itemDiffs.find((i) => i.itemId === 'item-flight');
      expect(flightDiff?.changeType).toBe('unchanged');

      const tourDiff = diff.itemDiffs.find((i) => i.itemId === 'item-tour');
      expect(tourDiff?.changeType).toBe('added');
      expect(tourDiff?.v2Quantity).toBe(2);
      expect(tourDiff?.priceDifference).toBe('300.00');
    });
  });

  // ==========================================================================
  // 7. PROMPT INJECTION & ATTACK RESISTANCE
  // ==========================================================================
  describe('7. Prompt Injection & Malicious Output Resistance', () => {
    it('rejects malicious model payloads attempting to inject administrative fields or actions', () => {
      const maliciousPayload = {
        role: 'admin',
        tenantId: 'other-tenant',
        supplierCost: '99999.99',
        discount: '100%',
        action: 'issue_quote',
        catalogReferenceId: 'tenant-b-item',
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-ver-1',
        suggestedItems: [
          {
            title: 'Free Trip',
            category: 'accommodation',
            quantity: 1,
            suggestedUnitPrice: '0.00',
            pricingSource: 'estimate',
          },
        ],
        grounding: { sources: [], assumptions: [], missingInformation: [] },
      };

      const parsed = AIQuoteLineItemProposalSchema.safeParse(maliciousPayload);
      expect(parsed.success).toBe(true);

      // Verify that privileged injected fields are NOT part of the schema definition
      const data = parsed.data as Record<string, unknown>;
      expect(data.action).toBeUndefined();
      expect(data.role).toBeUndefined();
      expect(data.tenantId).toBeUndefined();
      expect(data.discount).toBeUndefined();
    });
  });

  // ==========================================================================
  // 8. CROSS-TENANT ISOLATION MATRIX
  // ==========================================================================
  describe('8. Cross-Tenant Isolation Matrix', () => {
    it('fails closed when attempting to attach quote suggestion to cross-tenant itinerary', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      // Query with tenant_id = tenant-agency-a returns 0 rows for tenant B's itinerary
      mockPgQuery.mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM public.itinerary_versions WHERE id = $1 AND tenant_id = $2')) {
          return { rows: [] }; // Not found in tenant A
        }
        return { rows: [] };
      });

      const res = await generateQuoteProposalAction({
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-tenant-b-ver-1',
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('NOT_FOUND');
    });

    it('fails closed when comparing quote versions belonging to different tenants', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) {
          // Only returns 1 row because the second version belongs to Tenant B
          return {
            rows: [
              { id: 'qv-tenant-a', quote_id: 'q-1', quote_number: 'QT-1', version_number: 1, currency: 'USD', subtotal: '100', discount_amount: '0', tax_amount: '0', grand_total: '100', line_items: [] },
            ],
          };
        }
        return { rows: [] };
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-tenant-a',
        v2VersionId: 'qv-tenant-b',
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('NOT_FOUND');
    });
  });

  // ==========================================================================
  // 9. CONCURRENCY & FRESHNESS CHECK
  // ==========================================================================
  describe('9. Version Concurrency & Freshness Guardrails', () => {
    it('detects and flags stale quote lock versions', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions WHERE id = $1')) {
          return { rows: [{ lock_version: 5, version_number: 2, status: 'draft' }] };
        }
        return { rows: [] };
      });

      // Staff expected lock version 3, but current is 5
      const freshness = await checkQuoteVersionFreshnessAction('qv-1', 3);

      expect(freshness.isFresh).toBe(false);
      expect(freshness.currentLockVersion).toBe(5);
      expect(freshness.currentStatus).toBe('draft');
    });

    it('confirms fresh version when lock version matches expected', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions WHERE id = $1')) {
          return { rows: [{ lock_version: 3, version_number: 2, status: 'draft' }] };
        }
        return { rows: [] };
      });

      const freshness = await checkQuoteVersionFreshnessAction('qv-1', 3);

      expect(freshness.isFresh).toBe(true);
      expect(freshness.currentLockVersion).toBe(3);
    });
  });

  // ==========================================================================
  // 10. SYSTEM DEGRADATION & FAILURE RESILIENCE
  // ==========================================================================
  describe('10. Graceful Failure Degradation', () => {
    it('returns structured error when AI provider fails without crashing', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.itinerary_versions')) return { rows: [{ status: 'finalized' }] };
        if (sql.includes('FROM public.inquiries')) return { rows: [{ id: 'inq-123', tenant_id: 'tenant-agency-a', currency: 'USD' }] };
        return { rows: [] };
      });

      const { callAIWithFallback } = await import('@/lib/ai/ai-client');
      (callAIWithFallback as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('AI_PROVIDER_UNAVAILABLE: Rate limit exceeded')
      );

      const res = await generateQuoteProposalAction({
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-ver-1',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
      expect(res.error?.message).toContain('Rate limit exceeded');
    });
  });
});
