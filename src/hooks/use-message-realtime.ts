'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useCRMStore } from '@/hooks/use-crm-store';
import type { Message } from '@/types';

export function useMessageRealtime() {
  const syncData = useCRMStore((s) => s.syncData);
  const currentUser = useCRMStore((s) => s.currentUser);
  const dbMode = useCRMStore((s) => s.dbMode);

  useEffect(() => {
    if (!currentUser || dbMode !== 'supabase' || !supabase) return;

    const channel = supabase
      .channel('crm-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const msg: Message = {
            id: String(row.id),
            conversationId: String(row.conversation_id),
            senderType: row.sender_type as Message['senderType'],
            senderId: String(row.sender_id || ''),
            senderName: String(row.sender_name || ''),
            content: String(row.content),
            messageType: (row.message_type as Message['messageType']) || 'text',
            isRead: Boolean(row.is_read),
            createdAt: String(row.created_at),
          };

          useCRMStore.setState((state) => {
            const existing = state.messages[msg.conversationId] || [];
            if (existing.some((m) => m.id === msg.id)) return state;
            return {
              messages: {
                ...state.messages,
                [msg.conversationId]: [...existing, msg],
              },
            };
          });
        }
      )
      .subscribe();

    return () => {
      if (supabase) supabase.removeChannel(channel);
    };
  }, [currentUser, dbMode, syncData]);
}
