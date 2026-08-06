/**
 * Email integration via Resend.
 * Supports tenant-specific API keys via integration credentials,
 * with a fallback to platform RESEND_API_KEY for OTPs and platform emails.
 */
import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/http';
import { resolveOutbound, IntegrationConfigurationError } from './credential-service';
import { ensureIntegrationRuntime } from './runtime';

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
        // Fall back to platform email if tenant hasn't configured one, or fail?
        // We will fall back to platform email so features still work if platform allows it.
        logger.warn(`[Email] Tenant ${options.tenantId} email not configured, using platform fallback.`);
      } else {
        logger.error('[Email] Failed to resolve tenant email credentials', err);
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
  if (lead.template) {
    html = lead.template
      .replace(/\{\{name\}\}/g, escapeHtml(lead.fullName))
      .replace(/\{\{destination\}\}/g, escapeHtml(lead.destination || ''))
      .replace(/\n/g, '<br>');
  } else {
    html = `<p>Hi ${escapeHtml(lead.fullName)},</p><p>Thank you for your interest${lead.destination ? ` in travel to ${escapeHtml(lead.destination)}` : ''}. A travel specialist will be in touch shortly.</p>`;
  }

  return sendEmail({
    tenantId: lead.tenantId,
    to: lead.email,
    subject: `Your travel inquiry${lead.destination ? ` — ${lead.destination}` : ''}`,
    html,
    fromName: lead.fromName,
    replyTo: lead.replyTo,
  });
}
