import { describe, it, expect, beforeEach } from 'vitest';

import {
  createUser,
  inviteUser,
  editUser,
  deleteUser,
  suspendUser,
  reinstateUser,
  resetUserPassword,
  setUserStore,
  CrossTenantError,
  ProtectedUserError,
  UserNotFoundError,
  UserManagementInputError,
  AGENCY_ADMIN_ROLE,
  type Actor,
  type ManagedUser,
  type UserStore,
} from './service';
import {
  setSubscriptionLoader,
  LimitExceededError,
  type Subscription,
} from '@/lib/billing/service';
import {
  setInvitationStore,
  type Invitation,
  type InvitationStore,
} from '@/lib/invitations/service';

/**
 * Tenant-scoped user management — unit tests (Task 9.1).
 *
 * Exercises the authorization/safety logic in isolation through an in-memory
 * {@link UserStore}, a controllable billing subscription, and a fake invitation
 * store. Validates Requirements 3.1, 3.2, 3.5, 3.7 (and 2.7 role guard).
 */

const TENANT_A = 'agency-a';
const TENANT_B = 'agency-b';

function admin(id: string, tenantId = TENANT_A): Actor {
  return { id, tenantId, role: 'admin' };
}

/** A simple in-memory UserStore for tests. */
class FakeUserStore implements UserStore {
  users = new Map<string, ManagedUser>();
  removed: string[] = [];
  resets: { userId: string; email: string }[] = [];
  inserted: ManagedUser[] = [];
  private seq = 0;

  seed(u: ManagedUser) {
    this.users.set(u.id, u);
    return u;
  }

  async findById(userId: string): Promise<ManagedUser | null> {
    return this.users.get(userId) ?? null;
  }

  async insert(record: {
    tenantId: string;
    email: string;
    fullName: string;
    role: ManagedUser['role'];
    phone?: string | null;
  }): Promise<ManagedUser> {
    const u: ManagedUser = {
      id: `new-${++this.seq}`,
      tenantId: record.tenantId,
      email: record.email,
      fullName: record.fullName,
      role: record.role,
      status: 'active',
    };
    this.users.set(u.id, u);
    this.inserted.push(u);
    return u;
  }

  async update(
    userId: string,
    patch: Partial<{
      fullName: string;
      role: ManagedUser['role'];
      phone: string | null;
      status: ManagedUser['status'];
    }>,
  ): Promise<ManagedUser> {
    const u = this.users.get(userId);
    if (!u) throw new Error('not found in fake store');
    const next: ManagedUser = {
      ...u,
      fullName: patch.fullName ?? u.fullName,
      role: patch.role ?? u.role,
      status: patch.status ?? u.status,
    };
    this.users.set(userId, next);
    return next;
  }

  async remove(userId: string): Promise<void> {
    this.users.delete(userId);
    this.removed.push(userId);
  }

  async countActiveAdmins(tenantId: string): Promise<number> {
    return [...this.users.values()].filter(
      (u) => u.tenantId === tenantId && u.role === AGENCY_ADMIN_ROLE && u.status === 'active',
    ).length;
  }

  async initiatePasswordReset(userId: string, email: string): Promise<void> {
    this.resets.push({ userId, email });
  }
}

/** Configure billing so a tenant resolves to the given usage on the Free plan. */
function withUsersUsage(tenantId: string, usersUsed: number) {
  const sub: Subscription = {
    tenantId,
    tier: 'free',
    status: 'active',
    periodStart: new Date().toISOString(),
    usage: { users: usersUsed, storageGb: 0, aiCalls: 0, reports: 0, automationRules: 0 },
  };
  setSubscriptionLoader((t) => (t === tenantId ? [sub] : []));
}

let store: FakeUserStore;

beforeEach(() => {
  store = new FakeUserStore();
  setUserStore(store);
  setSubscriptionLoader(() => []); // default: no subscription ⇒ Free, zero usage
  setInvitationStore(null);
});

