'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { motion } from 'framer-motion';
import { Sparkles, Cpu, AlertCircle, Database } from 'lucide-react';
import type { User } from '@/types';

export default function RegisterPage() {
  const router = useRouter();
  const currentUser = useCRMStore(state => state.currentUser);
  const sessionLoading = useCRMStore(state => state.sessionLoading);
  const dbMode = useCRMStore(state => state.dbMode);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionLoading && currentUser) {
      router.push('/app');
    }
  }, [currentUser, sessionLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !email || !password || !agencyName) {
      setErrorMsg('All fields are required.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, password, agencyName }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || 'Registration failed.');
        return;
      }

      const user: User = {
        id: data.userId,
        tenantId: data.tenantId,
        fullName,
        email,
        role: 'admin',
        avatarUrl: '',
        isOnline: true,
        status: 'active',
      };

      if (dbMode === 'local') {
        const team: User[] = JSON.parse(localStorage.getItem('crm_team') || '[]');
        team.push(user);
        localStorage.setItem('crm_team', JSON.stringify(team));
        const passwords: Record<string, string> = JSON.parse(localStorage.getItem('crm_team_passwords') || '{}');
        passwords[data.userId] = password;
        localStorage.setItem('crm_team_passwords', JSON.stringify(passwords));
        router.push('/app');
      } else {
        // In Supabase mode, redirect to email verification
        router.push(`/auth/confirm?token=${data.token}&email=${encodeURIComponent(email)}`);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  if (sessionLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background select-none">
        <div className="flex flex-col items-center gap-4">
          <img src="/logo.png" className="h-10 w-auto object-contain animate-pulse" alt="Rihla Logo" />
          <div className="flex flex-col items-center gap-1">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
            <span className="font-mono text-[9px] text-[#64748B] mt-2">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-4 select-none relative overflow-hidden font-sans">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#2563EB]/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[45%] h-[45%] rounded-full bg-[#2563EB]/5 blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md bg-card/80 backdrop-blur-md border border-border/60 shadow-sm rounded-[24px] p-8 flex flex-col justify-between"
      >
        <div className="text-center space-y-2 mb-8">
          <div className="flex justify-center mb-4">
            <img src="/logo.png" className="h-12 w-auto object-contain" alt="Rihla Logo" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary/80 border border-border/60 mb-2 font-mono text-[9px] font-bold text-muted-foreground">
            <Cpu className="h-3 w-3 text-primary" />
            <span>Rihla</span>
          </div>
          <h2 className="text-lg font-bold text-foreground tracking-tight font-heading">
            Create Your Agency
          </h2>
          <p className="text-xs text-muted-foreground font-medium">
            Set up your agency workspace and start managing leads.
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-3 rounded-xl bg-red-50 border border-red-100 flex items-start gap-2.5 text-red-700 text-xs leading-relaxed">
            <AlertCircle className="h-4.5 w-4.5 text-red-500 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <motion.form
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onSubmit={handleSubmit}
          className="space-y-4 text-xs"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Rayees Amin"
              required
              className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all font-sans"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. you@agency.com"
              required
              className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all font-sans"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Agency Name</label>
            <input
              type="text"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              placeholder="e.g. Rihla Travel Agency"
              required
              className="h-10 rounded-xl bg-background border border-input px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all font-sans"
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
                <span>Create Agency</span>
              </>
            )}
          </button>
        </motion.form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <a href="/login" className="text-primary font-semibold hover:underline">
            Sign in
          </a>
        </p>

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
