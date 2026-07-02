'use client';

import React, { useMemo } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { formatCurrency } from '@/lib/utils';
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
  Smile,
  ArrowUpRight,
  ChevronRight,
} from 'lucide-react';
import { getStatusColor, getStatusLabel } from '@/lib/utils';

export function DashboardView() {
  const leads = useCRMStore((state) => state.leads);
  const tasks = useCRMStore((state) => state.tasks);
  const activities = useCRMStore((state) => state.activities);
  const setActiveTab = useCRMStore((state) => state.setActiveTab);
  const team = useCRMStore((state) => state.team);
  const settings = useCRMStore((state) => state.settings);
  const dataLoading = useCRMStore((state) => state.dataLoading);

  const revenueHistory = useMemo(() => {
    const months: Record<string, number> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleString('en-US', { month: 'short' });
      months[key] = 0;
    }
    leads
      .filter((l) => l.status === 'closed_won')
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
    const salesTeam = team.filter(m => m.role === 'setter' || m.role === 'closer');
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return salesTeam.map(member => {
      const memberActivities = Object.values(activities)
        .flat()
        .filter(act => act.userId === member.id && new Date(act.createdAt).getTime() >= startOfToday.getTime());

      const calls = memberActivities.filter(a => a.type === 'call').length;
      const emails = memberActivities.filter(a => a.type === 'email').length;
      const whatsapp = memberActivities.filter(a => a.type === 'message' && a.description.toLowerCase().includes('whatsapp')).length;
      const linkedin = memberActivities.filter(a => a.type === 'message' && a.description.toLowerCase().includes('linkedin')).length;

      const memberMeetings = tasks.filter(t => t.type === 'meeting' && t.assignedTo === member.id);
      const meetingsBooked = memberMeetings.filter(t => new Date(t.createdAt).getTime() >= startOfToday.getTime()).length;
      const completedTasks = tasks.filter(t => t.assignedTo === member.id && t.status === 'completed' && t.completedAt && new Date(t.completedAt).getTime() >= startOfToday.getTime()).length;

      const score = (calls * 2) + (emails * 1) + (whatsapp * 2) + (linkedin * 2) + (completedTasks * 3) + (meetingsBooked * 10);
      const uniqueContacted = new Set(memberActivities.filter(a => ['call', 'email', 'message'].includes(a.type)).map(a => a.leadId));
      const contactedCount = uniqueContacted.size;
      const assignedCount = leads.filter(l => l.assignedTo === member.id).length;
      const contactRate = assignedCount > 0 ? Math.round((contactedCount / assignedCount) * 100) : 0;

      return { ...member, score, contactRate, meetingsBooked, completedTasks };
    }).sort((a, b) => b.score - a.score);
  }, [team, activities, tasks, leads]);

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
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="p-5 rounded-2xl border border-border/60 bg-card">
            <Skeleton className="h-5 w-32 mb-4" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    );
  }

  const totalLeads = leads.length;
  const closedWonLeads = leads.filter((l) => l.status === 'closed_won');
  const totalRevenue = closedWonLeads.reduce((acc, l) => acc + l.dealValue, 0);
  const closedLostLeads = leads.filter((l) => l.status === 'closed_lost');
  const totalClosed = closedWonLeads.length + closedLostLeads.length;
  const conversionRate = totalClosed > 0 ? Math.round((closedWonLeads.length / totalClosed) * 100) : 0;
  const activeAgents = leads.filter((l) => l.status !== 'closed_won' && l.status !== 'closed_lost' && l.aiScore > 70).length;

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _allActivities = Object.values(activities)
    .flat()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _upcomingMeetings = tasks
    .filter((t) => t.type === 'meeting' && t.status === 'pending')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 3);

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
        <button
          onClick={() => setActiveTab('leads')}
          className="flex items-center gap-1.5 px-5 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 active:scale-95 transition-all select-none cursor-pointer shadow-md shadow-primary/20"
        >
          <span>Create Booking</span>
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
        {[
          { label: 'Total Travelers', value: totalLeads, icon: Users, trend: '+12%', trendColor: 'text-emerald-600', trendBg: 'bg-emerald-50', iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          { label: 'Revenue Booked', value: formatCurrency(totalRevenue), icon: DollarSign, trend: '+24.5%', trendColor: 'text-emerald-600', trendBg: 'bg-emerald-50', iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
          { label: 'Conversion', value: `${conversionRate}%`, icon: TrendingUp, trend: '+5.2%', trendColor: 'text-blue-600', trendBg: 'bg-blue-50', iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          { label: 'Active Bookings', value: activeAgents, icon: Cpu, trend: 'Live', trendColor: 'text-amber-600', trendBg: 'bg-amber-50', iconBg: 'bg-amber-50', iconColor: 'text-amber-600' },
          { label: 'Client CSAT', value: '98.4%', icon: Smile, trend: 'Stable', trendColor: 'text-emerald-600', trendBg: 'bg-emerald-50', iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
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

      {/* Main Charts & Inbound distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={itemVariants} className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border border-border/60 shadow-sm lg:col-span-2">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">Revenue Pipeline Growth</h3>
              <p className="text-xs text-muted-foreground font-medium mt-1">Closed contract revenue history.</p>
            </div>
          </div>
          <div className="h-64 w-full min-w-0">
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
                <YAxis stroke="var(--muted-foreground)" fontSize={10} fontFamily="monospace" tickLine={false} axisLine={false} />
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
          <div className="h-64 w-full mt-4 min-w-0">
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
        <motion.div variants={itemVariants} className="rounded-2xl bg-card/80 backdrop-blur-sm border border-border/60 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border/40">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">Top Prospects</h3>
                <p className="text-xs text-muted-foreground font-medium mt-1">High-intent leads in pipeline.</p>
              </div>
              <button onClick={() => setActiveTab('leads')} className="text-xs font-mono text-primary hover:text-primary/80 flex items-center gap-1 cursor-pointer font-semibold">
                View All <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-secondary/30 text-xs uppercase font-mono tracking-wider text-muted-foreground">
                  <th className="py-3 px-6 font-semibold">Lead</th>
                  <th className="py-3 px-6 font-semibold">Destination</th>
                  <th className="py-3 px-6 font-semibold">Stage</th>
                  <th className="py-3 px-6 font-semibold text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {leads.slice(0, 5).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted-foreground font-mono text-xs">
                      No travelers yet. Add your first lead to get started.
                    </td>
                  </tr>
                ) : leads.slice(0, 5).map((lead) => (
                  <tr key={lead.id} onClick={() => setActiveTab('leads')} className="hover:bg-secondary/30 transition-colors cursor-pointer">
                    <td className="py-3.5 px-6">
                      <div>
                        <span className="font-semibold text-foreground">{lead.fullName}</span>
                        <span className="text-xs text-muted-foreground block font-mono">{lead.email}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-6 text-muted-foreground font-medium">{lead.destination || lead.businessName}</td>
                    <td className="py-3.5 px-6">
                      <span className="px-2.5 py-1 rounded-full border bg-card text-xs font-mono font-semibold" style={{ borderColor: `${getStatusColor(lead.status)}33`, color: getStatusColor(lead.status) }}>
                        {getStatusLabel(lead.status)}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-right font-mono font-bold text-foreground">{formatCurrency(lead.dealValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="rounded-2xl bg-card/80 backdrop-blur-sm border border-border/60 shadow-sm">
          <div className="p-6 border-b border-border/40">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">Team Performance</h3>
                <p className="text-xs text-muted-foreground font-medium mt-1">Daily leaderboard.</p>
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