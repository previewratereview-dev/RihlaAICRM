import 'server-only';

/**
 * RBAC_Service — per-tenant, database-backed permission resolution with a cache.
 *
 * Replaces the hardcoded `Permission_Matrix` in `src/lib/permissions.ts` with
 * permissions resolved from per-tenant Role definitions stored in the database
 * (`roles` + `role_permissions`, migration 004).
 *
 * Responsibilities covered by this task (Requirement 7):
 * - Resolve Permissions from per-Tenant Role definitions in the database rather
 *   than a hardcoded matrix, served from a cache so an authorization check does
 *   not incur a database round-trip per check. The cache is refreshed within
 *   60s of any Role or Permission change: explicitly via
 *   {@link invalidateTenantCache} and, as a safety bound, via a 60s TTL. (7.1)
 * - Authorization decisions are served from the in-memory cache, so a check is
 *   a constant-time `Set` membership test well within the 50ms p95 budget. (7.2)
 * - Authorization defaults to **deny**: access is granted only when a resolved
 *   permission set is present and holds the required Permission. A missing
 *   user, role, or permission yields deny. (7.5, 7.7)
 *
 * This module is server-only. Role management (create/update/delete) is added
 * by a later task and is intentionally not implemented here.
 */

import type { Permission } from '@/types/common';
import type { SessionUser } from '@/lib/auth/api-guard';

export type { Permission };

/** A role resolved from the database, with its full permission set. */
export interface ResolvedRole {
  roleId: string;
  tenantId: string;
  name: string;
  isSystem: boolean;
  permissions: Set<Permission>;
}

/**
 * Loads the permission set for a user within a tenant from the data store.
 * Injected so this module stays decoupled from the data-access layer and is
 * testable without a live database. Returns an empty set when the user has no
 * role or the role grants no permissions (which yields a deny decision).
 */
export type PermissionLoader = (
  userId: string,
  tenantId: string,
) => Promise<Set<Permission>>;

/**
 * Maximum staleness of a cached permission set. A change to a Role or its
 * Permissions is reflected within this bound even without an explicit
 * invalidation, satisfying the "refreshed within 60 seconds" guarantee (7.1).
 */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  permissions: Set<Permission>;
  /** Epoch ms after which the entry is considered stale and is reloaded. */
  expiresAt: number;
}

/**
 * Per-tenant cache. Keyed by tenantId so {@link invalidateTenantCache} can drop
 * every user's cached decision for a tenant in one operation when that tenant's
 * roles or permissions change.
 */
const cache = new Map<string, Map<string, CacheEntry>>();

let injectedLoader: PermissionLoader | null = null;

/** Clock indirection so tests can control TTL expiry deterministically. */
let now: () => number = () => Date.now();

/**
 * Register the loader used by {@link resolvePermissions} to read role
 * permissions from the data store. Wired by the data-access layer; kept
 * injectable for isolated server use and testing. Passing `null` clears it.
 */
export function setPermissionLoader(loader: PermissionLoader | null): void {
  injectedLoader = loader;
}

/** Override the clock (testing only). */
export function setClock(clock: () => number): void {
  now = clock ?? (() => Date.now());
}

function getDefaultLoader(): PermissionLoader {
  // Lazily import to avoid pulling the Supabase server client (and next/headers)
  // into modules that only need `can`/cache utilities.
  return async (userId: string, tenantId: string): Promise<Set<Permission>> => {
    const { cookies } = await import('next/headers');
    const { createClient } = await import('@/lib/supabase/server');

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // 1. Resolve the user's role name within the tenant from their profile.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, tenant_id')
      .eq('id', userId)
      .single();

    // Default-deny on any lookup failure or tenant mismatch (7.5, 7.7).
    if (profileError || !profile?.role || profile.tenant_id !== tenantId) {
      return new Set<Permission>();
    }

    // 2. Resolve the tenant-scoped role row (case-insensitive name match).
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('name', profile.role)
      .single();

    if (roleError || !role?.id) {
      return new Set<Permission>();
    }

    // 3. Resolve the permissions granted to that role.
    const { data: rows, error: permsError } = await supabase
      .from('role_permissions')
      .select('permission')
      .eq('role_id', role.id);

    if (permsError || !rows) {
      return new Set<Permission>();
    }

    return new Set<Permission>(
      rows.map((r: { permission: string }) => r.permission as Permission),
    );
  };
}

