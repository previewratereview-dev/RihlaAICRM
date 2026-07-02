import 'server-only';
import { randomUUID } from 'crypto';
import { recordAuditEvent } from '../security/audit-log';
import type { AuditEventInput, AuditLogEntry } from '../security/audit-log';

/**
 * Platform Admin Service — platform-level identity and first-admin bootstrap.
 *
 * Models the Platform_Super_Admin as an identity that lives entirely outside
 * any tenant: a row in the `platform_admins` table (migration 004) keyed by
 * `auth_user_id`, with no `tenant_id`. Platform authority is therefore resolved
 * from membership in that table and is completely independent of any
 * tenant-scoped `profiles.role` value.
 *
 * Responsibilities covered by this task (Requirement 2):
 * - Represent the Platform_Super_Admin as an identity holding no tenant
 *   membership — the backing `platform_admins` row carries no `tenant_id`. (2.1)
 * - Resolve Platform_Super_Admin authority from the platform-level identity
 *   record rather than from a `profiles.role` value scoped to a tenant. (2.2)
 * - Provide a bootstrap mechanism that creates the first Platform_Super_Admin
 *   identity, outside any tenant, only when none exists yet. (2.8)
 * - The identity is independent of tenant membership, so the platform session
 *   it backs is likewise independent of any tenant. (2.9)
 *
 * Agency suspend / delete / impersonation are added by a later task and are
 * intentionally not implemented here.
 *
 * This module is server-only. Following the conventions of the sibling lib
 * services (`rbac/service.ts`, `billing/service.ts`, `secrets/store.ts`), the
 * data-access port is injected so the core logic stays decoupled from Supabase
 * and is testable without a live database.
 *
 * The default store reads and writes `platform_admins` through a service-role
 * client. This is required for correctness: the `platform_admins` RLS policy
 * (migration 006, `platform_admins_platform_only`) only permits platform admins
 * to read the table, so a user whose platform status is not yet established
 * could never read their own row through the RLS-bound client, and the very
 * first admin could never be inserted. Resolving and bootstrapping therefore
 * run through the server-side service-role path that bypasses RLS, exactly as
 * the migration anticipates.
 */

/**
 * A platform-level identity record. Mirrors the `platform_admins` table: it has
 * no `tenant_id`, so the identity exists outside all tenant membership. (2.1)
 */
export interface PlatformAdmin {
  id: string;
  authUserId: string;
  createdAt: string;
}

/**
 * Data-access port for platform identity. Injected so the service is decoupled
 * from Supabase and unit-testable without a live database, mirroring the
 * loader/store pattern used by the other lib services.
 *
 * Implementations MUST bypass `platform_admins` RLS (service-role path) so that
 * resolution works for users who are not yet established as platform admins and
 * so the first admin can be inserted (see module docs).
 */
export interface PlatformAdminStore {
  /**
   * Return the platform identity for an auth user, or `null` when that user is
   * not a platform admin. Drives {@link isPlatformSuperAdmin}.
   */
  findByAuthUserId(authUserId: string): Promise<PlatformAdmin | null>;
  /** Total number of platform admins. Drives the "only when none exists" guard. */
  countAll(): Promise<number>;
  /** Insert a new platform identity for an auth user and return it. */
  insert(authUserId: string): Promise<PlatformAdmin>;
}

let injectedStore: PlatformAdminStore | null = null;

/**
 * Register the {@link PlatformAdminStore} used by this service. Kept injectable
 * for isolated server use and testing; passing `null` restores the default
 * service-role-backed store.
 */
export function setPlatformAdminStore(store: PlatformAdminStore | null): void {
  injectedStore = store;
}

/**
 * Raised when {@link bootstrapFirstAdmin} is called but a Platform_Super_Admin
 * already exists. Bootstrap creates the *first* admin only; once any admin
 * exists, further admins are added through the regular (audited, authorized)
 * platform-admin management path, never through bootstrap. (2.8)
 */
export class PlatformAdminExistsError extends Error {
  constructor() {
    super(
      'A Platform Super Admin already exists; bootstrap creates only the first admin',
    );
    this.name = 'PlatformAdminExistsError';
  }
}

/** Raised when a required argument is missing or invalid. */
export class PlatformAdminInputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'PlatformAdminInputError';
    this.field = field;
  }
}

function storeOrDefault(): PlatformAdminStore {
  return injectedStore ?? getDefaultStore();
}

/**
 * Determine whether an auth user is a Platform_Super_Admin.
 *
 * Authority is resolved *only* from membership in the platform identity set
 * (`platform_admins`); it does not consult `profiles.role` or any tenant-scoped
 * value, so a tenant role can neither grant nor revoke platform authority.
 * Defaults to deny: a missing/blank id or an absent identity row yields
 * `false`. (2.1, 2.2)
 */
