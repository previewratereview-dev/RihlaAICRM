'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { CRMDatabaseService } from '@/lib/db-service';
import { motion } from 'framer-motion';
import {
  Building2,
  Users,
  TrendingUp,
  Cpu,
  MessageSquare,
  AlertTriangle,
  Plus,
  ArrowRight,
  Activity,
} from 'lucide-react';

export function SuperAdminDashboardView() {
  const router = useRouter();
  const tenantsWithStats = useCRMStore((s) => s.tenantsWithStats);
  const auditLogs = useCRMStore((s) => s.auditLogs);
  const syncData = useCRMStore((s) => s.syncData);

  const [stats, setStats] = useState({
    totalTenants: 0,
    activeTenants: 0,
    suspendedTenants: 0,
    totalLeads: 0,
    totalUsers: 0,
    totalAiSpend: 0,
    totalConversations: 0,
    aiCallsThisMonth: 0,
  });

  useEffect(() => {
    CRMDatabaseService.getGlobalAnalytics().then((data) => setStats(data));
  }, [tenantsWithStats]);

  const suspended = tenantsWithStats.filter((t) => t.status === 'suspended');
  const topSpenders = [...tenantsWithStats].sort((a, b) => b.stats.aiSpend - a.stats.aiSpend).slice(0, 5);

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold font-heading">Platform Command Center</h1>
            <p className="text-sm text-muted-foreground mt-1">Real-time overview of all agencies on the platform.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => syncData()}
              className="h-10 px-4 rounded-xl border border-border/60 text-sm font-medium hover:bg-secondary/50 cursor-pointer"
            >
              Refresh
            </button>
            <button
              onClick={() => router.push('/app/platform/agencies')}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              New Agency
            </button>
          </div>
        </div>

        {suspended.length > 0 && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              <strong>{suspended.length}</strong> agenc{suspended.length === 1 ? 'y is' : 'ies are'} currently suspended.
            </p>
            <Link
              href="/app/platform/agencies"
              className="ml-auto text-sm font-semibold text-amber-700 dark:text-amber-400 hover:underline"
            >
              Review
            </Link>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Agencies', value: stats.totalTenants, sub: `${stats.activeTenants} active`, icon: Building2 },
            { label: 'Platform Users', value: stats.totalUsers, sub: 'across all tenants', icon: Users },
            { label: 'Total Leads', value: stats.totalLeads, sub: `${stats.totalConversations} conversations`, icon: TrendingUp },
            { label: 'AI Spend', value: `$${stats.totalAiSpend.toFixed(2)}`, sub: `${stats.aiCallsThisMonth} calls this month`, icon: Cpu },
          ].map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="p-5 rounded-2xl bg-card/80 border border-border/60 shadow-sm"
            >
              <stat.icon className="h-5 w-5 text-primary mb-3" />
              <h3 className="text-2xl font-bold">{stat.value}</h3>
              <p className="text-sm font-medium text-foreground mt-1">{stat.label}</p>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{stat.sub}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Top AI Spenders</h3>
              <Link href="/app/platform/ai" className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {topSpenders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No AI usage recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {topSpenders.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30">
                    <div>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.stats.leadCount} leads · {t.stats.userCount} users</p>
                    </div>
                    <span className="text-sm font-mono font-bold text-primary">${t.stats.aiSpend.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Recent Platform Activity
              </h3>
              <Link href="/app/platform/audit" className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline">
                Full log <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {auditLogs.slice(0, 8).map((log) => (
                <div key={log.id} className="p-3 rounded-xl border border-border/40 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold capitalize">{log.action.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                      {new Date(log.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.details}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{log.userName} · {log.tenantId || 'platform'}</p>
                </div>
              ))}
              {auditLogs.length === 0 && (
                <p className="text-sm text-muted-foreground">No activity logged yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: '/app/platform/agencies', label: 'Manage Agencies', icon: Building2 },
            { href: '/app/platform/users', label: 'All Users', icon: Users },
            { href: '/app/platform/analytics', label: 'Analytics', icon: TrendingUp },
            { href: '/app/platform/ai', label: 'AI Governance', icon: MessageSquare },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="p-4 rounded-xl bg-card/80 border border-border/60 hover:border-primary/40 hover:shadow-md transition-all text-left group block"
            >
              <item.icon className="h-5 w-5 text-primary mb-2 group-hover:scale-110 transition-transform" />
              <p className="text-sm font-semibold">{item.label}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
