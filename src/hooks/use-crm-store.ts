import { create } from 'zustand';
import type { CRMStore } from './store/types';
import { createUiSlice } from './store/ui-slice';
import { createAuthSlice, getAuthAdapter } from './store/auth-slice';
import { createLeadsSlice } from './store/leads-slice';
import { createTasksSlice } from './store/tasks-slice';
import { createConversationsSlice } from './store/conversations-slice';
import { createTeamSlice } from './store/team-slice';
import { createSettingsSlice } from './store/settings-slice';
import { getActiveTenantId } from './store/helpers';

export { getAuthAdapter, getActiveTenantId };
export type { Settings } from './store/types';
export type { AuthAdapter } from './store/auth-slice';

export const useCRMStore = create<CRMStore>()((set, get) => ({
  ...createUiSlice(set, get),
  ...createAuthSlice(set, get),
  ...createLeadsSlice(set, get),
  ...createTasksSlice(set, get),
  ...createConversationsSlice(set, get),
  ...createTeamSlice(set, get),
  ...createSettingsSlice(set, get),
}));

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).useCRMStore = useCRMStore;
}
