'use client';

import React, { useMemo } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { formatCurrency } from '@/lib/utils';
import { calculateCRMMetrics } from '@/lib/metrics';
import { getInquiryDisplayName } from '@/lib/pipeline-utils';
import { motion, Variants } from 'framer-motion';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  Users,
  DollarSign,
  Cpu,
  Compass,
  ArrowUpRight,
  ChevronRight,
} from 'lucide-react';
import { getStatusColor, getStatusLabel } from '@/lib/utils';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { useAttention } from '@/hooks/use-attention';
import { DashboardNeedsAttention } from '@/components/attention';

export function DashboardView() {
  const leads = useCRMStore((state) => state.leads);
  const tasks = useCRMStore((state) => state.tasks);
  const activities = useCRMStore((state) => state.activities);
  const setActiveTab = useCRMStore((state) => state.setActiveTab);
  const team = useCRMStore((state) => state.team);
  const settings = useCRMStore((state) => state.settings);
  const dataLoading = useCRMStore((state) => state.dataLoading);
  const currentUser = useCRMStore((state) => state.currentUser);
  const canWrite = can(currentUser?.role ?? 'viewer', 'leads:write');

  const {
    summary: attentionSummary,
    signals: attentionSignals,
    isLoading: attentionLoading,
    error: attentionError,
    refresh: refreshAttention,
  } = useAttention();

  const crmMetrics = useMemo(() => calculateCRMMetrics(leads), [leads]);

  const revenueHistory = useMemo(() => {
    const months: Record<string, number> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleString('en-US', { month: 'short' });
      months[key] = 0;
    }
    leads
      .filter((l) => l.status === 'closed_won' || l.status === 'booking_confirmed')
      .forEach((l) => {
        const key = new Date(l.createdAt).toLocaleString('en-US', { month: 'short' });
        if (months[key] !== undefined) months[key] += l.dealValue || 0;
      });
    const totalLeads = leads.length || 1;
    const aiScored = leads.filter((l) => l.aiScore > 0).length;
    const automationRate = Math.round((aiScored / totalLeads) * 100);
    return Object.entries(months).map(([month, revenue]) => ({
      month,
      revenue,
      automationRate,
    }));
  }, [leads]);

  const setterLeaderboard = useMemo(() => {
    const salesTeam = team.filter((m) => m.role !== 'super_admin');

    return salesTeam.map((member) => {
      const completedTasks = tasks.filter(
        (t) => t.assignedTo === member.id && t.status === 'completed'
      ).length;
      const closedDeals = leads.filter(
        (l) => l.assignedTo === member.id && (l.status === 'closed_won' || l.status === 'booking_confirmed')
      ).length;
      const auditActions = Object.values(activities)
        .flat()
        .filter((act) => act.userId === member.id).length;

      const score = completedTasks * 10 + closedDeals * 50 + auditActions * 2;
      const assignedCount = leads.filter((l) => l.assignedTo === member.id).length;
      const uniqueContacted = new Set(
        Object.values(activities)
          .flat()
          .filter((a) => ['call', 'email', 'message'].includes(a.type))
          .map((a) => a.leadId)
      );
      const contactedCount = uniqueContacted.size;
      const contactRate = assignedCount > 0 ? Math.round((contactedCount / assignedCount) * 100) : 0;
      const meetingsBooked = tasks.filter(
        (t) => t.type === 'meeting' && t.assignedTo === member.id
      ).length;

      return { ...member, score, contactRate, meetingsBooked, completedTasks };
    }).sort((a, b) => b.score - a.score);
  }, [team, activities, tasks, leads]);

  const topProspects = useMemo(() => {
    return leads
      .filter((l) => l.status !== 'closed_lost' && l.status !== 'booking_lost' && l.status !== 'closed_won' && l.status !== 'booking_confirmed')
      .sort((a, b) => (b.dealValue || 0) - (a.dealValue || 0))
      .slice(0, 5);
  }, [leads]);

  if (dataLoading && leads.length === 0) {
    return (
      <div className="p-6 lg:p-8 space-y-6 overflow-y-auto h-full scrollbar-thin">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-5 rounded-2xl border border-border/60 bg-card">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-8 w-32 mb-2" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 p-5 rounded-2xl border border-border/60 bg-card">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-[200px] w-full" />
          </div>
          <div className="p-5 rounded-2xl border border-border/60 bg-card">
            <Skeleton className="h-5 w-32 mb-4" />
            <Skeleton className="h-[200px] w-full" />
          </div>
        </div>
      </div>
    );
  }

  const sourceCounts: Record<string, number> = {};
  leads.forEach((l) => {
    const src = l.leadSource || 'other';
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  });
  

  const sourceChartData = Object.entries(sourceCounts).map(([name, value]) => ({
    name: name.replace('_', ' ').toUpperCase(),
    value,
  })).sort((a, b) => b.value - a.value);

  const COLORS = ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#E2E8F0'];

  const dailyTarget = settings.dailyTargetScore || 50;

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.04 } },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 120, damping: 18 } },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="p-8 space-y-8 overflow-y-auto h-full scrollbar-thin max-w-7xl mx-auto"
    >
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 select-none">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground font-heading">Workspace Overview</h2>
          <p className="text-sm text-muted-foreground font-medium mt-1">Welcome back! Here&apos;s what&apos;s happening today.</p>
        </div>
        {canWrite && (
          <Button
            onClick={() => setActiveTab('inquiries')}
            variant="outline"
            size="lg"
            className="gap-1.5"
          >
            <span>New Inquiry</span>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
        {[
          { label: 'Unique Travelers', value: crmMetrics.uniqueTravelersCount, icon: Users, trend: `${crmMetrics.repeatClientsCount} repeat`, trendColor: 'text-emerald-600', trendBg: 'bg-emerald-50', iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          { label: 'Open Inquiries', value: crmMetrics.openInquiries, icon: Compass, trend: 'Active', trendColor: 'text-amber-600', trendBg: 'bg-amber-50', iconBg: 'bg-amber-50', iconColor: 'text-amber-600' },
          { label: 'Confirmed Trips', value: crmMetrics.confirmedBookings, icon: Cpu, trend: 'Confirmed', trendColor: 'text-emerald-600', trendBg: 'bg-emerald-50', iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
          { label: 'Conversion Rate', value: `${crmMetrics.conversionRate}%`, icon: TrendingUp, trend: 'Closed-Won', trendColor: 'text-blue-600', trendBg: 'bg-blue-50', iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          { label: 'Pipeline Value', value: formatCurrency(crmMetrics.pipelineEstimatedValue), icon: DollarSign, trend: 'Estimated', trendColor: 'text-purple-600', trendBg: 'bg-purple-50', iconBg: 'bg-purple-50', iconColor: 'text-purple-600' },
        ].map((stat, idx) => (
          <motion.div
            key={idx}
            variants={itemVariants}
            className="group p-5 rounded-2xl bg-card/80 backdrop-blur-sm border border-border/60 shadow-sm hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 transition-all duration-200"
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2.5 rounded-xl ${stat.iconBg} shadow-sm`}>
                <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
              </div>
              <span className={`text-[10px] font-bold font-mono px-2 py-1 rounded-full ${stat.trendBg} ${stat.trendColor}`}>
                {stat.trend}
              </span>
            </div>
            <h3 className="text-3xl font-bold text-foreground font-heading mb-1 tracking-tight">
              {stat.value}
            </h3>
            <p className="text-sm text-muted-foreground font-medium">
              {stat.label}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Deterministic Proactive Attention Section */}
      <motion.div variants={itemVariants}>
        <DashboardNeedsAttention
          summary={attentionSummary}
          signals={attentionSignals}
          isLoading={attentionLoading}
          error={attentionError}
          onRefresh={refreshAttention}
          onNavigateInquiry={() => {
            setActiveTab('inquiries');
          }}
          onNavigateConversation={() => {
            setActiveTab('conversations');
          }}
        />
      </motion.div>

      {/* Main Charts & Inbound distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={itemVariants} className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border border-border/60 shadow-sm lg:col-span-2">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">Revenue Pipeline Growth</h3>
              <p className="text-xs text-muted-foreground font-medium mt-1">Closed contract deal value history.</p>
            </div>
          </div>
          <div className="h-[200px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={revenueHistory} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF6B35" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#FF6B35" stopOpacity={0.01}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={10} fontFamily="monospace" tickLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} fontFamily="monospace" tickLine={false} axisLine={false} tickFormatter={(val) => val >= 1000 ? `₹${(val / 1000).toFixed(0)}k` : `₹${val}`} width={65} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)', fontSize: 11, fontFamily: 'monospace', borderRadius: 8, boxShadow: '0 4px 12px rgba(15,23,42,0.05)' }}
                  labelStyle={{ fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#FF6B35" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRevenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border border-border/60 shadow-sm">
          <div>
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">Booking Sources</h3>
            <p className="text-xs text-muted-foreground font-medium mt-1">Top performing acquisition channels.</p>
          </div>
          <div className="h-[200px] w-full mt-4 min-w-0">
            {sourceChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={sourceChartData} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                  <XAxis type="number" stroke="var(--muted-foreground)" fontSize={9} fontFamily="monospace" tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" stroke="#64748B" fontSize={9} fontFamily="monospace" width={90} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)', fontSize: 10, fontFamily: 'monospace', borderRadius: 8 }}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={12}>
                    {sourceChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-muted-foreground text-sm font-mono h-full flex items-center justify-center">No data available</div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div variants={itemVariants} className="min-w-0 rounded-2xl bg-card/80 backdrop-blur-sm border border-border/60 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border/40">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">Top Prospects</h3>
                <p className="text-xs text-muted-foreground font-medium mt-1">High-intent leads in pipeline.</p>
              </div>
              <button onClick={() => setActiveTab('inquiries')} className="text-xs font-mono text-primary hover:text-primary/80 flex items-center gap-1 cursor-pointer font-semibold">
                View All <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-secondary/30 text-xs uppercase font-mono tracking-wider text-muted-foreground">
                  <th className="py-3 px-4 font-semibold">Lead</th>
                  <th className="py-3 px-4 font-semibold">Destination</th>
                  <th className="py-3 px-4 font-semibold">Stage</th>
                  <th className="py-3 px-4 font-semibold text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {topProspects.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted-foreground font-mono text-xs">
                      No active prospects found.
                    </td>
                  </tr>
                ) : topProspects.map((lead) => (
                  <tr key={lead.id} onClick={() => setActiveTab('inquiries')} className="hover:bg-secondary/30 transition-colors cursor-pointer">
                    <td className="py-3 px-4">
                      <div className="max-w-[130px]">
                        <span className="font-semibold text-foreground truncate block">{getInquiryDisplayName(lead)}</span>
                        <span className="text-[11px] text-muted-foreground block font-mono truncate">{lead.email}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground font-medium text-sm truncate max-w-[100px]">{lead.destination || lead.businessName}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 rounded-full border bg-card text-[10px] font-mono font-semibold whitespace-nowrap" style={{ borderColor: `${getStatusColor(lead.status)}33`, color: getStatusColor(lead.status) }}>
                        {getStatusLabel(lead.status)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-foreground text-sm whitespace-nowrap">{formatCurrency(lead.dealValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="min-w-0 rounded-2xl bg-card/80 backdrop-blur-sm border border-border/60 shadow-sm">
          <div className="p-6 border-b border-border/40">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">Team Performance</h3>
                <p className="text-xs text-muted-foreground font-medium mt-1">Based on activities, pipeline size, & wins.</p>
              </div>
              <button onClick={() => setActiveTab('performance')} className="text-xs font-mono text-primary hover:text-primary/80 flex items-center gap-1 cursor-pointer font-semibold">
                Details <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="p-4 space-y-3">
            {setterLeaderboard.slice(0, 3).map((emp: { id: string; fullName: string; score: number; contactRate: number; meetingsBooked: number }, index: number) => {
              const progressPercent = Math.min(100, Math.round((emp.score / dailyTarget) * 100));
              return (
                <div key={emp.id} className="flex items-center justify-between p-3.5 rounded-xl border border-border/60 hover:border-primary/30 hover:bg-primary/5 transition-all">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-muted-foreground">#{index + 1}</span>
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-primary/80 text-white flex items-center justify-center font-mono text-xs font-bold shadow-sm">
                      {emp.fullName.split(' ').map((n: string)=>n[0]).join('').toUpperCase().substring(0, 2)}
                    </div>
                    <div>
                      <span className="font-bold text-foreground text-sm block">{emp.fullName}</span>
                      <span className="text-xs text-muted-foreground font-mono">Contact: {emp.contactRate}% • Meetings: {emp.meetingsBooked}</span>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1.5">
                    <span className="text-sm font-bold text-foreground font-mono">{emp.score} pts</span>
                    <div className="w-20 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div style={{ width: `${progressPercent}%` }} className={`h-full transition-all ${progressPercent >= 100 ? 'bg-emerald-500' : 'bg-primary'}`} />
                    </div>
                  </div>
                </div>
              );
            })}
            {setterLeaderboard.length === 0 && (
              <div className="text-center py-10 text-muted-foreground font-mono text-sm">No active team profiles.</div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}