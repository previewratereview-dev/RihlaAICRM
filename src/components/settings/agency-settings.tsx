// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Palette, Database, Download } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { toast } from 'sonner';
import { UnsavedChangesBar } from './unsaved-changes-bar';

import { SettingsGroup } from './settings-group';
import { SettingsRow } from './settings-row';

export function AgencySettings() {
  const settings = useCRMStore(s => s.settings);
  const updateSettings = useCRMStore(s => s.updateSettings);
  
  const [agencyName, setAgencyName] = useState(settings.agencyName || '');
  const [logoText, setLogoText] = useState(settings.logoText || '');
  const [accentColor, setAccentColor] = useState(settings.accentColor || '#FF6B35');
  const [dailyTarget, setDailyTarget] = useState(settings.dailyTargetScore || 50);
  
  const [saving, setSaving] = useState(false);
  const [exportingGdpr, setExportingGdpr] = useState(false);

  // Check if there are unsaved changes
  const hasChanges = 
    agencyName !== (settings.agencyName || '') ||
    logoText !== (settings.logoText || '') ||
    accentColor !== (settings.accentColor || '#FF6B35') ||
    dailyTarget !== (settings.dailyTargetScore || 50);

  const [prevSettings, setPrevSettings] = useState(settings);
  if (prevSettings !== settings) {
    setPrevSettings(settings);
    if (!hasChanges) {
      setAgencyName(settings.agencyName || '');
      setLogoText(settings.logoText || '');
      setAccentColor(settings.accentColor || '#FF6B35');
      setDailyTarget(settings.dailyTargetScore || 50);
    }
  }

  const handleExportGdpr = async () => {
    setExportingGdpr(true);
    try {
      const res = await fetch('/api/gdpr/export');
      if (!res.ok) throw new Error('Export failed');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gdpr_tenant_export_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('GDPR data archive exported successfully.');
    } catch {
      toast.error('Failed to export GDPR data archive.');
    } finally {
      setExportingGdpr(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = {
        agencyName,
        logoText,
        accentColor,
        dailyTargetScore: dailyTarget
      };
      
      await updateSettings(updates);
      
      // Special handling for accent color to update CSS variable immediately
      if (typeof updates.accentColor === 'string' && updates.accentColor.startsWith('#')) {
        const color = updates.accentColor;
        document.documentElement.style.setProperty('--primary', color);
        useCRMStore.setState((s) => ({
          tenantBranding: { ...s.tenantBranding, primaryColor: color },
        }));
      }
      
      toast.success('Agency settings saved successfully');
    } catch {
      toast.error('Failed to save agency settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setAgencyName(settings.agencyName || '');
    setLogoText(settings.logoText || '');
    setAccentColor(settings.accentColor || '#FF6B35');
    setDailyTarget(settings.dailyTargetScore || 50);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <SettingsGroup title="Brand Identity" description="Manage your agency profile and branding across the CRM.">
        <SettingsRow 
          label="Agency Name" 
          description="The public name of your agency displayed to customers."
        >
          <Input 
            value={agencyName} 
            onChange={e => setAgencyName(e.target.value)} 
            placeholder="e.g. Acme Corp" 
            className="w-full"
          />
        </SettingsRow>

        <SettingsRow 
          label="Logo Text" 
          description="Text displayed when an image logo is not available."
        >
          <Input 
            value={logoText} 
            onChange={e => setLogoText(e.target.value)} 
            placeholder="e.g. ACME" 
            className="w-full"
          />
        </SettingsRow>

        <SettingsRow 
          label="Accent Color" 
          description="Primary color used across the CRM interface."
        >
          <div className="flex gap-3 w-full">
            <input 
              type="color" 
              value={accentColor} 
              onChange={e => setAccentColor(e.target.value)} 
              className="h-10 w-14 rounded cursor-pointer border border-border bg-background shrink-0"
            />
            <Input 
              value={accentColor} 
              onChange={e => setAccentColor(e.target.value)} 
              className="font-mono uppercase w-full" 
            />
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Gamification" description="Set targets for your team's daily activities.">
        <SettingsRow 
          label="Daily Target Score" 
          description="The goal score each agent should reach per day through positive actions."
        >
          <Input 
            type="number"
            value={dailyTarget} 
            onChange={e => setDailyTarget(Number(e.target.value))} 
            min={1}
            className="w-full"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Data & Privacy" description="Manage your workspace data and compliance.">
        <SettingsRow 
          label="GDPR Data Portability" 
          description="Download a complete structured JSON archive of your workspace data including leads, notes, tasks, and communications for compliance purposes."
          action={
            <button onClick={handleExportGdpr} disabled={exportingGdpr} className="w-full md:w-auto cursor-pointer inline-flex justify-center items-center gap-2 h-9 px-4 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-all whitespace-nowrap">
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              {exportingGdpr ? 'Exporting...' : 'Export Data'}
            </button>
          }
        >
          <div className="hidden md:block text-sm text-muted-foreground">Export format: JSON archive</div>
        </SettingsRow>
      </SettingsGroup>

      <UnsavedChangesBar 
        show={hasChanges} 
        onSave={handleSave} 
        onDiscard={handleDiscard} 
        isSaving={saving} 
      />
    </div>
  );
}
