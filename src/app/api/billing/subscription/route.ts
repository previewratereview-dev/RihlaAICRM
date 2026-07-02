import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export async function GET(request: Request) {
  try {
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

    // Verify the user token
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service-role to bypass RLS for subscription lookup
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Get user's tenant
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      logger.error('Profile not found for user', undefined, { userId: user.id });
      return NextResponse.json({
        plan: 'free',
        status: 'active',
        trialActive: false,
        trialDaysLeft: 0,
      });
    }

    // Get subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .single();

    // If no subscription exists, create a trial for existing users
    if (subError || !subscription) {
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const { error: insertError } = await supabase
        .from('subscriptions')
        .insert({
          tenant_id: profile.tenant_id,
          plan: 'pro',
          status: 'trialing',
          trial_start: now.toISOString(),
          trial_end: trialEnd.toISOString(),
          current_period_start: now.toISOString(),
          current_period_end: trialEnd.toISOString(),
        });

      if (insertError) {
        logger.error('Failed to create trial subscription', insertError, { tenantId: profile.tenant_id });
      }

      return NextResponse.json({
        plan: 'pro',
        status: 'trialing',
        trialActive: true,
        trialDaysLeft: 7,
        trialEnd: trialEnd.toISOString(),
        currentPeriodEnd: trialEnd.toISOString(),
      });
    }

    const now = new Date();
    const trialEnd = subscription.trial_end ? new Date(subscription.trial_end) : null;
    const trialActive = subscription.status === 'trialing' && trialEnd && trialEnd > now;
    const trialDaysLeft = trialActive
      ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    return NextResponse.json({
      plan: subscription.plan,
      status: subscription.status,
      trialActive,
      trialDaysLeft,
      trialEnd: subscription.trial_end,
      currentPeriodEnd: subscription.current_period_end,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get subscription';
    logger.error('Subscription API error', err);
    return NextResponse.json({ error: 'Failed to get subscription' }, { status: 500 });
  }
}
