'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCRMStore } from '@/hooks/use-crm-store';
import { useAuth } from '@/hooks/use-auth';

/**
 * RealtimeBridge listens to Supabase Postgres changes for the active tenant's leads
 * and triggers a store sync so the UI updates instantly without requiring a refresh.
 * Mount this component once at the app root.
 */
export function RealtimeBridge() {
  const { user } = useAuth();
  
  useEffect(() => {
    if (!user || !user.tenantId || user.tenantId === 'global') return;
    
    const supabase = createClient();
    
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leads',
          filter: `tenant_id=eq.${user.tenantId}`
        },
        (payload) => {
          console.log('[Realtime] Leads changed:', payload);
          // Sync data directly from the server when a lead changes
          useCRMStore.getState().syncData();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Subscribed to leads changes for tenant:', user.tenantId);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return null;
}
