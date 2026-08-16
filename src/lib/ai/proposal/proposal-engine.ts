/**
 * Phase AI-5C.1: Grounded AI Proposal Engine Orchestrator
 * 
 * Central service for executing structured, grounded AI proposals.
 * 
 * Safety & Authority Boundaries:
 * - Server-Authoritative: Identity, permissions, and tenant isolation strictly checked.
 * - Non-Authoritative Output: Proposals are suggestions requiring human review before saving.
 * - Deterministic Arithmetic: Price diffs are computed by pure code, not the LLM.
 * - Anti-Injection: Retrieved customer messages & knowledge are isolated in data blocks.
 * - Auditability: All proposal executions are logged to public.ai_usage.
 */

import { can } from '@/lib/permissions';
import { getAuthenticatedStaffContext, withPgClient } from '@/app/actions/inquiry-lifecycle';
import {
  buildProposalContext,
  type ProposalContextParams,
} from './context-builder';
import {
  calculateQuoteDifference,
  getCustomerSafeQuoteDiff,
  type RawQuoteVersionForDiff,
} from './diff-engine';
import {
  AIItineraryDraftProposalSchema,
  AIItineraryRevisionProposalSchema,
  AIQuoteLineItemProposalSchema,
  AIQuoteDifferenceExplanationSchema,
  type AIItineraryDraftProposal,
  type AIItineraryRevisionProposal,
  type AIQuoteLineItemProposal,
  type AIQuoteDifferenceExplanation,
  type AIProposalResult,
  type AIProposalMetadata,
  type DeterministicQuoteDiff,
} from './contracts';
import { callAIWithFallback } from '@/lib/ai/ai-client';
import { type TenantSettings } from '@/lib/tenant/config';

export interface GenerateProposalOptions {
  model?: string;
  overrideCtx?: { tenantId: string; userId: string; role: string };
}

/**
 * Helper to clean JSON string from Markdown code fences if returned by model.
 */
