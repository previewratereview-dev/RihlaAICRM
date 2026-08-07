/**
 * Server-side & Page-level Feature Flags for StateAI CRM Stage C1 Application Read Migration.
 * 
 * In accordance with Stage C1 security guidelines:
 * - `FEATURE_USE_NEW_ENTITIES` remains false globally across the application.
 * - `FEATURE_USE_NEW_TRAVELERS_READ` controls independent read migration of the Travelers directory page (/app/travelers).
 * - This flag is strictly server-controlled via process.env.FEATURE_USE_NEW_TRAVELERS_READ.
 * - Query parameters, localStorage, devtools, or client window state cannot enable or override production read flags.
 */

export function isNewTravelersReadEnabled(): boolean {
  // Evaluated directly from server environment variable process.env.FEATURE_USE_NEW_TRAVELERS_READ
  return process.env.FEATURE_USE_NEW_TRAVELERS_READ === 'true';
}
