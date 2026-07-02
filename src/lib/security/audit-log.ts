/**
 * Audit_Log service — append-only record of security- and administration-relevant
 * events (Requirement 9, Security Baseline Components in design.md).
 *
 * Responsibilities:
 * - Record security/admin events with actor, action, target, tenant_id, and a
 *   server-generated timestamp (Requirement 9.5).
 * - Provide tenant-scoped reads: a non–Platform Super Admin reader sees only
 *   their own tenant's entries; a Platform Super Admin reads across all tenants
 *   (Requirement 9.11).
 * - Append-only: this module exposes no update or delete operation. The
 *   underlying `audit_logs` table additionally enforces append-only via an
 *   UPDATE/DELETE trigger (migration 005) and via RLS having no UPDATE/DELETE
 *   policy (migration 006) (Requirement 9.10).
 *
 * The Supabase client is injected so the service works both with the
 * RLS-enforced server session client and with service-role clients that bypass
 * RLS — in which case the explicit tenant scoping below is the authoritative
 * isolation control (defense in depth, design §8 / Requirement 8.4).
 *
 * This module is server-only and never embeds secret material in errors.
 */

import 'server-only';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Input for recording a security/admin event (Requirement 9.5). */
export interface AuditEventInput {
  /** The acting identity (user id, email, or platform-admin id). */
  actor: string;
  /** The action performed, e.g. `role.updated`, `agency.suspended`. */
  action: string;
  /** The entity acted upon, e.g. a user id, role id, or tenant id. */
  target: string;
  /** The tenant the event is scoped to. */
  tenantId: string;
  /** Optional structured or free-form detail; objects are JSON-serialised. */
  details?: string | Record<string, unknown> | null;
}

/** A persisted Audit_Log entry. */
export interface AuditLogEntry {
  id: string;
  tenantId: string;
  actor: string;
  action: string;
  target: string;
  details: string | null;
  createdAt: string;
}

/**
 * Identity context of the reader, used to scope reads (Requirement 9.11).
 * `tenantId` is the reader's resolved tenant (null for an identity with no
 * tenant membership, such as a Platform Super Admin).
 */
export interface AuditReaderContext {
  tenantId: string | null;
  isPlatformSuperAdmin: boolean;
}

/** Options for reading the Audit_Log. */
export interface AuditReadOptions {
  /** Maximum number of entries to return (most recent first). */
  limit?: number;
  /** Restrict to a single action value. */
  action?: string;
}

const AUDIT_TABLE = 'audit_logs';
const DEFAULT_READ_LIMIT = 100;

/**
 * Error type for the Audit_Log service. Messages never contain secret material.
 */
export class AuditLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditLogError';
  }
}

function requireNonEmpty(value: string | undefined | null, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AuditLogError(`Audit event requires a non-empty ${field}`);
  }
  return value;
}

function normaliseDetails(details: AuditEventInput['details']): string | null {
  if (details === undefined || details === null) return null;
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    throw new AuditLogError('Audit event details could not be serialised');
  }
}

function mapRow(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: String(row.id ?? ''),
    tenantId: String(row.tenant_id ?? ''),
    actor: (row.actor as string) ?? '',
    action: (row.action as string) ?? '',
    target: (row.target as string) ?? '',
    details: (row.details as string | null) ?? null,
    createdAt: (row.created_at as string) ?? '',
  };
}

/**
 * Record a security- or administration-relevant event in the Audit_Log.
 *
 * The id and timestamp are generated server-side; the entry contains a
 * non-empty actor, action, target, and tenant_id (Requirement 9.5). The write
 * is an insert only — the Audit_Log is append-only (Requirement 9.10).
 */
export async function recordAuditEvent(
  client: SupabaseClient,
  event: AuditEventInput,
): Promise<AuditLogEntry> {
  const actor = requireNonEmpty(event.actor, 'actor');
  const action = requireNonEmpty(event.action, 'action');
  const target = requireNonEmpty(event.target, 'target');
  const tenantId = requireNonEmpty(event.tenantId, 'tenantId');
  const details = normaliseDetails(event.details);

  const entry: AuditLogEntry = {
    id: randomUUID(),
    tenantId,
    actor,
    action,
    target,
    details,
    createdAt: new Date().toISOString(),
  };

  const { error } = await client.from(AUDIT_TABLE).insert({
    id: entry.id,
    tenant_id: entry.tenantId,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    details: entry.details,
    created_at: entry.createdAt,
  });

  if (error) {
    throw new AuditLogError(`Failed to record audit event: ${error.message}`);
  }

  return entry;
}

/**
 * Read Audit_Log entries scoped to the reader (Requirement 9.11).
 *
 * - A Platform Super Admin reads entries across all tenants.
 * - Any other reader receives only entries for their own resolved tenant.
 * - A reader with no resolvable tenant who is not a Platform Super Admin is
 *   denied (Requirement 8.6): the read returns no data and raises an error
 *   rather than leaking other tenants' entries.
 */
export async function readAuditLog(
  client: SupabaseClient,
  reader: AuditReaderContext,
  options: AuditReadOptions = {},
): Promise<AuditLogEntry[]> {
  if (!reader.isPlatformSuperAdmin && !reader.tenantId) {
    throw new AuditLogError('Audit read denied: no resolvable tenant for reader');
  }

  let query = client
    .from(AUDIT_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  // Platform Super Admins read all tenants; everyone else is tenant-scoped.
  if (!reader.isPlatformSuperAdmin) {
    query = query.eq('tenant_id', reader.tenantId as string);
  }

  if (options.action) {
    query = query.eq('action', options.action);
  }

  query = query.limit(options.limit ?? DEFAULT_READ_LIMIT);

  const { data, error } = await query;
  if (error) {
    throw new AuditLogError(`Failed to read audit log: ${error.message}`);
  }

  return (data ?? []).map(mapRow);
}
