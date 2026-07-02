import 'server-only';

/**
 * Tenant-scoped User Management Service — invite / create / edit / delete /
 * suspend / reinstate Users and reset their passwords, all confined to the
 * acting Agency_Admin's own Tenant.
 *
 * Responsibilities covered by this task (Requirement 3):
 * - An Agency_Admin may invite, create, edit, delete, and suspend Users within
 *   their own Tenant. User creation and invitation are subject to the Tenant's
 *   `users` Usage_Limit, checked *before* any state change via the billing
 *   service's pre-commit {@link enforceLimit}. (3.1)
 * - A password reset is performed only for a User belonging to the
 *   Agency_Admin's own Tenant. (3.2)
 * - Any management action targeting a User in a *different* Tenant is denied
 *   with an authorization error and leaves data unchanged — the cross-tenant
 *   guard ({@link assertSameTenant}) runs before any mutation. (3.5)
 * - An Agency_Admin may not delete or suspend their own account, nor delete or
 *   suspend the last remaining active Agency_Admin in the Tenant; such requests
 *   are denied and the target's state is preserved. (3.7)
 *
 * The platform-level `super_admin` identity is never created or assigned through
 * this tenant-scoped path: an attempt to set a User's role to `super_admin` is
 * rejected, so a tenant administrator can never mint a platform identity through
 * tenant Role assignment (Requirement 2.7).
 *
 * This module is server-only. Following the conventions of the sibling lib
 * services (`platform/service.ts`, `rbac/service.ts`, `invitations/service.ts`),
 * the data-access port is injected so the core logic stays decoupled from
 * Supabase and is testable without a live database.
 */

import type { UserRole } from '@/types/common';
import type { SessionUser } from '@/lib/auth/api-guard';
import { enforceLimit } from '@/lib/billing/service';
import { createInvitation, type Invitation } from '@/lib/invitations/service';

/**
 * The acting administrator. A subset of {@link SessionUser} carrying the fields
 * the management logic needs: the resolved identity (`id`), the Tenant the
 * action is confined to (`tenantId`), and the actor's role. Accepting the
 * narrowed shape keeps the service callable from tests and non-HTTP contexts.
 */
export type Actor = Pick<SessionUser, 'id' | 'tenantId' | 'role'>;

/** Lifecycle status of a managed User. */
export type UserStatus = 'active' | 'suspended';

/**
 * The tenant-scoped role that denotes an Agency_Admin. The platform
 * `super_admin` identity lives outside any Tenant (Requirement 2.1) and is
 * therefore never an Agency_Admin.
 */
export const AGENCY_ADMIN_ROLE: UserRole = 'admin';

/** A managed User row. Mirrors the tenant-owned `profiles` table. */
export interface ManagedUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
}

/** Whether a managed User is an active Agency_Admin. */
function isActiveAdmin(user: ManagedUser): boolean {
  return user.role === AGENCY_ADMIN_ROLE && user.status === 'active';
}

// Minimal email shape check; full provider-side validation is out of scope for
// user management. Keeps obviously-invalid input from being persisted.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Data-access port for user management. Injected so the service is decoupled
 * from Supabase and unit-testable without a live database, mirroring the
 * store/loader pattern used by the other lib services.
 *
 * Implementations MUST treat ids as global: {@link findById} returns the row
 * regardless of Tenant so the service can compare its `tenantId` to the actor's
 * and deny cross-tenant targets (Requirement 3.5). All scoping/safety decisions
 * are made in the service; the store only persists.
 */
