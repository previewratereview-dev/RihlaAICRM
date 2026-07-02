'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';

const TAB_ROUTES: Record<string, string> = {
  dashboard: '/',
  leads: '/leads',
  pipeline: '/pipeline',
  clients: '/clients',
  conversations: '/conversations',
  calendar: '/calendar',
  tasks: '/tasks',
  team: '/team',
  performance: '/performance',
  analytics: '/analytics',
  settings: '/settings',
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
    const path = TAB_ROUTES[tab] || '/';
    if (window.location.pathname !== path) {
      router.push(path);
    }
  };

  return { activeTab, navigateToTab, tabRoutes: TAB_ROUTES };
}
