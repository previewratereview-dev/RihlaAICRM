import React, { useState } from 'react';
import { SettingItem } from './setting-item';
import { SettingModal } from './setting-modal';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Cpu, Key, Eye, EyeOff, Sparkles } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { toast } from 'sonner';

const OpenAILogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A6.0651 6.0651 0 0 0 19.0192 19.818a5.9847 5.9847 0 0 0 3.9977-2.9 6.0462 6.0462 0 0 0-.735-7.0969zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.0993 3.8558L12.596 8.3829v-2.3324a.0757.0757 0 0 1 .0332-.0615l3.9278-2.2687a4.4992 4.4992 0 0 1 6.1408 1.6464 4.4708 4.4708 0 0 1 .5346 3.0137l-.1416-.0852-4.7828-2.7582a.7712.7712 0 0 0-.7806 0zM8.5214 3.8614a4.4755 4.4755 0 0 1 2.8764 1.0408l-.1416.0804-4.7783 2.7582a.7948.7948 0 0 0-.3927.6813V15.159l-2.02-1.1686a.071.071 0 0 1-.038-.052V8.3558A4.504 4.504 0 0 1 8.5214 3.8614zM16.144 14.85l-5.8144-3.3543 2.0201-1.1685a.0757.0757 0 0 1 .071 0l4.8303 2.7865a4.504 4.504 0 0 1 1.6455 6.1557 4.485 4.485 0 0 1-2.3655 1.9728V15.526a.7664.7664 0 0 0-.3879-.676zM12 13.9168l-3.238-1.8698L12 10.1772l3.238 1.8698z"/>
  </svg>
);

const AnthropicLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M17.433 3.088h2.646l-6.42 17.824h-2.617L17.433 3.088zm-6.208 8.788-3.527 9.036H5.08L11.5 3.088h2.518l1.455 3.659-4.248 5.129z"/>
  </svg>
);

import { SettingsGroup } from './settings-group';
import { SettingsRow } from './settings-row';

export function AISettings() {
  const settings = useCRMStore(s => s.settings);
  const updateSettings = useCRMStore(s => s.updateSettings);
  
  const [editing, setEditing] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form states
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt || '');
  const [openAiKey, setOpenAiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');

  const handleSave = async (updates: Record<string, unknown>, confirmPassword?: string) => {
    setSaving(true);
    try {
      await updateSettings(updates, confirmPassword);
      toast.success('AI Config updated successfully');
      setEditing(null);
      setPassword('');
    } catch {
      toast.error('Failed to update AI Config or invalid password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <SettingsGroup title="AI System Prompt" description="Customize your assistant's personality and rules.">
        <SettingsRow 
          label="System Prompt" 
          description="The core instructions given to the AI."
          action={
            <button 
              onClick={() => {
                setSystemPrompt(settings.systemPrompt || '');
                setEditing('systemPrompt');
              }}
              className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
            >
              Edit Prompt
            </button>
          }
        >
          <div className="text-sm font-mono text-muted-foreground truncate pr-4">
            {settings.systemPrompt ? (settings.systemPrompt.substring(0, 40) + '...') : 'Not set'}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Bring Your Own Key (BYOK)" description="Bypass platform usage limits by providing your own API keys. Encrypted at rest.">
        <SettingsRow 
          label="Use Platform AI" 
          description="Use default platform AI models and monthly quotas."
          action={
            <Switch
              checked={settings.usePlatformAi}
              onCheckedChange={(checked) => handleSave({ usePlatformAi: checked })}
            />
          }
        >
          <div className="hidden md:block text-sm text-muted-foreground">Enabled by default</div>
        </SettingsRow>

        {!settings.usePlatformAi && (
          <>
            <SettingsRow 
              label="OpenAI API Key" 
              description="Used for GPT models and embeddings."
              action={
                <button 
                  onClick={() => setEditing('openAiKey')}
                  className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
                >
                  {settings.openAiKey ? 'Update Key' : 'Add Key'}
                </button>
              }
            >
              <div className="flex items-center gap-3">
                <OpenAILogo className="h-5 w-5 text-muted-foreground" />
                <span className="font-mono text-sm text-muted-foreground">
                  {settings.openAiKey ? '••••••••' : 'Not configured'}
                </span>
              </div>
            </SettingsRow>
            
            <SettingsRow 
              label="Anthropic API Key" 
              description="Used for Claude models."
              action={
                <button 
                  onClick={() => setEditing('anthropicKey')}
                  className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
                >
                  {settings.anthropicKey ? 'Update Key' : 'Add Key'}
                </button>
              }
            >
              <div className="flex items-center gap-3">
                <AnthropicLogo className="h-5 w-5 text-muted-foreground" />
                <span className="font-mono text-sm text-muted-foreground">
                  {settings.anthropicKey ? '••••••••' : 'Not configured'}
                </span>
              </div>
            </SettingsRow>
          </>
        )}
      </SettingsGroup>



      {/* Modals */}
      <SettingModal
        open={editing === 'systemPrompt'}
        onOpenChange={(v) => !v && setEditing(null)}
        title="AI System Prompt"
        description="Update the core instructions for the AI."
        icon={Cpu}
        isSaving={saving}
        onSave={() => handleSave({ systemPrompt })}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium">Prompt text</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
            className="w-full rounded-xl bg-background/50 border border-input p-4 text-sm font-mono focus:bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
          />
        </div>
      </SettingModal>

      <SettingModal
        open={editing === 'openAiKey'}
        onOpenChange={(v) => !v && setEditing(null)}
        title="OpenAI API Key"
        description="Enter your new OpenAI API key and confirm with your password."
        icon={Key}
        isSaving={saving}
        onSave={() => handleSave({ openAiKey }, password)}
      >
        <div className="space-y-4">
          <div className="space-y-2 relative">
            <label className="text-sm font-medium">API Key</label>
            <div className="relative">
              <Input 
                type={showApiKey ? "text" : "password"}
                value={openAiKey} 
                onChange={e => setOpenAiKey(e.target.value)} 
                placeholder="sk-..." 
                className="pr-10"
              />
              <button 
                type="button" 
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2 relative">
            <label className="text-sm font-medium">Your Password</label>
            <div className="relative">
              <Input 
                type={showPassword ? "text" : "password"}
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                placeholder="••••••••" 
                className="pr-10"
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </SettingModal>

      <SettingModal
        open={editing === 'anthropicKey'}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Anthropic API Key"
        description="Enter your new Anthropic API key and confirm with your password."
        icon={Key}
        isSaving={saving}
        onSave={() => handleSave({ anthropicKey }, password)}
      >
        <div className="space-y-4">
          <div className="space-y-2 relative">
            <label className="text-sm font-medium">API Key</label>
            <div className="relative">
              <Input 
                type={showApiKey ? "text" : "password"}
                value={anthropicKey} 
                onChange={e => setAnthropicKey(e.target.value)} 
                placeholder="sk-ant-..." 
                className="pr-10"
              />
              <button 
                type="button" 
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2 relative">
            <label className="text-sm font-medium">Your Password</label>
            <div className="relative">
              <Input 
                type={showPassword ? "text" : "password"}
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                placeholder="••••••••" 
                className="pr-10"
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </SettingModal>

    </div>
  );
}
