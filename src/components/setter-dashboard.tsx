'use client';

import React, { useMemo } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { motion } from 'framer-motion';
import { Phone, Calendar, Target, ListTodo } from 'lucide-react';

export function SetterDashboard() {
  const currentUser = useCRMStore((s) => s.currentUser);
  const leads = useCRMStore((s) => s.leads);
  const tasks = useCRMStore((s) => s.tasks);
  const setActiveTab = useCRMStore((s) => s.setActiveTab);

  const myLeads = useMemo(
    () => leads.filter((l) => l.assignedTo === currentUser?.id),
    [leads, currentUser?.id]
  );
  const myTasks = useMemo(
    () => tasks.filter((t) => t.assignedTo === currentUser?.id),
    [tasks, currentUser?.id]
  );
  const pendingTasks = myTasks.filter((t) => t.status === 'pending').length;
  const completedTasks = myTasks.filter((t) => t.status === 'completed').length;
  const meetings = myTasks.filter((t) => t.type === 'meeting' && t.status === 'pending').length;
  const hotLeads = myLeads.filter((l) => l.aiScore >= 85).length;

  const stats = [
    { label: 'Active Bookings', value: String(myLeads.length), icon: Target, change: `${hotLeads} hot` },
    { label: 'Pending Tasks', value: String(pendingTasks), icon: ListTodo, change: `${completedTasks} done` },
    { label: 'Upcoming Meetings', value: String(meetings), icon: Calendar, change: 'scheduled' },
    { label: 'Contact Rate', value: myLeads.length ? `${Math.round((completedTasks / Math.max(myTasks.length, 1)) * 100)}%` : '0%', icon: Phone, change: 'tasks' },
  ];

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-heading">Travel Specialist Overview</h2>
          <p className="text-sm text-muted-foreground mt-1">Welcome back, {currentUser?.fullName}. Here is your day at a glance.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="p-5 rounded-2xl bg-card/80 border border-border/60 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 rounded-xl bg-primary/10">
                  <stat.icon className="h-5 w-5 text-primary" />
                </div>
                <span className="text-[10px] font-bold font-mono text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                  {stat.change}
                </span>
              </div>
              <h3 className="text-2xl font-bold font-heading">{stat.value}</h3>
              <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
            <h3 className="font-bold mb-4">Your Hot Leads</h3>
            {myLeads.filter((l) => l.aiScore >= 70).slice(0, 5).map((lead) => (
              <button
                key={lead.id}
                onClick={() => setActiveTab('leads')}
                className="w-full text-left p-3 rounded-xl hover:bg-secondary/50 mb-2 flex justify-between items-center"
              >
                <span className="font-medium text-sm">{lead.fullName}</span>
                <span className="text-xs font-mono text-primary">{lead.aiScore}%</span>
              </button>
            ))}
            {myLeads.filter((l) => l.aiScore >= 70).length === 0 && (
              <p className="text-sm text-muted-foreground">No hot leads assigned yet.</p>
            )}
          </div>
          <div className="rounded-2xl bg-card/80 border border-border/60 p-6">
            <h3 className="font-bold mb-4">Upcoming Tasks</h3>
            {myTasks.filter((t) => t.status === 'pending').slice(0, 5).map((task) => (
              <button
                key={task.id}
                onClick={() => setActiveTab('tasks')}
                className="w-full text-left p-3 rounded-xl hover:bg-secondary/50 mb-2"
              >
                <p className="font-medium text-sm">{task.title}</p>
                <p className="text-xs text-muted-foreground">{new Date(task.dueDate).toLocaleString()}</p>
              </button>
            ))}
            {myTasks.filter((t) => t.status === 'pending').length === 0 && (
              <p className="text-sm text-muted-foreground">No pending tasks.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
