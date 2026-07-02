/**
 * Textlocal SMS adapter using per-tenant credentials.
 *
 * Required credential values: `apiKey`.
 * Sending identifier: the tenant's approved sender name (sendingIdentifiers[0]).
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

const REQUIRED_VALUE_KEYS = ['apiKey'] as const;

export const textlocalAdapter: ProviderAdapter = {
  provider: 'textlocal',
  requiredValueKeys: REQUIRED_VALUE_KEYS,

  async send(
    credential: IntegrationCredential,
    message: OutboundMessage,
    deps: AdapterDeps = {},
  ): Promise<SendResult> {
    // Reject (throw) before any dispatch when a required field is missing.
    assertConfigured(credential, 'textlocal', REQUIRED_VALUE_KEYS);

    const httpClient = deps.httpClient ?? defaultHttpClient;
    const apiKey = credential.values.apiKey;
    const sender = firstSendingIdentifier(credential) as string;

    try {
      const res = await httpClient({
        url: 'https://api.textlocal.in/send/',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          apikey: apiKey,
          numbers: message.to,
          message: message.body,
          sender,
        }).toString(),
      });

      const data = (await res.json()) as {
        status?: string;
        messages?: Array<{ id?: string }>;
        errors?: Array<{ message?: string }>;
      };
      if (!res.ok || data.status === 'failure') {
        return { ok: false, error: data.errors?.[0]?.message ?? 'Textlocal error' };
      }
      return { ok: true, providerMessageId: data.messages?.[0]?.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
    }
  },
};
