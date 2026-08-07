'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CRMDatabaseService } from '@/lib/db-service';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Cpu, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export function SuperAdminAIGovernanceView() {
  const tenantsWithStats = useCRMStore((s) => s.tenantsWithStats);
  const [usage, setUsage] = useState<Array<{
    id: string;
    tenantId: string;
    feature: string;
    provider: string;
    model: string;
    costEstimate: number;
    status: string;
    createdAt: string;
    tokensIn: number;
    tokensOut: number;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    CRMDatabaseService.getGlobalAIUsage(200).then((data) => {
      setUsage(data);
      setLoading(false);
    });
  }, [tenantsWithStats]);

  const totalSpend = usage.reduce((s, u) => s + u.costEstimate, 0);
  const blocked = usage.filter((u) => u.status === 'blocked').length;
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const byTenant = useMemo(() => {
    const map: Record<string, number> = {};
    usage.forEach((u) => {
      map[u.tenantId] = (map[u.tenantId] || 0) + u.costEstimate;
    });
    return Object.entries(map)
      .map(([tenantId, spend]) => ({
        tenantId,
        name: tenantsWithStats.find((t) => t.id === tenantId)?.name || tenantId,
        spend,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);
  }, [usage, tenantsWithStats]);

  const byFeature = useMemo(() => {
    const map: Record<string, number> = {};
    usage.forEach((u) => {
      map[u.feature] = (map[u.feature] || 0) + u.costEstimate;
    });
    return Object.entries(map).map(([feature, spend]) => ({ feature, spend }));
  }, [usage]);

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-6 w-6 text-primary" />
            AI Governance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Cross-tenant AI usage, spend limits, and blocked requests.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-card/80 border border-border/60">
            <TrendingUp className="h-5 w-5 text-primary mb-2" />
            <p className="text-2xl font-bold">${totalSpend.toFixed(2)}</p>
            <p className="text-sm text-muted-foreground">Total platform AI spend</p>
          </div>
          <div className="p-5 rounded-2xl bg-card/80 border border-border/60">
            <ShieldCheck className="h-5 w-5 text-emerald-600 mb-2" />
            <p className="text-2xl font-bold">{usage.length - blocked}</p>
            <p className="text-sm text-muted-foreground">Allowed requests</p>
          </div>
          <div className="p-5 rounded-2xl bg-card/80 border border-border/60">
            <ShieldAlert className="h-5 w-5 text-red-600 mb-2" />
            <p className="text-2xl font-bold">{blocked}</p>
            <p className="text-sm text-muted-foreground">Budget-blocked</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
            <h3 className="font-bold mb-4">Spend by Agency</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={byTenant}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Spend']} />
                  <Bar dataKey="spend" fill="#2563EB" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
            <h3 className="font-bold mb-4">Spend by Feature</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={byFeature}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="feature" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Spend']} />
                  <Bar dataKey="spend" fill="#7C3AED" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
          <h3 className="font-bold mb-4">Per-Agency AI Budget Status</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tenantsWithStats.map((t) => {
              const budget = (t.settings?.aiBudget as number) || 100;
              const pct = budget > 0 ? Math.min(100, (t.stats.aiSpend / budget) * 100) : 0;
              return (
                <div key={t.id} className="p-4 rounded-xl border border-border/40">
                  <div className="flex justify-between items-start mb-2">
                    <p className="text-sm font-semibold">{t.name}</p>
                    <span className={`text-[10px] font-bold ${pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-primary'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono mt-1">
                    ${t.stats.aiSpend.toFixed(2)} / ${budget} budget
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
          <h3 className="font-bold mb-4">Recent AI Calls</h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI usage recorded.</p>
          ) : (
            <div className="divide-y divide-border/40 max-h-[320px] overflow-y-auto">
              {usage.slice(0, 30).map((entry) => (
                <div key={entry.id} className="flex justify-between py-3 text-sm">
                  <div>
                    <p className="font-semibold">{entry.feature}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.tenantId} · {entry.model} ·{' '}
                      <span className={entry.status === 'blocked' ? 'text-red-600' : ''}>{entry.status}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-semibold">${entry.costEstimate.toFixed(4)}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
