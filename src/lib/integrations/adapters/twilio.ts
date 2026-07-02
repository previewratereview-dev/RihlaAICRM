/**
 * Twilio adapter (WhatsApp + SMS) using per-tenant credentials.
 *
 * Required credential values: `accountSid`, `authToken`.
 * Sending identifier: the tenant's Twilio "From" number (sendingIdentifiers[0]).
 * For the WhatsApp channel both the From and To are prefixed with `whatsapp:`.
 */

import type { IntegrationCredential } from '../credential-service';
import {
  assertConfigured,
  defaultHttpClient,
  firstSendingIdentifier,
  type AdapterDeps,
  type OutboundMessage,
  type ProviderAdapter,
  type SendResult,
} from './types';

const REQUIRED_VALUE_KEYS = ['accountSid', 'authToken'] as const;

function withWhatsAppPrefix(value: string): string {
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`;
}

export const twilioAdapter: ProviderAdapter = {
  provider: 'twilio',
  requiredValueKeys: REQUIRED_VALUE_KEYS,

  async send(
    credential: IntegrationCredential,
    message: OutboundMessage,
    deps: AdapterDeps = {},
  ): Promise<SendResult> {
    // Reject (throw) before any dispatch when a required field is missing.
    assertConfigured(credential, 'twilio', REQUIRED_VALUE_KEYS);

    const httpClient = deps.httpClient ?? defaultHttpClient;
    const accountSid = credential.values.accountSid;
    const authToken = credential.values.authToken;
    const fromIdentifier = firstSendingIdentifier(credential) as string;

    const isWhatsApp = credential.channel === 'whatsapp';
    const from = isWhatsApp ? withWhatsAppPrefix(fromIdentifier) : fromIdentifier;
    const to = isWhatsApp ? withWhatsAppPrefix(message.to) : message.to;

    try {
      const res = await httpClient({
        url: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: from, To: to, Body: message.body }).toString(),
      });

      const data = (await res.json()) as { sid?: string; message?: string };
      if (!res.ok) {
        return { ok: false, error: data.message ?? 'Twilio error' };
      }
      return { ok: true, providerMessageId: data.sid };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
    }
  },
};
