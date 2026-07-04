/**
 * StateAI AI Operating System (AIOS) — Security & Feature Flags
 * 
 * Manages tenant-scoped feature flags, trace ID generation, and security boundaries.
 */

export type AIOSFeatureFlag =
  | 'enablePlanner'
  | 'enableMemory'
  | 'enableWorkflow'
  | 'enableVision'
  | 'enableVoice'
  | 'enableAutomation'
  | 'enableHITL'
  | 'enableCustomModels';

export interface FeatureFlagManager {
  isEnabled(tenantId: string, feature: AIOSFeatureFlag): boolean | Promise<boolean>;
  setFlag(tenantId: string, feature: AIOSFeatureFlag, enabled: boolean): void | Promise<void>;
}

export class DefaultFeatureFlagManager implements FeatureFlagManager {
  private tenantFlags: Map<string, Map<AIOSFeatureFlag, boolean>> = new Map();

  constructor() {
    // Set default global flags for development / local testing
    this.setFlag('global', 'enablePlanner', true);
    this.setFlag('global', 'enableMemory', true);
    this.setFlag('global', 'enableWorkflow', true);
    this.setFlag('global', 'enableVision', true);
    this.setFlag('global', 'enableVoice', false);
    this.setFlag('global', 'enableAutomation', true);
    this.setFlag('global', 'enableHITL', true);
    this.setFlag('global', 'enableCustomModels', true);
  }

  isEnabled(tenantId: string, feature: AIOSFeatureFlag): boolean {
    const tenantMap = this.tenantFlags.get(tenantId);
    if (tenantMap && tenantMap.has(feature)) {
      return tenantMap.get(feature)!;
    }
    // Fall back to global defaults
    const globalMap = this.tenantFlags.get('global');
    return globalMap?.get(feature) ?? false;
  }

  setFlag(tenantId: string, feature: AIOSFeatureFlag, enabled: boolean): void {
    if (!this.tenantFlags.has(tenantId)) {
      this.tenantFlags.set(tenantId, new Map());
    }
    this.tenantFlags.get(tenantId)!.set(feature, enabled);
  }
}

export const defaultFeatureFlagManager = new DefaultFeatureFlagManager();

/**
 * Generates a unique, high-entropy distributed Trace ID for execution tracking.
 */
export function generateTraceId(prefix = 'trace'): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 11);
  return `${prefix}_${timestamp}_${randomPart}`;
}
