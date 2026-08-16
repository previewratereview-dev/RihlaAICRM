'use server';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import {
  validateAttentionAuth,
  getTenantAttentionSummary,
  loadInquiryAttentionFact,
  loadConversationAttentionFacts,
} from '@/lib/attention/loader';
import {
  evaluateInquiryAttention,
  evaluateConversationAttention,
  sortAttentionSignals,
} from '@/lib/attention/engine';
import type { AttentionSignal, TenantAttentionSummary } from '@/lib/attention/types';

export interface GetTenantAttentionResult {
  success: boolean;
  summary?: TenantAttentionSummary;
  signals?: AttentionSignal[];
  error?: string;
}

export interface GetInquiryAttentionResult {
  success: boolean;
  signals?: AttentionSignal[];
  error?: string;
}

/**
 * Server Action: Get all tenant-wide attention signals and summary.
 * Authoritative: Derives tenant and role strictly from authenticated session/profile.
 * Super Admin fails closed with 403.
 */
export async function getTenantAttentionAction(): Promise<GetTenantAttentionResult> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const authCheck = await validateAttentionAuth(supabase);
    if (!authCheck.success || !authCheck.auth) {
      return { success: false, error: authCheck.error || 'Unauthorized' };
    }

    const summary = await getTenantAttentionSummary(
      supabase,
      authCheck.auth.tenantId,
      new Date()
    );

    return {
      success: true,
      summary,
      signals: summary.signals,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to evaluate tenant attention';
    return { success: false, error: message };
  }
}

/**
 * Server Action: Get attention signals for a specific Inquiry.
 * Authoritative: Enforces tenant isolation and evaluates inquiry + linked conversations.
 */
export async function getInquiryAttentionAction(
  inquiryId: string
): Promise<GetInquiryAttentionResult> {
  try {
    if (!inquiryId) {
      return { success: false, error: 'Inquiry ID is required' };
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const authCheck = await validateAttentionAuth(supabase);
    if (!authCheck.success || !authCheck.auth) {
      return { success: false, error: authCheck.error || 'Unauthorized' };
    }

    const inqFact = await loadInquiryAttentionFact(
      supabase,
      authCheck.auth.tenantId,
      inquiryId
    );

    if (!inqFact) {
      return { success: true, signals: [] };
    }

    const inqSignals = evaluateInquiryAttention(inqFact, new Date());

    const convFacts = await loadConversationAttentionFacts(
      supabase,
      authCheck.auth.tenantId,
      inquiryId
    );

    const convSignals = convFacts
      .map((f) => evaluateConversationAttention(f))
      .filter((s): s is AttentionSignal => s !== null);

    const allSignals = sortAttentionSignals([...inqSignals, ...convSignals]);

    return {
      success: true,
      signals: allSignals,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to evaluate inquiry attention';
    return { success: false, error: message };
  }
}
