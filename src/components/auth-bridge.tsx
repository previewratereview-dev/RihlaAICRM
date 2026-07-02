'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useCRMStore } from '@/hooks/use-crm-store';

/**
 * AuthBridge wires the useAuth React hook into the Zustand store so that
 * store actions (login, logout, restoreSession) can delegate to the hook.
 * Render this component once at the app root.
 */
export function AuthBridge() {
  const auth = useAuth();
  const setAuthAdapter = useCRMStore((s) => s.setAuthAdapter);

  // Sync auth state to store whenever auth changes (user, loading)
  useEffect(() => {
    setAuthAdapter(auth);

    // Fallback: if auth is somehow stuck loading forever (e.g. network hang),
    // force it to resolve after 4 seconds so the UI isn't blocked globally.
    let timer: NodeJS.Timeout;
    if (auth.loading) {
      timer = setTimeout(() => {
        if (useCRMStore.getState().sessionLoading) {
          console.warn('[AuthBridge] Auth restoration timed out. Forcing unlock.');
          useCRMStore.setState({ sessionLoading: false });
        }
      }, 4000);
    }
    
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [auth, setAuthAdapter]);

  return null;
}
