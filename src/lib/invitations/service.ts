import 'server-only';

/**
 * Invitations Service — the lifecycle of Agency_Admin user invitations.
 *
 * Backs the `invitations` table (migration 004): a pending invitation carries a
 * `tenant_id`, `email`, optional `role_id`, a `status` of
 * `pending | accepted | expired`, and an `expires_at` set to issuance + 72h.
 *
 * Responsibilities covered by this task (Requirement 3):
 * - When an Agency_Admin invites a User, create the invitation in a **pending**
 *   state whose expiry is exactly issuance time + 72 hours. (3.8)
 * - When a User attempts to accept an invitation that is **expired** or has
 *   **already been accepted**, reject the acceptance, create or activate no
 *   User, and return an error indicating the invitation is no longer valid.
 *   (3.9)
 * - An invitation references the Role the invitee will receive on acceptance
 *   (`role_id`), so role assignment flows through the same record an
 *   Agency_Admin issues within their own tenant. (3.3)
 *
 * This module is server-only. Following the conventions of the sibling lib
 * services (`platform/service.ts`, `rbac/service.ts`, `billing/service.ts`),
 * the data-access port is injected so the core lifecycle logic stays decoupled
 * from Supabase and is testable without a live database.
 */

/** Lifecycle status of an invitation. Mirrors the `invitations.status` check. */
export type InvitationStatus = 'pending' | 'accepted' | 'expired';

/**
 * Time-to-live applied at issuance: an invitation expires exactly 72 hours
 * after it is created. (Requirement 3.8)
 */
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

/** A persisted invitation row. Mirrors the `invitations` table (migration 004). */
export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  /** Role granted to the invitee on acceptance; null when unset (FK SET NULL). */
  roleId: string | null;
  status: InvitationStatus;
  /** ISO-8601 timestamp; issuance + 72h. (3.8) */
  expiresAt: string;
  /** ISO-8601 issuance timestamp. */
  createdAt: string;
}

/** Why an acceptance was rejected. Drives {@link InvalidInvitationError}. */
export type InvalidInvitationReason =
  | 'not_found'
  | 'expired'
  | 'already_accepted';

/**
 * Data-access port for invitations. Injected so the service is decoupled from
 * Supabase and unit-testable without a live database, mirroring the
 * store/loader pattern used by the other lib services.
 */
export interface InvitationStore {
  /**
   * Insert a new pending invitation and return the persisted row (with its
   * server-generated id and timestamps).
   */
  insert(record: {
    tenantId: string;
    email: string;
    roleId: string | null;
    status: 'pending';
    expiresAt: string;
  }): Promise<Invitation>;

  /** Return the invitation with this id, or `null` when none exists. */
  findById(id: string): Promise<Invitation | null>;

  /**
   * Atomically transition a **pending** invitation to **accepted**. The update
   * MUST be conditional on the current status being `pending` so two concurrent
   * acceptances cannot both succeed; return the updated row when this call won
   * the transition, or `null` when the invitation was not pending (already
   * accepted/expired, or lost the race).
   */
  markAccepted(id: string): Promise<Invitation | null>;

  /**
   * Best-effort transition of a time-expired but still-`pending` invitation to
   * `expired`. Conditional on the current status being `pending`. Used to keep
   * stored status consistent when expiry is detected lazily on acceptance; a
   * failure here MUST NOT change the acceptance decision.
   */
  markExpired(id: string): Promise<void>;
}

let injectedStore: InvitationStore | null = null;

/**
 * Register the {@link InvitationStore} used by this service. Kept injectable
 * for isolated server use and testing; passing `null` restores the default
 * service-role-backed store.
 */
export function setInvitationStore(store: InvitationStore | null): void {
  injectedStore = store;
}

/** Clock indirection so tests can control issuance/expiry deterministically. */
let now: () => Date = () => new Date();

/** Override the clock (testing only). Passing `null` restores the real clock. */
export function setClock(clock: (() => Date) | null): void {
  now = clock ?? (() => new Date());
}

/** Raised when a required argument is missing or invalid. */
export class InvitationInputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'InvitationInputError';
    this.field = field;
  }
}

/**
 * Raised when an acceptance is rejected because the invitation is no longer
 * valid — it does not exist, has expired, or has already been accepted. When
 * this is thrown, **no User is created or activated**. (Requirement 3.9)
 */
export class InvalidInvitationError extends Error {
  readonly reason: InvalidInvitationReason;
  constructor(reason: InvalidInvitationReason) {
    super('invitation is no longer valid');
    this.name = 'InvalidInvitationError';
    this.reason = reason;
  }
}

function storeOrDefault(): InvitationStore {
  return injectedStore ?? getDefaultStore();
}

// Minimal email shape check; full provider-side validation is out of scope for
// the invitation lifecycle. Keeps obviously-invalid input from being persisted.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Input for {@link createInvitation}. */
export interface CreateInvitationInput {
  /** Tenant issuing the invitation (the Agency_Admin's own tenant). */
  tenantId: string;
  /** Email address of the invitee. */
  email: string;
  /** Role the invitee receives on acceptance; null when unset. (3.3) */
  roleId?: string | null;
}

