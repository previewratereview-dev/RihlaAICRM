'use client';

import React, { useState } from 'react';
import { Users as UsersIcon, UserPlus, Pencil, Trash2, Shield } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { CRMDatabaseService } from '@/lib/db-service';
import { can } from '@/lib/permissions';
import type { User } from '@/types';

const emptyUser = (): Omit<User, 'id'> & { password?: string } => ({
  fullName: '',
  email: '',
  role: 'specialist',
  tenantId: '',
  phone: '',
  isOnline: false,
  avatarUrl: '',
  password: '',
});

export function AdminUserManagement() {
  const currentUser = useCRMStore((state) => state.currentUser);
  const users = useCRMStore((state) => state.team);
  const syncData = useCRMStore((state) => state.syncData);

  const [form, setForm] = useState(emptyUser());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!can(currentUser?.role ?? 'viewer', 'settings:users:write')) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!form.email || !form.fullName) {
      setError('Name and email are required.');
      return;
    }

    setSaving(true);

    try {
      const newUser: User = {
        id: editingId || `user-${Date.now()}`,
        fullName: form.fullName,
        email: form.email,
        role: form.role,
        tenantId: currentUser?.tenantId || '',
        phone: form.phone || '',
        avatarUrl: form.avatarUrl || '',
        isOnline: false,
      };

      await CRMDatabaseService.createTeamMember(newUser, form.password);

      setSuccess(editingId ? 'User updated.' : 'User added.');
      setForm(emptyUser());
      setEditingId(null);
      await syncData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save user.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (user: User) => {
    setEditingId(user.id);
    setForm({
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      phone: user.phone || '',
      avatarUrl: user.avatarUrl || '',
      isOnline: user.isOnline,
    });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this user?')) return;
    setError(null);
    setSuccess(null);
    try {
      await CRMDatabaseService.deleteTeamMember(id);
      setSuccess('User removed.');
      await syncData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove user.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <UsersIcon className="h-5 w-5 text-primary" />
        <h2 className="text-base font-bold text-foreground font-heading">User Management</h2>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-xs">{error}</div>}
      {success && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs">{success}</div>}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Full Name</label>
          <input
            className="h-10 rounded-xl bg-background border border-input px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
            value={form.fullName}
            onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
            placeholder="Full Name"
            required
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Email</label>
          <input
            className="h-10 rounded-xl bg-background border border-input px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="user@company.com"
            required
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Role</label>
          <select
            className="h-10 rounded-xl bg-background border border-input px-3 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
            value={form.role}
            onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as User['role'] }))}
          >
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="specialist">Specialist</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Phone</label>
          <input
            className="h-10 rounded-xl bg-background border border-input px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder="+1 555-0100"
          />
        </div>

        <div className="md:col-span-2 flex flex-col gap-1">
          <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Password</label>
          <input
            className="h-10 rounded-xl bg-background border border-input px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
            type="password"
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
            placeholder={editingId ? 'Leave blank to keep existing' : 'Initial password'}
          />
        </div>

        <div className="md:col-span-2 flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary/90 disabled:bg-primary/40 text-primary-foreground font-semibold transition-all cursor-pointer inline-flex items-center gap-2"
          >
            {editingId ? <Pencil className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {editingId ? 'Update User' : 'Add User'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyUser());
              }}
              className="h-10 px-4 rounded-xl bg-background border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/30 font-semibold transition-all cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="mt-6 rounded-2xl bg-card/80 border border-border/60 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border/60 flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground font-heading">Existing Users</h3>
        </div>
        <div className="divide-y divide-border/60">
          {users.map((user) => (
            <div key={user.id} className="flex items-center justify-between p-4">
              <div>
                <div className="text-sm font-semibold text-foreground">{user.fullName}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
                <div className="text-[10px] font-mono text-muted-foreground mt-1 uppercase">{user.role}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleEdit(user)}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border/60 hover:border-primary/40 bg-card/80 text-foreground transition-colors cursor-pointer"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(user.id)}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border/60 hover:border-red-300 bg-card/80 text-red-600 transition-colors cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground">No users found.</div>
          )}
        </div>
      </div>
    </div>
  );
}