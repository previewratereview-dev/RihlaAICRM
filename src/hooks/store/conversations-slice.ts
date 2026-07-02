import type { SetState, GetState } from './types';
import type { Conversation, Message, LeadActivity } from '@/types';
import { CRMDatabaseService } from '@/lib/db-service';
import { generateId } from '@/lib/utils';
import { analyzeMessageSentiment } from '@/lib/ai/sentiment';
import { buildLeadContextBlock } from '@/lib/ai/lead-context';

export function createConversationsSlice(set: SetState, get: GetState) {
  return {
    conversations: [] as Conversation[],
    messages: {} as Record<string, Message[]>,

    sendMessage: async (conversationId: string, content: string, senderType: 'user' | 'contact' | 'system', senderId: string, senderName: string) => {
      const now = new Date().toISOString();
      const messageId = `msg-${generateId()}`;

      const currentUser = get().currentUser;
      if (!currentUser) throw new Error('User not authenticated');

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

      await CRMDatabaseService.insertMessage(newMessage, '', currentUser.role, currentUser);

      const conv = get().conversations.find((c) => c.id === conversationId);
      const lead = conv ? get().leads.find((l) => l.id === conv.leadId) : undefined;

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

      if (senderType === 'user') {
        const conversation = get().conversations.find(c => c.id === conversationId);
        if (!conversation || !lead) return;

        setTimeout(() => {
          set((state) => ({
            typingState: { ...state.typingState, [conversationId]: true }
          }));
        }, 400);

        setTimeout(async () => {
          const recentMsgs = get().messages[conversationId] || [];
          const leadActivities = get().activities[lead.id] || [];
          const leadContext = buildLeadContextBlock(lead, leadActivities, recentMsgs);

          let reply = '';
          try {
            const res = await fetch('/api/ai/lead-action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'contact_reply', leadContext, extra: content }),
            });
            const data = await res.json();
            reply = data.content || '';
          } catch {
            reply = '';
          }

          if (!reply) {
            reply = `Thanks for reaching out! We're reviewing your ${ lead.destination || 'trip' } request and will follow up shortly.`;
          }

          const replyId = `msg-${generateId()}`;
          const replyMsg: Message = {
            id: replyId,
            conversationId,
            senderType: 'contact',
            senderId: lead.id,
            senderName: lead.fullName,
            content: reply,
            messageType: 'text',
            isRead: get().activeTab === 'conversations',
            createdAt: new Date().toISOString()
          };

          await CRMDatabaseService.insertMessage(replyMsg, '', currentUser.role, currentUser);

          const updatedConv: Conversation = {
            ...conversation,
            lastMessage: reply,
            lastMessageAt: replyMsg.createdAt,
            unreadCount: get().activeTab === 'conversations' ? 0 : conversation.unreadCount + 1
          };
          await CRMDatabaseService.upsertConversation(updatedConv, updatedConv.tenantId, currentUser.role, currentUser);

          set((state) => {
            const currentMsgs = state.messages[conversationId] || [];
            const updatedConvs = state.conversations.map((c) => {
              if (c.id === conversationId) {
                return {
                  ...c,
                  lastMessage: reply,
                  lastMessageAt: replyMsg.createdAt,
                  unreadCount: state.activeTab === 'conversations' ? 0 : c.unreadCount + 1
                };
              }
              return c;
            });

            const updatedTyping = { ...state.typingState };
            delete updatedTyping[conversationId];

            return {
              messages: {
                ...state.messages,
                [conversationId]: [...currentMsgs, replyMsg]
              },
              conversations: updatedConvs,
              typingState: updatedTyping
            };
          });

          const { sentiment, intent } = analyzeMessageSentiment(reply);
          const activity: LeadActivity = {
            id: `act-${generateId()}`,
            leadId: lead.id,
            userId: lead.id,
            userName: lead.fullName,
            type: 'message',
            title: `Inbound Message (${sentiment})`,
            description: `AI-simulated reply · Intent: ${intent} — "${reply.substring(0, 60)}..."`,
            createdAt: new Date().toISOString(),
            tenantId: lead.tenantId,
          };
          await CRMDatabaseService.insertActivity(activity, activity.tenantId, currentUser.role, currentUser);

        }, 2000);
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
