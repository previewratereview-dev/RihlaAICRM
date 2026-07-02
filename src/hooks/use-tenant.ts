'use client';

import { useEffect, useState } from 'react';
import { defaultTenantSettings, type TenantSettings } from '@/lib/tenant/config';

type UseTenantResult = {
  tenantId: string | null;
  branding: TenantSettings['branding'];
  features: TenantSettings['features'];
  integrations: TenantSettings['integrations'];
  ai: TenantSettings['ai'];
  loading: boolean;
};

export function useTenant(): UseTenantResult {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [settings, setSettings] = useState<TenantSettings>(defaultTenantSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/tenant/branding');
        const data = await res.json();
        if (cancelled) return;
        setTenantId(data.tenantId ?? null);
        setSettings({
          ...defaultTenantSettings,
          ...(data.settings ?? {}),
        });
      } catch {
        if (!cancelled) {
          setSettings(defaultTenantSettings);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    tenantId,
    branding: settings.branding,
    features: settings.features,
    integrations: settings.integrations,
    ai: settings.ai,
    loading,
  };
}