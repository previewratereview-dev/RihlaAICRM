/**
 * Shared types and helpers for per-tenant provider adapters (Requirement 5.2, 5.4).
 *
 * Each adapter accepts a *resolved* tenant {@link IntegrationCredential} (as
 * produced by `resolveOutbound`) and sends an outbound message using only those
 * tenant credentials — never shared platform environment variables.
 *
 * When the resolved credential is missing a required field, an adapter rejects
 * with an {@link IntegrationConfigurationError} naming the provider and the
 * missing field, and dispatches nothing (Requirement 5.4). The check always
 * runs before any network call so a misconfigured tenant never reaches the
 * provider API.
 *
 * The HTTP transport is injectable (mirroring the dependency-injection pattern
 * used across the integration services) so adapters can be tested without live
 * provider APIs.
 */

import {
  IntegrationConfigurationError,
  type IntegrationCredential,
  type Provider,
} from '../credential-service';

/** A normalized outbound message handed to an adapter. */
export interface OutboundMessage {
  /** Destination phone number / address. */
  to: string;
  /** Message body text. */
  body: string;
}

/** Result of an outbound dispatch. Never carries credential material. */
export interface SendResult {
  ok: boolean;
  /** Provider-assigned message identifier on success. */
  providerMessageId?: string;
  /** Provider error message on failure (no credentials included). */
  error?: string;
}

/** A transport request descriptor built by an adapter. */
export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

/** Minimal transport response shape consumed by adapters. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** Pluggable HTTP transport. Defaults to {@link defaultHttpClient}. */
export type HttpClient = (req: HttpRequest) => Promise<HttpResponse>;

/** Dependencies an adapter accepts, all optional with sensible defaults. */
export interface AdapterDeps {
  httpClient?: HttpClient;
}

/** Contract implemented by every provider adapter. */
export interface ProviderAdapter {
  readonly provider: Provider;
  /** Credential value keys this provider requires to dispatch. */
  readonly requiredValueKeys: readonly string[];
  /** Send an outbound message using the resolved tenant credential. */
  send(
    credential: IntegrationCredential,
    message: OutboundMessage,
    deps?: AdapterDeps,
  ): Promise<SendResult>;
}

/** Default transport: a thin wrapper over the global `fetch` with 30s timeout. */
export const defaultHttpClient: HttpClient = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: AbortSignal.timeout(30_000),
  });
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json(),
    text: () => res.text(),
  };
};

/** Return the first non-empty sending identifier, or `undefined`. */
export function firstSendingIdentifier(
  credential: IntegrationCredential,
): string | undefined {
  if (!Array.isArray(credential.sendingIdentifiers)) return undefined;
  return credential.sendingIdentifiers.find(
    (s) => typeof s === 'string' && s.length > 0,
  );
}

/**
 * Assert that a resolved credential is usable for the given provider before any
 * dispatch occurs. Throws an {@link IntegrationConfigurationError} naming the
 * provider and the missing field; the caller dispatches nothing on throw
 * (Requirement 5.4).
 *
 * Checks, in order:
 * 1. a credential is present and belongs to the expected provider;
 * 2. every required value key is a non-empty string;
 * 3. at least one sending identifier (phone number / sender id) is configured.
 */
export function assertConfigured(
  credential: IntegrationCredential | null | undefined,
  provider: Provider,
  requiredValueKeys: readonly string[],
): void {
  if (!credential) {
    throw new IntegrationConfigurationError(
      `No ${provider} credentials configured`,
      provider,
      'credential',
    );
  }

  if (credential.provider !== provider) {
    throw new IntegrationConfigurationError(
      `Credential provider "${credential.provider}" does not match adapter "${provider}"`,
      provider,
      'provider',
    );
  }

  const values = credential.values ?? {};
  for (const key of requiredValueKeys) {
    const value = values[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new IntegrationConfigurationError(
        `Missing required ${provider} credential field "${key}"`,
        provider,
        key,
      );
    }
  }

  if (!firstSendingIdentifier(credential)) {
    throw new IntegrationConfigurationError(
      `No sending identifier (phone number or sender id) configured for ${provider}`,
      provider,
      'sendingIdentifiers',
    );
  }
}
