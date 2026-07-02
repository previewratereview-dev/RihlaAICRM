/**
 * Activity_Log service — record of user-facing actions within a Tenant
 * (Requirement 9.6, Security Baseline Components in design.md).
 *
 * Distinct from the Audit_Log (which captures security/admin events): the
 * Activity_Log captures tenant-facing user actions. Both writes and reads are
 * always tenant-scoped — there is no cross-tenant read path here (the
 * Platform-Super-Admin-reads-all carve-out applies only to the Audit_Log,
 * Requirement 9.11).
 *
 * Entries are written to the `activity_logs` table (migration 007), which is
 * RLS-scoped to the resolving tenant. As with the Audit_Log service, the
 * Supabase client is injected so the service works with both the RLS-enforced
 * session client and service-role clients, with the explicit tenant scoping
 * below acting as the authoritative isolation control (design §8).
 *
 * This module is server-only.
 */

import 'server-only';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Input for recording a tenant-facing action (Requirement 9.6). */
export interface ActivityEventInput {
  /** The tenant the action belongs to. */
  tenantId: string;
  /** The acting user (id, email, or display name). */
  actor: string;
  /** The action performed, e.g. `lead.created`, `report.exported`. */
  action: string;
  /** Optional entity acted upon. */
  target?: string | null;
  /** Optional structured or free-form detail; objects are JSON-serialised. */
  details?: string | Record<string, unknown> | null;
}

/** A persisted Activity_Log entry. */
export interface ActivityLogEntry {
  id: string;
  tenantId: string;
  actor: string;
  action: string;
  target: string | null;
  details: string | null;
  createdAt: string;
}

/** Options for reading the Activity_Log. */
export interface ActivityReadOptions {
  /** Maximum number of entries to return (most recent first). */
  limit?: number;
  /** Restrict to a single action value. */
  action?: string;
}

const ACTIVITY_TABLE = 'activity_logs';
const DEFAULT_READ_LIMIT = 100;

/** Error type for the Activity_Log service. */
export class ActivityLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityLogError';
  }
}

function requireNonEmpty(value: string | undefined | null, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ActivityLogError(`Activity event requires a non-empty ${field}`);
  }
  return value;
}

function normaliseDetails(details: ActivityEventInput['details']): string | null {
  if (details === undefined || details === null) return null;
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    throw new ActivityLogError('Activity event details could not be serialised');
  }
}

function mapRow(row: Record<string, unknown>): ActivityLogEntry {
  return {
    id: String(row.id ?? ''),
    tenantId: String(row.tenant_id ?? ''),
    actor: (row.actor as string) ?? '',
    action: (row.action as string) ?? '',
    target: (row.target as string | null) ?? null,
    details: (row.details as string | null) ?? null,
    createdAt: (row.created_at as string) ?? '',
  };
}

/**
 * Record a tenant-facing user action in the Tenant's Activity_Log
 * (Requirement 9.6). The id and timestamp are generated server-side and the
 * entry is scoped to the supplied tenant.
 */
export async function recordActivity(
  client: SupabaseClient,
  event: ActivityEventInput,
): Promise<ActivityLogEntry> {
  const tenantId = requireNonEmpty(event.tenantId, 'tenantId');
  const actor = requireNonEmpty(event.actor, 'actor');
  const action = requireNonEmpty(event.action, 'action');
  const target =
    typeof event.target === 'string' && event.target.trim().length > 0
      ? event.target
      : null;
  const details = normaliseDetails(event.details);

  const entry: ActivityLogEntry = {
    id: randomUUID(),
    tenantId,
    actor,
    action,
    target,
    details,
    createdAt: new Date().toISOString(),
  };

  const { error } = await client.from(ACTIVITY_TABLE).insert({
    id: entry.id,
    tenant_id: entry.tenantId,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    details: entry.details,
    created_at: entry.createdAt,
  });

  if (error) {
    throw new ActivityLogError(`Failed to record activity: ${error.message}`);
  }

  return entry;
}

/**
 * Read Activity_Log entries for a single tenant (Requirement 9.6). Reads are
 * always tenant-scoped; a non-empty tenant id is required.
 */
export async function readActivityLog(
  client: SupabaseClient,
  tenantId: string,
  options: ActivityReadOptions = {},
): Promise<ActivityLogEntry[]> {
  const scopedTenantId = requireNonEmpty(tenantId, 'tenantId');

  let query = client
    .from(ACTIVITY_TABLE)
    .select('*')
    .eq('tenant_id', scopedTenantId)
    .order('created_at', { ascending: false });

  if (options.action) {
    query = query.eq('action', options.action);
  }

  query = query.limit(options.limit ?? DEFAULT_READ_LIMIT);

  const { data, error } = await query;
  if (error) {
    throw new ActivityLogError(`Failed to read activity log: ${error.message}`);
  }

  return (data ?? []).map(mapRow);
}
