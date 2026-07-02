'use client';

import React, { useEffect, useState } from 'react';
import { CRMDatabaseService } from '@/lib/db-service';
import { motion } from 'framer-motion';
import { Settings, Save, AlertTriangle, Globe, Mail, Shield, Cpu } from 'lucide-react';

export function SuperAdminSettingsView() {
  const [form, setForm] = useState({
    defaultAiModel: 'gpt-4o-mini',
    platformMonthlyAiCap: 500,
    maintenanceMode: false,
    allowNewTenants: true,
    defaultAiBudget: 100,
    supportEmail: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    CRMDatabaseService.getPlatformSettings().then((s) => {
      const extra = (s.settings as Record<string, unknown>) || {};
      setForm({
        defaultAiModel: String(s.defaultAiModel || 'gpt-4o-mini'),
        platformMonthlyAiCap: Number(s.platformMonthlyAiCap) || 500,
        maintenanceMode: Boolean(s.maintenanceMode),
        allowNewTenants: extra.allowNewTenants !== false,
        defaultAiBudget: Number(extra.defaultAiBudget) || 100,
        supportEmail: String(extra.supportEmail || ''),
      });
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await CRMDatabaseService.updatePlatformSettings({
        defaultAiModel: form.defaultAiModel,
        platformMonthlyAiCap: form.platformMonthlyAiCap,
        maintenanceMode: form.maintenanceMode,
        settings: {
          allowNewTenants: form.allowNewTenants,
          defaultAiBudget: form.defaultAiBudget,
          supportEmail: form.supportEmail,
        },
      });
      setMessage('Platform settings saved.');
    } catch {
      setMessage('Failed to save platform settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6 text-primary" />
            Platform Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Global defaults and operational controls.</p>
        </div>

        {message && (
          <div className="p-3 rounded-xl bg-primary/10 text-primary text-sm border border-primary/20">{message}</div>
        )}

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <section className="p-6 rounded-2xl bg-card/80 border border-border/60 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Cpu className="h-4 w-4 text-primary" /> AI Defaults</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Default AI Model</label>
                <select
                  value={form.defaultAiModel}
                  onChange={(e) => setForm({ ...form, defaultAiModel: e.target.value })}
                  className="mt-1 w-full h-10 rounded-xl border px-3 text-sm"
                >
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Platform Monthly AI Cap ($)</label>
                <input type="number" value={form.platformMonthlyAiCap} onChange={(e) => setForm({ ...form, platformMonthlyAiCap: Number(e.target.value) })} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Default Agency AI Budget ($/mo)</label>
                <input type="number" value={form.defaultAiBudget} onChange={(e) => setForm({ ...form, defaultAiBudget: Number(e.target.value) })} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm" />
              </div>
            </div>
          </section>

          <section className="p-6 rounded-2xl bg-card/80 border border-border/60 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Globe className="h-4 w-4 text-primary" /> Platform Access</h3>
            <label className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-950 dark:border-amber-800 cursor-pointer">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold">Maintenance Mode</p>
                <p className="text-xs text-muted-foreground">Blocks non-admin logins platform-wide</p>
              </div>
              <input type="checkbox" checked={form.maintenanceMode} onChange={(e) => setForm({ ...form, maintenanceMode: e.target.checked })} className="h-4 w-4 accent-primary" />
            </label>
            <label className="flex items-center gap-3 p-4 rounded-xl border border-border/60 cursor-pointer">
              <Shield className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold">Allow New Agency Signups</p>
                <p className="text-xs text-muted-foreground">When disabled, only super admins can create agencies</p>
              </div>
              <input type="checkbox" checked={form.allowNewTenants} onChange={(e) => setForm({ ...form, allowNewTenants: e.target.checked })} className="h-4 w-4 accent-primary" />
            </label>
          </section>

          <section className="p-6 rounded-2xl bg-card/80 border border-border/60 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /> Support</h3>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Platform Support Email</label>
              <input
                type="email"
                value={form.supportEmail}
                onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                placeholder="support@yourplatform.com"
                className="mt-1 w-full h-10 rounded-xl border px-3 text-sm"
              />
            </div>
          </section>

          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
            <Save className="h-4 w-4" />
            Save Platform Settings
          </button>
        </motion.div>
      </div>
    </div>
  );
}
