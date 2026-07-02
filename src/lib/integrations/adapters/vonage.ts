/**
 * Vonage (Nexmo) SMS adapter using per-tenant credentials.
 *
 * Required credential values: `apiKey`, `apiSecret`.
 * Sending identifier: the tenant's "from" number / alphanumeric id (sendingIdentifiers[0]).
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

const REQUIRED_VALUE_KEYS = ['apiKey', 'apiSecret'] as const;

export const vonageAdapter: ProviderAdapter = {
  provider: 'vonage',
  requiredValueKeys: REQUIRED_VALUE_KEYS,

  async send(
    credential: IntegrationCredential,
    message: OutboundMessage,
    deps: AdapterDeps = {},
  ): Promise<SendResult> {
    // Reject (throw) before any dispatch when a required field is missing.
    assertConfigured(credential, 'vonage', REQUIRED_VALUE_KEYS);

    const httpClient = deps.httpClient ?? defaultHttpClient;
    const apiKey = credential.values.apiKey;
    const apiSecret = credential.values.apiSecret;
    const from = firstSendingIdentifier(credential) as string;

    try {
      const res = await httpClient({
        url: 'https://rest.nexmo.com/sms/json',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          api_key: apiKey,
          api_secret: apiSecret,
          to: message.to,
          from,
          text: message.body,
        }).toString(),
      });

      const data = (await res.json()) as {
        messages?: Array<{
          status?: string;
          'message-id'?: string;
          'error-text'?: string;
        }>;
      };
      const first = data.messages?.[0];
      if (!res.ok || !first || first.status !== '0') {
        return { ok: false, error: first?.['error-text'] ?? 'Vonage error' };
      }
      return { ok: true, providerMessageId: first['message-id'] };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
    }
  },
};
