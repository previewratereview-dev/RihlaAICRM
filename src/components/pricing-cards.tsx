'use client';

import React, { useState } from 'react';
import { Check, Zap, Crown, Gem } from 'lucide-react';
import { motion } from 'framer-motion';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface PricingCardsProps {
  onSelectPlan: (plan: string) => void;
  loading?: string | null;
  currentPlan?: string;
}

type BillingPeriod = 'monthly' | 'yearly';

interface PeriodPricing {
  id: string;
  price: string;
  period: string;
  monthlyEquivalent?: string;
  savings?: string;
}

interface PlanTier {
  tier: string;
  name: string;
  icon: typeof Zap;
  color: string;
  borderColor: string;
  badgeColor: string;
  popular?: boolean;
  features: string[];
  pricing: Record<BillingPeriod, PeriodPricing>;
}

// Plan IDs must match backend PLAN_PRICES keys in lib/razorpay.ts
const planTiers: PlanTier[] = [
  {
    tier: 'starter',
    name: 'Starter',
    icon: Zap,
    color: 'from-blue-500 to-blue-600',
    borderColor: 'border-blue-200 hover:border-blue-400',
    badgeColor: 'bg-blue-100 text-blue-700',
    features: [
      'Up to 5 team members',
      '10 GB storage',
      '2,000 AI calls/month',
      'Custom AI provider keys',
      'Custom branding (logo, colors)',
      'Email support',
    ],
    pricing: {
      monthly: { id: 'starter_monthly', price: '₹999', period: '/month' },
      yearly: {
        id: 'starter_yearly',
        price: '₹9,990',
        period: '/year',
        monthlyEquivalent: '~₹833/mo',
        savings: 'Save ₹1,998/year',
      },
    },
  },
  {
    tier: 'pro',
    name: 'Pro',
    icon: Crown,
    color: 'from-violet-500 to-purple-600',
    borderColor: 'border-violet-200 hover:border-violet-400',
    badgeColor: 'bg-violet-100 text-violet-700',
    popular: true,
    features: [
      'Up to 20 team members',
      '50 GB storage',
      '20,000 AI calls/month',
      'Multi-provider AI support',
      'Advanced analytics & reports',
      'Custom branding + banner images',
      'Custom email templates',
      'Priority support',
    ],
    pricing: {
      monthly: { id: 'pro_monthly', price: '₹2,499', period: '/month' },
      yearly: {
        id: 'pro_yearly',
        price: '₹24,990',
        period: '/year',
        monthlyEquivalent: '~₹2,083/mo',
        savings: 'Save ₹4,998/year',
      },
    },
  },
  {
    tier: 'premium',
    name: 'Premium',
    icon: Gem,
    color: 'from-amber-500 to-orange-600',
    borderColor: 'border-amber-200 hover:border-amber-400',
    badgeColor: 'bg-amber-100 text-amber-700',
    features: [
      'Up to 50 team members',
      '200 GB storage',
      '100,000 AI calls/month',
      'Platform-managed AI (premium models)',
      'White-label login page',
      'Remove "Powered by" branding',
      'Custom email templates',
      'Dedicated account manager',
    ],
    pricing: {
      monthly: { id: 'premium_monthly', price: '₹4,999', period: '/month' },
      yearly: {
        id: 'premium_yearly',
        price: '₹49,990',
        period: '/year',
        monthlyEquivalent: '~₹4,166/mo',
        savings: 'Save ₹9,998/year',
      },
    },
  },
];

function getButtonLabel(planId: string, tier: string, currentPlan?: string): string {
  if (currentPlan === planId) return 'Current Plan';
  if (currentPlan?.startsWith(`${tier}_`)) {
    return planId.endsWith('_yearly') ? 'Switch to Yearly' : 'Switch to Monthly';
  }
  return 'Get Started';
}

function PlanGrid({
  period,
  onSelectPlan,
  loading,
  currentPlan,
}: {
  period: BillingPeriod;
  onSelectPlan: (plan: string) => void;
  loading?: string | null;
  currentPlan?: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {planTiers.map((tier, index) => {
        const pricing = tier.pricing[period];
        const planId = pricing.id;
        const isCurrent = currentPlan === planId;

        return (
          <motion.div
            key={`${tier.tier}-${period}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className={`relative rounded-2xl border-2 ${tier.borderColor} bg-card p-6 flex flex-col ${
              tier.popular ? 'shadow-lg ring-2 ring-violet-500/50' : 'shadow-sm'
            }`}
          >
            {tier.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-gradient-to-r from-violet-500 to-purple-600 text-white text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap">
                  Most Popular
                </span>
              </div>
            )}

            {period === 'yearly' && pricing.savings && !tier.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className={`${tier.badgeColor} text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap`}>
                  {pricing.savings}
                </span>
              </div>
            )}

            <div className="text-center mb-6 pt-4">
              <div
                className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${tier.color} text-white mb-3`}
              >
                <tier.icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-foreground">{tier.name}</h3>
              <div className="mt-2">
                <span className="text-3xl font-bold text-foreground">{pricing.price}</span>
                <span className="text-muted-foreground text-sm">{pricing.period}</span>
              </div>
              {period === 'yearly' && pricing.monthlyEquivalent && (
                <p className="text-xs text-muted-foreground mt-1">{pricing.monthlyEquivalent} billed annually</p>
              )}
            </div>

            <ul className="space-y-3 mb-6 flex-1">
              {tier.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => onSelectPlan(planId)}
              disabled={loading === planId || isCurrent}
              aria-label={`Subscribe to ${tier.name} ${period} plan`}
              className={`w-full py-3 rounded-xl font-semibold transition-all ${
                isCurrent
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : `bg-gradient-to-r ${tier.color} text-white hover:opacity-90 shadow-md`
              }`}
            >
              {loading === planId ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent mx-auto" />
              ) : (
                getButtonLabel(planId, tier.tier, currentPlan)
              )}
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}

export function PricingCards({ onSelectPlan, loading, currentPlan }: PricingCardsProps) {
  const [period, setPeriod] = useState<BillingPeriod>(
    currentPlan?.endsWith('_yearly') ? 'yearly' : 'monthly'
  );
  const [prevPlan, setPrevPlan] = useState(currentPlan);

  if (currentPlan !== prevPlan) {
    setPrevPlan(currentPlan);
    setPeriod(currentPlan?.endsWith('_yearly') ? 'yearly' : 'monthly');
  }

  return (
    <Tabs
      value={period}
      onValueChange={(value) => setPeriod(value as BillingPeriod)}
      className="w-full"
    >
      <div className="flex justify-center mb-6">
        <TabsList className="h-10 p-1" aria-label="Billing period">
          <TabsTrigger value="monthly" className="px-6">
            Monthly
          </TabsTrigger>
          <TabsTrigger value="yearly" className="px-6 gap-2">
            Yearly
            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded">
              2 mo free
            </span>
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="monthly">
        <PlanGrid
          period="monthly"
          onSelectPlan={onSelectPlan}
          loading={loading}
          currentPlan={currentPlan}
        />
      </TabsContent>

      <TabsContent value="yearly">
        <PlanGrid
          period="yearly"
          onSelectPlan={onSelectPlan}
          loading={loading}
          currentPlan={currentPlan}
        />
      </TabsContent>
    </Tabs>
  );
}
