import React, { useState } from 'react';
import { SettingItem } from './setting-item';
import { SettingModal } from './setting-modal';

import { Input } from '@/components/ui/input';
import { MessageCircle, Smartphone, Key, Eye, EyeOff, Webhook, Copy, Check, Server, Zap } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { toast } from 'sonner';

import { SettingsGroup } from './settings-group';
import { SettingsRow } from './settings-row';

export function IntegrationsSettings() {
  const settings = useCRMStore(s => s.settings);
  const currentUser = useCRMStore(s => s.currentUser);
  const updateSettings = useCRMStore(s => s.updateSettings);
  
  const [editing, setEditing] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);

  // Email Provider Modal State
  const [providerStep, setProviderStep] = useState<'provider' | 'resend' | 'smtp'>('provider');
  const [resendApiKey, setResendApiKey] = useState(settings.resendApiKey || '');
  const [resendFromEmail, setResendFromEmail] = useState(settings.resendFromEmail || '');

  const smtp = (settings.smtpSettings as Record<string, string>) || {};
  const [smtpHost, setSmtpHost] = useState(smtp.host || '');
  const [smtpPort, setSmtpPort] = useState(smtp.port || '');
  const [smtpUser, setSmtpUser] = useState(smtp.user || '');
  const [smtpPass, setSmtpPass] = useState(smtp.pass || '');

  // Form states
  const [metaPhoneId, setMetaPhoneId] = useState<string>((settings.metaSettings?.phoneNumberId as string) || '');
  const [metaWabaId, setMetaWabaId] = useState<string>((settings.metaSettings?.wabaId as string) || '');
  const [metaToken, setMetaToken] = useState<string>('');

  const [twilioSid, setTwilioSid] = useState<string>((settings.twilioSettings?.accountSid as string) || '');
  const [twilioToken, setTwilioToken] = useState<string>('');
  const [twilioFrom, setTwilioFrom] = useState<string>((settings.twilioSettings?.fromNumber as string) || '');

  const handleSave = async (updates: Record<string, unknown>, confirmPassword?: string) => {
    setSaving(true);
    try {
      await updateSettings(updates, confirmPassword);
      toast.success('Integration settings updated');
      setEditing(null);
      setPassword('');
      setProviderStep('provider');
    } catch {
      toast.error('Failed to update integration or invalid password');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedWebhook(id);
    setTimeout(() => setCopiedWebhook(null), 2000);
    toast.success('Webhook URL copied to clipboard');
  };

  const currentHost = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';
  const tenantId = currentUser?.tenantId || 'default-tenant';
  const inboundWebhookUrl = `${currentHost}/api/webhooks/inbound/${tenantId}`;
  const obscuredInboundWebhookUrl = `${currentHost}/api/webhooks/... (copy to reveal)`;
  
  const resendWebhookUrl = `${currentHost}/api/webhooks/resend/inbound`;
  const obscuredResendWebhookUrl = `${currentHost}/api/webhooks/... (copy to reveal)`;
  const activeProvider = settings.resendApiKey ? 'Resend API' : settings.smtpSettings ? 'Custom SMTP' : 'Not configured';

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <SettingsGroup title="Inbound Webhooks" description="Endpoints to receive data from external platforms.">
        <SettingsRow 
          label="Lead Capture Webhook" 
          description="Use this URL in Make.com, Zapier, or Elementor to ingest new leads."
          action={
            <button 
              onClick={() => copyToClipboard(inboundWebhookUrl, 'lead')}
              className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
            >
              {copiedWebhook === 'lead' ? 'Copied!' : 'Copy URL'}
            </button>
          }
        >
          <div className="flex items-center gap-3 w-full pr-4">
            <Webhook className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="font-mono text-sm text-muted-foreground truncate">{obscuredInboundWebhookUrl}</span>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Email Integration" description="Configure outbound emails, identity, and auto-send rules.">
        <SettingsRow 
          label="Email Provider" 
          description="Connect via Resend API or a custom SMTP server."
          action={
            <button 
              onClick={() => {
                setProviderStep('provider');
                setEditing('emailProvider');
              }}
              className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
            >
              {activeProvider !== 'Not configured' ? 'Update Provider' : 'Configure'}
            </button>
          }
        >
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-muted-foreground" />
            <span className="font-semibold text-sm text-foreground">{activeProvider}</span>
          </div>
        </SettingsRow>

        <SettingsRow 
          label="From Name" 
          description="Display name for outgoing emails."
        >
          <Input 
            value={settings.emailFromName || ''} 
            onChange={e => updateSettings({ emailFromName: e.target.value })} 
            placeholder="e.g. Acme Support Team" 
            className="w-full"
          />
        </SettingsRow>

        <SettingsRow 
          label="Reply-To Email" 
          description="Where replies will be sent."
        >
          <Input 
            type="email"
            value={settings.emailReplyTo || ''} 
            onChange={e => updateSettings({ emailReplyTo: e.target.value })} 
            placeholder="support@acme.com" 
            className="w-full"
          />
        </SettingsRow>

        <SettingsRow 
          label="New booking follow-up email" 
          description="Send a welcome email automatically when a traveler submits an inquiry."
          action={
            <div className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 cursor-pointer" 
                 style={{ backgroundColor: settings.emailAutomation ? 'hsl(var(--primary))' : 'hsl(var(--input))' }}
                 onClick={() => updateSettings({ emailAutomation: !(settings.emailAutomation ?? false) })}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-sm ${settings.emailAutomation ? 'translate-x-6' : 'translate-x-1'}`} />
            </div>
          }
        >
          <div className="hidden md:block text-sm text-muted-foreground">Automated Email</div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="WhatsApp (Meta API)" description="Official Meta Cloud API credentials.">
        <SettingsRow 
          label="Phone Number ID" 
          description="The Meta Phone Number ID."
          action={
            <button 
              onClick={() => {
                setMetaPhoneId((settings.metaSettings?.phoneNumberId as string) || '');
                setEditing('metaPhoneId');
              }}
              className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
            >
              Update
            </button>
          }
        >
          <div className="flex items-center gap-3">
            <Smartphone className="h-5 w-5 text-muted-foreground" />
            <span className="font-mono text-sm text-muted-foreground">
              {(settings.metaSettings?.phoneNumberId as string) || 'Not configured'}
            </span>
          </div>
        </SettingsRow>

        <SettingsRow 
          label="WhatsApp Business Account ID" 
          description="WABA ID."
          action={
            <button 
              onClick={() => {
                setMetaWabaId((settings.metaSettings?.wabaId as string) || '');
                setEditing('metaWabaId');
              }}
              className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
            >
              Update
            </button>
          }
        >
          <div className="flex items-center gap-3">
            <MessageCircle className="h-5 w-5 text-muted-foreground" />
            <span className="font-mono text-sm text-muted-foreground">
              {(settings.metaSettings?.wabaId as string) || 'Not configured'}
            </span>
          </div>
        </SettingsRow>

        <SettingsRow 
          label="System User Access Token" 
          description="Token with whatsapp_business_messaging permissions."
          action={
            <button 
              onClick={() => setEditing('metaToken')}
              className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
            >
              Update
            </button>
          }
        >
          <div className="flex items-center gap-3">
            <Key className="h-5 w-5 text-muted-foreground" />
            <span className="font-mono text-sm text-muted-foreground">
              {(settings.metaSettings?.accessToken as string) ? '••••••••' : 'Not configured'}
            </span>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Twilio (SMS / WhatsApp)" description="Fallback messaging credentials.">
        <SettingsRow 
          label="Account SID" 
          description="Your Twilio Account SID."
          action={
            <button 
              onClick={() => {
                setTwilioSid((settings.twilioSettings?.accountSid as string) || '');
                setEditing('twilioSid');
              }}
              className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
            >
              Update
            </button>
          }
        >
          <div className="flex items-center gap-3">
            <Smartphone className="h-5 w-5 text-muted-foreground" />
            <span className="font-mono text-sm text-muted-foreground">
              {(settings.twilioSettings?.accountSid as string) || 'Not configured'}
            </span>
          </div>
        </SettingsRow>

        <SettingsRow 
          label="Auth Token" 
          description="Twilio Auth Token."
          action={
            <button 
              onClick={() => setEditing('twilioToken')}
              className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
            >
              Update
            </button>
          }
        >
          <div className="flex items-center gap-3">
            <Key className="h-5 w-5 text-muted-foreground" />
            <span className="font-mono text-sm text-muted-foreground">
              {(settings.twilioSettings?.authToken as string) ? '••••••••' : 'Not configured'}
            </span>
          </div>
        </SettingsRow>

        <SettingsRow 
          label="From Phone Number" 
          description="The Twilio phone number."
          action={
            <button 
              onClick={() => {
                setTwilioFrom((settings.twilioSettings?.fromNumber as string) || '');
                setEditing('twilioFrom');
              }}
              className="w-full md:w-auto px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
            >
              Update
            </button>
          }
        >
          <div className="flex items-center gap-3">
            <Smartphone className="h-5 w-5 text-muted-foreground" />
            <span className="font-mono text-sm text-muted-foreground">
              {(settings.twilioSettings?.fromNumber as string) || 'Not configured'}
            </span>
          </div>
        </SettingsRow>
      </SettingsGroup>



      {/* Modals */}
      <SettingModal
        open={editing === 'metaPhoneId'}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Meta Phone Number ID"
        description="Update your Phone Number ID."
        icon={Smartphone}
        isSaving={saving}
        onSave={() => handleSave({ metaSettings: { ...settings.metaSettings, phoneNumberId: metaPhoneId } })}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium">Phone Number ID</label>
          <Input 
            value={metaPhoneId} 
            onChange={e => setMetaPhoneId(e.target.value)} 
          />
        </div>
      </SettingModal>

      <SettingModal
        open={editing === 'metaWabaId'}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Meta WABA ID"
        description="Update your WhatsApp Business Account ID."
        icon={MessageCircle}
        isSaving={saving}
        onSave={() => handleSave({ metaSettings: { ...settings.metaSettings, wabaId: metaWabaId } })}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium">WABA ID</label>
          <Input 
            value={metaWabaId} 
            onChange={e => setMetaWabaId(e.target.value)} 
          />
        </div>
      </SettingModal>

      <SettingModal
        open={editing === 'metaToken'}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Meta Access Token"
        description="Update your System User Access Token and confirm with your password."
        icon={Key}
        isSaving={saving}
        onSave={() => handleSave({ metaSettings: { ...settings.metaSettings, accessToken: metaToken } }, password)}
      >
        <div className="space-y-4">
          <div className="space-y-2 relative">
            <label className="text-sm font-medium">Access Token</label>
            <div className="relative">
              <Input 
                type={showApiKey ? "text" : "password"}
                value={metaToken} 
                onChange={e => setMetaToken(e.target.value)} 
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
        open={editing === 'twilioSid'}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Twilio Account SID"
        description="Update your Twilio Account SID."
        icon={Smartphone}
        isSaving={saving}
        onSave={() => handleSave({ twilioSettings: { ...settings.twilioSettings, accountSid: twilioSid } })}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium">Account SID</label>
          <Input 
            value={twilioSid} 
            onChange={e => setTwilioSid(e.target.value)} 
          />
        </div>
      </SettingModal>

      <SettingModal
        open={editing === 'twilioToken'}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Twilio Auth Token"
        description="Update your Twilio Auth Token and confirm with your password."
        icon={Key}
        isSaving={saving}
        onSave={() => handleSave({ twilioSettings: { ...settings.twilioSettings, authToken: twilioToken } }, password)}
      >
        <div className="space-y-4">
          <div className="space-y-2 relative">
            <label className="text-sm font-medium">Auth Token</label>
            <div className="relative">
              <Input 
                type={showApiKey ? "text" : "password"}
                value={twilioToken} 
                onChange={e => setTwilioToken(e.target.value)} 
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
        open={editing === 'twilioFrom'}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Twilio From Number"
        description="Update your Twilio phone number."
        icon={Smartphone}
        isSaving={saving}
        onSave={() => handleSave({ twilioSettings: { ...settings.twilioSettings, fromNumber: twilioFrom } })}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium">Phone Number</label>
          <Input 
            value={twilioFrom} 
            onChange={e => setTwilioFrom(e.target.value)} 
          />
        </div>
      </SettingModal>

      {/* Email Provider Dynamic Modal */}
      <SettingModal
        open={editing === 'emailProvider'}
        onOpenChange={(v) => {
          if (!v) {
            setEditing(null);
            setPassword('');
            setProviderStep('provider');
          }
        }}
        title={providerStep === 'provider' ? 'Choose Email Provider' : providerStep === 'resend' ? 'Configure Resend' : 'Configure Custom SMTP'}
        description={providerStep === 'provider' ? 'Select how you want to route outbound emails.' : 'Enter your credentials securely below.'}
        icon={providerStep === 'provider' ? Server : providerStep === 'resend' ? Zap : Server}
        isSaving={saving}
        hideFooter={providerStep === 'provider'}
        onSave={providerStep !== 'provider' ? async () => {
          if (providerStep === 'resend') {
            await handleSave({ resendApiKey, resendFromEmail, smtpSettings: null }, password);
          } else {
            await handleSave({ smtpSettings: { host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass }, resendApiKey: null }, password);
          }
        } : async () => {}}
      >
        {providerStep === 'provider' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => setProviderStep('resend')}
              className="flex flex-col items-start gap-3 p-5 rounded-2xl border-2 border-border/50 bg-card hover:border-blue-500/50 hover:bg-blue-500/5 transition-all text-left"
            >
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">
                <Zap className="h-6 w-6" />
              </div>
              <div>
                <h4 className="font-bold text-foreground">Resend API</h4>
                <p className="text-sm text-muted-foreground mt-1">Recommended. High deliverability and reliable webhooks for inbound replies.</p>
              </div>
            </button>
            <button
              onClick={() => setProviderStep('smtp')}
              className="flex flex-col items-start gap-3 p-5 rounded-2xl border-2 border-border/50 bg-card hover:border-gray-500/50 hover:bg-gray-500/5 transition-all text-left"
            >
              <div className="p-2.5 rounded-xl bg-gray-500/10 text-gray-500">
                <Server className="h-6 w-6" />
              </div>
              <div>
                <h4 className="font-bold text-foreground">Custom SMTP</h4>
                <p className="text-sm text-muted-foreground mt-1">Use your own mail server or Google/Microsoft credentials directly.</p>
              </div>
            </button>
          </div>
        )}

        {providerStep === 'resend' && (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2 relative">
                <label className="text-sm font-medium">Resend API Key</label>
                <div className="relative">
                  <Input 
                    type={showApiKey ? "text" : "password"}
                    value={resendApiKey} 
                    onChange={e => setResendApiKey(e.target.value)} 
                    placeholder="re_..." 
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
              <div className="space-y-2">
                <label className="text-sm font-medium">Verified Domain (From Email)</label>
                <Input 
                  type="email"
                  value={resendFromEmail} 
                  onChange={e => setResendFromEmail(e.target.value)} 
                  placeholder="e.g. bookings@yourdomain.com" 
                />
                <p className="text-xs text-muted-foreground mt-1">This domain must be verified in your Resend account.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-muted/30 border border-border/50 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Webhook className="h-4 w-4 text-primary" />
                Inbound Webhook URL
              </div>
              <p className="text-xs text-muted-foreground">Add this URL to your Resend Webhooks dashboard to receive email replies in the CRM.</p>
              <div className="flex items-center gap-2">
                <Input readOnly value={obscuredResendWebhookUrl} className="h-9 bg-background font-mono text-xs text-muted-foreground select-none" />
                <button
                  onClick={() => copyToClipboard(resendWebhookUrl, 'resend')}
                  className="shrink-0 p-2 rounded-lg bg-background border border-border hover:bg-muted transition-colors text-foreground"
                >
                  {copiedWebhook === 'resend' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2 relative pt-2 border-t border-border/40">
              <label className="text-sm font-medium">Confirm with your password</label>
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
        )}

        {providerStep === 'smtp' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">SMTP Host</label>
                <Input 
                  value={smtpHost} 
                  onChange={e => setSmtpHost(e.target.value)} 
                  placeholder="smtp.example.com" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Port</label>
                <Input 
                  value={smtpPort} 
                  onChange={e => setSmtpPort(e.target.value)} 
                  placeholder="465 or 587" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">SMTP Username</label>
              <Input 
                value={smtpUser} 
                onChange={e => setSmtpUser(e.target.value)} 
                placeholder="user@example.com" 
              />
            </div>
            <div className="space-y-2 relative">
              <label className="text-sm font-medium">SMTP Password</label>
              <div className="relative">
                <Input 
                  type={showApiKey ? "text" : "password"}
                  value={smtpPass} 
                  onChange={e => setSmtpPass(e.target.value)} 
                  placeholder="••••••••" 
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

            <div className="space-y-2 relative pt-4 border-t border-border/40">
              <label className="text-sm font-medium">Confirm with your CRM password</label>
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
        )}
      </SettingModal>
      
    </div>
  );
}
