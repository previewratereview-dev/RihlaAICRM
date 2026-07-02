/**
 * Integration Credential Service — per-tenant messaging provider credentials.
 *
 * Responsibilities covered by this task (Requirement 5):
 * - Store each Agency's own Integration_Credentials for WhatsApp / SMS / email
 *   providers (twilio, meta_whatsapp, msg91, textlocal, vonage). Credential
 *   values are encrypted at rest via the Secret_Store. (5.1)
 * - Validate credential shape: every value is 1–1024 characters and at least
 *   one sending identifier (phone number or sender id) is required. (5.5)
 * - `saveCredential` validates the credentials against the provider within 30
 *   seconds; on validation failure the save is rejected and the Tenant's
 *   previously stored credentials are retained unchanged. (5.8)
 * - `resolveInboundTenant` matches an inbound webhook's destination identifier
 *   to exactly one Tenant; ambiguous (more than one) or zero matches are
 *   rejected without resolving a tenant. (5.6)
 * - `resolveOutbound` resolves the Tenant's own credentials for a channel,
 *   decrypting values server-side for the outbound adapter.
 *
 * This module is server-side only. Following the conventions of the other lib
 * services (`secrets/store.ts`, `billing/service.ts`), data access and provider
 * validation are injected so the core logic stays pure and testable without a
 * live database or live provider APIs.
 */

import { open, seal, type SealedSecret } from '../secrets/store';

/** Messaging providers supported per Tenant (Requirement 5.1). */
export type Provider = 'twilio' | 'meta_whatsapp' | 'msg91' | 'textlocal' | 'vonage';

/** Messaging channel a credential serves. */
export type Channel = 'whatsapp' | 'sms' | 'email';

/** Providers accepted by the `integration_credentials` table check constraint. */
export const VALID_PROVIDERS: readonly Provider[] = Object.freeze([
  'twilio',
  'meta_whatsapp',
  'msg91',
  'textlocal',
  'vonage',
]);

/** Channels a credential may serve. */
export const VALID_CHANNELS: readonly Channel[] = Object.freeze([
  'whatsapp',
  'sms',
  'email',
]);

/** Minimum length for any provider-specific text value (Requirement 5.5). */
export const MIN_VALUE_LENGTH = 1;
/** Maximum length for any provider-specific text value (Requirement 5.5). */
export const MAX_VALUE_LENGTH = 1024;
/** Provider validation must complete within this budget (Requirement 5.8). */
export const VALIDATION_TIMEOUT_MS = 30_000;

/**
 * A resolved, server-side credential with decrypted values. Returned by
 * {@link resolveOutbound} and {@link resolveInboundTenant} for use by provider
 * adapters. Plaintext values in `values` must never be returned to a browser.
 */
export interface IntegrationCredential {
  tenantId: string;
  provider: Provider;
  channel: Channel;
  /** Decrypted provider-specific values (e.g. accountSid, authToken). */
  values: Record<string, string>;
  /** At least one phone number or sender id (Requirement 5.5). */
  sendingIdentifiers: string[];
  /** Secret_Store reference for the per-tenant webhook secret, if configured. */
  webhookSecretRef: string | null;
}

/** Input accepted when saving a Tenant's credentials. */
export interface IntegrationCredentialInput {
  provider: Provider;
  channel: Channel;
  /** Provider-specific values; each must be 1–1024 chars (Requirement 5.5). */
  values: Record<string, string>;
  /** At least one sending identifier required (Requirement 5.5). */
  sendingIdentifiers: string[];
  /** Optional Secret_Store reference for the tenant's webhook secret. */
  webhookSecretRef?: string | null;
}

/**
 * The persisted credential record. Mirrors the `integration_credentials` table:
 * `values` holds the encrypted (sealed) form of each provider value so plaintext
 * is never stored at rest (Requirement 5.1, 6.1).
 */
export interface StoredCredentialRecord {
  id: string;
  tenantId: string;
  provider: Provider;
  channel: Channel;
  /** Sealed provider values, keyed identically to the plaintext input. */
  sealedValues: Record<string, SealedSecret>;
  sendingIdentifiers: string[];
  webhookSecretRef: string | null;
}

