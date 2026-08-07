import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { User, Lock, Mail } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { toast } from 'sonner';
import { UnsavedChangesBar } from './unsaved-changes-bar';

import { SettingsGroup } from './settings-group';
import { SettingsRow } from './settings-row';

export function ProfileSettings() {
  const currentUser = useCRMStore(s => s.currentUser);
  const updatePassword = useCRMStore(s => s.updatePassword);
  
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const hasChanges = newPassword.length > 0 || confirmPassword.length > 0;

  const handlePasswordChange = async () => {
    if (!currentUser) return;
    
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    
    setSaving(true);
    try {
      await updatePassword(currentUser.id, newPassword);
      toast.success('Password updated successfully.');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      toast.error('Password update failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <SettingsGroup title="Account Info" description="Basic account details and role.">
        <div className="flex items-center gap-4 p-5">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground text-2xl font-bold shadow-lg shadow-primary/20 shrink-0">
            {currentUser?.fullName?.charAt(0) || 'U'}
          </div>
          <div>
            <h3 className="text-xl font-bold">{currentUser?.fullName}</h3>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
              <Mail className="h-3.5 w-3.5" /> {currentUser?.email}
            </p>
            <span className="inline-block mt-2 px-2.5 py-1 rounded-md bg-muted text-xs font-bold uppercase tracking-wider">
              Role: {currentUser?.role?.replace('_', ' ')}
            </span>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Security" description="Manage your password and security settings.">
        <SettingsRow 
          label="New Password" 
          description="Must be at least 6 characters long."
        >
          <Input 
            type="password"
            value={newPassword} 
            onChange={e => setNewPassword(e.target.value)} 
            className="w-full"
            placeholder="Enter new password"
          />
        </SettingsRow>
        
        <SettingsRow 
          label="Confirm Password" 
          description="Re-type your new password to verify."
        >
          <Input 
            type="password"
            value={confirmPassword} 
            onChange={e => setConfirmPassword(e.target.value)} 
            className="w-full"
            placeholder="Confirm new password"
          />
        </SettingsRow>
      </SettingsGroup>

      <UnsavedChangesBar 
        show={hasChanges} 
        onSave={handlePasswordChange} 
        onDiscard={handleDiscard} 
        isSaving={saving} 
      />
    </div>
  );
}
