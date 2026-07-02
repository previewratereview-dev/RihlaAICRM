import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRazorpay, PLAN_PRICES, type PlanType } from '@/lib/razorpay';
import { validateRequest, CreateOrderSchema } from '@/lib/validation/schemas';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = validateRequest(CreateOrderSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request.', details: validation.errors }, { status: 400 });
    }

    const { plan } = validation.data;

    if (!PLAN_PRICES[plan as PlanType]) {
      return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 });
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

    const priceConfig = PLAN_PRICES[plan as PlanType];
    const razorpay = getRazorpay();

    const order = await razorpay.orders.create({
      amount: priceConfig.amount,
      currency: 'INR',
      receipt: `receipt_${profile.tenant_id}_${plan}_${Date.now()}`,
      notes: {
        tenant_id: profile.tenant_id,
        plan,
      },
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      plan,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create order';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
