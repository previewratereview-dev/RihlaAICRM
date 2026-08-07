'use client';

import React, { useMemo, useState } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { ScrollText, Search, Download } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export function SuperAdminAuditView() {
  const auditLogs = useCRMStore((s) => s.auditLogs);
  const tenants = useCRMStore((s) => s.tenants);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('all');

  const actions = useMemo(() => {
    const set = new Set(auditLogs.map((l) => l.action));
    return Array.from(set).sort();
  }, [auditLogs]);

  const filtered = useMemo(() => {
    return auditLogs.filter((log) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        log.details.toLowerCase().includes(q) ||
        log.userName.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q);
      const matchesAction = actionFilter === 'all' || log.action === actionFilter;
      const matchesTenant = tenantFilter === 'all' || log.tenantId === tenantFilter;
      return matchesSearch && matchesAction && matchesTenant;
    });
  }, [auditLogs, search, actionFilter, tenantFilter]);

  const exportCsv = () => {
    const header = 'Date,Action,User,Role,Tenant,Details\n';
    const rows = filtered
      .map(
        (l) =>
          `"${l.createdAt}","${l.action}","${l.userName}","${l.userRole}","${l.tenantId || ''}","${l.details.replace(/"/g, '""')}"`
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `platform-audit-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ScrollText className="h-6 w-6 text-primary" />
              Platform Audit Log
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{auditLogs.length} events across all agencies</p>
          </div>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-border/60 text-sm font-medium hover:bg-secondary/50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search actions, users, details..."
              className="w-full h-10 pl-9 pr-4 rounded-xl border border-input text-sm"
            />
          </div>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="h-10 px-3 rounded-xl border text-sm">
            <option value="all">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)} className="h-10 px-3 rounded-xl border text-sm">
            <option value="all">All tenants</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl bg-card/80 border border-border/60 overflow-hidden">
          <div className="divide-y divide-border/40 max-h-[calc(100vh-280px)] overflow-y-auto">
            {filtered.map((log) => (
              <div key={log.id} className="p-4 hover:bg-secondary/20">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase">
                        {log.action.replace(/_/g, ' ')}
                      </span>
                      {log.tenantId && (
                        <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-[10px] font-mono">
                          {tenants.find((t) => t.id === log.tenantId)?.name || log.tenantId}
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-1.5">{log.details}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {log.userName} · {log.userRole}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <EmptyState
                title="No Audit Events"
                description="No audit events match your current filters."
                icon="search"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
