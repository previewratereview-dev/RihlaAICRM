/**
 * Security baseline services (Requirement 9).
 *
 * - Audit_Log: append-only security/admin event log, tenant-scoped reads with a
 *   Platform-Super-Admin-reads-all carve-out (9.5, 9.10, 9.11).
 * - Activity_Log: tenant-facing user-action log, always tenant-scoped (9.6).
 * - Session manager: server-validated session lifetime policy enforcing a
 *   30-min inactivity timeout and 24-hour absolute lifetime (9.1).
 */

export {
  DEFAULT_INACTIVITY_TIMEOUT_MS,
  DEFAULT_ABSOLUTE_LIFETIME_MS,
  DEFAULT_SESSION_POLICY,
  SESSION_ACTIVITY_COOKIE,
  startSession,
  touchSession,
  evaluateSession,
  serializeActivity,
  parseActivity,
  type SessionPolicy,
  type SessionActivity,
  type SessionEvaluation,
  type SessionExpiryReason,
} from './session-manager';

export {
  recordAuditEvent,
  readAuditLog,
  AuditLogError,
  type AuditEventInput,
  type AuditLogEntry,
  type AuditReaderContext,
  type AuditReadOptions,
} from './audit-log';

export {
  recordActivity,
  readActivityLog,
  ActivityLogError,
  type ActivityEventInput,
  type ActivityLogEntry,
  type ActivityReadOptions,
} from './activity-log';