/** Field a save error refers to, for client-facing messages. */
export type CredentialErrorField =
  | 'provider'
  | 'channel'
  | 'values'
  | 'sendingIdentifiers'
  | 'validation';

/** Result of a {@link saveCredential} call. Never carries plaintext values. */
export interface SaveResult {
  ok: boolean;
  /** Sanitized view of the saved credential (no plaintext values). */
  credential?: {
    tenantId: string;
    provider: Provider;
    channel: Channel;
    configuredValueKeys: string[];
    sendingIdentifiers: string[];
    webhookSecretRef: string | null;
  };
  error?: {
    field?: CredentialErrorField;
    provider?: Provider;
    message: string;
  };
}

/** Outcome of validating credentials against the live provider (Requirement 5.8). */
export interface ProviderValidationResult {
  ok: boolean;
  /** Missing or invalid field reported by the provider, when applicable. */
  field?: string;
  message?: string;
}

/**
 * Validates credentials against the live provider. Injected so the core logic
 * stays decoupled from provider HTTP clients (mirrors the resolver pattern in
 * `secrets/store.ts`). Must resolve within {@link VALIDATION_TIMEOUT_MS}; the
 * service races it against a timeout regardless. (Requirement 5.8)
 */
export type ProviderValidator = (input: {
  tenantId: string;
  provider: Provider;
  channel: Channel;
  values: Record<string, string>;
  sendingIdentifiers: string[];
}) => Promise<ProviderValidationResult> | ProviderValidationResult;

/**
 * Data access for credential persistence and lookup. Injected to keep this
 * module decoupled from the data-access layer.
 */
export interface CredentialDataAccess {
  /** Load the stored credential for a tenant + channel, or `null` if none. */
  loadByTenantChannel(
    tenantId: string,
    channel: Channel,
  ): Promise<StoredCredentialRecord | null>;
  /**
   * Find every stored credential whose `sendingIdentifiers` contains the given
   * destination identifier (backed by the GIN index in migration 004).
   */
  findBySendingIdentifier(
    destinationIdentifier: string,
  ): Promise<StoredCredentialRecord[]>;
  /** Insert or update (upsert by tenant + channel) a credential record. */
  upsert(record: StoredCredentialRecord): Promise<StoredCredentialRecord>;
  /** Generate a server-side unique identifier for a new record. */
  newId(): string;
}

/** Raised when a Tenant has no configured credentials for a channel. */
export class IntegrationConfigurationError extends Error {
  constructor(
    message: string,
    readonly provider?: Provider,
    readonly missingField?: string,
  ) {
    super(message);
    this.name = 'IntegrationConfigurationError';
  }
}

/** Raised when an inbound webhook cannot be resolved to exactly one Tenant. */
export class InboundResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InboundResolutionError';
  }
}

/** Raised when the service is used before its dependencies are wired. */
export class IntegrationCredentialServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationCredentialServiceError';
  }
}

let injectedDataAccess: CredentialDataAccess | null = null;
let injectedValidator: ProviderValidator | null = null;

/** Register the data-access implementation used for persistence and lookup. */
export function setCredentialDataAccess(access: CredentialDataAccess | null): void {
  injectedDataAccess = access;
}

/** Register the provider validator used by {@link saveCredential}. */
export function setProviderValidator(validator: ProviderValidator | null): void {
  injectedValidator = validator;
}

function requireDataAccess(): CredentialDataAccess {
  if (!injectedDataAccess) {
    throw new IntegrationCredentialServiceError(
      'No credential data access configured',
    );
  }
  return injectedDataAccess;
}

function requireValidator(): ProviderValidator {
  if (!injectedValidator) {
    throw new IntegrationCredentialServiceError(
      'No provider validator configured',
    );
  }
  return injectedValidator;
}

