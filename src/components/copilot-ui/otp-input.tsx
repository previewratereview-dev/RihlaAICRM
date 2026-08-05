'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { KeyRound, CheckCircle2, RefreshCw, Mail } from 'lucide-react';

/**
 * Inline OTP verification component for the Rihla Copilot chat flow.
 * After the user sets their password via <PasswordInput>, this component
 * collects the 6-digit email verification code, verifies it, and then
 * auto-logs the user in — all without leaving the copilot conversation.
 */
export function OtpInput({
  email,
  password,
  token,
  agencyName,
}: {
  email: string;
  password: string;
  token: string;
  agencyName: string;
}) {
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const router = useRouter();
  const login = useCRMStore((state) => state.login);

  useEffect(() => {
    // Auto-focus the first OTP input on mount
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) return;
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').slice(0, 6);
    const newOtp = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) {
      if (/^\d$/.test(pasted[i])) {
        newOtp[i] = pasted[i];
      }
    }
    setOtp(newOtp);
    // Focus the last filled input or the next empty one
    const lastFilled = pasted.length - 1;
    inputRefs.current[Math.min(lastFilled + 1, 5)]?.focus();
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpString = otp.join('');
    if (otpString.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Step 1: Verify the OTP
      const verifyRes = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: otpString, token }),
      });

      const verifyData = await verifyRes.json();

      if (!verifyRes.ok) {
        setError(verifyData.error || 'Verification failed');
        return;
      }

      // Step 2: Auto-login the user (we already have their credentials)
      const loginResult = await login(email, password);
      if (!loginResult.success) {
        // If auto-login fails, redirect to login page with pre-filled email
        setSuccess(true);
        setTimeout(() => {
          router.push(`/login?verified=true&email=${encodeURIComponent(email)}`);
        }, 1500);
        return;
      }

      // Step 3: Redirect to dashboard
      setSuccess(true);
      setTimeout(() => {
        router.push('/app');
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setResending(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to resend code');
        return;
      }

      setCountdown(30);
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resend');
    } finally {
      setResending(false);
    }
  };

  if (success) {
    return (
      <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex flex-col items-center justify-center text-center space-y-2 mt-4">
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Email Verified!</p>
        <p className="text-xs text-muted-foreground">Taking you to your dashboard...</p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl border border-border bg-card shadow-sm mt-4">
      <div className="flex items-center gap-2 mb-1">
        <Mail className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">Verify Your Email</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        We sent a 6-digit code to <span className="font-semibold text-foreground">{email}</span>
      </p>

      {error && (
        <p className="text-xs text-destructive mb-3 bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
      )}

      <form onSubmit={handleVerify} className="space-y-4">
        <div className="flex justify-center gap-2">
          {otp.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { inputRefs.current[index] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleOtpChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onPaste={handlePaste}
              className="w-10 h-12 text-center text-lg font-bold bg-background border border-input rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            />
          ))}
        </div>

        <button
          type="submit"
          disabled={loading || otp.join('').length !== 6}
          className="w-full h-9 rounded-lg bg-primary hover:bg-primary/90 disabled:bg-primary/40 text-primary-foreground font-semibold text-xs transition-all shadow-md shadow-primary/20 flex items-center justify-center gap-1.5"
        >
          {loading ? (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <>
              <KeyRound className="h-3 w-3" />
              <span>Verify & Continue</span>
            </>
          )}
        </button>
      </form>

      <div className="mt-3 text-center">
        <button
          onClick={handleResend}
          disabled={resending || countdown > 0}
          className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline inline-flex items-center gap-1.5"
        >
          {resending ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
        </button>
      </div>
    </div>
  );
}