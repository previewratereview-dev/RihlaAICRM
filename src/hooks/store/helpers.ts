/** Returns the active tenant ID for tenant-scoped operations. */
export function getActiveTenantId(state: { tenantId: string | null }): string {
  const id = state.tenantId;
  if (!id) throw new Error('Tenant context is required');
  return id;
}
