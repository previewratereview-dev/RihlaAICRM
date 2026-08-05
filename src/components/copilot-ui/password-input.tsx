'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { OtpInput } from './otp-input';

export function PasswordInput({ email, fullName, agencyName }: { email: string, fullName: string, agencyName: string }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationData, setRegistrationData] = useState<{ token: string } | null>(null);
  const router = useRouter();
  const dbMode = useCRMStore(state => state.dbMode);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, password, agencyName }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Registration failed.');
        return;
      }

      if (dbMode === 'local') {
        const user = {
          id: data.userId,
          tenantId: data.tenantId,
          fullName,
          email,
          role: 'admin',
          avatarUrl: '',
          isOnline: true,
          status: 'active',
        };
        const team = JSON.parse(localStorage.getItem('crm_team') || '[]');
        team.push(user);
        localStorage.setItem('crm_team', JSON.stringify(team));
        const passwords = JSON.parse(localStorage.getItem('crm_team_passwords') || '{}');
        passwords[data.userId] = password;
        localStorage.setItem('crm_team_passwords', JSON.stringify(passwords));
        
        setSuccess(true);
        setTimeout(() => router.push('/app'), 1500);
      } else {
        // Supabase mode: registration created the account and sent an OTP email.
        // Instead of redirecting to /auth/confirm, show the OTP input inline
        // in the copilot chat so the user never leaves the conversation.
        setRegistrationData({ token: data.token });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  // Local mode success — account created, go to dashboard
  if (success) {
    return (
      <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex flex-col items-center justify-center text-center space-y-2 mt-4">
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Account created successfully!</p>
        <p className="text-xs text-muted-foreground">Redirecting you to the dashboard...</p>
      </div>
    );
  }

  // Supabase mode — registration succeeded, now show inline OTP verification
  if (registrationData) {
    return (
      <OtpInput
        email={email}
        password={password}
        token={registrationData.token}
        agencyName={agencyName}
      />
    );
  }

  return (
    <div className="p-4 rounded-xl border border-border bg-card shadow-sm mt-4">
      <h3 className="font-semibold text-sm mb-1">Set Your Password</h3>
      <p className="text-xs text-muted-foreground mb-4">You&apos;re almost done setting up {agencyName}.</p>
      
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
          required
          className="w-full h-9 rounded-lg bg-background border border-input px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
        />
        
        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-9 rounded-lg bg-primary hover:bg-primary/90 disabled:bg-primary/40 text-primary-foreground font-semibold text-xs transition-all shadow-md shadow-primary/20 flex items-center justify-center gap-1.5"
        >
          {loading ? (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              <span>Complete Setup</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}