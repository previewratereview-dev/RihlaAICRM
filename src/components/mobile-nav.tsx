'use client';

import React from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu, LogOut } from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import {
  LayoutDashboard,
  Users2,
  Columns4,
  Building2,
  MessageSquareCode,
  CalendarDays,
  ListTodo,
  Users,
  Award,
  TrendingUp,
  Settings,
} from 'lucide-react';

const allItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'leads', label: 'Leads', icon: Users2 },
  { id: 'pipeline', label: 'Pipeline', icon: Columns4 },
  { id: 'clients', label: 'Past Travelers', icon: Building2 },
  { id: 'conversations', label: 'Messages', icon: MessageSquareCode },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'performance', label: 'Performance', icon: Award },
  { id: 'analytics', label: 'Analytics', icon: TrendingUp },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const specialistItems = ['dashboard', 'leads', 'conversations', 'calendar', 'tasks'];

export function MobileNav() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const activeTab = useCRMStore((s) => s.activeTab);
  const setActiveTab = useCRMStore((s) => s.setActiveTab);
  const currentUser = useCRMStore((s) => s.currentUser);
  const logout = useCRMStore((s) => s.logout);
  const conversations = useCRMStore((s) => s.conversations);
  const tasks = useCRMStore((s) => s.tasks);
  const [open, setOpen] = React.useState(false);

  if (!isMobile) return null;

  const totalUnreadMessages = conversations.reduce((acc, c) => acc + c.unreadCount, 0);
  const pendingTasksCount = tasks.filter((t) => t.status === 'pending').length;

  const items = allItems.filter((item) => {
    if (currentUser?.role === 'specialist' || currentUser?.role === 'setter') {
      return specialistItems.includes(item.id);
    }
    return true;
  });

  const getRoleLabel = (role: string) => {
    if (role === 'super_admin') return 'Super Admin';
    if (role === 'admin') return 'Admin';
    if (role === 'manager') return 'Manager';
    if (role === 'consultant') return 'Consultant';
    if (role === 'specialist') return 'Travel Specialist';
    return 'Team Member';
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-lg hover:bg-secondary"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <nav className="flex flex-col gap-1 p-4 pt-8">
          {items.map((item) => {
            const Icon = item.icon;
            const badgeCount =
              item.id === 'conversations' ? totalUnreadMessages :
              item.id === 'tasks' ? pendingTasksCount : 0;

            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors',
                  activeTab === item.id
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'text-muted-foreground hover:bg-secondary'
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-4 w-4" />
                  {item.label}
                </div>
                {badgeCount > 0 && (
                  <span className="flex items-center justify-center text-[9px] font-bold rounded-full bg-primary/20 text-primary px-1.5 py-0.5 min-w-[18px] h-4 font-mono">
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {currentUser && (
          <div className="border-t border-border p-4 mt-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-white font-bold font-mono text-xs select-none shadow-md">
                  {getInitials(currentUser.fullName)}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-bold text-foreground leading-tight truncate">{currentUser.fullName}</span>
                  <span className="text-[9px] text-muted-foreground font-mono mt-0.5 truncate uppercase">
                    {getRoleLabel(currentUser.role)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => { logout(); setOpen(false); }}
                className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                aria-label="Sign Out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
