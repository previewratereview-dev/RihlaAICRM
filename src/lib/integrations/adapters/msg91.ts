/**
 * MSG91 SMS adapter using per-tenant credentials.
 *
 * Required credential values: `authKey`.
 * Sending identifier: the tenant's approved sender id (sendingIdentifiers[0]).
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

const REQUIRED_VALUE_KEYS = ['authKey'] as const;

export const msg91Adapter: ProviderAdapter = {
  provider: 'msg91',
  requiredValueKeys: REQUIRED_VALUE_KEYS,

  async send(
    credential: IntegrationCredential,
    message: OutboundMessage,
    deps: AdapterDeps = {},
  ): Promise<SendResult> {
    // Reject (throw) before any dispatch when a required field is missing.
    assertConfigured(credential, 'msg91', REQUIRED_VALUE_KEYS);

    const httpClient = deps.httpClient ?? defaultHttpClient;
    const authKey = credential.values.authKey;
    const sender = firstSendingIdentifier(credential) as string;

    try {
      const res = await httpClient({
        url: 'https://control.msg91.com/api/v5/flow/',
        method: 'POST',
        headers: {
          authkey: authKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender,
          short_url: '0',
          recipients: [{ mobiles: message.to, message: message.body }],
        }),
      });

      const data = (await res.json()) as {
        type?: string;
        requestId?: string;
        message?: string;
      };
      if (!res.ok || data.type === 'error') {
        return { ok: false, error: data.message ?? 'MSG91 error' };
      }
      return { ok: true, providerMessageId: data.requestId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
    }
  },
};
