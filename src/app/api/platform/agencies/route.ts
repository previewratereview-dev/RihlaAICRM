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
 * POST /api/platform/agencies
 *
 * Super-admin only endpoint to create a new Agency tenant with settings and subscription atomically.
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
  const plan = typeof body.plan === 'string' && ['free', 'starter', 'growth', 'enterprise', 'custom', 'scale', 'pro', 'premium'].includes(body.plan.trim().toLowerCase())
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

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3. Invoke Atomic Transactional RPC (Fail-Closed: No sequential fallback)
  const { data: result, error: rpcError } = await supabase.rpc(
    'platform_create_agency_atomic' as never,
    {
      p_name: name,
      p_slug: slug,
      p_domain: domain || null,
      p_plan: plan,
      p_ai_budget: aiBudget,
      p_features: features,
    } as never
  );

  if (rpcError) {
    if (rpcError.code === '23505' || rpcError.message?.toLowerCase().includes('already exists')) {
      return NextResponse.json({ error: 'An agency with this identifier or slug already exists' }, { status: 409 });
    }
    if (rpcError.code === '22023' || rpcError.message?.toLowerCase().includes('validation')) {
      return NextResponse.json({ error: rpcError.message }, { status: 400 });
    }
    if (rpcError.code === '42501' || rpcError.message?.toLowerCase().includes('forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: `Failed to create agency: ${rpcError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    tenant: result,
  }, { status: 201 });
}
