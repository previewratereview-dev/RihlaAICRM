'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import type { TenantFeatures } from '@/lib/tenant/config';

type TenantContextValue = {
  loading: boolean;
  tenantId: string | null;
  agencyName: string;
  primaryColor: string;
  features: TenantFeatures;
};

const TenantCtx = createContext<TenantContextValue>({
  loading: true,
  tenantId: null,
  agencyName: 'WanderBot AI',
  primaryColor: '#FF6B35',
  features: {},
});

export function useTenantContext() {
  return useContext(TenantCtx);
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TenantContextValue>({
    loading: true,
    tenantId: null,
    agencyName: 'WanderBot AI',
    primaryColor: '#FF6B35',
    features: {},
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tenant/branding')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const branding = data.branding || {};
        const features = data.settings?.features || {};
        const agencyName = branding.agencyName || 'WanderBot AI';
        const primaryColor = branding.primaryColor || '#FF6B35';

        document.documentElement.style.setProperty('--primary', primaryColor);
        useCRMStore.setState({
          tenantBranding: { agencyName, primaryColor, logoUrl: branding.logoUrl },
          tenantFeatures: features,
        });

        setState({
          loading: false,
          tenantId: data.tenantId,
          agencyName,
          primaryColor,
          features,
        });
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <TenantCtx.Provider value={state}>{children}</TenantCtx.Provider>;
}
