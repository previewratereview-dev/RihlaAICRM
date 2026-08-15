'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { PlatformSidebar } from '@/components/platform/platform-sidebar';
import { PlatformHeader } from '@/components/platform/platform-header';
import { Toaster } from 'sonner';

interface PlatformShellProps {
  children: React.ReactNode;
}

export function PlatformShell({ children }: PlatformShellProps) {
  const router = useRouter();
  const currentUser = useCRMStore((state) => state.currentUser);
  const sessionLoading = useCRMStore((state) => state.sessionLoading);
  const dataLoading = useCRMStore((state) => state.dataLoading);
  const tenantsWithStats = useCRMStore((state) => state.tenantsWithStats);
  const syncData = useCRMStore((state) => state.syncData);

  // Client-side fail-closed defense: non-super_admin users are redirected away
  useEffect(() => {
    if (!sessionLoading && currentUser && currentUser.role !== 'super_admin') {
      router.push('/app/dashboard');
    }
  }, [currentUser, sessionLoading, router]);

  // Scoped Platform Data Hydration: hydrates platform dataset on initial direct load
  useEffect(() => {
    if (currentUser?.role === 'super_admin' && tenantsWithStats.length === 0 && !dataLoading) {
      syncData();
    }
  }, [currentUser, tenantsWithStats.length, dataLoading, syncData]);

  if (sessionLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
            Initializing Platform...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Platform Sidebar */}
      <PlatformSidebar />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <PlatformHeader />
        <main className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>

      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
