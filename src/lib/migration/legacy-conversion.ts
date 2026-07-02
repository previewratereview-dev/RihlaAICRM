/**
 * Legacy conversion migration — task 14.2.
 *
 * Completes the legacy `global`-tenant transition that migration 010 began by:
 *
 *  1. Converting legacy `super_admin` Users into Platform_Super_Admin
 *     identities that hold NO tenant membership. Migration 010 moved these
 *     profiles onto the designated Agency and preserved their `super_admin`
 *     role value verbatim so this step can still identify them. Conversion
 *     inserts a `platform_admins` row (the platform identity, keyed by
 *     `auth_user_id`, carrying no `tenant_id`) and then removes the user's
 *     tenant membership by deleting their `profiles` row — every foreign key
 *     into `profiles(id)` is `ON DELETE SET NULL`, so no tenant-owned data is
 *     destroyed. The `auth.users` row remains and the platform identity in
 *     `platform_admins` references it. (Requirements 11.3, 2.1, 2.2, 2.7)
 *
 *  2. Migrating plaintext `settings.openai_key` / `settings.anthropic_key`
 *     into the encrypted Secret_Store, retaining no plaintext, and HALTING the
 *     whole process on the first failure with an error that identifies the
 *     failing credential (never its value). (Requirements 11.6, 6.6, 6.7)
 *
 * Why this lives in TypeScript rather than a SQL migration: the Secret_Store
 * data key is sourced from the environment / secret manager, deliberately kept
 * separate from the database that holds the ciphertext (Requirement 6.9). The
 * database therefore cannot perform the AES-256-GCM sealing itself; the key
 * migration must run in a server-side process that holds the data key. The
 * super-admin conversion is folded into the same process so the entire task is
 * a single, ordered, halt-on-failure flow.
 *
 * Failure semantics (Requirements 6.6, 6.7): any failed step halts the process,
 * records the failing item in `legacy_migration_report` (the table created by
 * migration 010 — never the secret value), and raises {@link MigrationHaltError}
 * so an operator can intervene before completion.
 *
 * Idempotency (Requirement 11.8): converted super-admin profiles are deleted, so
 * a second run finds none. `platform_admins` inserts are conflict-ignoring, so a
 * crash between insert and profile-delete resumes cleanly. Plaintext key columns
 * are nulled on success, so a second run lists only still-unmigrated keys; the
 * sealed secret is upserted by its deterministic `ref`, so re-sealing never
 * duplicates a row.
 *
 * Following the conventions of the sibling lib services (`platform/service.ts`,
 * `secrets/store.ts`), the data-access port is injected so the core flow stays
 * decoupled from Supabase and is unit-testable without a live database. The
 * default store runs through a service-role client because it must write
 * `platform_admins` (RLS-restricted) and read/clear another tenant's rows.
 *
 * This module is server-only and never embeds secret material in errors or logs.
 */

import 'server-only';
import { open, seal, type SealedSecret } from '../secrets/store';

/** Providers whose legacy plaintext keys are migrated. */
export type LegacyKeyProvider = 'openai' | 'anthropic';

/** The legacy `settings` column each provider's plaintext key lives in. */
const PROVIDER_COLUMN: Record<LegacyKeyProvider, 'openai_key' | 'anthropic_key'> = {
  openai: 'openai_key',
  anthropic: 'anthropic_key',
};

/**
 * Deterministic Secret_Store reference for a tenant's migrated AI provider key.
 * Embedding the tenant id keeps the global `secret_store.ref` primary key unique
 * per tenant+provider and makes the migration idempotent (upsert by ref).
 */
export function aiKeyRef(tenantId: string, provider: LegacyKeyProvider): string {
  return `tenant:${tenantId}:ai:${provider}`;
}

/** A legacy `super_admin` User to convert into a Platform_Super_Admin identity. */
export interface LegacySuperAdmin {
  /** `profiles.id`, which equals `auth.users.id`. */
  authUserId: string;
  /** The tenant the legacy profile currently belongs to (for reporting only). */
  tenantId: string;
}

/** A legacy plaintext provider key awaiting migration into the Secret_Store. */
export interface LegacyPlaintextKey {
  /** `settings.id` of the row holding the plaintext value. */
  settingsId: string;
  /** The tenant that owns the settings row. */
  tenantId: string;
  /** Which provider this key is for. */
  provider: LegacyKeyProvider;
  /** The plaintext key value (server-side only; never logged or returned). */
  value: string;
}

