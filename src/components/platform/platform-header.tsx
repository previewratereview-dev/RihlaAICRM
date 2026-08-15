'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getInitials, cn } from '@/lib/utils';
import {
  Shield,
  Settings,
  LogOut,
  SlidersHorizontal,
  ChevronRight,
  Sun,
  Moon,
  Layout,
} from 'lucide-react';

const routeTitleMap: Record<string, string> = {
  '/app/platform': 'Platform Overview',
  '/app/platform/dashboard': 'Platform Overview',
  '/app/platform/agencies': 'Agency Management',
  '/app/platform/users': 'Global Users',
  '/app/platform/analytics': 'Global Analytics',
  '/app/platform/ai': 'AI Governance',
  '/app/platform/audit': 'Platform Audit Log',
  '/app/platform/settings': 'Platform Settings',
};

export function PlatformHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const currentUser = useCRMStore((state) => state.currentUser);
  const logout = useCRMStore((state) => state.logout);
  const density = useCRMStore((state) => state.density);
  const setDensity = useCRMStore((state) => state.setDensity);

  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('theme');
    return saved === 'dark' || (!saved && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);
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

  const pageTitle = routeTitleMap[pathname] || 'Platform Admin';

  return (
    <header className="sticky top-0 z-10 flex h-16 w-full items-center justify-between border-b border-border/60 bg-background/80 px-6 backdrop-blur-md transition-all">
      {/* Left: Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm">
        <div className="flex items-center gap-1.5 font-semibold text-primary">
          <Shield className="h-4 w-4" />
          <span>Platform</span>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="font-semibold text-foreground">{pageTitle}</span>
      </div>

      {/* Right: Controls & User Profile */}
      <div className="flex items-center gap-3">
        {/* Layout Density Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors cursor-pointer outline-none"
            aria-label="Density selector"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 font-mono text-xs">
            <DropdownMenuLabel className="font-sans text-xs">Layout Density</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setDensity('compact')}
              className={cn('cursor-pointer text-xs', density === 'compact' && 'font-bold text-primary')}
            >
              <Layout className="mr-2 h-3.5 w-3.5" />
              <span>Compact</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDensity('comfortable')}
              className={cn('cursor-pointer text-xs', density === 'comfortable' && 'font-bold text-primary')}
            >
              <Layout className="mr-2 h-3.5 w-3.5" />
              <span>Comfortable</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Theme Toggle */}
        <button
          onClick={toggleDarkMode}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors cursor-pointer"
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* User Profile Menu */}
        {currentUser && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-2.5 rounded-full p-1 hover:bg-secondary/60 transition-colors focus:outline-none cursor-pointer border-none bg-transparent"
              aria-label="User menu"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-white font-bold font-mono text-xs shadow-sm">
                {getInitials(currentUser.fullName)}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-semibold leading-none">{currentUser.fullName}</p>
                  <p className="text-xs text-muted-foreground leading-none">{currentUser.email}</p>
                  <div className="pt-1">
                    <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold font-mono uppercase text-primary">
                      <Shield className="h-2.5 w-2.5" />
                      Super Admin
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => router.push('/app/platform/settings')}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Settings className="h-4 w-4" />
                <span>Platform Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => logout()}
                className="flex items-center gap-2 text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
