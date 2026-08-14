'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  ArrowLeft,
  ArrowUp,
  Lock,
  ShieldCheck,
  CheckCircle2,
  Circle,
  Building2,
  LogIn,
  Play,
  Loader2,
  AlertCircle,
  X,
} from 'lucide-react';
import { useUIState, useActions } from '@ai-sdk/rsc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { OtpInput } from '@/components/copilot-ui/otp-input';

type UIMessage = { id: string; role: string; display: React.ReactNode };

const SETUP_STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'company', label: 'Company' },
  { id: 'team', label: 'Team' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'complete', label: 'Complete' },
];

export function CopilotRegistrationInner() {
  const router = useRouter();
  const currentUser = useCRMStore((state) => state.currentUser);
  const sessionLoading = useCRMStore((state) => state.sessionLoading);
  const startDemoSession = useCRMStore((state) => state.startDemoSession);
  const logout = useCRMStore((state) => state.logout);
  const dbMode = useCRMStore((state) => state.dbMode);

  const [input, setInput] = useState('');
  const [uiState, setUIState] = useUIState();
  const { submitUserMessage } = useActions() as {
    submitUserMessage: (
      content: string,
      clientContext?: { isLoggedIn: boolean; firstName?: string; tenantId?: string }
    ) => Promise<{ id: string; display: React.ReactNode }>;
  };
  const [loading, setLoading] = useState(false);
  const [isStartingDemo, setIsStartingDemo] = useState(false);
  const [demoError, setDemoError] = useState<{ error: string; isSessionConflict: boolean } | null>(null);

  // Direct registration modal / inline form state
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [regAgencyName, setRegAgencyName] = useState('');
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState(false);
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);

  const isPreviewingRef = useRef(false);
  const hasOverriddenRef = useRef(false);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewInnerRef = useRef<HTMLDivElement>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [setupProgress, setSetupProgress] = useState('welcome');

  useEffect(() => {
    // If user is already logged in, show a welcome message only once
    if (currentUser && !sessionLoading && !isPreviewingRef.current && !hasOverriddenRef.current && uiState.length > 0) {
      hasOverriddenRef.current = true;
      setUIState([
        {
          id: uiState[0].id,
          role: 'assistant',
          display: (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold">
              Welcome back, <strong>{(currentUser as { first_name?: string }).first_name || currentUser.fullName || 'Admin'}</strong>! You are already logged in to your workspace.
            </div>
          ),
        },
      ]);
    }
  }, [currentUser, sessionLoading, uiState, setUIState]);

  // Direct handler for starting demo session (No LLM round-trip)
  const handleStartDemo = useCallback(async () => {
    setIsStartingDemo(true);
    setDemoError(null);
    const result = await startDemoSession();
    setIsStartingDemo(false);

    if (result.success) {
      isPreviewingRef.current = true;
      setPreviewMode(true);
      setSetupProgress('complete');
    } else {
      isPreviewingRef.current = false;
      setPreviewMode(false);
      setDemoError({
        error: result.error || 'Server demo authentication is currently unavailable.',
        isSessionConflict: result.code === 'DEMO_REQUIRES_SIGN_OUT',
      });
    }
  }, [startDemoSession]);

  // Custom event listener for backward-compatible trigger by conversational AI tools
  useEffect(() => {
    const handlePreviewEvent = () => {
      handleStartDemo();
    };
    window.addEventListener('triggerPreviewMode', handlePreviewEvent);
    return () => window.removeEventListener('triggerPreviewMode', handlePreviewEvent);
  }, [handleStartDemo]);

  // Direct handler for exiting preview (No LLM round-trip)
  const handleExitPreview = async () => {
    await logout({ scope: 'local', redirect: false });
    setPreviewMode(false);
    isPreviewingRef.current = false;
    setSetupProgress('welcome');
    setDemoError(null);
    hasOverriddenRef.current = false;
    setUIState([
      {
        id: Date.now().toString(),
        role: 'assistant',
        display: (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold">
            Preview ended. Ready to create your own workspace or sign in?
          </div>
        ),
      },
    ]);
  };

  // Direct handler for workspace registration submission (No LLM round-trip)
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regPassword || regPassword.length < 6) {
      setRegError('Password must be at least 6 characters.');
      return;
    }
    setRegLoading(true);
    setRegError(null);

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agencyName: regAgencyName.trim(),
          fullName: regFullName.trim(),
          email: regEmail.trim(),
          password: regPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegError(data.error || 'Registration failed.');
        return;
      }

      if (dbMode === 'local') {
        const user = {
          id: data.userId,
          tenantId: data.tenantId,
          fullName: regFullName.trim(),
          email: regEmail.trim(),
          role: 'admin',
          avatarUrl: '',
          isOnline: true,
          status: 'active',
        };
        const team = JSON.parse(localStorage.getItem('crm_team') || '[]');
        team.push(user);
        localStorage.setItem('crm_team', JSON.stringify(team));
        const passwords = JSON.parse(localStorage.getItem('crm_team_passwords') || '{}');
        passwords[data.userId] = regPassword;
        localStorage.setItem('crm_team_passwords', JSON.stringify(passwords));

        setRegSuccess(true);
        setTimeout(() => router.push('/app'), 800);
      } else {
        setRegistrationToken(data.token);
      }
    } catch (err: unknown) {
      setRegError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setRegLoading(false);
    }
  };

  useEffect(() => {
    const handleProgress = (e: Event) => {
      const customEvent = e as CustomEvent;
      setSetupProgress(customEvent.detail);
    };
    window.addEventListener('updateSetupProgress', handleProgress);
    return () => window.removeEventListener('updateSetupProgress', handleProgress);
  }, []);

  useEffect(() => {
    const c = previewContainerRef.current;
    const i = previewInnerRef.current;
    if (!c || !i) return;
    const preventScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.scrollTop !== 0) target.scrollTop = 0;
      if (target.scrollLeft !== 0) target.scrollLeft = 0;
    };
    c.addEventListener('scroll', preventScroll, { capture: true });
    i.addEventListener('scroll', preventScroll, { capture: true });
    return () => {
      c.removeEventListener('scroll', preventScroll, { capture: true });
      i.removeEventListener('scroll', preventScroll, { capture: true });
    };
  }, [previewMode]);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chatEl = chatContainerRef.current;
    if (!chatEl) return;

    const observer = new MutationObserver(() => {
      if (typeof chatEl.scrollTo === 'function') {
        chatEl.scrollTo({
          top: chatEl.scrollHeight,
          behavior: 'smooth',
        });
      }
    });

    observer.observe(chatEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

  // Conversational AI messaging for free-text inquiries
  const send = async (textOverride?: string) => {
    const text = textOverride ?? input.trim();
    if (!text || loading) return;

    setUIState((currentUI: UIMessage[]) => [
      ...currentUI,
      {
        id: Date.now().toString(),
        role: 'user',
        display: (
          <div className="ml-auto bg-foreground text-background dark:bg-foreground dark:text-background rounded-2xl rounded-tr-sm px-4 py-3 text-sm max-w-[75%] shadow-sm">
            {text}
          </div>
        ),
      },
    ]);

    setInput('');
    setLoading(true);

    try {
      const response = await submitUserMessage(text, {
        isLoggedIn: !!currentUser,
        firstName: currentUser?.fullName,
        tenantId: currentUser?.tenantId,
      });
      setUIState((currentUI: UIMessage[]) => [
        ...currentUI,
        {
          id: response.id,
          role: 'assistant',
          display: response.display,
        },
      ]);
    } catch {
      setUIState((currentUI: UIMessage[]) => [
        ...currentUI,
        {
          id: Date.now().toString(),
          role: 'assistant',
          display: (
            <div className="bg-destructive/10 text-destructive rounded-2xl rounded-tl-sm px-4 py-3 text-sm max-w-[75%]">
              Something went wrong. Please try again.
            </div>
          ),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (sessionLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background select-none">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const currentStepIndex = SETUP_STEPS.findIndex((s) => s.id === setupProgress);

  return (
    <div className="flex h-screen w-screen justify-center bg-background select-none relative overflow-hidden font-sans">
      {/* Navigation Return */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-4 left-4 sm:top-6 sm:left-6 z-20 gap-2 text-muted-foreground hover:text-foreground"
        onClick={() => router.push('/')}
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="font-medium text-xs tracking-tight">Back to Home</span>
      </Button>

      <div
        className={`w-full min-h-screen flex items-start sm:items-center justify-center relative z-10 gap-6 mx-auto pt-14 sm:pt-6 transition-all duration-500 ease-in-out ${
          previewMode ? 'max-w-[98vw] 2xl:max-w-[1800px] px-4 md:px-8' : 'max-w-5xl px-4 sm:px-6'
        }`}
      >
        {/* Main Assistant / Onboarding Container */}
        <motion.div
          initial={false}
          animate={{
            width: previewMode ? '400px' : '100%',
            maxWidth: previewMode ? '400px' : '44rem',
            borderRadius: previewMode ? '24px' : '0px',
            backgroundColor: previewMode ? 'var(--card)' : 'transparent',
            boxShadow: previewMode ? '0 10px 40px -10px rgba(0,0,0,0.1)' : 'none',
            border: previewMode ? '1px solid var(--border)' : 'none',
          }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="h-[calc(100vh-5rem)] sm:h-[calc(100vh-7rem)] w-full flex flex-col relative shrink-0 overflow-hidden"
        >
          <div className="flex flex-col h-full w-full pt-2 pb-4 px-2 sm:px-4">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center pt-2 pb-3 shrink-0"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="font-bold text-lg tracking-tight text-foreground font-heading">
                  Rihla Setup Assistant
                </h2>
              </div>
              <p className="text-xs text-muted-foreground font-medium mb-2.5">
                AI-assisted travel operating system. Get ready in 2 minutes.
              </p>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                <span className="flex items-center gap-1">
                  <Lock className="h-3 w-3 text-primary/80" /> Secure
                </span>
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-primary/80" /> Private
                </span>
              </div>
            </motion.div>

            {/* Direct Action Hub (Primary Choices - Deterministic, No LLM) */}
            {!currentUser && (
              <div className="mb-3 px-2">
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant={isCreatingWorkspace ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setIsCreatingWorkspace(!isCreatingWorkspace);
                      setDemoError(null);
                    }}
                    className="h-10 text-xs font-semibold gap-1.5 rounded-xl transition-all shadow-sm"
                  >
                    <Building2 className="h-3.5 w-3.5 text-primary" />
                    <span>Create Workspace</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => router.push('/login')}
                    className="h-10 text-xs font-semibold gap-1.5 rounded-xl hover:border-primary/40 transition-all shadow-sm"
                  >
                    <LogIn className="h-3.5 w-3.5 text-primary" />
                    <span>Sign In</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isStartingDemo}
                    onClick={handleStartDemo}
                    className="h-10 text-xs font-semibold gap-1.5 rounded-xl border-primary/30 bg-primary/5 hover:bg-primary/10 text-foreground transition-all shadow-sm"
                  >
                    {isStartingDemo ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span>Starting...</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 text-primary fill-primary/20" />
                        <span>Explore Demo</span>
                      </>
                    )}
                  </Button>
                </div>

                {/* Direct Demo Error / Conflict Display */}
                {demoError && (
                  <div
                    role="alert"
                    className={`mt-2.5 p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                      demoError.isSessionConflict
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                        : 'border-destructive/30 bg-destructive/10 text-destructive'
                    }`}
                  >
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="font-semibold">
                        {demoError.isSessionConflict ? 'Active Account Session Present' : 'Demo Connection Unavailable'}
                      </p>
                      <p className="opacity-90">{demoError.error}</p>
                      <div className="pt-1">
                        {demoError.isSessionConflict ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 text-[11px] px-2"
                            onClick={() => router.push('/app')}
                          >
                            Go to Your Dashboard
                          </Button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleStartDemo}
                            className="font-semibold underline hover:opacity-80 cursor-pointer"
                          >
                            Retry Demo Connection
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Direct Workspace Creation Form (When Opened) */}
            {isCreatingWorkspace && !currentUser && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 px-2"
              >
                <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold font-heading text-foreground uppercase tracking-wider">
                      Create Your Agency Workspace
                    </h3>
                    <button
                      type="button"
                      onClick={() => setIsCreatingWorkspace(false)}
                      className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {regSuccess ? (
                    <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>Workspace created successfully! Redirecting...</span>
                    </div>
                  ) : registrationToken ? (
                    <OtpInput
                      email={regEmail}
                      password={regPassword}
                      token={registrationToken}
                      agencyName={regAgencyName}
                    />
                  ) : (
                    <form onSubmit={handleRegisterSubmit} className="space-y-2.5">
                      {regError && (
                        <div role="alert" className="p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
                          {regError}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold uppercase font-mono text-muted-foreground block mb-1">
                            Company Name
                          </label>
                          <Input
                            value={regAgencyName}
                            onChange={(e) => setRegAgencyName(e.target.value)}
                            placeholder="e.g. Apex Travel"
                            required
                            className="h-8 text-xs rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase font-mono text-muted-foreground block mb-1">
                            Your Name
                          </label>
                          <Input
                            value={regFullName}
                            onChange={(e) => setRegFullName(e.target.value)}
                            placeholder="e.g. Layla Al-Mansoor"
                            required
                            className="h-8 text-xs rounded-lg"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold uppercase font-mono text-muted-foreground block mb-1">
                            Email
                          </label>
                          <Input
                            type="email"
                            value={regEmail}
                            onChange={(e) => setRegEmail(e.target.value)}
                            placeholder="you@company.com"
                            required
                            className="h-8 text-xs rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase font-mono text-muted-foreground block mb-1">
                            Password
                          </label>
                          <Input
                            type="password"
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            placeholder="Min. 6 characters"
                            required
                            className="h-8 text-xs rounded-lg"
                          />
                        </div>
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={regLoading}
                        className="w-full h-8 text-xs font-semibold gap-1.5 mt-1 rounded-lg"
                      >
                        {regLoading ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Creating Workspace...</span>
                          </>
                        ) : (
                          <span>Complete Workspace Setup</span>
                        )}
                      </Button>
                    </form>
                  )}
                </div>
              </motion.div>
            )}

            {/* Conversational Chat Area */}
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto hide-scrollbar relative pb-28">
              <div className="space-y-3 px-2 flex flex-col">
                <AnimatePresence initial={false}>
                  {uiState.map((msg: UIMessage, index: number) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, scale: 0.98, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="flex flex-col"
                    >
                      {msg.role === 'user' ? (
                        msg.display
                      ) : (
                        <div className="bg-card border border-border/80 rounded-2xl rounded-tl-sm px-5 py-3.5 text-sm max-w-[80%] shadow-sm overflow-hidden text-card-foreground">
                          {msg.display}
                          {index === 0 && currentUser && (
                            <div className="mt-3 flex flex-col gap-2">
                              <Button
                                size="sm"
                                onClick={() => router.push('/app')}
                                className="h-8 text-xs font-semibold justify-start"
                              >
                                Go to Dashboard
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))}

                  {loading && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.98, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="flex flex-col"
                    >
                      <div className="bg-card border border-border/80 rounded-2xl rounded-tl-sm px-4 py-3 w-fit shadow-sm flex items-center gap-2 text-xs text-muted-foreground font-medium">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span>Rihla Copilot is responding...</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Conversational Input Area */}
            <div className="absolute bottom-3 left-0 w-full px-4 pointer-events-none">
              <div className="w-full pointer-events-auto">
                <motion.div
                  initial={{ y: 15, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="relative flex items-center bg-card/95 border border-border shadow-sm rounded-2xl focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all p-1"
                >
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="Ask a question about setup or features..."
                    className="min-h-[40px] max-h-28 resize-none text-xs border-0 focus-visible:ring-0 shadow-none bg-transparent py-2.5 px-3 font-medium"
                    rows={1}
                  />
                  <Button
                    size="icon"
                    onClick={() => send()}
                    disabled={loading || !input.trim()}
                    className="shrink-0 h-8 w-8 rounded-xl ml-1 self-end mb-[2px] mr-[2px]"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                </motion.div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Right Panel (Setup Steps or Live CRM Preview) */}
        <AnimatePresence mode="wait">
          {!previewMode ? (
            <motion.div
              key="progress"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className="w-[280px] h-full hidden md:flex flex-col justify-center shrink-0 pl-6 border-l border-border/50"
            >
              <h3 className="text-xs font-bold text-foreground mb-5 uppercase tracking-wider font-mono">
                Setup Progress
              </h3>
              {isStartingDemo ? (
                <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-xs font-bold text-foreground">Starting Live Demo...</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Authenticating secure visitor sandbox...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {SETUP_STEPS.map((step, index) => {
                    const isCompleted = index < currentStepIndex;
                    const isActive = index === currentStepIndex;
                    return (
                      <div key={step.id} className="flex items-center gap-3">
                        <div
                          className={`relative flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold transition-colors ${
                            isCompleted
                              ? 'bg-primary text-primary-foreground'
                              : isActive
                              ? 'bg-primary/20 text-primary border border-primary/40'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {isCompleted ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : isActive ? (
                            <Circle className="w-2.5 h-2.5 fill-current animate-pulse" />
                          ) : (
                            <span>{index + 1}</span>
                          )}
                        </div>
                        <span
                          className={`text-xs font-medium transition-colors ${
                            isActive
                              ? 'text-foreground font-bold'
                              : isCompleted
                              ? 'text-foreground'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              ref={previewContainerRef}
              key="preview"
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex-[1.1] h-[90%] bg-background border border-border shadow-2xl rounded-2xl overflow-hidden flex flex-col hidden md:flex relative"
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/80 shadow-sm" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80 shadow-sm" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/80 shadow-sm" />
                  </div>
                  <span className="ml-2 text-[11px] font-bold text-muted-foreground uppercase font-mono tracking-widest">
                    Live Demo Sandbox
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs hover:bg-destructive/10 hover:text-destructive transition-colors font-medium"
                  onClick={handleExitPreview}
                >
                  Exit Preview
                </Button>
              </div>
              <div ref={previewInnerRef} className="flex-1 relative bg-background overflow-hidden">
                <iframe
                  src="/app"
                  className="absolute inset-0 border-0 bg-background"
                  style={{
                    width: '111.11%',
                    height: '111.11%',
                    transform: 'scale(0.9)',
                    transformOrigin: 'top left',
                  }}
                  title="Rihla CRM Preview"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