/** Outcome of a single migration/conversion step recorded for auditability. */
export interface ConversionReportEntry {
  /** Logical step, e.g. `convert_super_admin` or `migrate_key`. */
  step: 'convert_super_admin' | 'migrate_key';
  /** Stable identifier of the item (auth user id or Secret_Store ref). */
  target: string;
  status: 'converted' | 'failed';
  /** Failure detail. Guaranteed never to contain secret material. */
  detail?: string;
  tenantId: string;
}

/**
 * Data-access port for the legacy conversion. Injected so the core flow is
 * decoupled from Supabase and unit-testable without a live database, mirroring
 * the store pattern used by the other lib services. Implementations MUST use a
 * service-role path: writing `platform_admins` and clearing another tenant's
 * rows is not permitted under RLS for a platform identity holding no tenant.
 */
export interface LegacyConversionStore {
  /** Profiles whose role is still the legacy `super_admin` value. */
  listLegacySuperAdmins(): Promise<LegacySuperAdmin[]>;
  /** Whether a `platform_admins` identity already exists for the auth user. */
  platformAdminExists(authUserId: string): Promise<boolean>;
  /** Insert a `platform_admins` identity (conflict-ignoring / idempotent). */
  insertPlatformAdmin(authUserId: string): Promise<void>;
  /** Remove the user's tenant membership by deleting their `profiles` row. */
  removeTenantMembership(authUserId: string): Promise<void>;

  /** Settings rows that still hold a non-null plaintext provider key. */
  listPlaintextKeys(): Promise<LegacyPlaintextKey[]>;
  /** Upsert the sealed secret by its `ref` (idempotent). */
  storeSealedSecret(ref: string, tenantId: string, sealed: SealedSecret): Promise<void>;
  /** Read back a sealed secret by `ref` for round-trip verification. */
  readSealedSecret(ref: string): Promise<SealedSecret | null>;
  /** Null out a migrated plaintext key column, retaining no plaintext. */
  clearPlaintextKey(settingsId: string, column: 'openai_key' | 'anthropic_key'): Promise<void>;

  /** Append a row to `legacy_migration_report` (never includes secret values). */
  recordReport(entry: ConversionReportEntry): Promise<void>;
}

/** Summary returned by {@link runLegacyConversion} on success. */
export interface LegacyConversionResult {
  /** Number of legacy super admins converted to platform identities. */
  superAdminsConverted: number;
  /** Number of plaintext provider keys migrated into the Secret_Store. */
  keysMigrated: number;
}

/**
 * Raised when a migration step fails. The whole process halts so an operator can
 * intervene before completion (Requirements 6.6, 6.7). The message identifies the
 * failing item by id/ref only — never by secret value (Requirement 6.8).
 */
export class MigrationHaltError extends Error {
  readonly step: ConversionReportEntry['step'];
  readonly target: string;
  constructor(step: ConversionReportEntry['step'], target: string, cause?: string) {
    super(
      `Legacy conversion halted at step '${step}' for '${target}'` +
        (cause ? `: ${cause}` : '') +
        '. Manual intervention required before the migration can complete.',
    );
    this.name = 'MigrationHaltError';
    this.step = step;
    this.target = target;
  }
}

let injectedStore: LegacyConversionStore | null = null;

/**
 * Register the {@link LegacyConversionStore} used by {@link runLegacyConversion}.
 * Kept injectable for isolated server use and testing; passing `null` restores
 * the default service-role-backed store.
 */
export function setLegacyConversionStore(store: LegacyConversionStore | null): void {
  injectedStore = store;
}

function storeOrDefault(): LegacyConversionStore {
  return injectedStore ?? getDefaultStore();
}

/** Extract a non-secret error message for reporting. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.name === 'Error' ? err.message : `${err.name}: ${err.message}`;
  return 'unknown error';
}

/**
 * Convert every legacy `super_admin` User into a Platform_Super_Admin identity
 * outside tenant membership (Requirement 11.3). Halts on the first failure,
 * recording the failing record; the source profile is preserved because the
 * `platform_admins` insert is conflict-ignoring and the profile delete only runs
 * after a successful insert. Returns the number of users converted.
 */