export async function isPlatformSuperAdmin(authUserId: string): Promise<boolean> {
  if (!authUserId) {
    return false;
  }
  const store = storeOrDefault();
  const admin = await store.findByAuthUserId(authUserId);
  return admin !== null;
}

/**
 * Bootstrap the first Platform_Super_Admin identity.
 *
 * Creates a `platform_admins` row for `authUserId` — an identity outside any
 * tenant (2.1, 2.9) — but only when no Platform_Super_Admin exists yet. If one
 * already exists, the call is rejected with {@link PlatformAdminExistsError} and
 * no identity is created. (2.8)
 */
export async function bootstrapFirstAdmin(authUserId: string): Promise<PlatformAdmin> {
  if (!authUserId) {
    throw new PlatformAdminInputError('authUserId', 'authUserId is required');
  }

  const store = storeOrDefault();

  // "Only when none exists": bootstrap is for the very first admin. (2.8)
  const existing = await store.countAll();
  if (existing > 0) {
    throw new PlatformAdminExistsError();
  }

  return store.insert(authUserId);
}

/**
 * Default {@link PlatformAdminStore} backed by a Supabase service-role client.
 *
 * Lazily imports `@supabase/supabase-js` and reads the service-role credentials
 * from the environment so modules that only need the pure helpers are not
 * coupled to the Supabase client. The service-role client bypasses
 * `platform_admins` RLS, which is required for both resolution and bootstrap
 * (see module docs).
 */
function getDefaultStore(): PlatformAdminStore {
  async function client() {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new PlatformAdminInputError(
        'config',
        'Supabase service-role configuration is missing',
      );
    }
    return createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  function toPlatformAdmin(row: {
    id: string;
    auth_user_id: string;
    created_at: string;
  }): PlatformAdmin {
    return {
      id: row.id,
      authUserId: row.auth_user_id,
      createdAt: row.created_at,
    };
  }

  return {
    async findByAuthUserId(authUserId: string): Promise<PlatformAdmin | null> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('platform_admins')
        .select('id, auth_user_id, created_at')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      if (error || !data) return null;
      return toPlatformAdmin(data);
    },

    async countAll(): Promise<number> {
      const supabase = await client();
      const { count, error } = await supabase
        .from('platform_admins')
        .select('id', { count: 'exact', head: true });
      if (error || count == null) {
        // Fail closed: if we cannot confirm the table is empty, do not allow a
        // bootstrap to proceed. Reporting a non-zero count makes
        // bootstrapFirstAdmin reject rather than risk creating a second admin.
        throw new PlatformAdminInputError(
          'count',
          'Unable to determine existing platform admin count',
        );
      }
      return count;
    },

    async insert(authUserId: string): Promise<PlatformAdmin> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('platform_admins')
        .insert({ auth_user_id: authUserId })
        .select('id, auth_user_id, created_at')
        .single();
      if (error || !data) {
        throw new PlatformAdminInputError(
          'insert',
          'Failed to create platform admin identity',
        );
      }
      return toPlatformAdmin(data);
    },
  };
}

// ============================================================================
// Agency lifecycle: suspend / reinstate / delete / impersonate (Task 8.2)
// ----------------------------------------------------------------------------
// These are platform-level capabilities exercised by a Platform_Super_Admin.
// Authorization (only a Platform_Super_Admin may invoke them, tenant-scoped
// users are denied) is enforced at the API_Guard layer (task 8.3); the service
// functions accept the acting platform identity (`actorId`) so the action can
// be attributed in the Audit_Log.
//
// All data access runs through the service-role path, consistent with the
// default platform-admin store: suspension and deletion touch `tenants` and
// tenant-owned tables across schemas guarded by RLS, and the work must succeed
// for a platform identity that holds no tenant membership.
// ============================================================================

/** The lifecycle status of an Agency, mirroring `tenants.status`. */
export type AgencyStatus = 'active' | 'suspended';

/**
 * A short-lived authorization to access a Tenant's data under an explicit
 * impersonation action (Requirement 2.10). The token is only minted *after* the
 * corresponding Audit_Log entry is persisted, so `auditLogId` always references
 * a recorded access. Default lifetime is 30 minutes.
 */
export interface ImpersonationToken {
  /** Opaque, server-generated token authorizing scoped impersonated access. */
  token: string;
  /** The Platform_Super_Admin identity performing the impersonation. */
  actorId: string;
  /** The Tenant whose data may be accessed under this token. */
  tenantId: string;
  /** ISO-8601 issuance timestamp. */
  issuedAt: string;
  /** ISO-8601 expiry timestamp. */
  expiresAt: string;
  /** The Audit_Log entry id recorded *before* this token was returned. */
  auditLogId: string;
}

