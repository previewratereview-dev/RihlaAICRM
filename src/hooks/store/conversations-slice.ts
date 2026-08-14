import type { SetState, GetState } from './types';
import type { Conversation, Message, LeadActivity } from '@/types';
import { CRMDatabaseService } from '@/lib/db-service';
import { generateId } from '@/lib/utils';
import { analyzeMessageSentiment } from '@/lib/ai/sentiment';

export function createConversationsSlice(set: SetState, get: GetState) {
  return {
    conversations: [] as Conversation[],
    messages: {} as Record<string, Message[]>,

    startConversation: async (
      leadId: string | null | undefined,
      channel: 'whatsapp' | 'sms' | 'email' = 'email',
      context?: {
        travelerId?: string | null;
        inquiryId?: string | null;
        bookingId?: string | null;
        travelerName?: string;
        travelerEmail?: string;
        phone?: string;
        tenantId?: string;
      }
    ) => {
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      // Verify if leadId corresponds to a genuine legacy lead
      const lead = leadId ? get().leads.find((l) => l.id === leadId) : null;
      const genuineLeadId = lead ? lead.id : (leadId && leadId.startsWith('lead-') ? leadId : null);

      const travelerId = context?.travelerId || null;
      const inquiryId = context?.inquiryId || null;
      const bookingId = context?.bookingId || null;

      const travelerName = context?.travelerName || lead?.fullName || 'Traveler';
      const travelerEmail = context?.travelerEmail || lead?.email || '';
      const phone = context?.phone || lead?.phone || '';
      const tenantId = context?.tenantId || lead?.tenantId || get().tenantId || currentUser.tenantId;

      // Check if conversation already exists for this lead/traveler on this channel
      const existing = get().conversations.find((c) => {
        if (c.channel !== channel) return false;
        if (genuineLeadId && c.leadId === genuineLeadId) return true;
        if (travelerId && c.travelerId === travelerId) return true;
        if (travelerEmail && c.leadEmail === travelerEmail) return true;
        return false;
      });

      if (existing) {
        set({ activeTab: 'conversations' });
        return existing.id;
      }

      const now = new Date().toISOString();
      const convId = `conv-${generateId()}`;
      
      const newConv: Conversation = {
        id: convId,
        tenantId,
        leadId: genuineLeadId,
        travelerId,
        inquiryId,
        bookingId,
        leadName: travelerName,
        leadAvatar: '',
        leadCompany: lead?.businessName || '',
        leadEmail: travelerEmail,
        phone,
        channel,
        assignedTo: currentUser.id,
        assignedName: currentUser.fullName,
        status: 'open',
        lastMessage: 'Conversation started',
        lastMessageAt: now,
        unreadCount: 0,
        isOnline: false,
      };

      try {
        await CRMDatabaseService.upsertConversation(newConv, newConv.tenantId, currentUser.role, currentUser);
      } catch {
        // Continue in local/fallback mode
      }

      set((state) => ({
        conversations: [newConv, ...state.conversations],
        activeTab: 'conversations'
      }));

      return convId;
    },

    sendMessage: async (conversationId: string, content: string, senderType: 'user' | 'contact' | 'system', senderId: string, senderName: string) => {
      const now = new Date().toISOString();
      const messageId = `msg-${generateId()}`;

      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      const conv = get().conversations.find((c) => c.id === conversationId);
      if (!conv) throw new Error('Conversation not found');
      const tenantId = conv.tenantId;

      const newMessage: Message = {
        id: messageId,
        conversationId,
        senderType,
        senderId,
        senderName,
        content,
        messageType: 'text',
        isRead: senderType === 'user' || senderType === 'system',
        createdAt: now,
      };

      await CRMDatabaseService.insertMessage(newMessage, tenantId, currentUser.role, currentUser);

      const lead = get().leads.find((l) => l.id === conv.leadId);

      if (conv) {
        const updatedConv: Conversation = {
          ...conv,
          lastMessage: content,
          lastMessageAt: now,
          unreadCount: senderType === 'contact' ? conv.unreadCount + 1 : 0,
        };
        await CRMDatabaseService.upsertConversation(updatedConv, updatedConv.tenantId, currentUser.role, currentUser);
      }

      set((state) => {
        const activeMsgs = state.messages[conversationId] || [];
        const updatedConvs = state.conversations.map((c) => {
          if (c.id === conversationId) {
            return {
              ...c,
              lastMessage: content,
              lastMessageAt: now,
              unreadCount: senderType === 'contact' ? c.unreadCount + 1 : 0
            };
          }
          return c;
        });

        return {
          messages: {
            ...state.messages,
            [conversationId]: [...activeMsgs, newMessage]
          },
          conversations: updatedConvs
        };
      });

      if (senderType === 'contact' && lead) {
        const { sentiment, intent } = analyzeMessageSentiment(content);
        const activity: LeadActivity = {
          id: `act-${generateId()}`,
          leadId: lead.id,
          userId: lead.id,
          userName: lead.fullName,
          type: 'message',
          title: `Inbound Message (${sentiment})`,
          description: `Intent: ${intent} — "${content.substring(0, 80)}${content.length > 80 ? '...' : ''}"`,
          createdAt: now,
          tenantId: lead.tenantId,
        };
        await CRMDatabaseService.insertActivity(activity, activity.tenantId, currentUser.role, currentUser);
        return;
      }


    },

    clearUnreadCount: async (conversationId: string) => {
      const conv = get().conversations.find(c => c.id === conversationId);
      if (conv && conv.unreadCount > 0) {
        const updatedConv: Conversation = { ...conv, unreadCount: 0 };
        const currentUser = get().currentUser;
        if (!currentUser) throw new Error('User not authenticated');
        await CRMDatabaseService.upsertConversation(updatedConv, updatedConv.tenantId, currentUser.role, currentUser);
      }
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, unreadCount: 0 } : c
        ),
      }));
    },

    editMessage: async (conversationId: string, messageId: string, newContent: string) => {
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] || []).map((m) =>
            m.id === messageId ? { ...m, content: newContent } : m
          ),
        },
      }));

      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      await supabase.from('messages').update({ content: newContent }).eq('id', messageId);
    },

    deleteMessage: async (conversationId: string, messageId: string) => {
      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] || []).filter((m) => m.id !== messageId),
        },
      }));

      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      await supabase.from('messages').delete().eq('id', messageId);
    },
  };
}
