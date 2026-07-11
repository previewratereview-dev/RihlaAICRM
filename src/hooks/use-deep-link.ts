'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';

const TAB_ROUTES: Record<string, string> = {
  dashboard: '/app',
  leads: '/app/leads',
  pipeline: '/app/pipeline',
  clients: '/app/clients',
  conversations: '/app/conversations',
  calendar: '/app/calendar',
  tasks: '/app/tasks',
  team: '/app/team',
  performance: '/app/performance',
  analytics: '/app/analytics',
  settings: '/app/settings',
};

export function useDeepLinkTab(initialTab?: string) {
  const setActiveTab = useCRMStore((s) => s.setActiveTab);
  const activeTab = useCRMStore((s) => s.activeTab);
  const router = useRouter();

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, setActiveTab]);

  const navigateToTab = (tab: string) => {
    setActiveTab(tab);
    const path = TAB_ROUTES[tab] || '/app';
    if (window.location.pathname !== path) {
      router.push(path);
    }
  };

  return { activeTab, navigateToTab, tabRoutes: TAB_ROUTES };
}
