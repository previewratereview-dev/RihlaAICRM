import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformSuperAdmin } from '@/lib/auth/api-guard';
import { recordAuditEvent } from '@/lib/security/audit-log';

/**
 * Validates that the request origin matches the host header to prevent CSRF.
 */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

/**
 * The tenant-owned tables whose rows must be removed when an Agency is deleted,
 * in child-before-parent order to satisfy foreign-key constraints.
 */
const TENANT_CHILD_TABLES_IN_DELETE_ORDER: readonly string[] = [
  'messages',
  'notes',
  'activities',
  'conversations',
  'tasks',
  'leads',
  'ai_usage',
  'faq_entries',
  'knowledge_documents',
  'settings',
  'documents',
  'files',
  'secret_store',
  'invitations',
  'integration_credentials',
  'roles',
  'subscriptions',
  'profiles',
];

/**
 * PATCH /api/platform/agencies/[id]
 *
 * Super-admin only endpoint to edit an existing Agency tenant (name, domain, colors, settings, plan, status).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request forbidden' }, { status: 403 });
  }

  // 1. Authorize super_admin
  const auth = await requirePlatformSuperAdmin(request, 'agencies:manage');
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { id } = await params;
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return NextResponse.json({ error: 'Invalid or missing agency identifier' }, { status: 400 });
  }

  // 2. Parse & Validate Payload
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3. Authoritative target lookup
  const { data: existingTenant, error: fetchError } = await supabase
    .from('tenants')
    .select('*, subscriptions(plan, status)')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !existingTenant) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  // 4. Extract allowlisted fields only
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.name === 'string' && body.name.trim().length >= 2) {
    updatePayload.name = body.name.trim();
  }
  if (typeof body.domain === 'string') {
    updatePayload.domain = body.domain.trim() || null;
  }
  if (typeof body.primaryColor === 'string') {
    updatePayload.primary_color = body.primaryColor.trim();
  }
  if (typeof body.customPrompt === 'string') {
    updatePayload.custom_prompt = body.customPrompt.trim();
  }
  if (typeof body.status === 'string' && ['active', 'suspended'].includes(body.status.trim().toLowerCase())) {
    updatePayload.status = body.status.trim().toLowerCase();
  }

  // Merge settings if provided
  let newSettings: Record<string, unknown> | undefined;
  if (body.aiBudget !== undefined || body.features !== undefined) {
    const prevSettings = (existingTenant.settings as Record<string, unknown>) || {};
    newSettings = { ...prevSettings };
    if (typeof body.aiBudget === 'number' && body.aiBudget >= 0) {
      newSettings.aiBudget = body.aiBudget;
    }
    if (typeof body.features === 'object' && body.features !== null) {
      newSettings.features = body.features;
    }
    updatePayload.settings = newSettings;
  }

  // 5. Update Tenant Record
  const { data: updatedTenant, error: updateError } = await supabase
    .from('tenants')
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single();

  if (updateError || !updatedTenant) {
    return NextResponse.json({ error: `Failed to update agency: ${updateError?.message || 'Unknown database error'}` }, { status: 500 });
  }

  // 6. Update Subscription if plan or status provided
  let finalPlan = (existingTenant.subscriptions as { plan?: string } | null)?.plan || 'free';
  if (typeof body.plan === 'string' && ['free', 'starter', 'growth', 'enterprise', 'custom', 'scale'].includes(body.plan.trim().toLowerCase())) {
    finalPlan = body.plan.trim().toLowerCase();
    try {
      await supabase.from('subscriptions').upsert(
        {
          tenant_id: id,
          plan: finalPlan,
          status: updatePayload.status ? (updatePayload.status as string) : 'active',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id' }
      );
    } catch (subError) {
      console.warn('[PlatformAgencies] Subscription update warning:', subError);
    }
  }

  // 7. Record Audit Event
  try {
    const isStatusOnly = Object.keys(body).length === 1 && body.status !== undefined;
    const action = isStatusOnly
      ? (body.status === 'suspended' ? 'agency.suspended' : 'agency.reinstated')
      : 'agency.updated';

    await recordAuditEvent(supabase, {
      actor: auth.authUserId,
      action,
      target: id,
      tenantId: id,
      details: {
        updatedFields: Object.keys(body),
        status: updatedTenant.status,
        plan: finalPlan,
      },
    });
  } catch (auditError) {
    console.warn('[PlatformAgencies] Audit log write warning:', auditError);
  }

  return NextResponse.json({
    success: true,
    tenant: {
      id: updatedTenant.id,
      name: updatedTenant.name,
      slug: updatedTenant.slug,
      domain: updatedTenant.domain,
      status: updatedTenant.status,
      primaryColor: updatedTenant.primary_color,
      customPrompt: updatedTenant.custom_prompt,
      settings: updatedTenant.settings,
      plan: finalPlan,
      updatedAt: updatedTenant.updated_at,
    },
  });
}

/**
 * DELETE /api/platform/agencies/[id]
 *
 * Super-admin only endpoint to permanently delete an Agency tenant and clean up child records.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request forbidden' }, { status: 403 });
  }

  // 1. Authorize super_admin
  const auth = await requirePlatformSuperAdmin(request, 'agencies:delete');
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { id } = await params;
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return NextResponse.json({ error: 'Invalid or missing agency identifier' }, { status: 400 });
  }

  // 2. Protected tenant restriction
  if (id === 'global' || id === 'platform') {
    return NextResponse.json({ error: 'System tenant cannot be deleted' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3. Authoritative target lookup
  const { data: existingTenant, error: fetchError } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !existingTenant) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  // 4. Perform structured child cleanup then tenant delete
  try {
    for (const table of TENANT_CHILD_TABLES_IN_DELETE_ORDER) {
      await supabase.from(table).delete().eq('tenant_id', id);
    }

    const { error: tenantDeleteError } = await supabase
      .from('tenants')
      .delete()
      .eq('id', id);

    if (tenantDeleteError) {
      return NextResponse.json({ error: `Failed to delete agency: ${tenantDeleteError.message}` }, { status: 500 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown database error';
    return NextResponse.json({ error: `Deletion failed: ${msg}` }, { status: 500 });
  }

  // 5. Record Audit Event
  try {
    await recordAuditEvent(supabase, {
      actor: auth.authUserId,
      action: 'agency.deleted',
      target: id,
      tenantId: id,
      details: { deletedAgencyName: existingTenant.name },
    });
  } catch (auditError) {
    console.warn('[PlatformAgencies] Audit log write warning:', auditError);
  }

  return NextResponse.json({
    success: true,
    deletedId: id,
  });
}
