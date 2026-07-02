import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { AiUsageStore, createSupabaseUsageStore, UsageStoreUnavailableError } from '@/lib/ai/usage-store';
import { currentBillingPeriod } from '@/lib/ai/runtime';
import { AIUsageSchema, validateRequest } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  const guard = await guardRoute(request, {
    scope: 'ai-usage',
    permission: 'settings:audit:read',
  });
  if (guard instanceof NextResponse) return guard;

  const body = await request.json();
  const validation = validateRequest(AIUsageSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
  }

  const {
    feature,
    provider,
    model,
    tokensIn = 0,
    tokensOut = 0,
    costEstimate = 0,
    status = 'success',
    requestId,
  } = validation.data;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error } = await supabase.from('ai_usage').insert({
    tenant_id: guard.tenantId,
    user_id: guard.user.id,
    feature,
    provider,
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_estimate: costEstimate,
    status,
    request_id: requestId ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Record the usage in the durable shared store so per-period AI limit and
  // Premium spend-cap accounting survive serverless cold starts (Req 9.9).
  // Only successful calls count toward usage. Fail closed on store outage.
  if (status === 'success') {
    const usageStore = new AiUsageStore(createSupabaseUsageStore(supabase));
    const period = currentBillingPeriod();
    try {
      await usageStore.record({ tenantId: guard.tenantId, period, dimension: 'calls' }, 1);
      const cost = Number(costEstimate) || 0;
      if (cost > 0) {
        await usageStore.record({ tenantId: guard.tenantId, period, dimension: 'cost' }, cost);
      }
    } catch (storeErr) {
      if (storeErr instanceof UsageStoreUnavailableError) {
        return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
      }
      throw storeErr;
    }
  }

  return NextResponse.json({ ok: true });
}
