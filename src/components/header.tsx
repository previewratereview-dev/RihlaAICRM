'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { getInitials, cn } from '@/lib/utils';
import { GlobalSearch } from '@/components/global-search';
import { MobileNav } from '@/components/mobile-nav';
import { NotificationCenter } from '@/components/notification-center';
import { calculateCRMMetrics } from '@/lib/metrics';
import { 
  Sparkles, 
  Cpu, 
  LogOut, 
  User as UserIcon, 
  Settings as SettingsIcon,
  Sun,
  Moon,
  Layout,
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
  const density = useCRMStore((state) => state.density);
  const setDensity = useCRMStore((state) => state.setDensity);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  const crmMetrics = useMemo(() => calculateCRMMetrics(leads), [leads]);

  if (!currentUser) return null;

  const getPageTitle = (tab: string) => {
    switch (tab) {
      case 'dashboard':
        return currentUser.role === 'specialist' ? 'Travel Specialist Overview' : 'Agency Dashboard';
      case 'leads':
      case 'inquiries':
        return 'Inquiries';
      case 'pipeline':
        return 'Booking Pipeline';
      case 'clients':
      case 'travelers':
        return 'Travelers';
      case 'bookings':
        return 'Bookings Workspace';
      case 'conversations':
        return 'AI Messaging Hub';
      case 'calendar':
        return 'Calendar & Meetings';
      case 'tasks':
        return 'Tasks & Reminders';
      case 'team':
        return 'Team Directory';
      case 'performance':
        return 'Team Performance';
      case 'analytics':
        return 'Performance Reports';
      case 'settings':
        return 'Settings';
      default:
        return 'Rihla Travel CRM';
    }
  };

  return (
    <header className="relative flex h-[14.4rem] md:h-[3.6rem] items-center justify-between px-6 lg:px-8 border-b border-border/40 bg-background/80 backdrop-blur-xl z-10 shrink-0 select-none shadow-sm">
      {/* Left: Mobile Nav & Breadcrumbs */}
      <div className="flex items-center gap-4">
        <MobileNav />
        <div className="hidden md:flex items-center text-sm">
          <span className="text-muted-foreground font-medium">CRM</span>
          <span className="mx-2 text-muted-foreground/50">/</span>
          <h1 className="font-semibold text-foreground tracking-tight font-heading">
            {getPageTitle(activeTab)}
          </h1>
        </div>
        {/* Mobile Page Title */}
        <h1 className="md:hidden text-base font-bold text-foreground tracking-tight font-heading">
          {getPageTitle(activeTab)}
        </h1>
      </div>

      {/* Center: Search */}
      <div className="flex-1 flex justify-center max-w-md mx-4">
        <GlobalSearch />
      </div>

      {/* Right: Statuses, Actions, User */}
      <div className="flex items-center gap-4 text-sm">
        {/* AI Status */}
        <div className="hidden lg:flex items-center gap-2 pr-4 border-r border-border text-muted-foreground text-xs">
          <Cpu className="h-4 w-4" />
          <span className="font-medium">AI Online</span>
          <Sparkles className="h-3.5 w-3.5 text-emerald-500 fill-emerald-500" />
        </div>

        {/* Active Inquiries Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-secondary/30 hover:bg-secondary/60 transition-colors cursor-pointer outline-none">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-soft" />
            <span className="text-[11px] font-mono font-medium text-foreground">
              {crmMetrics.openInquiries} Open Inquiries
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 bg-popover/90 backdrop-blur-xl border border-border text-foreground shadow-lg rounded-xl">
            <DropdownMenuLabel className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">Quick Actions</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border/60" />
            <DropdownMenuItem className="cursor-pointer text-sm" onClick={() => setActiveTab('inquiries')}>
              Recent Inquiries
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer text-sm" onClick={() => setActiveTab('inquiries')}>
              Assign to me
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer text-sm" onClick={() => setActiveTab('conversations')}>
              Reply to latest
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <NotificationCenter />

        {/* Dark Mode Toggle */}
        <button
          onClick={toggleDarkMode}
          className="p-1.5 rounded-lg hover:bg-secondary/80 text-muted-foreground transition-colors cursor-pointer"
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* User Profile Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 p-1 rounded-full hover:bg-secondary/80 transition-all cursor-pointer group border-none bg-transparent outline-none ml-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted border border-border/50 text-foreground text-xs font-bold font-mono shadow-sm">
              {getInitials(currentUser.fullName)}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-popover/90 backdrop-blur-xl border border-border text-foreground shadow-lg rounded-xl mt-1">
            <DropdownMenuLabel className="font-semibold text-foreground text-sm flex flex-col">
              <span>{currentUser.fullName}</span>
              <span className="text-[10px] text-muted-foreground font-mono mt-0.5 capitalize font-normal">
                {currentUser.role}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border/60" />
            {currentUser.role !== 'specialist' && (
              <>
                <DropdownMenuItem 
                  onClick={() => setActiveTab('settings')}
                  className="hover:bg-secondary/80 hover:text-foreground cursor-pointer text-sm focus:bg-secondary/80 rounded-lg"
                >
                  <UserIcon className="mr-2 h-4 w-4" />
                  <span>Profile Settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setActiveTab('settings')}
                  className="hover:bg-secondary/80 hover:text-foreground cursor-pointer text-sm focus:bg-secondary/80 rounded-lg"
                >
                  <SettingsIcon className="mr-2 h-4 w-4" />
                  <span>CRM Integrations</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/60" />
              </>
            )}
            <DropdownMenuItem 
              onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
              className="hover:bg-secondary/80 hover:text-foreground cursor-pointer text-sm focus:bg-secondary/80 rounded-lg flex items-center justify-between"
            >
              <div className="flex items-center">
                <Layout className="mr-2 h-4 w-4" />
                <span>Compact Layout</span>
              </div>
              <div className={cn("w-7 h-4 rounded-full border border-border/50 relative transition-colors", density === 'compact' ? "bg-primary" : "bg-muted")}>
                <div className={cn("absolute top-[1px] h-3 w-3 rounded-full bg-background transition-transform", density === 'compact' ? "translate-x-[13px]" : "translate-x-[1px]")} />
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border/60" />
            <DropdownMenuItem 
              onClick={() => logout()}
              className="hover:bg-red-500/10 hover:text-red-600 focus:bg-red-500/10 focus:text-red-600 cursor-pointer text-sm rounded-lg"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sign Out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
