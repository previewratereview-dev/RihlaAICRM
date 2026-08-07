'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings as SettingsIcon,
  User,
  Bell,
  Palette,
  Database,
  Key,
  Users as UsersIcon,
  Cpu,
  ScrollText,
  CreditCard,
  MessageSquareText
} from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { can } from '@/lib/permissions';
import { AdminUserManagement } from '@/components/admin-user-management';
import { AISpendDashboard } from '@/components/ai-spend-dashboard';
import { FaqAdminPanel } from '@/components/faq-admin-panel';

import { AgencySettings } from './settings/agency-settings';
import { ProfileSettings } from './settings/profile-settings';
import { NotificationsSettings } from './settings/notifications-settings';
import { AISettings } from './settings/ai-settings';
import { IntegrationsSettings } from './settings/integrations-settings';
import { BillingSettings } from './settings/billing-settings';

type SettingsTab = 'agency' | 'profile' | 'notifications' | 'billing' | 'ai' | 'integrations' | 'users' | 'audit' | 'ai_usage' | 'faq';

export function SettingsView() {
  const currentUser = useCRMStore((s) => s.currentUser);
  const auditLogs = useCRMStore((s) => s.auditLogs);
  const [tab, setTab] = useState<SettingsTab>('agency');

  const role = currentUser?.role ?? 'viewer';

  const tabs: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }>; permission?: Parameters<typeof can>[1]; description: string }[] = [
    { id: 'agency', label: 'General', icon: Palette, description: 'Brand and general settings' },
    { id: 'profile', label: 'Profile', icon: User, description: 'Personal account details' },
    { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Alerts and AI escalations' },
    { id: 'ai', label: 'AI', icon: Cpu, permission: 'settings:ai:write', description: 'System prompts and BYOK' },
    { id: 'billing', label: 'Billing', icon: CreditCard, description: 'Subscription and plans' },
    { id: 'faq', label: 'FAQ', icon: MessageSquareText, permission: 'settings:ai:write', description: 'Train the support AI' },
    { id: 'ai_usage', label: 'Usage', icon: Database, permission: 'settings:ai:write', description: 'Tokens and spend tracking' },
    { id: 'integrations', label: 'Integrations', icon: Key, permission: 'settings:integrations:write', description: 'Twilio, Meta, Resend' },
    { id: 'users', label: 'Team', icon: UsersIcon, permission: 'settings:users:write', description: 'Manage workspace members' },
  ];

  const visibleTabs = tabs.filter((t) => !t.permission || can(role, t.permission));

  return (
    <div className="h-full w-full overflow-hidden bg-[#FDFDFD] dark:bg-background flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 bg-card/50 backdrop-blur-md px-8 py-6 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-foreground tracking-tight font-heading flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 shadow-inner">
                <SettingsIcon className="h-6 w-6 text-primary" />
              </div>
              Settings
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              Manage your agency profile, billing, integrations, and AI configurations all in one place.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Horizontal Tabs Area */}
        <div className="shrink-0 border-b border-border/40 bg-card/30">
          <div className="max-w-6xl mx-auto px-8 flex items-center gap-6 overflow-x-auto scrollbar-hide">
            {visibleTabs.map((t) => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative flex items-center gap-2 py-4 transition-all duration-200 cursor-pointer shrink-0 border-b-2 font-medium text-sm ${
                    isActive 
                      ? 'border-primary text-primary' 
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-8 relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 15, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -15, filter: 'blur(4px)' }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="max-w-3xl mx-auto pb-20"
            >
              {tab === 'agency' && <AgencySettings />}
              {tab === 'profile' && <ProfileSettings />}
              {tab === 'notifications' && <NotificationsSettings />}
              {tab === 'ai' && can(role, 'settings:ai:write') && <AISettings />}
              {tab === 'integrations' && can(role, 'settings:integrations:write') && <IntegrationsSettings />}
              {tab === 'billing' && <BillingSettings />}
              
              {tab === 'faq' && can(role, 'settings:ai:write') && <FaqAdminPanel />}
              {tab === 'ai_usage' && can(role, 'settings:ai:write') && <AISpendDashboard />}
              {tab === 'users' && can(role, 'settings:users:write') && <AdminUserManagement />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );


}
