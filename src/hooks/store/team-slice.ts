import type { SetState, GetState } from './types';
import type { User } from '@/types';
import { CRMDatabaseService } from '@/lib/db-service';

export function createTeamSlice(set: SetState, get: GetState) {
  return {
    team: [] as User[],

    fetchTeam: async () => {
      const team = await CRMDatabaseService.getTeamMembers();
      set({ team });
    },

    createTeamMember: async (user: User, password?: string) => {
      await CRMDatabaseService.createTeamMember(user, password);
      await get().syncData();
      await get().logAuditEvent('reset_password', `Created team member profile for "${user.fullName}" (${user.email}).`);
    },

    updateTeamMember: async (id: string, updates: Partial<User>, password?: string) => {
      await CRMDatabaseService.updateTeamMember(id, updates, password);
      await get().syncData();
      const member = get().team.find(m => m.id === id);
      await get().logAuditEvent('reset_password', `Updated team member profile details for "${member?.fullName || id}".`);
    },

    deleteTeamMember: async (id: string) => {
      const member = get().team.find(m => m.id === id);
      await CRMDatabaseService.deleteTeamMember(id);
      await get().syncData();
      await get().logAuditEvent('reset_password', `Deleted team member profile for "${member?.fullName || id}".`);
    },

    updatePassword: async (userId: string, newPassword: string) => {
      await CRMDatabaseService.updatePassword(userId, newPassword);
      const member = get().team.find(m => m.id === userId);
      await get().logAuditEvent('reset_password', `Updated password credentials for "${member?.fullName || get().currentUser?.fullName}".`);
    },
  };
}
