import type { SetState, GetState } from './types';
import type { Settings } from './types';
import { CRMDatabaseService } from '@/lib/db-service';
import { getActiveTenantId } from './helpers';

export function createSettingsSlice(set: SetState, get: GetState) {
  return {
    updateSettings: async (newSettings: Partial<Settings>) => {
      const activeTenantId = getActiveTenantId(get());
      const updated = { ...get().settings, ...newSettings };
      await CRMDatabaseService.updateSettings(updated, activeTenantId);
      set({ settings: updated });
      await get().logAuditEvent('settings_change', 'Updated global settings configuration.');
    },
  };
}
