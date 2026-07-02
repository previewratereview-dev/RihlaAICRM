'use client';

import React from 'react';
import { Check, Zap, Crown, Infinity } from 'lucide-react';
import { motion } from 'framer-motion';

interface PricingCardsProps {
  onSelectPlan: (plan: string) => void;
  loading?: string | null;
  currentPlan?: string;
}

const plans = [
  {
    id: 'monthly',
    name: 'Monthly',
    price: '₹499',
    period: '/month',
    icon: Zap,
    color: 'from-blue-500 to-blue-600',
    borderColor: 'border-blue-200 hover:border-blue-400',
    badgeColor: 'bg-blue-100 text-blue-700',
    features: [
      'Full access to all CRM features',
      'AI-powered lead scoring',
      'Up to 25 team members',
      '10,000 AI calls/month',
      'Priority support',
    ],
  },
  {
    id: 'yearly',
    name: 'Yearly',
    price: '₹5,199',
    period: '/year',
    icon: Crown,
    color: 'from-violet-500 to-purple-600',
    borderColor: 'border-violet-200 hover:border-violet-400',
    badgeColor: 'bg-violet-100 text-violet-700',
    popular: true,
    savings: 'Save ₹889/year',
    features: [
      'Everything in Monthly',
      '2 months free',
      'Advanced analytics',
      '50,000 AI calls/month',
      'Dedicated account manager',
    ],
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    price: '₹24,999',
    period: 'one-time',
    icon: Infinity,
    color: 'from-amber-500 to-orange-600',
    borderColor: 'border-amber-200 hover:border-amber-400',
    badgeColor: 'bg-amber-100 text-amber-700',
    savings: 'Best value',
    features: [
      'Everything in Yearly',
      'Pay once, use forever',
      '100,000 AI calls/month',
      'Premium AI models',
      'White-label options',
      'Custom integrations',
    ],
  },
];

export function PricingCards({ onSelectPlan, loading, currentPlan }: PricingCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
      {plans.map((plan, index) => (
        <motion.div
          key={plan.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          className={`relative rounded-2xl border-2 ${plan.borderColor} bg-card p-6 flex flex-col ${
            plan.popular ? 'shadow-lg scale-105' : 'shadow-sm'
          }`}
        >
          {plan.popular && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="bg-gradient-to-r from-violet-500 to-purple-600 text-white text-xs font-bold px-4 py-1 rounded-full">
                Most Popular
              </span>
            </div>
          )}

          {plan.savings && !plan.popular && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className={`${plan.badgeColor} text-xs font-bold px-4 py-1 rounded-full`}>
                {plan.savings}
              </span>
            </div>
          )}

          <div className="text-center mb-6 pt-4">
            <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${plan.color} text-white mb-3`}>
              <plan.icon className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
            <div className="mt-2">
              <span className="text-3xl font-bold text-foreground">{plan.price}</span>
              <span className="text-muted-foreground text-sm">{plan.period}</span>
            </div>
          </div>

          <ul className="space-y-3 mb-6 flex-1">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{feature}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={() => onSelectPlan(plan.id)}
            disabled={loading === plan.id || currentPlan === plan.id}
            className={`w-full py-3 rounded-xl font-semibold transition-all ${
              currentPlan === plan.id
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : `bg-gradient-to-r ${plan.color} text-white hover:opacity-90 shadow-md`
            }`}
          >
            {loading === plan.id ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent mx-auto" />
            ) : currentPlan === plan.id ? (
              'Current Plan'
            ) : (
              'Get Started'
            )}
          </button>
        </motion.div>
      ))}
    </div>
  );
}
