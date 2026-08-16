'use server';

/**
 * Phase AI-5C.2: Server Actions for AI Itinerary Proposals & Revisions
 * 
 * Provides server-authoritative entry points for generating and reviewing
 * ephemeral AI itinerary proposals without mutating CRM state directly.
 */

import { getAuthenticatedStaffContext, withPgClient } from '@/app/actions/inquiry-lifecycle';
import { can } from '@/lib/permissions';
import {
  generateItineraryDraftProposal,
  generateItineraryRevisionProposal,
  type AIItineraryDraftProposal,
  type AIItineraryRevisionProposal,
  type AIProposalMetadata,
  calculateItineraryStructuralDiff,
  type ItineraryStructuralDiff,
} from '@/lib/ai/proposal';
import type { ItineraryVersionEntity } from '@/lib/quotes-itineraries/types';

export interface GenerateItineraryProposalInput {
  inquiryId: string;
  staffInstruction?: string | null;
  model?: string;
}

export interface GenerateItineraryRevisionProposalInput {
  inquiryId: string;
  baseItineraryId: string;
  baseVersionId: string;
  baseVersionNumber: number;
  expectedLockVersion: number;
  requestedChanges: string;
  model?: string;
}

export interface AIItineraryProposalResponse {
  success: boolean;
  proposal: AIItineraryDraftProposal | null;
  metadata: AIProposalMetadata | null;
  error?: {
    code: string;
    message: string;
  };
}

export interface AIItineraryRevisionResponse {
  success: boolean;
  revision: AIItineraryRevisionProposal | null;
  structuralDiff: ItineraryStructuralDiff | null;
  metadata: AIProposalMetadata | null;
  error?: {
    code: string;
    message: string;
  };
}

export interface FreshnessCheckResponse {
  isFresh: boolean;
  currentLockVersion: number | null;
  currentVersionNumber: number | null;
  currentStatus: string | null;
}

/**
 * Generates an initial structured AI itinerary draft proposal for an inquiry.
 */
export async function generateItineraryProposalAction(
  input: GenerateItineraryProposalInput
): Promise<AIItineraryProposalResponse> {
  const ctx = await getAuthenticatedStaffContext();

  if (!can(ctx.role, 'itineraries:write')) {
    return {
      success: false,
      proposal: null,
      metadata: null,
      error: {
        code: 'FORBIDDEN',
        message: `Role ${ctx.role} lacks itineraries:write permission to generate proposals.`,
      },
    };
  }

  const result = await generateItineraryDraftProposal(
    {
      inquiryId: input.inquiryId,
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
        message: 'Failed to generate itinerary proposal.',
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
 * Generates an AI itinerary revision proposal against a specific base version.
 */
export async function generateItineraryRevisionProposalAction(
  input: GenerateItineraryRevisionProposalInput
): Promise<AIItineraryRevisionResponse> {
  const ctx = await getAuthenticatedStaffContext();

  if (!can(ctx.role, 'itineraries:write')) {
    return {
      success: false,
      revision: null,
      structuralDiff: null,
      metadata: null,
      error: {
        code: 'FORBIDDEN',
        message: `Role ${ctx.role} lacks itineraries:write permission to generate revisions.`,
      },
    };
  }

  return withPgClient(async (client) => {
    // 1. Verify base version exists and belongs to tenant
    const ivRes = await client.query(
      `SELECT * FROM public.itinerary_versions WHERE id = $1 AND tenant_id = $2`,
      [input.baseVersionId, ctx.tenantId]
    );

    if (ivRes.rows.length === 0) {
      return {
        success: false,
        revision: null,
        structuralDiff: null,
        metadata: null,
        error: {
          code: 'NOT_FOUND',
          message: `Base itinerary version ${input.baseVersionId} not found in tenant.`,
        },
      };
    }

    const baseRow = ivRes.rows[0];
    const currentLockVersion = Number(baseRow.lock_version || 0);

    // Stale version check
    if (input.expectedLockVersion != null && currentLockVersion !== input.expectedLockVersion) {
      return {
        success: false,
        revision: null,
        structuralDiff: null,
        metadata: null,
        error: {
          code: 'STALE_VERSION',
          message: `Itinerary version has changed (current lock_version: ${currentLockVersion}, expected: ${input.expectedLockVersion}). Please refresh before generating a revision.`,
        },
      };
    }

    // 2. Generate proposal
    const result = await generateItineraryRevisionProposal(
      {
        inquiryId: input.inquiryId,
        baseItineraryId: input.baseItineraryId,
        baseVersionId: input.baseVersionId,
        baseVersionNumber: input.baseVersionNumber,
        requestedChanges: input.requestedChanges,
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
        revision: null,
        structuralDiff: null,
        metadata: result.metadata,
        error: result.error || {
          code: 'REVISION_FAILED',
          message: 'Failed to generate itinerary revision proposal.',
        },
      };
    }

    // 3. Compute deterministic structural diff between base and proposal
    const baseDays: ItineraryVersionEntity['days'] = Array.isArray(baseRow.days) ? baseRow.days : [];
    const structuralDiff = calculateItineraryStructuralDiff(
      baseDays,
      result.data.proposedDraft.days || []
    );

    return {
      success: true,
      revision: result.data,
      structuralDiff,
      metadata: result.metadata,
    };
  });
}

/**
 * Checks whether a base itinerary version has been updated or superseded.
 */
export async function checkItineraryVersionFreshnessAction(
  versionId: string,
  expectedLockVersion: number
): Promise<FreshnessCheckResponse> {
  const ctx = await getAuthenticatedStaffContext();

  return withPgClient(async (client) => {
    const res = await client.query(
      `SELECT lock_version, version_number, status FROM public.itinerary_versions WHERE id = $1 AND tenant_id = $2`,
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
