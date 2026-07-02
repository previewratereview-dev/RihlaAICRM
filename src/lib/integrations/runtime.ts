/**
 * Runtime wiring for the Integration Credential Service and the Secret_Store.
 *
 * The credential service (`credential-service.ts`) and the Secret_Store
 * (`secrets/store.ts`) are written against injected data-access interfaces so
 * their core logic stays pure and testable. This module provides the concrete,
 * Supabase service-role backed implementations and wires them in, so that
 * server-side routes (notably the inbound webhook routes) can resolve a tenant
 * from a destination identifier and verify against that tenant's webhook secret
 * at runtime (Requirements 5.6, 5.7).
 *
 * It is server-side only: it uses the Supabase service role and decrypts secrets
 * exclusively in the server execution context (Requirement 6.4).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import {
  setCredentialDataAccess,
  type CredentialDataAccess,
  type StoredCredentialRecord,
  type Provider,
  type Channel,
} from './credential-service';
import { setSecretResolver, type SealedSecret } from '../secrets/store';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

let cachedClient: SupabaseClient | null = null;
let wired = false;

/** Lazily build a service-role Supabase client, or `null` when unconfigured. */
function getServiceClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  if (!serviceKey || !supabaseUrl) return null;
  cachedClient = createClient(supabaseUrl, serviceKey);
  return cachedClient;
}

/** Shape of an `integration_credentials` row as returned by Supabase. */
interface IntegrationCredentialRow {
  id: string;
  tenant_id: string;
  provider: string;
  channel: string;
  values: Record<string, SealedSecret> | null;
  sending_identifiers: string[] | null;
  webhook_secret_ref: string | null;
}

/** Shape of a `secret_store` row as returned by Supabase. */
interface SecretStoreRow {
  iv: string;
  auth_tag: string;
  ciphertext: string;
  key_version: number;
}

/** Map a persisted row into the credential service's record shape. */
function mapRow(row: IntegrationCredentialRow): StoredCredentialRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider as Provider,
    channel: row.channel as Channel,
    sealedValues: (row.values ?? {}) as Record<string, SealedSecret>,
    sendingIdentifiers: row.sending_identifiers ?? [],
    webhookSecretRef: row.webhook_secret_ref,
  };
}

const SELECT_COLUMNS =
  'id, tenant_id, provider, channel, values, sending_identifiers, webhook_secret_ref';

/**
 * Supabase service-role backed implementation of {@link CredentialDataAccess}.
 * Used by `resolveInboundTenant` / `resolveOutbound` / `saveCredential` at
 * runtime. When Supabase is unconfigured, lookups return empty results so the
 * service fails closed (no tenant resolved ⇒ webhook rejected).
 */
const supabaseCredentialDataAccess: CredentialDataAccess = {
  async loadByTenantChannel(tenantId, channel) {
    const client = getServiceClient();
    if (!client) return null;

    const { data, error } = await client
      .from('integration_credentials')
      .select(SELECT_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('channel', channel)
      .limit(1);

    if (error || !data || data.length === 0) return null;
    return mapRow(data[0] as IntegrationCredentialRow);
  },

  async findBySendingIdentifier(destinationIdentifier) {
    const client = getServiceClient();
    if (!client) return [];

    // Match rows whose `sending_identifiers` array contains the destination
    // identifier exactly (backed by the GIN index in migration 004).
    const { data, error } = await client
      .from('integration_credentials')
      .select(SELECT_COLUMNS)
      .contains('sending_identifiers', [destinationIdentifier]);

    if (error || !data) return [];
    return (data as IntegrationCredentialRow[]).map(mapRow);
  },

  async upsert(record) {
    const client = getServiceClient();
    if (!client) {
      throw new Error('Supabase service client is not configured');
    }

    const row = {
      id: record.id,
      tenant_id: record.tenantId,
      provider: record.provider,
      channel: record.channel,
      values: record.sealedValues,
      sending_identifiers: record.sendingIdentifiers,
      webhook_secret_ref: record.webhookSecretRef,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await client
      .from('integration_credentials')
      .upsert(row, { onConflict: 'id' })
      .select(SELECT_COLUMNS)
      .limit(1);

    if (error || !data || data.length === 0) {
      throw new Error(error?.message ?? 'Failed to persist integration credential');
    }
    return mapRow(data[0] as IntegrationCredentialRow);
  },

  newId() {
    return randomUUID();
  },
};

/**
 * Resolve a sealed secret from the `secret_store` table for the Secret_Store.
 * Returns `null` when no secret is configured or Supabase is unconfigured.
 */
async function supabaseSecretResolver(ref: string): Promise<SealedSecret | null> {
  const client = getServiceClient();
  if (!client || !ref) return null;

  const { data, error } = await client
    .from('secret_store')
    .select('iv, auth_tag, ciphertext, key_version')
    .eq('ref', ref)
    .limit(1);

  if (error || !data || data.length === 0) return null;

  const row = data[0] as SecretStoreRow;
  return {
    iv: row.iv,
    authTag: row.auth_tag,
    ciphertext: row.ciphertext,
    keyVersion: row.key_version,
  };
}

/**
 * Wire the Supabase-backed data access and secret resolver into the credential
 * service and Secret_Store. Idempotent: safe to call on every request. Call
 * this before invoking `resolveInboundTenant` / `revealSecret` from a route.
 */
export function ensureIntegrationRuntime(): void {
  if (wired) return;
  setCredentialDataAccess(supabaseCredentialDataAccess);
  setSecretResolver(supabaseSecretResolver);
  wired = true;
}
