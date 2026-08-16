'use server';

/**
 * Phase AI-5C.3: Server Actions for AI Quote Proposals & Commercial Explanations
 * 
 * Provides server-authoritative entry points for:
 * 1. Generating ephemeral AI quote line-item suggestions grounded in inquiry facts.
 * 2. Generating customer-safe and internal commercial difference explanations between quote versions.
 * 3. Checking quote version freshness and concurrency locks.
 * 
 * Invariants:
 * - Server-Authoritative: Identity, permissions, and tenant isolation strictly checked.
 * - Zero Autonomous Commercial Mutations: AI operations do NOT persist quote state or mutate prices.
 * - Two-Context Separation: Customer explanation context never receives supplier costs or margins.
 * - Stale Version Protection: Freshness check rejects stale base versions before proposal staging.
 */

import { getAuthenticatedStaffContext, withPgClient } from '@/app/actions/inquiry-lifecycle';
import { can } from '@/lib/permissions';
import {
  generateQuoteLineItemsProposal,
  generateQuoteDifferenceExplanation,
  type AIQuoteLineItemProposal,
  type AIQuoteDifferenceExplanation,
  type AIProposalMetadata,
} from '@/lib/ai/proposal';

export interface GenerateQuoteProposalInput {
  inquiryId: string;
  itineraryVersionId: string;
  staffInstruction?: string | null;
  model?: string;
}

export interface GenerateQuoteDiffExplanationInput {
  quoteId: string;
  v1VersionId: string;
  v2VersionId: string;
  model?: string;
}

export interface AIQuoteProposalResponse {
  success: boolean;
  proposal: AIQuoteLineItemProposal | null;
  metadata: AIProposalMetadata | null;
  error?: {
    code: string;
    message: string;
  };
}

export interface AIQuoteDiffExplanationResponse {
  success: boolean;
  explanation: AIQuoteDifferenceExplanation | null;
  metadata: AIProposalMetadata | null;
  error?: {
    code: string;
    message: string;
  };
}

export interface QuoteFreshnessCheckResponse {
  isFresh: boolean;
  currentLockVersion: number | null;
  currentVersionNumber: number | null;
  currentStatus: string | null;
}

/**
 * Generates structured, grounded AI quote line item suggestions.
 * Ephemeral: Does NOT mutate the database.
 */
export async function generateQuoteProposalAction(
  input: GenerateQuoteProposalInput
): Promise<AIQuoteProposalResponse> {
  const ctx = await getAuthenticatedStaffContext();

  if (!can(ctx.role, 'quotes:write')) {
    return {
      success: false,
      proposal: null,
      metadata: null,
      error: {
        code: 'FORBIDDEN',
        message: `Role ${ctx.role} lacks quotes:write permission to generate quote suggestions.`,
      },
    };
  }

  // Verify itinerary version exists and is finalized in tenant
  const isItineraryValid = await withPgClient(async (client) => {
    const res = await client.query(
      `SELECT status FROM public.itinerary_versions WHERE id = $1 AND tenant_id = $2`,
      [input.itineraryVersionId, ctx.tenantId]
    );
    if (res.rows.length === 0) return { found: false, finalized: false };
    return { found: true, finalized: res.rows[0].status === 'finalized' };
  });

  if (!isItineraryValid.found) {
    return {
      success: false,
      proposal: null,
      metadata: null,
      error: {
        code: 'NOT_FOUND',
        message: `Selected itinerary version ${input.itineraryVersionId} not found in tenant.`,
      },
    };
  }

  if (!isItineraryValid.finalized) {
    return {
      success: false,
      proposal: null,
      metadata: null,
      error: {
        code: 'INVALID_ATTACHMENT',
        message: 'Quotes can only be attached to finalized itinerary programs.',
      },
    };
  }

  const result = await generateQuoteLineItemsProposal(
    {
      inquiryId: input.inquiryId,
      itineraryVersionId: input.itineraryVersionId,
      staffInstruction: input.staffInstruction || null,
      includeKnowledge: true,
    },
    {
      model: input.model,
      overrideCtx: ctx,
    }
  );

  if (!result.success || !result.data) {
    return {
      success: false,
      proposal: null,
      metadata: result.metadata,
      error: result.error || {
        code: 'PROPOSAL_FAILED',
        message: 'Failed to generate quote suggestions.',
      },
    };
  }

  return {
    success: true,
    proposal: result.data,
    metadata: result.metadata,
  };
}

/**
 * Generates a deterministic difference explanation between two quote versions.
 * Uses two-context separation (customer-safe vs internal).
 */
export async function generateQuoteDiffExplanationAction(
  input: GenerateQuoteDiffExplanationInput
): Promise<AIQuoteDiffExplanationResponse> {
  const ctx = await getAuthenticatedStaffContext();

  if (!can(ctx.role, 'quotes:read')) {
    return {
      success: false,
      explanation: null,
      metadata: null,
      error: {
        code: 'FORBIDDEN',
        message: `Role ${ctx.role} lacks quotes:read permission.`,
      },
    };
  }

  const result = await generateQuoteDifferenceExplanation(
    {
      quoteId: input.quoteId,
      v1VersionId: input.v1VersionId,
      v2VersionId: input.v2VersionId,
    },
    {
      model: input.model,
      overrideCtx: ctx,
    }
  );

  if (!result.success || !result.data) {
    return {
      success: false,
      explanation: null,
      metadata: result.metadata,
      error: result.error || {
        code: 'DIFF_EXPLANATION_FAILED',
        message: 'Failed to generate quote difference explanation.',
      },
    };
  }

  return {
    success: true,
    explanation: result.data,
    metadata: result.metadata,
  };
}

/**
 * Checks whether a base quote version has been updated or modified concurrently.
 */
export async function checkQuoteVersionFreshnessAction(
  versionId: string,
  expectedLockVersion: number
): Promise<QuoteFreshnessCheckResponse> {
  const ctx = await getAuthenticatedStaffContext();

  return withPgClient(async (client) => {
    const res = await client.query(
      `SELECT lock_version, version_number, status FROM public.quote_versions WHERE id = $1 AND tenant_id = $2`,
      [versionId, ctx.tenantId]
    );

    if (res.rows.length === 0) {
      return {
        isFresh: false,
        currentLockVersion: null,
        currentVersionNumber: null,
        currentStatus: null,
      };
    }

    const row = res.rows[0];
    const currentLock = Number(row.lock_version || 0);

    return {
      isFresh: currentLock === expectedLockVersion,
      currentLockVersion: currentLock,
      currentVersionNumber: Number(row.version_number),
      currentStatus: String(row.status),
    };
  });
}
