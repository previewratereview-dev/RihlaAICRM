/**
 * Phase AI-5C.1: Grounded AI Proposal Engine Contracts & Schemas
 * 
 * Strict Zod schemas and TypeScript types defining structured AI proposals.
 * All model outputs are validated through these contracts before passing to
 * application logic or staff review.
 * 
 * Key Invariants:
 * - AI output is UNTRUSTED structured input.
 * - Negative numbers, invalid dates, and invalid categories are rejected.
 * - Pricing numbers from AI are strictly non-authoritative estimates or missing.
 * - Grounding and provenance are explicitly tracked on every proposal.
 */

import { z } from 'zod';

// ============================================================================
// 1. GROUNDING & PROVENANCE SCHEMAS
// ============================================================================

export const AIProvenanceSourceTypeSchema = z.enum([
  'inquiry_fact',
  'conversation_message',
  'traveler_profile',
  'knowledge_document',
  'catalog_package',
  'itinerary_version',
  'quote_version',
  'staff_instruction',
]);

export type AIProvenanceSourceType = z.infer<typeof AIProvenanceSourceTypeSchema>;

export const AIProposalGroundingSourceSchema = z.object({
  type: AIProvenanceSourceTypeSchema,
  id: z.string().optional(),
  title: z.string().optional(),
  field: z.string().optional(),
  snippet: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type AIProposalGroundingSource = z.infer<typeof AIProposalGroundingSourceSchema>;

export const AIProposalGroundingSchema = z.object({
  sources: z.array(AIProposalGroundingSourceSchema).default([]),
  assumptions: z.array(z.string().max(500)).default([]),
  missingInformation: z.array(z.string().max(500)).default([]),
  confidenceScore: z.number().min(0).max(1).default(1),
  reasoningNotes: z.string().max(1000).optional(),
});

export type AIProposalGrounding = z.infer<typeof AIProposalGroundingSchema>;

export const AIProposalWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
  field: z.string().optional(),
});

export type AIProposalWarning = z.infer<typeof AIProposalWarningSchema>;

export const AIProposalMetadataSchema = z.object({
  proposalId: z.string(),
  taskType: z.enum([
    'itinerary_draft',
    'itinerary_revision',
    'quote_line_items',
    'quote_difference_explanation',
  ]),
  generatedAt: z.string(),
  model: z.string(),
  provider: z.string(),
  latencyMs: z.number().nonnegative().optional(),
  tokensIn: z.number().nonnegative().optional(),
  tokensOut: z.number().nonnegative().optional(),
  costEstimate: z.number().nonnegative().optional(),
});

export type AIProposalMetadata = z.infer<typeof AIProposalMetadataSchema>;

// ============================================================================
// 2. ITINERARY PROPOSAL SCHEMAS
// ============================================================================

export const AIItineraryDayItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, 'Activity/item title is required').max(200),
  description: z.string().max(1000).optional().nullable(),
  time: z.string().max(50).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  activityType: z.string().max(50).optional().nullable(),
});

export type AIItineraryDayItem = z.infer<typeof AIItineraryDayItemSchema>;

export const AIItineraryDaySchema = z.object({
  dayNumber: z.number().int().positive('Day number must be >= 1'),
  title: z.string().min(1, 'Day title is required').max(200),
  description: z.string().max(2000).optional().nullable(),
  theme: z.string().max(100).optional().nullable(),
  items: z.array(AIItineraryDayItemSchema).default([]),
});

export type AIItineraryDay = z.infer<typeof AIItineraryDaySchema>;

export const AIItineraryDraftProposalSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  destinationSummary: z.string().max(500).optional().nullable(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD')
    .optional()
    .nullable(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD')
    .optional()
    .nullable(),
  durationDays: z.number().int().positive('Duration must be positive').optional().nullable(),
  passengerCount: z.number().int().positive('Passenger count must be positive').optional().nullable(),
  days: z.array(AIItineraryDaySchema).min(1, 'Itinerary must contain at least one day'),
  inclusions: z.array(z.string().max(300)).default([]),
  exclusions: z.array(z.string().max(300)).default([]),
  grounding: AIProposalGroundingSchema,
  warnings: z.array(AIProposalWarningSchema).default([]),
});

export type AIItineraryDraftProposal = z.infer<typeof AIItineraryDraftProposalSchema>;

export const AIItineraryRevisionProposalSchema = z.object({
  baseItineraryId: z.string().min(1),
  baseVersionId: z.string().min(1),
  baseVersionNumber: z.number().int().positive(),
  requestedChangeSummary: z.string().max(1000),
  proposedDraft: AIItineraryDraftProposalSchema,
  modificationsSummary: z.array(z.string().max(500)).min(1, 'At least one modification must be described'),
  grounding: AIProposalGroundingSchema,
  warnings: z.array(AIProposalWarningSchema).default([]),
});

export type AIItineraryRevisionProposal = z.infer<typeof AIItineraryRevisionProposalSchema>;

// ============================================================================
// 3. QUOTE LINE-ITEM PROPOSAL SCHEMAS
// ============================================================================

export const QuoteItemCategorySchema = z.enum([
  'accommodation',
  'flight',
  'activity',
  'transfer',
  'visa',
  'fee',
  'other',
]);

