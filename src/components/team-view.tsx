'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Mail, Shield, Search, Settings2 } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { AdminUserManagement } from '@/components/admin-user-management';
import { getInitials } from '@/lib/utils';

function formatRole(role: string): string {
  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const ROLE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  admin:      { bg: 'bg-violet-100', text: 'text-violet-700', dot: 'bg-violet-500' },
  manager:    { bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500'   },
  specialist: { bg: 'bg-emerald-100',text: 'text-emerald-700',dot: 'bg-emerald-500'},
  consultant: { bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500'  },
  viewer:     { bg: 'bg-slate-100',  text: 'text-slate-600',  dot: 'bg-slate-400'  },
};

function getRoleColor(role: string) {
  return ROLE_COLORS[role] ?? ROLE_COLORS.viewer;
}

type ActiveTab = 'directory' | 'management';

export function TeamView() {
  const team = useCRMStore((state) => state.team);
  const currentUser = useCRMStore((state) => state.currentUser);
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  const [activeTab, setActiveTab] = useState<ActiveTab>('directory');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  // Mark the currently logged-in user as online client-side
  const teamWithPresence = useMemo(() => {
    return team.map((member) => ({
      ...member,
      isOnline: member.id === currentUser?.id ? true : member.isOnline,
    }));
  }, [team, currentUser?.id]);

  const filteredTeam = useMemo(() => {
    return teamWithPresence.filter((member) => {
      const matchesSearch =
        !searchTerm.trim() ||
        member.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRole = roleFilter === 'all' || member.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [teamWithPresence, searchTerm, roleFilter]);

  const onlineCount = teamWithPresence.filter((m) => m.isOnline).length;

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight font-heading flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              Team Management
            </h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">
              {teamWithPresence.length} members &middot;{' '}
              <span className="text-emerald-600 font-semibold">{onlineCount} online</span>
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-2xl w-fit border border-border/50">
          <button
            onClick={() => setActiveTab('directory')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
              activeTab === 'directory'
                ? 'bg-background text-foreground shadow-sm border border-border/50'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="h-4 w-4" />
            Active Users
            <span className={`inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[10px] font-bold ${
              activeTab === 'directory' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              {teamWithPresence.length}
            </span>
          </button>

          {isAdmin && (
            <button
              onClick={() => setActiveTab('management')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'management'
                  ? 'bg-background text-foreground shadow-sm border border-border/50'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Settings2 className="h-4 w-4" />
              User Management
            </button>
          )}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          {activeTab === 'directory' && (
            <motion.div
              key="directory"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-4"
            >
              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="h-10 rounded-xl border border-input bg-card/80 px-3 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                >
                  <option value="all">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="consultant">Consultant</option>
                  <option value="specialist">Specialist</option>
                  <option value="viewer">Viewer</option>
                </select>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search team..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-10 w-52 rounded-xl border border-input bg-card/80 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                </div>
              </div>

              {/* Member grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTeam.length === 0 ? (
                  <div className="col-span-full p-12 rounded-2xl bg-card/80 border border-border/60 text-center">
                    <Users className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {team.length === 0 ? 'No team members found.' : 'No team members match your search.'}
                    </p>
                  </div>
                ) : (
                  filteredTeam.map((member, idx) => {
                    const isCurrentUser = member.id === currentUser?.id;
                    const roleColor = getRoleColor(member.role);

                    return (
                      <motion.div
                        key={member.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.06 }}
                        className={`p-5 rounded-2xl border shadow-sm hover:shadow-md hover:border-primary/30 transition-all group ${
                          isCurrentUser
                            ? 'bg-primary/5 border-primary/30'
                            : 'bg-card/80 border-border/60'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          {/* Avatar + online dot */}
                          <div className="relative shrink-0">
                            <div className={`h-14 w-14 rounded-full bg-gradient-to-br from-primary to-primary/70 text-white flex items-center justify-center text-lg font-bold shadow-md ${
                              isCurrentUser ? 'ring-2 ring-primary ring-offset-2' : ''
                            }`}>
                              {getInitials(member.fullName)}
                            </div>
                            <span
                              className={`absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background ${
                                member.isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                              }`}
                            />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                                {member.fullName}
                              </h3>
                              {isCurrentUser && (
                                <span className="text-[10px] font-bold bg-primary/15 text-primary px-2 py-0.5 rounded-full shrink-0">
                                  You
                                </span>
                              )}
                            </div>

                            {/* Role badge */}
                            <div className={`inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${roleColor.bg} ${roleColor.text}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${roleColor.dot}`} />
                              {formatRole(member.role)}
                            </div>

                            <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{member.email}</span>
                            </div>

                            <div className="mt-2">
                              <span
                                className={`text-[10px] font-mono font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                                  member.isOnline
                                    ? 'text-emerald-700 bg-emerald-50'
                                    : 'text-muted-foreground bg-secondary/50'
                                }`}
                              >
                                {member.isOnline ? '● Online' : '○ Offline'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'management' && isAdmin && (
            <motion.div
              key="management"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="p-6 rounded-2xl bg-card/80 border border-border/60 shadow-sm"
            >
              <AdminUserManagement />
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