/** Default impersonation-token lifetime: 30 minutes. */
const IMPERSONATION_TTL_MS = 30 * 60 * 1000;

/**
 * The tenant-owned tables whose rows must be removed when an Agency is deleted
 * so that no tenant-owned data remains retrievable (Requirements 2.6, 8.8).
 *
 * Ordering matters: the legacy tables (migration `supabase_schema.sql`) declare
 * their `tenant_id` foreign key as `ON DELETE RESTRICT`, so their rows must be
 * cleared explicitly and in child-before-parent order before the `tenants` row
 * itself is removed. The remaining tenant-owned tables (migration 004 and the
 * legacy `ON DELETE CASCADE` tables) are cleared by the `tenants` delete
 * cascade, but we also clear them explicitly here so deletion is deterministic
 * and verifiable regardless of the exact cascade configuration of a given
 * deployment.
 *
 * `audit_logs` is intentionally excluded: it is append-only (migration 005
 * trigger) and is retained as the security record of the deletion itself.
 * `role_permissions` carries no `tenant_id` (it is scoped through `roles`) and
 * is removed by the `roles` delete cascade.
 */
const TENANT_OWNED_TABLES_IN_DELETE_ORDER: readonly string[] = [
  // Legacy ON DELETE RESTRICT tables — child rows first.
  'messages',
  'notes',
  'activities',
  'conversations',
  'tasks',
  'leads',
  // Legacy ON DELETE CASCADE tables.
  'ai_usage',
  'faq_entries',
  'knowledge_documents',
  'settings',
  // Migration 004 tenant-owned tables.
  'documents',
  'files',
  'secret_store',
  'invitations',
  'integration_credentials',
  'roles',
  'subscriptions',
  // Profiles last among tenant-owned rows: other rows may reference them.
  'profiles',
];

/**
 * Data-access port for Agency lifecycle operations. Injected so the service is
 * decoupled from Supabase and unit-testable without a live database, mirroring
 * {@link PlatformAdminStore}.
 *
 * Implementations MUST use the service-role path: a Platform_Super_Admin holds
 * no tenant membership, so an RLS-bound client could not write another tenant's
 * `tenants.status` nor clear its tenant-owned rows.
 */
export interface PlatformAgencyStore {
  /** Set an Agency's lifecycle status (`tenants.status`). */
  setAgencyStatus(tenantId: string, status: AgencyStatus): Promise<void>;
  /**
   * Remove every tenant-owned row for the Agency and the `tenants` row itself,
   * leaving no orphaned tenant-owned rows (Requirements 2.6, 8.8). MUST throw if
   * any tenant-owned row remains after deletion.
   */
  deleteAgencyData(tenantId: string): Promise<void>;
  /** Record an Audit_Log entry and return the persisted entry. */
  recordAudit(event: AuditEventInput): Promise<AuditLogEntry>;
}

let injectedAgencyStore: PlatformAgencyStore | null = null;

/**
 * Register the {@link PlatformAgencyStore} used by the Agency lifecycle
 * functions. Kept injectable for isolated server use and testing; passing
 * `null` restores the default service-role-backed store.
 */
export function setPlatformAgencyStore(store: PlatformAgencyStore | null): void {
  injectedAgencyStore = store;
}

function agencyStoreOrDefault(): PlatformAgencyStore {
  return injectedAgencyStore ?? getDefaultAgencyStore();
}

function requireId(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PlatformAdminInputError(field, `${field} is required`);
  }
  return value;
}

/**
 * Suspend an Agency (Requirement 2.5).
 *
 * Flips `tenants.status` to `'suspended'`. Authentication for that Agency's
 * users is blocked by server-side session revalidation, which re-checks the
 * tenant status within at most 60 seconds (see design §2 and the session
 * manager) and refuses to validate sessions for a suspended tenant until it is
 * reinstated. The status change is recorded in the Audit_Log.
 */
export async function suspendAgency(actorId: string, tenantId: string): Promise<void> {
  const actor = requireId(actorId, 'actorId');
  const tenant = requireId(tenantId, 'tenantId');

  const store = agencyStoreOrDefault();
  await store.setAgencyStatus(tenant, 'suspended');
  await store.recordAudit({
    actor,
    action: 'agency.suspended',
    target: tenant,
    tenantId: tenant,
    details: { status: 'suspended' },
  });
}

/**
 * Reinstate a previously suspended Agency.
 *
 * Flips `tenants.status` back to `'active'` so its users can authenticate again
 * once session revalidation observes the change (Requirement 2.5, "until the
 * Agency is reinstated"). The change is recorded in the Audit_Log.
 */
