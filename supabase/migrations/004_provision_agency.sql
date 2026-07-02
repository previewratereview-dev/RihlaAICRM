-- ====================================================================
-- Migration 004: Agency Provisioning Function
-- ====================================================================
-- Creates provision_agency() for self-service tenant signup.
-- DEPENDS ON: tenants, profiles, settings, subscriptions tables.
-- Run on: Fresh install or existing DB without this function.

CREATE OR REPLACE FUNCTION public.provision_agency(
  p_auth_user_id UUID,
  p_email TEXT,
  p_agency_name TEXT
)
RETURNS TABLE(tenant_id TEXT, user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id TEXT;
  v_slug TEXT;
BEGIN
  v_tenant_id := 'tenant-' || replace(gen_random_uuid()::text, '-', '');
  v_slug := lower(replace(p_agency_name, ' ', '-'));
  v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '', 'g');
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  INSERT INTO public.tenants (id, name, slug, settings)
  VALUES (v_tenant_id, p_agency_name, v_slug, '{}'::jsonb);

  INSERT INTO public.profiles (id, email, full_name, role, is_online, tenant_id)
  VALUES (
    p_auth_user_id,
    p_email,
    split_part(p_email, '@', 1),
    'admin',
    false,
    v_tenant_id
  );

  INSERT INTO public.settings (id, tenant_id, agency_name)
  VALUES (v_tenant_id, v_tenant_id, p_agency_name)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (tenant_id, plan, status, trial_start, trial_end, current_period_start, current_period_end)
  VALUES (
    v_tenant_id,
    'pro',
    'trialing',
    now(),
    now() + interval '7 days',
    now(),
    now() + interval '7 days'
  );

  tenant_id := v_tenant_id;
  user_id := p_auth_user_id;
  RETURN NEXT;
END;
$$;
