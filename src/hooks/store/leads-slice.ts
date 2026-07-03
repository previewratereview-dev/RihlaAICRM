import type { SetState, GetState } from './types';
import type { Lead, LeadNote, LeadActivity, Conversation, Message } from '@/types';
import { CRMDatabaseService } from '@/lib/db-service';
import { generateId } from '@/lib/utils';
import { enrichLeadWithAIScore } from '@/lib/ai/score-integration';
import { calculateLeadScore } from '@/lib/ai/lead-scoring';
import { fetchLLMSummaryForLead } from '@/lib/ai/score-integration';
import { runLeadCreatedAutomations, runLeadStatusAutomations } from '@/lib/automation/triggers';

export function createLeadsSlice(set: SetState, get: GetState) {
  return {
    leads: [] as Lead[],
    notes: {} as Record<string, LeadNote[]>,
    activities: {} as Record<string, LeadActivity[]>,

    addLead: async (newLeadData: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'aiScore' | 'aiSummary'>) => {
      const id = `lead-${generateId()}`;
      const now = new Date().toISOString();
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      // Duplicate detection — check email, phone, or name+business combination
      const existingLeads = get().leads;
      const newEmail = newLeadData.email?.toLowerCase().trim();
      const newPhone = newLeadData.phone?.replace(/[^0-9+]/g, '').trim();
      const newName = newLeadData.fullName?.toLowerCase().trim();
      const newBusiness = newLeadData.businessName?.toLowerCase().trim();

      const duplicate = existingLeads.find((l) => {
        if (newEmail && l.email?.toLowerCase().trim() === newEmail) return true;
        if (newPhone && l.phone?.replace(/[^0-9+]/g, '').trim() === newPhone) return true;
        if (newName && newBusiness && l.fullName?.toLowerCase().trim() === newName && l.businessName?.toLowerCase().trim() === newBusiness) return true;
        return false;
      });

      if (duplicate) {
        const matchBy = newEmail && duplicate.email?.toLowerCase().trim() === newEmail
          ? `email "${duplicate.email}"`
          : newPhone && duplicate.phone?.replace(/[^0-9+]/g, '').trim() === newPhone
            ? `phone "${duplicate.phone}"`
            : `name "${duplicate.fullName}" and business "${duplicate.businessName}"`;
        throw new Error(`A booking already exists for this traveler (${matchBy}). Please edit the existing booking instead.`);
      }

      const draftLead: Lead = {
        ...newLeadData,
        id,
        tenantId: newLeadData.tenantId || currentUser.tenantId,
        aiScore: 0,
        aiSummary: '',
        createdAt: now,
        updatedAt: now,
      };
      const newLead = enrichLeadWithAIScore(draftLead);

      await CRMDatabaseService.upsertLead(newLead, newLead.tenantId, currentUser.role, currentUser);

      const activity: LeadActivity = {
        id: `act-${generateId()}`,
        leadId: id,
        userId: get().currentUser?.id || 'system',
        userName: get().currentUser?.fullName || 'AI System',
        type: 'created',
        title: 'Lead Created',
        description: `Lead added manually in system by ${get().currentUser?.fullName || 'admin'}. Assigned to ${get().team.find(t => t.id === newLeadData.assignedTo)?.fullName || 'Unassigned'}.`,
        createdAt: now,
        tenantId: newLead.tenantId,
      };
      await CRMDatabaseService.insertActivity(activity, activity.tenantId, currentUser.role, currentUser);
      await get().logAuditEvent('create_lead', `Created lead "${newLead.fullName}" of business "${newLead.businessName}".`);

      try {
        await runLeadCreatedAutomations(newLead, {
          makeWebhookUrl: get().settings.makeWebhookUrl,
          emailAutomation: get().settings.emailAutomation,
          emailFromName: get().settings.emailFromName,
          emailReplyTo: get().settings.emailReplyTo,
          emailFollowUpTemplate: get().settings.emailFollowUpTemplate,
        });
      } catch {
        // automations are optional when integrations are not configured
      }

      const hasConversations = get().conversations.some(c => c.leadId === id);

      if (!hasConversations && (newLead.whatsapp || newLead.phone)) {
        const convId = `conv-${generateId()}`;
        const assUser = get().team.find(t => t.id === newLead.assignedTo);

        const newConv: Conversation = {
          id: convId,
          tenantId: newLead.tenantId,
          leadId: id,
          leadName: newLead.fullName,
          leadAvatar: '',
          leadCompany: newLead.businessName || '',
          channel: newLead.whatsapp ? 'whatsapp' : 'sms',
          assignedTo: newLead.assignedTo,
          assignedName: assUser?.fullName || 'Sarah Chen',
          status: 'open',
          lastMessage: 'Lead added to CRM system.',
          lastMessageAt: now,
          unreadCount: 0,
          isOnline: true,
          phone: newLead.whatsapp || newLead.phone
        };
        await CRMDatabaseService.upsertConversation(newConv, newConv.tenantId, currentUser.role, currentUser);

        const sysMsg: Message = {
          id: `msg-${generateId()}`,
          conversationId: convId,
          senderType: 'system',
          senderId: 'system',
          senderName: 'CRM Bot',
          content: 'Conversation channel initialized. Lead is ready for contact.',
          messageType: 'template',
          isRead: true,
          createdAt: now
        };
        await CRMDatabaseService.insertMessage(sysMsg, newConv.tenantId, currentUser.role, currentUser);
      }

      await get().syncData();

      if (newLead.aiScore >= 80) {
        const scoreResult = calculateLeadScore({
          dealValue: newLead.dealValue || 0,
          departureDate: newLead.departureDate,
          returnDate: newLead.returnDate,
          numberOfTravelers: parseInt(newLead.numberOfTravelers) || 1,
          specialRequests: newLead.specialRequests,
          phone: newLead.phone,
          tripType: newLead.tripType,
          travelClass: newLead.travelClass,
          leadSource: newLead.leadSource,
          createdAt: newLead.createdAt,
        });
        fetchLLMSummaryForLead(newLead, scoreResult)
          .then(async (summary) => {
            const currentUser = get().currentUser;
            if (!currentUser) throw new Error('User not authenticated');
            await CRMDatabaseService.upsertLead({ ...newLead, aiSummary: summary }, newLead.tenantId, currentUser.role, currentUser);
            get().syncData();
          })
          .catch(() => {});
      }
    },

    updateLead: async (id: string, updates: Partial<Lead>) => {
      const now = new Date().toISOString();
      const leads = get().leads;
      const currentLead = leads.find((l) => l.id === id);
      if (!currentLead) return;

      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      let assignmentHistory = currentLead.assignmentHistory || [];
      if (updates.assignedTo !== undefined && updates.assignedTo !== currentLead.assignedTo) {
        const prevId = currentLead.assignedTo || 'unassigned';
        const prevUser = get().team.find(m => m.id === prevId);
        const prevName = prevUser ? prevUser.fullName : 'Unassigned';

        const newId = updates.assignedTo || 'unassigned';
        const newUser = get().team.find(m => m.id === newId);
        const newName = newUser ? newUser.fullName : 'Unassigned';

        const reassignmentLog = {
          leadId: id,
          previousOwnerId: prevId,
          previousOwnerName: prevName,
          newOwnerId: newId,
          newOwnerName: newName,
          changedById: get().currentUser?.id || 'system',
          changedByName: get().currentUser?.fullName || 'System',
          timestamp: now
        };
        assignmentHistory = [...assignmentHistory, reassignmentLog];

        const reassignmentAct: LeadActivity = {
          id: `act-${generateId()}`,
          leadId: id,
          userId: get().currentUser?.id || 'system',
          userName: get().currentUser?.fullName || 'AI System',
          type: 'assigned',
          title: 'Lead Owner Reassigned',
          description: `Owner reassigned from ${prevName} to ${newName}.`,
          createdAt: now,
          tenantId: currentLead.tenantId,
        };
        await CRMDatabaseService.insertActivity(reassignmentAct, reassignmentAct.tenantId, currentUser.role, currentUser);
        await get().logAuditEvent('edit_lead', `Reassigned lead "${currentLead.fullName}" from ${prevName} to ${newName}.`);
      }

      const updatedLead = enrichLeadWithAIScore({
        ...currentLead,
        ...updates,
        assignmentHistory,
        updatedAt: now,
      });

      await CRMDatabaseService.upsertLead(updatedLead, updatedLead.tenantId, currentUser.role, currentUser);

      if (updates.status && updates.status !== currentLead.status) {
        const activity: LeadActivity = {
          id: `act-${generateId()}`,
          leadId: id,
          userId: get().currentUser?.id || 'system',
          userName: get().currentUser?.fullName || 'AI System',
          type: 'status_change',
          title: 'Lead Stage Updated',
          description: `Stage moved from ${currentLead.status} to ${updates.status}.`,
          createdAt: now,
          tenantId: currentLead.tenantId,
        };
        await CRMDatabaseService.insertActivity(activity, activity.tenantId, currentUser.role, currentUser);
        await get().logAuditEvent('update_status', `Updated status of lead "${currentLead.fullName}" to ${updates.status}.`);

        try {
          await runLeadStatusAutomations(updatedLead, currentLead.status, {
            makeWebhookUrl: get().settings.makeWebhookUrl,
            emailAutomation: get().settings.emailAutomation,
            emailStatusAutomation: get().settings.emailStatusAutomation,
            emailFromName: get().settings.emailFromName,
            emailReplyTo: get().settings.emailReplyTo,
            emailFollowUpTemplate: get().settings.emailFollowUpTemplate,
          });
        } catch {
          // optional integrations
        }
      }

      if (
        updates.demoDate !== undefined ||
        updates.demoTime !== undefined ||
        updates.googleMeetLink !== undefined ||
        updates.meetingStatus !== undefined ||
        updates.meetingNotes !== undefined
      ) {
        const existingMeeting = get().tasks.find(t => t.leadId === id && t.type === 'meeting');
        const title = `Demo Call with ${updatedLead.fullName}`;
        const dueDate = updatedLead.demoDate
          ? `${updatedLead.demoDate}T${updatedLead.demoTime || '12:00'}:00.000Z`
          : new Date().toISOString();
        const meetPart = updatedLead.googleMeetLink ? `Google Meet: ${updatedLead.googleMeetLink}\n\n` : '';
        const notesPart = updatedLead.meetingNotes ? `Notes: ${updatedLead.meetingNotes}` : '';
        const description = `${meetPart}${notesPart}`.trim();
        const status = updatedLead.meetingStatus === 'completed' ? 'completed' : 'pending';
        const completedAt = status === 'completed' ? now : undefined;

        const assignedTo = updatedLead.assignedTo || get().currentUser?.id || '';
        const assignedUser = get().team.find(m => m.id === assignedTo);
        const assignedName = assignedUser ? assignedUser.fullName : (get().currentUser?.fullName || 'Unassigned');

        if (existingMeeting) {
          await CRMDatabaseService.upsertTask({
            ...existingMeeting,
            title,
            dueDate,
            description,
            status,
            completedAt,
            assignedTo,
            assignedName
          }, existingMeeting.tenantId, currentUser.role, currentUser);
        } else if (updatedLead.demoDate) {
          await CRMDatabaseService.upsertTask({
            id: `task-${generateId()}`,
            title,
            description,
            type: 'meeting',
            priority: 'high',
            status,
            dueDate,
            leadId: id,
            leadName: updatedLead.fullName,
            assignedTo,
            assignedName,
            createdBy: get().currentUser?.id || 'system',
            completedAt,
            tenantId: get().currentUser?.tenantId || updatedLead.tenantId,
            createdAt: now,
            updatedAt: now,
          }, get().currentUser?.tenantId || updatedLead.tenantId, currentUser.role, currentUser);

          const scheduleAct: LeadActivity = {
            id: `act-${generateId()}`,
            leadId: id,
            userId: get().currentUser?.id || 'system',
            userName: get().currentUser?.fullName || 'AI System',
            type: 'meeting',
            title: 'Demo Meeting Scheduled',
            description: `Demo scheduled for ${updatedLead.demoDate} at ${updatedLead.demoTime || '12:00'} (Google Meet Link: ${updatedLead.googleMeetLink || 'None'}).`,
            createdAt: now,
            tenantId: updatedLead.tenantId,
          };
          await CRMDatabaseService.insertActivity(scheduleAct, scheduleAct.tenantId, currentUser.role, currentUser);
        }
      }

      await get().syncData();
    },

    deleteLead: async (id: string) => {
      const lead = get().leads.find(l => l.id === id);
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');
      await CRMDatabaseService.deleteLead(id, lead?.tenantId, currentUser.role, currentUser);
      if (lead) {
        await get().logAuditEvent('delete_lead', `Deleted lead "${lead.fullName}".`);
      }
      await get().syncData();
    },

    addLeadNote: async (leadId: string, authorId: string, authorName: string, content: string) => {
      const id = `note-${generateId()}`;
      const now = new Date().toISOString();

      const newNote: LeadNote = {
        id,
        leadId,
        authorId,
        authorName,
        content,
        isPinned: false,
        tenantId: get().currentUser?.tenantId || '',
        createdAt: now,
        updatedAt: now,
      };
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      await CRMDatabaseService.upsertNote(newNote, newNote.tenantId, currentUser.role, currentUser);

      const activity: LeadActivity = {
        id: `act-${generateId()}`,
        leadId,
        userId: authorId,
        userName: authorName,
        type: 'note_added',
        title: 'New Note Appended',
        description: content.length > 60 ? `${content.substring(0, 57)}...` : content,
        createdAt: now,
        tenantId: get().currentUser?.tenantId || '',
      };
      await CRMDatabaseService.insertActivity(activity, activity.tenantId, currentUser.role, currentUser);

      await get().syncData();
    },

    deleteLeadNote: async (leadId: string, noteId: string) => {
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');
      await CRMDatabaseService.deleteNote(leadId, noteId, currentUser.tenantId, currentUser.role, currentUser);
      await get().syncData();
    },

    addLeadActivity: async (leadId: string, userId: string, userName: string, type: LeadActivity['type'], title: string, description: string) => {
      const activity: LeadActivity = {
        id: `act-${generateId()}`,
        leadId,
        userId,
        userName,
        type,
        title,
        description,
        createdAt: new Date().toISOString(),
        tenantId: get().currentUser?.tenantId || '',
      };
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');
      await CRMDatabaseService.insertActivity(activity, activity.tenantId, currentUser.role, currentUser);
      await get().syncData();
    },
  };
}