async function convertSuperAdmins(store: LegacyConversionStore): Promise<number> {
  const admins = await store.listLegacySuperAdmins();
  let converted = 0;

  for (const admin of admins) {
    try {
      // Insert the platform identity first (idempotent). Only after the identity
      // exists do we remove tenant membership, so a failure never strands the
      // user without either a platform identity or their original profile.
      if (!(await store.platformAdminExists(admin.authUserId))) {
        await store.insertPlatformAdmin(admin.authUserId);
      }
      await store.removeTenantMembership(admin.authUserId);

      await store.recordReport({
        step: 'convert_super_admin',
        target: admin.authUserId,
        status: 'converted',
        tenantId: admin.tenantId,
      });
      converted += 1;
    } catch (err) {
      const detail = describeError(err);
      await store.recordReport({
        step: 'convert_super_admin',
        target: admin.authUserId,
        status: 'failed',
        detail,
        tenantId: admin.tenantId,
      });
      throw new MigrationHaltError('convert_super_admin', admin.authUserId, detail);
    }
  }

  return converted;
}

/**
 * Migrate legacy plaintext `settings.openai_key` / `settings.anthropic_key` into
 * the encrypted Secret_Store, retaining no plaintext (Requirements 11.6, 6.6,
 * 6.7). Each key is sealed, stored, verified by round-trip, and only then is the
 * plaintext column cleared. Any failure halts the process and records the failing
 * credential by its Secret_Store ref — never its value. Returns the count
 * migrated.
 */
async function migratePlaintextKeys(store: LegacyConversionStore): Promise<number> {
  const keys = await store.listPlaintextKeys();
  let migrated = 0;

  for (const key of keys) {
    const ref = aiKeyRef(key.tenantId, key.provider);
    try {
      // 1. Seal the plaintext with AES-256-GCM (fresh IV per call).
      const sealed = seal(key.value);

      // 2. Persist the sealed envelope (upsert by ref ⇒ idempotent).
      await store.storeSealedSecret(ref, key.tenantId, sealed);

      // 3. Verify the stored ciphertext round-trips to the original value before
      //    destroying the plaintext. A mismatch (or tamper) halts the migration.
      const stored = await store.readSealedSecret(ref);
      if (!stored || open(stored) !== key.value) {
        throw new Error('sealed secret failed round-trip verification');
      }

      // 4. Retain no plaintext: null the source column (Requirements 6.5, 11.6).
      await store.clearPlaintextKey(key.settingsId, PROVIDER_COLUMN[key.provider]);

      await store.recordReport({
        step: 'migrate_key',
        target: ref,
        status: 'converted',
        tenantId: key.tenantId,
      });
      migrated += 1;
    } catch (err) {
      const detail = describeError(err);
      await store.recordReport({
        step: 'migrate_key',
        target: ref,
        status: 'failed',
        detail,
        tenantId: key.tenantId,
      });
      throw new MigrationHaltError('migrate_key', ref, detail);
    }
  }

  return migrated;
}

/**
 * Run the full legacy conversion (task 14.2): convert legacy super admins into
 * platform identities, then migrate plaintext AI keys into the Secret_Store.
 * Halts and reports on the first failure (Requirements 6.6, 6.7, 11.3, 11.6).
 */
export async function runLegacyConversion(): Promise<LegacyConversionResult> {
  const store = storeOrDefault();

  const superAdminsConverted = await convertSuperAdmins(store);
  const keysMigrated = await migratePlaintextKeys(store);

  return { superAdminsConverted, keysMigrated };
}

// ============================================================================
// Default store — backed by a Supabase service-role client.
// ----------------------------------------------------------------------------
// The service-role client bypasses RLS, which is required here: the conversion
// writes `platform_admins` (only readable/writable by platform admins under
// RLS) and reads/clears `settings` rows across tenants. A platform identity
// holds no tenant membership, so an RLS-bound client could not perform this
// work. Reporting reuses `legacy_migration_report` from migration 010.
// ============================================================================

/** Raised when the default store cannot perform a database operation. */
export class LegacyConversionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyConversionStoreError';
  }
}