export async function reinstateAgency(actorId: string, tenantId: string): Promise<void> {
  const actor = requireId(actorId, 'actorId');
  const tenant = requireId(tenantId, 'tenantId');

  const store = agencyStoreOrDefault();
  await store.setAgencyStatus(tenant, 'active');
  await store.recordAudit({
    actor,
    action: 'agency.reinstated',
    target: tenant,
    tenantId: tenant,
    details: { status: 'active' },
  });
}

/**
 * Delete an Agency and render its tenant-owned data no longer retrievable
 * through any System interface (Requirement 2.6), cascading across all
 * tenant-owned tables with no orphaned rows left behind (Requirement 8.8).
 *
 * The deletion is recorded in the append-only Audit_Log *after* the data is
 * confirmed removed; the audit entry is itself retained (audit_logs is
 * append-only and is not tenant-owned business data).
 */
export async function deleteAgency(actorId: string, tenantId: string): Promise<void> {
  const actor = requireId(actorId, 'actorId');
  const tenant = requireId(tenantId, 'tenantId');

  const store = agencyStoreOrDefault();
  await store.deleteAgencyData(tenant);
  await store.recordAudit({
    actor,
    action: 'agency.deleted',
    target: tenant,
    tenantId: tenant,
    details: { deleted: true },
  });
}

/**
 * Begin an explicit impersonation of a Tenant for support purposes
 * (Requirements 2.10, 8.11).
 *
 * The Audit_Log entry is written and confirmed persisted **before** an
 * {@link ImpersonationToken} is returned, so no impersonated data access can be
 * authorized without a recorded audit entry. The returned token carries the
 * recorded `auditLogId` and a 30-minute expiry.
 */
export async function impersonate(
  actorId: string,
  tenantId: string,
): Promise<ImpersonationToken> {
  const actor = requireId(actorId, 'actorId');
  const tenant = requireId(tenantId, 'tenantId');

  const store = agencyStoreOrDefault();

  // Audit BEFORE returning any access-bearing data (2.10, 8.11). If this write
  // fails it throws and no token is minted, so access is never granted without
  // a recorded audit entry.
  const entry = await store.recordAudit({
    actor,
    action: 'agency.impersonated',
    target: tenant,
    tenantId: tenant,
    details: { reason: 'support_impersonation' },
  });

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + IMPERSONATION_TTL_MS);

  return {
    token: randomUUID(),
    actorId: actor,
    tenantId: tenant,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    auditLogId: entry.id,
  };
}

/**
 * Default {@link PlatformAgencyStore} backed by a Supabase service-role client,
 * consistent with the default platform-admin store. The service-role client
 * bypasses RLS, which is required because a Platform_Super_Admin holds no
 * tenant membership and so could not otherwise mutate another tenant's rows.
 */
function getDefaultAgencyStore(): PlatformAgencyStore {
  async function client() {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new PlatformAdminInputError(
        'config',
        'Supabase service-role configuration is missing',
      );
    }
    return createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return {
    async setAgencyStatus(tenantId: string, status: AgencyStatus): Promise<void> {
      const supabase = await client();
      const { error } = await supabase
        .from('tenants')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', tenantId);
      if (error) {
        throw new PlatformAdminInputError(
          'status',
          `Failed to set agency status: ${error.message}`,
        );
      }
    },

    async deleteAgencyData(tenantId: string): Promise<void> {
      const supabase = await client();

      // Clear tenant-owned rows in child-before-parent order so RESTRICT
      // foreign keys do not block the final tenant delete.
      for (const table of TENANT_OWNED_TABLES_IN_DELETE_ORDER) {
        const { error } = await supabase.from(table).delete().eq('tenant_id', tenantId);
        if (error) {
          throw new PlatformAdminInputError(
            'delete',
            `Failed to delete ${table} rows for agency: ${error.message}`,
          );
        }
      }

      // Remove the tenant itself (cascades any remaining ON DELETE CASCADE rows).
      const { error: tenantError } = await supabase
        .from('tenants')
        .delete()
        .eq('id', tenantId);
      if (tenantError) {
        throw new PlatformAdminInputError(
          'delete',
          `Failed to delete agency: ${tenantError.message}`,
        );
      }

      // Verify no orphaned tenant-owned rows remain (Requirement 8.8).
      for (const table of TENANT_OWNED_TABLES_IN_DELETE_ORDER) {
        const { count, error } = await supabase
          .from(table)
          .select('tenant_id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId);
        if (error) {
          throw new PlatformAdminInputError(
            'verify',
            `Failed to verify ${table} cleanup for agency: ${error.message}`,
          );
        }
        if ((count ?? 0) > 0) {
          throw new PlatformAdminInputError(
            'verify',
            `Agency deletion left ${count} orphaned row(s) in ${table}`,
          );
        }
      }
    },

    async recordAudit(event: AuditEventInput): Promise<AuditLogEntry> {
      const supabase = await client();
      return recordAuditEvent(supabase, event);
    },
  };
}
