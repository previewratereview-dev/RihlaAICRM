import { createClient } from '@supabase/supabase-js';

export async function sendAdminNotification({
  tenantId,
  message,
}: {
  tenantId: string;
  message: string;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const adminDb = createClient(supabaseUrl, supabaseServiceKey);

  // Get tenant settings
  const { data: settings } = await adminDb
    .from('settings')
    .select('admin_notification_phone, admin_notification_email, twilio_settings, resend_api_key')
    .eq('tenant_id', tenantId)
    .single();

  if (!settings) return;

  const phone = settings.admin_notification_phone;
  const email = settings.admin_notification_email;

  // Try Twilio SMS/WhatsApp first
  if (phone && settings.twilio_settings?.accountSid && settings.twilio_settings?.authToken) {
    try {
      const { accountSid, authToken, fromNumber } = settings.twilio_settings;
      const twilioAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      
      const params = new URLSearchParams();
      params.append('To', phone);
      params.append('From', fromNumber);
      params.append('Body', message);

      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${twilioAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });
      
      if (res.ok) {
        console.log(`[Notification] Sent SMS/WhatsApp to admin ${phone}`);
        return;
      } else {
        console.error(`[Notification] Twilio failed:`, await res.text());
      }
    } catch (err) {
      console.error('[Notification] Twilio error:', err);
    }
  }

  // Fallback to Resend Email
  if (email && settings.resend_api_key) {
    try {
      // In production, we'd need a helper to decrypt resend_api_key, 
      // but assuming it's available or using a global fallback:
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.resend_api_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'AI Escalation <system@stateaicrm.com>',
          to: email,
          subject: 'Action Required: AI Escalation',
          text: message
        })
      });

      if (res.ok) {
        console.log(`[Notification] Sent Email to admin ${email}`);
        return;
      }
    } catch (err) {
      console.error('[Notification] Resend error:', err);
    }
  }

  console.log('[Notification] No suitable notification channel configured for tenant', tenantId);
}
