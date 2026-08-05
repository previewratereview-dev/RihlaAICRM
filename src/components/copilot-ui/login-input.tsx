'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { motion } from 'framer-motion';
import { Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LoginInput() {
  const router = useRouter();
  const login = useCRMStore(state => state.login);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
          setErrorMsg('Platform is in maintenance mode.');
          setLoading(false);
          return;
        }
        router.push('/app');
      } else {
        setErrorMsg(res.error || 'Login failed.');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Connection failure.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-5 bg-background border border-border shadow-sm rounded-xl mt-2 w-full max-w-sm"
    >
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        Secure Login
      </h3>
      
      {errorMsg && (
        <div className="mb-4 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 flex items-start gap-2 text-red-700 dark:text-red-400 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Email</label>
          <Input 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            placeholder="you@company.com" 
            required 
            className="h-9 text-sm"
          />
        </div>
        
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Password</label>
          <Input 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            placeholder="••••••••" 
            required 
            className="h-9 text-sm"
          />
        </div>
        
        <Button 
          type="submit" 
          disabled={loading} 
          className="w-full h-9 mt-2 text-sm font-medium"
        >
          {loading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
          ) : (
            'Log In'
          )}
        </Button>
      </form>
    </motion.div>
  );
}
