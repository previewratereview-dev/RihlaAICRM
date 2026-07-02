/**
 * Backward-compatible entry point for the Data Access Layer.
 *
 * The former ~1744-line monolith has been refactored into `src/lib/data/*`:
 *  - `scoped(tenantId)`  — the single authoritative tenant-scoped query path (Requirement 8).
 *  - `CRMDatabaseService` — a compatibility facade over that path for existing importers.
 *
 * The legacy localStorage path has been removed (Requirement 8.9); all tenant-owned data flows
 * through the database with mandatory tenant scoping, and new-record identifiers are generated
 * server-side with client-supplied identifiers rejected (Requirement 10.3).
 */
export { CRMDatabaseService, scoped } from './data';
export type { TenantClient } from './data';
