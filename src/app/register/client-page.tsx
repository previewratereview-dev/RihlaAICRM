'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowLeft, ArrowUp, Lock, ShieldCheck, CheckCircle2, Circle } from 'lucide-react';
import { useUIState, useActions } from '@ai-sdk/rsc';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

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
  const currentUser = useCRMStore(state => state.currentUser);
  const sessionLoading = useCRMStore(state => state.sessionLoading);
  const startDemoSession = useCRMStore(state => state.startDemoSession);
  const logout = useCRMStore(state => state.logout);

  const [input, setInput] = useState('');
  const [uiState, setUIState] = useUIState();
  const { submitUserMessage } = useActions() as { submitUserMessage: (content: string, clientContext?: { isLoggedIn: boolean, firstName?: string, tenantId?: string }) => Promise<{ id: string, display: React.ReactNode }> };
  const [loading, setLoading] = useState(false);
  const [isStartingDemo, setIsStartingDemo] = useState(false);

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
              Welcome back, <strong>{(currentUser as { first_name?: string }).first_name || currentUser.fullName || 'Admin'}</strong>! You are already logged in to your workspace. Do you need help with anything, or would you like to go to your dashboard?
            </div>
          )
        }
      ]);
    }
  }, [currentUser, sessionLoading, uiState, setUIState]);

  useEffect(() => {
    const handlePreview = async () => {
      setIsStartingDemo(true);
      const result = await startDemoSession();
      setIsStartingDemo(false);

      if (result.success) {
        isPreviewingRef.current = true;
        setPreviewMode(true);
      } else {
        isPreviewingRef.current = false;
        setPreviewMode(false);
        setUIState((prev: UIMessage[]) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            display: (
              <div className="p-3.5 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-sm space-y-2">
                <p className="font-semibold">Unable to start live demo session</p>
                <p className="text-xs opacity-90">{result.error || 'Server demo authentication is currently unavailable.'}</p>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event('triggerPreviewMode'))}
                  className="mt-1 inline-flex items-center text-xs font-semibold text-primary underline hover:opacity-80"
                >
                  Retry Demo Connection
                </button>
              </div>
            ),
          },
        ]);
      }
    };
    window.addEventListener('triggerPreviewMode', handlePreview);
    return () => window.removeEventListener('triggerPreviewMode', handlePreview);
  }, [startDemoSession, setUIState]);

  const handleExitPreview = async () => {
    await logout();
    setPreviewMode(false);
    isPreviewingRef.current = false;
    setSetupProgress('welcome');
    hasOverriddenRef.current = false; // allow a new welcome message later if needed
    setUIState([
      {
        id: Date.now().toString(),
        role: 'assistant',
        display: (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold">
            Preview ended. Ready to create your own workspace or sign in?
          </div>
        )
      }
    ]);
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
    // Use capture phase to intercept scroll immediately
    c.addEventListener('scroll', preventScroll, { capture: true });
    i.addEventListener('scroll', preventScroll, { capture: true });
    return () => {
      c.removeEventListener('scroll', preventScroll, { capture: true });
      i.removeEventListener('scroll', preventScroll, { capture: true });
    };
  }, [previewMode]);

  // Use a chat container ref instead of scrollIntoView to prevent layout shifting/cutoffs
  const chatContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chatEl = chatContainerRef.current;
    if (!chatEl) return;

    // Use a MutationObserver to track height changes during streaming
    const observer = new MutationObserver(() => {
      chatEl.scrollTo({
        top: chatEl.scrollHeight,
        behavior: 'smooth'
      });
    });

    observer.observe(chatEl, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return () => observer.disconnect();
  }, []);

  const send = async (textOverride?: string) => {
    const text = textOverride ?? input.trim();
    if (!text || loading) return;

    setUIState((currentUI: UIMessage[]) => [
      ...currentUI,
      {
        id: Date.now().toString(),
        role: 'user',
        display: (
          <div className="ml-auto bg-foreground text-background dark:bg-foreground dark:text-background rounded-[24px] rounded-tr-[8px] px-5 py-3.5 text-[15px] max-w-[65%] shadow-sm">
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
        tenantId: currentUser?.tenantId
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
            <div className="bg-destructive/10 text-destructive rounded-[24px] rounded-tl-[8px] px-5 py-3.5 text-[15px] max-w-[65%]">
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
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 dark:bg-black select-none">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const currentStepIndex = SETUP_STEPS.findIndex(s => s.id === setupProgress);

  return (
    <div className="flex h-screen w-screen justify-center bg-zinc-50 dark:bg-[#0A0A0A] select-none relative overflow-hidden font-sans">
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />

      <Button
        variant="ghost"
        className="absolute top-6 left-6 z-20 gap-2 text-muted-foreground hover:text-foreground"
        onClick={() => router.push('/')}
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="font-medium text-sm tracking-tight">Back to Home</span>
      </Button>

      <div className={`w-full min-h-screen flex items-start sm:items-center justify-center relative z-10 gap-6 mx-auto pt-16 sm:pt-6 transition-all duration-700 ease-in-out ${previewMode ? 'max-w-[98vw] 2xl:max-w-[1800px] px-4 md:px-8' : 'max-w-5xl px-4 sm:px-6'}`}>

        {/* Chat Container */}
        <motion.div
          initial={false}
          animate={{
            width: previewMode ? '400px' : '100%',
            maxWidth: previewMode ? '400px' : '42rem',
            borderRadius: previewMode ? '24px' : '0px',
            backgroundColor: previewMode ? 'var(--background)' : 'transparent',
            boxShadow: previewMode ? '0 10px 40px -10px rgba(0,0,0,0.1)' : 'none',
            border: previewMode ? '1px solid var(--border)' : 'none',
          }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="h-[calc(100vh-6rem)] sm:h-[calc(100vh-8rem)] w-full flex flex-col relative shrink-0 overflow-hidden"
        >
          <div className="flex flex-col h-full w-full pt-4 pb-6 px-4">

            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center pt-2 pb-4 shrink-0"
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-5 w-5 text-purple-500" />
                <h2 className="font-bold text-lg tracking-tight text-foreground">
                  Rihla Setup Assistant
                </h2>
              </div>
              <p className="text-xs text-muted-foreground font-medium mb-3">
                Let&apos;s get your CRM ready. Estimated setup time: 2 minutes
              </p>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                <span className="flex items-center gap-1"><Lock className="h-3 w-3 text-purple-500/70" /> Secure</span>
                <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-purple-500/70" /> Private</span>
              </div>
            </motion.div>

            {/* Chat Area */}
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto hide-scrollbar relative mask-image-bottom pb-32">
              <div className="space-y-4 px-2 flex flex-col">
                <AnimatePresence initial={false}>
                  {uiState.map((msg: UIMessage, index: number) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, scale: 0.96, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="flex flex-col"
                    >
                      {msg.role === 'user' ? msg.display : (
                        <div className="bg-white dark:bg-zinc-900/80 backdrop-blur-xl border border-black/5 dark:border-white/10 rounded-[24px] rounded-tl-[8px] px-6 py-4 text-[15px] max-w-[65%] shadow-sm overflow-hidden">
                          {msg.display}
                          {/* Render Suggested Actions only on the first AI message */}
                          {index === 0 && !currentUser && (
                            <div className="mt-4 flex flex-col gap-2">
                              <button onClick={() => send('Create an account')} className="text-left px-4 py-2 text-sm bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 rounded-full transition-colors font-medium">Create Workspace</button>
                              <button onClick={() => send('Log in')} className="text-left px-4 py-2 text-sm bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 rounded-full transition-colors font-medium">Sign In</button>
                              <button onClick={() => send('Preview CRM')} className="text-left px-4 py-2 text-sm bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 rounded-full transition-colors font-medium">Explore Demo</button>
                            </div>
                          )}
                          {index === 0 && currentUser && (
                            <div className="mt-4 flex flex-col gap-2">
                              <button onClick={() => router.push('/app')} className="text-left px-4 py-2 text-sm bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 rounded-full transition-colors font-medium">Go to Dashboard</button>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))}

                  {loading && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.96, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="flex flex-col"
                    >
                      <div className="bg-white dark:bg-zinc-900/80 backdrop-blur-xl border border-black/5 dark:border-white/10 rounded-[24px] rounded-tl-[8px] px-6 py-5 w-fit shadow-sm">
                        <div className="flex gap-1.5 items-center">
                          <div className="h-1.5 w-1.5 rounded-full bg-purple-500/60 animate-bounce"></div>
                          <div className="h-1.5 w-1.5 rounded-full bg-purple-500/60 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="h-1.5 w-1.5 rounded-full bg-purple-500/60 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Input Area */}
            <div className="absolute bottom-6 left-0 w-full px-4 pointer-events-none">
              <div className="w-full pointer-events-auto">
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="relative flex items-center bg-white/80 dark:bg-zinc-900/80 backdrop-blur-2xl rounded-[28px] border border-black/10 dark:border-white/10 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.1)] focus-within:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)] focus-within:border-purple-500/40 dark:focus-within:border-purple-500/40 transition-all p-1.5"
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
                    placeholder="Describe what you'd like to do..."
                    className="min-h-[44px] max-h-32 resize-none text-[14px] border-0 focus-visible:ring-0 shadow-none bg-transparent py-3 px-4 font-medium"
                    rows={1}
                  />
                  <Button
                    size="icon"
                    onClick={() => send()}
                    disabled={loading || !input.trim()}
                    className="shrink-0 h-10 w-10 rounded-full ml-2 bg-purple-600 text-white hover:bg-purple-700 transition-all self-end mb-[2px] mr-[2px]"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </motion.div>
                <p className="text-[10px] text-center text-muted-foreground mt-3 font-medium">
                  Rihla-Copilot can make mistakes. Please verify important information.
                </p>
              </div>
            </div>

          </div>
        </motion.div>

        {/* Right Panel (Progress or CRM Preview) */}
        <AnimatePresence mode="wait">
          {!previewMode ? (
            <motion.div
              key="progress"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.4 }}
              className="w-[280px] h-full hidden md:flex flex-col justify-center shrink-0 pl-8 border-l border-black/5 dark:border-white/5"
            >
              <h3 className="text-sm font-bold text-foreground mb-6 uppercase tracking-wider">Setup Progress</h3>
              {isStartingDemo ? (
                <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-semibold text-foreground">Starting Demo...</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Authenticating secure session...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {SETUP_STEPS.map((step, index) => {
                    const isCompleted = index < currentStepIndex;
                    const isActive = index === currentStepIndex;
                    return (
                      <div key={step.id} className="flex items-center gap-3">
                        <div className={`relative flex items-center justify-center w-6 h-6 rounded-full transition-colors ${isCompleted ? 'bg-purple-500 text-white' :
                            isActive ? 'bg-purple-500/20 text-purple-500 border border-purple-500/50' :
                              'bg-muted text-muted-foreground'
                          }`}>
                          {isCompleted ? <CheckCircle2 className="w-4 h-4" /> :
                            isActive ? <Circle className="w-3 h-3 fill-current animate-pulse" /> :
                              <span className="text-[10px] font-bold">{index + 1}</span>}
                        </div>
                        <span className={`text-sm font-medium transition-colors ${isActive ? 'text-foreground font-bold' :
                            isCompleted ? 'text-foreground' :
                              'text-muted-foreground'
                          }`}>
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
              initial={{ opacity: 0, x: 50, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.95 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="flex-[1.1] h-[90%] bg-background border border-border shadow-2xl rounded-[24px] overflow-hidden flex flex-col hidden md:flex relative"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500/80 shadow-sm" />
                    <div className="w-3 h-3 rounded-full bg-amber-500/80 shadow-sm" />
                    <div className="w-3 h-3 rounded-full bg-green-500/80 shadow-sm" />
                  </div>
                  <span className="ml-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest">Live Preview</span>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs hover:bg-destructive/10 hover:text-destructive transition-colors" onClick={handleExitPreview}>
                  Exit Preview
                </Button>
              </div>
              <div ref={previewInnerRef} className="flex-1 relative bg-zinc-50 dark:bg-black/50 overflow-hidden">
                <iframe
                  src="/app"
                  className="absolute inset-0 border-0 bg-background"
                  style={{
                    width: '111.11%',
                    height: '111.11%',
                    transform: 'scale(0.9)',
                    transformOrigin: 'top left'
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
