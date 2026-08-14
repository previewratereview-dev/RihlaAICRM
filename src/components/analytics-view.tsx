'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Users, DollarSign, BarChart3, Download } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useCRMStore } from '@/hooks/use-crm-store';
import { formatCurrency } from '@/lib/utils';
import { calculateCRMMetrics } from '@/lib/metrics';
import { Skeleton } from '@/components/ui/skeleton';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAR_COLORS = ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#FF6B35'];

export function AnalyticsView() {
  const leads = useCRMStore((state) => state.leads);
  const dataLoading = useCRMStore((state) => state.dataLoading);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      const created = new Date(l.createdAt).getTime();
      if (dateFrom && created < new Date(dateFrom).getTime()) return false;
      if (dateTo && created > new Date(dateTo).getTime() + 86400000) return false;
      return true;
    });
  }, [leads, dateFrom, dateTo]);

  const crmMetrics = useMemo(() => calculateCRMMetrics(filteredLeads), [filteredLeads]);

  const revenueByMonth = useMemo(() => {
    const closedWonLeads = filteredLeads.filter(
      (l) => l.status === 'closed_won' || l.status === 'booking_confirmed'
    );
    const now = new Date();
    const months: { key: string; label: string; revenue: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: MONTH_LABELS[d.getMonth()],
        revenue: 0,
      });
    }

    closedWonLeads.forEach((lead) => {
      const created = new Date(lead.createdAt);
      const key = `${created.getFullYear()}-${created.getMonth()}`;
      const bucket = months.find((m) => m.key === key);
      if (bucket) bucket.revenue += typeof lead.dealValue === 'number' ? lead.dealValue : 0;
    });

    return months.map(({ label, revenue }) => ({ month: label, revenue }));
  }, [filteredLeads]);

  const exportCsv = () => {
    const headers = ['Name', 'Status', 'Deal Value', 'Destination', 'Created'];
    const rows = filteredLeads.map((l) =>
      [l.fullName, l.status, l.dealValue, l.destination, l.createdAt].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statCards = [
    { label: 'Pipeline Value', value: formatCurrency(crmMetrics.pipelineEstimatedValue), icon: DollarSign },
    { label: 'Confirmed Bookings', value: String(crmMetrics.confirmedBookings), icon: Users },
    { label: 'Conversion Rate', value: `${crmMetrics.conversionRate}%`, icon: TrendingUp },
    { label: 'Avg. Deal Size', value: formatCurrency(crmMetrics.avgDealSize), icon: BarChart3 },
  ];

  if (dataLoading && leads.length === 0) {
    return (
      <div className="p-6 lg:p-8 space-y-6 overflow-y-auto h-full scrollbar-thin">
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

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight font-heading">Reports & Analytics</h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">Performance insights and business metrics.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">
              From
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="block mt-1 h-9 rounded-lg border border-input px-2 text-sm" aria-label="Filter analytics from date" />
            </label>
            <label className="text-xs text-muted-foreground">
              To
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="block mt-1 h-9 rounded-lg border border-input px-2 text-sm" aria-label="Filter analytics to date" />
            </label>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-primary/40 text-primary text-sm font-medium cursor-pointer hover:bg-primary/5 transition-colors"
              aria-label="Export analytics data as CSV"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="p-5 rounded-2xl bg-card/80 border border-border/60 shadow-sm hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 rounded-xl bg-primary/10">
                  <stat.icon className="h-5 w-5 text-primary" />
                </div>
              </div>
              <h3 className="text-2xl font-bold text-foreground font-heading">{stat.value}</h3>
              <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        <div className="rounded-2xl bg-card/80 border border-border/60 shadow-sm p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold text-foreground font-heading">Revenue Overview</h3>
            <p className="text-xs text-muted-foreground font-medium mt-1">Closed-won revenue by month (last 6 months).</p>
          </div>
          <div className="h-64 w-full min-w-0">
            {revenueByMonth.some((m) => m.revenue > 0) ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={revenueByMonth} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={10} fontFamily="monospace" tickLine={false} />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                    fontFamily="monospace"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--card)',
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)',
                      fontSize: 11,
                      fontFamily: 'monospace',
                      borderRadius: 8,
                      boxShadow: '0 4px 12px rgba(15,23,42,0.05)',
                    }}
                    formatter={(value) => [formatCurrency(Number(value) || 0), 'Revenue']}
                    labelStyle={{ fontWeight: 'bold' }}
                  />
                  <Bar dataKey="revenue" radius={[6, 6, 0, 0]} barSize={32}>
                    {revenueByMonth.map((entry, index) => (
                      <Cell key={`cell-${entry.month}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm">
                No closed-won revenue data yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
