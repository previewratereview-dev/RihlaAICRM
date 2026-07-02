'use client';

import React, { useEffect } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { useNotificationStore } from '@/hooks/use-notification-store';
import { Bell } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function NotificationCenter() {
  const currentUser = useCRMStore((s) => s.currentUser);
  const tasks = useCRMStore((s) => s.tasks);
  const conversations = useCRMStore((s) => s.conversations);
  const setActiveTab = useCRMStore((s) => s.setActiveTab);
  const notifications = useNotificationStore((s) => s.notifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const syncFromCRM = useNotificationStore((s) => s.syncFromCRM);

  useEffect(() => {
    if (currentUser) {
      syncFromCRM(tasks, conversations, currentUser.id);
    }
  }, [tasks, conversations, currentUser, syncFromCRM]);

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-secondary/80">
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          Notifications
          {unread > 0 && (
            <button type="button" onClick={markAllRead} className="text-xs text-primary font-normal">
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">No notifications</div>
        ) : (
          notifications.slice(0, 8).map((n) => (
            <DropdownMenuItem
              key={n.id}
              className={cn('flex flex-col items-start gap-0.5 cursor-pointer', !n.read && 'bg-secondary/50')}
              onClick={() => {
                markRead(n.id);
                if (n.link) setActiveTab(n.link);
              }}
            >
              <span className="font-medium text-sm">{n.title}</span>
              <span className="text-xs text-muted-foreground line-clamp-2">{n.body}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
