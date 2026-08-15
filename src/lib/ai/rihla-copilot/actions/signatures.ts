/**
 * CRM Copilot Proposal Integrity & Cryptographic Signatures (Phase AI-3A)
 * 
 * Provides server-verifiable HMAC-SHA256 signatures for ActionProposalDTOs.
 * Guarantees exact proposal integrity between model proposal round, UI, and user confirmation.
 * Enforces a bounded 10-minute proposal lifetime (TTL).
 * 
 * SECURITY INVARIANTS:
 * - Secret MUST come exclusively from COPILOT_ACTION_SECRET.
 * - ZERO fallback to SUPABASE_SERVICE_ROLE_KEY, NEXTAUTH_SECRET, or hardcoded strings.
 * - Fails CLOSED if COPILOT_ACTION_SECRET is missing or empty.
 */
import crypto from 'crypto';
import type { ActionProposalDTO } from './types';

export const PROPOSAL_TTL_MS = 10 * 60 * 1000; // 10 minutes bounded TTL

/**
 * Resolves the server-only HMAC signing secret.
 * STRICT: Only reads process.env.COPILOT_ACTION_SECRET. Zero fallback to other credentials or salts.
 */
export function getActionSigningSecret(): string | null {
  const secret = process.env.COPILOT_ACTION_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    return null;
  }
  return secret.trim();
}

/**
 * Checks whether action signing is configured on the server.
 */
export function isActionSigningConfigured(): boolean {
  return getActionSigningSecret() !== null;
}

/**
 * Builds a deterministic canonical string representing execution-significant fields.
 */
export function buildCanonicalProposalPayload(proposal: Omit<ActionProposalDTO, 'signature'>): string {
  return [
    proposal.proposalId,
    proposal.actionType,
    proposal.entityType,
    proposal.entityId,
    JSON.stringify(proposal.currentState),
    JSON.stringify(proposal.proposedState),
    proposal.createdAt,
  ].join('|');
}

/**
 * Computes an HMAC-SHA256 signature for an ActionProposalDTO.
 * Throws if COPILOT_ACTION_SECRET is not configured (fails closed).
 */
export function signProposal(proposal: Omit<ActionProposalDTO, 'signature'>): string {
  const secret = getActionSigningSecret();
  if (!secret) {
    throw new Error('COPILOT_ACTION_SECRET is not configured on the server. Action signing is unavailable.');
  }
  const payload = buildCanonicalProposalPayload(proposal);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verifies that the proposal has a valid, untampered server signature.
 * Prevents client tampering with stage, assignee, follow-up date, or entity ID.
 * Returns false if COPILOT_ACTION_SECRET is unconfigured (fails closed).
 */
export function verifyProposalSignature(proposal: ActionProposalDTO): boolean {
  if (!proposal.signature || typeof proposal.signature !== 'string') {
    return false;
  }

  const secret = getActionSigningSecret();
  if (!secret) {
    return false; // Fails closed if secret is unconfigured
  }

  try {
    const expected = signProposal(proposal);
    const a = Buffer.from(proposal.signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validates that the proposal has not expired.
 */
export function isProposalExpired(proposal: ActionProposalDTO): boolean {
  const createdTime = new Date(proposal.createdAt).getTime();
  if (isNaN(createdTime)) return true;
  const age = Date.now() - createdTime;
  return age < 0 || age > PROPOSAL_TTL_MS;
}