function loaderOrThrow(): PermissionLoader {
  return injectedLoader ?? getDefaultLoader();
}

/**
 * Resolve the set of Permissions held by a user within a tenant.
 *
 * Served from a per-tenant cache; on a cache miss or expired entry the
 * configured {@link PermissionLoader} reads the role permissions from the
 * database and the result is cached for {@link CACHE_TTL_MS}. The returned set
 * is a defensive copy so callers cannot mutate cached state. (7.1)
 *
 * On any resolution failure the loader returns an empty set, which produces a
 * deny decision in {@link can} (default-deny — 7.5, 7.7).
 */
export async function resolvePermissions(
  userId: string,
  tenantId: string,
): Promise<Set<Permission>> {
  if (!userId || !tenantId) {
    // No resolvable identity ⇒ deny (empty permission set). (7.5, 7.7)
    return new Set<Permission>();
  }

  const tenantCache = cache.get(tenantId);
  const cached = tenantCache?.get(userId);
  if (cached && cached.expiresAt > now()) {
    return new Set<Permission>(cached.permissions);
  }

  const permissions = await loaderOrThrow()(userId, tenantId);

  const entry: CacheEntry = {
    permissions: new Set<Permission>(permissions),
    expiresAt: now() + CACHE_TTL_MS,
  };
  if (tenantCache) {
    tenantCache.set(userId, entry);
  } else {
    cache.set(tenantId, new Map([[userId, entry]]));
  }

  return new Set<Permission>(permissions);
}

/**
 * Return true iff the resolved permission set holds the required Permission.
 *
 * Defaults to **deny**: a missing/empty set, or a set that does not contain the
 * permission, yields `false`. Never throws. (7.5, 7.7)
 */
export function can(
  resolved: Set<Permission> | null | undefined,
  permission: Permission,
): boolean {
  if (!resolved || resolved.size === 0) return false;
  return resolved.has(permission);
}

/**
 * Drop every cached permission set for a tenant. Called when a tenant's Role or
 * Permission definitions change so the next authorization check reloads fresh
 * data, guaranteeing refresh within 60s of the change (7.1).
 */
export function invalidateTenantCache(tenantId: string): void {
  cache.delete(tenantId);
}

// =============================================================================
// Role management (Requirements 7.3, 7.4, 7.6, 7.9, 7.10, 7.11)
//
// Agency_Admins may create, modify, and remove custom Roles within their own
// Tenant. The operations below enforce, in order:
//   - tenant scoping: a Role always belongs to the actor's Tenant, and a Role in
//     another Tenant is invisible (treated as not found) so cross-tenant
//     mutation is impossible (7.6);
//   - name rules: 1–100 characters, non-blank, unique within the Tenant
//     (case-insensitive) (7.3, 7.6);
//   - the privilege-escalation guard: an admin may only add/remove Permissions
//     that the admin's own Role already holds (7.4, 7.10);
//   - system-role immutability: default system Roles can be neither modified nor
//     deleted (7.9);
//   - the in-use block: a Role assigned to one or more Users cannot be deleted,
//     nor may a Permission be removed from it; the error reports the assigned
//     User count (7.11).
//
// Every successful change calls {@link invalidateTenantCache} so authorization
// decisions reflect the change within the 60s freshness bound (7.1).
// =============================================================================

/** A managed Role together with its full Permission set. */
export interface Role {
  roleId: string;
  tenantId: string;
  name: string;
  isSystem: boolean;
  permissions: Set<Permission>;
}

/**
 * Data-access port for Role management. Injected so the service is decoupled
 * from Supabase and unit-testable without a live database, mirroring the
 * {@link PermissionLoader} pattern used for resolution.
 *
 * Implementations MUST scope reads to the supplied `tenantId`: {@link getRole}
 * returns `null` for a Role that does not belong to `tenantId`, which the
 * service treats as "not found" to deny cross-tenant access (7.6).
 */
