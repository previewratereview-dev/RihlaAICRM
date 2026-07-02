'use client';

import React, { useMemo, useState } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { CRMDatabaseService } from '@/lib/db-service';
import { getInitials } from '@/lib/utils';
import { Search, Users, Shield, Mail } from 'lucide-react';

export function SuperAdminUsersView() {
  const platformUsers = useCRMStore((s) => s.platformUsers);
  const syncData = useCRMStore((s) => s.syncData);
  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [updating, setUpdating] = useState<string | null>(null);

  const tenants = useMemo(() => {
    const ids = new Map<string, string>();
    platformUsers.forEach((u) => ids.set(u.tenantId, u.tenantName));
    return Array.from(ids.entries()).map(([id, name]) => ({ id, name }));
  }, [platformUsers]);

  const filtered = useMemo(() => {
    return platformUsers.filter((u) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.tenantName.toLowerCase().includes(q);
      const matchesTenant = tenantFilter === 'all' || u.tenantId === tenantFilter;
      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      return matchesSearch && matchesTenant && matchesRole;
    });
  }, [platformUsers, search, tenantFilter, roleFilter]);

  const handleRoleChange = async (userId: string, role: string) => {
    setUpdating(userId);
    try {
      await CRMDatabaseService.updateTeamMember(userId, { role: role as typeof platformUsers[0]['role'] });
      await syncData();
    } finally {
      setUpdating(null);
    }
  };

  const handleDeactivate = async (userId: string, current: string | undefined) => {
    setUpdating(userId);
    try {
      await CRMDatabaseService.updateTeamMember(userId, {
        status: current === 'deactivated' ? 'active' : 'deactivated',
      });
      await syncData();
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Global User Directory
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {platformUsers.length} users across {tenants.length} agencies
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, agency..."
              className="w-full h-10 pl-9 pr-4 rounded-xl border border-input text-sm"
            />
          </div>
          <select
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="h-10 px-3 rounded-xl border border-input text-sm"
          >
            <option value="all">All agencies</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-10 px-3 rounded-xl border border-input text-sm"
          >
            <option value="all">All roles</option>
            {['super_admin', 'admin', 'manager', 'consultant', 'specialist', 'setter'].map((r) => (
              <option key={r} value={r}>{r.replace('_', ' ')}</option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl bg-card/80 border border-border/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-secondary/20">
                  <th className="text-left p-4 font-semibold">User</th>
                  <th className="text-left p-4 font-semibold">Agency</th>
                  <th className="text-left p-4 font-semibold">Role</th>
                  <th className="text-left p-4 font-semibold">Status</th>
                  <th className="text-right p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((user) => (
                  <tr key={user.id} className="hover:bg-secondary/20">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                          {getInitials(user.fullName)}
                        </div>
                        <div>
                          <p className="font-semibold">{user.fullName}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />{user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-muted-foreground">{user.tenantName}</td>
                    <td className="p-4">
                      <select
                        value={user.role}
                        disabled={updating === user.id || user.role === 'super_admin'}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        className="h-8 px-2 rounded-lg border border-input text-xs capitalize"
                      >
                        {['admin', 'manager', 'consultant', 'specialist', 'setter', 'member'].map((r) => (
                          <option key={r} value={r}>{r.replace('_', ' ')}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        user.status === 'deactivated'
                          ? 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'
                          : user.isOnline
                          ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
                          : 'bg-secondary text-muted-foreground'
                      }`}>
                        {user.status === 'deactivated' ? 'deactivated' : user.isOnline ? 'online' : 'offline'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      {user.role !== 'super_admin' && (
                        <button
                          disabled={updating === user.id}
                          onClick={() => handleDeactivate(user.id, user.status)}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          {user.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <p className="p-8 text-center text-muted-foreground">No users match your filters.</p>
          )}
        </div>

        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Shield className="h-3 w-3" />
          Role changes apply immediately. Deactivated users cannot log in.
        </p>
      </div>
    </div>
  );
}
