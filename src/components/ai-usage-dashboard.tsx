'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Cpu, DollarSign, MessageSquare, BarChart3, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { aiClient } from '@/lib/ai/ai-client';

export function AIUsageDashboard() {
  const budgetStatus = aiClient.getBudgetStatus();
  const usageByFeature = aiClient.getUsageByFeature();

  const features = [
    { key: 'chatbot_fallback', label: 'Chatbot AI', icon: MessageSquare },
    { key: 'email_generation', label: 'Email Generation', icon: Cpu },
    { key: 'lead_scoring', label: 'Lead Scoring', icon: BarChart3 },
    { key: 'predictive_analytics', label: 'Predictive Analytics', icon: BarChart3 },
  ];

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight font-heading">AI Usage & Cost Monitor</h2>
          <p className="text-sm text-muted-foreground font-medium mt-1">Track API usage and stay within budget.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Monthly Budget', value: `$${budgetStatus.monthlyBudget.toFixed(2)}`, icon: DollarSign },
            { label: 'Current Spend', value: `$${budgetStatus.currentSpend.toFixed(2)}`, icon: BarChart3 },
            { label: 'Remaining', value: `$${budgetStatus.remaining.toFixed(2)}`, icon: CheckCircle2 },
            { label: 'Budget Used', value: `${budgetStatus.percentageUsed.toFixed(1)}%`, icon: AlertTriangle },
          ].map((stat, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={`p-5 rounded-2xl border shadow-sm ${
                budgetStatus.isExhausted
                  ? 'bg-red-50 border-red-200'
                  : budgetStatus.isNearLimit
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-white/80 border-border/60'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`p-2.5 rounded-xl ${
                  budgetStatus.isExhausted ? 'bg-red-100' : budgetStatus.isNearLimit ? 'bg-amber-100' : 'bg-primary/10'
                }`}>
                  <stat.icon className={`h-5 w-5 ${
                    budgetStatus.isExhausted ? 'text-red-600' : budgetStatus.isNearLimit ? 'text-amber-600' : 'text-primary'
                  }`} />
                </div>
                <span className="text-[10px] font-bold font-mono px-2 py-1 rounded-full bg-secondary">
                  {budgetStatus.isExhausted ? 'EXHAUSTED' : budgetStatus.isNearLimit ? 'NEAR LIMIT' : 'OK'}
                </span>
              </div>
              <h3 className={`text-2xl font-bold font-heading ${budgetStatus.isExhausted ? 'text-red-700' : budgetStatus.isNearLimit ? 'text-amber-700' : 'text-foreground'}`}>
                {stat.value}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        <div className="rounded-2xl bg-white/80 border border-border/60 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border/40">
            <h3 className="text-base font-bold text-foreground font-heading">Usage by Feature</h3>
            <p className="text-xs text-muted-foreground mt-1">Requests and cost breakdown per AI feature.</p>
          </div>
          <div className="divide-y divide-border/40">
            {features.map((feature) => {
              const usage = usageByFeature[feature.key] || { requests: 0, tokens: 0, cost: 0 };
              return (
                <div key={feature.key} className="p-5 flex items-center justify-between hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                      usage.cost > 0 ? 'bg-primary/10' : 'bg-secondary'
                    }`}>
                      <feature.icon className={`h-5 w-5 ${usage.cost > 0 ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground">{feature.label}</h4>
                      <p className="text-xs text-muted-foreground font-mono">
                        {usage.requests} requests • {usage.tokens.toLocaleString()} tokens
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold font-mono ${usage.cost > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                      ${usage.cost.toFixed(4)}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono">this month</p>
                  </div>
                </div>
              );
            })}
            {Object.keys(usageByFeature).length === 0 && (
              <div className="p-8 text-center text-muted-foreground font-mono text-sm">
                No AI usage recorded yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white/80 border border-border/60 shadow-sm p-6">
          <h3 className="text-base font-bold text-foreground font-heading mb-4">Budget Controls</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Monthly Budget (₹)</label>
              <div className="h-10 px-4 rounded-xl bg-white border border-input text-sm font-mono">
                {budgetStatus.monthlyBudget.toFixed(2)}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Configure in Settings → AI Configuration</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Status</label>
              <div className={`h-10 px-4 rounded-xl flex items-center text-sm font-semibold ${
                budgetStatus.isExhausted
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : budgetStatus.isNearLimit
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}>
                {budgetStatus.isExhausted ? 'Budget Exhausted - Using Fallbacks' : budgetStatus.isNearLimit ? 'Near Limit - Monitoring Closely' : 'Healthy - Within Budget'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}