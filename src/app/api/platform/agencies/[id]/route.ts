import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformSuperAdmin } from '@/lib/auth/api-guard';

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
 * PATCH /api/platform/agencies/[id]
 *
 * Super-admin only endpoint to edit an existing Agency tenant atomically via transactional RPC.
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

  const name = typeof body.name === 'string' && body.name.trim().length >= 2 ? body.name.trim() : null;
  const domain = typeof body.domain === 'string' ? body.domain.trim() || null : null;
  const primaryColor = typeof body.primaryColor === 'string' ? body.primaryColor.trim() : null;
  const customPrompt = typeof body.customPrompt === 'string' ? body.customPrompt.trim() : null;
  const plan = typeof body.plan === 'string' ? body.plan.trim().toLowerCase() : null;
  const aiBudget = typeof body.aiBudget === 'number' && body.aiBudget >= 0 ? body.aiBudget : null;
  const features = typeof body.features === 'object' && body.features !== null ? (body.features as Record<string, boolean>) : null;
  const status = typeof body.status === 'string' && ['active', 'suspended'].includes(body.status.trim().toLowerCase())
    ? body.status.trim().toLowerCase()
    : null;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3. Invoke Atomic Transactional Edit RPC (Fail-Closed: No sequential fallback)
  const { data: updatedTenant, error: rpcError } = await supabase.rpc(
    'platform_edit_agency_atomic' as never,
    {
      p_tenant_id: id,
      p_name: name,
      p_domain: domain,
      p_primary_color: primaryColor,
      p_custom_prompt: customPrompt,
      p_plan: plan,
      p_ai_budget: aiBudget,
      p_features: features,
      p_status: status,
    } as never
  );

  if (rpcError) {
    if (rpcError.code === 'P0002' || rpcError.message?.toLowerCase().includes('not exist') || rpcError.message?.toLowerCase().includes('not found')) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
    }
    if (rpcError.code === '22023' || rpcError.message?.toLowerCase().includes('validation')) {
      return NextResponse.json({ error: rpcError.message }, { status: 400 });
    }
    if (rpcError.code === '42501' || rpcError.message?.toLowerCase().includes('forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: `Failed to update agency: ${rpcError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    tenant: updatedTenant,
  });
}

/**
 * DELETE /api/platform/agencies/[id]
 *
 * Super-admin only endpoint to permanently delete an Agency tenant atomically via transactional RPC.
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

  // 3. Invoke Atomic Transactional Delete RPC (Fail-Closed: No sequential fallback)
  const { data: result, error: rpcError } = await supabase.rpc(
    'platform_delete_agency_atomic' as never,
    {
      p_tenant_id: id,
    } as never
  );

  if (rpcError) {
    if (rpcError.code === 'P0002' || rpcError.message?.toLowerCase().includes('not exist') || rpcError.message?.toLowerCase().includes('not found')) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
    }
    if (rpcError.code === '42501' || rpcError.message?.toLowerCase().includes('cannot be deleted')) {
      return NextResponse.json({ error: rpcError.message }, { status: 400 });
    }
    return NextResponse.json({ error: `Deletion failed: ${rpcError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    deletedId: (result as { deletedId?: string })?.deletedId || id,
  });
}
