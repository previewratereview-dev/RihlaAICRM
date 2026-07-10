-- ====================================================================
-- Migration 003: Subscriptions Table
-- Creates the subscriptions table for billing and trial management.
-- Must run BEFORE provision_agency() (migration 004).
-- Run on: Fresh install or existing DB without this table.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  tenant_id text PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','starter','pro','premium')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','trialing','past_due','cancelled')),
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL DEFAULT now(),
  razorpay_subscription_id text,
  razorpay_order_id text,
  razorpay_payment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation on subscriptions" ON public.subscriptions;
CREATE POLICY "Tenant isolation on subscriptions" ON public.subscriptions
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Super admin read all subscriptions" ON public.subscriptions;
CREATE POLICY "Super admin read all subscriptions" ON public.subscriptions
  FOR SELECT USING (public.get_user_role() = 'super_admin');

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON public.subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
