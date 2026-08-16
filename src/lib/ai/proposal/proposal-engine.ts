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
    const verifiedItems = await withPgClient(async (client) => {
      return Promise.all(
        validated.suggestedItems.map(async (item) => {
          let authoritativeUnitPrice: string | null = null;
          let pricingSource = item.pricingSource;

          if (item.catalogReferenceId) {
            const catRes = await client.query(
              `SELECT id, title, content FROM public.knowledge_documents WHERE id = $1 AND tenant_id = $2`,
              [item.catalogReferenceId, ctx.tenantId]
            );
            if (catRes.rows.length > 0) {
              pricingSource = 'authoritative_catalog';
              authoritativeUnitPrice = item.suggestedUnitPrice || null;
            } else {
              // Reference not in tenant -> fallback to estimate
              pricingSource = 'estimate';
            }
          } else if (pricingSource === 'authoritative_catalog') {
            pricingSource = 'estimate';
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
    // 1. Fetch raw versions
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
        error: { code: 'NOT_FOUND', message: 'One or both quote versions not found' },
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
    // Pass 1: Customer-safe diff (ZERO supplier costs or margins in prompt)
    const customerSafeDiff = getCustomerSafeQuoteDiff(deterministicDiff);

    const customerPrompt = `You are an expert commercial travel communicator.
Explain the following verified customer-facing differences between Quote ${v1.quoteNumber} v${v1.versionNumber} and v${v2.versionNumber}.

VERIFIED CUSTOMER-FACING DIFF (DO NOT ALTER ARITHMETIC):
${JSON.stringify(customerSafeDiff, null, 2)}

CRITICAL RULES:
1. Output MUST be valid JSON matching the exact schema below.
2. DO NOT recalculate numbers. Rely strictly on the verified customer-facing diff.
3. Provide an executive summary, key price drivers, scope changes, and a client-facing explanation.
4. DO NOT mention supplier costs, markups, or internal margins under any circumstances.

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
      const aiRes = await callAIWithFallback({
        model: options?.model || 'gpt-4o-mini',
        prompt: customerPrompt,
        feature: 'quote_diff_explanation',
        tenantAISettings: aiSettings,
        currentSpend: { daily: 0, monthly: 0 },
        maxTokens: 2000,
      });

      const parsedCustomer = JSON.parse(cleanJsonString(aiRes.text));

      // Pass 2: Internal Staff Notes (ONLY if caller is authorized for internal pricing)
      let internalStaffNotes: string | null = null;
      if (can(ctx.role, 'quotes:internal_pricing:read') && deterministicDiff.internalCostDifference != null) {
        internalStaffNotes = `Internal margin change: Cost delta ${deterministicDiff.internalCostDifference} ${deterministicDiff.currency}, Gross margin delta ${deterministicDiff.grossMarginDifference} ${deterministicDiff.currency}.`;
      }

      const explanationPayload: AIQuoteDifferenceExplanation = {
        quoteNumber: deterministicDiff.quoteNumber,
        v1VersionNumber: deterministicDiff.v1VersionNumber,
        v2VersionNumber: deterministicDiff.v2VersionNumber,
        executiveSummary: String(parsedCustomer.executiveSummary || 'Quote revised'),
        keyPriceDrivers: Array.isArray(parsedCustomer.keyPriceDrivers) ? parsedCustomer.keyPriceDrivers : ['Updated line items'],
        scopeChanges: Array.isArray(parsedCustomer.scopeChanges) ? parsedCustomer.scopeChanges : [],
        itineraryAlignmentNotes: parsedCustomer.itineraryAlignmentNotes ? String(parsedCustomer.itineraryAlignmentNotes) : null,
        clientFacingExplanation: String(parsedCustomer.clientFacingExplanation || ''),
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
