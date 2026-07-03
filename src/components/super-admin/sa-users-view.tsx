'use client';

import React, { useMemo, useState } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { CRMDatabaseService } from '@/lib/db-service';
import { getInitials } from '@/lib/utils';
import { Search, Users, Shield, Mail, Plus, Trash2, KeyRound } from 'lucide-react';
import { logger } from '@/lib/logger';

export function SuperAdminUsersView() {
  const platformUsers = useCRMStore((s) => s.platformUsers);
  const tenants = useCRMStore((s) => s.tenants);
  const syncData = useCRMStore((s) => s.syncData);
  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [updating, setUpdating] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createRole, setCreateRole] = useState('admin');
  const [createTenantId, setCreateTenantId] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [resetTarget, setResetTarget] = useState<{ id: string; email: string; name: string } | null>(null);

  const tenantList = useMemo(() => {
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

  const handleCreate = async () => {
    if (!createEmail.trim() || !createName.trim() || !createTenantId) return;
    setSaving(true);
    try {
      await CRMDatabaseService.createUser({
        email: createEmail.trim(),
        fullName: createName.trim(),
        role: createRole,
        tenantId: createTenantId,
      });
      setShowCreate(false);
      setCreateName('');
      setCreateEmail('');
      setCreateRole('admin');
      setCreateTenantId('');
      await syncData();
    } catch (e) {
      logger.error('Failed to create user', e);
      alert('Failed to create user.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await CRMDatabaseService.deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      await syncData();
    } catch (e) {
      logger.error('Failed to delete user', e);
      alert('Failed to delete user.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setSaving(true);
    try {
      await CRMDatabaseService.resetUserPassword(resetTarget.email);
      setResetTarget(null);
      alert('Password reset email sent.');
    } catch (e) {
      logger.error('Failed to reset password', e);
      alert('Failed to send password reset.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              Global User Directory
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {platformUsers.length} users across {tenantList.length} agencies
            </p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setCreateName(''); setCreateEmail(''); setCreateRole('admin'); setCreateTenantId(tenants[0]?.id || ''); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
          >
            <Plus className="h-4 w-4" />
            New User
          </button>
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
            {tenantList.map((t) => (
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
                        disabled={updating === user.id}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        className="h-8 px-2 rounded-lg border border-input text-xs capitalize"
                      >
                        {['super_admin', 'admin', 'manager', 'consultant', 'specialist', 'viewer'].map((r) => (
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
                      <div className="flex items-center justify-end gap-2">
                        <button
                          disabled={updating === user.id}
                          onClick={() => handleDeactivate(user.id, user.status)}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          {user.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                        </button>
                        <button
                          onClick={() => setResetTarget({ id: user.id, email: user.email, name: user.fullName })}
                          className="text-xs font-semibold text-amber-600 hover:underline flex items-center gap-1"
                        >
                          <KeyRound className="h-3 w-3" /> Reset
                        </button>
                        <button
                          onClick={() => setDeleteTarget({ id: user.id, name: user.fullName })}
                          className="text-xs font-semibold text-red-600 hover:underline flex items-center gap-1"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
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

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <h3 className="font-bold text-lg">Create User</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Full Name</label>
                <input value={createName} onChange={(e) => setCreateName(e.target.value)} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Email</label>
                <input type="email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Agency</label>
                <select value={createTenantId} onChange={(e) => setCreateTenantId(e.target.value)} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm">
                  <option value="">Select agency...</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Role</label>
                <select value={createRole} onChange={(e) => setCreateRole(e.target.value)} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm">
                  {['admin', 'manager', 'consultant', 'specialist', 'viewer'].map((r) => (
                    <option key={r} value={r}>{r.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 h-10 rounded-xl border text-sm">Cancel</button>
              <button onClick={handleCreate} disabled={saving || !createEmail.trim() || !createName.trim() || !createTenantId} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-semibold">
                {saving ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Delete User</h3>
                <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm">Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 h-10 rounded-xl border text-sm">Cancel</button>
              <button onClick={handleDelete} disabled={saving} className="flex-1 h-10 rounded-xl bg-red-600 text-white text-sm font-semibold">
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
                <KeyRound className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Reset Password</h3>
                <p className="text-sm text-muted-foreground">Send a password reset email.</p>
              </div>
            </div>
            <p className="text-sm">Send a password reset link to <strong>{resetTarget.email}</strong> ({resetTarget.name})?</p>
            <div className="flex gap-2">
              <button onClick={() => setResetTarget(null)} className="flex-1 h-10 rounded-xl border text-sm">Cancel</button>
              <button onClick={handleResetPassword} disabled={saving} className="flex-1 h-10 rounded-xl bg-amber-600 text-white text-sm font-semibold">
                {saving ? 'Sending...' : 'Send Reset Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