/**
 * Validate the shape of credential input (Requirement 5.5):
 * - provider and channel must be recognised values;
 * - at least one non-empty sending identifier is required;
 * - every provided value must be a string of 1–1024 characters.
 *
 * Returns `null` when valid, or a populated error describing the first
 * violation found.
 */
export function validateCredentialShape(
  input: IntegrationCredentialInput,
): SaveResult['error'] | null {
  if (!VALID_PROVIDERS.includes(input.provider)) {
    return { field: 'provider', message: `Unknown provider: ${String(input.provider)}` };
  }

  if (!VALID_CHANNELS.includes(input.channel)) {
    return { field: 'channel', message: `Unknown channel: ${String(input.channel)}` };
  }

  if (
    !Array.isArray(input.sendingIdentifiers) ||
    input.sendingIdentifiers.filter((s) => typeof s === 'string' && s.length > 0)
      .length < 1
  ) {
    return {
      field: 'sendingIdentifiers',
      provider: input.provider,
      message: 'At least one sending identifier (phone number or sender id) is required',
    };
  }

  if (!input.values || typeof input.values !== 'object') {
    return {
      field: 'values',
      provider: input.provider,
      message: 'Credential values are required',
    };
  }

  const entries = Object.entries(input.values);
  if (entries.length === 0) {
    return {
      field: 'values',
      provider: input.provider,
      message: 'At least one credential value is required',
    };
  }

  for (const [key, value] of entries) {
    if (typeof value !== 'string') {
      return {
        field: 'values',
        provider: input.provider,
        message: `Credential value "${key}" must be a string`,
      };
    }
    if (value.length < MIN_VALUE_LENGTH || value.length > MAX_VALUE_LENGTH) {
      return {
        field: 'values',
        provider: input.provider,
        message: `Credential value "${key}" must be between ${MIN_VALUE_LENGTH} and ${MAX_VALUE_LENGTH} characters`,
      };
    }
  }

  return null;
}

/**
 * Race provider validation against the 30-second budget. A timeout is treated
 * as a validation failure so a slow/unreachable provider never silently
 * succeeds. (Requirement 5.8)
 */