export interface UserStore {
  /** Return the user with this id, or `null` when none exists. */
  findById(userId: string): Promise<ManagedUser | null>;
  /** Create a new active user in a Tenant and return the persisted row. */
  insert(record: {
    tenantId: string;
    email: string;
    fullName: string;
    role: UserRole;
    phone?: string | null;
  }): Promise<ManagedUser>;
  /** Apply a partial update to a user and return the updated row. */
  update(
    userId: string,
    patch: Partial<{
      fullName: string;
      role: UserRole;
      phone: string | null;
      status: UserStatus;
    }>,
  ): Promise<ManagedUser>;
  /** Permanently remove a user. */
  remove(userId: string): Promise<void>;
  /**
   * Count the active Agency_Admins in a Tenant. Drives the last-admin guard
   * (Requirement 3.7): a delete/suspend that would drop this count to zero is
   * rejected.
   */
  countActiveAdmins(tenantId: string): Promise<number>;
  /** Begin a password reset for a user (e.g. send a reset email). */
  initiatePasswordReset(userId: string, email: string): Promise<void>;
}

let injectedStore: UserStore | null = null;

/**
 * Register the {@link UserStore} used by this service. Kept injectable for
 * isolated server use and testing; passing `null` restores the default
 * service-role-backed store.
 */
export function setUserStore(store: UserStore | null): void {
  injectedStore = store;
}

function storeOrDefault(): UserStore {
  return injectedStore ?? getDefaultStore();
}

/** Raised when a required argument is missing or invalid. */
export class UserManagementInputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'UserManagementInputError';
    this.field = field;
  }
}

/**
 * Raised when an Agency_Admin targets a User that belongs to a different
 * Tenant. The operation is denied and no state change occurs. (Requirement 3.5)
 */
export class CrossTenantError extends Error {
  readonly actorTenantId: string;
  readonly targetTenantId: string;
  constructor(actorTenantId: string, targetTenantId: string) {
    super('Cross-tenant management action is not permitted');
    this.name = 'CrossTenantError';
    this.actorTenantId = actorTenantId;
    this.targetTenantId = targetTenantId;
  }
}

/** Raised when a referenced User does not exist. */
export class UserNotFoundError extends Error {
  readonly userId: string;
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
    this.userId = userId;
  }
}

/** Why a delete/suspend was blocked by the safety guards. (Requirement 3.7) */
export type ProtectedUserReason = 'self' | 'last_admin';

/**
 * Raised when a delete/suspend (or last-admin demotion) is blocked because it
 * targets the requesting admin's own account or would remove the Tenant's last
 * active Agency_Admin. The target's current state is preserved. (Requirement 3.7)
 */
export class ProtectedUserError extends Error {
  readonly reason: ProtectedUserReason;
  constructor(reason: ProtectedUserReason) {
    super(
      reason === 'self'
        ? 'An administrator cannot delete or suspend their own account'
        : 'The last remaining Agency Admin cannot be removed or suspended',
    );
    this.name = 'ProtectedUserError';
    this.reason = reason;
  }
}

function requireTenant(actor: Actor): string {
  if (!actor?.tenantId || actor.tenantId.trim().length === 0) {
    throw new UserManagementInputError('tenantId', 'Actor has no resolved tenant');
  }
  return actor.tenantId;
}

/**
 * Cross-tenant guard. A management action is permitted only when the target
 * belongs to the actor's own Tenant; otherwise it is denied with no state
 * change. (Requirement 3.5)
 */
function assertSameTenant(actor: Actor, target: ManagedUser): void {
  if (target.tenantId !== actor.tenantId) {
    throw new CrossTenantError(actor.tenantId, target.tenantId);
  }
}

/**
 * Reject assigning the platform-level `super_admin` identity through this
 * tenant-scoped path. The Platform_Super_Admin exists outside any Tenant and is
 * never granted via tenant Role assignment. (Requirement 2.7)
 */
function assertAssignableRole(role: UserRole | undefined): void {
  if (role === 'super_admin') {
    throw new UserManagementInputError(
      'role',
      'The platform super_admin identity cannot be assigned within a tenant',
    );
  }
}

/** Load a target User and confine it to the actor's Tenant. */
async function loadOwnTenantUser(
  store: UserStore,
  actor: Actor,
  userId: string,
): Promise<ManagedUser> {
  const id = userId?.trim();
  if (!id) {
    throw new UserManagementInputError('userId', 'userId is required');
  }
  const user = await store.findById(id);
  if (!user) {
    throw new UserNotFoundError(id);
  }
  // Cross-tenant target ⇒ deny before any mutation. (3.5)
  assertSameTenant(actor, user);
  return user;
}