export interface RoleStore {
  /** Fetch a Role and its Permissions within a Tenant, or `null` if absent. */
  getRole(roleId: string, tenantId: string): Promise<Role | null>;
  /**
   * Return the id of a Role whose name matches `name` case-insensitively within
   * the Tenant, or `null` if none exists. Used for the uniqueness check.
   */
  findRoleIdByName(tenantId: string, name: string): Promise<string | null>;
  /** Insert a custom (non-system) Role with its Permissions; return it. */
  insertRole(
    tenantId: string,
    name: string,
    permissions: Permission[],
  ): Promise<Role>;
  /** Replace a Role's Permission set wholesale. */
  replacePermissions(roleId: string, permissions: Permission[]): Promise<void>;
  /** Delete a Role (its Permissions cascade). */
  deleteRole(roleId: string): Promise<void>;
  /**
   * Count Users currently assigned the Role identified by `roleName`
   * (case-insensitive) within the Tenant. Drives the in-use block (7.11).
   */
  countAssignedUsers(tenantId: string, roleName: string): Promise<number>;
}

let injectedRoleStore: RoleStore | null = null;

/**
 * Register the {@link RoleStore} used by role-management operations. Wired by
 * the data-access layer; kept injectable for isolated server use and testing.
 * Passing `null` restores the default Supabase-backed store.
 */
export function setRoleStore(store: RoleStore | null): void {
  injectedRoleStore = store;
}

/** Thrown when a Role name fails validation or uniqueness. (7.3, 7.6) */
export class RoleValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'RoleValidationError';
    this.field = field;
  }
}

/** Thrown when a referenced Role does not exist in the actor's Tenant. */
export class RoleNotFoundError extends Error {
  readonly roleId: string;
  constructor(roleId: string) {
    super(`Role not found: ${roleId}`);
    this.name = 'RoleNotFoundError';
    this.roleId = roleId;
  }
}

/**
 * Thrown when an admin attempts to grant or revoke a Permission its own Role
 * does not hold. The target Role is left unchanged. (7.4, 7.10)
 */
export class PrivilegeEscalationError extends Error {
  readonly permissions: Permission[];
  constructor(permissions: Permission[]) {
    super(
      'Privilege escalation is not permitted: an administrator may only ' +
        'grant or remove permissions its own role already holds ' +
        `(offending: ${permissions.join(', ')})`,
    );
    this.name = 'PrivilegeEscalationError';
    this.permissions = permissions;
  }
}

/** Thrown when a request tries to modify or delete a default system Role. (7.9) */
export class SystemRoleImmutableError extends Error {
  readonly roleId: string;
  constructor(roleId: string) {
    super('System roles cannot be modified or deleted');
    this.name = 'SystemRoleImmutableError';
    this.roleId = roleId;
  }
}

/**
 * Thrown when a Role assigned to one or more Users would be deleted, or have a
 * Permission removed. The Role, its Permissions, and assignments are retained.
 * The error reports the number of assigned Users. (7.11)
 */
export class RoleInUseError extends Error {
  readonly roleId: string;
  readonly assignedUserCount: number;
  constructor(roleId: string, assignedUserCount: number) {
    super(
      `Role is assigned to ${assignedUserCount} user(s) and cannot be ` +
        'deleted, nor may its permissions be removed',
    );
    this.name = 'RoleInUseError';
    this.roleId = roleId;
    this.assignedUserCount = assignedUserCount;
  }
}

/** Validate a Role name: 1–100 characters and not blank. (7.3, 7.6) */
function validateRoleName(name: string): string {
  if (typeof name !== 'string' || name.length < 1 || name.length > 100) {
    throw new RoleValidationError(
      'name',
      'Role name must be between 1 and 100 characters',
    );
  }
  if (name.trim().length === 0) {
    throw new RoleValidationError('name', 'Role name must not be blank');
  }
  return name;
}

/** Remove duplicates while preserving order. */
function dedupePermissions(perms: Permission[]): Permission[] {
  return Array.from(new Set(perms));
}

/**
 * Privilege-escalation guard. Every Permission whose grant state changes — both
 * additions and removals relative to `existing` — must be held by the actor's
 * own Role; otherwise the operation is rejected with no change. (7.4, 7.10)
 */
