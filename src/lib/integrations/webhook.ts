/**
 * Outbound webhook dispatcher for Make.com / Zapier automations.
 */
import { fetchWithTimeout } from '@/lib/http';

export async function dispatchWebhook(
  url: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  if (!url || url.includes('...')) {
    return { ok: false, error: 'Webhook URL not configured' };
  }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, error: await res.text() };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Webhook failed' };
  }
}

export function buildLeadWebhookPayload(lead: Record<string, unknown>, event: string) {
  return {
    event,
    timestamp: new Date().toISOString(),
    lead,
  };
}
