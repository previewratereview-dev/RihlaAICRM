-- ============================================================================
-- Migration 014: Platform User Lifecycle Transactional RPCs
-- Description: Creates server-authoritative, concurrency-safe, SECURITY DEFINER
--              RPCs for Super Admin user role changes and profile deletion.
--              Guarantees last-super_admin and self-modification protections
--              within an atomic database transaction with table/row locking.
-- ============================================================================

BEGIN;

-- Helper internal check for super_admin caller authorization inside SECURITY DEFINER (if not already declared)
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

-- 1. Atomic Platform User Role Update RPC with Concurrency Lock
CREATE OR REPLACE FUNCTION public.platform_update_user_role_atomic(
  p_target_user_id uuid,
  p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_target_profile record;
  v_super_admin_count integer;
  v_now timestamptz := now();
  v_normalized_role text := lower(trim(p_new_role));
  v_updated_profile record;
BEGIN
  -- 1. Verify Caller Authority
  v_actor_id := public.assert_is_platform_super_admin();

  -- 2. Validate Role Allowlist
  IF v_normalized_role NOT IN ('super_admin', 'admin', 'manager', 'consultant', 'specialist', 'setter', 'closer', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: "%" is not an allowed role.', p_new_role USING ERRCODE = '22023';
  END IF;

  -- 3. Acquire Row Locks on all super_admin profiles to prevent concurrency race
  PERFORM id FROM public.profiles WHERE role = 'super_admin' FOR UPDATE;

  -- 4. Acquire Lock on Target Profile
  SELECT id, email, full_name, role, tenant_id
  INTO v_target_profile
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF v_target_profile.id IS NULL THEN
    RAISE EXCEPTION 'Not found: User profile "%" does not exist.', p_target_user_id USING ERRCODE = 'P0002';
  END IF;

  -- 5. Protection: Self-demotion denied
  IF v_target_profile.id = v_actor_id AND v_target_profile.role = 'super_admin' AND v_normalized_role != 'super_admin' THEN
    RAISE EXCEPTION 'Forbidden: Self-demotion is not permitted.' USING ERRCODE = '42501';
  END IF;

  -- 6. Protection: Last super_admin cannot be demoted
  IF v_target_profile.role = 'super_admin' AND v_normalized_role != 'super_admin' THEN
    SELECT count(*) INTO v_super_admin_count
    FROM public.profiles
    WHERE role = 'super_admin';

    IF v_super_admin_count <= 1 THEN
      RAISE EXCEPTION 'Conflict: Cannot demote the last remaining platform super admin.' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 7. Update Profile
  UPDATE public.profiles
  SET
    role = v_normalized_role,
    tenant_id = CASE WHEN v_normalized_role = 'super_admin' AND v_target_profile.tenant_id != 'global' THEN 'global' ELSE tenant_id END,
    updated_at = v_now
  WHERE id = p_target_user_id
  RETURNING * INTO v_updated_profile;

  -- 8. Record Surviving Audit Log under 'global'
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
    'user.role_updated',
    jsonb_build_object(
      'target', p_target_user_id,
      'previousRole', v_target_profile.role,
      'newRole', v_normalized_role
    )::text,
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id', v_updated_profile.id,
      'email', v_updated_profile.email,
      'fullName', v_updated_profile.full_name,
      'role', v_updated_profile.role,
      'tenantId', v_updated_profile.tenant_id,
      'updatedAt', v_updated_profile.updated_at
    )
  );
END;
$$;

-- 2. Atomic Platform User Profile Deletion RPC with Concurrency Lock
CREATE OR REPLACE FUNCTION public.platform_delete_user_profile_atomic(
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_target_profile record;
  v_super_admin_count integer;
  v_now timestamptz := now();
BEGIN
  -- 1. Verify Caller Authority
  v_actor_id := public.assert_is_platform_super_admin();

  -- 2. Protection: Self-deletion denied
  IF p_target_user_id = v_actor_id THEN
    RAISE EXCEPTION 'Forbidden: Self-deletion is not permitted.' USING ERRCODE = '42501';
  END IF;

  -- 3. Acquire Row Locks on all super_admin profiles to prevent concurrency race
  PERFORM id FROM public.profiles WHERE role = 'super_admin' FOR UPDATE;

  -- 4. Acquire Lock on Target Profile
  SELECT id, email, full_name, role, tenant_id
  INTO v_target_profile
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF v_target_profile.id IS NULL THEN
    RAISE EXCEPTION 'Not found: User profile "%" does not exist.', p_target_user_id USING ERRCODE = 'P0002';
  END IF;

  -- 5. Protection: Last super_admin cannot be deleted
  IF v_target_profile.role = 'super_admin' THEN
    SELECT count(*) INTO v_super_admin_count
    FROM public.profiles
    WHERE role = 'super_admin';

    IF v_super_admin_count <= 1 THEN
      RAISE EXCEPTION 'Conflict: Cannot delete the last remaining platform super admin.' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 6. Record Surviving Audit Log under 'global' BEFORE deletion
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
    'user.deleted',
    jsonb_build_object(
      'target', p_target_user_id,
      'deletedUserEmail', v_target_profile.email,
      'deletedUserName', v_target_profile.full_name,
      'deletedUserRole', v_target_profile.role
    )::text,
    v_now
  );

  -- 7. Delete Profile row
  DELETE FROM public.profiles WHERE id = p_target_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'deletedId', p_target_user_id,
    'email', v_target_profile.email
  );
END;
$$;

-- Revoke default PUBLIC execution and grant only to authenticated users
REVOKE ALL ON FUNCTION public.platform_update_user_role_atomic(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_update_user_role_atomic(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.platform_delete_user_profile_atomic(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_delete_user_profile_atomic(uuid) TO authenticated;

COMMIT;
