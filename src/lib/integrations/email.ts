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
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'CRM <onboarding@resend.dev>';

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
}): Promise<{ ok: boolean; error?: string }> {
  return sendEmail({
    to: lead.email,
    subject: `Your travel inquiry${lead.destination ? ` — ${lead.destination}` : ''}`,
    html: `<p>Hi ${escapeHtml(lead.fullName)},</p><p>Thank you for your interest. A travel specialist will be in touch shortly.</p>`,
  });
}
