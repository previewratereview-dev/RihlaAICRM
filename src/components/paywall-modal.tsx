'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Lock, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { PricingCards } from '@/components/pricing-cards';

interface PaywallModalProps {
  isOpen: boolean;
  onClose?: () => void;
  currentPlan?: string;
}

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayResponse) => void;
  prefill?: { email?: string; contact?: string };
  theme?: { color?: string };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (response: { error: { description: string } }) => void) => void;
}

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export function PaywallModal({ isOpen, onClose, currentPlan }: PaywallModalProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && onClose) onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, handleEscape]);

  const handleSelectPlan = async (plan: string) => {
    setLoading(plan);
    setError(null);

    const loadRazorpay = () => {
      return new Promise((resolve) => {
        if (typeof window === 'undefined') return resolve(false);
        if (window.Razorpay) return resolve(true);
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
      });
    };

    const isLoaded = await loadRazorpay();
    if (!isLoaded) {
      setError('Failed to load payment gateway. Please check your internet connection.');
      setLoading(null);
      return;
    }

    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const authHeaders: Record<string, string> = {};
      if (session?.access_token) {
        authHeaders['Authorization'] = `Bearer ${session.access_token}`;
      }

      const orderRes = await fetch('/api/billing/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ plan }),
      });

      const orderData = await orderRes.json();

      if (!orderRes.ok) {
        setError(orderData.error || 'Failed to create order');
        setLoading(null);
        return;
      }

      const razorpayKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '';
      const options = {
        key: razorpayKey,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'State AI CRM',
        description: `Subscription - ${plan}`,
        order_id: orderData.orderId,
        handler: async (response: RazorpayResponse) => {
          try {
            const { createClient } = await import('@/lib/supabase/client');
            const supabase = createClient();
            const { data: { session } } = await supabase.auth.getSession();
            const verifyHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (session?.access_token) {
              verifyHeaders['Authorization'] = `Bearer ${session.access_token}`;
            }

            const verifyRes = await fetch('/api/billing/verify-payment', {
              method: 'POST',
              headers: verifyHeaders,
              body: JSON.stringify({ ...response, plan }),
            });

            const verifyData = await verifyRes.json();

            if (!verifyRes.ok) {
              setError(verifyData.error || 'Payment verification failed');
            } else {
              const activatedPlan = verifyData.plan || plan;
              toast.success(`🎉 Subscription activated! You're now on the ${activatedPlan} plan.`, { duration: 4000 });
              setTimeout(() => window.location.reload(), 1500);
            }
          } catch {
            setError('Payment verification failed');
          }
          setLoading(null);
        },
        theme: { color: '#2563eb' },
        modal: {
          ondismiss: () => {
            setLoading(null);
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (response: { error: { description: string } }) => {
        setError(response.error.description);
        setLoading(null);
      });
      rzp.open();
    } catch {
      setError('Failed to initiate payment');
      setLoading(null);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Upgrade plan"
          className="bg-background rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-8 relative"
          onClick={(e) => e.stopPropagation()}
        >
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          )}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Your Free Trial Has Ended</h2>
            <p className="text-muted-foreground mt-2">
              Choose a plan to continue using State AI CRM
            </p>
          </div>

          {error && (
            <div className="mb-6 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm text-center">
              {error}
            </div>
          )}
          <PricingCards onSelectPlan={handleSelectPlan} loading={loading} currentPlan={currentPlan} />
          <p className="text-center text-xs text-muted-foreground mt-6">
            Secure checkout via Razorpay. Cancel or change your plan anytime.
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