/** Input for {@link createUser}. */
export interface CreateUserInput {
  email: string;
  fullName: string;
  /** Defaults to a non-admin member role when omitted. */
  role?: UserRole;
  phone?: string | null;
}

/**
 * Create a User directly within the actor's own Tenant.
 *
 * The `users` Usage_Limit is enforced *before* any write: {@link enforceLimit}
 * throws {@link import('@/lib/billing/service').LimitExceededError} when adding
 * a User would exceed the Tenant's effective limit, so no User is created on
 * exceed. (Requirements 3.1, 4.3)
 */
export async function createUser(
  actor: Actor,
  input: CreateUserInput,
): Promise<ManagedUser> {
  const tenantId = requireTenant(actor);

  const email = input.email?.trim();
  if (!email) {
    throw new UserManagementInputError('email', 'email is required');
  }
  if (!EMAIL_RE.test(email)) {
    throw new UserManagementInputError('email', 'email is not a valid address');
  }
  const fullName = input.fullName?.trim();
  if (!fullName) {
    throw new UserManagementInputError('fullName', 'fullName is required');
  }
  assertAssignableRole(input.role);

  // Pre-commit Users limit check — blocks before any state change. (3.1, 4.3)
  await enforceLimit(tenantId, 'users', 1);

  return storeOrDefault().insert({
    tenantId,
    email,
    fullName,
    role: input.role ?? 'viewer',
    phone: input.phone ?? null,
  });
}

/** Input for {@link inviteUser}. */
export interface InviteUserInput {
  email: string;
  /** Role the invitee receives on acceptance; null when unset. */
  roleId?: string | null;
}

/**
 * Invite a User to the actor's own Tenant.
 *
 * Like {@link createUser}, invitation is subject to the Tenant's `users`
 * Usage_Limit, enforced *before* the invitation is created so an over-limit
 * Tenant cannot grow its user base through invitations. The invitation itself is
 * created in a pending state expiring 72h after issuance by the invitations
 * service. (Requirements 3.1, 3.8)
 */
export async function inviteUser(
  actor: Actor,
  input: InviteUserInput,
): Promise<Invitation> {
  const tenantId = requireTenant(actor);

  const email = input.email?.trim();
  if (!email) {
    throw new UserManagementInputError('email', 'email is required');
  }

  // Pre-commit Users limit check — blocks before any invitation is issued. (3.1)
  await enforceLimit(tenantId, 'users', 1);

  return createInvitation({
    tenantId,
    email,
    roleId: input.roleId ?? null,
  });
}

/** Patch accepted by {@link editUser}. Status changes go through suspend/reinstate. */
export interface EditUserPatch {
  fullName?: string;
  role?: UserRole;
  phone?: string | null;
}

/**
 * Edit a User within the actor's own Tenant.
 *
 * Cross-tenant targets are denied (3.5). The platform `super_admin` role can
 * never be assigned (2.7). Demoting the Tenant's last active Agency_Admin out of
 * the admin role is blocked so the Tenant always retains an administrator
 * (consistent with Requirement 3.7).
 */
export async function editUser(
  actor: Actor,
  userId: string,
  patch: EditUserPatch,
): Promise<ManagedUser> {
  requireTenant(actor);
  const store = storeOrDefault();
  const target = await loadOwnTenantUser(store, actor, userId);

  assertAssignableRole(patch.role);

  // Guard against demoting the last active Agency_Admin away from admin. (3.7)
  if (
    patch.role !== undefined &&
    patch.role !== AGENCY_ADMIN_ROLE &&
    isActiveAdmin(target)
  ) {
    const activeAdmins = await store.countActiveAdmins(target.tenantId);
    if (activeAdmins <= 1) {
      throw new ProtectedUserError('last_admin');
    }
  }

  const update: Partial<{
    fullName: string;
    role: UserRole;
    phone: string | null;
  }> = {};
  if (patch.fullName !== undefined) {
    const fullName = patch.fullName.trim();
    if (!fullName) {
      throw new UserManagementInputError('fullName', 'fullName must not be blank');
    }
    update.fullName = fullName;
  }
  if (patch.role !== undefined) update.role = patch.role;
  if (patch.phone !== undefined) update.phone = patch.phone;

  return store.update(target.id, update);
}