describe('createUser (3.1)', () => {
  it('creates a user within the actor tenant when under the Users limit', async () => {
    withUsersUsage(TENANT_A, 0);
    const u = await createUser(admin('admin-1'), {
      email: 'new@agency-a.com',
      fullName: 'New Person',
      role: 'specialist',
    });
    expect(u.tenantId).toBe(TENANT_A);
    expect(u.role).toBe('specialist');
    expect(store.inserted).toHaveLength(1);
  });

  it('blocks creation and writes nothing when the Users limit would be exceeded', async () => {
    withUsersUsage(TENANT_A, 3); // Free plan users limit is 3
    await expect(
      createUser(admin('admin-1'), { email: 'over@agency-a.com', fullName: 'Over Limit' }),
    ).rejects.toBeInstanceOf(LimitExceededError);
    expect(store.inserted).toHaveLength(0);
  });

  it('rejects assigning the platform super_admin role within a tenant (2.7)', async () => {
    withUsersUsage(TENANT_A, 0);
    await expect(
      createUser(admin('admin-1'), {
        email: 'x@agency-a.com',
        fullName: 'X',
        role: 'super_admin',
      }),
    ).rejects.toBeInstanceOf(UserManagementInputError);
    expect(store.inserted).toHaveLength(0);
  });

  it('rejects an invalid email', async () => {
    withUsersUsage(TENANT_A, 0);
    await expect(
      createUser(admin('admin-1'), { email: 'not-an-email', fullName: 'X' }),
    ).rejects.toBeInstanceOf(UserManagementInputError);
  });
});

describe('inviteUser (3.1, 3.8)', () => {
  it('issues an invitation in the actor tenant when under the Users limit', async () => {
    withUsersUsage(TENANT_A, 0);
    const captured: { tenantId: string; email: string }[] = [];
    const fakeInvites: InvitationStore = {
      async insert(record): Promise<Invitation> {
        captured.push({ tenantId: record.tenantId, email: record.email });
        return {
          id: 'inv-1',
          tenantId: record.tenantId,
          email: record.email,
          roleId: record.roleId,
          status: 'pending',
          expiresAt: record.expiresAt,
          createdAt: new Date().toISOString(),
        };
      },
      async findById() {
        return null;
      },
      async markAccepted() {
        return null;
      },
      async markExpired() {},
    };
    setInvitationStore(fakeInvites);

    const inv = await inviteUser(admin('admin-1'), { email: 'invitee@agency-a.com' });
    expect(inv.status).toBe('pending');
    expect(captured).toEqual([{ tenantId: TENANT_A, email: 'invitee@agency-a.com' }]);
  });

  it('blocks invitation when the Users limit would be exceeded', async () => {
    withUsersUsage(TENANT_A, 3);
    await expect(
      inviteUser(admin('admin-1'), { email: 'invitee@agency-a.com' }),
    ).rejects.toBeInstanceOf(LimitExceededError);
  });
});

