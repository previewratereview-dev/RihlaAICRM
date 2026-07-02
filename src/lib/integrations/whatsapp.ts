/**
 * Outbound WhatsApp using the Tenant's own configured Integration_Credentials.
 *
 * Per-tenant (Requirement 5.2, 5.3): the credentials are resolved for the
 * requesting Tenant via {@link resolveOutbound} and the message is dispatched
 * through the matching provider adapter. Shared platform `TWILIO_*` environment
 * variables are never used.
 *
 * When the Tenant has no configured WhatsApp credentials, the send is rejected
 * with a configuration error and nothing is dispatched (Requirement 5.4).
 */

import {
  IntegrationConfigurationError,
  resolveOutbound,
} from './credential-service';
import { sendOutbound } from './adapters';

export interface SendWhatsAppOptions {
  to: string;
  body: string;
}

export interface SendWhatsAppResult {
  ok: boolean;
  error?: string;
  sid?: string;
}

/**
 * Send an outbound WhatsApp message on behalf of `tenantId`, using only that
 * Tenant's configured provider credentials.
 */
export async function sendWhatsApp(
  tenantId: string,
  options: SendWhatsAppOptions,
): Promise<SendWhatsAppResult> {
  let credential;
  try {
    credential = await resolveOutbound(tenantId, 'whatsapp');
  } catch (err) {
    if (err instanceof IntegrationConfigurationError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'WhatsApp not configured',
    };
  }

  try {
    const result = await sendOutbound(credential, {
      to: options.to,
      body: options.body,
    });
    return { ok: result.ok, error: result.error, sid: result.providerMessageId };
  } catch (err) {
    if (err instanceof IntegrationConfigurationError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Send failed',
    };
  }
}
