-- ============================================================================
-- Migration 013: Platform Agency Lifecycle Transactional RPCs
-- Description: Creates server-authoritative, atomic, SECURITY DEFINER RPCs for
--              Super Admin Agency creation, configuration editing, and complete
--              deletion with canonical Traveler/Inquiry/Booking cascade coverage
--              and permanent audit logging under the 'global' workspace.
-- ============================================================================

BEGIN;

-- Helper internal check for super_admin caller authorization inside SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.assert_is_platform_super_admin()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_role text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active authentication session.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_role IS NULL OR v_role != 'super_admin' THEN
    RAISE EXCEPTION 'Forbidden: Requires platform super_admin role.' USING ERRCODE = '42501';
  END IF;

  RETURN v_caller_id;
END;
$$;

-- 1. Atomic Platform Agency Creation RPC
CREATE OR REPLACE FUNCTION public.platform_create_agency_atomic(
  p_name text,
  p_slug text,
  p_domain text DEFAULT NULL,
  p_plan text DEFAULT 'free',
  p_ai_budget numeric DEFAULT 50,
  p_features jsonb DEFAULT '{"pipeline": true, "chatbot": true, "analytics": true, "payments": false, "email": true, "whatsapp": true}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_slug text;
  v_plan text;
  v_now timestamptz := now();
  v_tenant record;
BEGIN
  v_actor_id := public.assert_is_platform_super_admin();

  IF p_name IS NULL OR length(trim(p_name)) < 2 OR length(trim(p_name)) > 100 THEN
    RAISE EXCEPTION 'Validation error: Agency name must be between 2 and 100 characters.' USING ERRCODE = '22023';
  END IF;

  v_slug := lower(regexp_replace(trim(p_slug), '[^a-z0-9-_]', '-', 'g'));
  v_slug := regexp_replace(v_slug, '-+', '-', 'g');
  v_slug := trim(both '-' from v_slug);

  IF v_slug IS NULL OR length(v_slug) < 2 OR length(v_slug) > 60 THEN
    RAISE EXCEPTION 'Validation error: Agency slug must be between 2 and 60 alphanumeric characters.' USING ERRCODE = '22023';
  END IF;

  v_plan := lower(trim(coalesce(p_plan, 'free')));
  IF v_plan NOT IN ('free', 'starter', 'growth', 'enterprise', 'custom', 'scale', 'pro', 'premium') THEN
    v_plan := 'free';
  END IF;

  -- Lock slug/id namespace check
  IF EXISTS (
    SELECT 1 FROM public.tenants WHERE id = v_slug OR slug = v_slug FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Conflict: An agency with slug "%" already exists.', v_slug USING ERRCODE = '23505';
  END IF;

  -- Insert Tenant
  INSERT INTO public.tenants (
    id,
    name,
    slug,
    domain,
    status,
    settings,
    created_at,
    updated_at
  ) VALUES (
    v_slug,
    trim(p_name),
    v_slug,
    nullif(trim(p_domain), ''),
    'active',
    jsonb_build_object('aiBudget', coalesce(p_ai_budget, 50), 'features', coalesce(p_features, '{}'::jsonb)),
    v_now,
    v_now
  ) RETURNING * INTO v_tenant;

  -- Insert/Upsert Settings
  INSERT INTO public.settings (
    id,
    tenant_id,
    agency_name,
    updated_at
  ) VALUES (
    v_slug,
    v_slug,
    trim(p_name),
    v_now
  ) ON CONFLICT (id) DO UPDATE SET
    agency_name = excluded.agency_name,
    updated_at = excluded.updated_at;

  -- Insert/Upsert Subscription
  INSERT INTO public.subscriptions (
    tenant_id,
    plan,
    status,
    created_at,
    updated_at
  ) VALUES (
    v_slug,
    v_plan,
    'active',
    v_now,
    v_now
  ) ON CONFLICT (tenant_id) DO UPDATE SET
    plan = excluded.plan,
    status = excluded.status,
    updated_at = excluded.updated_at;

  -- Record surviving platform audit log under 'global' workspace
  INSERT INTO public.audit_logs (
    id,
    tenant_id,
    user_id,
    user_name,
    user_role,
    action,
    details,
    created_at
  ) VALUES (
    gen_random_uuid()::text,
    'global',
    v_actor_id::text,
    'Super Admin',
    'super_admin',
    'agency.created',
    jsonb_build_object('name', trim(p_name), 'slug', v_slug, 'plan', v_plan, 'target', v_slug)::text,
    v_now
  );

  RETURN jsonb_build_object(
    'id', v_tenant.id,
    'name', v_tenant.name,
    'slug', v_tenant.slug,
    'domain', v_tenant.domain,
    'status', v_tenant.status,
    'plan', v_plan,
    'settings', v_tenant.settings,
    'createdAt', v_tenant.created_at,
    'updatedAt', v_tenant.updated_at
  );
END;
$$;

-- 2. Atomic Platform Agency Edit RPC
CREATE OR REPLACE FUNCTION public.platform_edit_agency_atomic(
  p_tenant_id text,
  p_name text DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_primary_color text DEFAULT NULL,
  p_custom_prompt text DEFAULT NULL,
  p_plan text DEFAULT NULL,
  p_ai_budget numeric DEFAULT NULL,
  p_features jsonb DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_tenant record;
  v_existing_settings jsonb;
  v_merged_settings jsonb;
  v_final_plan text;
  v_final_status text;
  v_now timestamptz := now();
BEGIN
  v_actor_id := public.assert_is_platform_super_admin();

  IF p_tenant_id IS NULL OR trim(p_tenant_id) = '' THEN
    RAISE EXCEPTION 'Validation error: Missing target tenant identifier.' USING ERRCODE = '22023';
  END IF;

  -- Lock target tenant row
  SELECT * INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id
  FOR UPDATE;

  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'Not found: Agency "%" does not exist.', p_tenant_id USING ERRCODE = 'P0002';
  END IF;

  v_existing_settings := coalesce(v_tenant.settings, '{}'::jsonb);
  v_merged_settings := v_existing_settings;

  IF p_ai_budget IS NOT NULL THEN
    v_merged_settings := jsonb_set(v_merged_settings, '{aiBudget}', to_jsonb(p_ai_budget));
  END IF;
  IF p_features IS NOT NULL THEN
    v_merged_settings := jsonb_set(v_merged_settings, '{features}', p_features);
  END IF;

  v_final_status := coalesce(nullif(trim(lower(p_status)), ''), v_tenant.status);
  IF v_final_status NOT IN ('active', 'suspended') THEN
    v_final_status := v_tenant.status;
  END IF;

  -- Update Tenant
  UPDATE public.tenants
  SET
    name = coalesce(nullif(trim(p_name), ''), v_tenant.name),
    domain = CASE WHEN p_domain IS NOT NULL THEN nullif(trim(p_domain), '') ELSE v_tenant.domain END,
    primary_color = coalesce(nullif(trim(p_primary_color), ''), v_tenant.primary_color),
    custom_prompt = coalesce(nullif(trim(p_custom_prompt), ''), v_tenant.custom_prompt),
    status = v_final_status,
    settings = v_merged_settings,
    updated_at = v_now
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  -- Get / Update Subscription
  SELECT plan INTO v_final_plan
  FROM public.subscriptions
  WHERE tenant_id = p_tenant_id;

  IF p_plan IS NOT NULL AND trim(p_plan) != '' THEN
    v_final_plan := lower(trim(p_plan));
    IF v_final_plan IN ('free', 'starter', 'growth', 'enterprise', 'custom', 'scale', 'pro', 'premium') THEN
      INSERT INTO public.subscriptions (
        tenant_id,
        plan,
        status,
        created_at,
        updated_at
      ) VALUES (
        p_tenant_id,
        v_final_plan,
        v_final_status,
        v_now,
        v_now
      ) ON CONFLICT (tenant_id) DO UPDATE SET
        plan = excluded.plan,
        status = excluded.status,
        updated_at = excluded.updated_at;
    END IF;
  END IF;

  -- Record surviving audit log under 'global'
  INSERT INTO public.audit_logs (
    id,
    tenant_id,
    user_id,
    user_name,
    user_role,
    action,
    details,
    created_at
  ) VALUES (
    gen_random_uuid()::text,
    'global',
    v_actor_id::text,
    'Super Admin',
    'super_admin',
    CASE
      WHEN p_status IS NOT NULL AND p_status = 'suspended' THEN 'agency.suspended'
      WHEN p_status IS NOT NULL AND p_status = 'active' THEN 'agency.reinstated'
      ELSE 'agency.updated'
    END,
    jsonb_build_object('target', p_tenant_id, 'name', v_tenant.name, 'status', v_tenant.status, 'plan', v_final_plan)::text,
    v_now
  );

  RETURN jsonb_build_object(
    'id', v_tenant.id,
    'name', v_tenant.name,
    'slug', v_tenant.slug,
    'domain', v_tenant.domain,
    'status', v_tenant.status,
    'primaryColor', v_tenant.primary_color,
    'customPrompt', v_tenant.custom_prompt,
    'settings', v_tenant.settings,
    'plan', coalesce(v_final_plan, 'free'),
    'updatedAt', v_tenant.updated_at
  );
END;
$$;

-- 3. Atomic Platform Agency Deletion RPC
CREATE OR REPLACE FUNCTION public.platform_delete_agency_atomic(
  p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_tenant record;
  v_now timestamptz := now();
BEGIN
  v_actor_id := public.assert_is_platform_super_admin();

  IF p_tenant_id IS NULL OR trim(p_tenant_id) = '' THEN
    RAISE EXCEPTION 'Validation error: Missing target tenant identifier.' USING ERRCODE = '22023';
  END IF;

  IF p_tenant_id IN ('global', 'platform') THEN
    RAISE EXCEPTION 'Security error: System tenant "%" cannot be deleted.', p_tenant_id USING ERRCODE = '42501';
  END IF;

  -- Lock target tenant row
  SELECT id, name INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id
  FOR UPDATE;

  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'Not found: Agency "%" does not exist.', p_tenant_id USING ERRCODE = 'P0002';
  END IF;

  -- Record surviving audit log BEFORE deleting tenant, scoped to 'global'
  INSERT INTO public.audit_logs (
    id,
    tenant_id,
    user_id,
    user_name,
    user_role,
    action,
    details,
    created_at
  ) VALUES (
    gen_random_uuid()::text,
    'global',
    v_actor_id::text,
    'Super Admin',
    'super_admin',
    'agency.deleted',
    jsonb_build_object('target', p_tenant_id, 'deletedAgencyName', v_tenant.name)::text,
    v_now
  );

  -- Delete complete child graph in explicit reverse dependency order:
  -- 1. Canonical fulfillment bookings (references inquiries and traveler_profiles)
  DELETE FROM public.bookings WHERE tenant_id = p_tenant_id;

  -- 2. Canonical sales inquiries (references traveler_profiles)
  DELETE FROM public.inquiries WHERE tenant_id = p_tenant_id;

  -- 3. Canonical customer traveler_profiles
  DELETE FROM public.traveler_profiles WHERE tenant_id = p_tenant_id;

  -- 4. CRM Communications & Task graph
  DELETE FROM public.messages WHERE tenant_id = p_tenant_id;
  DELETE FROM public.conversations WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tasks WHERE tenant_id = p_tenant_id;
  DELETE FROM public.activities WHERE tenant_id = p_tenant_id;
  DELETE FROM public.notes WHERE tenant_id = p_tenant_id;
  DELETE FROM public.quotes_itineraries WHERE tenant_id = p_tenant_id;
  DELETE FROM public.leads WHERE tenant_id = p_tenant_id;

  -- 5. Operational infrastructure & auxiliary tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inbound_event_queue') THEN
    EXECUTE 'DELETE FROM public.inbound_event_queue WHERE tenant_id = $1' USING p_tenant_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'documents') THEN
    EXECUTE 'DELETE FROM public.documents WHERE tenant_id = $1' USING p_tenant_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'files') THEN
    EXECUTE 'DELETE FROM public.files WHERE tenant_id = $1' USING p_tenant_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'secret_store') THEN
    EXECUTE 'DELETE FROM public.secret_store WHERE tenant_id = $1' USING p_tenant_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invitations') THEN
    EXECUTE 'DELETE FROM public.invitations WHERE tenant_id = $1' USING p_tenant_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'integration_credentials') THEN
    EXECUTE 'DELETE FROM public.integration_credentials WHERE tenant_id = $1' USING p_tenant_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'roles') THEN
    EXECUTE 'DELETE FROM public.roles WHERE tenant_id = $1' USING p_tenant_id;
  END IF;

  DELETE FROM public.ai_usage WHERE tenant_id = p_tenant_id;
  DELETE FROM public.faq_entries WHERE tenant_id = p_tenant_id;
  DELETE FROM public.knowledge_documents WHERE tenant_id = p_tenant_id;
  DELETE FROM public.settings WHERE tenant_id = p_tenant_id;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_settings') THEN
    EXECUTE 'DELETE FROM public.app_settings WHERE tenant_id = $1' USING p_tenant_id;
  END IF;

  DELETE FROM public.subscriptions WHERE tenant_id = p_tenant_id;

  -- 6. Profiles
  DELETE FROM public.profiles WHERE tenant_id = p_tenant_id;

  -- 7. Root Tenant Row
  DELETE FROM public.tenants WHERE id = p_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'deletedId', p_tenant_id
  );
END;
$$;

-- Security hardening: revoke public execution and grant to authenticated
REVOKE ALL ON FUNCTION public.assert_is_platform_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_create_agency_atomic(text, text, text, text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_edit_agency_atomic(text, text, text, text, text, text, numeric, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_delete_agency_atomic(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.assert_is_platform_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_create_agency_atomic(text, text, text, text, numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_edit_agency_atomic(text, text, text, text, text, text, numeric, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_delete_agency_atomic(text) TO authenticated;

COMMIT;
