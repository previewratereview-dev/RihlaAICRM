'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Mail, Shield, Search } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { AdminUserManagement } from '@/components/admin-user-management';
import { getInitials } from '@/lib/utils';

function formatRole(role: string): string {
  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function TeamView() {
  const team = useCRMStore((state) => state.team);
  const currentUser = useCRMStore((state) => state.currentUser);
  const isAdmin = currentUser?.role === 'admin';
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const filteredTeam = useMemo(() => {
    return team.filter((member) => {
      const matchesSearch = !searchTerm.trim() ||
        member.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRole = roleFilter === 'all' || member.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [team, searchTerm, roleFilter]);

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight font-heading">
              Team Directory
            </h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">
              Manage travel specialists and staff.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="h-10 rounded-xl border border-input bg-card/80 px-3 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            >
              <option value="all">All Roles</option>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="consultant">Consultant</option>
              <option value="specialist">Specialist</option>
              <option value="member">Member</option>
            </select>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search team..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 w-48 rounded-xl border border-input bg-card/80 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="p-6 rounded-2xl bg-card/80 border border-border/60 shadow-sm">
            <AdminUserManagement />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTeam.length === 0 ? (
            <div className="col-span-full p-8 rounded-2xl bg-card/80 border border-border/60 text-center text-sm text-muted-foreground">
              {team.length === 0 ? 'No team members found.' : 'No team members match your search.'}
            </div>
          ) : (
            filteredTeam.map((member, idx) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="p-6 rounded-2xl bg-card/80 border border-border/60 shadow-sm hover:shadow-lg hover:border-primary/30 transition-all group"
              >
                <div className="flex items-start gap-4">
                  <div className="relative shrink-0">
                    <div className="h-14 w-14 rounded-full bg-gradient-to-br from-primary to-primary/80 text-white flex items-center justify-center text-lg font-bold shadow-md">
                      {getInitials(member.fullName)}
                    </div>
                    <span
                      className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-background ${
                        member.isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                      {member.fullName}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Shield className="h-3 w-3 text-primary shrink-0" />
                      <p className="text-sm text-muted-foreground">{formatRole(member.role)}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate">{member.email}</span>
                    </div>
                    <p className="text-[10px] font-mono mt-2 uppercase tracking-wider">
                      <span
                        className={
                          member.isOnline
                            ? 'text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full'
                            : 'text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-full'
                        }
                      >
                        {member.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </p>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