async function validateWithinBudget(
  validator: ProviderValidator,
  input: {
    tenantId: string;
    provider: Provider;
    channel: Channel;
    values: Record<string, string>;
    sendingIdentifiers: string[];
  },
): Promise<ProviderValidationResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProviderValidationResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          field: 'validation',
          message: `Provider validation did not complete within ${VALIDATION_TIMEOUT_MS / 1000} seconds`,
        }),
      VALIDATION_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([
      Promise.resolve(validator(input)).catch((err) => ({
        ok: false as const,
        field: 'validation',
        message: err instanceof Error ? err.message : 'Provider validation failed',
      })),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Save a Tenant's Integration_Credentials for a provider/channel.
 *
 * Flow (Requirements 5.1, 5.5, 5.8):
 * 1. Validate the credential shape; reject naming the offending field.
 * 2. Validate against the live provider within 30 seconds; on failure (or
 *    timeout) reject and leave any previously stored credentials unchanged.
 * 3. On success, encrypt every value via the Secret_Store and upsert the row.
 *
 * The returned {@link SaveResult} never contains plaintext values.
 */
export async function saveCredential(
  tenantId: string,
  input: IntegrationCredentialInput,
): Promise<SaveResult> {
  if (!tenantId) {
    return { ok: false, error: { message: 'A tenant id is required' } };
  }

  const shapeError = validateCredentialShape(input);
  if (shapeError) {
    // Reject before any state change; prior credentials remain untouched.
    return { ok: false, error: shapeError };
  }

  const dataAccess = requireDataAccess();
  const validator = requireValidator();

  // Validate against the provider before persisting anything (Requirement 5.8).
  const validation = await validateWithinBudget(validator, {
    tenantId,
    provider: input.provider,
    channel: input.channel,
    values: input.values,
    sendingIdentifiers: input.sendingIdentifiers,
  });

  if (!validation.ok) {
    // Failed validation must leave stored credentials unchanged: we never wrote.
    return {
      ok: false,
      error: {
        field: 'validation',
        provider: input.provider,
        message: validation.message ?? 'Credential validation failed',
      },
    };
  }

  // Encrypt each value at rest via the Secret_Store (Requirement 5.1, 6.1).
  const sealedValues: Record<string, SealedSecret> = {};
  for (const [key, value] of Object.entries(input.values)) {
    sealedValues[key] = seal(value);
  }

  const existing = await dataAccess.loadByTenantChannel(tenantId, input.channel);

  const record: StoredCredentialRecord = {
    id: existing?.id ?? dataAccess.newId(),
    tenantId,
    provider: input.provider,
    channel: input.channel,
    sealedValues,
    sendingIdentifiers: input.sendingIdentifiers.filter(
      (s) => typeof s === 'string' && s.length > 0,
    ),
    webhookSecretRef:
      input.webhookSecretRef ?? existing?.webhookSecretRef ?? null,
  };

  const saved = await dataAccess.upsert(record);

  return {
    ok: true,
    credential: {
      tenantId: saved.tenantId,
      provider: saved.provider,
      channel: saved.channel,
      configuredValueKeys: Object.keys(saved.sealedValues),
      sendingIdentifiers: saved.sendingIdentifiers,
      webhookSecretRef: saved.webhookSecretRef,
    },
  };
}

/** Decrypt a stored record's sealed values into a usable credential. */
function decryptRecord(record: StoredCredentialRecord): IntegrationCredential {
  const values: Record<string, string> = {};
  for (const [key, sealed] of Object.entries(record.sealedValues)) {
    values[key] = open(sealed);
  }
  return {
    tenantId: record.tenantId,
    provider: record.provider,
    channel: record.channel,
    values,
    sendingIdentifiers: record.sendingIdentifiers,
    webhookSecretRef: record.webhookSecretRef,
  };
}

/**
 * Resolve a Tenant's own credentials for an outbound channel, decrypting the
 * values server-side for the provider adapter. Throws an
 * {@link IntegrationConfigurationError} when the Tenant has none configured so
 * callers can reject the send without dispatching (Requirement 5.4 builds on
 * this in task 6.2).
 */
export async function resolveOutbound(
  tenantId: string,
  channel: Channel,
): Promise<IntegrationCredential> {
  if (!tenantId) {
    throw new IntegrationConfigurationError('A tenant id is required');
  }

  const dataAccess = requireDataAccess();
  const record = await dataAccess.loadByTenantChannel(tenantId, channel);

  if (!record) {
    throw new IntegrationConfigurationError(
      `No integration credentials configured for channel "${channel}"`,
    );
  }

  return decryptRecord(record);
}

/**
 * Resolve the target Tenant for an inbound provider webhook by matching the
 * destination phone number / sender id to exactly one stored credential.
 *
 * Rejects (Requirement 5.6, 5.7):
 * - zero matches — the identifier belongs to no configured Tenant;
 * - more than one match — the identifier is ambiguous across credentials.
 *
 * On a unique match the resolved tenant and its decrypted credential are
 * returned so the caller can verify the webhook against that tenant's secret.
 */
export async function resolveInboundTenant(
  destinationIdentifier: string,
): Promise<{ tenantId: string; cred: IntegrationCredential }> {
  if (!destinationIdentifier) {
    throw new InboundResolutionError('A destination identifier is required');
  }

  const dataAccess = requireDataAccess();
  const matches = await dataAccess.findBySendingIdentifier(destinationIdentifier);

  if (matches.length === 0) {
    throw new InboundResolutionError(
      'No tenant matches the inbound destination identifier',
    );
  }

  // Enforce a unique destination-identifier → tenant match. More than one
  // matching credential is ambiguous and must be rejected without processing.
  const distinctTenants = new Set(matches.map((m) => m.tenantId));
  if (matches.length > 1 || distinctTenants.size > 1) {
    throw new InboundResolutionError(
      'Inbound destination identifier resolves to more than one tenant credential',
    );
  }

  const record = matches[0];
  return { tenantId: record.tenantId, cred: decryptRecord(record) };
}
