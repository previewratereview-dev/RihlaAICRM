import type { SetState, GetState } from './types';
import type { Settings } from './types';
import { updateSettingsAction } from '@/app/actions/settings';
import { getActiveTenantId } from './helpers';

export function createSettingsSlice(set: SetState, get: GetState) {
  return {
    updateSettings: async (newSettings: Partial<Settings>, password?: string) => {
      const activeTenantId = getActiveTenantId(get());
      const updated = { ...get().settings, ...newSettings };
      await updateSettingsAction(updated, activeTenantId, password);
      set({ settings: updated });
      await get().logAuditEvent('settings_change', 'Updated global settings configuration.');
    },
  };
}
