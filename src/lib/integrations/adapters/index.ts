/**
 * Provider adapter registry (Requirement 5.2, 5.4).
 *
 * Maps each supported {@link Provider} to its adapter and exposes a single
 * `sendOutbound` entry point that dispatches an outbound message using a
 * resolved tenant credential. Adapters use only the tenant's own credentials
 * and never shared platform environment variables.
 */

import {
  IntegrationConfigurationError,
  type IntegrationCredential,
  type Provider,
} from '../credential-service';
import { metaWhatsAppAdapter } from './meta-whatsapp';
import { msg91Adapter } from './msg91';
import { textlocalAdapter } from './textlocal';
import { twilioAdapter } from './twilio';
import type { AdapterDeps, OutboundMessage, ProviderAdapter, SendResult } from './types';
import { vonageAdapter } from './vonage';

export * from './types';
export { twilioAdapter } from './twilio';
export { metaWhatsAppAdapter } from './meta-whatsapp';
export { msg91Adapter } from './msg91';
export { textlocalAdapter } from './textlocal';
export { vonageAdapter } from './vonage';

/** Registry of provider adapters keyed by provider. */
export const PROVIDER_ADAPTERS: Readonly<Record<Provider, ProviderAdapter>> =
  Object.freeze({
    twilio: twilioAdapter,
    meta_whatsapp: metaWhatsAppAdapter,
    msg91: msg91Adapter,
    textlocal: textlocalAdapter,
    vonage: vonageAdapter,
  });

/** Return the adapter for a provider, or throw if none is registered. */
export function getAdapter(provider: Provider): ProviderAdapter {
  const adapter = PROVIDER_ADAPTERS[provider];
  if (!adapter) {
    throw new IntegrationConfigurationError(
      `No adapter registered for provider "${String(provider)}"`,
      provider,
      'provider',
    );
  }
  return adapter;
}

/**
 * Dispatch an outbound message using a resolved tenant credential. The adapter
 * is selected from the credential's provider; the adapter rejects with an
 * {@link IntegrationConfigurationError} (naming the provider and missing field)
 * before any dispatch when the credential is unconfigured (Requirement 5.4).
 */
export function sendOutbound(
  credential: IntegrationCredential,
  message: OutboundMessage,
  deps?: AdapterDeps,
): Promise<SendResult> {
  if (!credential) {
    throw new IntegrationConfigurationError(
      'No integration credential supplied for outbound send',
    );
  }
  const adapter = getAdapter(credential.provider);
  return adapter.send(credential, message, deps);
}
