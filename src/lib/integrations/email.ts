/**
 * Email integration via Resend (optional).
 * Set RESEND_API_KEY and RESEND_FROM in environment variables.
 */
import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/http';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const defaultFrom = process.env.RESEND_FROM || 'CRM <onboarding@resend.dev>';
  const from = options.fromName ? `${options.fromName} <onboarding@resend.dev>` : defaultFrom;

  if (!apiKey) {
    logger.warn('[Email] RESEND_API_KEY not configured');
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
    to: lead.email,
    subject: `Your travel inquiry${lead.destination ? ` — ${lead.destination}` : ''}`,
    html,
    fromName: lead.fromName,
    replyTo: lead.replyTo,
  });
}