export type QuoteItemCategory = z.infer<typeof QuoteItemCategorySchema>;

export const AIQuoteLineItemSuggestionSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, 'Line item title is required').max(200),
  description: z.string().max(1000).optional().nullable(),
  category: QuoteItemCategorySchema,
  quantity: z.number().int().positive('Quantity must be >= 1'),
  estimatedUnitPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Price must be a valid positive decimal string')
    .optional()
    .nullable(),
  pricingSource: z.enum(['catalog', 'historical', 'estimate', 'missing']),
  catalogReferenceId: z.string().optional().nullable(),
  supplierName: z.string().max(200).optional().nullable(), // Only populated if authorized
  notes: z.string().max(500).optional().nullable(),
});

export type AIQuoteLineItemSuggestion = z.infer<typeof AIQuoteLineItemSuggestionSchema>;

export const AIQuoteLineItemProposalSchema = z.object({
  inquiryId: z.string().min(1),
  itineraryVersionId: z.string().min(1),
  currency: z.string().length(3).default('USD'),
  suggestedItems: z.array(AIQuoteLineItemSuggestionSchema).min(1, 'At least one line item must be suggested'),
  missingPriceItems: z.array(z.string().max(200)).default([]),
  suggestedTermsAndConditions: z.string().max(3000).optional().nullable(),
  suggestedCustomerNotes: z.string().max(2000).optional().nullable(),
  grounding: AIProposalGroundingSchema,
  warnings: z.array(AIProposalWarningSchema).default([]),
});

export type AIQuoteLineItemProposal = z.infer<typeof AIQuoteLineItemProposalSchema>;

// ============================================================================
// 4. DETERMINISTIC QUOTE DIFF & EXPLANATION SCHEMAS
// ============================================================================

export const LineItemChangeTypeSchema = z.enum(['added', 'removed', 'modified', 'unchanged']);

export const DeterministicLineItemDiffSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  category: QuoteItemCategorySchema,
  changeType: LineItemChangeTypeSchema,
  v1Quantity: z.number().optional().nullable(),
  v2Quantity: z.number().optional().nullable(),
  v1UnitPrice: z.string().optional().nullable(),
  v2UnitPrice: z.string().optional().nullable(),
  v1TotalPrice: z.string().optional().nullable(),
  v2TotalPrice: z.string().optional().nullable(),
  priceDifference: z.string().optional().nullable(),
});

export type DeterministicLineItemDiff = z.infer<typeof DeterministicLineItemDiffSchema>;

export const DeterministicQuoteDiffSchema = z.object({
  quoteId: z.string().min(1),
  quoteNumber: z.string(),
  v1VersionId: z.string().min(1),
  v1VersionNumber: z.number().int().positive(),
  v2VersionId: z.string().min(1),
  v2VersionNumber: z.number().int().positive(),
  currency: z.string().length(3),
  v1GrandTotal: z.string(),
  v2GrandTotal: z.string(),
  grandTotalDifference: z.string(),
  v1Subtotal: z.string(),
  v2Subtotal: z.string(),
  subtotalDifference: z.string(),
  v1Discount: z.string(),
  v2Discount: z.string(),
  discountDifference: z.string(),
  v1Tax: z.string(),
  v2Tax: z.string(),
  taxDifference: z.string(),
  hasItineraryChange: z.boolean(),
  v1ItineraryVersionId: z.string().min(1).optional().nullable(),
  v2ItineraryVersionId: z.string().min(1).optional().nullable(),
  itemDiffs: z.array(DeterministicLineItemDiffSchema),
  // Internal pricing differences — only populated if role is authorized
  v1InternalCostTotal: z.string().optional().nullable(),
  v2InternalCostTotal: z.string().optional().nullable(),
  internalCostDifference: z.string().optional().nullable(),
  v1GrossMarginAmount: z.string().optional().nullable(),
  v2GrossMarginAmount: z.string().optional().nullable(),
  grossMarginDifference: z.string().optional().nullable(),
});

export type DeterministicQuoteDiff = z.infer<typeof DeterministicQuoteDiffSchema>;

export const AIQuoteDifferenceExplanationSchema = z.object({
  quoteNumber: z.string(),
  v1VersionNumber: z.number().int().positive(),
  v2VersionNumber: z.number().int().positive(),
  executiveSummary: z.string().min(1).max(500),
  keyPriceDrivers: z.array(z.string().max(300)).min(1),
  scopeChanges: z.array(z.string().max(300)).default([]),
  itineraryAlignmentNotes: z.string().max(500).optional().nullable(),
  clientFacingExplanation: z.string().min(1).max(1000),
  internalStaffNotes: z.string().max(1000).optional().nullable(), // Stripped for unauthorized roles
  deterministicDiff: DeterministicQuoteDiffSchema,
  grounding: AIProposalGroundingSchema,
});

export type AIQuoteDifferenceExplanation = z.infer<typeof AIQuoteDifferenceExplanationSchema>;

// ============================================================================
// 5. UNIFIED PROPOSAL RESULT
// ============================================================================

export interface AIProposalResult<T> {
  success: boolean;
  data: T | null;
  metadata: AIProposalMetadata | null;
  error?: {
    code: string;
    message: string;
    blockReason?: string;
  };
}
