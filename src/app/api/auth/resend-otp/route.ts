import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { verificationEmailTemplate } from '@/lib/emails/verification';
import { randomInt } from 'crypto';
import { checkRateLimit, buildRateLimitKey } from '@/lib/rate-limit';

function generateOTP(): string {
  return randomInt(100000, 999999).toString();
}

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: 'Token is required.' }, { status: 400 });
    }

    // Rate limit: 3 attempts per 15 minutes per IP to prevent email bombing
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'anonymous';
    const rateLimitKey = buildRateLimitKey({ scope: 'resend-otp', ip });
    const rateLimit = await checkRateLimit(rateLimitKey, 3, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      if (rateLimit.storeUnavailable) {
        return NextResponse.json({ error: 'Service temporarily unavailable.' }, { status: 503 });
      }
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.', retryAfterMs: rateLimit.retryAfterMs },
        { status: 429 },
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Service configuration error.' }, { status: 500 });
    }

    if (!resendApiKey) {
      return NextResponse.json({ error: 'Email service not configured.' }, { status: 500 });
    }

    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Find the original OTP record to get the email
    const { data: existingOtp, error: fetchError } = await supabase
      .from('email_verification_otps')
      .select('*')
      .eq('token', token)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError || !existingOtp) {
      return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
    }

    // Generate new OTP (keep existing token so frontend form continues to work)
    const newOtp = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Mark old OTP as used
    await supabase
      .from('email_verification_otps')
      .update({ used: true })
      .eq('id', existingOtp.id);

    // Store new OTP
    const { error: otpError } = await supabase
      .from('email_verification_otps')
      .insert({
        user_id: existingOtp.user_id,
        email: existingOtp.email,
        otp: newOtp,
        token: token,
        expires_at: expiresAt,
      });

    if (otpError) {
      return NextResponse.json({ error: 'Failed to generate new code.' }, { status: 500 });
    }

    // Send email
    const resend = new Resend(resendApiKey);
    const confirmUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?token=${token}&email=${encodeURIComponent(existingOtp.email)}`;
    const htmlContent = verificationEmailTemplate(newOtp, confirmUrl);

    await resend.emails.send({
      from: 'State AI <noreply@stateai.in>',
      to: existingOtp.email,
      subject: 'Verify your email address',
      html: htmlContent,
    });

    return NextResponse.json({ success: true, email: existingOtp.email });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to resend';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}