/**
 * CRM Copilot Proposal Integrity & Cryptographic Signatures (Phase AI-3)
 * 
 * Provides server-verifiable HMAC-SHA256 signatures for ActionProposalDTOs.
 * Guarantees exact proposal integrity between model proposal round, UI, and user confirmation.
 * Enforces a bounded 10-minute proposal lifetime (TTL).
 * 
 * ZERO DB migrations required.
 */
import crypto from 'crypto';
import type { ActionProposalDTO } from './types';

const SIGNING_SECRET =
  process.env.COPILOT_ACTION_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXTAUTH_SECRET ||
  'rihla-copilot-internal-action-hmac-salt-v1';

export const PROPOSAL_TTL_MS = 10 * 60 * 1000; // 10 minutes bounded TTL

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
 */
export function signProposal(proposal: Omit<ActionProposalDTO, 'signature'>): string {
  const payload = buildCanonicalProposalPayload(proposal);
  return crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('hex');
}

/**
 * Verifies that the proposal has a valid, untampered server signature.
 * Prevents client tampering with stage, assignee, follow-up date, or entity ID.
 */
export function verifyProposalSignature(proposal: ActionProposalDTO): boolean {
  if (!proposal.signature || typeof proposal.signature !== 'string') {
    return false;
  }

  const expected = signProposal(proposal);
  try {
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
