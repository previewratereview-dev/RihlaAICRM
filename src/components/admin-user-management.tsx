'use client';

import React, { useState } from 'react';
import { Users as UsersIcon, UserPlus, Pencil, Trash2, Shield } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { CRMDatabaseService } from '@/lib/db-service';
import { createClient } from '@/lib/supabase/client';
import { can } from '@/lib/permissions';
import type { User } from '@/types';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (!can(currentUser?.role ?? 'viewer', 'settings:users:write')) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!form.email || !form.fullName) {
      setError('Name and email are required.');
      return;
    }
    if (!editingId && !form.password) {
      setError('Password is required for new users.');
      return;
    }

    setSaving(true);

    try {
      // Get the current session token to authenticate the API call
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated.');

      if (editingId) {
        // Edit: update profile fields only (no auth user changes needed)
        await CRMDatabaseService.updateTeamMember(editingId, {
          fullName: form.fullName,
          role: form.role,
          phone: form.phone,
        });
      } else {
        // Create: use server API so Supabase admin creates the auth user properly
        const res = await fetch('/api/team/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            fullName: form.fullName,
            email: form.email,
            role: form.role,
            phone: form.phone,
            password: form.password,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? 'Failed to create user.');
        }
      }

      setSuccess(editingId ? 'User updated.' : 'User added successfully.');
      await syncData();

      // Close modal on success after a brief delay
      setTimeout(() => {
        setIsModalOpen(false);
        setForm(emptyUser());
        setEditingId(null);
        setSuccess(null);
      }, 600);

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
    setError(null);
    setSuccess(null);
    setIsModalOpen(true);
  };

  const handleAddClick = () => {
    setEditingId(null);
    setForm(emptyUser());
    setError(null);
    setSuccess(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this user from your agency? This cannot be undone.')) return;
    setError(null);
    setSuccess(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated.');

      const res = await fetch(`/api/team/users?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to remove user.');
      }
      setSuccess('User removed.');
      await syncData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove user.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold text-foreground font-heading">User Management</h2>
        </div>
        
        <button
          onClick={handleAddClick}
          className="h-9 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all cursor-pointer inline-flex items-center gap-2 text-sm shadow-sm"
        >
          <UserPlus className="h-4 w-4" />
          Add User
        </button>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit User' : 'Add New User'}</DialogTitle>
              <DialogDescription>
                {editingId ? 'Update user details.' : 'Add a new member to your team.'}
              </DialogDescription>
            </DialogHeader>
            
            {error && <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-xs">{error}</div>}
            {success && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs">{success}</div>}

            <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Full Name</label>
                <input
                  className="h-10 rounded-xl bg-background border border-input px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  value={form.fullName}
                  onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
                  placeholder="Full Name"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Email</label>
                <input
                  className="h-10 rounded-xl bg-background border border-input px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="user@company.com"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Role</label>
                <select
                  className="h-10 rounded-xl bg-background border border-input px-3 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  value={form.role}
                  onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as User['role'] }))}
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="consultant">Consultant</option>
                  <option value="specialist">Specialist</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Phone</label>
                <input
                  className="h-10 rounded-xl bg-background border border-input px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="+1 555-0100"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Password</label>
                <input
                  className="h-10 rounded-xl bg-background border border-input px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder={editingId ? 'Leave blank to keep existing' : 'Initial password'}
                  required={!editingId}
                />
              </div>

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="h-10 px-4 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground font-semibold transition-all cursor-pointer text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-10 px-4 rounded-xl bg-primary hover:bg-primary/90 disabled:bg-primary/40 text-primary-foreground font-semibold transition-all cursor-pointer inline-flex items-center gap-2 text-sm"
                >
                  {saving ? 'Saving...' : editingId ? 'Update User' : 'Add User'}
                </button>
              </div>
            </form>
          </DialogContent>
      </Dialog>

      <div className="rounded-2xl bg-card/80 border border-border/60 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border/60 flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground font-heading">Existing Users</h3>
        </div>
        <div className="divide-y divide-border/60">
          {users.map((user) => (
            <div key={user.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
              <div>
                <div className="text-sm font-semibold text-foreground">{user.fullName}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
                <div className="text-[10px] font-mono text-muted-foreground mt-1 uppercase">{user.role}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleEdit(user)}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border/60 hover:border-primary/40 bg-card/80 text-foreground transition-colors cursor-pointer shadow-sm"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(user.id)}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border/60 hover:border-red-300 bg-card/80 text-red-600 transition-colors cursor-pointer shadow-sm"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No users found. Click &apos;Add User&apos; to invite a team member.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}