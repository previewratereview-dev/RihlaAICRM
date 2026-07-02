/**
 * Outbound SMS using the Tenant's own configured Integration_Credentials.
 *
 * Per-tenant (Requirement 5.2, 5.3): the credentials are resolved for the
 * requesting Tenant via {@link resolveOutbound} and the message is dispatched
 * through the matching provider adapter. Shared platform `TWILIO_*` environment
 * variables are never used.
 *
 * When the Tenant has no configured SMS credentials, the send is rejected with
 * a configuration error and nothing is dispatched (Requirement 5.4).
 */

import {
  IntegrationConfigurationError,
  resolveOutbound,
} from './credential-service';
import { sendOutbound } from './adapters';

export interface SendSMSOptions {
  to: string;
  body: string;
}

export interface SendSMSResult {
  ok: boolean;
  error?: string;
  sid?: string;
}

/**
 * Send an outbound SMS message on behalf of `tenantId`, using only that
 * Tenant's configured provider credentials.
 */
export async function sendSMS(
  tenantId: string,
  options: SendSMSOptions,
): Promise<SendSMSResult> {
  let credential;
  try {
    credential = await resolveOutbound(tenantId, 'sms');
  } catch (err) {
    if (err instanceof IntegrationConfigurationError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'SMS not configured',
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
