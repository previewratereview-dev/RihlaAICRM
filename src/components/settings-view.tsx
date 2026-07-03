'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Settings as SettingsIcon,
  User,
  Bell,
  Shield,
  Palette,
  Database,
  Key,
  Users as UsersIcon,
  Cpu,
  ScrollText,
  Save,
  CreditCard,
  CheckCircle2,
  Clock,
  Crown,
  AlertTriangle,
} from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { can } from '@/lib/permissions';
import { AdminUserManagement } from '@/components/admin-user-management';
import { AISpendDashboard } from '@/components/ai-spend-dashboard';

import { FaqAdminPanel } from '@/components/faq-admin-panel';
import { WorkflowRulesPanel } from '@/components/workflow-rules-panel';
import {
  MessageSquareText,
} from 'lucide-react';

type SettingsTab = 'profile' | 'agency' | 'notifications' | 'billing' | 'ai' | 'integrations' | 'users' | 'audit' | 'ai_usage' | 'faq';

interface SubscriptionData {
  plan: string;
  status: string;
  trialActive: boolean;
  trialDaysLeft: number;
  trialEnd?: string;
  currentPeriodEnd?: string;
}

export function SettingsView() {
  const currentUser = useCRMStore((s) => s.currentUser);
  const settings = useCRMStore((s) => s.settings);
  const updateSettings = useCRMStore((s) => s.updateSettings);
  const auditLogs = useCRMStore((s) => s.auditLogs);
  const updatePassword = useCRMStore((s) => s.updatePassword);

  const [tab, setTab] = useState<SettingsTab>('agency');
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const isDirty = JSON.stringify(form) !== JSON.stringify(settings);
  const initialFormRef = useRef(settings);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Keep form in sync with external settings changes without using setState in an effect
  const settingsKey = JSON.stringify(settings);
  const [lastSyncedKey, setLastSyncedKey] = useState(settingsKey);
  if (settingsKey !== lastSyncedKey) {
    setLastSyncedKey(settingsKey);
    setForm(settings);
  }

  const role = currentUser?.role ?? 'viewer';

  // Fetch subscription data for the billing tab
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
        // Silently fail — billing info is non-critical
      } finally {
        setSubLoading(false);
      }
    };
    fetchSub();
  }, [currentUser]);

  const tabs: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }>; permission?: Parameters<typeof can>[1] }[] = [
    { id: 'agency', label: 'Agency', icon: Palette },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'ai', label: 'AI Config', icon: Cpu, permission: 'settings:ai:write' },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'faq', label: 'FAQ Chatbot', icon: MessageSquareText, permission: 'settings:ai:write' },
    { id: 'ai_usage', label: 'AI Usage', icon: Database, permission: 'settings:ai:write' },
    { id: 'integrations', label: 'Integrations', icon: Key, permission: 'settings:integrations:write' },
    { id: 'users', label: 'Users', icon: UsersIcon, permission: 'settings:users:write' },
    { id: 'audit', label: 'Audit Log', icon: ScrollText, permission: 'settings:audit:read' },
  ];

  const visibleTabs = tabs.filter((t) => !t.permission || can(role, t.permission));

  const handleSaveAgency = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateSettings(form);
      initialFormRef.current = form;
      toast.success('Settings saved successfully.');
    } catch {
      toast.error('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!currentUser || newPassword.length < 6) {
      setMessage('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await updatePassword(currentUser.id, newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Password updated.');
    } catch {
      setMessage('Password update failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight font-heading flex items-center gap-2">
            <SettingsIcon className="h-6 w-6 text-primary" />
            System Settings
          </h2>
          <p className="text-sm text-muted-foreground font-medium mt-1">Configure your workspace and integrations.</p>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-border/60 pb-4" role="tablist" aria-label="Settings sections">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                  tab === t.id
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'bg-card/80 border border-border/60 text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {message && (
          <div className="p-3 rounded-xl bg-primary/10 text-primary text-sm border border-primary/20">{message}</div>
        )}

        {tab === 'agency' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 max-w-xl">
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Agency Name</label>
              <input
                value={form.agencyName}
                onChange={(e) => setForm({ ...form, agencyName: e.target.value })}
                className="mt-1 w-full h-10 rounded-xl border border-input px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Logo Text</label>
              <input
                value={form.logoText}
                onChange={(e) => setForm({ ...form, logoText: e.target.value })}
                className="mt-1 w-full h-10 rounded-xl border border-input px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Accent Color</label>
              <input
                type="color"
                value={form.accentColor.startsWith('#') ? form.accentColor : '#FF6B35'}
                onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                className="mt-1 h-10 w-full rounded-xl border border-input"
              />
            </div>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Daily Target Score</label>
              <input
                type="number"
                value={form.dailyTargetScore}
                onChange={(e) => setForm({ ...form, dailyTargetScore: Number(e.target.value) })}
                className="mt-1 w-full h-10 rounded-xl border border-input px-3 text-sm"
              />
            </div>
            <button
              onClick={handleSaveAgency}
              disabled={saving}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
            >
              <Save className="h-4 w-4" />
              Save Agency Settings
            </button>
          </motion.div>
        )}

        {tab === 'profile' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 max-w-xl">
            <div className="p-5 rounded-2xl bg-card/80 border border-border/60">
              <p className="text-sm font-semibold">{currentUser?.fullName}</p>
              <p className="text-xs text-muted-foreground mt-1">{currentUser?.email}</p>
              <p className="text-xs text-muted-foreground capitalize mt-0.5">Role: {currentUser?.role}</p>
            </div>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 w-full h-10 rounded-xl border border-input px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full h-10 rounded-xl border border-input px-3 text-sm"
              />
            </div>
            <button
              onClick={handlePasswordChange}
              disabled={saving}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
            >
              <Shield className="h-4 w-4" />
              Update Password
            </button>
          </motion.div>
        )}

        {tab === 'notifications' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 max-w-xl">
            {[
              { key: 'emailAutomation' as const, label: 'Email automation' },
              { key: 'whatsappAutomation' as const, label: 'WhatsApp automation' },
              { key: 'smsAutomation' as const, label: 'SMS automation' },
            ].map((item) => (
              <label key={item.key} className="flex items-center justify-between p-4 rounded-xl bg-card/80 border border-border/60 cursor-pointer">
                <span className="text-sm font-medium">{item.label}</span>
                <input
                  type="checkbox"
                  checked={form[item.key]}
                  onChange={(e) => setForm({ ...form, [item.key]: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            ))}
            <button onClick={handleSaveAgency} disabled={saving} className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
              Save Notifications
            </button>
          </motion.div>
        )}

        {tab === 'ai' && can(role, 'settings:ai:write') && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 max-w-2xl">
            <div className="p-4 rounded-xl bg-muted/30 border border-border/40 space-y-3">
              <p className="text-sm font-semibold">Provider Setup</p>
              <p className="text-xs text-muted-foreground">
                Works with any OpenAI-compatible API: OpenAI, Groq, OpenRouter, Gemini, Ollama, LM Studio, vLLM, Together AI, Fireworks, Deepseek, and more.
              </p>
            </div>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Base URL</label>
              <input
                value={form.aiBaseUrl || ''}
                onChange={(e) => setForm({ ...form, aiBaseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className="mt-1 w-full h-10 rounded-xl border border-input px-3 text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Examples: https://api.openai.com/v1 · https://api.groq.com/openai/v1 · http://localhost:11434/v1
              </p>
            </div>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">API Key</label>
              <input
                type="password"
                value={form.aiApiKey || ''}
                onChange={(e) => setForm({ ...form, aiApiKey: e.target.value })}
                placeholder="sk-..."
                className="mt-1 w-full h-10 rounded-xl border border-input px-3 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Model Name</label>
              <input
                value={form.aiModel || ''}
                onChange={(e) => setForm({ ...form, aiModel: e.target.value })}
                placeholder="gpt-4o-mini"
                className="mt-1 w-full h-10 rounded-xl border border-input px-3 text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Any model name your provider supports (e.g. gpt-4o, llama-3.1-70b, claude-3-5-sonnet, gemini-1.5-flash)
              </p>
            </div>
            <label className="flex items-center gap-3 p-3 rounded-xl border border-border/60 cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.aiUseAnthropicFormat}
                onChange={(e) => setForm({ ...form, aiUseAnthropicFormat: e.target.checked })}
                className="accent-primary"
              />
              <div>
                <p className="text-sm font-medium">Use Anthropic API format</p>
                <p className="text-[10px] text-muted-foreground">Only enable if using Anthropic's native API (not needed for OpenAI-compatible endpoints)</p>
              </div>
            </label>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">System Prompt</label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                rows={6}
                className="mt-1 w-full rounded-xl border border-input p-3 text-sm resize-none"
              />
            </div>
            <button onClick={handleSaveAgency} disabled={saving} className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
              Save AI Config
            </button>
          </motion.div>
        )}

        {tab === 'integrations' && can(role, 'settings:integrations:write') && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 max-w-xl">
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Make.com Webhook URL</label>
              <input
                value={form.makeWebhookUrl}
                onChange={(e) => setForm({ ...form, makeWebhookUrl: e.target.value })}
                className="mt-1 w-full h-10 rounded-xl border border-input px-3 text-sm font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Stripe, Resend, and Twilio keys are configured via environment variables. See .env.local.example for setup.
            </p>
            <WorkflowRulesPanel />
            <button onClick={handleSaveAgency} disabled={saving} className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
              Save Integrations
            </button>
          </motion.div>
        )}

        {tab === 'users' && can(role, 'settings:users:write') && <AdminUserManagement />}

        {tab === 'audit' && can(role, 'settings:audit:read') && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-card/80 border border-border/60 overflow-hidden">
            <div className="p-3 border-b border-border/40 flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="Search audit logs..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="flex-1 min-w-[200px] h-9 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                aria-label="Search audit logs"
              />
              <input
                type="date"
                value={auditDateFrom}
                onChange={(e) => setAuditDateFrom(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                aria-label="Filter from date"
              />
              <input
                type="date"
                value={auditDateTo}
                onChange={(e) => setAuditDateTo(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                aria-label="Filter to date"
              />
              <button
                onClick={() => {
                  const filtered = auditLogs.filter((log) => {
                    if (!auditSearch.trim()) return true;
                    const q = auditSearch.toLowerCase();
                    const matchSearch = log.action.toLowerCase().includes(q) || log.details.toLowerCase().includes(q) || log.userName.toLowerCase().includes(q);
                    if (!matchSearch) return false;
                    if (auditDateFrom && new Date(log.createdAt) < new Date(auditDateFrom)) return false;
                    if (auditDateTo && new Date(log.createdAt) > new Date(auditDateTo + 'T23:59:59')) return false;
                    return true;
                  });
                  const headers = ['Timestamp', 'Action', 'User', 'Role', 'Details'];
                  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
                  const rows = filtered.map((l) => [
                    escape(new Date(l.createdAt).toISOString()),
                    escape(l.action),
                    escape(l.userName),
                    escape(l.userRole),
                    escape(l.details),
                  ].join(','));
                  const csv = [headers.join(','), ...rows].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `audit_log_export_${new Date().toISOString().split('T')[0]}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }}
                className="h-9 px-3 rounded-lg border border-border/60 bg-card text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors cursor-pointer"
                aria-label="Export audit log as CSV"
              >
                Export CSV
              </button>
            </div>
            <div className="divide-y divide-border/40 max-h-[500px] overflow-y-auto">
              {auditLogs.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No audit events recorded yet.</p>
              ) : (
                auditLogs
                  .filter((log) => {
                    if (auditSearch.trim()) {
                      const q = auditSearch.toLowerCase();
                      if (!(log.action.toLowerCase().includes(q) || log.details.toLowerCase().includes(q) || log.userName.toLowerCase().includes(q))) return false;
                    }
                    if (auditDateFrom && new Date(log.createdAt) < new Date(auditDateFrom)) return false;
                    if (auditDateTo && new Date(log.createdAt) > new Date(auditDateTo + 'T23:59:59')) return false;
                    return true;
                  })
                  .map((log) => (
                    <div key={log.id} className="p-4 flex justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold">{log.action.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{log.details}</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">
                          {log.userName} · {log.userRole}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </motion.div>
        )}

        {tab === 'ai_usage' && can(role, 'settings:ai:write') && <AISpendDashboard />}

        {tab === 'billing' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 max-w-2xl">
            <div className="rounded-2xl bg-card/80 border border-border/60 overflow-hidden">
              <div className="px-6 py-5 border-b border-border/40">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Crown className="h-5 w-5 text-primary" />
                  Subscription Plan
                </h3>
                <p className="text-sm text-muted-foreground mt-1">Manage your subscription and billing details.</p>
              </div>

              {subLoading ? (
                <div className="p-6 space-y-3">
                  <div className="h-5 w-32 rounded-lg bg-muted animate-pulse" />
                  <div className="h-4 w-48 rounded-lg bg-muted animate-pulse" />
                  <div className="h-4 w-40 rounded-lg bg-muted animate-pulse" />
                </div>
              ) : subscriptionData ? (
                <div className="p-6 space-y-5">
                  {/* Plan badge */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono uppercase text-muted-foreground">Current Plan</span>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                      subscriptionData.plan === 'premium'
                        ? 'bg-amber-500/15 text-amber-600 border border-amber-500/30'
                        : subscriptionData.plan === 'pro'
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'bg-muted text-muted-foreground border border-border'
                    }`}>
                      <Crown className="h-3 w-3" />
                      {subscriptionData.plan}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono uppercase text-muted-foreground">Status</span>
                    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                      subscriptionData.status === 'active'
                        ? 'text-emerald-600'
                        : subscriptionData.status === 'trialing'
                        ? 'text-blue-600'
                        : 'text-red-500'
                    }`}>
                      {subscriptionData.status === 'active' ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : subscriptionData.status === 'trialing' ? (
                        <Clock className="h-4 w-4" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                      {subscriptionData.status === 'active'
                        ? 'Active'
                        : subscriptionData.status === 'trialing'
                        ? 'Trial'
                        : subscriptionData.status.charAt(0).toUpperCase() + subscriptionData.status.slice(1)}
                    </span>
                  </div>

                  {/* Trial info */}
                  {subscriptionData.trialActive && subscriptionData.trialDaysLeft > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono uppercase text-muted-foreground">Trial Days Left</span>
                      <span className="text-sm font-semibold text-blue-600">
                        {subscriptionData.trialDaysLeft} day{subscriptionData.trialDaysLeft !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}

                  {/* Period end */}
                  {subscriptionData.currentPeriodEnd && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono uppercase text-muted-foreground">
                        {subscriptionData.status === 'trialing' ? 'Trial Ends' : 'Renews On'}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {new Date(subscriptionData.currentPeriodEnd).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6">
                  <p className="text-sm text-muted-foreground">Unable to load subscription information.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {tab === 'faq' && can(role, 'settings:ai:write') && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <FaqAdminPanel />
          </motion.div>
        )}
      </div>
    </div>
  );
}
