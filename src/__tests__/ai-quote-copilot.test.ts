/**
 * Phase AI-5C.3: Grounded Quote Copilot & Deterministic Commercial Explanation Tests
 *
 * Verifies:
 * 1. Price Authority: Strict separation between AI estimate/suggestion and authoritative pricing.
 * 2. State A Unreachability: Structured catalog is unavailable in current product (knowledge_documents is RAG text).
 * 3. Direct Adapter Forgery Resistance: Directly calling adaptAIQuoteSuggestionsToPricingInput with forged
 *    authoritative_catalog and authoritativeUnitPrice yields draft unitPrice='0.00'.
 * 4. Knowledge Documents Grounding Only: Valid RAG knowledge_documents rows prove provenance only, not rate authority.
 * 5. RBAC & Internal Pricing Authorization: Strict role gating for proposal generation and internal pricing.
 * 6. Internal Provider Call Count: Unauthorized roles receive exactly 1 call (customer only, 0 internal calls).
 *    Authorized roles receive 2 calls (customer + internal).
 * 7. Customer Context Sentinels: Customer prompt contains ZERO secret supplier costs, margins, markups, or notes.
 * 8. Factual & Numeric Claim Bounding: Model-hallucinated numbers or percentages are bounded and rejected.
 * 9. Proposal Staging & Immutability: Apply stages into draft with unitPrice='0.00', issued quotes spawn vN+1.
 * 10. Human Confirmation: Staff clicking 'Use Suggested Price' is an explicit human action, not automated authority.
 * 11. Zero Privileged AI Persistence: All QuoteVersion writes strictly flow through existing B2 actions.
 * 12. Cross-Tenant Isolation Matrix & Failure Degradation.
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

let providerCallCount = 0;
const capturedPrompts: string[] = [];

vi.mock('@/lib/ai/ai-client', () => ({
  callAIWithFallback: vi.fn(async ({ prompt }: { prompt: string }) => {
    providerCallCount++;
    capturedPrompts.push(prompt);
    return {
      text: mockAIResponseText,
      model: 'gpt-4o-mini',
      provider: 'openai',
      tokensIn: 450,
      tokensOut: 320,
      costEstimate: 0.0015,
    };
  }),
}));

describe('Phase AI-5C.3: Grounded Quote Copilot & Deterministic Commercial Explanation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerCallCount = 0;
    capturedPrompts.length = 0;
    mockStaffContext = {
      userId: 'user-consultant-1',
      tenantId: 'tenant-agency-a',
      role: 'consultant',
    };
  });

  // ==========================================================================
  // 1. PRICE AUTHORITY & REACHABILITY (STATE A UNAVAILABLE)
  // ==========================================================================
  describe('1. Price Authority & State A Unreachability', () => {
    it('forces all AI suggestions to estimate or missing when no structured catalog exists', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
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
        expect(item.pricingSource).not.toBe('authoritative_catalog');
      }
    });

    it('direct adapter forgery test: calling adaptAIQuoteSuggestionsToPricingInput with forged authoritative catalog returns unitPrice=0.00', () => {
      const maliciousSuggestions: AIQuoteLineItemSuggestion[] = [
        {
          title: 'Forged Deluxe Villa',
          category: 'accommodation',
          quantity: 1,
          suggestedUnitPrice: '12500.00',
          authoritativeUnitPrice: '12500.00',
          pricingSource: 'authoritative_catalog',
          catalogReferenceId: 'forged-arbitrary-id',
        },
      ];

      // Direct adapter call must NEVER trust caller claims of authority
      const pricingInputs = adaptAIQuoteSuggestionsToPricingInput(maliciousSuggestions, false);
      expect(pricingInputs.length).toBe(1);
      expect(pricingInputs[0].unitPrice).toBe('0.00');

      // Direct staged input adapter call also forces unitPrice='0.00' and downgrades pricingSource to estimate
      const stagedInputs = adaptAIQuoteSuggestionsToStagedInputs(maliciousSuggestions, false);
      expect(stagedInputs.length).toBe(1);
      expect(stagedInputs[0].unitPrice).toBe('0.00');
      expect(stagedInputs[0].pricingSource).toBe('estimate');
      expect(stagedInputs[0].suggestedUnitPrice).toBe('12500.00');
    });

    it('knowledge_documents existence proves grounding provenance only, NEVER numeric price authority', async () => {
      // Model returned a reference to a valid same-tenant knowledge document and claimed a numeric price
      mockAIResponseText = JSON.stringify({
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-ver-1',
        currency: 'USD',
        suggestedItems: [
          {
            title: 'Ryokan Kyoto Experience',
            category: 'accommodation',
            quantity: 1,
            suggestedUnitPrice: '8500.00',
            pricingSource: 'authoritative_catalog',
            catalogReferenceId: 'valid-kdoc-1',
          },
        ],
        missingPriceItems: [],
        grounding: {
          sources: [{ type: 'knowledge_document', id: 'valid-kdoc-1', title: 'Ryokan Info', snippet: 'Prices vary seasonally' }],
          assumptions: [],
          missingInformation: [],
        },
        warnings: [],
      });

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.itinerary_versions')) {
          return { rows: [{ id: 'itin-ver-1', tenant_id: 'tenant-agency-a', status: 'finalized', version_number: 1, lock_version: 0 }] };
        }
        if (sql.includes('FROM public.inquiries')) {
          return { rows: [{ id: 'inq-123', tenant_id: 'tenant-agency-a', currency: 'USD' }] };
        }
        if (sql.includes('FROM public.knowledge_documents WHERE id = $1 AND tenant_id = $2')) {
          // Valid same-tenant knowledge document exists
          return { rows: [{ id: 'valid-kdoc-1', title: 'Ryokan Info', content: 'Unstructured text guide' }] };
        }
        return { rows: [] };
      });

      const res = await generateQuoteProposalAction({
        inquiryId: 'inq-123',
        itineraryVersionId: 'itin-ver-1',
      });

      expect(res.success).toBe(true);
      const item = res.proposal!.suggestedItems[0];
      // Grounding proves source existence, but must NOT authorize price
      expect(item.pricingSource).toBe('estimate');
      expect(item.authoritativeUnitPrice).toBeNull();

      // Adapter must stage as unitPrice '0.00'
      const staged = adaptAIQuoteSuggestionsToStagedInputs(res.proposal!.suggestedItems, false);
      expect(staged[0].unitPrice).toBe('0.00');
    });
  });

  // ==========================================================================
  // 2. RBAC & INTERNAL PRICING PERMISSION MATRIX
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
  });

  // ==========================================================================
  // 3. TWO-CONTEXT EXPLANATION SEPARATION & SENTINEL LEAKAGE
  // ==========================================================================
  describe('3. Two-Context Explanation Separation & Provider Call Counts', () => {
    const SECRET_SUPPLIER_COST = '9999.88';
    const SECRET_MARGIN = '8888.77';
    const SECRET_MARKUP = '7777.66';
    const SECRET_INTERNAL_NOTE = 'SECRET_INTERNAL_NOTE_6666';
    const SECRET_SUPPLIER_NAME = 'SECRET_SUPPLIER_NAME_5555';

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
      internal_cost_total: SECRET_SUPPLIER_COST,
      gross_margin_amount: SECRET_MARGIN,
      line_items: [
        {
          id: 'item-1',
          title: 'Luxury Villa',
          category: 'accommodation',
          quantity: 1,
          unitPrice: '5000.00',
          totalPrice: '5000.00',
          supplierCost: SECRET_SUPPLIER_COST,
          supplierName: SECRET_SUPPLIER_NAME,
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

    it('consultant (unauthorized for internal pricing) makes EXACTLY 1 customer model call and ZERO internal model calls', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) {
          return { rows: [v1Row, v2Row] };
        }
        return { rows: [] };
      });

      mockAIResponseText = JSON.stringify({
        executiveSummary: 'Added extra day and upgraded room tier',
        keyPriceDrivers: ['Upgraded accommodation tier'],
        scopeChanges: ['Room upgrade'],
        clientFacingExplanation: 'Your revised quote includes the upgraded suite.',
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-v1',
        v2VersionId: 'qv-v2',
      });

      expect(res.success).toBe(true);
      expect(res.explanation).toBeDefined();

      // Consultant provider call count MUST be exactly 1 (customer call only, 0 internal calls)
      expect(providerCallCount).toBe(1);
      expect(res.explanation!.internalStaffNotes).toBeNull();

      // Assert customer prompt contained ZERO internal secret sentinels
      const customerPrompt = capturedPrompts[0];
      expect(customerPrompt).not.toContain(SECRET_SUPPLIER_COST);
      expect(customerPrompt).not.toContain(SECRET_MARGIN);
      expect(customerPrompt).not.toContain(SECRET_MARKUP);
      expect(customerPrompt).not.toContain(SECRET_INTERNAL_NOTE);
      expect(customerPrompt).not.toContain(SECRET_SUPPLIER_NAME);
      expect(customerPrompt).not.toContain('v1SupplierCost');
      expect(customerPrompt).not.toContain('v1InternalCostTotal');
    });

    it('admin (authorized for internal pricing) makes EXACTLY 2 provider calls (1 customer-safe + 1 internal analysis)', async () => {
      mockStaffContext = { userId: 'user-admin-1', tenantId: 'tenant-agency-a', role: 'admin' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) {
          return { rows: [v1Row, v2Row] };
        }
        return { rows: [] };
      });

      mockAIResponseText = JSON.stringify({
        executiveSummary: 'Added extra day',
        keyPriceDrivers: ['Extended stay'],
        scopeChanges: ['1 extra night'],
        clientFacingExplanation: 'Your revised quote includes the extra night.',
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-v1',
        v2VersionId: 'qv-v2',
      });

      expect(res.success).toBe(true);
      // Admin receives 2 calls: Pass 1 (customer-safe) + Pass 2 (internal analysis)
      expect(providerCallCount).toBe(2);
      expect(res.explanation!.internalStaffNotes).toBeDefined();

      // Pass 1 prompt (customer-safe) MUST NOT contain secrets
      const pass1CustomerPrompt = capturedPrompts[0];
      expect(pass1CustomerPrompt).not.toContain(SECRET_SUPPLIER_COST);
      expect(pass1CustomerPrompt).not.toContain(SECRET_MARGIN);
      expect(pass1CustomerPrompt).not.toContain('v1SupplierCost');
    });
  });

  // ==========================================================================
  // 4. FACTUAL, NUMERIC & CAUSAL CLAIM BOUNDING
  // ==========================================================================
  describe('4. Factual, Numeric & Causal Claim Protection', () => {
    const v1Row = {
      id: 'qv-1',
      quote_id: 'q-1',
      quote_number: 'QT-100',
      version_number: 1,
      currency: 'USD',
      itinerary_version_id: 'itin-v1',
      valid_until: '2026-11-01',
      subtotal: '10000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      grand_total: '10000.00',
      line_items: [{ id: 'i-1', title: 'Grand Hotel', category: 'accommodation', quantity: 1, unitPrice: '10000.00', totalPrice: '10000.00' }],
    };

    const v2Row = {
      id: 'qv-2',
      quote_id: 'q-1',
      quote_number: 'QT-100',
      version_number: 2,
      currency: 'USD',
      itinerary_version_id: 'itin-v1',
      valid_until: '2026-11-15',
      subtotal: '12000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      grand_total: '12000.00',
      line_items: [{ id: 'i-1', title: 'Grand Hotel', category: 'accommodation', quantity: 1, unitPrice: '12000.00', totalPrice: '12000.00' }],
    };

    it('unsupported supplier-reason test: rejects causal claims claiming the supplier raised seasonal rates', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) return { rows: [v1Row, v2Row] };
        return { rows: [] };
      });

      mockAIResponseText = JSON.stringify({
        executiveSummary: 'Hotel rate increased',
        keyPriceDrivers: ['Seasonal rates'],
        scopeChanges: [],
        clientFacingExplanation: 'The hotel price increased because the supplier raised seasonal rates.',
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-1',
        v2VersionId: 'qv-2',
      });

      expect(res.success).toBe(true);
      expect(res.explanation!.clientFacingExplanation).not.toContain('because the supplier raised seasonal rates');
      expect(res.explanation!.clientFacingExplanation).not.toContain('seasonal rates');
      expect(res.explanation!.clientFacingExplanation).not.toContain('supplier raised');
    });

    it('unsupported availability-reason test: rejects causal claims regarding reduced availability', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) return { rows: [v1Row, v2Row] };
        return { rows: [] };
      });

      mockAIResponseText = JSON.stringify({
        executiveSummary: 'Pricing adjusted',
        keyPriceDrivers: ['Availability change'],
        scopeChanges: [],
        clientFacingExplanation: 'Flight pricing changed due to reduced availability.',
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-1',
        v2VersionId: 'qv-2',
      });

      expect(res.success).toBe(true);
      expect(res.explanation!.clientFacingExplanation).not.toContain('due to reduced availability');
      expect(res.explanation!.clientFacingExplanation).not.toContain('availability');
    });

    it('unsupported demand-reason test: rejects causal claims claiming additional cost reflects peak-season demand', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) return { rows: [v1Row, v2Row] };
        return { rows: [] };
      });

      mockAIResponseText = JSON.stringify({
        executiveSummary: 'High season rate',
        keyPriceDrivers: ['Demand'],
        scopeChanges: [],
        clientFacingExplanation: 'The additional cost reflects peak-season demand.',
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-1',
        v2VersionId: 'qv-2',
      });

      expect(res.success).toBe(true);
      expect(res.explanation!.clientFacingExplanation).not.toContain('peak-season demand');
      expect(res.explanation!.clientFacingExplanation).not.toContain('demand');
    });

    it('unsupported legal/tax-reason test: rejects causal claims regarding updated government regulations', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) return { rows: [v1Row, v2Row] };
        return { rows: [] };
      });

      mockAIResponseText = JSON.stringify({
        executiveSummary: 'Tax update',
        keyPriceDrivers: ['Regulations'],
        scopeChanges: [],
        clientFacingExplanation: 'Taxes increased because of updated government regulations.',
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-1',
        v2VersionId: 'qv-2',
      });

      expect(res.success).toBe(true);
      expect(res.explanation!.clientFacingExplanation).not.toContain('government regulations');
      expect(res.explanation!.clientFacingExplanation).not.toContain('regulations');
    });

    it('mixed safe + unsafe output test: retains deterministic fact (+2000.00) and strips unsupported causal reason', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) return { rows: [v1Row, v2Row] };
        return { rows: [] };
      });

      // Model returns valid deterministic price delta (+2000.00) combined with unsupported causal reason
      mockAIResponseText = JSON.stringify({
        executiveSummary: 'Hotel increase',
        keyPriceDrivers: ['Rate'],
        scopeChanges: [],
        clientFacingExplanation: 'The Grand Hotel price increased by 2000.00 because seasonal supplier rates rose.',
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-1',
        v2VersionId: 'qv-2',
      });

      expect(res.success).toBe(true);
      // Retains the factual part ("The Grand Hotel price increased by 2000.00.")
      expect(res.explanation!.clientFacingExplanation).toContain('2000.00');
      // Strips the causal clause completely
      expect(res.explanation!.clientFacingExplanation).not.toContain('because seasonal supplier rates rose');
      expect(res.explanation!.clientFacingExplanation).not.toContain('seasonal supplier rates');
    });

    it('supported non-causal explanation test: allows factual non-causal descriptions matching deterministic diff', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) return { rows: [v1Row, v2Row] };
        return { rows: [] };
      });

      // Model returns valid factual non-causal description
      const factualExplanation = 'The Grand Hotel line item increased from 10000.00 to 12000.00, and validity was extended to 2026-11-15.';
      mockAIResponseText = JSON.stringify({
        executiveSummary: 'Price and validity revision',
        keyPriceDrivers: ['Hotel rate', 'Validity extension'],
        scopeChanges: [],
        clientFacingExplanation: factualExplanation,
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-1',
        v2VersionId: 'qv-2',
      });

      expect(res.success).toBe(true);
      // Valid non-causal explanation matching deterministic diff facts is preserved
      expect(res.explanation!.clientFacingExplanation).toBe(factualExplanation);
    });

    it('unsupported numeric + causal combined test: safely falls back to deterministic copy when both are present', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.quote_versions')) return { rows: [v1Row, v2Row] };
        return { rows: [] };
      });

      // Adversarial model returns BOTH unsupported number (+9000 instead of 2000) AND unsupported causal claim
      mockAIResponseText = JSON.stringify({
        executiveSummary: 'Prices increased by 9000',
        keyPriceDrivers: ['Rates went up 90%'],
        scopeChanges: [],
        clientFacingExplanation: 'Your quote total increased by 9000 (a 90% increase) because seasonal rates rose.',
      });

      const res = await generateQuoteDiffExplanationAction({
        quoteId: 'q-1',
        v1VersionId: 'qv-1',
        v2VersionId: 'qv-2',
      });

      expect(res.success).toBe(true);
      // Unsupported numbers and causal reasons are completely sanitized
      expect(res.explanation!.clientFacingExplanation).not.toContain('9000');
      expect(res.explanation!.clientFacingExplanation).not.toContain('90%');
      expect(res.explanation!.clientFacingExplanation).not.toContain('because seasonal rates rose');
      // Must contain deterministic truth
      expect(res.explanation!.clientFacingExplanation).toContain('10000.00');
      expect(res.explanation!.clientFacingExplanation).toContain('12000.00');
      expect(res.explanation!.clientFacingExplanation).toContain('2000.00');
    });
  });

  // ==========================================================================
  // 5. PROPOSAL STAGING, HUMAN CONFIRMATION & ZERO PRIVILEGED AI PERSISTENCE
  // ==========================================================================
  describe('5. Proposal Staging & Zero Privileged Persistence', () => {
    it('applying proposal stages into draft with unitPrice=0.00 without any DB mutation', async () => {
      const suggestions: AIQuoteLineItemSuggestion[] = [
        {
          title: 'Boutique Hotel (3 Nights)',
          category: 'accommodation',
          quantity: 1,
          suggestedUnitPrice: '12500.00',
          pricingSource: 'estimate',
        },
      ];

      // 1. Initial stage sets draft unitPrice = '0.00'
      const stagedInputs = adaptAIQuoteSuggestionsToStagedInputs(suggestions, false);
      expect(stagedInputs[0].unitPrice).toBe('0.00');
      expect(stagedInputs[0].suggestedUnitPrice).toBe('12500.00');

      // 2. Human explicitly confirms suggested price by clicking 'Use suggested price'
      // This is an explicit human action that populates the standard editable draft input
      stagedInputs[0].unitPrice = stagedInputs[0].suggestedUnitPrice!;

      // 3. Normal save uses standard B2 pricing engine and RPC
      const calculated = calculateQuotePricing({
        lineItems: stagedInputs,
        discountAmount: '0.00',
        taxAmount: '0.00',
      });

      expect(calculated.subtotal).toBe('12500.00');
      expect(calculated.grandTotal).toBe('12500.00');
    });

    it('verifies AI endpoints have ZERO direct write routes to quote_versions', async () => {
      // Proposal generation and explanation actions only perform SELECT queries
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

      for (const call of mockPgQuery.mock.calls) {
        const queryText = (call[0] as string).toUpperCase();
        expect(queryText).not.toContain('INSERT');
        expect(queryText).not.toContain('UPDATE');
        expect(queryText).not.toContain('DELETE');
      }
    });
  });

  // ==========================================================================
  // 6. DETERMINISTIC QUOTE DIFF ENGINE
  // ==========================================================================
  describe('6. Deterministic Quote Diff Calculations', () => {
    it('accurately computes item additions, removals, modifications, validity, and terms changes', () => {
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
        ],
      };

      const v2: RawQuoteVersionForDiff = {
        quoteId: 'q-1',
        quoteNumber: 'QT-001',
        id: 'v-2',
        versionNumber: 2,
        currency: 'USD',
        itineraryVersionId: 'itin-v2',
        validUntil: '2026-11-15',
        termsAndConditions: 'Updated terms',
        subtotal: '2500.00',
        discountAmount: '50.00',
        taxAmount: '245.00',
        grandTotal: '2695.00',
        lineItems: [
          { id: 'item-hotel', title: 'Grand Hotel', category: 'accommodation', quantity: 3, unitPrice: '500.00', totalPrice: '1500.00' },
          { id: 'item-tour', title: 'City Tour', category: 'activity', quantity: 2, unitPrice: '500.00', totalPrice: '1000.00' },
        ],
      };

      const diff = calculateQuoteDifference(v1, v2, 'consultant');

      expect(diff.v1GrandTotal).toBe('2090.00');
      expect(diff.v2GrandTotal).toBe('2695.00');
      expect(diff.grandTotalDifference).toBe('605.00');
      expect(diff.hasItineraryChange).toBe(true);
      expect(diff.hasValidityChange).toBe(true);
      expect(diff.v1ValidUntil).toBe('2026-11-01');
      expect(diff.v2ValidUntil).toBe('2026-11-15');
      expect(diff.hasTermsChange).toBe(true);
    });
  });

  // ==========================================================================
  // 7. CROSS-TENANT ISOLATION MATRIX & FAILURE DEGRADATION
  // ==========================================================================
  describe('7. Cross-Tenant Isolation & Failure Resilience', () => {
    it('fails closed when attempting to attach quote suggestion to cross-tenant itinerary', async () => {
      mockStaffContext = { userId: 'user-consultant-1', tenantId: 'tenant-agency-a', role: 'consultant' };

      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.itinerary_versions WHERE id = $1 AND tenant_id = $2')) {
          return { rows: [] };
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

    it('returns structured error when AI provider fails without breaking workspace', async () => {
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
      expect(res.error?.message).toContain('Rate limit exceeded');
    });
  });
});
