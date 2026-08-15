'use client';

import React, { useEffect, useState, Suspense, lazy } from 'react';
import { useRouter } from 'next/navigation';
import { Toaster } from 'sonner';
import { useCRMStore } from '@/hooks/use-crm-store';
import { getAuthAdapter } from '@/hooks/store/auth-slice';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { Skeleton } from '@/components/ui/skeleton';
import { TenantProvider } from '@/components/tenant-provider';
import { GlobalCopilot } from '@/components/global-copilot';
import { TrialBanner } from '@/components/trial-banner';
import { PaywallModal } from '@/components/paywall-modal';
import { useMessageRealtime } from '@/hooks/use-message-realtime';
import { motion, AnimatePresence } from 'framer-motion';

// Code-split CRM view components — only loaded when the tab is active
const DashboardView = lazy(() => import('@/components/dashboard-view').then((m) => ({ default: m.DashboardView })));
const InquiriesView = lazy(() => import('@/components/inquiries-view').then((m) => ({ default: m.InquiriesView })));
const PipelineView = lazy(() => import('@/components/pipeline-view').then((m) => ({ default: m.PipelineView })));
const BookingsView = lazy(() => import('@/components/bookings-view').then((m) => ({ default: m.BookingsView })));
const TravelersView = lazy(() => import('@/components/travelers-view').then((m) => ({ default: m.TravelersView })));
const ConversationsView = lazy(() => import('@/components/conversations-view').then((m) => ({ default: m.ConversationsView })));
const CalendarView = lazy(() => import('@/components/calendar-view').then((m) => ({ default: m.CalendarView })));
const TasksView = lazy(() => import('@/components/tasks-view').then((m) => ({ default: m.TasksView })));
const TeamView = lazy(() => import('@/components/team-view').then((m) => ({ default: m.TeamView })));
const AnalyticsView = lazy(() => import('@/components/analytics-view').then((m) => ({ default: m.AnalyticsView })));
const SettingsView = lazy(() => import('@/components/settings-view').then((m) => ({ default: m.SettingsView })));
const PerformanceView = lazy(() => import('@/components/performance-view').then((m) => ({ default: m.PerformanceView })));
const SetterDashboard = lazy(() => import('@/components/setter-dashboard').then((m) => ({ default: m.SetterDashboard })));

function ViewSkeleton() {
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-5 rounded-2xl border border-border/60 bg-card">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-8 w-32 mb-2" />
          </div>
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function RealtimeMessages() {
  useMessageRealtime();
  return null;
}

interface SubscriptionInfo {
  plan: string;
  status: string;
  trialActive: boolean;
  trialDaysLeft: number;
}

interface CrmShellProps {
  initialTab?: string;
  useNewTravelersRead?: boolean;
  useNewInquiriesRead?: boolean;
}

export function CrmShell({ initialTab, useNewTravelersRead, useNewInquiriesRead }: CrmShellProps) {
  const router = useRouter();
  const activeTab = useCRMStore((state) => state.activeTab);
  const setActiveTab = useCRMStore((state) => state.setActiveTab);
  const currentUser = useCRMStore((state) => state.currentUser);
  const sessionLoading = useCRMStore((state) => state.sessionLoading);
  const density = useCRMStore((state) => state.density);
  const setDensity = useCRMStore((state) => state.setDensity);

  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab, setActiveTab]);

  useEffect(() => {
    const saved = localStorage.getItem('crm-density');
    if (saved === 'compact' || saved === 'comfortable') {
      setDensity(saved);
    }
  }, [setDensity]);

  // Safety timeout — if session restoration hangs (e.g. network issue),
  // force sessionLoading to false after 8s so the UI isn't stuck forever.
  useEffect(() => {
    if (!sessionLoading) return;
    const timer = setTimeout(() => {
      if (useCRMStore.getState().sessionLoading) {
        console.warn('[CrmShell] Session restoration timed out — forcing sessionLoading to false');
        useCRMStore.setState({ sessionLoading: false });
      }
    }, 8_000);
    return () => clearTimeout(timer);
  }, [sessionLoading]);

  useEffect(() => {
    // Secondary client defense: if session is resolved and no authenticated user exists, redirect to login
    const hasAuthBridge = !!getAuthAdapter();
    if (!sessionLoading && !currentUser && hasAuthBridge) {
      if (typeof window !== 'undefined') {
        window.location.replace('/login');
      } else {
        router.replace('/login');
      }
    }
  }, [sessionLoading, currentUser, router]);

  // Fetch subscription status — skip entirely for super admins (no billing gates)
  useEffect(() => {
    if (!currentUser || currentUser.role === 'super_admin') return;

    const fetchSubscription = async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const res = await fetch('/api/billing/subscription', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        setSubscription(data);

        // Show paywall if trial expired and not on a paid plan
        if (data.status !== 'active' && !data.trialActive) {
          setShowPaywall(true);
        }
      } catch {
        // Subscription fetch failed — default to free tier behavior
      }
    };

    fetchSubscription();
  }, [currentUser]);

  if (sessionLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background select-none">
        <div className="flex flex-col items-center gap-4">
          <img src="/logo.png" className="h-10 w-auto object-contain animate-pulse" alt="Logo" />
          <div className="flex flex-col items-center gap-1">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="font-mono text-[9px] text-muted-foreground mt-2">Restoring session...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return currentUser?.role === 'specialist' || currentUser?.role === 'setter'
          ? <SetterDashboard />
          : <DashboardView />;
      case 'inquiries':
      case 'leads':
        return <InquiriesView useNewReadOverride={useNewInquiriesRead} />;
      case 'pipeline':
        return <PipelineView />;
      case 'bookings':
        return <BookingsView />;
      case 'travelers':
      case 'clients':
        return <TravelersView useNewReadOverride={useNewTravelersRead} />;
      case 'conversations':
        return <ConversationsView />;
      case 'calendar':
        return <CalendarView />;
      case 'tasks':
        return <TasksView />;
      case 'team':
        return <TeamView />;
      case 'performance':
        return <PerformanceView />;
      case 'analytics':
        return <AnalyticsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <TenantProvider>
      <div data-density={density} className="flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans antialiased">
        <RealtimeMessages />
        <div className="hidden md:contents">
          <Sidebar />
        </div>

        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <Header />

          {/* Trial Banner */}
          {subscription?.trialActive && subscription.trialDaysLeft > 0 && (
            <TrialBanner
              daysLeft={subscription.trialDaysLeft}
              onUpgrade={() => setShowPaywall(true)}
            />
          )}

          <main id="main-content" className="flex-1 overflow-hidden relative bg-background" tabIndex={-1}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full"
              >
                <Suspense fallback={<ViewSkeleton />}>
                  {renderActiveView()}
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
      <GlobalCopilot />
      <Toaster position="bottom-right" richColors closeButton />

      {/* Paywall Modal — never shown to super admins */}
      {currentUser?.role !== 'super_admin' && (
        <PaywallModal isOpen={showPaywall} onClose={() => setShowPaywall(false)} currentPlan={subscription?.plan} />
      )}
    </TenantProvider>
  );
}
