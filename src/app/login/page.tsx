'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { createClient } from '@/lib/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Cpu, AlertCircle, Database, ArrowLeft, Mail, CheckCircle2, Lock } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentUser = useCRMStore(state => state.currentUser);
  const sessionLoading = useCRMStore(state => state.sessionLoading);
  const login = useCRMStore(state => state.login);
  const dbMode = useCRMStore(state => state.dbMode);

  // Initialize initial state from URL search params
  const isVerified = searchParams.get('verified') === 'true';
  const verifiedEmail = searchParams.get('email');
  const flowParam = searchParams.get('flow');
  const typeParam = searchParams.get('type');

  const initialEmail = (isVerified && verifiedEmail) ? verifiedEmail : '';
  const initialFlow = (flowParam === 'reset' || typeParam === 'recovery') ? 'reset' : 'login';

  // Core login states
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  // 'login' | 'forgot' | 'code' | 'reset'
  const [flowView, setFlowView] = useState<'login' | 'forgot' | 'code' | 'reset'>(initialFlow);
  const [forgotEmail, setForgotEmail] = useState('');

  // Listen for Supabase recovery auth event
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    try {
      const supabase = createClient();
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
          setFlowView('reset');
        }
      });
      return () => subscription?.unsubscribe();
    } catch {
      // ignore
    }
  }, []);

  // Redirect if already authenticated and not in password-reset mode
  useEffect(() => {
    if (!sessionLoading && currentUser && flowView !== 'reset') {
      const destination = currentUser.role === 'super_admin' ? '/app/platform/dashboard' : '/app/dashboard';
      router.push(destination);
    }
  }, [currentUser, sessionLoading, router, flowView]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await login(email, password);
      if (!res.success) {
        setErrorMsg(res.error || 'Login failed.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failure.';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      setResetSuccess(true);
      setTimeout(() => {
        setFlowView('login');
        setResetSuccess(false);
        setNewPassword('');
        setConfirmPassword('');
      }, 2500);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update password.');
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
            {flowView === 'reset' ? 'Set New Password' : 'AI-Native Travel Architecture'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {flowView === 'reset' ? 'Choose a secure password for your account' : 'Next-generation CRM for travel operations'}
          </p>
        </div>

        {/* Dynamic content view */}
        <AnimatePresence mode="wait">
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </motion.div>
          )}

          {resetSuccess && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Password successfully updated! Redirecting to login...</span>
            </motion.div>
          )}

          {/* MAIN LOGIN FORM */}
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
                  placeholder="agent@company.com"
                  required
                  className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Password</label>
                  <button
                    type="button"
                    onClick={() => setFlowView('forgot')}
                    className="text-[10px] text-primary hover:underline font-medium"
                  >
                    Forgot Password?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all cursor-pointer shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 mt-2"
              >
                {loading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    <span>Sign In</span>
                  </>
                )}
              </button>
            </motion.form>
          )}

          {/* FORGOT PASSWORD FORM */}
          {flowView === 'forgot' && (
            <motion.form
              key="forgot-form"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!forgotEmail) return;
                setErrorMsg('Password reset instructions are dispatched to your registered address. Please contact your platform administrator if you need an invitation resent.');
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
                <span>Submit Request</span>
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

          {/* SET NEW PASSWORD (RECOVERY FLOW) */}
          {flowView === 'reset' && (
            <motion.form
              key="reset-form"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              onSubmit={handleUpdatePassword}
              className="space-y-4 text-xs"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                  className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  required
                  className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all cursor-pointer shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 mt-2"
              >
                {loading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    <span>Save Password & Continue</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setFlowView('login')}
                className="w-full h-10 rounded-xl bg-background border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/30 font-semibold transition-all cursor-pointer flex items-center justify-center gap-1"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Cancel</span>
              </button>
            </motion.form>
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