describe('cross-tenant confinement (3.5)', () => {
  it('denies editing a user in another tenant and leaves it unchanged', async () => {
    const target = store.seed({
      id: 'u-b',
      tenantId: TENANT_B,
      email: 'b@agency-b.com',
      fullName: 'B Person',
      role: 'specialist',
      status: 'active',
    });
    await expect(
      editUser(admin('admin-1', TENANT_A), 'u-b', { fullName: 'Hacked' }),
    ).rejects.toBeInstanceOf(CrossTenantError);
    expect(store.users.get('u-b')).toEqual(target);
  });

  it('denies deleting a user in another tenant without removing it', async () => {
    store.seed({
      id: 'u-b',
      tenantId: TENANT_B,
      email: 'b@agency-b.com',
      fullName: 'B Person',
      role: 'specialist',
      status: 'active',
    });
    await expect(
      deleteUser(admin('admin-1', TENANT_A), 'u-b'),
    ).rejects.toBeInstanceOf(CrossTenantError);
    expect(store.removed).toHaveLength(0);
  });

  it('denies a cross-tenant password reset (3.2)', async () => {
    store.seed({
      id: 'u-b',
      tenantId: TENANT_B,
      email: 'b@agency-b.com',
      fullName: 'B Person',
      role: 'specialist',
      status: 'active',
    });
    await expect(
      resetUserPassword(admin('admin-1', TENANT_A), 'u-b'),
    ).rejects.toBeInstanceOf(CrossTenantError);
    expect(store.resets).toHaveLength(0);
  });

  it('throws UserNotFoundError for an unknown user', async () => {
    await expect(
      deleteUser(admin('admin-1'), 'missing'),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe('self and last-admin protection (3.7)', () => {
  it('blocks an admin from deleting their own account', async () => {
    store.seed({
      id: 'admin-1',
      tenantId: TENANT_A,
      email: 'admin@agency-a.com',
      fullName: 'Admin',
      role: 'admin',
      status: 'active',
    });
    // a second admin exists so only the self-rule applies
    store.seed({
      id: 'admin-2',
      tenantId: TENANT_A,
      email: 'admin2@agency-a.com',
      fullName: 'Admin Two',
      role: 'admin',
      status: 'active',
    });
    const err = await deleteUser(admin('admin-1'), 'admin-1').catch((e) => e);
    expect(err).toBeInstanceOf(ProtectedUserError);
    expect((err as ProtectedUserError).reason).toBe('self');
    expect(store.removed).toHaveLength(0);
  });

  it('blocks an admin from suspending their own account', async () => {
    store.seed({
      id: 'admin-1',
      tenantId: TENANT_A,
      email: 'admin@agency-a.com',
      fullName: 'Admin',
      role: 'admin',
      status: 'active',
    });
    store.seed({
      id: 'admin-2',
      tenantId: TENANT_A,
      email: 'admin2@agency-a.com',
      fullName: 'Admin Two',
      role: 'admin',
      status: 'active',
    });
    const err = await suspendUser(admin('admin-1'), 'admin-1').catch((e) => e);
    expect(err).toBeInstanceOf(ProtectedUserError);
    expect((err as ProtectedUserError).reason).toBe('self');
  });

  it('blocks deleting the last active Agency_Admin', async () => {
    store.seed({
      id: 'admin-1',
      tenantId: TENANT_A,
      email: 'admin@agency-a.com',
      fullName: 'Admin',
      role: 'admin',
      status: 'active',
    });
    const target = store.seed({
      id: 'admin-2',
      tenantId: TENANT_A,
      email: 'admin2@agency-a.com',
      fullName: 'Admin Two',
      role: 'admin',
      status: 'active',
    });
    // Suspend admin-1 first so admin-2 is the only active admin.
    await suspendUser(admin('admin-2'), 'admin-1');
    const err = await deleteUser(admin('admin-1'), 'admin-2').catch((e) => e);
    expect(err).toBeInstanceOf(ProtectedUserError);
    expect((err as ProtectedUserError).reason).toBe('last_admin');
    expect(store.users.get('admin-2')).toEqual(target);
  });

  it('blocks suspending the last active Agency_Admin', async () => {
    store.seed({
      id: 'admin-1',
      tenantId: TENANT_A,
      email: 'admin@agency-a.com',
      fullName: 'Admin',
      role: 'admin',
      status: 'active',
    });
    const err = await suspendUser(admin('admin-2', TENANT_A), 'admin-1').catch((e) => e);
    expect(err).toBeInstanceOf(ProtectedUserError);
    expect((err as ProtectedUserError).reason).toBe('last_admin');
    expect(store.users.get('admin-1')!.status).toBe('active');
  });

  it('blocks demoting the last active Agency_Admin out of admin', async () => {
    store.seed({
      id: 'admin-1',
      tenantId: TENANT_A,
      email: 'admin@agency-a.com',
      fullName: 'Admin',
      role: 'admin',
      status: 'active',
    });
    const err = await editUser(admin('admin-2', TENANT_A), 'admin-1', {
      role: 'viewer',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ProtectedUserError);
    expect((err as ProtectedUserError).reason).toBe('last_admin');
  });

  it('allows deleting a non-admin user in the same tenant', async () => {
    store.seed({
      id: 'member-1',
      tenantId: TENANT_A,
      email: 'm@agency-a.com',
      fullName: 'Member',
      role: 'specialist',
      status: 'active',
    });
    await deleteUser(admin('admin-1'), 'member-1');
    expect(store.removed).toEqual(['member-1']);
  });

  it('allows suspending a second admin when more than one active admin exists', async () => {
    store.seed({
      id: 'admin-1',
      tenantId: TENANT_A,
      email: 'a1@agency-a.com',
      fullName: 'A1',
      role: 'admin',
      status: 'active',
    });
    store.seed({
      id: 'admin-2',
      tenantId: TENANT_A,
      email: 'a2@agency-a.com',
      fullName: 'A2',
      role: 'admin',
      status: 'active',
    });
    const u = await suspendUser(admin('admin-1'), 'admin-2');
    expect(u.status).toBe('suspended');
  });
});

describe('reinstate and password reset (3.1, 3.2)', () => {
  it('reinstates a suspended user in the same tenant', async () => {
    store.seed({
      id: 'm',
      tenantId: TENANT_A,
      email: 'm@agency-a.com',
      fullName: 'M',
      role: 'specialist',
      status: 'suspended',
    });
    const u = await reinstateUser(admin('admin-1'), 'm');
    expect(u.status).toBe('active');
  });

  it('initiates a password reset for an own-tenant user', async () => {
    store.seed({
      id: 'm',
      tenantId: TENANT_A,
      email: 'm@agency-a.com',
      fullName: 'M',
      role: 'specialist',
      status: 'active',
    });
    await resetUserPassword(admin('admin-1'), 'm');
    expect(store.resets).toEqual([{ userId: 'm', email: 'm@agency-a.com' }]);
  });
});