/**
 * Delete a User within the actor's own Tenant.
 *
 * Denied when the target is in another Tenant (3.5), when an admin targets their
 * own account (3.7, `self`), or when deleting an active Agency_Admin would leave
 * the Tenant with no active administrator (3.7, `last_admin`). On a denial the
 * target's state is preserved (no `remove` is issued). (Requirement 3.7)
 */
export async function deleteUser(actor: Actor, userId: string): Promise<void> {
  requireTenant(actor);
  const store = storeOrDefault();
  const target = await loadOwnTenantUser(store, actor, userId);

  // An admin cannot remove their own account. (3.7)
  if (target.id === actor.id) {
    throw new ProtectedUserError('self');
  }

  // Deleting the last active Agency_Admin is blocked. (3.7)
  if (isActiveAdmin(target)) {
    const activeAdmins = await store.countActiveAdmins(target.tenantId);
    if (activeAdmins <= 1) {
      throw new ProtectedUserError('last_admin');
    }
  }

  await store.remove(target.id);
}

/**
 * Suspend a User within the actor's own Tenant.
 *
 * Subject to the same protections as {@link deleteUser}: an admin cannot suspend
 * their own account (3.7, `self`), and suspending the last active Agency_Admin —
 * which would drop the active-admin count to zero — is blocked (3.7,
 * `last_admin`). On a denial the target's state is preserved. (Requirement 3.7)
 */
export async function suspendUser(
  actor: Actor,
  userId: string,
): Promise<ManagedUser> {
  requireTenant(actor);
  const store = storeOrDefault();
  const target = await loadOwnTenantUser(store, actor, userId);

  // An admin cannot suspend their own account. (3.7)
  if (target.id === actor.id) {
    throw new ProtectedUserError('self');
  }

  // Suspending the last active Agency_Admin is blocked. (3.7)
  if (isActiveAdmin(target)) {
    const activeAdmins = await store.countActiveAdmins(target.tenantId);
    if (activeAdmins <= 1) {
      throw new ProtectedUserError('last_admin');
    }
  }

  return store.update(target.id, { status: 'suspended' });
}

/**
 * Reinstate (un-suspend) a previously suspended User within the actor's own
 * Tenant. Cross-tenant targets are denied (3.5). Reinstating only ever adds an
 * active User, so it carries no last-admin/self guard.
 */
export async function reinstateUser(
  actor: Actor,
  userId: string,
): Promise<ManagedUser> {
  requireTenant(actor);
  const store = storeOrDefault();
  const target = await loadOwnTenantUser(store, actor, userId);
  return store.update(target.id, { status: 'active' });
}

/**
 * Initiate a password reset for a User, only when that User belongs to the
 * Agency_Admin's own Tenant; a cross-tenant target is denied with no effect.
 * (Requirement 3.2)
 */
export async function resetUserPassword(
  actor: Actor,
  userId: string,
): Promise<void> {
  requireTenant(actor);
  const store = storeOrDefault();
  const target = await loadOwnTenantUser(store, actor, userId);
  await store.initiatePasswordReset(target.id, target.email);
}

/**
 * Default {@link UserStore} backed by a Supabase service-role client.
 *
 * Lazily imports `@supabase/supabase-js` and reads the service-role credentials
 * from the environment so modules that only need the pure logic are not coupled
 * to the Supabase client, mirroring the default stores of the sibling services.
 *
 * Creating a User provisions the backing auth identity first (so the
 * `profiles.id → auth.users.id` foreign key holds, exactly as the registration
 * service does), then claims/creates the tenant-scoped profile row. All scoping
 * and safety decisions have already been made in the service; the store only
 * persists.
 */
