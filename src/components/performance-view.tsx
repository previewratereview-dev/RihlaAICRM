'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Flame, Target, Zap, Award, TrendingUp } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Skeleton } from '@/components/ui/skeleton';

export function PerformanceView() {
  const team = useCRMStore((state) => state.team);
  const tasks = useCRMStore((state) => state.tasks);
  const leads = useCRMStore((state) => state.leads);
  const auditLogs = useCRMStore((state) => state.auditLogs);
  const dataLoading = useCRMStore((state) => state.dataLoading);

  const leaderboard = useMemo(() => {
    const members = team.filter((m) => m.role !== 'super_admin');

    return members
      .map((member) => {
        const completedTasks = tasks.filter(
          (t) => t.assignedTo === member.id && t.status === 'completed'
        ).length;
        const closedWonLeads = leads.filter(
          (l) => l.assignedTo === member.id && l.status === 'closed_won'
        ).length;
        const auditActions = auditLogs.filter((log) => log.userId === member.id).length;
        const score = completedTasks * 10 + closedWonLeads * 50 + auditActions * 2;

        return {
          id: member.id,
          name: member.fullName,
          score,
          completedTasks,
          closedWonLeads,
          auditActions,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [team, tasks, leads, auditLogs]);

  const avgScore =
    leaderboard.length > 0
      ? Math.round(leaderboard.reduce((acc, m) => acc + m.score, 0) / leaderboard.length)
      : 0;
  const topPerformer = leaderboard[0]?.name ?? '—';
  const totalClosedWon = leaderboard.reduce((acc, m) => acc + m.closedWonLeads, 0);

  const summaryStats = [
    { label: 'Avg. Team Score', value: String(avgScore), icon: Trophy },
    { label: 'Top Performer', value: topPerformer, icon: Flame },
    { label: 'Total Closed Won', value: String(totalClosedWon), icon: Target },
  ];

  if (dataLoading && team.length === 0) {
    return (
      <div className="p-6 lg:p-8 space-y-6 overflow-y-auto h-full scrollbar-thin">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-5 rounded-2xl border border-border/60 bg-card">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight font-heading">Team Performance</h2>
          <p className="text-sm text-muted-foreground font-medium mt-1">Leaderboard based on tasks, deals, and activity.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {summaryStats.map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="p-5 rounded-2xl bg-card/80 border border-border/60 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10">
                  <stat.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">{stat.label}</p>
                  <p className="text-xl font-bold text-foreground font-heading truncate">{stat.value}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="rounded-2xl bg-card/80 border border-border/60 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border/40">
            <h3 className="text-base font-bold text-foreground font-heading">Team Leaderboard</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Score = completed tasks × 10 + closed-won leads × 50 + audit actions × 2
            </p>
          </div>

          {leaderboard.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground font-mono text-sm">
              No team members to rank yet.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {leaderboard.map((member, idx) => (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="p-5 flex items-center gap-4 hover:bg-secondary/30 transition-colors"
                >
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      idx === 0
                        ? 'bg-amber-100 text-amber-700'
                        : idx === 1
                          ? 'bg-slate-200 text-slate-700'
                          : idx === 2
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    #{idx + 1}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">{member.name}</h4>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Zap className="h-3 w-3" /> {member.completedTasks} tasks
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" /> {member.closedWonLeads} deals
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Award className="h-3 w-3" /> {member.auditActions} actions
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-foreground font-mono">{member.score}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">points</p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl bg-card/80 border border-border/60 shadow-sm overflow-hidden mt-6 min-w-0">
          <div className="p-6 border-b border-border/40">
            <h3 className="text-base font-bold text-foreground font-heading">Audit Log</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Recent security and system events.
            </p>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-semibold border-b border-border/50">
                <tr>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">User</th>
                  <th className="px-6 py-3 font-medium">Action</th>
                  <th className="px-6 py-3 font-medium">IP Address</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {auditLogs.length > 0 ? (
                  auditLogs.slice(0, 100).map((log) => (
                    <tr key={log.id} className="hover:bg-muted/20">
                      <td className="px-6 py-3 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-3">
                        <div className="font-medium text-foreground">{log.userName}</div>
                        <div className="text-[10px] text-muted-foreground uppercase">{log.userRole.replace('_', ' ')}</div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="font-medium">{log.action.replace(/_/g, ' ')}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[300px]" title={log.details}>
                          {log.details}
                        </div>
                      </td>
                      <td className="px-6 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        —
                      </td>
                      <td className="px-6 py-3 pr-8">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                          Success
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                      No activity recorded in the current timeframe.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
