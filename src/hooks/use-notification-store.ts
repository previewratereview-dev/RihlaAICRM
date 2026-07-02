import { create } from 'zustand';
import type { Task, Conversation } from '@/types';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: 'task' | 'message' | 'info';
  link?: string;
  read: boolean;
  createdAt: string;
}

interface NotificationStore {
  notifications: AppNotification[];
  markRead: (id: string) => void;
  markAllRead: () => void;
  syncFromCRM: (tasks: Task[], conversations: Conversation[], userId: string) => void;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],

  markRead: (id) => {
    set({
      notifications: get().notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    });
  },

  markAllRead: () => {
    set({
      notifications: get().notifications.map((n) => ({ ...n, read: true })),
    });
  },

  syncFromCRM: (tasks, conversations, userId) => {
    const now = new Date().toISOString();
    const generated: AppNotification[] = [];

    tasks
      .filter((t) => t.status === 'pending' && t.assignedTo === userId)
      .slice(0, 5)
      .forEach((t) => {
        generated.push({
          id: `task-${t.id}`,
          title: 'Pending task',
          body: t.title,
          type: 'task',
          link: 'tasks',
          read: false,
          createdAt: t.createdAt || now,
        });
      });

    conversations
      .filter((c) => c.unreadCount > 0)
      .slice(0, 5)
      .forEach((c) => {
        generated.push({
          id: `conv-${c.id}`,
          title: `Unread from ${c.leadName}`,
          body: c.lastMessage || 'New message',
          type: 'message',
          link: 'conversations',
          read: false,
          createdAt: c.lastMessageAt || now,
        });
      });

    const existing = get().notifications;
    const merged = [...generated];
    existing.forEach((e) => {
      if (!merged.find((m) => m.id === e.id)) merged.push(e);
    });

    set({ notifications: merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20) });
  },
}));
