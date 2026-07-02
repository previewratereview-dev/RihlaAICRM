import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRazorpaySignature, PLAN_PRICES, type PlanType } from '@/lib/razorpay';
import { validateRequest, VerifyPaymentSchema } from '@/lib/validation/schemas';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = validateRequest(VerifyPaymentSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request.', details: validation.errors }, { status: 400 });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = validation.data;

    // Verify signature
    const isValid = verifyRazorpaySignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid payment signature.' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !serviceKey || !anonKey) {
      return NextResponse.json({ error: 'Service configuration error.' }, { status: 500 });
    }

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Idempotency check: reject if this payment_id has already been processed
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('razorpay_payment_id, plan')
      .eq('razorpay_payment_id', razorpay_payment_id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: true, plan: existing.plan || plan, idempotent: true });
    }

    const now = new Date();
    let periodEnd: Date;

    if (plan === 'lifetime') {
      periodEnd = new Date('2099-12-31');
    } else if (plan === 'yearly') {
      periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    } else {
      periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    const planTier = plan === 'lifetime' ? 'premium' : plan === 'yearly' ? 'premium' : 'pro';

    const { error: upsertError } = await supabase
      .from('subscriptions')
      .upsert({
        tenant_id: profile.tenant_id,
        plan: planTier,
        status: 'active',
        trial_start: null,
        trial_end: null,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        razorpay_order_id,
        razorpay_payment_id,
        updated_at: now.toISOString(),
      }, { onConflict: 'tenant_id' });

    if (upsertError) {
      return NextResponse.json({ error: 'Failed to activate subscription.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, plan: planTier });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Payment verification failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
