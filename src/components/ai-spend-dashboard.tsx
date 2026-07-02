'use client';

import React, { useEffect, useState } from 'react';
import { CRMDatabaseService } from '@/lib/db-service';
import { motion } from 'framer-motion';
import { TrendingUp, Wallet, ShieldCheck, ShieldAlert } from 'lucide-react';

interface SpendEntry {
  id: string;
  feature: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costEstimate: number;
  status: string;
  createdAt: string;
}

export function AISpendDashboard() {
  const [entries, setEntries] = useState<SpendEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await CRMDatabaseService.getAIUsage(100);
        if (!cancelled) setEntries(data);
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalSpend = entries.reduce((sum, entry) => sum + (entry.costEstimate || 0), 0);
  const blockedCount = entries.filter((e) => e.status === 'blocked').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-5 rounded-2xl bg-white/80 border border-border/60 shadow-sm">
          <Wallet className="h-5 w-5 text-primary mb-3" />
          <h3 className="text-2xl font-bold">${totalSpend.toFixed(2)}</h3>
          <p className="text-sm text-muted-foreground mt-1">Estimated spend</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="p-5 rounded-2xl bg-white/80 border border-border/60 shadow-sm">
          <TrendingUp className="h-5 w-5 text-primary mb-3" />
          <h3 className="text-2xl font-bold">{entries.length}</h3>
          <p className="text-sm text-muted-foreground mt-1">Total AI calls</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="p-5 rounded-2xl bg-white/80 border border-border/60 shadow-sm">
          <ShieldCheck className="h-5 w-5 text-emerald-600 mb-3" />
          <h3 className="text-2xl font-bold">{entries.length - blockedCount}</h3>
          <p className="text-sm text-muted-foreground mt-1">Allowed requests</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="p-5 rounded-2xl bg-white/80 border border-border/60 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-red-600 mb-3" />
          <h3 className="text-2xl font-bold">{blockedCount}</h3>
          <p className="text-sm text-muted-foreground mt-1">Blocked by budget</p>
        </motion.div>
      </div>

      <div className="rounded-2xl bg-white/80 border border-border/60 shadow-sm p-6">
        <h3 className="text-base font-bold mb-4">Recent AI Usage</h3>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading usage data...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI usage recorded yet.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {entries.slice(0, 20).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-semibold">{entry.feature}</div>
                  <div className="text-xs text-muted-foreground">
                    {entry.provider} · {entry.model} · {entry.status}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">${entry.costEstimate.toFixed(4)}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {entry.tokensIn} in / {entry.tokensOut} out
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
