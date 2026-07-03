'use client';

import React, { useEffect, useState } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { getInitials } from '@/lib/utils';
import { GlobalSearch } from '@/components/global-search';
import { MobileNav } from '@/components/mobile-nav';
import { NotificationCenter } from '@/components/notification-center';
import { 
  Sparkles, 
  Cpu, 
  Globe, 
  LogOut, 
  User as UserIcon, 
  Settings as SettingsIcon,
  Eye,
  X,
  Sun,
  Moon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Header() {
  const activeTab = useCRMStore((state) => state.activeTab);
  const setActiveTab = useCRMStore((state) => state.setActiveTab);
  const leads = useCRMStore((state) => state.leads);
  const currentUser = useCRMStore((state) => state.currentUser);
  const logout = useCRMStore((state) => state.logout);
  const impersonateTenantId = useCRMStore((state) => state.impersonateTenantId);
  const impersonateTenantName = useCRMStore((state) => state.impersonateTenantName);
  const impersonationRemainingMs = useCRMStore((state) => state.impersonationRemainingMs);
  const setImpersonateTenant = useCRMStore((state) => state.setImpersonateTenant);

  const [time, setTime] = useState('');
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('theme');
    return saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  useEffect(() => {
    const updateTime = () => {
      const date = new Date();
      setTime(
        date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      );
    };
    updateTime();
    // Update every 30 seconds to reduce re-renders (minutes rarely need sub-second precision)
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!currentUser) return null;

  const getPageTitle = (tab: string) => {
    switch (tab) {
      case 'dashboard':
        return currentUser.role === 'specialist' ? 'Travel Specialist Overview' : 'Agency Dashboard';
      case 'leads':
        return 'Travelers & Bookings';
      case 'pipeline':
        return 'Booking Pipeline';
      case 'clients':
        return 'Past Travelers';
      case 'conversations':
        return 'AI Messaging Hub';
      case 'calendar':
        return 'Calendar & Meetings';
      case 'tasks':
        return 'Tasks & Reminders';
      case 'team':
        return 'Team Directory';
      case 'analytics':
        return 'Performance Reports';
      case 'settings':
        return 'System & Agent Settings';
      case 'sa_dashboard':
        return 'Platform Command Center';
      case 'sa_tenants':
        return 'Agency Management';
      case 'sa_users':
        return 'Global User Directory';
      case 'sa_analytics':
        return 'Global Analytics';
      case 'sa_ai':
        return 'AI Governance';
      case 'sa_audit':
        return 'Platform Audit Log';
      case 'sa_settings':
        return 'Platform Settings';
      default:
        return currentUser.role === 'super_admin' ? 'Platform Admin' : 'WanderBot AI Travel CRM';
    }
  };

  const activeLeadsCount = leads.filter(l => l.status !== 'booking_confirmed' && l.status !== 'booking_lost').length;

  return (
    <>
      {impersonateTenantId && (
        <div className="flex items-center justify-between px-6 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100 text-sm shrink-0">
          <span className="flex items-center gap-2 font-medium">
            <Eye className="h-4 w-4" />
            Viewing as tenant: <strong>{impersonateTenantName || impersonateTenantId}</strong>
            {impersonationRemainingMs !== null && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-200/50 dark:bg-amber-800/50 text-[10px] font-mono font-bold">
                {Math.floor(impersonationRemainingMs / 60000)}:{String(Math.floor((impersonationRemainingMs % 60000) / 1000)).padStart(2, '0')}
              </span>
            )}
          </span>
          <button
            onClick={() => setImpersonateTenant(null)}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg border border-amber-300 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900 text-xs font-semibold"
          >
            <X className="h-3.5 w-3.5" /> Exit impersonation
          </button>
        </div>
      )}
    <header className="relative flex h-16 items-center justify-between px-6 lg:px-8 border-b border-border/40 bg-background/80 backdrop-blur-xl z-10 shrink-0 select-none shadow-sm">
      {/* Page Title & Status */}
      <div className="flex items-center gap-4">
        <MobileNav />
        <h1 className="text-base font-bold text-foreground tracking-tight font-heading">
          {getPageTitle(activeTab)}
        </h1>
        <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 animate-fade-in">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse-soft" />
          <span className="text-[10px] font-mono text-primary font-semibold">
            {activeLeadsCount} {currentUser.role === 'specialist' ? 'Active Bookings' : 'Active Inquiries'}
          </span>
        </div>
      </div>

      {/* Center Command Shortcut */}
      <GlobalSearch />

      {/* Right Side: Statuses, Time, Actions */}
      <div className="flex items-center gap-5 text-sm">
        {/* Clock */}
        <div className="hidden sm:flex items-center gap-2 text-muted-foreground font-mono text-xs border-r border-border pr-5">
          <Globe className="h-3.5 w-3.5" />
          <span className="font-medium">EST: {time || '17:48:30'}</span>
        </div>

        {/* AI Agents Sync Status */}
        <div className="hidden md:flex items-center gap-2 pr-5 text-muted-foreground text-xs border-r border-border">
          <Cpu className="h-3.5 w-3.5" />
          <span className="font-medium">AI Engine:</span>
          <span className="text-primary font-bold flex items-center gap-1.5">
            Syncing 
            <Sparkles className="h-3.5 w-3.5 text-primary fill-primary animate-pulse" />
          </span>
        </div>

        <NotificationCenter />

        {/* Dark Mode Toggle */}
        <button
          onClick={toggleDarkMode}
          className="p-2 rounded-lg hover:bg-secondary/80 transition-colors cursor-pointer"
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
        </button>

        {/* User Profile Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-3 p-1.5 pr-3 rounded-full hover:bg-secondary/80 transition-all cursor-pointer group border-none bg-transparent outline-none">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-white text-xs font-bold font-mono shadow-md">
              {getInitials(currentUser.fullName)}
            </div>
            <div className="hidden sm:flex flex-col items-start">
              <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
                {currentUser.fullName}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono mt-0.5 capitalize leading-tight">
                {currentUser.role}
              </span>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-popover/90 backdrop-blur-xl border border-border text-foreground shadow-lg rounded-xl">
            <DropdownMenuLabel className="font-semibold text-foreground text-sm">My Account</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border/60" />
            {currentUser.role !== 'specialist' && (
              <>
                <DropdownMenuItem 
                  onClick={() => setActiveTab('settings')}
                  className="hover:bg-secondary/80 hover:text-primary cursor-pointer text-sm focus:bg-secondary/80 focus:text-primary rounded-lg"
                >
                  <UserIcon className="mr-2 h-4 w-4" />
                  <span>Profile Settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setActiveTab('settings')}
                  className="hover:bg-secondary/80 hover:text-primary cursor-pointer text-sm focus:bg-secondary/80 focus:text-primary rounded-lg"
                >
                  <SettingsIcon className="mr-2 h-4 w-4" />
                  <span>CRM Integrations</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/60" />
              </>
            )}
            <DropdownMenuItem 
              onClick={() => logout()}
              className="hover:bg-red-50 hover:text-red-600 cursor-pointer text-sm focus:bg-red-50 focus:text-red-600 rounded-lg"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sign Out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    </>
  );
}