function assertNoEscalation(
  actorPermissions: Set<Permission>,
  existing: Set<Permission>,
  desired: Set<Permission>,
): void {
  const changed: Permission[] = [];
  for (const p of desired) {
    if (!existing.has(p) && !actorPermissions.has(p)) changed.push(p);
  }
  for (const p of existing) {
    if (!desired.has(p) && !actorPermissions.has(p)) changed.push(p);
  }
  if (changed.length > 0) {
    throw new PrivilegeEscalationError(dedupePermissions(changed));
  }
}

function roleStoreOrDefault(): RoleStore {
  return injectedRoleStore ?? getDefaultRoleStore();
}

/**
 * Create a custom Role within the actor's Tenant.
 *
 * Enforces name rules and Tenant-scoped uniqueness (7.3, 7.6) and the
 * privilege-escalation guard — every requested Permission must be held by the
 * actor's own Role (7.4, 7.10). New Roles are never system Roles. On success the
 * Tenant cache is invalidated so the change is visible within 60s (7.1).
 */
export async function createRole(
  actor: SessionUser,
  name: string,
  perms: Permission[],
): Promise<Role> {
  const tenantId = actor.tenantId;
  if (!tenantId) {
    throw new RoleValidationError('tenantId', 'Actor has no resolved tenant');
  }

  validateRoleName(name);

  const store = roleStoreOrDefault();

  // Uniqueness within the Tenant (case-insensitive). (7.6)
  const existingId = await store.findRoleIdByName(tenantId, name);
  if (existingId) {
    throw new RoleValidationError(
      'name',
      `A role named "${name}" already exists in this tenant`,
    );
  }

  const desired = new Set<Permission>(dedupePermissions(perms));

  // Privilege-escalation guard: a fresh Role has no existing Permissions, so
  // every requested Permission is an addition and must be held by the actor.
  const actorPermissions = await resolvePermissions(actor.id, tenantId);
  assertNoEscalation(actorPermissions, new Set<Permission>(), desired);

  const role = await store.insertRole(tenantId, name, Array.from(desired));

  invalidateTenantCache(tenantId);
  return role;
}

/**
 * Replace the Permission set of an existing custom Role within the actor's
 * Tenant.
 *
 * Denies operations on system Roles (7.9); applies the privilege-escalation
 * guard to every added or removed Permission (7.4, 7.10); and blocks removing a
 * Permission from a Role that is still assigned to Users, reporting the assigned
 * count (7.11). On success the Tenant cache is invalidated (7.1).
 */
export async function updateRole(
  actor: SessionUser,
  roleId: string,
  perms: Permission[],
): Promise<Role> {
  const tenantId = actor.tenantId;
  if (!tenantId) {
    throw new RoleValidationError('tenantId', 'Actor has no resolved tenant');
  }

  const store = roleStoreOrDefault();

  // Tenant-scoped fetch: a Role outside the actor's Tenant reads as not found,
  // so cross-tenant modification is impossible. (7.6)
  const role = await store.getRole(roleId, tenantId);
  if (!role) {
    throw new RoleNotFoundError(roleId);
  }

  // System roles are immutable. (7.9)
  if (role.isSystem) {
    throw new SystemRoleImmutableError(roleId);
  }

  const desired = new Set<Permission>(dedupePermissions(perms));
  const existing = role.permissions;

  // Privilege-escalation guard over the change set. (7.4, 7.10)
  const actorPermissions = await resolvePermissions(actor.id, tenantId);
  assertNoEscalation(actorPermissions, existing, desired);

  // In-use block: removing a Permission from a Role assigned to Users is
  // rejected; the Role and its Permissions are retained. (7.11)
  const removesPermission = Array.from(existing).some((p) => !desired.has(p));
  if (removesPermission) {
    const assigned = await store.countAssignedUsers(tenantId, role.name);
    if (assigned > 0) {
      throw new RoleInUseError(roleId, assigned);
    }
  }

  await store.replacePermissions(roleId, Array.from(desired));

  invalidateTenantCache(tenantId);
  return { ...role, permissions: desired };
}

/**
 * Delete a custom Role within the actor's Tenant.
 *
 * Denies deletion of system Roles (7.9) and of Roles still assigned to one or
 * more Users, reporting the assigned count (7.11). On success the Tenant cache
 * is invalidated (7.1).
 */
