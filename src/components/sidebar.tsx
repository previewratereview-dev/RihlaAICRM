'use client';

import React from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { cn, getInitials } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Users2,
  Columns4,
  Building2,
  MessageSquareCode,
  CalendarDays,
  ListTodo,
  Users,
  TrendingUp,
  Settings,
  ChevronLeft,
  ChevronRight,
  Database,
  LogOut,
  Award,
  ScrollText,
  Cpu,
} from 'lucide-react';

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const sidebarItems: SidebarItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'leads', label: 'Travelers & Bookings', icon: Users2 },
  { id: 'pipeline', label: 'Booking Pipeline', icon: Columns4 },
  { id: 'clients', label: 'Past Travelers', icon: Building2 },
  { id: 'conversations', label: 'Conversations', icon: MessageSquareCode },
  { id: 'calendar', label: 'Calendar & Meets', icon: CalendarDays },
  { id: 'tasks', label: 'Tasks & Reminders', icon: ListTodo },
  { id: 'team', label: 'Team Management', icon: Users },
  { id: 'performance', label: 'Team Performance', icon: Award },
  { id: 'analytics', label: 'Reports & Analytics', icon: TrendingUp },
  { id: 'settings', label: 'System Settings', icon: Settings },
];

const superAdminItems: SidebarItem[] = [
  { id: 'sa_dashboard', label: 'Platform Overview', icon: LayoutDashboard },
  { id: 'sa_tenants', label: 'Agency Management', icon: Building2 },
  { id: 'sa_users', label: 'Global Users', icon: Users },
  { id: 'sa_analytics', label: 'Global Analytics', icon: TrendingUp },
  { id: 'sa_ai', label: 'AI Governance', icon: Cpu },
  { id: 'sa_audit', label: 'Audit Log', icon: ScrollText },
  { id: 'sa_settings', label: 'Platform Settings', icon: Settings },
];

