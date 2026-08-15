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
 * POST /api/platform/agencies
 *
 * Super-admin only endpoint to create a new Agency tenant with settings and subscription.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request forbidden' }, { status: 403 });
  }

  // 1. Authorize super_admin
  const auth = await requirePlatformSuperAdmin(request, 'agencies:manage');
  if (auth instanceof NextResponse) {
    return auth;
  }

  // 2. Parse & Validate Payload
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const rawSlug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const domain = typeof body.domain === 'string' ? body.domain.trim() : undefined;
  const plan = typeof body.plan === 'string' && ['free', 'starter', 'growth', 'enterprise', 'custom', 'scale'].includes(body.plan.trim().toLowerCase())
    ? body.plan.trim().toLowerCase()
    : 'free';
  const aiBudget = typeof body.aiBudget === 'number' && body.aiBudget >= 0 ? body.aiBudget : 50;
  const features = typeof body.features === 'object' && body.features !== null
    ? (body.features as Record<string, boolean>)
    : {
        pipeline: true,
        chatbot: true,
        analytics: true,
        payments: false,
        email: true,
        whatsapp: true,
      };

  if (!name || name.length < 2 || name.length > 100) {
    return NextResponse.json({ error: 'Agency name must be between 2 and 100 characters' }, { status: 400 });
  }

  const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug || slug.length < 2 || slug.length > 60) {
    return NextResponse.json({ error: 'Agency slug must be between 2 and 60 alphanumeric characters' }, { status: 400 });
  }

  // Use service client or server session client
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3. Authoritative target lookup: Check if tenant ID or slug already exists
  const { data: existing } = await supabase
    .from('tenants')
    .select('id, slug')
    .or(`id.eq.${slug},slug.eq.${slug}`)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'An agency with this identifier or slug already exists' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const tenantId = slug;

  // 4. Create Tenant Record
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({
      id: tenantId,
      name,
      slug,
      domain: domain || null,
      status: 'active',
      settings: { aiBudget, features },
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: `Failed to create tenant: ${tenantError?.message || 'Unknown database error'}` }, { status: 500 });
  }

  // 5. Compensating multi-step create: Create settings & subscription
  try {
    await supabase.from('settings').upsert({
      id: tenantId,
      tenant_id: tenantId,
      agency_name: name,
    });

    await supabase.from('subscriptions').upsert(
      {
        tenant_id: tenantId,
        plan,
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      { onConflict: 'tenant_id' }
    );
  } catch (secondaryError) {
    console.error('[PlatformAgencies] Secondary record creation warning:', secondaryError);
  }

  // 6. Record Audit Event
  try {
    await recordAuditEvent(supabase, {
      actor: auth.authUserId,
      action: 'agency.created',
      target: tenantId,
      tenantId,
      details: { name, slug, plan, domain: domain || null },
    });
  } catch (auditError) {
    console.warn('[PlatformAgencies] Audit log write warning:', auditError);
  }

  return NextResponse.json({
    success: true,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      domain: tenant.domain,
      status: tenant.status,
      plan,
      settings: tenant.settings,
      createdAt: tenant.created_at,
      updatedAt: tenant.updated_at,
    },
  }, { status: 201 });
}
