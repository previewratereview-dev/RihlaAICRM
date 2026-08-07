'use client';

import React from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { cn, getInitials } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
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
  ChevronDown,
} from 'lucide-react';

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  section?: 'Sales' | 'Operations' | 'Communication' | 'Administration' | 'Platform';
}

const sidebarItems: SidebarItem[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'inquiries', label: 'Inquiries', icon: Users2, section: 'Sales' },
  { id: 'pipeline', label: 'Booking Pipeline', icon: Columns4, section: 'Sales' },
  { id: 'bookings', label: 'Bookings', icon: Building2, section: 'Sales' },
  { id: 'travelers', label: 'Travelers', icon: Users, section: 'Sales' },
  { id: 'conversations', label: 'Conversations', icon: MessageSquareCode, section: 'Communication' },
  { id: 'calendar', label: 'Calendar & Meets', icon: CalendarDays, section: 'Operations' },
  { id: 'tasks', label: 'Tasks & Reminders', icon: ListTodo, section: 'Operations' },
  { id: 'performance', label: 'Team Performance', icon: Award, section: 'Administration' },
  { id: 'analytics', label: 'Reports & Analytics', icon: TrendingUp, section: 'Administration' },
  { id: 'settings', label: 'System Settings', icon: Settings, section: 'Administration' },
];

const superAdminItems: SidebarItem[] = [
  { id: 'sa_dashboard', label: 'Platform Overview', icon: LayoutDashboard },
  { id: 'sa_tenants', label: 'Agency Management', icon: Building2, section: 'Platform' },
  { id: 'sa_users', label: 'Global Users', icon: Users, section: 'Platform' },
  { id: 'sa_analytics', label: 'Global Analytics', icon: TrendingUp, section: 'Platform' },
  { id: 'sa_ai', label: 'AI Governance', icon: Cpu, section: 'Platform' },
  { id: 'sa_audit', label: 'Audit Log', icon: ScrollText, section: 'Platform' },
  { id: 'sa_settings', label: 'Platform Settings', icon: Settings, section: 'Platform' },
];

export function Sidebar() {
  const router = useRouter();
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

  const [collapsedSections, setCollapsedSections] = React.useState<Record<string, boolean>>({});

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

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
        const role = currentUser?.role;

        // Viewer: read-only, only dashboard + leads + analytics
        if (role === 'viewer') {
          return ['dashboard', 'leads', 'analytics'].includes(item.id);
        }

        // Specialist / setter: operational tabs only
        if (role === 'specialist' || role === 'setter') {
          return ['dashboard', 'leads', 'conversations', 'calendar', 'tasks'].includes(item.id);
        }

        // Consultant: same as specialist but with analytics
        if (role === 'consultant') {
          return ['dashboard', 'leads', 'conversations', 'calendar', 'tasks', 'analytics'].includes(item.id);
        }

        // Manager / Admin: full access but gated by feature flags
        const flag = featureTabMap[item.id];
        if (flag && tenantFeatures[flag] === false) return false;
        return true;
      });

  // Group items by section
  const itemsBySection = filteredSidebarItems.reduce((acc, item) => {
    const section = item.section || 'default';
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {} as Record<string, SidebarItem[]>);

  const getRoleLabel = (role: string) => {
    if (role === 'super_admin') return 'Super Admin';
    if (role === 'admin') return 'Admin';
    if (role === 'manager') return 'Manager';
    if (role === 'consultant') return 'Consultant';
    if (role === 'specialist') return 'Travel Specialist';
    if (role === 'member') return 'Team Member';
    if (role === 'viewer') return 'Viewer';
    return 'User';
  };

  const renderSidebarItem = (item: SidebarItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;

    let badgeCount = 0;
    if (item.id === 'conversations') badgeCount = totalUnreadMessages;
    if (item.id === 'tasks') badgeCount = pendingTasksCount;

    return (
      <button
        key={item.id}
        onClick={() => {
          setActiveTab(item.id);
          router.push(`/app/${item.id}`);
        }}
        aria-label={item.label}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all duration-200 group relative cursor-pointer",
          isActive
            ? "bg-sidebar-accent text-foreground font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon className={cn(
            "h-4 w-4 shrink-0 transition-all duration-200",
            isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
          )} />
          {sidebarExpanded && (
            <span className="truncate text-left">
              {item.label}
            </span>
          )}
        </div>

        {/* Notification Badges */}
        {badgeCount > 0 && (
          <div className={cn(
            "flex items-center justify-center text-[10px] font-bold rounded-full font-mono",
            isActive
              ? "bg-primary text-primary-foreground shrink-0 px-1.5 py-0.5 min-w-[18px] h-4 shadow-sm"
              : "bg-primary/20 text-primary shrink-0 px-1.5 py-0.5 min-w-[18px] h-4",
            !sidebarExpanded && "absolute top-1 right-1 border border-sidebar"
          )}>
            {badgeCount}
          </div>
        )}

        {/* Subtle Active Indicator instead of full pill */}
        {isActive && (
          <motion.div
            layoutId="activeSidebarIndicator"
            className="absolute left-0 w-[3px] h-[60%] bg-primary rounded-r-md top-[20%]"
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          />
        )}
      </button>
    );
  };

  return (
    <motion.aside
      animate={{ width: sidebarExpanded ? 260 : 76 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "relative flex flex-col h-screen shrink-0 bg-sidebar border-r border-sidebar-border/60",
        "z-20 select-none"
      )}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border/50">
        <div className="flex items-center gap-3 overflow-hidden">
          <img
            src="/logo.png"
            className="h-7 w-auto object-contain invert shrink-0 select-none"
            alt="Rihla Logo"
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
      <nav className="flex-1 space-y-4 px-3 py-4 overflow-y-auto scrollbar-thin" aria-label="Main navigation">
        {/* Default / Unsectioned Items */}
        {itemsBySection['default'] && (
          <div className="space-y-1">
            {itemsBySection['default'].map(renderSidebarItem)}
          </div>
        )}

        {/* Render Grouped Sections */}
        {Object.entries(itemsBySection).map(([section, items]) => {
          if (section === 'default') return null;
          const isCollapsed = collapsedSections[section];
          return (
            <div key={section} className="flex flex-col gap-1">
              {sidebarExpanded && (
                <button 
                  onClick={() => toggleSection(section)}
                  className="flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors group cursor-pointer"
                >
                  <span>{section}</span>
                  <ChevronDown className={cn("h-3 w-3 transition-transform", isCollapsed && "-rotate-90")} />
                </button>
              )}
              {(!isCollapsed || !sidebarExpanded) && (
                <div className="space-y-1">
                  {items.map(renderSidebarItem)}
                </div>
              )}
            </div>
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