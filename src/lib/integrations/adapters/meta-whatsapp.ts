/**
 * Meta WhatsApp Cloud API adapter using per-tenant credentials.
 *
 * Required credential values: `accessToken`, `phoneNumberId`.
 * Sending identifier: the tenant's WhatsApp business number (sendingIdentifiers[0]),
 * used for traceability; the Cloud API routes by `phoneNumberId` in the URL.
 */

import type { IntegrationCredential } from '../credential-service';
import {
  assertConfigured,
  defaultHttpClient,
  type AdapterDeps,
  type OutboundMessage,
  type ProviderAdapter,
  type SendResult,
} from './types';

const REQUIRED_VALUE_KEYS = ['accessToken', 'phoneNumberId'] as const;

/** Graph API version used for the Cloud API messages endpoint. */
const GRAPH_API_VERSION = 'v21.0';

export const metaWhatsAppAdapter: ProviderAdapter = {
  provider: 'meta_whatsapp',
  requiredValueKeys: REQUIRED_VALUE_KEYS,

  async send(
    credential: IntegrationCredential,
    message: OutboundMessage,
    deps: AdapterDeps = {},
  ): Promise<SendResult> {
    // Reject (throw) before any dispatch when a required field is missing.
    assertConfigured(credential, 'meta_whatsapp', REQUIRED_VALUE_KEYS);

    const httpClient = deps.httpClient ?? defaultHttpClient;
    const accessToken = credential.values.accessToken;
    const phoneNumberId = credential.values.phoneNumberId;

    try {
      const res = await httpClient({
        url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: message.to,
          type: 'text',
          text: { body: message.body },
        }),
      });

      const data = (await res.json()) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return { ok: false, error: data.error?.message ?? 'Meta WhatsApp error' };
      }
      return { ok: true, providerMessageId: data.messages?.[0]?.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
    }
  },
};
