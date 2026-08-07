import React, { useEffect, useState } from 'react';
import { CreditCard, Crown, CheckCircle2, Clock, AlertTriangle, CalendarDays } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { SettingItem } from './setting-item';

import { SettingsGroup } from './settings-group';
import { SettingsRow } from './settings-row';

interface SubscriptionData {
  plan: string;
  status: string;
  trialActive: boolean;
  trialDaysLeft: number;
  trialEnd?: string;
  currentPeriodEnd?: string;
}

export function BillingSettings() {
  const currentUser = useCRMStore((s) => s.currentUser);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
  const [subLoading, setSubLoading] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    const fetchSub = async () => {
      setSubLoading(true);
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch('/api/billing/subscription', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setSubscriptionData(data);
        }
      } catch {
        // Silently fail
      } finally {
        setSubLoading(false);
      }
    };
    fetchSub();
  }, [currentUser]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <SettingsGroup title="Subscription" description="Manage your current plan and billing cycle.">
        {subLoading ? (
          <div className="space-y-4 animate-pulse p-6">
            <div className="h-6 bg-muted/60 rounded w-1/3"></div>
            <div className="h-6 bg-muted/60 rounded w-1/4"></div>
            <div className="h-6 bg-muted/60 rounded w-1/3"></div>
          </div>
        ) : subscriptionData ? (
          <>
            <SettingsRow 
              label="Current Plan" 
              description="Your active subscription tier."
              action={
                <button 
                  onClick={() => alert('Stripe Portal Integration coming soon.')}
                  className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
                >
                  Manage Plan
                </button>
              }
            >
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-500" />
                <span className="font-semibold text-foreground uppercase tracking-wider">{subscriptionData.plan}</span>
              </div>
            </SettingsRow>
            
            <SettingsRow 
              label="Subscription Status" 
              description="The current standing of your billing."
            >
              <div className="flex items-center gap-2">
                {subscriptionData.status === 'active' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : subscriptionData.status === 'trialing' ? (
                  <Clock className="h-4 w-4 text-amber-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                )}
                <span className="font-semibold text-foreground uppercase tracking-wider">{subscriptionData.status}</span>
              </div>
            </SettingsRow>

            {subscriptionData.currentPeriodEnd && (
              <SettingsRow 
                label="Renewal Date" 
                description="When your next billing cycle starts."
              >
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-foreground">{new Date(subscriptionData.currentPeriodEnd).toLocaleDateString()}</span>
                </div>
              </SettingsRow>
            )}
          </>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Unable to load subscription info.
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}
