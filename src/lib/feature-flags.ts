/**
 * Server-side & Page-level Feature Flags for StateAI CRM Stage C1 Application Read Migration.
 * 
 * In accordance with Stage C1 security guidelines:
 * - `FEATURE_USE_NEW_ENTITIES` remains false globally across the application.
 * - `FEATURE_USE_NEW_TRAVELERS_READ` controls independent read migration of the Travelers directory page (/app/travelers).
 */

export function isNewTravelersReadEnabled(): boolean {
  if (typeof window !== 'undefined') {
    // Client side check via window or global setting if present
    const envVal = process.env.NEXT_PUBLIC_FEATURE_USE_NEW_TRAVELERS_READ;
    if (envVal === 'true') return true;
  }
  return process.env.FEATURE_USE_NEW_TRAVELERS_READ === 'true';
}
