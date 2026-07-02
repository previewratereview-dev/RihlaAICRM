import type { SetState, GetState } from './types';
import type { Task, TaskUpdate, LeadActivity } from '@/types';
import { CRMDatabaseService } from '@/lib/db-service';
import { generateId } from '@/lib/utils';
import { runMeetingBookedAutomations } from '@/lib/automation/triggers';

export function createTasksSlice(set: SetState, get: GetState) {
  return {
    tasks: [] as Task[],

    addTask: async (taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'assignedName' | 'status'>) => {
      const id = `task-${generateId()}`;
      const now = new Date().toISOString();
      const assignedUser = get().team.find((u) => u.id === taskData.assignedTo);

      const newTask: Task = {
        ...taskData,
        id,
        status: 'pending',
        assignedName: assignedUser?.fullName || 'Unassigned',
        createdAt: now,
        updatedAt: now,
        updates: []
      };
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      await CRMDatabaseService.upsertTask(newTask, newTask.tenantId, currentUser.role, currentUser);

      if (taskData.leadId) {
        const activity: LeadActivity = {
          id: `act-${generateId()}`,
          leadId: taskData.leadId,
          userId: taskData.createdBy,
          userName: get().currentUser?.fullName || 'System',
          type: 'meeting',
          title: `Task Scheduled: ${taskData.title}`,
          description: `Task due by ${new Date(taskData.dueDate).toLocaleDateString()}. Assigned to ${newTask.assignedName}.`,
          createdAt: now,
          tenantId: taskData.tenantId || get().currentUser?.tenantId || '',
        };
        const currentUser = get().currentUser;
        if (!currentUser) throw new Error('User not authenticated');
        await CRMDatabaseService.insertActivity(activity, activity.tenantId, currentUser.role, currentUser);
      }

      await get().logAuditEvent('complete_task', `Created task "${newTask.title}" assigned to ${newTask.assignedName}.`);
      await get().syncData();
    },

    updateTask: async (id: string, updates: Partial<Task>) => {
      const currentTask = get().tasks.find(t => t.id === id);
      if (!currentTask) return;

      const updatedTask: Task = {
        ...currentTask,
        ...updates,
        updatedAt: new Date().toISOString()
      };
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      await CRMDatabaseService.upsertTask(updatedTask, updatedTask.tenantId, currentUser.role, currentUser);
      await get().logAuditEvent('complete_task', `Updated task details for "${currentTask.title}".`);
      await get().syncData();
    },

    toggleTask: async (id: string) => {
      const currentTask = get().tasks.find(t => t.id === id);
      if (!currentTask) return;

      const now = new Date().toISOString();
      const nextStatus = currentTask.status === 'completed' ? 'pending' : 'completed';
      const completedAt = nextStatus === 'completed' ? now : undefined;

      const updatedTask: Task = {
        ...currentTask,
        status: nextStatus,
        completedAt,
        updatedAt: now
      };
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      await CRMDatabaseService.upsertTask(updatedTask, updatedTask.tenantId, currentUser.role, currentUser);

      if (currentTask.leadId) {
        const activity: LeadActivity = {
          id: `act-${generateId()}`,
          leadId: currentTask.leadId,
          userId: currentTask.assignedTo,
          userName: currentTask.assignedName,
          type: 'status_change',
          title: nextStatus === 'completed' ? 'Task Completed' : 'Task Reopened',
          description: `Completed task: "${currentTask.title}"`,
          createdAt: now,
          tenantId: currentTask.tenantId,
        };
        const currentUser = get().currentUser;
        if (!currentUser) throw new Error('User not authenticated');
        await CRMDatabaseService.insertActivity(activity, activity.tenantId, currentUser.role, currentUser);
      }

      await get().logAuditEvent('complete_task', `Task "${currentTask.title}" marked as ${nextStatus}.`);
      await get().syncData();
    },

    deleteTask: async (id: string) => {
      const currentTask = get().tasks.find(t => t.id === id);
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');
      await CRMDatabaseService.deleteTask(id, currentTask?.tenantId, currentUser.role, currentUser);
      if (currentTask) {
        await get().logAuditEvent('complete_task', `Deleted task "${currentTask.title}".`);
      }
      await get().syncData();
    },

    addTaskUpdate: async (taskId: string, note: string, nextStatus?: import('@/types').TaskStatus) => {
      const currentTask = get().tasks.find(t => t.id === taskId);
      if (!currentTask) return;

      const now = new Date().toISOString();
      const user = get().currentUser;
      const authorName = user ? user.fullName : 'System';

      const newUpdate: TaskUpdate = {
        authorName,
        note,
        timestamp: now,
      };

      const updatedTask: Task = {
        ...currentTask,
        updates: [...(currentTask.updates || []), newUpdate],
        status: nextStatus || currentTask.status,
        completedAt: nextStatus === 'completed' ? now : currentTask.completedAt,
        updatedAt: now
      };
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      await CRMDatabaseService.upsertTask(updatedTask, updatedTask.tenantId, currentUser.role, currentUser);

      if (currentTask.leadId) {
        const activity: LeadActivity = {
          id: `act-${generateId()}`,
          leadId: currentTask.leadId,
          userId: user?.id || 'system',
          userName: authorName,
          type: 'note_added',
          title: 'Task Action Update',
          description: `Task "${currentTask.title}": ${note}` + (nextStatus ? ` (Status: ${nextStatus})` : ''),
          createdAt: now,
          tenantId: currentTask.tenantId,
        };
        const currentUser = get().currentUser;
        if (!currentUser) throw new Error('User not authenticated');
        await CRMDatabaseService.insertActivity(activity, activity.tenantId, currentUser.role, currentUser);
      }

      await get().logAuditEvent('complete_task', `Updated task "${currentTask.title}"` + (nextStatus ? ` (Status: ${nextStatus})` : ''));
      await get().syncData();
    },

    adminUpdateTask: async (id: string, updates: Partial<Task>) => {
      const currentTask = get().tasks.find(t => t.id === id);
      if (!currentTask) return;

      const assignedUser = updates.assignedTo
        ? get().team.find(m => m.id === updates.assignedTo)
        : null;
      const assignedName = assignedUser ? assignedUser.fullName : currentTask.assignedName;

      const updatedTask: Task = {
        ...currentTask,
        ...updates,
        assignedName,
        updatedAt: new Date().toISOString()
      };
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      await CRMDatabaseService.upsertTask(updatedTask, updatedTask.tenantId, currentUser.role, currentUser);
      await get().logAuditEvent('settings_change', `Admin updated task details for "${currentTask.title}".`);
      await get().syncData();
    },

    addMeeting: async (meetingData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'type' | 'status' | 'assignedName'>) => {
      const id = `task-${generateId()}`;
      const now = new Date().toISOString();
      const assignedUser = get().team.find((u) => u.id === meetingData.assignedTo);

      const newMeeting: Task = {
        ...meetingData,
        id,
        type: 'meeting',
        status: 'pending',
        assignedName: assignedUser?.fullName || 'Unassigned',
        createdAt: now,
        updatedAt: now,
      };
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      await CRMDatabaseService.upsertTask(newMeeting, newMeeting.tenantId, currentUser.role, currentUser);

      if (meetingData.leadId) {
        const activity: LeadActivity = {
          id: `act-${generateId()}`,
          leadId: meetingData.leadId,
          userId: meetingData.createdBy,
          userName: get().currentUser?.fullName || 'System',
          type: 'meeting',
          title: `Meeting Booked`,
          description: `Scheduled discovery demo at ${new Date(meetingData.dueDate).toLocaleString()}.`,
          createdAt: now,
          tenantId: meetingData.tenantId || get().currentUser?.tenantId || '',
        };
        const currentUser = get().currentUser;
        if (!currentUser) throw new Error('User not authenticated');
        await CRMDatabaseService.insertActivity(activity, activity.tenantId, currentUser.role, currentUser);

        const lead = get().leads.find(l => l.id === meetingData.leadId);
        if (lead && (lead.status === 'new' || lead.status === 'contacted' || lead.status === 'interested')) {
          await get().updateLead(lead.id, { status: 'demo_scheduled' });
        }

        const updatedLead = get().leads.find(l => l.id === meetingData.leadId);
        if (updatedLead) {
          try {
            await runMeetingBookedAutomations(updatedLead, {
              makeWebhookUrl: get().settings.makeWebhookUrl,
            });
          } catch {
            // optional integrations
          }
        }
      }

      await get().logAuditEvent('book_meeting', `Booked meeting "${newMeeting.title}" with client ${newMeeting.leadName || 'Internal'}.`);
      await get().syncData();
    },
  };
}
