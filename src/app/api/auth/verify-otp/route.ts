import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, buildRateLimitKey } from '@/lib/rate-limit';
import { z } from 'zod';

const VerifyOtpBodySchema = z.object({
  otp: z.string().length(6).regex(/^\d{6}$/),
  token: z.string().min(1).max(255),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = VerifyOtpBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { otp, token } = parsed.data;

    // Rate limit: 10 attempts per 15 minutes per IP to prevent brute-force
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'anonymous';
    const rateLimitKey = buildRateLimitKey({ scope: 'verify-otp', ip });
    const rateLimit = await checkRateLimit(rateLimitKey, 10, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      if (rateLimit.storeUnavailable) {
        return NextResponse.json({ error: 'Service temporarily unavailable.' }, { status: 503 });
      }
      return NextResponse.json(
        { error: 'Too many verification attempts. Please try again later.', retryAfterMs: rateLimit.retryAfterMs },
        { status: 429 },
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Service configuration error.' }, { status: 500 });
    }

    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Find and validate the OTP
    const { data: otpRecord, error: fetchError } = await supabase
      .from('email_verification_otps')
      .select('*')
      .eq('token', token)
      .eq('otp', otp)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (fetchError || !otpRecord) {
      return NextResponse.json({ error: 'Invalid or expired verification code.' }, { status: 400 });
    }

    // Mark OTP as used
    await supabase
      .from('email_verification_otps')
      .update({ used: true })
      .eq('id', otpRecord.id);

    // Confirm the user's email
    const { error: confirmError } = await supabase.auth.admin.updateUserById(
      otpRecord.user_id,
      { email_confirm: true }
    );

    if (confirmError) {
      return NextResponse.json({ error: 'Failed to verify email.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
