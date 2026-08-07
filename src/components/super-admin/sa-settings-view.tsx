'use client';

import React, { useEffect, useState } from 'react';
import { CRMDatabaseService } from '@/lib/db-service';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings,
  Save,
  AlertTriangle,
  Globe,
  Mail,
  Shield,
  Cpu,
  Bot,
  Sparkles,
  Key,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  ChevronDown,
} from 'lucide-react';

type AIPlatform = 'openai' | 'anthropic' | 'openai-compatible';

const OPENAI_STANDARD_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4-turbo',
  'o1-mini',
  'o3-mini',
];

const ANTHROPIC_STANDARD_MODELS = [
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307',
];

export function SuperAdminSettingsView() {
  const [form, setForm] = useState({
    aiPlatform: 'openai' as AIPlatform,
    defaultAiBaseUrl: 'https://api.openai.com/v1',
    defaultAiApiKey: '',
    defaultAiModel: 'gpt-4o-mini',
    aiUseAnthropicFormat: false,
    platformMonthlyAiCap: 500,
    maintenanceMode: false,
    allowNewTenants: true,
    defaultAiBudget: 100,
    supportEmail: '',
  });

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Model Fetching States for OpenAI-Compatible
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchSuccess, setFetchSuccess] = useState<string | null>(null);

  useEffect(() => {
    CRMDatabaseService.getPlatformSettings().then((s) => {
      const extra = (s.settings as Record<string, unknown>) || {};
      const baseUrl = String(extra.defaultAiBaseUrl || 'https://api.openai.com/v1');
      const useAnthropic = Boolean(extra.aiUseAnthropicFormat);
      const savedPlatform = String(extra.aiPlatform || '');

      let platform: AIPlatform = 'openai';
      if (savedPlatform === 'openai' || savedPlatform === 'anthropic' || savedPlatform === 'openai-compatible') {
        platform = savedPlatform as AIPlatform;
      } else if (useAnthropic || baseUrl.includes('anthropic')) {
        platform = 'anthropic';
      } else if (baseUrl && baseUrl !== 'https://api.openai.com/v1') {
        platform = 'openai-compatible';
      }

      setForm({
        aiPlatform: platform,
        defaultAiBaseUrl: baseUrl,
        defaultAiApiKey: String(extra.defaultAiApiKey || ''),
        defaultAiModel: String(s.defaultAiModel || 'gpt-4o-mini'),
        aiUseAnthropicFormat: useAnthropic,
        platformMonthlyAiCap: Number(s.platformMonthlyAiCap) || 500,
        maintenanceMode: Boolean(s.maintenanceMode),
        allowNewTenants: extra.allowNewTenants !== false,
        defaultAiBudget: Number(extra.defaultAiBudget) || 100,
        supportEmail: String(extra.supportEmail || ''),
      });
    });
  }, []);

  const handlePlatformChange = (newPlatform: AIPlatform) => {
    setForm((prev) => {
      let nextBaseUrl = prev.defaultAiBaseUrl;
      let nextModel = prev.defaultAiModel;
      let nextUseAnthropic = prev.aiUseAnthropicFormat;

      if (newPlatform === 'openai') {
        nextBaseUrl = 'https://api.openai.com/v1';
        nextUseAnthropic = false;
        if (!nextModel || nextModel.includes('claude')) {
          nextModel = 'gpt-4o-mini';
        }
      } else if (newPlatform === 'anthropic') {
        nextBaseUrl = 'https://api.anthropic.com';
        nextUseAnthropic = true;
        if (!nextModel || nextModel.includes('gpt')) {
          nextModel = 'claude-3-5-sonnet-20241022';
        }
      } else if (newPlatform === 'openai-compatible') {
        nextUseAnthropic = false;
        if (nextBaseUrl === 'https://api.openai.com/v1' || nextBaseUrl === 'https://api.anthropic.com') {
          nextBaseUrl = 'https://integrate.api.nvidia.com/v1';
        }
      }

      return {
        ...prev,
        aiPlatform: newPlatform,
        defaultAiBaseUrl: nextBaseUrl,
        defaultAiModel: nextModel,
        aiUseAnthropicFormat: nextUseAnthropic,
      };
    });
    setFetchError(null);
    setFetchSuccess(null);
  };

  const handleFetchModels = async () => {
    if (!form.defaultAiBaseUrl || !form.defaultAiApiKey) {
      setFetchError('Please enter both Endpoint URL and API Key first.');
      return;
    }

    setFetchingModels(true);
    setFetchError(null);
    setFetchSuccess(null);

    try {
      // First try server proxy API route
      const res = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: form.defaultAiBaseUrl,
          apiKey: form.defaultAiApiKey,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          setFetchedModels(data.models);
          setFetchSuccess(`Successfully fetched ${data.models.length} models!`);
          if (!form.defaultAiModel || !data.models.includes(form.defaultAiModel)) {
            setForm((prev) => ({ ...prev, defaultAiModel: data.models[0] }));
          }
          setFetchingModels(false);
          return;
        }
      }

      // If server returned an error, extract it
      const errData = await res.json().catch(() => null);

      // Only try direct client fetch if the endpoint is a local address (e.g. Ollama localhost)
      const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(form.defaultAiBaseUrl);
      if (isLocal) {
        let baseUrl = form.defaultAiBaseUrl.trim().replace(/\/+$/, '');
        if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
          baseUrl = `http://${baseUrl}`;
        }
        if (baseUrl.endsWith('/chat/completions')) baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
        const modelsUrl = baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`;

        try {
          const clientRes = await fetch(modelsUrl, {
            headers: { Authorization: `Bearer ${form.defaultAiApiKey.trim()}` },
          });

          if (clientRes.ok) {
            const data = await clientRes.json();
            const list = Array.isArray(data.data) ? data.data.map((m: Record<string, unknown>) => String(m.id || '')) : [];
            if (list.length > 0) {
              setFetchedModels(list);
              setFetchSuccess(`Successfully fetched ${list.length} models locally!`);
              if (!form.defaultAiModel || !list.includes(form.defaultAiModel)) {
                setForm((prev) => ({ ...prev, defaultAiModel: list[0] }));
              }
              setFetchingModels(false);
              return;
            }
          }
        } catch {
          // Fall through to error reporting below
        }
      }

      setFetchError(errData?.error || 'Could not fetch models. Verify your endpoint URL and API Key.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFetchError(`Connection error: ${msg}`);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const finalBaseUrl =
        form.aiPlatform === 'openai'
          ? 'https://api.openai.com/v1'
          : form.aiPlatform === 'anthropic'
          ? 'https://api.anthropic.com'
          : form.defaultAiBaseUrl;

      const finalUseAnthropic = form.aiPlatform === 'anthropic';

      await CRMDatabaseService.updatePlatformSettings({
        defaultAiModel: form.defaultAiModel,
        platformMonthlyAiCap: form.platformMonthlyAiCap,
        maintenanceMode: form.maintenanceMode,
        settings: {
          aiPlatform: form.aiPlatform,
          defaultAiBaseUrl: finalBaseUrl,
          defaultAiApiKey: form.defaultAiApiKey,
          aiUseAnthropicFormat: finalUseAnthropic,
          allowNewTenants: form.allowNewTenants,
          defaultAiBudget: form.defaultAiBudget,
          supportEmail: form.supportEmail,
        },
      });
      setMessage('Platform settings saved successfully.');
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
          <p className="text-sm text-muted-foreground mt-1">Global defaults for all agencies. Individual agencies can override these.</p>
        </div>

        {message && (
          <div className="p-3 rounded-xl bg-primary/10 text-primary text-sm font-medium border border-primary/20 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {message}
          </div>
        )}

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* AI Provider Config */}
          <section className="p-6 rounded-2xl bg-card/90 border border-border/60 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/40 pb-4">
              <div>
                <h3 className="font-bold flex items-center gap-2 text-base">
                  <Cpu className="h-5 w-5 text-primary" />
                  Platform AI Gateway
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select and configure the primary AI provider activated across your SaaS platform.
                </p>
              </div>
            </div>

            {/* Platform Selection Dropdown */}
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-1.5 font-semibold">
                <Layers className="h-3.5 w-3.5 text-primary" />
                Select Platform to Activate
              </label>
              <div className="relative">
                <select
                  value={form.aiPlatform}
                  onChange={(e) => handlePlatformChange(e.target.value as AIPlatform)}
                  className="w-full h-11 appearance-none rounded-xl border border-border bg-background px-4 pr-10 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                >
                  <option value="openai">OpenAI (Official API)</option>
                  <option value="anthropic">Anthropic (Claude API)</option>
                  <option value="openai-compatible">OpenAI-Compatible (Custom Endpoint / Groq / Ollama / vLLM)</option>
                </select>
                <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>

              {/* Visual badges for platform selection */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handlePlatformChange('openai')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                    form.aiPlatform === 'openai'
                      ? 'bg-primary/10 border-primary text-primary font-semibold shadow-sm'
                      : 'border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  OpenAI
                </button>
                <button
                  type="button"
                  onClick={() => handlePlatformChange('anthropic')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                    form.aiPlatform === 'anthropic'
                      ? 'bg-amber-500/10 border-amber-500 text-amber-600 dark:text-amber-400 font-semibold shadow-sm'
                      : 'border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  <Bot className="h-3.5 w-3.5" />
                  Anthropic
                </button>
                <button
                  type="button"
                  onClick={() => handlePlatformChange('openai-compatible')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                    form.aiPlatform === 'openai-compatible'
                      ? 'bg-purple-500/10 border-purple-500 text-purple-600 dark:text-purple-400 font-semibold shadow-sm'
                      : 'border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  OpenAI-Compatible
                </button>
              </div>
            </div>

            {/* Conditional Settings panel based on Platform */}
            <AnimatePresence mode="wait">
              {form.aiPlatform === 'openai' && (
                <motion.div
                  key="openai"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="space-y-4 pt-2 border-t border-border/40"
                >
                  <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 text-xs text-blue-700 dark:text-blue-300 flex items-center justify-between">
                    <span>Base Endpoint: <code className="font-mono font-semibold">https://api.openai.com/v1</code></span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-blue-500/10 px-2 py-0.5 rounded-md">Auto-configured</span>
                  </div>

                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-primary" />
                      OpenAI API Key
                    </label>
                    <input
                      type="password"
                      value={form.defaultAiApiKey}
                      onChange={(e) => setForm({ ...form, defaultAiApiKey: e.target.value })}
                      placeholder="sk-proj-..."
                      className="mt-1.5 w-full h-10 rounded-xl border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground">Default OpenAI Model</label>
                    <div className="grid sm:grid-cols-2 gap-3 mt-1.5">
                      <div className="relative">
                        <select
                          value={OPENAI_STANDARD_MODELS.includes(form.defaultAiModel) ? form.defaultAiModel : 'custom'}
                          onChange={(e) => {
                            if (e.target.value !== 'custom') {
                              setForm({ ...form, defaultAiModel: e.target.value });
                            }
                          }}
                          className="w-full h-10 appearance-none rounded-xl border border-border bg-background px-3 pr-8 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        >
                          {OPENAI_STANDARD_MODELS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          <option value="custom">Custom Model Name...</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      </div>
                      <input
                        value={form.defaultAiModel}
                        onChange={(e) => setForm({ ...form, defaultAiModel: e.target.value })}
                        placeholder="e.g. gpt-4o-mini"
                        className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {form.aiPlatform === 'anthropic' && (
                <motion.div
                  key="anthropic"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="space-y-4 pt-2 border-t border-border/40"
                >
                  <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between">
                    <span>Base Endpoint: <code className="font-mono font-semibold">https://api.anthropic.com</code></span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-amber-500/10 px-2 py-0.5 rounded-md">Anthropic Format Enabled</span>
                  </div>

                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-amber-500" />
                      Anthropic API Key
                    </label>
                    <input
                      type="password"
                      value={form.defaultAiApiKey}
                      onChange={(e) => setForm({ ...form, defaultAiApiKey: e.target.value })}
                      placeholder="sk-ant-api03-..."
                      className="mt-1.5 w-full h-10 rounded-xl border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground">Default Anthropic Model</label>
                    <div className="grid sm:grid-cols-2 gap-3 mt-1.5">
                      <div className="relative">
                        <select
                          value={ANTHROPIC_STANDARD_MODELS.includes(form.defaultAiModel) ? form.defaultAiModel : 'custom'}
                          onChange={(e) => {
                            if (e.target.value !== 'custom') {
                              setForm({ ...form, defaultAiModel: e.target.value });
                            }
                          }}
                          className="w-full h-10 appearance-none rounded-xl border border-border bg-background px-3 pr-8 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                        >
                          {ANTHROPIC_STANDARD_MODELS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          <option value="custom">Custom Model Name...</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      </div>
                      <input
                        value={form.defaultAiModel}
                        onChange={(e) => setForm({ ...form, defaultAiModel: e.target.value })}
                        placeholder="e.g. claude-3-5-sonnet-20241022"
                        className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {form.aiPlatform === 'openai-compatible' && (
                <motion.div
                  key="compatible"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="space-y-4 pt-2 border-t border-border/40"
                >
                  <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 text-xs text-purple-800 dark:text-purple-300">
                    <p className="font-semibold mb-0.5">Custom Endpoint Setup</p>
                    Enter your custom base endpoint and API key, then click <strong>Fetch Models</strong> to retrieve available models dynamically.
                  </div>

                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5 text-purple-500" />
                      Endpoint Base URL
                    </label>
                    <input
                      value={form.defaultAiBaseUrl}
                      onChange={(e) => setForm({ ...form, defaultAiBaseUrl: e.target.value })}
                      placeholder="https://integrate.api.nvidia.com/v1"
                      className="mt-1.5 w-full h-10 rounded-xl border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="text-[11px] text-muted-foreground self-center mr-1 font-semibold">Quick Presets:</span>
                      {[
                        { name: 'NVIDIA NIM', url: 'https://integrate.api.nvidia.com/v1' },
                        { name: 'Z.ai (GLM)', url: 'https://api.z.ai/api/paas/v4' },
                        { name: 'Groq', url: 'https://api.groq.com/openai/v1' },
                        { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
                        { name: 'Ollama (Local)', url: 'http://localhost:11434/v1' },
                      ].map((preset) => (
                        <button
                          key={preset.name}
                          type="button"
                          onClick={() => {
                            setForm({ ...form, defaultAiBaseUrl: preset.url });
                            setFetchError(null);
                            setFetchSuccess(null);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-secondary/80 hover:bg-secondary text-secondary-foreground text-[11px] font-medium transition-colors border border-border/50"
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-purple-500" />
                      API Key
                    </label>
                    <div className="flex gap-2 mt-1.5">
                      <input
                        type="password"
                        value={form.defaultAiApiKey}
                        onChange={(e) => setForm({ ...form, defaultAiApiKey: e.target.value })}
                        placeholder="Provider API Key..."
                        className="flex-1 h-10 rounded-xl border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                      />
                      <button
                        type="button"
                        onClick={handleFetchModels}
                        disabled={fetchingModels || !form.defaultAiBaseUrl || !form.defaultAiApiKey}
                        className="h-10 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 shrink-0 transition-all shadow-sm"
                      >
                        {fetchingModels ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Fetching...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-3.5 w-3.5" />
                            Fetch Models
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Feedback Messages for Fetch */}
                  {fetchError && (
                    <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-xs border border-destructive/20 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{fetchError}</span>
                    </div>
                  )}

                  {fetchSuccess && (
                    <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs border border-emerald-500/20 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{fetchSuccess}</span>
                    </div>
                  )}

                  {/* Model Selection after fetching */}
                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground flex items-center justify-between">
                      <span>Select Model to Run</span>
                      {fetchedModels.length > 0 && (
                        <span className="text-[10px] text-emerald-600 font-semibold">{fetchedModels.length} models loaded</span>
                      )}
                    </label>

                    {fetchedModels.length > 0 ? (
                      <div className="grid sm:grid-cols-2 gap-3 mt-1.5">
                        <div className="relative">
                          <select
                            value={fetchedModels.includes(form.defaultAiModel) ? form.defaultAiModel : 'manual'}
                            onChange={(e) => {
                              if (e.target.value !== 'manual') {
                                setForm({ ...form, defaultAiModel: e.target.value });
                              }
                            }}
                            className="w-full h-10 appearance-none rounded-xl border border-border bg-background px-3 pr-8 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                          >
                            {fetchedModels.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                            <option value="manual">Enter custom model name...</option>
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                        <input
                          value={form.defaultAiModel}
                          onChange={(e) => setForm({ ...form, defaultAiModel: e.target.value })}
                          placeholder="Selected model..."
                          className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                        />
                      </div>
                    ) : (
                      <div className="mt-1.5">
                        <input
                          value={form.defaultAiModel}
                          onChange={(e) => setForm({ ...form, defaultAiModel: e.target.value })}
                          placeholder="Type model name (or click Fetch Models above)..."
                          className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                        />
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* AI Budget */}
          <section className="p-6 rounded-2xl bg-card/80 border border-border/60 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Cpu className="h-4 w-4 text-primary" /> AI Budget Limits</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Platform Monthly AI Cap (₹)</label>
                <input type="number" value={form.platformMonthlyAiCap} onChange={(e) => setForm({ ...form, platformMonthlyAiCap: Number(e.target.value) })} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Default Agency AI Budget ($/mo)</label>
                <input type="number" value={form.defaultAiBudget} onChange={(e) => setForm({ ...form, defaultAiBudget: Number(e.target.value) })} className="mt-1 w-full h-10 rounded-xl border px-3 text-sm" />
              </div>
            </div>
          </section>

          {/* Platform Access */}
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

          {/* Support */}
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

          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 h-10 px-5 rounded-xl border border-primary/40 text-primary text-sm font-semibold shadow-sm hover:bg-primary/5 transition-colors disabled:opacity-50">
            <Save className="h-4 w-4" />
            Save Platform Settings
          </button>
        </motion.div>
      </div>
    </div>
  );
}