export function Sidebar() {
  const activeTab = useCRMStore((state) => state.activeTab);
  const setActiveTab = useCRMStore((state) => state.setActiveTab);
  const sidebarExpanded = useCRMStore((state) => state.sidebarExpanded);
  const toggleSidebar = useCRMStore((state) => state.toggleSidebar);
  const conversations = useCRMStore((state) => state.conversations);
  const tasks = useCRMStore((state) => state.tasks);
  const currentUser = useCRMStore((state) => state.currentUser);
  const logout = useCRMStore((state) => state.logout);
  const dbMode = useCRMStore((state) => state.dbMode);
  const tenantFeatures = useCRMStore((state) => state.tenantFeatures);
  const tenantBranding = useCRMStore((state) => state.tenantBranding);

  const totalUnreadMessages = conversations.reduce((acc, c) => acc + c.unreadCount, 0);
  const pendingTasksCount = tasks.filter((t) => t.status === 'pending').length;

  const featureTabMap: Record<string, 'pipeline' | 'chatbot' | 'analytics'> = {
    pipeline: 'pipeline',
    conversations: 'chatbot',
    analytics: 'analytics',
    performance: 'analytics',
  };

  const filteredSidebarItems = currentUser?.role === 'super_admin' 
    ? superAdminItems 
    : sidebarItems.filter(item => {
        if (currentUser?.role === 'specialist' || currentUser?.role === 'setter') {
          return ['dashboard', 'leads', 'conversations', 'calendar', 'tasks'].includes(item.id);
        }
        const flag = featureTabMap[item.id];
        if (flag && tenantFeatures[flag] === false) return false;
        return true;
      });

  const getRoleLabel = (role: string) => {
    if (role === 'super_admin') return 'Super Admin';
    if (role === 'admin') return 'Admin';
    if (role === 'manager') return 'Manager';
    if (role === 'consultant') return 'Consultant';
    if (role === 'specialist') return 'Travel Specialist';
    if (role === 'member') return 'Team Member';
    return 'User';
  };

  return (
    <motion.aside
      animate={{ width: sidebarExpanded ? 260 : 76 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "relative flex flex-col h-screen shrink-0 bg-gradient-to-b from-sidebar to-sidebar/95 border-r border-sidebar-border/60",
        "z-20 select-none backdrop-blur-sm"
      )}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border/50">
        <div className="flex items-center gap-3 overflow-hidden">
          <img
            src="/logo.png"
            className="h-7 w-auto object-contain invert shrink-0 select-none"
            alt="WanderBot AI Logo"
          />
          {sidebarExpanded && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col select-none"
            >
              <span className="font-heading font-bold text-sidebar-foreground tracking-tight leading-none text-sm">{tenantBranding.agencyName}</span>
              <span className="text-[8px] text-muted-foreground font-mono mt-0.5 tracking-wider uppercase">Travel CRM</span>
            </motion.div>
          )}
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 space-y-1.5 px-3 py-4 overflow-y-auto scrollbar-thin" aria-label="Main navigation">
        {filteredSidebarItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          let badgeCount = 0;
          if (item.id === 'conversations') badgeCount = totalUnreadMessages;
          if (item.id === 'tasks') badgeCount = pendingTasksCount;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group relative cursor-pointer",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon className={cn(
                  "h-4 w-4 shrink-0 transition-all duration-200",
                  isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
                )} />
                {sidebarExpanded && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="truncate text-left"
                  >
                    {item.label}
                  </motion.span>
                )}
              </div>

              {/* Notification Badges */}
              {badgeCount > 0 && (
                <div className={cn(
                  "flex items-center justify-center text-[9px] font-bold rounded-full font-mono",
                  isActive
                    ? "bg-primary-foreground text-primary shrink-0 px-1.5 py-0.5 min-w-[18px] h-4 shadow-sm"
                    : "bg-primary/20 text-primary shrink-0 px-1.5 py-0.5 min-w-[18px] h-4",
                  !sidebarExpanded && "absolute top-1 right-1 border-2 border-sidebar"
                )}>
                  {badgeCount}
                </div>
              )}

              {/* Active Tab Indicator */}
              {isActive && (
                <motion.div
                  layoutId="activeGlowBar"
                  className="absolute left-0 w-[3px] h-[60%] bg-primary-foreground rounded-r-md top-[20%] shadow-lg"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Database Connection Status Indicator */}
      <div className="px-3 py-2.5 border-t border-sidebar-border/50 bg-sidebar-accent/30">
        <div className={cn(
          "flex items-center gap-2.5 p-2.5 rounded-xl bg-background/50 border border-sidebar-border/50 shadow-sm",
          !sidebarExpanded && "justify-center"
        )}>
          <Database className={cn("h-4 w-4 shrink-0", dbMode === 'supabase' ? 'text-emerald-600' : 'text-muted-foreground')} />
          {sidebarExpanded && (
            <div className="flex flex-col min-w-0 font-mono text-[9px] leading-tight">
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">Database</span>
              <span className={cn("mt-0.5 font-bold", dbMode === 'supabase' ? 'text-emerald-600' : 'text-muted-foreground')}>
                {dbMode === 'supabase' ? 'Supabase Online' : 'Local Sandbox'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Authenticated User Info Footer */}
      {currentUser && (
        <div className="p-3 border-t border-sidebar-border/50 bg-sidebar-accent/30">
          <div className={cn(
            "flex items-center justify-between p-2 rounded-xl",
            !sidebarExpanded && "justify-center"
          )}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-white font-bold font-mono text-xs select-none shadow-md">
                {getInitials(currentUser.fullName)}
              </div>
              {sidebarExpanded && (
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-bold text-sidebar-foreground leading-tight truncate">{currentUser.fullName}</span>
                  <span className="text-[9px] text-muted-foreground font-mono mt-0.5 truncate uppercase">
                    {getRoleLabel(currentUser.role)}
                  </span>
                </div>
              )}
            </div>

            {sidebarExpanded && (
              <button
                onClick={() => logout()}
                className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                aria-label="Sign Out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Toggle Expand Button */}
      <button
        onClick={toggleSidebar}
        aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        className={cn(
          "absolute -right-3 top-20 flex h-7 w-7 items-center justify-center rounded-full border-2 border-sidebar bg-background text-muted-foreground hover:text-foreground hover:scale-110 transition-all cursor-pointer z-30 shadow-lg"
        )}
      >
        {sidebarExpanded ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
    </motion.aside>
  );
}