function getDefaultStore(): UserStore {
  async function client() {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new UserManagementInputError(
        'config',
        'Supabase service-role configuration is missing',
      );
    }
    return createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  const SELECT = 'id, tenant_id, email, full_name, role, status';

  function toManagedUser(row: {
    id: string;
    tenant_id: string;
    email: string;
    full_name: string | null;
    role: string;
    status: string | null;
  }): ManagedUser {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      fullName: row.full_name ?? row.email,
      role: row.role as UserRole,
      // A null/absent status is treated as active.
      status: row.status === 'suspended' ? 'suspended' : 'active',
    };
  }

  return {
    async findById(userId: string): Promise<ManagedUser | null> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('profiles')
        .select(SELECT)
        .eq('id', userId)
        .maybeSingle();
      if (error || !data) return null;
      return toManagedUser(data);
    },

    async insert(record): Promise<ManagedUser> {
      const supabase = await client();

      // Provision the auth identity first so profiles.id FK holds and a
      // concurrent duplicate email is rejected at the auth layer.
      const { data: created, error: createErr } =
        await supabase.auth.admin.createUser({
          email: record.email,
          email_confirm: true,
          user_metadata: { full_name: record.fullName },
        });
      if (createErr || !created?.user) {
        throw new UserManagementInputError(
          'email',
          'Failed to create the user identity',
        );
      }

      const { data, error } = await supabase
        .from('profiles')
        .upsert(
          {
            id: created.user.id,
            tenant_id: record.tenantId,
            email: record.email,
            full_name: record.fullName,
            role: record.role,
            phone: record.phone ?? null,
            is_online: false,
            status: 'active',
          },
          { onConflict: 'id' },
        )
        .select(SELECT)
        .single();
      if (error || !data) {
        throw new UserManagementInputError('insert', 'Failed to create the user');
      }
      return toManagedUser(data);
    },

    async update(userId, patch): Promise<ManagedUser> {
      const supabase = await client();
      const dbPatch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.fullName !== undefined) dbPatch.full_name = patch.fullName;
      if (patch.role !== undefined) dbPatch.role = patch.role;
      if (patch.phone !== undefined) dbPatch.phone = patch.phone;
      if (patch.status !== undefined) dbPatch.status = patch.status;

      const { data, error } = await supabase
        .from('profiles')
        .update(dbPatch)
        .eq('id', userId)
        .select(SELECT)
        .single();
      if (error || !data) {
        throw new UserManagementInputError('update', 'Failed to update the user');
      }
      return toManagedUser(data);
    },

    async remove(userId: string): Promise<void> {
      const supabase = await client();
      const { error } = await supabase.from('profiles').delete().eq('id', userId);
      if (error) {
        throw new UserManagementInputError('delete', 'Failed to delete the user');
      }
      // Remove the backing auth identity so the email can be reused.
      await supabase.auth.admin.deleteUser(userId).catch(() => {
        // Profile removal is the authoritative tenant-data deletion; an auth
        // cleanup failure must not leave the profile half-deleted, so it is
        // swallowed here and surfaced through auth-admin tooling instead.
      });
    },

    async countActiveAdmins(tenantId: string): Promise<number> {
      const supabase = await client();
      const { count, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('role', AGENCY_ADMIN_ROLE)
        .eq('status', 'active');
      if (error || count == null) {
        // Fail closed: if we cannot confirm another admin exists, treat the
        // tenant as having a single admin so the last-admin guard blocks.
        return 1;
      }
      return count;
    },

    async initiatePasswordReset(_userId: string, email: string): Promise<void> {
      const supabase = await client();
      const { error } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email,
      });
      if (error) {
        throw new UserManagementInputError(
          'reset',
          'Failed to initiate password reset',
        );
      }
    },
  };
}
