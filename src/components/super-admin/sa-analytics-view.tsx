'use client';

import React, { useEffect, useState } from 'react';
import { CRMDatabaseService } from '@/lib/db-service';
import { useCRMStore } from '@/hooks/use-crm-store';
import { motion } from 'framer-motion';
import { Building2, TrendingUp, Users, Cpu, UserPlus, MessageSquare } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';

export function SuperAdminAnalyticsView() {
  const tenantsWithStats = useCRMStore((s) => s.tenantsWithStats);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof CRMDatabaseService.getGlobalAnalytics>> | null>(null);

  useEffect(() => {
    CRMDatabaseService.getGlobalAnalytics().then(setStats);
  }, [tenantsWithStats]);

  if (!stats) {
    return <div className="p-8 text-muted-foreground">Loading analytics...</div>;
  }

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Global Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Cross-agency performance and growth metrics.</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {[
            { label: 'Agencies', value: stats.totalTenants, icon: Building2 },
            { label: 'Active', value: stats.activeTenants, icon: UserPlus },
            { label: 'Suspended', value: stats.suspendedTenants, icon: Building2 },
            { label: 'Users', value: stats.totalUsers, icon: Users },
            { label: 'Leads', value: stats.totalLeads, icon: TrendingUp },
            { label: 'AI Spend', value: `$${stats.totalAiSpend.toFixed(0)}`, icon: Cpu },
          ].map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="p-4 rounded-2xl bg-card/80 border border-border/60 shadow-sm"
            >
              <stat.icon className="h-4 w-4 text-primary mb-2" />
              <h3 className="text-xl font-bold">{stat.value}</h3>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
            <h3 className="font-bold mb-4">Leads by Agency</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={stats.leadsByTenant}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="tenantName" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="leads" fill="#2563EB" name="Leads" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
            <h3 className="font-bold mb-4">AI Spend by Agency</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={stats.leadsByTenant}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="tenantName" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'AI Spend']} />
                  <Bar dataKey="aiSpend" fill="#7C3AED" name="AI Spend" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {stats.tenantGrowth.length > 0 && (
          <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
            <h3 className="font-bold mb-4">Agency Signups Over Time</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart data={stats.tenantGrowth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#2563EB" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-card/80 border border-border/60 overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <h3 className="font-bold">Agency Comparison Table</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/20 border-b border-border/40">
                  <th className="text-left p-4 font-semibold">Agency</th>
                  <th className="text-right p-4 font-semibold">Users</th>
                  <th className="text-right p-4 font-semibold">Leads</th>
                  <th className="text-right p-4 font-semibold">AI Spend</th>
                  <th className="text-right p-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {stats.leadsByTenant.map((row) => {
                  const tenant = tenantsWithStats.find((t) => t.id === row.tenantId);
                  return (
                    <tr key={row.tenantId} className="hover:bg-secondary/10">
                      <td className="p-4 font-medium">{row.tenantName}</td>
                      <td className="p-4 text-right">{row.users}</td>
                      <td className="p-4 text-right">{row.leads}</td>
                      <td className="p-4 text-right font-mono">${row.aiSpend.toFixed(2)}</td>
                      <td className="p-4 text-right">
                        <span className={`text-[10px] font-bold uppercase ${tenant?.status === 'active' ? 'text-emerald-600' : 'text-red-600'}`}>
                          {tenant?.status || 'unknown'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl bg-card/80 border border-border/60 flex items-center gap-4">
            <MessageSquare className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{stats.totalConversations}</p>
              <p className="text-sm text-muted-foreground">Total conversations platform-wide</p>
            </div>
          </div>
          <div className="p-5 rounded-2xl bg-card/80 border border-border/60 flex items-center gap-4">
            <Cpu className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{stats.aiCallsThisMonth}</p>
              <p className="text-sm text-muted-foreground">AI calls this month</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
