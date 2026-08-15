'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { cn, getInitials } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Building2,
  Users,
  TrendingUp,
  Cpu,
  ScrollText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Database,
  LogOut,
  Shield,
} from 'lucide-react';

interface PlatformNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const platformNavItems: PlatformNavItem[] = [
  { href: '/app/platform/dashboard', label: 'Platform Overview', icon: LayoutDashboard },
  { href: '/app/platform/agencies', label: 'Agency Management', icon: Building2 },
  { href: '/app/platform/users', label: 'Global Users', icon: Users },
  { href: '/app/platform/analytics', label: 'Global Analytics', icon: TrendingUp },
  { href: '/app/platform/ai', label: 'AI Governance', icon: Cpu },
  { href: '/app/platform/audit', label: 'Audit Log', icon: ScrollText },
  { href: '/app/platform/settings', label: 'Platform Settings', icon: Settings },
];

export function PlatformSidebar() {
  const pathname = usePathname();
  const sidebarExpanded = useCRMStore((state) => state.sidebarExpanded);
  const toggleSidebar = useCRMStore((state) => state.toggleSidebar);
  const currentUser = useCRMStore((state) => state.currentUser);
  const logout = useCRMStore((state) => state.logout);
  const dbMode = useCRMStore((state) => state.dbMode);

  return (
    <motion.aside
      animate={{ width: sidebarExpanded ? 260 : 76 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative flex flex-col h-screen shrink-0 bg-sidebar border-r border-sidebar-border/60',
        'z-20 select-none'
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
              <span className="font-heading font-bold text-sidebar-foreground tracking-tight leading-none text-sm">
                Rihla Platform
              </span>
              <span className="text-[8px] text-primary font-mono mt-0.5 tracking-wider uppercase font-semibold flex items-center gap-1">
                <Shield className="h-2.5 w-2.5" />
                Super Admin
              </span>
            </motion.div>
          )}
        </div>
      </div>

      {/* Navigation Items — Native Next.js Links */}
      <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto scrollbar-thin" aria-label="Platform navigation">
        <div className="space-y-1">
          {platformNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== '/app/platform/dashboard' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all duration-200 group relative',
                  isActive
                    ? 'bg-sidebar-accent text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0 transition-all duration-200',
                      isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                    )}
                  />
                  {sidebarExpanded && (
                    <span className="truncate text-left">{item.label}</span>
                  )}
                </div>

                {/* Subtle Active Indicator */}
                {isActive && (
                  <motion.div
                    layoutId="activePlatformSidebarIndicator"
                    className="absolute left-0 w-[3px] h-[60%] bg-primary rounded-r-md top-[20%]"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Database Connection Status Indicator */}
      <div className="px-3 py-2.5 border-t border-sidebar-border/50 bg-sidebar-accent/30">
        <div
          className={cn(
            'flex items-center gap-2.5 p-2.5 rounded-xl bg-background/50 border border-sidebar-border/50 shadow-sm',
            !sidebarExpanded && 'justify-center'
          )}
        >
          <Database
            className={cn(
              'h-4 w-4 shrink-0',
              dbMode === 'supabase' ? 'text-emerald-600' : 'text-muted-foreground'
            )}
          />
          {sidebarExpanded && (
            <div className="flex flex-col min-w-0 font-mono text-[9px] leading-tight">
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">
                Database
              </span>
              <span
                className={cn(
                  'mt-0.5 font-bold',
                  dbMode === 'supabase' ? 'text-emerald-600' : 'text-muted-foreground'
                )}
              >
                {dbMode === 'supabase' ? 'Supabase Online' : 'Local Sandbox'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Authenticated Super Admin Info Footer */}
      {currentUser && (
        <div className="p-3 border-t border-sidebar-border/50 bg-sidebar-accent/30">
          <div
            className={cn(
              'flex items-center justify-between p-2 rounded-xl',
              !sidebarExpanded && 'justify-center'
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-white font-bold font-mono text-xs select-none shadow-md">
                {getInitials(currentUser.fullName)}
              </div>
              {sidebarExpanded && (
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-bold text-sidebar-foreground leading-tight truncate">
                    {currentUser.fullName}
                  </span>
                  <span className="text-[9px] text-primary font-mono mt-0.5 truncate uppercase font-semibold">
                    Super Admin
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
          'absolute -right-3 top-20 flex h-7 w-7 items-center justify-center rounded-full border-2 border-sidebar bg-background text-muted-foreground hover:text-foreground hover:scale-110 transition-all cursor-pointer z-30 shadow-lg'
        )}
      >
        {sidebarExpanded ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
    </motion.aside>
  );
}
