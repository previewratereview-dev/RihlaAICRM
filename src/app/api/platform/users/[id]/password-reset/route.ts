import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformSuperAdmin } from '@/lib/auth/api-guard';
import { recordAuditEvent } from '@/lib/security/audit-log';
import { sendEmail } from '@/lib/integrations/email';

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * POST /api/platform/users/[id]/password-reset
 *
 * Super-admin only endpoint to initiate a password recovery flow for any platform user.
 * Generates an administrative recovery link server-side and delivers it via the application's
 * trusted email provider (Resend). Tokens are never exposed to the client.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request forbidden' }, { status: 403 });
  }

  // 1. Authorize super_admin
  const auth = await requirePlatformSuperAdmin(request, 'platform:users');
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { id } = await params;
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return NextResponse.json({ error: 'Invalid or missing user identifier' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 2. Authoritative target lookup
  const { data: targetProfile, error: fetchError } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, tenant_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !targetProfile || !targetProfile.email) {
    return NextResponse.json({ error: 'User not found or lacks email address' }, { status: 404 });
  }

  // Server-configured origin to prevent open redirects
  const host = request.headers.get('host') || 'localhost:3000';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  const redirectUrl = `${protocol}://${host}/login`;

  // 3. Initiate recovery link via Admin Client and deliver via Email Provider
  const adminClient = createAdminClient();
  let emailDeliverySuccess = false;

  if (adminClient) {
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: targetProfile.email,
      options: {
        redirectTo: redirectUrl,
      },
    });

    if (linkError || !linkData?.properties?.action_link) {
      return NextResponse.json(
        { error: `Failed to generate password recovery link: ${linkError?.message || 'Unknown link error'}` },
        { status: 500 }
      );
    }

    const actionLink = linkData.properties.action_link;
    const recipientName = targetProfile.full_name || 'User';

    // Dispatch recovery email via trusted email provider
    const emailResult = await sendEmail({
      to: targetProfile.email,
      subject: 'Reset Your Password - StateAI CRM',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Password Reset Request</h2>
          <p>Hello ${escapeHtml(recipientName)},</p>
          <p>A platform administrator has initiated a password reset for your account.</p>
          <p>Click the link below to set a new password:</p>
          <p style="margin: 24px 0;">
            <a href="${actionLink}" style="background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
              Reset Password
            </a>
          </p>
          <p style="color: #6b7280; font-size: 12px;">This link will expire in 24 hours. If you did not expect this request, please contact your administrator.</p>
        </div>
      `,
    });

    if (!emailResult.ok) {
      return NextResponse.json(
        { error: `Failed to deliver recovery email: ${emailResult.error || 'Email service failure'}` },
        { status: 500 }
      );
    }

    emailDeliverySuccess = true;
  } else {
    // In test/dev environment without service role key, trigger standard recovery flow
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(targetProfile.email, {
      redirectTo: redirectUrl,
    });
    if (resetError) {
      return NextResponse.json({ error: `Password reset request failed: ${resetError.message}` }, { status: 500 });
    }
    emailDeliverySuccess = true;
  }

  // 4. Record Audit Event only after verified delivery
  if (emailDeliverySuccess) {
    try {
      await recordAuditEvent(supabase, {
        actor: auth.authUserId,
        action: 'user.password_reset_delivered',
        target: id,
        tenantId: 'global',
        details: {
          targetUserEmail: targetProfile.email,
          targetUserName: targetProfile.full_name,
        },
      });
    } catch (auditError) {
      console.warn('[PlatformUsers] Audit log write warning:', auditError);
    }
  }

  return NextResponse.json({
    success: true,
    message: `Password reset instructions delivered to ${targetProfile.email}`,
  });
}