function cleanJsonString(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

/**
 * Unsupported causal patterns that must never be presented to customers as authoritative facts
 * when no deterministic commercial source establishes causality.
 */
const UNSUPPORTED_CAUSAL_PATTERNS = [
  /\bbecause\b/i,
  /\bdue to\b/i,
  /\bcaused by\b/i,
  /\bas a result of\b/i,
  /\bowing to\b/i,
  /\bon account of\b/i,
  /\breflects?\s+(?:supplier|peak|seasonal|market|demand|higher|rate|cost|airline|hotel|policy)/i,
  /\bseasonal\s+rates?\b/i,
  /\bpeak[- ]season\b/i,
  /\bavailability\b/i,
  /\b(?:market|high|surging|increased)?\s*demand\b/i,
  /\bmarket\s+conditions\b/i,
  /\bsupplier\s+(?:increase|rates?|raise|raised|price|fee|policy|charges?)\b/i,
  /\b(?:government|legal|aviation|official)\s*(?:regulations?|updates?|rules?|laws?|changes?)\b/i,
  /\bfuel\s+surcharges?\b/i,
  /\boccupancy\s+rates?\b/i,
  /\bexchange\s+rates?\b/i,
  /\binflation\b/i,
];

/**
 * Generates pure, deterministic, non-causal customer-facing explanation.
 */
export function generateDeterministicCustomerExplanation(
  diff: DeterministicQuoteDiff
): string {
  const parts: string[] = [];

  parts.push(
    `Quote ${diff.quoteNumber} has been updated from ${diff.currency} ${diff.v1GrandTotal} to ${diff.currency} ${diff.v2GrandTotal} (difference of ${diff.currency} ${diff.grandTotalDifference}).`
  );

  const itemParts: string[] = [];
  for (const item of diff.itemDiffs) {
    if (item.changeType === 'added') {
      itemParts.push(`Added ${item.title} (${diff.currency} ${item.v2TotalPrice || '0.00'})`);
    } else if (item.changeType === 'removed') {
      itemParts.push(`Removed ${item.title} (-${diff.currency} ${item.v1TotalPrice || '0.00'})`);
    } else if (item.changeType === 'modified') {
      if (item.v1Quantity !== item.v2Quantity) {
        itemParts.push(
          `Updated ${item.title} quantity from ${item.v1Quantity} to ${item.v2Quantity} (${diff.currency} ${item.v1TotalPrice} → ${diff.currency} ${item.v2TotalPrice})`
        );
      } else if (item.priceDifference && Number(item.priceDifference) !== 0) {
        itemParts.push(
          `Updated ${item.title} price (${diff.currency} ${item.v1TotalPrice} → ${diff.currency} ${item.v2TotalPrice})`
        );
      }
    }
  }

  if (itemParts.length > 0) {
    parts.push(`Line item adjustments: ${itemParts.join('; ')}.`);
  }

  if (diff.hasValidityChange && diff.v2ValidUntil) {
    parts.push(`Validity adjusted to ${diff.v2ValidUntil}.`);
  }

  if (diff.hasTermsChange) {
    parts.push('Payment terms and conditions updated.');
  }

  return parts.join(' ');
}

/**
 * Bounds customer explanation to strictly deterministic numbers and facts.
 * Post-generation trust boundary:
 * 1. Rejects and bounds any model-invented numbers or percentages.
 * 2. Strips or rejects any unsupported causal claims (e.g. supplier seasonal rates, availability, demand, regulations).
 * 3. Falls back to pure deterministic customer copy if text is unsafe.
 */
export function sanitizeCustomerExplanation(
  explanationText: string,
  deterministicDiff: DeterministicQuoteDiff
): string {
  if (!explanationText || typeof explanationText !== 'string' || explanationText.trim() === '') {
    return generateDeterministicCustomerExplanation(deterministicDiff);
  }

  // 1. Collect all valid numbers and date components from the deterministic diff
  const validNumbers = new Set<string>();
  const addVal = (val: string | number | null | undefined) => {
    if (val != null) {
      const s = String(val).trim();
      if (s) {
        validNumbers.add(s);
        const num = parseFloat(s);
        if (!isNaN(num)) {
          validNumbers.add(String(num));
          validNumbers.add(num.toFixed(2));
          validNumbers.add(Math.abs(num).toFixed(2));
          validNumbers.add(String(Math.abs(num)));
        }
      }
    }
  };

  addVal(deterministicDiff.v1GrandTotal);
  addVal(deterministicDiff.v2GrandTotal);
  addVal(deterministicDiff.grandTotalDifference);
  addVal(deterministicDiff.v1Subtotal);
  addVal(deterministicDiff.v2Subtotal);
  addVal(deterministicDiff.subtotalDifference);
  addVal(deterministicDiff.v1Discount);
  addVal(deterministicDiff.v2Discount);
  addVal(deterministicDiff.discountDifference);
  addVal(deterministicDiff.v1Tax);
  addVal(deterministicDiff.v2Tax);
  addVal(deterministicDiff.taxDifference);
  addVal(deterministicDiff.v1VersionNumber);
  addVal(deterministicDiff.v2VersionNumber);

  for (const item of deterministicDiff.itemDiffs) {
    addVal(item.v1Quantity);
    addVal(item.v2Quantity);
    addVal(item.v1UnitPrice);
    addVal(item.v2UnitPrice);
    addVal(item.v1TotalPrice);
    addVal(item.v2TotalPrice);
    addVal(item.priceDifference);
  }

  if (deterministicDiff.v1ValidUntil) {
    for (const d of deterministicDiff.v1ValidUntil.split(/[-/]/)) addVal(d);
  }
  if (deterministicDiff.v2ValidUntil) {
    for (const d of deterministicDiff.v2ValidUntil.split(/[-/]/)) addVal(d);
  }

  // 2. Validate all numbers in explanationText
  const foundNumbers = explanationText.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  for (const found of foundNumbers) {
    const rawNum = found.replace('%', '');
    const n = parseFloat(rawNum);
    if (found.includes('%') || found.includes('.') || (n > 5 && !validNumbers.has(rawNum) && !validNumbers.has(n.toFixed(2)))) {
      if (!validNumbers.has(rawNum) && !validNumbers.has(n.toFixed(2))) {
        // Unsupported numeric claim or hallucinated percentage -> fallback to deterministic
        return generateDeterministicCustomerExplanation(deterministicDiff);
      }
    }
  }

  // 3. Check for and sanitize unsupported causal claims
  let cleanedText = explanationText.trim();

  // If text contains causal splitters, try to trim the causal suffix
  for (const causalSplitter of [
    /\s+because\s+.*$/i,
    /\s+due to\s+.*$/i,
    /\s+as a result of\s+.*$/i,
    /\s+owing to\s+.*$/i,
    /\s+on account of\s+.*$/i,
  ]) {
    if (causalSplitter.test(cleanedText)) {
      cleanedText = cleanedText.replace(causalSplitter, '').trim();
      if (cleanedText && !cleanedText.endsWith('.')) {
        cleanedText += '.';
      }
    }
  }

  // Check if any unsupported causal pattern still exists
  for (const pattern of UNSUPPORTED_CAUSAL_PATTERNS) {
    if (pattern.test(cleanedText)) {
      // Unsupported causal concept detected -> fallback to deterministic
      return generateDeterministicCustomerExplanation(deterministicDiff);
    }
  }

  if (cleanedText.length < 15) {
    return generateDeterministicCustomerExplanation(deterministicDiff);
  }

  return cleanedText;
}

// ============================================================================
// 1. GENERATE ITINERARY DRAFT PROPOSAL
// ============================================================================

export async function generateItineraryDraftProposal(
  params: ProposalContextParams,
  options?: GenerateProposalOptions
): Promise<AIProposalResult<AIItineraryDraftProposal>> {
  const ctx = options?.overrideCtx || (await getAuthenticatedStaffContext());
  if (!can(ctx.role, 'itineraries:write')) {
    return {
      success: false,
      data: null,
      metadata: null,
      error: { code: 'FORBIDDEN', message: `Role ${ctx.role} lacks itineraries:write permission` },
    };
  }

  const startTime = Date.now();

  try {
    const proposalContext = await buildProposalContext(params, ctx);

    const prompt = `You are a professional luxury travel designer for an elite agency.
Generate a structured, day-by-day itinerary proposal based on the following verified inquiry context.

${proposalContext.formattedSystemPromptContext}

CRITICAL RULES:
1. Output MUST be valid JSON matching the exact schema below.
2. Ground your proposal strictly in the inquiry facts and conversation preferences.
3. Explicitly list any assumptions you made in grounding.assumptions.
4. Explicitly list any missing information or questions in grounding.missingInformation.
5. All dates must be YYYY-MM-DD format if known, or null.
6. Number days sequentially starting from 1.
7. Do not include markdown or explanations outside the JSON.

REQUIRED JSON STRUCTURE:
{
  "title": "Itinerary Title",
  "destinationSummary": "Brief summary of destination and highlights",
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null",
  "durationDays": 5,
  "passengerCount": 2,
  "days": [
    {
      "dayNumber": 1,
      "title": "Day 1 Title",
      "description": "Day summary",
      "theme": "Arrival & Welcome",
      "items": [
        {
          "title": "Activity Name",
          "description": "Details",
          "time": "10:00 AM",
          "location": "City/Venue",
          "activityType": "activity"
        }
      ]
    }
  ],
  "inclusions": ["5-star hotel accommodation", "Private airport transfers"],
  "exclusions": ["International flights", "Personal expenses"],
  "grounding": {
    "sources": [
      { "type": "inquiry_fact", "field": "destination", "snippet": "Requested destination" }
    ],
    "assumptions": ["Travelers prefer morning tours"],
    "missingInformation": ["Arrival flight number"],
    "confidenceScore": 0.95
  },
  "warnings": []
}`;

    const aiSettings: TenantSettings['ai'] = {
      defaultModel: options?.model || 'gpt-4o-mini',
      apiKeys: {},
      budgets: { monthlyBudget: 500 },
    };

    const aiRes = await callAIWithFallback({
      model: options?.model || 'gpt-4o-mini',
      prompt,
      feature: 'itinerary_draft_proposal',
      tenantAISettings: aiSettings,
      currentSpend: { daily: 0, monthly: 0 },
      maxTokens: 3000,
    });

    const parsedJson = JSON.parse(cleanJsonString(aiRes.text));
    const validated = AIItineraryDraftProposalSchema.parse(parsedJson);

    const metadata: AIProposalMetadata = {
      proposalId: `prop-${Date.now()}`,
      taskType: 'itinerary_draft',
      generatedAt: new Date().toISOString(),
      model: aiRes.model,
      provider: aiRes.provider,
      latencyMs: Date.now() - startTime,
      tokensIn: aiRes.tokensIn,
      tokensOut: aiRes.tokensOut,
      costEstimate: aiRes.costEstimate,
    };

    return {
      success: true,
      data: validated,
      metadata,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to generate itinerary proposal';
    let code = 'PROPOSAL_GENERATION_FAILED';
    if (message.startsWith('NOT_FOUND')) {
      code = 'NOT_FOUND';
    } else if (message.startsWith('FORBIDDEN') || message.startsWith('UNAUTHORIZED')) {
      code = 'FORBIDDEN';
    }
    return {
      success: false,
      data: null,
      metadata: null,
      error: { code, message },
    };
  }
}

// ============================================================================
// 2. GENERATE ITINERARY REVISION PROPOSAL
// ============================================================================

export interface GenerateRevisionParams extends ProposalContextParams {
  baseItineraryId: string;
  baseVersionId: string;
  baseVersionNumber: number;
  requestedChanges: string;
}

export async function generateItineraryRevisionProposal(
  params: GenerateRevisionParams,
  options?: GenerateProposalOptions
): Promise<AIProposalResult<AIItineraryRevisionProposal>> {
  const ctx = options?.overrideCtx || (await getAuthenticatedStaffContext());
  if (!can(ctx.role, 'itineraries:write')) {
    return {
      success: false,
      data: null,
      metadata: null,
      error: { code: 'FORBIDDEN', message: `Role ${ctx.role} lacks itineraries:write permission` },
    };
  }

  const startTime = Date.now();

  try {
    const proposalContext = await buildProposalContext(
      { ...params, itineraryVersionId: params.baseVersionId, staffInstruction: params.requestedChanges },
      ctx
    );

    if (!proposalContext.baseItineraryVersion) {
      return {
        success: false,
        data: null,
        metadata: null,
        error: { code: 'NOT_FOUND', message: `Base itinerary version ${params.baseVersionId} not found` },
      };
    }

    const prompt = `You are a professional luxury travel designer.
Revise the following existing itinerary version based on the requested modifications.

${proposalContext.formattedSystemPromptContext}

REQUESTED REVISION:
${params.requestedChanges}

CRITICAL RULES:
1. Output MUST be valid JSON matching the exact schema below.
2. Bind strictly to base version ID: "${params.baseVersionId}".
3. Provide a clear summary of all modifications made.
4. Keep unmodified days intact.
5. Record explicit assumptions and missing info.

REQUIRED JSON STRUCTURE:
{
  "baseItineraryId": "${params.baseItineraryId}",
  "baseVersionId": "${params.baseVersionId}",
  "baseVersionNumber": ${params.baseVersionNumber},
  "requestedChangeSummary": "${params.requestedChanges}",
  "proposedDraft": {
    "title": "Updated Title",
    "destinationSummary": "Summary",
    "startDate": null,
    "endDate": null,
    "durationDays": 5,
    "passengerCount": 2,
    "days": [],
    "inclusions": [],
    "exclusions": [],
    "grounding": { "sources": [], "assumptions": [], "missingInformation": [], "confidenceScore": 0.9 },
    "warnings": []
  },
  "modificationsSummary": ["Added private desert dinner on Day 3", "Extended tour by 1 day"],
  "grounding": {
    "sources": [{ "type": "itinerary_version", "id": "${params.baseVersionId}" }],
    "assumptions": [],
    "missingInformation": [],
    "confidenceScore": 0.95
  },
  "warnings": []
}`;

    const aiSettings: TenantSettings['ai'] = {
      defaultModel: options?.model || 'gpt-4o-mini',
      apiKeys: {},
      budgets: { monthlyBudget: 500 },
    };

    const aiRes = await callAIWithFallback({
      model: options?.model || 'gpt-4o-mini',
      prompt,
      feature: 'itinerary_revision_proposal',
      tenantAISettings: aiSettings,
      currentSpend: { daily: 0, monthly: 0 },
      maxTokens: 3500,
    });

    const parsedJson = JSON.parse(cleanJsonString(aiRes.text));
    const validated = AIItineraryRevisionProposalSchema.parse(parsedJson);

    const metadata: AIProposalMetadata = {
      proposalId: `prop-rev-${Date.now()}`,
      taskType: 'itinerary_revision',
      generatedAt: new Date().toISOString(),
      model: aiRes.model,
      provider: aiRes.provider,
      latencyMs: Date.now() - startTime,
      tokensIn: aiRes.tokensIn,
      tokensOut: aiRes.tokensOut,
      costEstimate: aiRes.costEstimate,
    };

    return {
      success: true,
      data: validated,
      metadata,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to generate itinerary revision proposal';
    let code = 'PROPOSAL_GENERATION_FAILED';
    if (message.startsWith('NOT_FOUND')) {
      code = 'NOT_FOUND';
    } else if (message.startsWith('FORBIDDEN') || message.startsWith('UNAUTHORIZED')) {
      code = 'FORBIDDEN';
    }
    return {
      success: false,
      data: null,
      metadata: null,
      error: { code, message },
    };
  }
}

// ============================================================================
// 3. GENERATE QUOTE LINE-ITEM PROPOSAL
// ============================================================================

export interface GenerateQuoteItemsParams extends ProposalContextParams {
  itineraryVersionId: string;
}

export async function generateQuoteLineItemsProposal(
  params: GenerateQuoteItemsParams,
  options?: GenerateProposalOptions
): Promise<AIProposalResult<AIQuoteLineItemProposal>> {
  const ctx = options?.overrideCtx || (await getAuthenticatedStaffContext());
  if (!can(ctx.role, 'quotes:write')) {
    return {
      success: false,
      data: null,
      metadata: null,
      error: { code: 'FORBIDDEN', message: `Role ${ctx.role} lacks quotes:write permission` },
    };
  }

  const startTime = Date.now();
  const proposalContext = await buildProposalContext(params, ctx);

  const prompt = `You are a travel commercial pricing assistant.
Suggest appropriate quote line items for the following inquiry and itinerary.

${proposalContext.formattedSystemPromptContext}

CRITICAL RULES:
1. Output MUST be valid JSON matching the exact schema below.
2. Categorize items into: accommodation, flight, activity, transfer, visa, fee, other.
3. If an item matches an official catalog item, reference its catalogReferenceId and set pricingSource: "authoritative_catalog".
4. If no exact verified price exists, set pricingSource: "estimate" or "missing" and provide suggestedUnitPrice.
5. Missing price items must be listed in missingPriceItems.
6. Authorized internal pricing: ${proposalContext.hasInternalPricingAccess ? 'YES (include supplier notes if any)' : 'NO (ZERO supplier costs)'}.

REQUIRED JSON STRUCTURE:
{
  "inquiryId": "${params.inquiryId}",
  "itineraryVersionId": "${params.itineraryVersionId}",
  "currency": "${proposalContext.inquiry.currency}",
  "suggestedItems": [
    {
      "title": "Luxury Resort Stay (5 Nights)",
      "description": "Oceanview suite with breakfast included",
      "category": "accommodation",
      "quantity": 1,
      "suggestedUnitPrice": "2500.00",
      "pricingSource": "estimate",
      "notes": "Subject to seasonal rate confirmation"
    }
  ],
  "missingPriceItems": ["Airport VIP fast-track"],
  "suggestedTermsAndConditions": "Deposit required upon acceptance. Final balance due 30 days prior to departure.",
  "suggestedCustomerNotes": "Thank you for choosing Rihla Travel.",
  "grounding": {
    "sources": [],
    "assumptions": ["Standard double occupancy"],
    "missingInformation": ["Specific flight carrier preference"],
    "confidenceScore": 0.85
  },
  "warnings": []
}`;

  const aiSettings: TenantSettings['ai'] = {
    defaultModel: options?.model || 'gpt-4o-mini',
    apiKeys: {},
    budgets: { monthlyBudget: 500 },
  };

  try {
    const aiRes = await callAIWithFallback({
      model: options?.model || 'gpt-4o-mini',
      prompt,
      feature: 'quote_line_items_proposal',
      tenantAISettings: aiSettings,
      currentSpend: { daily: 0, monthly: 0 },
      maxTokens: 2500,
    });

    const parsedJson = JSON.parse(cleanJsonString(aiRes.text));
    const validated = AIQuoteLineItemProposalSchema.parse(parsedJson);

    // Server-side verification of catalog items
    // Since knowledge_documents is unstructured text without numeric price fields,
    // all AI suggestions remain 'estimate' or 'missing' (never authoritative).
    const verifiedItems = await withPgClient(async (client) => {
      return Promise.all(
        validated.suggestedItems.map(async (item) => {
          const authoritativeUnitPrice: string | null = null;
          let pricingSource = item.pricingSource;

          if (item.catalogReferenceId) {
            // Verify tenant ownership of knowledge document reference
            const catRes = await client.query(
              `SELECT id, title FROM public.knowledge_documents WHERE id = $1 AND tenant_id = $2`,
              [item.catalogReferenceId, ctx.tenantId]
            );
            if (catRes.rows.length === 0) {
              // Cross-tenant or non-existent reference -> clear reference and downgrade to estimate
              pricingSource = 'estimate';
              item.catalogReferenceId = null;
            } else {
              // Knowledge document exists in tenant, but is unstructured text -> estimate
              pricingSource = 'estimate';
            }
          } else if (pricingSource === 'authoritative_catalog') {
            // Model claimed authoritative without verified structured record -> downgrade
            pricingSource = 'estimate';
          }

          // If suggested price is missing or null, mark as 'missing'
          if (!item.suggestedUnitPrice || item.suggestedUnitPrice.trim() === '') {
            pricingSource = 'missing';
          }

          return {
            ...item,
            pricingSource,
            authoritativeUnitPrice,
          };
        })
      );
    });

    validated.suggestedItems = verifiedItems;

    const metadata: AIProposalMetadata = {
      proposalId: `prop-quote-${Date.now()}`,
      taskType: 'quote_line_items',
      generatedAt: new Date().toISOString(),
      model: aiRes.model,
      provider: aiRes.provider,
      latencyMs: Date.now() - startTime,
      tokensIn: aiRes.tokensIn,
      tokensOut: aiRes.tokensOut,
      costEstimate: aiRes.costEstimate,
    };

    return {
      success: true,
      data: validated,
      metadata,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to generate quote line item proposal';
    return {
      success: false,
      data: null,
      metadata: null,
      error: { code: 'PROPOSAL_GENERATION_FAILED', message },
    };
  }
}

// ============================================================================
// 4. GENERATE QUOTE DIFFERENCE EXPLANATION (TWO-CONTEXT SEPARATION)
// ============================================================================

export interface GenerateDiffExplanationParams {
  quoteId: string;
  v1VersionId: string;
  v2VersionId: string;
}

export async function generateQuoteDifferenceExplanation(
  params: GenerateDiffExplanationParams,
  options?: GenerateProposalOptions
): Promise<AIProposalResult<AIQuoteDifferenceExplanation>> {
  const ctx = options?.overrideCtx || (await getAuthenticatedStaffContext());
  if (!can(ctx.role, 'quotes:read')) {
    return {
      success: false,
      data: null,
      metadata: null,
      error: { code: 'FORBIDDEN', message: `Role ${ctx.role} lacks quotes:read permission` },
    };
  }

  const startTime = Date.now();

  return withPgClient(async (client) => {
    // 1. Fetch raw versions (scoped to tenant)
    const res = await client.query(
      `SELECT qv.*, q.quote_number
       FROM public.quote_versions qv
       JOIN public.quotes q ON q.id = qv.quote_id
       WHERE qv.id IN ($1, $2) AND qv.tenant_id = $3`,
      [params.v1VersionId, params.v2VersionId, ctx.tenantId]
    );

    if (res.rows.length < 2) {
      return {
        success: false,
        data: null,
        metadata: null,
        error: { code: 'NOT_FOUND', message: 'One or both quote versions not found in tenant' },
      };
    }

    const row1 = res.rows.find((r) => r.id === params.v1VersionId);
    const row2 = res.rows.find((r) => r.id === params.v2VersionId);

    const v1: RawQuoteVersionForDiff = {
      quoteId: String(row1.quote_id),
      quoteNumber: String(row1.quote_number),
      id: String(row1.id),
      versionNumber: Number(row1.version_number),
      currency: String(row1.currency),
      itineraryVersionId: row1.itinerary_version_id ? String(row1.itinerary_version_id) : null,
      validUntil: row1.valid_until ? String(row1.valid_until) : null,
      termsAndConditions: row1.terms_and_conditions ? String(row1.terms_and_conditions) : null,
      subtotal: row1.subtotal,
      discountAmount: row1.discount_amount,
      taxAmount: row1.tax_amount,
      grandTotal: row1.grand_total,
      internalCostTotal: row1.internal_cost_total,
      grossMarginAmount: row1.gross_margin_amount,
      lineItems: Array.isArray(row1.line_items) ? row1.line_items : [],
    };

    const v2: RawQuoteVersionForDiff = {
      quoteId: String(row2.quote_id),
      quoteNumber: String(row2.quote_number),
      id: String(row2.id),
      versionNumber: Number(row2.version_number),
      currency: String(row2.currency),
      itineraryVersionId: row2.itinerary_version_id ? String(row2.itinerary_version_id) : null,
      validUntil: row2.valid_until ? String(row2.valid_until) : null,
      termsAndConditions: row2.terms_and_conditions ? String(row2.terms_and_conditions) : null,
      subtotal: row2.subtotal,
      discountAmount: row2.discount_amount,
      taxAmount: row2.tax_amount,
      grandTotal: row2.grand_total,
      internalCostTotal: row2.internal_cost_total,
      grossMarginAmount: row2.gross_margin_amount,
      lineItems: Array.isArray(row2.line_items) ? row2.line_items : [],
    };

    // 2. Compute pure deterministic diff
    const deterministicDiff = calculateQuoteDifference(v1, v2, ctx.role);

    // TWO-CONTEXT SEPARATION:
    // Pass 1: Customer-safe diff (ZERO supplier costs, margins, or internal notes in prompt)
    const customerSafeDiff = getCustomerSafeQuoteDiff(deterministicDiff);

    // Omit internal fields when serializing customer-safe JSON for prompt hygiene
    const cleanCustomerDiffJson = JSON.stringify(
      customerSafeDiff,
      (key, value) => {
        if (
          key === 'v1SupplierCost' ||
          key === 'v2SupplierCost' ||
          key === 'supplierCostDifference' ||
          key === 'v1InternalCostTotal' ||
          key === 'v2InternalCostTotal' ||
          key === 'internalCostDifference' ||
          key === 'v1GrossMarginAmount' ||
          key === 'v2GrossMarginAmount' ||
          key === 'grossMarginDifference'
        ) {
          return undefined;
        }
        return value;
      },
      2
    );

    const customerPrompt = `You are an expert commercial travel communicator.
Explain the following verified customer-facing differences between Quote ${v1.quoteNumber} v${v1.versionNumber} and v${v2.versionNumber}.

VERIFIED CUSTOMER-FACING DIFF (DO NOT ALTER ARITHMETIC):
${cleanCustomerDiffJson}

CRITICAL RULES:
1. Output MUST be valid JSON matching the exact schema below.
2. DO NOT recalculate numbers. Rely strictly on the verified customer-facing diff.
3. Provide an executive summary, key price drivers, scope changes, and a client-facing explanation.
4. DO NOT mention internal pricing, confidential margins, or markups under any circumstances.

REQUIRED JSON STRUCTURE:
{
  "executiveSummary": "Summary of total change",
  "keyPriceDrivers": ["Price driver 1", "Price driver 2"],
  "scopeChanges": ["Scope change 1"],
  "itineraryAlignmentNotes": "Notes if itinerary changed",
  "clientFacingExplanation": "Clear, friendly explanation suitable to send to the customer"
}`;

    const aiSettings: TenantSettings['ai'] = {
      defaultModel: options?.model || 'gpt-4o-mini',
      apiKeys: {},
      budgets: { monthlyBudget: 500 },
    };

    try {
      // Pass 1: Customer-safe model call (0 internal pricing info in prompt)
      const aiRes = await callAIWithFallback({
        model: options?.model || 'gpt-4o-mini',
        prompt: customerPrompt,
        feature: 'quote_diff_explanation',
        tenantAISettings: aiSettings,
        currentSpend: { daily: 0, monthly: 0 },
        maxTokens: 2000,
      });

      const parsedCustomer = JSON.parse(cleanJsonString(aiRes.text));

      // Factual & Numeric Bounding: Protect customer explanation from model hallucinated arithmetic or percentages
      const boundedClientExplanation = sanitizeCustomerExplanation(
        String(parsedCustomer.clientFacingExplanation || ''),
        deterministicDiff
      );

      // Pass 2: Internal Staff Notes (ONLY if caller is authorized for internal pricing)
      // For Consultant, Specialist, Viewer: internal provider call count is STRICTLY ZERO.
      let internalStaffNotes: string | null = null;
      if (can(ctx.role, 'quotes:internal_pricing:read')) {
        const internalPrompt = `You are an internal commercial travel analyst.
Analyze the following internal financial changes between Quote ${v1.quoteNumber} v${v1.versionNumber} and v${v2.versionNumber}.

INTERNAL FINANCIAL DIFF:
Currency: ${deterministicDiff.currency}
Subtotal Delta: ${deterministicDiff.subtotalDifference}
Supplier Cost Delta: ${deterministicDiff.internalCostDifference ?? '0.00'}
Gross Margin Delta: ${deterministicDiff.grossMarginDifference ?? '0.00'}
V1 Total Cost: ${deterministicDiff.v1InternalCostTotal ?? '0.00'} | V2 Total Cost: ${deterministicDiff.v2InternalCostTotal ?? '0.00'}
V1 Gross Margin: ${deterministicDiff.v1GrossMarginAmount ?? '0.00'} | V2 Gross Margin: ${deterministicDiff.v2GrossMarginAmount ?? '0.00'}

CRITICAL RULES:
1. Provide concise, strategic internal staff notes explaining margin and cost variances for agency management.
2. Clearly distinguish between volume changes, supplier cost adjustments, and margin changes.`;

        try {
          const internalAiRes = await callAIWithFallback({
            model: options?.model || 'gpt-4o-mini',
            prompt: internalPrompt,
            feature: 'quote_internal_explanation',
            tenantAISettings: aiSettings,
            currentSpend: { daily: 0, monthly: 0 },
            maxTokens: 1000,
          });
          internalStaffNotes = internalAiRes.text.trim();
        } catch {
          const costDelta = deterministicDiff.internalCostDifference ?? '0.00';
          const marginDelta = deterministicDiff.grossMarginDifference ?? '0.00';
          internalStaffNotes = `Internal Commercial Summary: Supplier cost delta is ${costDelta} ${deterministicDiff.currency}. Gross margin delta is ${marginDelta} ${deterministicDiff.currency}. Subtotal change: ${deterministicDiff.subtotalDifference} ${deterministicDiff.currency}.`;
        }
      }

      const explanationPayload: AIQuoteDifferenceExplanation = {
        quoteNumber: deterministicDiff.quoteNumber,
        v1VersionNumber: deterministicDiff.v1VersionNumber,
        v2VersionNumber: deterministicDiff.v2VersionNumber,
        executiveSummary: String(parsedCustomer.executiveSummary || 'Quote revised'),
        keyPriceDrivers: Array.isArray(parsedCustomer.keyPriceDrivers) ? parsedCustomer.keyPriceDrivers : ['Updated line items'],
        scopeChanges: Array.isArray(parsedCustomer.scopeChanges) ? parsedCustomer.scopeChanges : [],
        itineraryAlignmentNotes: parsedCustomer.itineraryAlignmentNotes ? String(parsedCustomer.itineraryAlignmentNotes) : null,
        clientFacingExplanation: boundedClientExplanation,
        internalStaffNotes,
        deterministicDiff,
        grounding: {
          sources: [
            { type: 'quote_version', id: v1.id },
            { type: 'quote_version', id: v2.id },
          ],
          assumptions: [],
          missingInformation: [],
          confidenceScore: 1.0,
        },
      };

      const validated = AIQuoteDifferenceExplanationSchema.parse(explanationPayload);

      const metadata: AIProposalMetadata = {
        proposalId: `prop-diff-${Date.now()}`,
        taskType: 'quote_difference_explanation',
        generatedAt: new Date().toISOString(),
        model: aiRes.model,
        provider: aiRes.provider,
        latencyMs: Date.now() - startTime,
        tokensIn: aiRes.tokensIn,
        tokensOut: aiRes.tokensOut,
        costEstimate: aiRes.costEstimate,
      };

      return {
        success: true,
        data: validated,
        metadata,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate quote difference explanation';
      return {
        success: false,
        data: null,
        metadata: null,
        error: { code: 'PROPOSAL_GENERATION_FAILED', message },
      };
    }
  });
}