/**
 * Create an invitation in the **pending** state with an expiry of exactly
 * issuance time + 72 hours. (Requirements 3.8, 3.3)
 *
 * The invitation is persisted as `pending`; its `expiresAt` is derived solely
 * from the issuance clock so the 72-hour guarantee holds regardless of any
 * client-supplied value.
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<Invitation> {
  const tenantId = input.tenantId?.trim();
  if (!tenantId) {
    throw new InvitationInputError('tenantId', 'tenantId is required');
  }

  const email = input.email?.trim();
  if (!email) {
    throw new InvitationInputError('email', 'email is required');
  }
  if (!EMAIL_RE.test(email)) {
    throw new InvitationInputError('email', 'email is not a valid address');
  }

  const issuedAt = now();
  const expiresAt = new Date(issuedAt.getTime() + INVITATION_TTL_MS);

  return storeOrDefault().insert({
    tenantId,
    email,
    roleId: input.roleId ?? null,
    status: 'pending',
    expiresAt: expiresAt.toISOString(),
  });
}

/** Input for {@link acceptInvitation}. */
export interface AcceptInvitationInput {
  /** Id of the invitation being accepted. */
  id: string;
  /**
   * Performs the User creation/activation associated with a *valid* acceptance.
   * It is invoked **only after** the invitation has been atomically transitioned
   * from pending to accepted, so a rejected acceptance never creates or
   * activates a User. (Requirement 3.9)
   */
  activateUser?: (invitation: Invitation) => Promise<void>;
}

/**
 * Determine whether an invitation is acceptable at the current time. An
 * invitation is acceptable only while it is `pending` and its expiry is still
 * in the future. (Requirements 3.8, 3.9)
 */
export function isAcceptable(invitation: Invitation, at: Date = now()): boolean {
  return (
    invitation.status === 'pending' &&
    at.getTime() < new Date(invitation.expiresAt).getTime()
  );
}

/**
 * Accept an invitation.
 *
 * Rejects — throwing {@link InvalidInvitationError} and creating/activating no
 * User — when the invitation does not exist, has already been accepted, or has
 * expired (either by stored status or because its 72-hour window has elapsed).
 * Only when the invitation is still pending and unexpired is it atomically
 * transitioned to `accepted`; the optional {@link AcceptInvitationInput.activateUser}
 * callback runs strictly after that transition succeeds. (Requirements 3.8, 3.9)
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
): Promise<Invitation> {
  const id = input.id?.trim();
  if (!id) {
    throw new InvitationInputError('id', 'id is required');
  }

  const store = storeOrDefault();
  const invitation = await store.findById(id);

  // Unknown invitation → reject without side effects. (3.9)
  if (!invitation) {
    throw new InvalidInvitationError('not_found');
  }

  // Already accepted → reject; do not create/activate a User. (3.9)
  if (invitation.status === 'accepted') {
    throw new InvalidInvitationError('already_accepted');
  }

  // Already marked expired → reject. (3.9)
  if (invitation.status === 'expired') {
    throw new InvalidInvitationError('expired');
  }

  // Pending but the 72-hour window has elapsed → expired in effect. Persist the
  // status lazily (best-effort) and reject. (3.8, 3.9)
  if (now().getTime() >= new Date(invitation.expiresAt).getTime()) {
    try {
      await store.markExpired(id);
    } catch {
      // A failure to persist the expired status must not change the decision:
      // the invitation is past its window and acceptance is still rejected.
    }
    throw new InvalidInvitationError('expired');
  }

  // Atomically claim the pending → accepted transition. A null result means the
  // invitation was not pending at write time (a concurrent acceptance won, or
  // it was expired), so we reject without creating/activating a User. (3.9)
  const accepted = await store.markAccepted(id);
  if (!accepted) {
    throw new InvalidInvitationError('already_accepted');
  }

  // Only a valid, freshly-claimed acceptance reaches user activation. (3.9)
  if (input.activateUser) {
    await input.activateUser(accepted);
  }

  return accepted;
}

/**
 * Default {@link InvitationStore} backed by a Supabase service-role client.
 *
 * Lazily imports `@supabase/supabase-js` and reads the service-role credentials
 * from the environment so modules needing only the pure helpers are not coupled
 * to the Supabase client. The conditional `markAccepted` / `markExpired`
 * updates filter on `status = 'pending'` so the database enforces the
 * single-winner transition that the acceptance logic relies on.
 */
function getDefaultStore(): InvitationStore {
  async function client() {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new InvitationInputError(
        'config',
        'Supabase service-role configuration is missing',
      );
    }
    return createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  function toInvitation(row: {
    id: string;
    tenant_id: string;
    email: string;
    role_id: string | null;
    status: InvitationStatus;
    expires_at: string;
    created_at: string;
  }): Invitation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      roleId: row.role_id,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  const SELECT = 'id, tenant_id, email, role_id, status, expires_at, created_at';

  return {
    async insert(record): Promise<Invitation> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('invitations')
        .insert({
          tenant_id: record.tenantId,
          email: record.email,
          role_id: record.roleId,
          status: record.status,
          expires_at: record.expiresAt,
        })
        .select(SELECT)
        .single();
      if (error || !data) {
        throw new InvitationInputError('insert', 'Failed to create invitation');
      }
      return toInvitation(data);
    },

    async findById(id: string): Promise<Invitation | null> {
      const supabase = await client();
      const { data, error } = await supabase
        .from('invitations')
        .select(SELECT)
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return null;
      return toInvitation(data);
    },

    async markAccepted(id: string): Promise<Invitation | null> {
      const supabase = await client();
      // Conditional on status = 'pending' so only one acceptance can win.
      const { data, error } = await supabase
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', id)
        .eq('status', 'pending')
        .select(SELECT)
        .maybeSingle();
      if (error || !data) return null;
      return toInvitation(data);
    },

    async markExpired(id: string): Promise<void> {
      const supabase = await client();
      await supabase
        .from('invitations')
        .update({ status: 'expired' })
        .eq('id', id)
        .eq('status', 'pending');
    },
  };
}