function getDefaultStore(): LegacyConversionStore {
  async function client() {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new LegacyConversionStoreError(
        'Supabase service-role configuration is missing',
      );
    }
    return createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return {
    async listLegacySuperAdmins(): Promise<LegacySuperAdmin[]> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('profiles')
        .select('id, tenant_id')
        .eq('role', 'super_admin');
      if (error) {
        throw new LegacyConversionStoreError(
          `Failed to list legacy super admins: ${error.message}`,
        );
      }
      return (data ?? []).map((row: { id: string; tenant_id: string }) => ({
        authUserId: row.id,
        tenantId: row.tenant_id,
      }));
    },

    async platformAdminExists(authUserId: string): Promise<boolean> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('platform_admins')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      if (error) {
        throw new LegacyConversionStoreError(
          `Failed to check platform admin existence: ${error.message}`,
        );
      }
      return data != null;
    },

    async insertPlatformAdmin(authUserId: string): Promise<void> {
      const supabase = await client();
      // Conflict-ignoring upsert keeps the step idempotent (Requirement 11.8).
      const { error } = await supabase
        .from('platform_admins')
        .upsert({ auth_user_id: authUserId }, { onConflict: 'auth_user_id', ignoreDuplicates: true });
      if (error) {
        throw new LegacyConversionStoreError(
          `Failed to insert platform admin: ${error.message}`,
        );
      }
    },

    async removeTenantMembership(authUserId: string): Promise<void> {
      const supabase = await client();
      const { error } = await supabase.from('profiles').delete().eq('id', authUserId);
      if (error) {
        throw new LegacyConversionStoreError(
          `Failed to remove tenant membership: ${error.message}`,
        );
      }
    },

    async listPlaintextKeys(): Promise<LegacyPlaintextKey[]> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('settings')
        .select('id, tenant_id, openai_key, anthropic_key')
        .or('openai_key.not.is.null,anthropic_key.not.is.null');
      if (error) {
        throw new LegacyConversionStoreError(
          `Failed to list plaintext keys: ${error.message}`,
        );
      }
      const keys: LegacyPlaintextKey[] = [];
      for (const row of (data ?? []) as Array<{
        id: string;
        tenant_id: string;
        openai_key: string | null;
        anthropic_key: string | null;
      }>) {
        if (row.openai_key) {
          keys.push({
            settingsId: row.id,
            tenantId: row.tenant_id,
            provider: 'openai',
            value: row.openai_key,
          });
        }
        if (row.anthropic_key) {
          keys.push({
            settingsId: row.id,
            tenantId: row.tenant_id,
            provider: 'anthropic',
            value: row.anthropic_key,
          });
        }
      }
      return keys;
    },

    async storeSealedSecret(ref, tenantId, sealed): Promise<void> {
      const supabase = await client();
      const now = new Date().toISOString();
      const { error } = await supabase.from('secret_store').upsert(
        {
          ref,
          tenant_id: tenantId,
          iv: sealed.iv,
          auth_tag: sealed.authTag,
          ciphertext: sealed.ciphertext,
          key_version: sealed.keyVersion,
          updated_at: now,
        },
        { onConflict: 'ref' },
      );
      if (error) {
        throw new LegacyConversionStoreError(
          `Failed to store sealed secret: ${error.message}`,
        );
      }
    },

    async readSealedSecret(ref: string): Promise<SealedSecret | null> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('secret_store')
        .select('iv, auth_tag, ciphertext, key_version')
        .eq('ref', ref)
        .maybeSingle();
      if (error) {
        throw new LegacyConversionStoreError(
          `Failed to read sealed secret: ${error.message}`,
        );
      }
      if (!data) return null;
      const row = data as {
        iv: string;
        auth_tag: string;
        ciphertext: string;
        key_version: number;
      };
      return {
        iv: row.iv,
        authTag: row.auth_tag,
        ciphertext: row.ciphertext,
        keyVersion: row.key_version,
      };
    },

    async clearPlaintextKey(settingsId, column): Promise<void> {
      const supabase = await client();
      const { error } = await supabase
        .from('settings')
        .update({ [column]: null, updated_at: new Date().toISOString() })
        .eq('id', settingsId);
      if (error) {
        throw new LegacyConversionStoreError(
          `Failed to clear plaintext key: ${error.message}`,
        );
      }
    },

    async recordReport(entry: ConversionReportEntry): Promise<void> {
      const supabase = await client();
      // Map onto the `legacy_migration_report` schema from migration 010. Its
      // status CHECK accepts 'migrated' | 'failed'; a successful conversion is
      // recorded as 'migrated'. The secret value is NEVER written here.
      const { error } = await supabase.from('legacy_migration_report').insert({
        table_name: entry.step === 'convert_super_admin' ? 'profiles' : 'secret_store',
        record_id: entry.target,
        step: entry.step,
        status: entry.status === 'converted' ? 'migrated' : 'failed',
        error_detail: entry.detail ?? null,
        source_tenant_id: entry.tenantId,
        target_tenant_id: entry.step === 'convert_super_admin' ? null : entry.tenantId,
      });
      if (error) {
        throw new LegacyConversionStoreError(
          `Failed to record migration report: ${error.message}`,
        );
      }
    },
  };
}
