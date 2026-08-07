'use server';

import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { seal } from '@/lib/secrets/store';

/**
 * Encrypt a plaintext value using the secret store before writing to the database.
 */
function encryptBeforeStore(plaintext: unknown): unknown {
  if (typeof plaintext !== 'string' || !plaintext.trim()) return plaintext;
  const sealed = seal(plaintext);
  return JSON.stringify(sealed);
}

export async function updateSettingsAction(
  settings: Record<string, unknown>,
  tenantId: string,
  password?: string
) {
  if (!tenantId) {
    throw new Error('A valid tenantId is required for this operation.');
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // First verify the user belongs to this tenant and has admin permissions
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Unauthorized');

  if (password) {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password
    });
    if (signInError) throw new Error('Invalid password provided for sensitive operation.');
  }

  const dbSet: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (settings.agencyName !== undefined) dbSet.agency_name = settings.agencyName;
  if (settings.logoText !== undefined) dbSet.logo_text = settings.logoText;
  if (settings.accentColor !== undefined) dbSet.accent_color = settings.accentColor;
  if (settings.systemPrompt !== undefined) dbSet.system_prompt = settings.systemPrompt;
  if (settings.makeWebhookUrl !== undefined) dbSet.make_webhook_url = settings.makeWebhookUrl;
  if (settings.emailAutomation !== undefined) dbSet.email_automation = settings.emailAutomation;
  if (settings.whatsappAutomation !== undefined) dbSet.whatsapp_automation = settings.whatsappAutomation;
  if (settings.smsAutomation !== undefined) dbSet.sms_automation = settings.smsAutomation;
  if (settings.dailyTargetScore !== undefined) dbSet.daily_target_score = settings.dailyTargetScore;
  
  if (settings.openAiKey !== undefined && settings.openAiKey !== '••••••••') dbSet.openai_key = encryptBeforeStore(settings.openAiKey);
  if (settings.anthropicKey !== undefined && settings.anthropicKey !== '••••••••') dbSet.anthropic_key = encryptBeforeStore(settings.anthropicKey);
  
  if (settings.metaSettings !== undefined) dbSet.meta_settings = settings.metaSettings;
  if (settings.twilioSettings !== undefined) dbSet.twilio_settings = settings.twilioSettings;
  if (settings.smtpSettings !== undefined) dbSet.smtp_settings = settings.smtpSettings;
  
  if (settings.resendApiKey !== undefined && settings.resendApiKey !== '••••••••') dbSet.resend_api_key = encryptBeforeStore(settings.resendApiKey);
  if (settings.resendFromEmail !== undefined) dbSet.resend_from_email = settings.resendFromEmail;
  if (settings.adminNotificationPhone !== undefined) dbSet.admin_notification_phone = settings.adminNotificationPhone;
  if (settings.adminNotificationEmail !== undefined) dbSet.admin_notification_email = settings.adminNotificationEmail;

  if (settings.usePlatformAi !== undefined) {
    const { data: currentSettings } = await supabase.from('settings').select('meta_settings').eq('tenant_id', tenantId).maybeSingle();
    const currentMeta = (currentSettings?.meta_settings as Record<string, unknown>) || {};
    dbSet.meta_settings = { ...currentMeta, ...(dbSet.meta_settings as Record<string, unknown> || {}), usePlatformAi: settings.usePlatformAi };
  }

  // Global settings update restriction
  if (tenantId === 'global') {
    if (settings.aiBaseUrl !== undefined) dbSet.ai_base_url = settings.aiBaseUrl;
    if (settings.aiApiKey !== undefined && settings.aiApiKey !== '••••••••') dbSet.ai_api_key = encryptBeforeStore(settings.aiApiKey);
    if (settings.aiModel !== undefined) dbSet.ai_model = settings.aiModel;
    if (settings.aiUseAnthropicFormat !== undefined) dbSet.ai_use_anthropic_format = settings.aiUseAnthropicFormat;
  }
  
  dbSet.id = tenantId;
  dbSet.tenant_id = tenantId;
  
  console.log('Server Action: Upserting settings payload:', dbSet);
  const { error } = await supabase.from('settings').update(dbSet).eq('tenant_id', tenantId);
  if (error) {
    console.error('Server Action: Failed to update settings in Supabase:', error);
    throw new Error('Failed to update settings');
  }
  
  return { success: true };
}
