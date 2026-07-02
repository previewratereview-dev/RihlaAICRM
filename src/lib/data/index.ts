/**
 * Data Access Layer barrel.
 *
 * The single authoritative tenant-scoped path for tenant-owned data (Requirement 8). New code
 * should use `scoped(tenantId)`; `CRMDatabaseService` is a backward-compatible facade retained
 * for existing importers.
 */
export { scoped } from './scoped';
export type { TenantClient } from './scoped';
export { CRMDatabaseService } from './service';
export { newRecordId, rejectClientId, ClientSuppliedIdError } from './ids';
export { assertTenantId, validateTenantAccess, filterLeadsByAuthority, logCrossTenantAccess } from './access';
