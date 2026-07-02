/** Returns the active tenant ID, preferring impersonation override over own tenantId. */
export function getActiveTenantId(state: { tenantId: string | null; impersonateTenantId: string | null }): string {
  const id = state.impersonateTenantId ?? state.tenantId;
  if (!id) throw new Error('Tenant context is required');
  return id;
}
