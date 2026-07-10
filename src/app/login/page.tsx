'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Cpu, AlertCircle, Database, ArrowLeft, ShieldCheck, Mail } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const currentUser = useCRMStore(state => state.currentUser);
  const sessionLoading = useCRMStore(state => state.sessionLoading);
  const login = useCRMStore(state => state.login);
  const dbMode = useCRMStore(state => state.dbMode);

  // Core login states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot password flow states
  // 'login' | 'forgot' | 'code' | 'reset'
  const [flowView, setFlowView] = useState<'login' | 'forgot' | 'code' | 'reset'>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [resetSuccess, setResetSuccess] = useState(false);

  // AuthBridge handles session restore via setAuthAdapter
  // No need to call restoreSession manually — it's handled by the bridge

  // Redirect if already authenticated
  useEffect(() => {
    if (!sessionLoading && currentUser) {
      router.push('/');
    }
  }, [currentUser, sessionLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await login(email, password);
      if (res.success) {
        const statusRes = await fetch('/api/platform/status');
        const status = await statusRes.json();
        const user = useCRMStore.getState().currentUser;
        if (status.maintenanceMode && user?.role !== 'super_admin') {
          await useCRMStore.getState().logout();
          setErrorMsg('Platform is in maintenance mode. Only super admins can sign in.');
          return;
        }
        router.push('/');
      } else {
        setErrorMsg(res.error || 'Login failed.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failure.';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };


  // Safety timeout: if login page gets stuck loading for more than 4s, force it open
  useEffect(() => {
    if (!sessionLoading) return;
    const timer = setTimeout(() => {
      if (useCRMStore.getState().sessionLoading) {
        useCRMStore.setState({ sessionLoading: false });
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [sessionLoading]);

  if (sessionLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background select-none">
        <div className="flex flex-col items-center gap-4">
          <img src="/logo.png" className="h-10 w-auto object-contain animate-pulse" alt="Rihla Logo" />
          <div className="flex flex-col items-center gap-1">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="font-mono text-[9px] text-muted-foreground mt-2">Authenticating secure node...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-4 select-none relative overflow-hidden font-sans">
      {/* Background soft ambient blur shapes */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#2563EB]/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[45%] h-[45%] rounded-full bg-[#2563EB]/5 blur-[120px] pointer-events-none" />

      {/* Main glass panel wrapper */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md bg-card/80 backdrop-blur-md border border-border/60 shadow-sm rounded-[24px] p-8 flex flex-col justify-between"
      >
        
        {/* Logo and Headings */}
        <div className="text-center space-y-2 mb-8">
          <div className="flex justify-center mb-4">
            <img src="/logo.png" className="h-12 w-auto object-contain" alt="Rihla Logo" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary/80 border border-border/60 mb-2 font-mono text-[9px] font-bold text-muted-foreground">
            <Cpu className="h-3 w-3 text-primary" />
            <span>Rihla</span>
          </div>
          <h2 className="text-lg font-bold text-foreground tracking-tight font-heading">
            {flowView === 'login' && 'Access Control Terminal'}
            {flowView === 'forgot' && 'Account Recovery'}
            {flowView === 'code' && 'Verification Code'}
            {flowView === 'reset' && 'Reset Secure Password'}
          </h2>
          <p className="text-xs text-muted-foreground font-medium">
            {flowView === 'login' && 'Sign in to verify node credentials and synchronize leads.'}
            {flowView === 'forgot' && 'Enter your registered email to receive a recovery code.'}
            {flowView === 'code' && 'Enter the mock code 849202 to unlock password resets.'}
            {flowView === 'reset' && 'Enter your new credentials to replace forgotten values.'}
          </p>
        </div>

        {/* Dynamic Alerts */}
        {errorMsg && (
          <div className="mb-6 p-3 rounded-xl bg-red-50 border border-red-100 flex items-start gap-2.5 text-red-700 text-xs leading-relaxed">
            <AlertCircle className="h-4.5 w-4.5 text-red-500 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {resetSuccess && (
          <div className="mb-6 p-3.5 rounded-xl bg-emerald-50 border border-emerald-100 flex items-start gap-2.5 text-emerald-800 text-xs leading-relaxed">
            <ShieldCheck className="h-4.5 w-4.5 text-emerald-600 shrink-0 mt-0.5" />
            <span>Password updated successfully! Directing you back to login portal...</span>
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* LOGIN VIEW */}
          {flowView === 'login' && (
            <motion.form
              key="login-form"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              onSubmit={handleSubmit}
              className="space-y-4 text-xs"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. user@stateai.com"
                  required
                  className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all font-sans"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setFlowView('forgot');
                      setErrorMsg(null);
                    }}
                    className="text-primary font-mono text-[9px] uppercase font-bold hover:underline cursor-pointer bg-transparent border-none"
                  >
                    Forgot Password?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter secure password"
                  required
                  className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-10 rounded-xl bg-primary hover:bg-primary/90 disabled:bg-primary/40 text-primary-foreground font-semibold transition-all cursor-pointer shadow-md shadow-primary/20 flex items-center justify-center gap-1.5 mt-2"
              >
                {loading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    <span>Initialize Node Session</span>
                  </>
                )}
              </button>
            </motion.form>
          )}

          {/* FORGOT PASSWORD EMAIL */}
          {flowView === 'forgot' && (
            <motion.form
              key="forgot-form"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!forgotEmail) return;
                setErrorMsg('Password reset is handled by Supabase Auth. Use your Supabase-issued credentials to sign in.');
                setFlowView('login');
              }}
              className="space-y-4 text-xs"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Registered Email</label>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>

              <button
                type="submit"
                className="w-full h-10 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground font-semibold transition-all cursor-pointer shadow-sm flex items-center justify-center gap-1.5 mt-2"
              >
                <Mail className="h-4 w-4" />
                <span>Continue to Supabase Reset</span>
              </button>

              <button
                type="button"
                onClick={() => setFlowView('login')}
                className="w-full h-10 rounded-xl bg-background border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/30 font-semibold transition-all cursor-pointer flex items-center justify-center gap-1"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Return to Login</span>
              </button>
            </motion.form>
          )}

          {/* Supabase-managed reset CTA only */}
          {flowView === 'code' && (
            <motion.div key="code-notice" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-3 text-xs">
              <p className="text-muted-foreground">Password reset is handled by Supabase Auth. Continue there from the login screen and use your Supabase-managed account.</p>
              <button
                type="button"
                onClick={() => setFlowView('login')}
                className="w-full h-10 rounded-xl bg-background border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/30 font-semibold transition-all cursor-pointer flex items-center justify-center gap-1"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Login</span>
              </button>
            </motion.div>
          )}

          {flowView === 'reset' && (
            <motion.div key="reset-notice" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-3 text-xs">
              <p className="text-muted-foreground">Password resets are managed in Supabase Auth. Use the official reset flow from the login screen.</p>
              <button
                type="button"
                onClick={() => setFlowView('login')}
                className="w-full h-10 rounded-xl bg-background border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/30 font-semibold transition-all cursor-pointer flex items-center justify-center gap-1"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Login</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Role guidance */}
        {flowView === 'login' && (
          <>
            <p className="mt-6 text-center text-muted-foreground font-mono text-[9px]">
              Unified role-based access: use your assigned account to sign in.
            </p>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Don&apos;t have an account?{' '}
              <a href="/register" className="text-primary font-semibold hover:underline">
                Register
              </a>
            </p>
          </>
        )}

        {/* Database status footer */}
        <div className="mt-6 flex items-center justify-center gap-1.5 text-[10px] font-mono text-muted-foreground">
          <Database className="h-3 w-3 text-primary" />
          <span>DB Status:</span>
          <span className={dbMode === 'supabase' ? 'text-emerald-600 font-bold' : 'text-muted-foreground'}>
            {dbMode === 'supabase' ? 'Supabase Connected' : 'Local Mock Mode'}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
