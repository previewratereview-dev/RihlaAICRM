'use client';

import React, { useMemo, useState } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Building2, Power, PowerOff, Plus, Search, Pencil, Users, TrendingUp, Cpu, MessageSquare, Eye, Trash2, Crown } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { logger } from '@/lib/logger';
import type { TenantFeatureFlags } from '@/types';

interface TenantModalProps {
  title: string;
  onSave: () => void;
  onClose: () => void;
  name: string;
  setName: (v: string) => void;
  slug: string;
  setSlug: (v: string) => void;
  domain: string;
  setDomain: (v: string) => void;
  primaryColor: string;
  setPrimaryColor: (v: string) => void;
  customPrompt: string;
  setCustomPrompt: (v: string) => void;
  aiBudget: number;
  setAiBudget: (v: number) => void;
  features: TenantFeatureFlags;
  setFeatures: (v: TenantFeatureFlags) => void;
  saving: boolean;
  editTenant: unknown;
  plan: string;
  setPlan: (v: string) => void;
  adminEmail: string;
  setAdminEmail: (v: string) => void;
  adminPassword: string;
  setAdminPassword: (v: string) => void;
  showAdminFields: boolean;
}

function TenantModal({ title, onSave, onClose, name, setName, slug, setSlug, domain, setDomain, primaryColor, setPrimaryColor, customPrompt, setCustomPrompt, aiBudget, setAiBudget, features, setFeatures, saving, editTenant, plan, setPlan, adminEmail, setAdminEmail, adminPassword, setAdminPassword, showAdminFields }: TenantModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-background rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-xl my-8">
        <h3 className="font-bold text-lg">{title}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-mono uppercase text-muted-foreground">Agency Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm" />
          </div>
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Slug</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!!editTenant} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm disabled:opacity-50" />
          </div>
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Domain</label>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="agency.example.com" className="mt-1 w-full h-10 rounded-xl border px-3 text-sm" />
          </div>
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Brand Color</label>
            <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="mt-1 w-full h-10 rounded-xl border" />
          </div>
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">AI Budget ($/mo)</label>
            <input type="number" value={aiBudget} onChange={(e) => setAiBudget(Number(e.target.value))} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-mono uppercase text-muted-foreground">Subscription Plan</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm">
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="premium">Premium</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs font-mono uppercase text-muted-foreground">Custom AI Prompt</label>
            <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border p-3 text-sm resize-none" />
          </div>
        </div>
        <div>
          <p className="text-xs font-mono uppercase text-muted-foreground mb-2">Feature Flags</p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(features) as (keyof TenantFeatureFlags)[]).map((key) => (
              <label key={key} className="flex items-center gap-2 p-2 rounded-lg border text-sm capitalize cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!features[key]}
                  onChange={(e) => setFeatures({ ...features, [key]: e.target.checked })}
                  className="accent-primary"
                />
                {key}
              </label>
            ))}
          </div>
        </div>
        {showAdminFields && (
          <div className="border-t border-border/50 pt-4">
            <p className="text-xs font-mono uppercase text-muted-foreground mb-2">First Admin User</p>
            <div className="space-y-2">
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@agency.com"
                className="w-full h-10 rounded-xl border px-3 text-sm"
              />
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Password (min 8 characters)"
                className="w-full h-10 rounded-xl border px-3 text-sm"
              />
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border text-sm">Cancel</button>
          <button onClick={onSave} disabled={saving} className="flex-1 h-10 rounded-xl border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ name, onConfirm, onCancel, saving }: { name: string; onConfirm: () => void; onCancel: () => void; saving: boolean }) {
  const [confirmText, setConfirmText] = useState('');
  const canDelete = confirmText === name;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
            <Trash2 className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-bold text-lg">Delete Agency</h3>
            <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
          </div>
        </div>
        <p className="text-sm">
          Type <strong>{name}</strong> to confirm deletion. All data including leads, tasks, conversations, and users will be permanently removed.
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={`Type "${name}" to confirm`}
          className="w-full h-10 rounded-xl border px-3 text-sm"
        />
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 h-10 rounded-xl border text-sm">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={!canDelete || saving}
            className="flex-1 h-10 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Deleting...' : 'Delete Permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SuperAdminTenantsView() {
  const tenantsWithStats = useCRMStore((state) => state.tenantsWithStats);
  const syncData = useCRMStore((state) => state.syncData);
  const setImpersonateTenant = useCRMStore((state) => state.setImpersonateTenant);
  const setActiveTab = useCRMStore((state) => state.setActiveTab);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editTenant, setEditTenant] = useState<(typeof tenantsWithStats)[0] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<(typeof tenantsWithStats)[0] | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [domain, setDomain] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#FF6B35');
  const [customPrompt, setCustomPrompt] = useState('');
  const [aiBudget, setAiBudget] = useState(100);
  const [plan, setPlan] = useState('free');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [features, setFeatures] = useState<TenantFeatureFlags>({
    pipeline: true,
    chatbot: true,
    analytics: true,
    payments: false,
    email: true,
    whatsapp: true,
  });
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    return tenantsWithStats.filter((t) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.domain || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [tenantsWithStats, search, statusFilter]);

  const openEdit = (tenant: (typeof tenantsWithStats)[0]) => {
    setEditTenant(tenant);
    setName(tenant.name);
    setSlug(tenant.slug);
    setDomain(tenant.domain || '');
    setPrimaryColor(tenant.primaryColor || '#FF6B35');
    setCustomPrompt(tenant.customPrompt || '');
    setAiBudget((tenant.settings?.aiBudget as number) || 100);
    setPlan(tenant.plan || 'free');
    const tenantFeatures = (tenant.settings?.features || {}) as Record<string, boolean>;
    setFeatures({
      pipeline: tenantFeatures.pipeline !== false,
      chatbot: tenantFeatures.chatbot !== false,
      analytics: tenantFeatures.analytics !== false,
      payments: tenantFeatures.payments === true,
      email: tenantFeatures.email !== false,
      whatsapp: tenantFeatures.whatsapp !== false,
    });
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agencies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update agency status');
      }
      await syncData();
    } catch (e) {
      logger.error('Failed to update agency status', e);
      alert(e instanceof Error ? e.message : 'Failed to update status.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agencies/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete agency');
      }
      setDeleteTarget(null);
      await syncData();
    } catch (e) {
      logger.error('Failed to delete agency', e);
      alert(e instanceof Error ? e.message : 'Failed to delete agency.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim()) return;
    setSaving(true);
    try {
      const id = slug.trim().toLowerCase().replace(/\s+/g, '-');
      const res = await fetch('/api/platform/agencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: id,
          domain: domain.trim() || undefined,
          plan,
          aiBudget,
          features,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create agency');
      }
      setShowCreate(false);
      setName('');
      setSlug('');
      setDomain('');
      setAdminEmail('');
      setAdminPassword('');
      await syncData();
    } catch (e) {
      logger.error('Tenant operation failed', e);
      alert(e instanceof Error ? e.message : 'Failed to create agency.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editTenant) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agencies/${editTenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          domain: domain.trim() || undefined,
          primaryColor,
          customPrompt: customPrompt || undefined,
          plan,
          aiBudget,
          features,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save agency');
      }
      setEditTenant(null);
      await syncData();
    } catch (e) {
      logger.error('Tenant operation failed', e);
      alert(e instanceof Error ? e.message : 'Failed to save agency.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-none p-6 border-b border-border/50 z-10 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Agency Management</h1>
            <p className="text-sm text-muted-foreground mt-1">Create, configure, and monitor all platform agencies.</p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setName(''); setSlug(''); setDomain(''); setAiBudget(100); setPlan('free'); setAdminEmail(''); setAdminPassword(''); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Agency
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agencies..."
              className="w-full h-10 pl-9 pr-4 rounded-xl border text-sm"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="h-10 px-3 rounded-xl border text-sm">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      {showCreate && (
        <TenantModal
          title="Create Agency"
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
          name={name}
          setName={setName}
          slug={slug}
          setSlug={setSlug}
          domain={domain}
          setDomain={setDomain}
          primaryColor={primaryColor}
          setPrimaryColor={setPrimaryColor}
          customPrompt={customPrompt}
          setCustomPrompt={setCustomPrompt}
          aiBudget={aiBudget}
          setAiBudget={setAiBudget}
          features={features}
          setFeatures={setFeatures}
          saving={saving}
          editTenant={editTenant}
          plan={plan}
          setPlan={setPlan}
          adminEmail={adminEmail}
          setAdminEmail={setAdminEmail}
          adminPassword={adminPassword}
          setAdminPassword={setAdminPassword}
          showAdminFields={true}
        />
      )}
      {editTenant && (
        <TenantModal
          title={`Edit — ${editTenant.name}`}
          onSave={handleSaveEdit}
          onClose={() => setEditTenant(null)}
          name={name}
          setName={setName}
          slug={slug}
          setSlug={setSlug}
          domain={domain}
          setDomain={setDomain}
          primaryColor={primaryColor}
          setPrimaryColor={setPrimaryColor}
          customPrompt={customPrompt}
          setCustomPrompt={setCustomPrompt}
          aiBudget={aiBudget}
          setAiBudget={setAiBudget}
          features={features}
          setFeatures={setFeatures}
          saving={saving}
          editTenant={editTenant}
          plan={plan}
          setPlan={setPlan}
          adminEmail={adminEmail}
          setAdminEmail={setAdminEmail}
          adminPassword={adminPassword}
          setAdminPassword={setAdminPassword}
          showAdminFields={false}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          name={deleteTarget.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          saving={saving}
        />
      )}

      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((tenant) => (
            <div key={tenant.id} className="bg-card border border-border/50 rounded-xl p-5 shadow-sm flex flex-col gap-4">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 border"
                    style={{ backgroundColor: `${tenant.primaryColor || '#FF6B35'}20`, borderColor: `${tenant.primaryColor || '#FF6B35'}40` }}
                  >
                    <Building2 className="w-5 h-5" style={{ color: tenant.primaryColor || '#FF6B35' }} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg leading-tight">{tenant.name}</h3>
                    <p className="text-xs text-muted-foreground">{tenant.slug}{tenant.domain ? ` · ${tenant.domain}` : ''}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded-full border ${tenant.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                  {tenant.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: Users, label: 'Users', value: tenant.stats.userCount },
                  { icon: TrendingUp, label: 'Leads', value: tenant.stats.leadCount },
                  { icon: MessageSquare, label: 'Chats', value: tenant.stats.conversationCount },
                  { icon: Cpu, label: 'AI Spend', value: `$${tenant.stats.aiSpend.toFixed(2)}` },
                ].map((stat) => (
                  <div key={stat.label} className="p-2.5 rounded-lg bg-muted/30 border border-border/40">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                      <stat.icon className="h-3 w-3" />
                      <span className="text-[10px] uppercase font-semibold">{stat.label}</span>
                    </div>
                    <p className="text-sm font-bold">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Crown className="h-3 w-3" />
                <span className="font-semibold uppercase">{tenant.plan || 'free'}</span>
              </div>

              <div className="flex gap-2 mt-auto flex-wrap">
                <button
                  onClick={() => {
                    setImpersonateTenant(tenant.id, tenant.name);
                    setActiveTab('dashboard');
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg border border-primary/30 text-primary hover:bg-primary/5"
                >
                  <Eye className="w-3.5 h-3.5" /> View As
                </button>
                <button
                  onClick={() => openEdit(tenant)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg border hover:bg-secondary/50"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  onClick={() => toggleStatus(tenant.id, tenant.status)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg border ${tenant.status === 'active' ? 'text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950'}`}
                >
                  {tenant.status === 'active' ? <><PowerOff className="w-3.5 h-3.5" /> Suspend</> : <><Power className="w-3.5 h-3.5" /> Activate</>}
                </button>
                <button
                  onClick={() => setDeleteTarget(tenant)}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 text-sm font-medium rounded-lg border text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full">
              <EmptyState
                title="No Agencies Found"
                description="No agencies match your search."
                icon="search"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
