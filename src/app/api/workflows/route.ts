import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@supabase/supabase-js';
import { WorkflowUpsertSchema, validateRequest } from '@/lib/validation/schemas';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

function getServiceClient() {
  if (!serviceKey || !supabaseUrl) return null;
  return createClient(supabaseUrl, serviceKey);
}

export async function GET(request: NextRequest) {
  const guard = await guardRoute(request, { scope: 'workflows' });
  if (guard instanceof NextResponse) return guard;

  const supabase = getServiceClient();
  if (!supabase) {
    const { DEFAULT_WORKFLOW_RULES } = await import('@/lib/automation/triggers');
    return NextResponse.json({ rules: DEFAULT_WORKFLOW_RULES, source: 'default' });
  }

  const { data } = await supabase.from('workflow_rules').select('*').eq('tenant_id', guard.tenantId);
  return NextResponse.json({ rules: data || [], source: 'database' });
}

export async function POST(request: NextRequest) {
  try {
    const guard = await guardRoute(request, { scope: 'workflows' });
    if (guard instanceof NextResponse) return guard;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = validateRequest(WorkflowUpsertSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const { rules } = validation.data;

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, mode: 'local', count: rules.length });
  }

  for (const rule of rules) {
    await supabase.from('workflow_rules').upsert({
      id: rule.id,
      tenant_id: guard.tenantId,
      name: rule.name,
      enabled: rule.enabled,
      trigger_type: rule.triggerType,
      conditions: rule.conditions,
      actions: rule.actions,
      updated_at: new Date().toISOString(),
    });
  }

  return NextResponse.json({ ok: true, count: rules.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workflow save failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
