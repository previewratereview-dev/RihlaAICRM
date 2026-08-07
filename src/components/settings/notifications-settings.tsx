// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Bell, Phone, MessageCircle } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { toast } from 'sonner';
import { UnsavedChangesBar } from './unsaved-changes-bar';

import { SettingsGroup } from './settings-group';
import { SettingsRow } from './settings-row';

export function NotificationsSettings() {
  const settings = useCRMStore(s => s.settings);
  const updateSettings = useCRMStore(s => s.updateSettings);
  
  const [adminPhone, setAdminPhone] = useState(settings.adminNotificationPhone || '');
  const [adminEmail, setAdminEmail] = useState(settings.adminNotificationEmail || '');
  const [saving, setSaving] = useState(false);

  const hasChanges = 
    adminPhone !== (settings.adminNotificationPhone || '') ||
    adminEmail !== (settings.adminNotificationEmail || '');

  const [prevSettings, setPrevSettings] = useState(settings);
  if (prevSettings !== settings) {
    setPrevSettings(settings);
    if (!hasChanges) {
      setAdminPhone(settings.adminNotificationPhone || '');
      setAdminEmail(settings.adminNotificationEmail || '');
    }
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({ 
        adminNotificationPhone: adminPhone, 
        adminNotificationEmail: adminEmail 
      });
      toast.success('Notification settings saved successfully');
    } catch {
      toast.error('Failed to save notification settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setAdminPhone(settings.adminNotificationPhone || '');
    setAdminEmail(settings.adminNotificationEmail || '');
  };

  const toggleAutomation = async (key: 'whatsappAutomation' | 'smsAutomation', current: boolean) => {
    try {
      await updateSettings({ [key]: !current });
      toast.success('Automation rule updated');
    } catch {
      toast.error('Failed to update automation');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <SettingsGroup title="AI Escalation Alerts" description="Where should the AI ping you when it needs human approval.">
        <SettingsRow 
          label="Admin Phone" 
          description="Used for SMS/WhatsApp escalations."
        >
          <Input 
            value={adminPhone} 
            onChange={e => setAdminPhone(e.target.value)} 
            placeholder="+1234567890" 
            className="w-full"
          />
        </SettingsRow>

        <SettingsRow 
          label="Admin Email" 
          description="Used for email escalations."
        >
          <Input 
            type="email"
            value={adminEmail} 
            onChange={e => setAdminEmail(e.target.value)} 
            placeholder="admin@agency.com" 
            className="w-full"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Status Automations" description="Automated SMS and WhatsApp notifications sent to leads.">
        <SettingsRow 
          label="WhatsApp Automation" 
          description="Send automated status updates via WhatsApp."
          action={
            <div className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 cursor-pointer" 
                 style={{ backgroundColor: settings.whatsappAutomation ? 'hsl(var(--primary))' : 'hsl(var(--input))' }}
                 onClick={() => toggleAutomation('whatsappAutomation', settings.whatsappAutomation ?? false)}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-sm ${settings.whatsappAutomation ? 'translate-x-6' : 'translate-x-1'}`} />
            </div>
          }
        >
          <div className="hidden md:block text-sm text-muted-foreground">Enabled via Twilio API</div>
        </SettingsRow>

        <SettingsRow 
          label="SMS Automation" 
          description="Send automated status updates via SMS."
          action={
            <div className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 cursor-pointer" 
                 style={{ backgroundColor: settings.smsAutomation ? 'hsl(var(--primary))' : 'hsl(var(--input))' }}
                 onClick={() => toggleAutomation('smsAutomation', settings.smsAutomation ?? false)}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-sm ${settings.smsAutomation ? 'translate-x-6' : 'translate-x-1'}`} />
            </div>
          }
        >
          <div className="hidden md:block text-sm text-muted-foreground">Enabled via Twilio API</div>
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
