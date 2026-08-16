/**
 * Phase AI-5C.1: AI Proposal to Deterministic Domain Adapters
 * 
 * Maps validated structured AI proposals into canonical action/service inputs.
 * 
 * Invariant:
 * - The LLM NEVER executes domain mutations directly.
 * - These adapters convert untrusted proposal payloads into structured drafts
 *   for human review and normal deterministic save actions.
 */

import type {
  AIItineraryDraftProposal,
  AIQuoteLineItemSuggestion,
} from './contracts';
import type {
  CreateItineraryActionInput,
  UpdateItineraryDraftActionInput,
} from '@/app/actions/inquiry-lifecycle';
import type { PricingLineItemInput } from '@/lib/quotes-itineraries/pricing';
import type { ItineraryVersionEntity, ItineraryItemType } from '@/lib/quotes-itineraries/types';

/**
 * Adapts an AIItineraryDraftProposal into a CreateItineraryActionInput.
 */
export function adaptAIItineraryToCreateInput(
  inquiryId: string,
  proposal: AIItineraryDraftProposal
): CreateItineraryActionInput {
  return {
    inquiryId,
    title: proposal.title,
    destinationSummary: proposal.destinationSummary || null,
    startDate: proposal.startDate || null,
    endDate: proposal.endDate || null,
    durationDays: proposal.durationDays || proposal.days.length,
    passengerCount: proposal.passengerCount || null,
    days: proposal.days.map((d) => ({
      dayNumber: d.dayNumber,
      title: d.title,
      summary: d.description || null,
      items: (d.items || []).map((item, idx) => ({
        id: item.id || `item-${d.dayNumber}-${idx + 1}`,
        itemType: ((item.activityType as unknown) || 'activity') as ItineraryItemType,
        title: item.title,
        description: item.description || null,
        startTime: item.time || null,
        location: item.location || null,
      })),
    })) as unknown as ItineraryVersionEntity['days'],
    inclusions: proposal.inclusions || [],
    exclusions: proposal.exclusions || [],
  };
}

/**
 * Adapts an AIItineraryDraftProposal into an UpdateItineraryDraftActionInput.
 */
export function adaptAIItineraryToUpdateDraftInput(
  versionId: string,
  expectedLockVersion: number,
  proposal: AIItineraryDraftProposal
): UpdateItineraryDraftActionInput {
  return {
    versionId,
    expectedLockVersion,
    title: proposal.title,
    destinationSummary: proposal.destinationSummary || null,
    startDate: proposal.startDate || null,
    endDate: proposal.endDate || null,
    durationDays: proposal.durationDays || proposal.days.length,
    passengerCount: proposal.passengerCount || null,
    days: proposal.days.map((d) => ({
      dayNumber: d.dayNumber,
      title: d.title,
      summary: d.description || null,
      items: (d.items || []).map((item, idx) => ({
        id: item.id || `item-${d.dayNumber}-${idx + 1}`,
        itemType: ((item.activityType as unknown) || 'activity') as ItineraryItemType,
        title: item.title,
        description: item.description || null,
        startTime: item.time || null,
        location: item.location || null,
      })),
    })) as unknown as ItineraryVersionEntity['days'],
    inclusions: proposal.inclusions || [],
    exclusions: proposal.exclusions || [],
  };
}

export interface AIQuoteStagedLineItem extends PricingLineItemInput {
  suggestedUnitPrice?: string | null;
  pricingSource: 'authoritative_catalog' | 'historical' | 'estimate' | 'missing';
  catalogReferenceId?: string | null;
}

/**
 * Adapts AIQuoteLineItemSuggestion[] into canonical PricingLineItemInput[].
 * 
 * Strict Pricing Authority Rule:
 * - Current Rihla CRM has no structured pricing catalog database (knowledge_documents
 *   is unstructured RAG text, not an authoritative price source).
 * - Therefore, State A (authoritative_catalog) is strictly UNAVAILABLE in current product.
 * - ALL AI suggestions must populate the draft with unitPrice='0.00', requiring explicit
 *   human staff entry or confirmation.
 * - Direct caller/model claims of authoritative_catalog or authoritativeUnitPrice are
 *   strictly ignored by this adapter.
 */
export function adaptAIQuoteSuggestionsToPricingInput(
  suggestions: AIQuoteLineItemSuggestion[],
  isAuthorizedForInternalCost: boolean = false
): PricingLineItemInput[] {
  return suggestions.map((item, idx) => {
    return {
      id: item.id || `quote-item-${idx + 1}`,
      title: item.title,
      description: item.description || undefined,
      category: item.category,
      quantity: item.quantity,
      unitPrice: '0.00', // AI suggestions NEVER establish draft price authority in current product
      // Supplier cost is never populated from AI unless explicitly authorized
      supplierCost: isAuthorizedForInternalCost ? null : undefined,
      supplierName: isAuthorizedForInternalCost && item.supplierName ? item.supplierName : undefined,
    };
  });
}

/**
 * Adapts AIQuoteLineItemSuggestion[] into staged draft inputs carrying metadata for UI display.
 */
export function adaptAIQuoteSuggestionsToStagedInputs(
  suggestions: AIQuoteLineItemSuggestion[],
  isAuthorizedForInternalCost: boolean = false
): AIQuoteStagedLineItem[] {
  return suggestions.map((item, idx) => {
    // Current product has no structured catalog; sanitize any caller-forged catalog states
    const pricingSource =
      item.pricingSource === 'authoritative_catalog'
        ? 'estimate'
        : item.pricingSource || 'estimate';

    return {
      id: item.id || `quote-item-${idx + 1}`,
      title: item.title,
      description: item.description || undefined,
      category: item.category,
      quantity: item.quantity,
      unitPrice: '0.00', // Draft unitPrice is always '0.00' upon initial staging
      suggestedUnitPrice: item.suggestedUnitPrice || null,
      pricingSource,
      catalogReferenceId: item.catalogReferenceId || null,
      supplierCost: isAuthorizedForInternalCost ? null : undefined,
      supplierName: isAuthorizedForInternalCost && item.supplierName ? item.supplierName : undefined,
    };
  });
}
