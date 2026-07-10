'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
  agencyName: 'Rihla',
  primaryColor: '#FF6B35',
  features: {},
});

export function useTenantContext() {
  return useContext(TenantCtx);
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const accentColor = useCRMStore((s) => s.settings.accentColor);
  const tenantPrimaryColor = useCRMStore((s) => s.tenantBranding.primaryColor);

  const [fetched, setFetched] = useState<TenantContextValue>({
    loading: true,
    tenantId: null,
    agencyName: 'Rihla',
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
        const agencyName = branding.agencyName || 'Rihla';
        const primaryColor = branding.primaryColor || '#FF6B35';

        useCRMStore.setState({
          tenantBranding: { agencyName, primaryColor, logoUrl: branding.logoUrl },
          tenantFeatures: features,
        });

        setFetched({
          loading: false,
          tenantId: data.tenantId,
          agencyName,
          primaryColor,
          features,
        });
      })
      .catch(() => {
        if (!cancelled) setFetched((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryColor = tenantPrimaryColor || accentColor || '#FF6B35';

  useEffect(() => {
    document.documentElement.style.setProperty('--primary', primaryColor);
  }, [primaryColor]);

  const value = useMemo<TenantContextValue>(
    () => ({ ...fetched, primaryColor }),
    [fetched, primaryColor],
  );

  return <TenantCtx.Provider value={value}>{children}</TenantCtx.Provider>;
}
