/**
 * Email integration via Resend.
 * Supports tenant-specific API keys via integration credentials,
 * with a fallback to platform RESEND_API_KEY for OTPs and platform emails.
 */
import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/http';
import { resolveOutbound, IntegrationConfigurationError } from './credential-service';
import { ensureIntegrationRuntime } from './runtime';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { CRMDatabaseService } from '@/lib/data/service';
import { createClient } from '@supabase/supabase-js';
import { open, SealedSecret } from '@/lib/secrets/store';
import { marked } from 'marked';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export async function sendEmail(options: {
  tenantId?: string;
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  let apiKey = process.env.RESEND_API_KEY;
  const defaultFrom = process.env.RESEND_FROM || 'CRM <onboarding@resend.dev>';
  let from = options.fromName ? `${options.fromName} <onboarding@resend.dev>` : defaultFrom;

  if (options.tenantId) {
    ensureIntegrationRuntime();
    let resolvedFromSettings = false;
    
    // First try the new settings approach
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { data: settingsRow, error } = await supabaseAdmin
        .from('settings')
        .select('resend_api_key, resend_from_email')
        .eq('tenant_id', options.tenantId)
        .maybeSingle();

      if (settingsRow?.resend_api_key) {
        try {
          const parsed = JSON.parse(settingsRow.resend_api_key);
          if (parsed.ciphertext && parsed.iv) {
            apiKey = open(parsed as SealedSecret);
          } else {
            apiKey = settingsRow.resend_api_key;
          }
          resolvedFromSettings = true;
          
          if (settingsRow.resend_from_email) {
            from = options.fromName
              ? `${options.fromName} <${settingsRow.resend_from_email}>`
              : settingsRow.resend_from_email;
          }
        } catch (decErr) {
          logger.error('[Email] Failed to parse or decrypt resendApiKey', decErr);
        }
      }
    } catch (e) {
      logger.error('[Email] Failed to check settings for resend configuration', e);
    }

    // Fallback to integration credentials if not found in settings
    if (!resolvedFromSettings) {
      try {
        const cred = await resolveOutbound(options.tenantId, 'email');
        if (cred && cred.values.apiKey) {
          apiKey = cred.values.apiKey;
          if (cred.sendingIdentifiers.length > 0) {
            from = options.fromName 
              ? `${options.fromName} <${cred.sendingIdentifiers[0]}>` 
              : cred.sendingIdentifiers[0];
          }
        }
      } catch (err) {
        if (err instanceof IntegrationConfigurationError) {
          logger.warn(`[Email] Tenant ${options.tenantId} email not configured, using platform fallback.`);
        } else {
          logger.error('[Email] Failed to resolve tenant email credentials', err);
        }
      }
    }
  }

  if (!apiKey) {
    logger.warn('[Email] RESEND_API_KEY not configured and no tenant key found');
    return { ok: false, error: 'Email not configured' };
  }

  try {
    const res = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: text };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
  }
}

export async function sendLeadFollowUpEmail(lead: {
  tenantId: string;
  fullName: string;
  email: string;
  destination?: string;
  fromName?: string;
  replyTo?: string;
  template?: string;
}): Promise<{ ok: boolean; error?: string }> {
  let html: string;
  let subject = `Your travel inquiry${lead.destination ? ` — ${lead.destination}` : ''}`;

  if (lead.template) {
    let rawTemplate = lead.template;
    
    // Attempt to extract **Subject:** line
    const match = rawTemplate.match(/\*\*Subject:\*\*\s*(.+?)(?:\n|$)/i) || rawTemplate.match(/Subject:\s*(.+?)(?:\n|$)/i);
    if (match) {
      subject = match[1].trim();
      rawTemplate = rawTemplate.replace(match[0], '').trim();
    }
    
    // Also remove any leading '---' which the AI sometimes puts after the subject
    rawTemplate = rawTemplate.replace(/^---\n?/, '').trim();

    rawTemplate = rawTemplate
      .replace(/\{\{name\}\}/g, escapeHtml(lead.fullName))
      .replace(/\{\{destination\}\}/g, escapeHtml(lead.destination || ''));
      
    // Parse Markdown to HTML
    html = await Promise.resolve(marked.parse(rawTemplate));
  } else {
    html = `<p>Hi ${escapeHtml(lead.fullName)},</p><p>Thank you for your interest${lead.destination ? ` in travel to ${escapeHtml(lead.destination)}` : ''}. A travel specialist will be in touch shortly.</p>`;
  }

  return sendEmail({
    tenantId: lead.tenantId,
    to: lead.email,
    subject,
    html,
    fromName: lead.fromName,
    replyTo: lead.replyTo,
  });
}