export async function deleteRole(
  actor: SessionUser,
  roleId: string,
): Promise<void> {
  const tenantId = actor.tenantId;
  if (!tenantId) {
    throw new RoleValidationError('tenantId', 'Actor has no resolved tenant');
  }

  const store = roleStoreOrDefault();

  const role = await store.getRole(roleId, tenantId);
  if (!role) {
    throw new RoleNotFoundError(roleId);
  }

  // System roles cannot be deleted. (7.9)
  if (role.isSystem) {
    throw new SystemRoleImmutableError(roleId);
  }

  // In-use block: a Role assigned to Users is retained. (7.11)
  const assigned = await store.countAssignedUsers(tenantId, role.name);
  if (assigned > 0) {
    throw new RoleInUseError(roleId, assigned);
  }

  await store.deleteRole(roleId);

  invalidateTenantCache(tenantId);
}

/**
 * Default Supabase-backed {@link RoleStore}. Lazily imports the server client so
 * modules that only need cache utilities or `can` are not coupled to
 * `next/headers`. Mirrors {@link getDefaultLoader}.
 */
function getDefaultRoleStore(): RoleStore {
  async function client() {
    const { cookies } = await import('next/headers');
    const { createClient } = await import('@/lib/supabase/server');
    const cookieStore = await cookies();
    return createClient(cookieStore);
  }

  /** Escape LIKE wildcards so a name is matched literally (case-insensitively). */
  function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
  }

  async function loadPermissions(
    supabase: Awaited<ReturnType<typeof client>>,
    roleId: string,
  ): Promise<Set<Permission>> {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('permission')
      .eq('role_id', roleId);
    if (error || !data) return new Set<Permission>();
    return new Set<Permission>(
      data.map((r: { permission: string }) => r.permission as Permission),
    );
  }

  return {
    async getRole(roleId: string, tenantId: string): Promise<Role | null> {
      const supabase = await client();
      const { data: row, error } = await supabase
        .from('roles')
        .select('id, tenant_id, name, is_system')
        .eq('id', roleId)
        .eq('tenant_id', tenantId)
        .single();
      if (error || !row) return null;
      const permissions = await loadPermissions(supabase, row.id);
      return {
        roleId: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        isSystem: row.is_system,
        permissions,
      };
    },

    async findRoleIdByName(
      tenantId: string,
      name: string,
    ): Promise<string | null> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('roles')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('name', escapeLike(name))
        .maybeSingle();
      if (error || !data) return null;
      return data.id;
    },

    async insertRole(
      tenantId: string,
      name: string,
      permissions: Permission[],
    ): Promise<Role> {
      const supabase = await client();
      const { data: row, error } = await supabase
        .from('roles')
        .insert({ tenant_id: tenantId, name, is_system: false })
        .select('id, tenant_id, name, is_system')
        .single();
      if (error || !row) {
        throw new Error('Failed to create role');
      }
      if (permissions.length > 0) {
        const { error: permError } = await supabase
          .from('role_permissions')
          .insert(
            permissions.map((permission) => ({ role_id: row.id, permission })),
          );
        if (permError) {
          throw new Error('Failed to assign role permissions');
        }
      }
      return {
        roleId: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        isSystem: row.is_system,
        permissions: new Set<Permission>(permissions),
      };
    },

    async replacePermissions(
      roleId: string,
      permissions: Permission[],
    ): Promise<void> {
      const supabase = await client();
      const { error: delError } = await supabase
        .from('role_permissions')
        .delete()
        .eq('role_id', roleId);
      if (delError) {
        throw new Error('Failed to update role permissions');
      }
      if (permissions.length > 0) {
        const { error: insError } = await supabase
          .from('role_permissions')
          .insert(
            permissions.map((permission) => ({ role_id: roleId, permission })),
          );
        if (insError) {
          throw new Error('Failed to update role permissions');
        }
      }
    },

    async deleteRole(roleId: string): Promise<void> {
      const supabase = await client();
      const { error } = await supabase.from('roles').delete().eq('id', roleId);
      if (error) {
        throw new Error('Failed to delete role');
      }
    },

    async countAssignedUsers(
      tenantId: string,
      roleName: string,
    ): Promise<number> {
      const supabase = await client();
      const { count, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .ilike('role', escapeLike(roleName));
      if (error || count == null) return 0;
      return count;
    },
  };
}
